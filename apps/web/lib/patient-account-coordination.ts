import 'server-only';
import { randomUUID, randomBytes } from 'node:crypto';
import { PATIENT_ACCOUNT_ACCESS_ENABLED } from './patient-access-feature';
import { requireCoordinatedPatientAccessRoutes, requireCoordinatedPatientMutations } from './patient-access-coordinated';
import {
  handoverHash,
  type AccessDependencies,
  type AccessRecord,
} from './patient-access-protocol';
// Future integration only. No protected route uses this adapter before SQL approval.
export const DISTRIBUTED_PATIENT_ACCESS_READY = false;
export function requireDistributedPatientAccess() {
  if (!PATIENT_ACCOUNT_ACCESS_ENABLED || !DISTRIBUTED_PATIENT_ACCESS_READY)
    throw Error('Distributed Patient account access is not activated.');
}
export type AccountPurpose = 'provision' | 'reset' | 'activate';
export type CoordinationRpc = (
  action: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
export async function coordinatedAccountWrite<T>(input: {
  purpose: AccountPurpose;
  actorId: string;
  patientId: string;
  requestId: string;
  sessionId?: string;
  identityVerified?: boolean;
  // Narrow, separately reviewed authority. It never substitutes for normal in-person reset.
  recoveryAuthorized?: boolean;
  rpc: CoordinationRpc;
  // A separate reviewed authority may create the durable claim before the normal start path.
  claim?: (input: {
    operationId: string;
    workerId: string;
    proof: string;
    requestId: string;
  }) => Promise<Record<string, unknown>>;
  prepare?: (binding: Record<string, unknown>) => Promise<void>;
  provider: () => Promise<T>;
  commit: (binding: Record<string, unknown>, result: T) => Promise<void>;
  // Runs only after the durable commit. Its failure must not turn a committed handover into a retry.
  afterCommit?: (binding: Record<string, unknown>) => Promise<void>;
}) {
  if (input.purpose === 'reset' && !input.identityVerified && !input.recoveryAuthorized)
    throw Error('In-person identity verification required.');
  const operationId = randomUUID(),
    workerId = randomUUID(),
    proof = randomBytes(32).toString('base64url');
  const base = { actorId: input.actorId, patientId: input.patientId, operationId, workerId, proof };
  let claim: Record<string, unknown>;
  try {
    claim = input.claim
      ? await input.claim({ operationId, workerId, proof, requestId: input.requestId })
      : await input.rpc('claim', {
          ...base,
          data: {
            purpose: input.purpose,
            requestId: input.requestId,
            sessionId: input.sessionId,
            identityCheck: input.identityVerified ? 'in_person_verified' : undefined,
          },
        });
  } catch (error) {
    if (typeof error === 'object' && error && 'status' in error) throw error;
    throw Error('Account claim unconfirmed; review required.');
  }
  if (
    claim.operationId !== operationId ||
    typeof claim.fence !== 'string' ||
    !/^\d+$/.test(claim.fence) ||
    claim.phase !== 'claimed'
  )
    throw Error('Account claim unconfirmed; review required.');
  const binding = { ...base, fence: claim.fence };
  let result: T;
  try {
    await input.prepare?.(binding);
    const started = await input.rpc('start', { ...binding, data: { fence: claim.fence } });
    if (started.phase !== 'started') throw Error('Provider start unconfirmed.');
    // Exactly ONE attempt. Provider requests cannot safely be retried/taken over on timeout.
    result = await input.provider();
    const confirmed = await input.rpc('confirm', { ...binding, data: { fence: claim.fence } });
    if (confirmed.phase !== 'confirmed') throw Error('Provider result unconfirmed.');
    await input.commit(binding, result);
  } catch {
    // Quarantine tightens access. If this call fails, the durable unfinished claim still fences it.
    await input
      .rpc('quarantine', { ...binding, data: { fence: claim.fence } })
      .catch(() => undefined);
    throw Error(
      'Account operation requires clinic review. Do not retry or create another identity.',
    );
  }
  if (input.afterCommit) await input.afterCommit(binding);
  return result;
}

// Future server-only adapter. The caller supplies already authenticated actor scope;
// every claim/start/commit independently reauthorizes it in PostgreSQL. The browser
// never supplies these dependencies or sees the operation capability/internal alias.
export async function prepareDistributedHandover(
  deps: AccessDependencies & { operation: CoordinationRpc },
  input: {
    actorId: string;
    patientId: string;
    requestId: string;
    reset?: boolean;
    identityVerified?: boolean;
  },
) {
  requireCoordinatedPatientAccessRoutes();
  requireCoordinatedPatientMutations();
  let record: AccessRecord | undefined;
  let nonce = '';
  return coordinatedAccountWrite({
    purpose: input.reset ? 'reset' : 'provision',
    ...input,
    rpc: deps.operation,
    prepare: async (binding) => {
      record = (await deps.command(
        input.reset ? 'reset' : 'begin',
        input.actorId,
        input.patientId,
        {
          ...binding,
          identityCheck: input.identityVerified ? 'in_person_verified' : undefined,
        },
      )) as AccessRecord;
      if (
        record.patientId !== input.patientId ||
        record.operationId !== binding.operationId ||
        !record.userId ||
        (!input.reset &&
          (!record.internalEmail ||
            !/^[0-9a-f]{32}@accounts\.sro\.invalid$/.test(record.internalEmail)))
      )
        throw Error('Account binding refused.');
    },
    provider: async () => {
      if (!record) throw Error('Account binding unavailable.');
      const temporaryPassword = randomBytes(32).toString('base64url') + 'Aa9!';
      nonce = randomBytes(32).toString('base64url');
      if (input.reset) await deps.replacePassword(record.userId, temporaryPassword);
      else
        await deps.createInternalUser({
          id: record.userId,
          email: record.internalEmail!,
          password: temporaryPassword,
        });
      return temporaryPassword;
    },
    commit: async (binding, temporaryPassword) => {
      await deps.command('commit', input.actorId, input.patientId, {
        ...binding,
        handoverHash: handoverHash(nonce),
      });
      // Returned separately below, after confirmed SQL commit only.
      void temporaryPassword;
    },
  }).then(async (temporaryPassword) => {
    let window: Awaited<ReturnType<NonNullable<AccessDependencies['handoverWindow']>>> = null;
    if (deps.handoverWindow) {
      try {
        window = await deps.handoverWindow(input.actorId, record!.patientId);
      } catch {
        window = null;
      }
    }
    return {
      patientId: record!.patientId,
      patientCode: record!.patientCode,
      name: record!.name,
      operationId: record!.operationId,
      temporaryPassword,
      handoverNonce: nonce,
      handoverExpiresAt: window?.handoverExpiresAt ?? null,
      serverNow: window?.serverNow ?? null,
    };
  });
}

export async function completeDistributedPasswordChange(input: {
  actorId: string;
  patientId: string;
  requestId: string;
  sessionId: string;
  rpc: CoordinationRpc;
  command: AccessDependencies['command'];
  // Must call the ordinary authenticated Supabase user's updateUser, after the
  // existing strong/different-password and MFA checks. No admin password shortcut.
  replaceOwnPassword: () => Promise<void>;
}) {
  requireCoordinatedPatientAccessRoutes();
  return coordinatedAccountWrite({
    purpose: 'activate',
    ...input,
    provider: input.replaceOwnPassword,
    commit: async (binding) => {
      await input.command('change-complete', input.actorId, input.patientId, {
        ...binding,
        sessionId: input.sessionId,
      });
    },
  });
}
