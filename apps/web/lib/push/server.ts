import 'server-only';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { clinicalContext, ClinicalError } from '../clinical-server';
import { appOrigin } from '../auth/mail';
import { sessionClient } from '../supabase/server';
import type { Json } from '@sro/types';

export const pushEnabled = () => process.env.SRO_PUSH_ENABLED === '1';
export function assertPushEnabled() {
  if (!pushEnabled()) throw new ClinicalError('Mobile notifications are not active yet.', 503);
}
export function assertPushOrigin(request: NextRequest) {
  if (request.headers.get('origin') !== appOrigin())
    throw new ClinicalError('Request origin refused.', 403);
}
export async function pushBody(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > 8192)
    throw new ClinicalError('Request too large.', 413);
  const body = await request.text();
  if (body.length > 8192) throw new ClinicalError('Request too large.', 413);
  return JSON.parse(body);
}
export async function pushContext(request: NextRequest, admin = false) {
  const value = request.nextUrl.searchParams.get('role');
  const role = admin ? 'admin' : value;
  if (role !== 'admin' && role !== 'doctor' && role !== 'patient')
    throw new ClinicalError('Workspace required.', 400);
  return clinicalContext(role, request.nextUrl.searchParams.get('organizationId') ?? undefined);
}
export async function userPushCommand(
  client: Awaited<ReturnType<typeof sessionClient>>,
  name: 'clinic_push_device' | 'clinic_broadcast',
  action: string,
  input: unknown,
) {
  // Separate proposed contracts: no edits to the already deployed database types.
  const result = await client.rpc(name as never, { p_action: action, p_input: input } as never);
  if (result.error)
    throw new ClinicalError(
      result.error.code === '42501'
        ? 'Notification access denied.'
        : result.error.code === 'PGRST202' || result.error.code === '55000'
          ? 'Notification delivery is not active yet.'
          : 'Notification request refused. Refresh the recipient preview and try again.',
      result.error.code === '42501' ? 403 : 503,
    );
  return result.data as Json;
}
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function revokePushBeforeLogout() {
  const client = await sessionClient();
  const { data } = await client.auth.getUser();
  if (!data.user) return;
  await userPushCommand(client, 'clinic_push_device', 'logout', {});
}
