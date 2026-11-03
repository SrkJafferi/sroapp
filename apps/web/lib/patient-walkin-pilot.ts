import 'server-only';
import { provisioningClient } from './supabase/admin';

// Narrow one-time pilot gate. The database still owns the durable claim; this env
// only permits the server to consult it. Default OFF.
export const patientWalkInPilotEnabled = () => process.env.SRO_PILOT_WALKIN === '1';

export type PilotFields = {
  name: string;
  ageYears: number;
  gender: string;
  email: string;
  phone: string;
  bloodGroup: string;
  address: string;
};
export type PilotStatus = {
  pilotId: string;
  state: string;
  registrationRequestId: string;
  organizationId: string;
  branchId: string;
  expectedFields: PilotFields;
  patientCode: string | null;
  expiresAt: string;
};
export type PilotBegin =
  | { pilot: false }
  | { pilot: true; pilotId: string; state: string };

async function pilotRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await provisioningClient().rpc(name as never, args as never);
  if (r.error) {
    if (r.error.code === 'PGRST202')
      throw Object.assign(Error('Pilot authorization is not installed.'), { code: r.error.code });
    throw Object.assign(Error('Pilot authorization refused.'), { code: r.error.code });
  }
  return r.data as T;
}

export async function pilotStatus(actor: string): Promise<PilotStatus | null> {
  if (!patientWalkInPilotEnabled()) return null;
  try {
    return await pilotRpc<PilotStatus | null>('patient_pilot_status', { p_actor: actor });
  } catch {
    return null;
  }
}
export async function pilotBegin(
  actor: string,
  requestId: string,
  branchId: string,
  fields: PilotFields,
): Promise<PilotBegin> {
  if (!patientWalkInPilotEnabled()) return { pilot: false };
  try {
    return await pilotRpc<PilotBegin>('patient_pilot_begin', {
      p_actor: actor,
      p_request: requestId,
      p_branch: branchId,
      p_fields: fields,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'PGRST202') return { pilot: false };
    throw error;
  }
}
export async function pilotBind(
  pilotId: string,
  actor: string,
  patientId: string,
  patientCode: string,
) {
  return pilotRpc('patient_pilot_bind', {
    p_pilot: pilotId,
    p_actor: actor,
    p_patient: patientId,
    p_code: patientCode,
  });
}
export async function pilotAuthorizeProvision(actor: string, patientId: string) {
  return pilotRpc<{ pilotId: string; state: string }>('patient_pilot_authorize_provision', {
    p_actor: actor,
    p_patient: patientId,
  });
}
export async function pilotMarkProvisioned(pilotId: string, patientId: string) {
  return pilotRpc('patient_pilot_mark_provisioned', {
    p_pilot: pilotId,
    p_patient: patientId,
  });
}
export async function pilotAuthorizeHandover(actor: string, patientId: string) {
  return pilotRpc<{ pilotId: string; state: string }>('patient_pilot_authorize_handover', {
    p_actor: actor,
    p_patient: patientId,
  });
}
export async function pilotComplete(patientId: string) {
  return pilotRpc<boolean>('patient_pilot_complete', { p_patient: patientId });
}
export async function pilotQuarantine(pilotId: string, reason: string) {
  return pilotRpc('patient_pilot_quarantine', {
    p_pilot: pilotId,
    p_reason: reason.slice(0, 500),
  });
}
