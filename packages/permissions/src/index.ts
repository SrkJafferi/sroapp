import type { Appointment, ClinicState, UserProfile } from '@sro/types';
// UX demonstration only. Production must enforce these rules through Supabase RLS.
export function canViewPatient(actor: UserProfile, patientId: string, state: ClinicState): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role === 'patient') return actor.patientId === patientId;
  const intake = state.patientIntakes?.find(
    (i) => i.patientId === patientId && i.createdBy === actor.id,
  );
  if (actor.role === 'doctor' && intake) return intake.clinicalAccess === true;
  if (state.grants.some((g) => g.patientId === patientId && g.userId === actor.id)) return true;
  return (
    actor.role === 'doctor' &&
    state.appointments.some(
      (a) =>
        a.patientId === patientId &&
        a.doctorId === actor.doctorId &&
        !['rejected', 'cancelled'].includes(a.status),
    )
  );
}
export function canManageAppointment(actor: UserProfile, appointment: Appointment): boolean {
  return (
    actor.role === 'admin' || (actor.role === 'doctor' && actor.doctorId === appointment.doctorId)
  );
}
export function canDiscoverPatient(
  actor: UserProfile,
  patientId: string,
  state: ClinicState,
  branchId: string,
): boolean {
  return (
    canViewPatient(actor, patientId, state) ||
    (actor.role === 'doctor' &&
      actor.branchIds.includes(branchId) &&
      !!state.patientIntakes?.some(
        (i) =>
          i.patientId === patientId &&
          i.branchId === branchId &&
          i.createdBy === actor.id &&
          Date.parse(i.expiresAt) > Date.now(),
      ))
  );
}
export function canRequestChange(actor: UserProfile, appointment: Appointment): boolean {
  return (
    canManageAppointment(actor, appointment) ||
    (actor.role === 'patient' && actor.patientId === appointment.patientId)
  );
}
export function canWriteClinical(
  actor: UserProfile,
  patientId: string,
  state: ClinicState,
): boolean {
  return (
    (actor.role === 'doctor' || actor.role === 'clinical_staff') &&
    canViewPatient(actor, patientId, state)
  );
}
