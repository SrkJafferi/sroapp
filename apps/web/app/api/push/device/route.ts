import { NextResponse, type NextRequest } from 'next/server';
import { ClinicalError } from '@/lib/clinical-server';
import { deviceSchema } from '@/lib/push/contracts';
import { assertWebPushPilot } from '@/lib/push/pilot';
import {
  assertPushEnabled,
  assertPushOrigin,
  pushBody,
  pushContext,
  secretHash,
  userPushCommand,
} from '@/lib/push/server';
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function error(e: unknown) {
  return reply(
    { error: e instanceof ClinicalError ? e.message : 'Invalid notification request.' },
    e instanceof ClinicalError ? e.status : 400,
  );
}
export async function GET(request: NextRequest) {
  try {
    assertPushEnabled();
    const { client, membership, identity } = await pushContext(request);
    const role = request.nextUrl.searchParams.get('role');
    assertWebPushPilot({
      userId: identity.id,
      organizationId: membership.organizationId,
      role: role ?? '',
    });
    const input = { role, organizationId: membership.organizationId };
    const context = await userPushCommand(client, 'clinic_push_device', 'context', input);
    return reply({ context, ...input });
  } catch (e) {
    return error(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertPushOrigin(request);
    const { client, membership, identity } = await pushContext(request);
    const raw = await pushBody(request);
    if (!['register', 'revoke', 'preferences', 'detach'].includes(raw.action))
      throw new ClinicalError('Invalid action.');
    const { secret, scope, ...input } = deviceSchema.parse(raw);
    // A closed/expired pilot must not strand authorized revocation or detach.
    if (raw.action !== 'revoke' && raw.action !== 'detach') {
      assertPushEnabled();
      assertWebPushPilot({
        userId: identity.id,
        organizationId: membership.organizationId,
        role: request.nextUrl.searchParams.get('role') ?? '',
        installationId: input.installationId,
      });
    }
    const current = (await userPushCommand(client, 'clinic_push_device', 'context', {
      role: request.nextUrl.searchParams.get('role'),
      organizationId: membership.organizationId,
    })) as { scope?: string };
    if (current.scope !== scope)
      throw new ClinicalError('Account session changed. Please retry.', 403);
    if (raw.action === 'register' && !input.token)
      throw new ClinicalError('Device token required.');
    return reply(
      await userPushCommand(client, 'clinic_push_device', raw.action, {
        ...input,
        secretHash: secretHash(secret),
        role: request.nextUrl.searchParams.get('role'),
        organizationId: membership.organizationId,
      }),
    );
  } catch (e) {
    return error(e);
  }
}
