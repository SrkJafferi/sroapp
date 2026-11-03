import 'server-only';
import { PATIENT_ACCOUNT_ACCESS_ENABLED } from './patient-access-feature';
import { DISTRIBUTED_PATIENT_ACCESS_READY } from './patient-account-coordination';
// Prepared server orchestration: patient registration is its own existing atomic clinical command.
// The provider is NEVER called unless both reviewed server gates are enabled in a future release.
export async function registerWalkInWithAccount<
  T extends { id: string; patientCode: string },
>(deps: { register: () => Promise<T>; provision: (registered: T) => Promise<unknown> }) {
  const patient = await deps.register();
  if (!PATIENT_ACCOUNT_ACCESS_ENABLED || !DISTRIBUTED_PATIENT_ACCESS_READY)
    return { patient, account: 'disabled' as const };
  try {
    return { patient, account: 'handover' as const, handover: await deps.provision(patient) };
  } catch {
    return { patient, account: 'review-required' as const };
  }
}
