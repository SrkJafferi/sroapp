import type { AppointmentStatus, AppointmentType, PrescriptionItem, Vitals } from './index';
import type { Database } from './database';

export type DatabaseTables = Database['public']['Tables'];
export type DatabaseRow<T extends keyof DatabaseTables> = DatabaseTables[T]['Row'];
export type DatabaseFunctions = Database['public']['Functions'];
export type RpcArgs<T extends keyof DatabaseFunctions> = DatabaseFunctions[T]['Args'];
export type RpcResult<T extends keyof DatabaseFunctions> = DatabaseFunctions[T]['Returns'];

// Transport data only. These declarations contain no SDK, credentials or privileged code.
export type ClinicalNoteInput = {
  symptoms?: string;
  examination?: string;
  diagnosis: string;
  plan: string;
  followUp?: string;
  vitals?: Partial<Vitals>;
};
export type SaveEncounterArgs = Omit<RpcArgs<'save_encounter'>, 'p_notes' | 'p_items'> & {
  p_notes: ClinicalNoteInput;
  p_items?: PrescriptionItem[];
};
export type BookAppointmentArgs = RpcArgs<'book_appointment'>;
export type TransitionAppointmentArgs = RpcArgs<'transition_appointment'>;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
// Compile-time parity with existing UI entities; no mock interfaces were replaced.
export type AppointmentStatusParity = Assert<
  Equal<Database['public']['Enums']['appointment_status'], AppointmentStatus>
>;
export type AppointmentTypeParity = Assert<
  Equal<Database['public']['Enums']['appointment_type'], AppointmentType>
>;
