// Prepared server protocol; deliberately not mounted in active routes before approval.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export type PatientAccessAction =
  | 'begin'
  | 'reset'
  | 'commit'
  | 'handover'
  | 'disable'
  | 'enable'
  | 'status'
  | 'resolve'
  | 'self'
  | 'change-complete';
export type AccessRecord = {
  patientId: string;
  patientCode: string;
  name: string;
  userId: string;
  internalEmail: string | null;
  operationId: string;
};
export interface AccessDependencies {
  command(
    action: PatientAccessAction,
    actor: string | null,
    patient: string | null,
    data: Record<string, unknown>,
  ): Promise<unknown>;
  createInternalUser(input: { id: string; email: string; password: string }): Promise<void>;
  replacePassword(userId: string, password: string): Promise<void>;
  // Optional read-only server window used only for display. SQL remains authoritative.
  handoverWindow?: (
    actorId: string,
    patientId: string,
  ) => Promise<{
    handoverExpiresAt: string | null;
    serverNow: string | null;
    handoverExpired: boolean;
  } | null>;
}
export const handoverHash = (nonce: string) => createHash('sha256').update(nonce).digest('hex');
export function normalizeLogin(value: string) {
  const trimmed = value.trim();
  if (/^SRO[0-9]{4,}$/.test(trimmed.toUpperCase()))
    return { kind: 'patientId' as const, value: trimmed.toUpperCase() };
  if (
    trimmed.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) &&
    !trimmed.toLowerCase().endsWith('.invalid')
  )
    return { kind: 'email' as const, value: trimmed.toLowerCase() };
  return { kind: 'invalid' as const, value: '' };
}
export function requireDeploymentApproval(approved: boolean) {
  if (!approved) throw new Error('Patient account access awaits deployment approval.');
}
export async function prepareHandover(
  deps: AccessDependencies,
  input: {
    approved: boolean;
    actor: string;
    patientId: string;
    reset?: boolean;
    identityVerified?: boolean;
  },
) {
  requireDeploymentApproval(input.approved);
  if (input.reset && !input.identityVerified)
    throw new Error('In-person identity verification is required.');
  const operationId = randomUUID();
  // Database claims the unique Patient operation BEFORE any Auth creation/password mutation.
  const record = (await deps.command(
    input.reset ? 'reset' : 'begin',
    input.actor,
    input.patientId,
    { operationId, ...(input.reset ? { identityCheck: 'in_person_verified' } : {}) },
  )) as AccessRecord;
  if (record.patientId !== input.patientId || record.operationId !== operationId)
    throw new Error('Account binding refused.');
  const temporaryPassword = randomBytes(32).toString('base64url') + 'Aa9!';
  const handoverNonce = randomBytes(32).toString('base64url');
  if (input.reset) await deps.replacePassword(record.userId, temporaryPassword);
  else {
    if (
      !record.internalEmail ||
      !/^[0-9a-f]{32}@accounts\.sro\.invalid$/.test(record.internalEmail)
    )
      throw new Error('Internal identity refused.');
    await deps.createInternalUser({
      id: record.userId,
      email: record.internalEmail,
      password: temporaryPassword,
    });
  }
  await deps.command('commit', input.actor, input.patientId, {
    operationId,
    handoverHash: handoverHash(handoverNonce),
  });
  // Never return AccessRecord: internal Auth addresses must not appear in HTTP/browser contracts.
  return {
    patientId: record.patientId,
    patientCode: record.patientCode,
    name: record.name,
    operationId,
    temporaryPassword,
    handoverNonce,
  };
}
export async function acknowledgeHandover(
  deps: AccessDependencies,
  input: {
    approved: boolean;
    actor: string;
    patientId: string;
    operationId: string;
    nonce: string;
  },
) {
  requireDeploymentApproval(input.approved);
  await deps.command('handover', input.actor, input.patientId, {
    operationId: input.operationId,
    handoverHash: handoverHash(input.nonce),
  });
}
// Same provider password request for unknown IDs/invalid identifiers. Generic response and padded
// failure latency reduce enumeration; edge/IP throttling remains mandatory before public rollout.
export async function privateLogin<T>(
  input: string,
  password: string,
  options: {
    resolve: (code: string) => Promise<{ email: string } | null>;
    authenticate: (email: string, password: string) => Promise<T>;
    allow: (result: T) => Promise<boolean>;
    limit: () => Promise<void>;
    minimumMs?: number;
  },
) {
  const started = Date.now();
  try {
    await options.limit();
    const normalized = normalizeLogin(input);
    const resolved =
      normalized.kind === 'patientId' ? await options.resolve(normalized.value) : null;
    const email =
      normalized.kind === 'email'
        ? normalized.value
        : (resolved?.email ?? `${randomBytes(16).toString('hex')}@accounts.sro.invalid`);
    const result = await options.authenticate(email, password);
    if (
      normalized.kind === 'invalid' ||
      (normalized.kind === 'patientId' && !resolved) ||
      !(await options.allow(result))
    )
      throw new Error('Denied');
    return result;
  } catch (error) {
    await delay(
      Math.max(0, (options.minimumMs ?? 650) + randomBytes(1)[0] - (Date.now() - started)),
    );
    const failure = new Error('Sign-in failed. Check your Patient ID or email and password.');
    const authCode = (error as { authCode?: string } | null)?.authCode;
    if (authCode) Object.assign(failure, { authCode });
    throw failure;
  }
}
