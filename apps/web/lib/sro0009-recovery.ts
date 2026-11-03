import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { provisioningClient } from './supabase/admin';
import { coordinatedPatientAccessRoutesEnabled } from './patient-access-coordinated';
import {
  coordinatedAccountWrite,
  type CoordinationRpc,
} from './patient-account-coordination';
import {
  handoverHash,
  type AccessDependencies,
  type AccessRecord,
} from './patient-access-protocol';

// Server-side binding for the only authorized recovery. SQL repeats every check.
export const SRO0009_RECOVERY = {
  patientId: '43824fdc-558a-4321-95b5-e11bc43a94b3',
  patientCode: 'SRO0009',
  patientName: 'Ayesha Noor',
  organizationId: '88645fbe-34da-48aa-a509-c24441b7cf72',
  branchId: '5680d806-8a14-48d3-a0ac-d1cd12eddff3',
  authUserId: '68b99984-1527-461b-b09a-7a9daaaa593d',
  pilotId: '326b2c4e-baf5-4399-b4bf-ac31c2d6866c',
  pilotRequestId: '3185a2f6-7e3a-46de-b5c9-8ba530e5f333',
  adminUserId: 'c9095e1e-b718-4c09-842f-df48970125af',
  attestation:
    'I confirm that Ayesha Noor (SRO0009) is an authorized fictional clinic test record under operator control. I have verified the exact existing Patient, Auth identity, clinic ownership, original pilot, and quarantined handover state. I authorize one controlled test credential recovery without claiming physical Patient identity verification.',
} as const;

export const sro0009RecoveryEnabled = () =>
  process.env.SRO_ACCOUNT_SRO0009_RECOVERY === '1' && coordinatedPatientAccessRoutesEnabled();

export function requireSro0009Recovery(patientId?: string | null) {
  if (!sro0009RecoveryEnabled())
    throw new RecoveryForbiddenError('The one-time Patient recovery is not authorized.');
  if (patientId && patientId !== SRO0009_RECOVERY.patientId)
    throw new RecoveryForbiddenError('The one-time Patient recovery target does not match.');
}

export class RecoveryForbiddenError extends Error {
  readonly status = 403;
}
export class RecoveryExpiredError extends Error {
  readonly status = 409;
}
export class RecoveryUnavailableError extends Error {
  readonly status = 503;
}

export type RecoveryStatus = {
  recoveryId: string | null;
  state: string | null;
  reissueCount: number;
  accountState: string | null;
  pilotState: string | null;
  handoverExpiresAt: string | null;
  handoverExpired: boolean;
  canSetup: boolean;
  canReset: boolean;
  canHandover: boolean;
  serverNow: string;
};
export type HandoverWindow = {
  handoverExpiresAt: string | null;
  serverNow: string | null;
  handoverExpired: boolean;
};

async function recoveryRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await provisioningClient().rpc(name as never, args as never);
  if (r.error) {
    if (r.error.code === 'PGRST202')
      throw new RecoveryUnavailableError('Patient recovery is not installed.');
    if (/Handover expired/i.test(r.error.message ?? ''))
      throw new RecoveryExpiredError('Handover expired — account needs review.');
    if (
      r.error.code === '42501' ||
      /refused|denied|required|not available|mismatch|awaiting review/i.test(
        r.error.message ?? '',
      )
    )
      throw new RecoveryForbiddenError('Patient recovery was refused.');
    throw Error('Patient recovery request refused.');
  }
  return r.data as T;
}

export function recoveryStatus(actorId: string) {
  return recoveryRpc<RecoveryStatus>('patient_account_recovery_status', { p_actor: actorId });
}
export function recoverySetup(actorId: string, attestation: string) {
  return recoveryRpc<{
    recoveryId: string;
    state: string;
    patientCode: string;
    patientName: string;
    accountState: string;
    originalHandoverExpiresAt: string | null;
    serverNow: string;
  }>('patient_account_recovery_setup', {
    p_actor: actorId,
    p_attestation: attestation,
  });
}
function recoveryClaim(
  actorId: string,
  operationId: string,
  workerId: string,
  proof: string,
  requestId: string,
) {
  return recoveryRpc<{
    recoveryId: string;
    state: string;
    patientId: string;
    patientCode: string;
    operationId: string;
    fence: string;
  }>('patient_account_recovery_claim', {
    p_actor: actorId,
    p_operation: operationId,
    p_worker: workerId,
    p_proof: proof,
    p_request: requestId,
  });
}
function recoveryReset(
  actorId: string,
  operationId: string,
  workerId: string,
  proof: string,
  fence: string,
) {
  return recoveryRpc<AccessRecord>('patient_account_recovery_reset', {
    p_actor: actorId,
    p_operation: operationId,
    p_worker: workerId,
    p_proof: proof,
    p_fence: fence,
  });
}
function recoveryMarkHandover(actorId: string, operationId: string, proof: string) {
  return recoveryRpc<{
    recoveryId: string;
    state: string;
    handoverExpiresAt: string | null;
    serverNow: string;
  }>('patient_account_recovery_mark_handover', {
    p_actor: actorId,
    p_operation: operationId,
    p_proof: proof,
  });
}
export function recoveryHandover(actorId: string, operationId: string, nonce: string) {
  return recoveryRpc<{ recoveryId: string; state: string; handoverAt: string; serverNow: string }>(
    'patient_account_recovery_handover',
    { p_actor: actorId, p_operation: operationId, p_nonce: nonce },
  );
}
export function recoveryFirstChange(actorId: string, patientId: string) {
  return recoveryRpc<boolean>('patient_account_recovery_first_change', {
    p_actor: actorId,
    p_patient: patientId,
  });
}
export function recoveryQuarantine(actorId: string, operationId: string, reason: string) {
  return recoveryRpc<boolean>('patient_account_recovery_quarantine', {
    p_actor: actorId,
    p_operation: operationId,
    p_reason: reason.slice(0, 500),
  });
}

// Read-only display window. Missing on an environment without the Phase 4D SQL is not fatal.
export async function handoverWindow(
  actorId: string,
  patientId: string,
): Promise<HandoverWindow | null> {
  const r = await provisioningClient().rpc(
    'patient_account_handover_window' as never,
    { p_actor: actorId, p_patient: patientId } as never,
  );
  if (r.error) {
    if (r.error.code === 'PGRST202') return null;
    throw Error('Handover window is unavailable.');
  }
  const data = r.data as {
    handoverExpiresAt?: string | null;
    serverNow?: string | null;
    handoverExpired?: boolean;
  };
  return {
    handoverExpiresAt: data.handoverExpiresAt ?? null,
    serverNow: data.serverNow ?? null,
    handoverExpired: data.handoverExpired === true,
  };
}

export async function prepareRecoveryHandover(
  deps: AccessDependencies & { operation: CoordinationRpc },
  input: { actorId: string; operatorApproved: boolean },
) {
  requireSro0009Recovery(SRO0009_RECOVERY.patientId);
  if (!input.operatorApproved) throw new RecoveryForbiddenError('Operator approval is required.');
  let record: AccessRecord | undefined;
  let operationId = '';
  let proof = '';
  let nonce = '';
  let temporaryPassword: string;
  try {
    temporaryPassword = await coordinatedAccountWrite({
      purpose: 'reset',
      actorId: input.actorId,
      patientId: SRO0009_RECOVERY.patientId,
      requestId: randomUUID(),
      recoveryAuthorized: true,
      rpc: deps.operation,
      claim: async (base) => {
        operationId = base.operationId;
        proof = base.proof;
        const claimed = await recoveryClaim(
          input.actorId,
          base.operationId,
          base.workerId,
          base.proof,
          base.requestId,
        );
        if (
          claimed.patientId !== SRO0009_RECOVERY.patientId ||
          claimed.patientCode !== SRO0009_RECOVERY.patientCode ||
          claimed.operationId !== base.operationId ||
          typeof claimed.fence !== 'string'
        )
          throw Error('Recovery claim mismatch.');
        return {
          operationId: claimed.operationId,
          fence: claimed.fence,
          phase: 'claimed',
        };
      },
      prepare: async (binding) => {
        record = await recoveryReset(
          input.actorId,
          String(binding.operationId),
          String(binding.workerId),
          String(binding.proof),
          String(binding.fence),
        );
        if (
          record.patientId !== SRO0009_RECOVERY.patientId ||
          record.operationId !== binding.operationId ||
          record.userId !== SRO0009_RECOVERY.authUserId
        )
          throw Error('Recovery binding refused.');
      },
      provider: async () => {
        if (!record) throw Error('Recovery binding unavailable.');
        const password = randomBytes(32).toString('base64url') + 'Aa9!';
        nonce = randomBytes(32).toString('base64url');
        await deps.replacePassword(record.userId, password);
        return password;
      },
      commit: async (binding) => {
        await deps.command('commit', input.actorId, SRO0009_RECOVERY.patientId, {
          ...binding,
          handoverHash: handoverHash(nonce),
        });
      },
    });
  } catch (error) {
    if (operationId && proof)
      await recoveryQuarantine(
        input.actorId,
        operationId,
        'Recovery provider or commit failed',
      ).catch(() => undefined);
    throw error;
  }
  let window: HandoverWindow | null = null;
  let markerWarning = false;
  try {
    const marked = await recoveryMarkHandover(input.actorId, operationId, proof);
    window = {
      handoverExpiresAt: marked.handoverExpiresAt,
      serverNow: marked.serverNow,
      handoverExpired: false,
    };
  } catch {
    markerWarning = true;
    window = await handoverWindow(input.actorId, SRO0009_RECOVERY.patientId).catch(() => null);
  }
  return {
    patientId: record!.patientId,
    patientCode: record!.patientCode,
    name: record!.name,
    operationId,
    temporaryPassword,
    handoverNonce: nonce,
    handoverExpiresAt: window?.handoverExpiresAt ?? null,
    serverNow: window?.serverNow ?? null,
    recoveryMarkerWarning: markerWarning,
  };
}
