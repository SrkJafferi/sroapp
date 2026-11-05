import { NextResponse, type NextRequest } from 'next/server';
import { broadcastSchema } from '@/lib/push/contracts';
import {
  assertPushEnabled,
  assertPushOrigin,
  pushBody,
  pushContext,
  userPushCommand,
} from '@/lib/push/server';
import { ClinicalError } from '@/lib/clinical-server';
import { managementCapabilities } from '@/lib/push/management';
import { assertWebPushPilot } from '@/lib/push/pilot';
import { z } from 'zod';
import { verifyPilotPublishing } from '@/lib/push/pilot-readiness';
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(e: unknown) {
  return reply(
    { error: e instanceof ClinicalError ? e.message : 'Please check the notification fields.' },
    e instanceof ClinicalError ? e.status : 400,
  );
}
export async function GET(request: NextRequest) {
  try {
    const { client, membership } = await pushContext(request, true);
    return reply(
      await userPushCommand(client, 'clinic_broadcast', 'history', {
        organizationId: membership.organizationId,
        branchId: request.nextUrl.searchParams.get('branchId') || null,
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertPushOrigin(request);
    const { client, membership, identity } = await pushContext(request, true);
    const raw = await pushBody(request);
    const input = broadcastSchema.parse(raw);
    if (
      input.organizationId !== membership.organizationId ||
      (input.branchId && !membership.branchIds.includes(input.branchId))
    )
      throw new ClinicalError('Branch access denied.', 403);
    if (!['preview', 'send'].includes(raw.action)) throw new ClinicalError('Invalid action.');
    const caps = await managementCapabilities(client, {
      organizationId: membership.organizationId,
      branchId: input.branchId,
    });
    if (input.audienceMode !== 'roles') {
      if (caps.version !== 2 || !caps.individualTargeting)
        throw new ClinicalError('Targeted publishing is awaiting setup approval.', 503);
      if (input.audienceMode === 'individuals' && !input.recipientIds.length)
        throw new ClinicalError('Select at least one authorized recipient.', 400);
    }
    let approvedPilot = {};
    if (input.audienceMode === 'pilot') {
      assertPushEnabled();
      assertWebPushPilot({
        userId: identity.id,
        organizationId: membership.organizationId,
        role: 'admin',
      });
      if (
        input.roles.length !== 1 ||
        input.roles[0] !== 'admin' ||
        input.recipientIds.length !== 1 ||
        input.recipientIds[0] !== identity.id
      )
        throw new ClinicalError('Only the approved Administrator device is permitted.', 403);
      const ids = z
        .object({ pilotNotificationId: z.uuid(), pilotBindingId: z.uuid() })
        .safeParse({
          pilotNotificationId: process.env.SRO_PUSH_PILOT_NOTIFICATION_ID,
          pilotBindingId: process.env.SRO_PUSH_PILOT_BINDING_ID,
        });
      if (!ids.success)
        throw new ClinicalError('Approved notification and device binding required.', 503);
      approvedPilot = ids.data;
    }
    if (raw.action === 'send') {
      assertPushEnabled();
      if (input.audienceMode !== 'pilot')
        throw new ClinicalError('Broadcast publishing is not approved. Only the scoped one-device pilot may publish.', 403);
      if (!input.confirmation || !input.requestId || raw.confirm !== true)
        throw new ClinicalError('Recipient preview and explicit confirmation required.');
      if (input.audienceMode === 'pilot') {
        const publishing = await verifyPilotPublishing(client, identity, membership.organizationId, input.branchId, caps);
        if (!publishing.ready) throw new ClinicalError(publishing.reason, 503);
      }
    }
    const result = await userPushCommand(client, 'clinic_broadcast', raw.action, { ...input, ...approvedPilot });
    if (raw.action === 'preview') {
      const publishing = input.audienceMode === 'pilot'
        ? await verifyPilotPublishing(client, identity, membership.organizationId, input.branchId, caps)
        : { ready: false, reason: 'Broadcast publishing is paused. Review is available; no notification will be created.' };
      const preview = z.object({count:z.number().int().min(0).max(5000),confirmation:z.string().regex(/^[a-f0-9]{32}$/)}).parse(result);
      return reply({ ...preview, publishing });
    }
    return reply(result);
  } catch (e) {
    return failure(e);
  }
}
