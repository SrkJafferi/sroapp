import type { Database, Json } from './database';
// Additive command contract. Remote availability is governed by the reviewed migration manifest.
export type WorkspaceAction =
  | 'branch'
  | 'organization'
  | 'profile'
  | 'department'
  | 'department_update'
  | 'doctor'
  | 'assignment'
  | 'fee'
  | 'schedule'
  | 'revoke_invitation';
export type WorkspaceFunctions = {
  register_walk_in_patient: {
    Args: { p_branch_id: string; p_request_id: string; p_fields: Json };
    Returns: Json;
  };
  staff_patient_intakes: { Args: { p_organization_id: string }; Returns: Json };
  get_clinic_profile: {
    Args: { p_organization_id: string; p_kind: string; p_target_id: string };
    Returns: Json;
  };
  save_clinic_profile: {
    Args: {
      p_organization_id: string;
      p_kind: string;
      p_target_id: string;
      p_fields: Json;
      p_photo: string;
      p_upload_id: string | null;
    };
    Returns: Json;
  };
  begin_profile_avatar: {
    Args: {
      p_organization_id: string;
      p_kind: string;
      p_target_id: string;
      p_request_id: string;
      p_size: number;
    };
    Returns: Json;
  };
  attest_profile_avatar: {
    Args: {
      p_upload_id: string;
      p_author_id: string;
      p_object_id: string;
      p_version: string;
      p_sha256: string;
    };
    Returns: null;
  };
  discard_profile_avatar: { Args: { p_upload_id: string }; Returns: string };
  get_profile_assets: { Args: { p_organization_id: string }; Returns: Json };
  get_profile_avatar_object: { Args: { p_avatar_id: string }; Returns: string | null };
  begin_medical_document_upload: {
    Args: {
      p_patient_id: string;
      p_branch_id: string;
      p_request_id: string;
      p_kind: string;
      p_name: string;
      p_mime_type: string;
      p_size_bytes: number;
    };
    Returns: Json;
  };
  complete_medical_document_upload: { Args: { p_upload_id: string }; Returns: string };
  abandon_medical_document_upload: { Args: { p_upload_id: string }; Returns: null };
  attest_medical_document_upload: {
    Args: {
      p_upload_id: string;
      p_author_id: string;
      p_object_id: string;
      p_object_version: string;
      p_sha256: string;
    };
    Returns: null;
  };
  manage_clinic: {
    Args: { p_branch_id: string; p_action: WorkspaceAction; p_data: Json };
    Returns: string;
  };
  publish_appointment_slots: {
    Args: { p_branch_id: string; p_doctor_id: string; p_from: string; p_until: string };
    Returns: number;
  };
  save_patient_history: {
    Args: { p_patient_id: string; p_branch_id: string; p_history: Json };
    Returns: null;
  };
};
type BasePatientTable = Database['public']['Tables']['patients'];
type AgeAwarePatientRow = Omit<BasePatientTable['Row'], 'date_of_birth'> & {
  date_of_birth: string | null;
  readonly age_years?: number | null;
  readonly age_recorded_on?: string | null;
  readonly registered_at?: string | null;
};
type AgeAwarePatientInsert = Omit<BasePatientTable['Insert'], 'date_of_birth'> & {
  date_of_birth?: string | null;
  age_years?: number | null;
  age_recorded_on?: string | null;
  registered_at?: never;
};
type AgeAwarePatientUpdate = Omit<BasePatientTable['Update'], 'date_of_birth'> & {
  date_of_birth?: string | null;
  age_years?: number | null;
  age_recorded_on?: string | null;
  registered_at?: never;
};
type NumberedPatientTable = Omit<BasePatientTable, 'Row' | 'Insert' | 'Update'> & {
  Row: AgeAwarePatientRow & { readonly patient_number?: number; readonly patient_code?: string };
  Insert: AgeAwarePatientInsert & { patient_number?: never; patient_code?: never };
  Update: AgeAwarePatientUpdate & { patient_number?: never; patient_code?: never };
};
export type WorkspaceDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions' | 'Tables'> & {
    Tables: Omit<Database['public']['Tables'], 'patients' | 'notifications'> & {
      patients: NumberedPatientTable;
      notifications: Omit<Database['public']['Tables']['notifications'], 'Row'> & {
        Row: Database['public']['Tables']['notifications']['Row'] & {
          readonly doctor_id?: string | null;
          readonly branch_id?: string | null;
        };
      };
    };
    Functions: Database['public']['Functions'] & WorkspaceFunctions;
  };
};
