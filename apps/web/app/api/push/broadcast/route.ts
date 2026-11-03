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
    const { client, membership } = await pushContext(request, true);
    const raw = await pushBody(request);
    const input = broadcastSchema.parse(raw);
    if (
      input.organizationId !== membership.organizationId ||
      (input.branchId && !membership.branchIds.includes(input.branchId))
    )
      throw new ClinicalError('Branch access denied.', 403);
    if (!['preview', 'send'].includes(raw.action)) throw new ClinicalError('Invalid action.');
    if (raw.action === 'send') {
      assertPushEnabled();
      if (!input.confirmation || !input.requestId || raw.confirm !== true)
        throw new ClinicalError('Recipient preview and explicit confirmation required.');
    }
    return reply(await userPushCommand(client, 'clinic_broadcast', raw.action, input));
  } catch (e) {
    return failure(e);
  }
}
