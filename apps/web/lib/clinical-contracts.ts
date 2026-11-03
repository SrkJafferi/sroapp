import type { ClinicState, UserProfile, DatabaseRow, WorkspaceDatabase } from '@sro/types';
export type ClinicalSnapshot = {
  state: ClinicState;
  actor: UserProfile;
  timezone: string;
  organizationId: string;
};
export type AvailableSlot = Pick<
  DatabaseRow<'appointment_slots'>,
  'id' | 'starts_at' | 'ends_at'
> & { time: string };
export const clinicalTables = [
  'organizations',
  'profiles',
  'role_assignments',
  'branches',
  'doctors',
  'specializations',
  'symptom_categories',
  'specialization_symptoms',
  'doctor_branch_assignments',
  'doctor_schedules',
  'schedule_breaks',
  'doctor_leave',
  'patients',
  'patient_medical_history',
  'appointments',
  'appointment_slots',
  'appointment_reservations',
  'clinical_access_grants',
  'clinical_encounters',
  'encounter_vitals',
  'prescriptions',
  'prescription_items',
  'medical_documents',
  'notifications',
  'notification_recipients',
  'audit_logs',
  'doctor_invitations',
  'consultation_charges',
] as const;
export type ClinicalTable = (typeof clinicalTables)[number];
export type ClinicalRows = {
  [K in ClinicalTable]: (K extends 'patients' | 'notifications'
    ? WorkspaceDatabase['public']['Tables'][K]['Row']
    : DatabaseRow<K>)[];
};
