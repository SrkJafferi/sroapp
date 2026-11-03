export type ID = string;
export type { AuthIdentity, WorkspaceMembership, WorkspaceRole } from './auth';
export type { WorkspaceAction, WorkspaceFunctions, WorkspaceDatabase } from './workspace-contracts';
export type { Database, Json } from './database';
export type {
  DatabaseRow,
  RpcArgs,
  RpcResult,
  ClinicalNoteInput,
  SaveEncounterArgs,
  BookAppointmentArgs,
  TransitionAppointmentArgs,
} from './database-contracts';
export type Role = 'admin' | 'doctor' | 'patient' | 'clinical_staff';
export type DemoRole = Exclude<Role, 'clinical_staff'>;
export interface Organization {
  id: ID;
  name: string;
  timezone: string;
  currency: 'PKR';
}
export interface Branch {
  timezone?: string;
  id: ID;
  organizationId: ID;
  name: string;
  address: string;
  phone: string;
  active: boolean;
}
export interface UserProfile {
  id: ID;
  role: Role;
  name: string;
  email: string;
  doctorId?: ID;
  patientId?: ID;
  branchIds: ID[];
  twoFactorEnabled: boolean;
}
export interface Specialization {
  id: ID;
  name: string;
  description: string;
  symptomCategories: string[];
}
export interface Doctor {
  id: ID;
  name: string;
  initials: string;
  gender: string;
  specializationId: ID;
  qualifications: string;
  experience: number;
  bio: string;
  email: string;
  color: string;
}
export interface DoctorBranchAssignment {
  doctorId: ID;
  branchId: ID;
  fee: number;
  slotMinutes: number;
  active: boolean;
}
export interface Schedule {
  id: ID;
  doctorId: ID;
  branchId: ID;
  days: number[];
  start: string;
  end: string;
  breaks: { start: string; end: string }[];
}
export interface Leave {
  id: ID;
  doctorId: ID;
  branchId: ID;
  startDate: string;
  endDate: string;
  reason: string;
}
export interface MedicalHistory {
  reviewState?: 'unknown' | 'reviewed';
  allergies: string[];
  conditions: string[];
  medications: string[];
  surgeries: string;
  familyHistory: string;
  socialHistory: string;
  bloodGroup: string;
  emergencyContact: string;
}
export interface Patient {
  id: ID;
  /** Database-generated readable ID. Optional while its additive migration awaits approval. */
  readonly patientCode?: string;
  /** Immutable database registration timestamp; optional for unknown historical evidence. */
  readonly registeredAt?: string;
  name: string;
  initials: string;
  /** Legacy birth date. Never used to derive the stored age. Empty for age-only records. */
  dateOfBirth: string;
  /** Manually recorded age in whole years. Never advanced or derived from dateOfBirth. */
  ageYears?: number;
  /** Date the age was last explicitly entered; traceability only. */
  ageRecordedOn?: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
  branchId: ID;
  history: MedicalHistory;
}
export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'reschedule_requested'
  | 'cancellation_requested'
  | 'cancelled'
  | 'checked_in'
  | 'in_consultation'
  | 'completed'
  | 'no_show'
  | 'doctor_unavailable';
export type AppointmentType = 'physical' | 'remote';
export interface Appointment {
  id: ID;
  branchId: ID;
  patientId: ID;
  doctorId: ID;
  date: string;
  time: string;
  duration: number;
  type: AppointmentType;
  status: AppointmentStatus;
  reason: string;
  fee: number;
  paymentStatus: 'unpaid' | 'paid' | 'waived';
  requestedSlot?: { date: string; time: string };
  requestReason?: string;
  source: 'patient' | 'walk_in' | 'follow_up';
}
export interface Vitals {
  bloodPressure: string;
  pulse: string;
  temperature: string;
  weight: string;
  oxygen: string;
  height: string;
}
export interface PrescriptionItem {
  medication: string;
  strength: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}
export interface Prescription {
  id: ID;
  patientId: ID;
  doctorId: ID;
  consultationId: ID;
  date: string;
  items: PrescriptionItem[];
  instructions: string;
}
export interface Consultation {
  id: ID;
  appointmentId: ID;
  patientId: ID;
  doctorId: ID;
  branchId: ID;
  date: string;
  /** Signing timestamp, or creation timestamp for an unsigned encounter. */
  readonly recordedAt?: string;
  symptoms: string;
  vitals: Vitals;
  examination: string;
  diagnosis: string;
  plan: string;
  followUp: string;
  status: 'draft' | 'signed';
}
export interface MedicalDocument {
  id: ID;
  patientId: ID;
  doctorId: ID;
  consultationId?: ID;
  kind: 'report' | 'handwritten';
  name: string;
  mimeType: string;
  size: number;
  date: string;
  demoOnly?: boolean;
}
export interface RecordGrant {
  patientId: ID;
  userId: ID;
  grantedBy: ID;
  reason: string;
}
export type NotificationKind =
  | 'request'
  | 'confirmation'
  | 'cancellation'
  | 'reminder'
  | 'reschedule'
  | 'leave'
  | 'consultation'
  | 'prescription'
  | 'invitation';
export interface ClinicNotification {
  id: ID;
  kind: NotificationKind;
  title: string;
  message: string;
  recipientIds: ID[];
  readBy: ID[];
  time: string;
  appointmentId?: ID;
  doctorId?: ID;
  branchId?: ID;
}
export interface AuditEntry {
  id: ID;
  actorId: ID;
  action: string;
  time: string;
}
export interface DoctorInvitation {
  createdAt?: string;
  sentAt?: string;
  expiresAt?: string;
  id: ID;
  name: string;
  email: string;
  specializationId: ID;
  branchId: ID;
  status: 'draft' | 'sent' | 'accepted' | 'expired' | 'revoked';
  token: string;
}
export interface ClinicState {
  /** Temporary staff demographic/booking scopes, never clinical-history assignments. */
  patientIntakes?: {
    patientId: ID;
    branchId: ID;
    createdBy: ID;
    expiresAt: string;
    bloodGroup: string | null;
    clinicalAccess: boolean;
  }[];
  organization: Organization;
  branches: Branch[];
  profiles: UserProfile[];
  doctors: Doctor[];
  specializations: Specialization[];
  patients: Patient[];
  assignments: DoctorBranchAssignment[];
  schedules: Schedule[];
  leaves: Leave[];
  appointments: Appointment[];
  consultations: Consultation[];
  prescriptions: Prescription[];
  documents: MedicalDocument[];
  grants: RecordGrant[];
  notifications: ClinicNotification[];
  audit: AuditEntry[];
  invitations: DoctorInvitation[];
}
export interface BookingInput {
  branchId: ID;
  patientId: ID;
  doctorId: ID;
  date: string;
  time: string;
  type: AppointmentType;
  reason: string;
  source?: Appointment['source'];
}
export interface ClinicRepository {
  getSnapshot(): ClinicState;
  subscribe(listener: () => void): () => void;
  book(actor: UserProfile, input: BookingInput): Appointment;
  transition(actor: UserProfile, id: ID, status: AppointmentStatus): void;
  requestReschedule(actor: UserProfile, id: ID, date: string, time: string, reason: string): void;
}
