import type {
  Appointment,
  AppointmentStatus,
  ClinicState,
  Doctor,
  UserProfile,
  Patient,
} from '@sro/types';
export function patientIdLabel(patient?: Pick<Patient, 'patientCode'>) {
  const code = patient?.patientCode;
  return code && /^SRO\d{4,}$/.test(code) && /[1-9]/.test(code.slice(3))
    ? `Patient ID # ${code}`
    : 'Patient ID not assigned';
}
export function matchesPatientSearch(
  patient: Pick<Patient, 'name' | 'phone' | 'patientCode'>,
  query: string,
) {
  return `${patient.name} ${patient.phone} ${patient.patientCode ?? ''} ${patientIdLabel(patient)}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
export const DEMO_DATE = '2026-10-26';
/** A directory-selected first intake is a walk-in, even when its UUID preselects the patient. */
export function appointmentRequestSource(
  actor: UserProfile,
  state: ClinicState,
  patientId: string,
  branchId: string,
  followUp: boolean,
): Appointment['source'] {
  if (actor.role === 'patient') return 'patient';
  const intake = state.patientIntakes?.find(
    (i) =>
      i.patientId === patientId &&
      i.branchId === branchId &&
      i.createdBy === actor.id &&
      Date.parse(i.expiresAt) > Date.now(),
  );
  if (
    intake &&
    (!intake.clinicalAccess || !state.appointments.some((a) => a.patientId === patientId))
  )
    return 'walk_in';
  return followUp ? 'follow_up' : 'walk_in';
}
export const statusLabels: Record<AppointmentStatus, string> = {
  pending: 'Pending approval',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  reschedule_requested: 'Reschedule requested',
  cancellation_requested: 'Cancellation requested',
  cancelled: 'Cancelled',
  checked_in: 'Checked in',
  in_consultation: 'In consultation',
  completed: 'Completed',
  no_show: 'No-show',
  doctor_unavailable: 'Doctor unavailable',
};
export const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ['confirmed', 'rejected', 'cancellation_requested', 'doctor_unavailable'],
  confirmed: [
    'checked_in',
    'in_consultation',
    'reschedule_requested',
    'cancellation_requested',
    'no_show',
    'doctor_unavailable',
  ],
  checked_in: ['in_consultation', 'doctor_unavailable'],
  in_consultation: ['completed'],
  reschedule_requested: ['confirmed', 'cancellation_requested', 'doctor_unavailable'],
  cancellation_requested: ['cancelled', 'confirmed', 'doctor_unavailable'],
  doctor_unavailable: ['reschedule_requested', 'cancellation_requested', 'cancelled'],
  rejected: [],
  cancelled: [],
  completed: [],
  no_show: [],
};
export const activeStatuses: AppointmentStatus[] = [
  'pending',
  'confirmed',
  'reschedule_requested',
  'cancellation_requested',
  'checked_in',
  'in_consultation',
];
export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const toTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
export const displayTime = (time: string) =>
  `${Number(time.slice(0, 2)) % 12 || 12}:${time.slice(3)} ${Number(time.slice(0, 2)) >= 12 ? 'PM' : 'AM'}`;
export const displayDate = (date: string) =>
  new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
export const money = (value: number) =>
  value === 0
    ? 'Free Consultation'
    : `Rs. ${value.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
export function age(dateOfBirth: string) {
  const d = new Date(DEMO_DATE);
  const b = new Date(dateOfBirth);
  return (
    d.getFullYear() -
    b.getFullYear() -
    (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())
      ? 1
      : 0)
  );
}
export const bloodGroupOptions = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''] as const;
export const bloodGroupOptionLabel = (value: string) => value || 'Unknown / Not Tested';
export const bloodGroupLabel = (value?: string | null) => value?.trim() || 'Not recorded';
type AgePatient = {
  ageYears?: number | null;
};
export function patientAge(patient: AgePatient) {
  return typeof patient.ageYears === 'number' ? patient.ageYears : null;
}
export function patientAgeLabel(patient: AgePatient, fallback = 'Not recorded') {
  return ageYearsLabel(patientAge(patient), fallback);
}
export function ageYearsLabel(years: number | null, fallback = 'Not recorded') {
  return years === null ? fallback : `${years} ${years === 1 ? 'year' : 'years'}`;
}
export function getActor(state: ClinicState, role: 'admin' | 'doctor' | 'patient'): UserProfile {
  return state.profiles.find((p) => p.role === role)!;
}
export function appointmentsFor(state: ClinicState, actor: UserProfile): Appointment[] {
  return state.appointments.filter(
    (a) =>
      actor.role === 'admin' ||
      (actor.role === 'doctor' && a.doctorId === actor.doctorId) ||
      (actor.role === 'patient' && a.patientId === actor.patientId),
  );
}
export function availableSlots(
  state: ClinicState,
  doctorId: string,
  branchId: string,
  date: string,
  excludeId?: string,
): string[] {
  if (date < DEMO_DATE || !state.branches.some((b) => b.id === branchId && b.active)) return [];
  const assignment = state.assignments.find(
    (a) => a.doctorId === doctorId && a.branchId === branchId && a.active,
  );
  if (
    !assignment ||
    state.leaves.some((l) => l.doctorId === doctorId && date >= l.startDate && date <= l.endDate)
  )
    return [];
  const day = new Date(date + 'T12:00:00').getDay();
  const schedules = state.schedules.filter(
    (s) => s.doctorId === doctorId && s.branchId === branchId && s.days.includes(day),
  );
  const appointments = state.appointments.filter(
    (a) => a.id !== excludeId && a.doctorId === doctorId && activeStatuses.includes(a.status),
  );
  const occupied = (start: number, end: number, a: Appointment) => {
    const current =
      a.date === date && start < minutes(a.time) + a.duration && end > minutes(a.time);
    const requested =
      a.requestedSlot?.date === date &&
      start < minutes(a.requestedSlot.time) + a.duration &&
      end > minutes(a.requestedSlot.time);
    return current || requested;
  };
  const result = new Set<string>();
  for (const s of schedules)
    for (
      let t = minutes(s.start);
      t + assignment.slotMinutes <= minutes(s.end);
      t += assignment.slotMinutes
    ) {
      const end = t + assignment.slotMinutes;
      if (
        !s.breaks.some((b) => t < minutes(b.end) && end > minutes(b.start)) &&
        !appointments.some((a) => occupied(t, end, a))
      )
        result.add(toTime(t));
    }
  return [...result].sort();
}
export function suggestedDoctors(state: ClinicState, category: string, branchId: string): Doctor[] {
  const specialties = state.specializations
    .filter(
      (s) =>
        category === 'All departments' ||
        s.name === category ||
        s.symptomCategories.includes(category),
    )
    .map((s) => s.id);
  return state.doctors.filter(
    (d) =>
      specialties.includes(d.specializationId) &&
      state.assignments.some((a) => a.doctorId === d.id && a.branchId === branchId && a.active),
  );
}
