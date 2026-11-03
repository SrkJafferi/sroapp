import 'server-only';
// Server-only cutover gate for staff-managed Patient account routes. Default OFF.
// Setting SRO_COORDINATED_PATIENT_ACCESS=1 enables only the coordinated staff/PATIENT routes;
// global automatic/walk-in provisioning remains governed by PATIENT_ACCOUNT_ACCESS_ENABLED
// and DISTRIBUTED_PATIENT_ACCESS_READY in patient-account-coordination.ts.
export function coordinatedPatientAccessRoutesEnabled() {
  return process.env.SRO_COORDINATED_PATIENT_ACCESS === '1';
}
export function requireCoordinatedPatientAccessRoutes() {
  if (!coordinatedPatientAccessRoutesEnabled())
    throw Error('Coordinated Patient account routes are not activated.');
}
// Independent mutation gate. Route/login/read activation must not enable mutations.
// Default OFF; no management action may reach SQL or Auth until this is separately approved.
export function coordinatedPatientMutationsEnabled() {
  return process.env.SRO_COORDINATED_PATIENT_MUTATIONS === '1';
}
export function requireCoordinatedPatientMutations() {
  if (!coordinatedPatientAccessRoutesEnabled() || !coordinatedPatientMutationsEnabled())
    throw Error('Coordinated Patient account mutations are not authorized.');
}
const MANAGEMENT_ACTIONS = ['provision', 'reset', 'handover', 'disable', 'enable'] as const;
export function coordinatedManagementMutation(action: string) {
  return (MANAGEMENT_ACTIONS as readonly string[]).includes(action);
}
export function coordinatedMutationAuthorized(action: string) {
  return (
    !coordinatedManagementMutation(action) ||
    (coordinatedPatientAccessRoutesEnabled() && coordinatedPatientMutationsEnabled())
  );
}
export type PatientAccountRole = 'admin' | 'doctor';
export type PatientAccountCapabilities = {
  role: PatientAccountRole | null;
  provision: boolean;
  reset: boolean;
  disable: boolean;
  enable: boolean;
  handover: boolean;
  autoProvision: boolean;
};
const flag = (name: string) => process.env[name] === '1';
export function patientAccountCapabilitiesFor(
  role: PatientAccountRole | null,
): PatientAccountCapabilities {
  const master = coordinatedPatientAccessRoutesEnabled() && coordinatedPatientMutationsEnabled();
  const adminProvision = master && flag('SRO_ACCOUNT_ADMIN_PROVISION');
  const doctorProvision = master && flag('SRO_ACCOUNT_DOCTOR_WALKIN_PROVISION');
  const provision =
    role === 'admin' ? adminProvision : role === 'doctor' ? doctorProvision : false;
  const manage = master && role === 'admin';
  const disable = manage && flag('SRO_ACCOUNT_DISABLE_ENABLE');
  return {
    role,
    provision,
    handover: provision,
    reset: manage && flag('SRO_ACCOUNT_PASSWORD_RESET'),
    disable,
    enable: disable,
    autoProvision: provision && flag('SRO_WALK_IN_AUTO_PROVISION'),
  };
}
