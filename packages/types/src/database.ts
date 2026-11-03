// Generated from the APPROVAL-PENDING local migrations. Not a remote schema snapshot.
// Regenerate: pnpm db:types. Do not hand-edit. No private schema or credential types exported.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Tables: {
      appointment_reservations: {
        Row: {
          organization_id: string;
          appointment_id: string;
          kind: string;
          slot_id: string;
          doctor_id: string;
          branch_id: string;
          clinician_user_id: string;
          patient_id: string;
          starts_at: string;
          ends_at: string;
          period: string | null;
          active: boolean;
          request_reason: string | null;
        };
        Insert: {
          organization_id: string;
          appointment_id: string;
          kind: string;
          slot_id: string;
          doctor_id: string;
          branch_id: string;
          clinician_user_id: string;
          patient_id: string;
          starts_at: string;
          ends_at: string;
          period?: never;
          active?: boolean;
          request_reason?: string | null;
        };
        Update: {
          organization_id?: string;
          appointment_id?: string;
          kind?: string;
          slot_id?: string;
          doctor_id?: string;
          branch_id?: string;
          clinician_user_id?: string;
          patient_id?: string;
          starts_at?: string;
          ends_at?: string;
          period?: never;
          active?: boolean;
          request_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'appointment_reservations_organization_id_appointment_id_pa_fkey';
            columns: ['organization_id', 'appointment_id', 'patient_id', 'doctor_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'appointments';
            referencedColumns: ['organization_id', 'id', 'patient_id', 'doctor_id', 'branch_id'];
          },
          {
            foreignKeyName: 'appointment_reservations_organization_id_doctor_id_clinici_fkey';
            columns: ['organization_id', 'doctor_id', 'clinician_user_id'];
            isOneToOne: false;
            referencedRelation: 'doctors';
            referencedColumns: ['organization_id', 'id', 'user_id'];
          },
          {
            foreignKeyName: 'appointment_reservations_organization_id_slot_id_doctor_id_fkey';
            columns: ['organization_id', 'slot_id', 'doctor_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'appointment_slots';
            referencedColumns: ['organization_id', 'id', 'doctor_id', 'branch_id'];
          },
        ];
      };
      appointment_slots: {
        Row: {
          id: string;
          organization_id: string;
          doctor_id: string;
          branch_id: string;
          starts_at: string;
          ends_at: string;
          open: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          doctor_id: string;
          branch_id: string;
          starts_at: string;
          ends_at: string;
          open?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          doctor_id?: string;
          branch_id?: string;
          starts_at?: string;
          ends_at?: string;
          open?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'appointment_slots_organization_id_doctor_id_branch_id_fkey';
            columns: ['organization_id', 'doctor_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'doctor_branch_assignments';
            referencedColumns: ['organization_id', 'doctor_id', 'branch_id'];
          },
        ];
      };
      appointment_status_history: {
        Row: {
          id: string;
          organization_id: string;
          appointment_id: string;
          old_status: Database['public']['Enums']['appointment_status'] | null;
          new_status: Database['public']['Enums']['appointment_status'];
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          appointment_id: string;
          old_status?: Database['public']['Enums']['appointment_status'] | null;
          new_status: Database['public']['Enums']['appointment_status'];
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          appointment_id?: string;
          old_status?: Database['public']['Enums']['appointment_status'] | null;
          new_status?: Database['public']['Enums']['appointment_status'];
          actor_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'appointment_status_history_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointment_status_history_organization_id_appointment_id_fkey';
            columns: ['organization_id', 'appointment_id'];
            isOneToOne: false;
            referencedRelation: 'appointments';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      appointments: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string;
          patient_id: string;
          doctor_id: string;
          clinician_user_id: string;
          current_slot_id: string;
          type: Database['public']['Enums']['appointment_type'];
          status: Database['public']['Enums']['appointment_status'];
          reason: string;
          source: Database['public']['Enums']['appointment_source'];
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id: string;
          patient_id: string;
          doctor_id: string;
          clinician_user_id: string;
          current_slot_id: string;
          type?: Database['public']['Enums']['appointment_type'];
          status?: Database['public']['Enums']['appointment_status'];
          reason: string;
          source?: Database['public']['Enums']['appointment_source'];
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string;
          patient_id?: string;
          doctor_id?: string;
          clinician_user_id?: string;
          current_slot_id?: string;
          type?: Database['public']['Enums']['appointment_type'];
          status?: Database['public']['Enums']['appointment_status'];
          reason?: string;
          source?: Database['public']['Enums']['appointment_source'];
          created_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'appointments_organization_id_created_by_fkey';
            columns: ['organization_id', 'created_by'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'appointments_organization_id_current_slot_id_doctor_id_bra_fkey';
            columns: ['organization_id', 'current_slot_id', 'doctor_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'appointment_slots';
            referencedColumns: ['organization_id', 'id', 'doctor_id', 'branch_id'];
          },
          {
            foreignKeyName: 'appointments_organization_id_doctor_id_clinician_user_id_fkey';
            columns: ['organization_id', 'doctor_id', 'clinician_user_id'];
            isOneToOne: false;
            referencedRelation: 'doctors';
            referencedColumns: ['organization_id', 'id', 'user_id'];
          },
          {
            foreignKeyName: 'appointments_organization_id_patient_id_branch_id_fkey';
            columns: ['organization_id', 'patient_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'patient_branches';
            referencedColumns: ['organization_id', 'patient_id', 'branch_id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id?: string | null;
          actor_id?: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          occurred_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string | null;
          actor_id?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string;
          occurred_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_branch_id_fkey';
            columns: ['organization_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      branch_memberships: {
        Row: { organization_id: string; branch_id: string; user_id: string; active: boolean };
        Insert: { organization_id: string; branch_id: string; user_id: string; active?: boolean };
        Update: {
          organization_id?: string;
          branch_id?: string;
          user_id?: string;
          active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'branch_memberships_organization_id_branch_id_fkey';
            columns: ['organization_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'branch_memberships_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      branches: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          address: string;
          phone: string;
          timezone: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          address?: string;
          phone?: string;
          timezone?: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          address?: string;
          phone?: string;
          timezone?: string;
          active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'branches_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      clinical_access_grants: {
        Row: {
          id: string;
          organization_id: string;
          patient_id: string;
          branch_id: string;
          user_id: string;
          granted_by: string;
          can_write: boolean;
          reason: string;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          patient_id: string;
          branch_id: string;
          user_id: string;
          granted_by: string;
          can_write?: boolean;
          reason: string;
          expires_at: string;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          patient_id?: string;
          branch_id?: string;
          user_id?: string;
          granted_by?: string;
          can_write?: boolean;
          reason?: string;
          expires_at?: string;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'clinical_access_grants_organization_id_branch_id_user_id_fkey';
            columns: ['organization_id', 'branch_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'branch_memberships';
            referencedColumns: ['organization_id', 'branch_id', 'user_id'];
          },
          {
            foreignKeyName: 'clinical_access_grants_organization_id_granted_by_fkey';
            columns: ['organization_id', 'granted_by'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'clinical_access_grants_organization_id_patient_id_branch_i_fkey';
            columns: ['organization_id', 'patient_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'patient_branches';
            referencedColumns: ['organization_id', 'patient_id', 'branch_id'];
          },
        ];
      };
      clinical_encounters: {
        Row: {
          id: string;
          organization_id: string;
          appointment_id: string;
          patient_id: string;
          doctor_id: string;
          branch_id: string;
          author_id: string;
          symptoms: string;
          examination: string;
          diagnosis: string;
          plan: string;
          follow_up: string;
          status: Database['public']['Enums']['encounter_status'];
          signed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          appointment_id: string;
          patient_id: string;
          doctor_id: string;
          branch_id: string;
          author_id: string;
          symptoms?: string;
          examination?: string;
          diagnosis?: string;
          plan?: string;
          follow_up?: string;
          status?: Database['public']['Enums']['encounter_status'];
          signed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          appointment_id?: string;
          patient_id?: string;
          doctor_id?: string;
          branch_id?: string;
          author_id?: string;
          symptoms?: string;
          examination?: string;
          diagnosis?: string;
          plan?: string;
          follow_up?: string;
          status?: Database['public']['Enums']['encounter_status'];
          signed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'clinical_encounters_organization_id_appointment_id_patient_fkey';
            columns: ['organization_id', 'appointment_id', 'patient_id', 'doctor_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'appointments';
            referencedColumns: ['organization_id', 'id', 'patient_id', 'doctor_id', 'branch_id'];
          },
          {
            foreignKeyName: 'clinical_encounters_organization_id_doctor_id_author_id_fkey';
            columns: ['organization_id', 'doctor_id', 'author_id'];
            isOneToOne: false;
            referencedRelation: 'doctors';
            referencedColumns: ['organization_id', 'id', 'user_id'];
          },
        ];
      };
      consultation_charges: {
        Row: {
          organization_id: string;
          appointment_id: string;
          amount_paisa: number;
          currency: string;
          payment_status: Database['public']['Enums']['payment_status'];
        };
        Insert: {
          organization_id: string;
          appointment_id: string;
          amount_paisa: number;
          currency?: string;
          payment_status: Database['public']['Enums']['payment_status'];
        };
        Update: {
          organization_id?: string;
          appointment_id?: string;
          amount_paisa?: number;
          currency?: string;
          payment_status?: Database['public']['Enums']['payment_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'consultation_charges_organization_id_appointment_id_fkey';
            columns: ['organization_id', 'appointment_id'];
            isOneToOne: true;
            referencedRelation: 'appointments';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      doctor_branch_assignments: {
        Row: {
          organization_id: string;
          doctor_id: string;
          branch_id: string;
          fee_paisa: number;
          slot_minutes: number;
          active: boolean;
        };
        Insert: {
          organization_id: string;
          doctor_id: string;
          branch_id: string;
          fee_paisa?: number;
          slot_minutes?: number;
          active?: boolean;
        };
        Update: {
          organization_id?: string;
          doctor_id?: string;
          branch_id?: string;
          fee_paisa?: number;
          slot_minutes?: number;
          active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'doctor_branch_assignments_organization_id_branch_id_fkey';
            columns: ['organization_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'doctor_branch_assignments_organization_id_doctor_id_fkey';
            columns: ['organization_id', 'doctor_id'];
            isOneToOne: false;
            referencedRelation: 'doctors';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      doctor_invitations: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string;
          specialization_id: string;
          name: string;
          email: string;
          status: Database['public']['Enums']['invitation_status'];
          invited_by: string;
          accepted_user_id: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id: string;
          specialization_id: string;
          name: string;
          email: string;
          status?: Database['public']['Enums']['invitation_status'];
          invited_by: string;
          accepted_user_id?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string;
          specialization_id?: string;
          name?: string;
          email?: string;
          status?: Database['public']['Enums']['invitation_status'];
          invited_by?: string;
          accepted_user_id?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'doctor_invitations_organization_id_accepted_user_id_fkey';
            columns: ['organization_id', 'accepted_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'doctor_invitations_organization_id_branch_id_fkey';
            columns: ['organization_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'doctor_invitations_organization_id_invited_by_fkey';
            columns: ['organization_id', 'invited_by'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'doctor_invitations_organization_id_specialization_id_fkey';
            columns: ['organization_id', 'specialization_id'];
            isOneToOne: false;
            referencedRelation: 'specializations';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      doctor_leave: {
        Row: {
          id: string;
          organization_id: string;
          doctor_id: string;
          starts_at: string;
          ends_at: string;
          period: string | null;
          reason: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          doctor_id: string;
          starts_at: string;
          ends_at: string;
          period?: never;
          reason: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          doctor_id?: string;
          starts_at?: string;
          ends_at?: string;
          period?: never;
          reason?: string;
          active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'doctor_leave_organization_id_doctor_id_fkey';
            columns: ['organization_id', 'doctor_id'];
            isOneToOne: false;
            referencedRelation: 'doctors';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      doctor_schedules: {
        Row: {
          id: string;
          organization_id: string;
          doctor_id: string;
          branch_id: string;
          weekday: number;
          starts_at: string;
          ends_at: string;
          valid_from: string;
          valid_until: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          doctor_id: string;
          branch_id: string;
          weekday: number;
          starts_at: string;
          ends_at: string;
          valid_from: string;
          valid_until?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          doctor_id?: string;
          branch_id?: string;
          weekday?: number;
          starts_at?: string;
          ends_at?: string;
          valid_from?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'doctor_schedules_organization_id_doctor_id_branch_id_fkey';
            columns: ['organization_id', 'doctor_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'doctor_branch_assignments';
            referencedColumns: ['organization_id', 'doctor_id', 'branch_id'];
          },
        ];
      };
      doctors: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string | null;
          specialization_id: string;
          name: string;
          initials: string;
          gender: string;
          qualifications: string;
          experience: number;
          bio: string;
          color: string;
          public_email: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id?: string | null;
          specialization_id: string;
          name: string;
          initials?: string;
          gender?: string;
          qualifications?: string;
          experience?: number;
          bio?: string;
          color?: string;
          public_email?: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string | null;
          specialization_id?: string;
          name?: string;
          initials?: string;
          gender?: string;
          qualifications?: string;
          experience?: number;
          bio?: string;
          color?: string;
          public_email?: string;
          active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'doctors_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'doctors_organization_id_specialization_id_fkey';
            columns: ['organization_id', 'specialization_id'];
            isOneToOne: false;
            referencedRelation: 'specializations';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'doctors_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: true;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      encounter_vitals: {
        Row: {
          organization_id: string;
          encounter_id: string;
          blood_pressure: string;
          pulse: string;
          temperature: string;
          oxygen: string;
          weight: string;
          height: string;
        };
        Insert: {
          organization_id: string;
          encounter_id: string;
          blood_pressure?: string;
          pulse?: string;
          temperature?: string;
          oxygen?: string;
          weight?: string;
          height?: string;
        };
        Update: {
          organization_id?: string;
          encounter_id?: string;
          blood_pressure?: string;
          pulse?: string;
          temperature?: string;
          oxygen?: string;
          weight?: string;
          height?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'encounter_vitals_organization_id_encounter_id_fkey';
            columns: ['organization_id', 'encounter_id'];
            isOneToOne: true;
            referencedRelation: 'clinical_encounters';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      medical_documents: {
        Row: {
          id: string;
          organization_id: string;
          patient_id: string;
          branch_id: string;
          encounter_id: string | null;
          author_id: string;
          kind: string;
          name: string;
          mime_type: string;
          size_bytes: number;
          storage_object_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          patient_id: string;
          branch_id: string;
          encounter_id?: string | null;
          author_id: string;
          kind: string;
          name: string;
          mime_type: string;
          size_bytes: number;
          storage_object_key?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          patient_id?: string;
          branch_id?: string;
          encounter_id?: string | null;
          author_id?: string;
          kind?: string;
          name?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_object_key?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'medical_documents_organization_id_author_id_fkey';
            columns: ['organization_id', 'author_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'medical_documents_organization_id_encounter_id_patient_id__fkey';
            columns: ['organization_id', 'encounter_id', 'patient_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'clinical_encounters';
            referencedColumns: ['organization_id', 'id', 'patient_id', 'branch_id'];
          },
          {
            foreignKeyName: 'medical_documents_organization_id_patient_id_branch_id_fkey';
            columns: ['organization_id', 'patient_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'patient_branches';
            referencedColumns: ['organization_id', 'patient_id', 'branch_id'];
          },
        ];
      };
      notification_recipients: {
        Row: {
          organization_id: string;
          notification_id: string;
          user_id: string;
          read_at: string | null;
        };
        Insert: {
          organization_id: string;
          notification_id: string;
          user_id: string;
          read_at?: string | null;
        };
        Update: {
          organization_id?: string;
          notification_id?: string;
          user_id?: string;
          read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_recipients_organization_id_notification_id_fkey';
            columns: ['organization_id', 'notification_id'];
            isOneToOne: false;
            referencedRelation: 'notifications';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'notification_recipients_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          organization_id: string;
          appointment_id: string | null;
          kind: string;
          title: string;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          appointment_id?: string | null;
          kind: string;
          title: string;
          message: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          appointment_id?: string | null;
          kind?: string;
          title?: string;
          message?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_organization_id_appointment_id_fkey';
            columns: ['organization_id', 'appointment_id'];
            isOneToOne: false;
            referencedRelation: 'appointments';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'notifications_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_memberships: {
        Row: { organization_id: string; user_id: string; active: boolean };
        Insert: { organization_id: string; user_id: string; active?: boolean };
        Update: { organization_id?: string; user_id?: string; active?: boolean };
        Relationships: [
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          currency: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string;
          currency?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string;
          currency?: string;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      patient_assignments: {
        Row: {
          id: string;
          organization_id: string;
          patient_id: string;
          doctor_id: string;
          branch_id: string;
          appointment_id: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          patient_id: string;
          doctor_id: string;
          branch_id: string;
          appointment_id: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          patient_id?: string;
          doctor_id?: string;
          branch_id?: string;
          appointment_id?: string;
          active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'patient_assignments_organization_id_appointment_id_patient_fkey';
            columns: ['organization_id', 'appointment_id', 'patient_id', 'doctor_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'appointments';
            referencedColumns: ['organization_id', 'id', 'patient_id', 'doctor_id', 'branch_id'];
          },
        ];
      };
      patient_branches: {
        Row: { organization_id: string; patient_id: string; branch_id: string };
        Insert: { organization_id: string; patient_id: string; branch_id: string };
        Update: { organization_id?: string; patient_id?: string; branch_id?: string };
        Relationships: [
          {
            foreignKeyName: 'patient_branches_organization_id_branch_id_fkey';
            columns: ['organization_id', 'branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'patient_branches_organization_id_patient_id_fkey';
            columns: ['organization_id', 'patient_id'];
            isOneToOne: false;
            referencedRelation: 'patients';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      patient_medical_history: {
        Row: {
          organization_id: string;
          patient_id: string;
          allergies: string[] | null;
          conditions: string[] | null;
          medications: string[] | null;
          surgeries: string | null;
          family_history: string | null;
          social_history: string | null;
          blood_group: string | null;
          emergency_contact: string | null;
          review_state: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          patient_id: string;
          allergies?: string[] | null;
          conditions?: string[] | null;
          medications?: string[] | null;
          surgeries?: string | null;
          family_history?: string | null;
          social_history?: string | null;
          blood_group?: string | null;
          emergency_contact?: string | null;
          review_state?: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          patient_id?: string;
          allergies?: string[] | null;
          conditions?: string[] | null;
          medications?: string[] | null;
          surgeries?: string | null;
          family_history?: string | null;
          social_history?: string | null;
          blood_group?: string | null;
          emergency_contact?: string | null;
          review_state?: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'patient_medical_history_organization_id_patient_id_fkey';
            columns: ['organization_id', 'patient_id'];
            isOneToOne: true;
            referencedRelation: 'patients';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'patient_medical_history_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      patients: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string | null;
          home_branch_id: string;
          name: string;
          initials: string;
          date_of_birth: string;
          gender: string;
          phone: string;
          email: string;
          address: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id?: string | null;
          home_branch_id: string;
          name: string;
          initials?: string;
          date_of_birth: string;
          gender: string;
          phone?: string;
          email?: string;
          address?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string | null;
          home_branch_id?: string;
          name?: string;
          initials?: string;
          date_of_birth?: string;
          gender?: string;
          phone?: string;
          email?: string;
          address?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'patients_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'patients_organization_id_home_branch_id_fkey';
            columns: ['organization_id', 'home_branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'patients_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: true;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      payment_records: {
        Row: {
          id: string;
          organization_id: string;
          appointment_id: string;
          amount_paisa: number;
          method: string;
          recorded_by: string;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          appointment_id: string;
          amount_paisa: number;
          method?: string;
          recorded_by: string;
          recorded_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          appointment_id?: string;
          amount_paisa?: number;
          method?: string;
          recorded_by?: string;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_records_organization_id_appointment_id_fkey';
            columns: ['organization_id', 'appointment_id'];
            isOneToOne: false;
            referencedRelation: 'consultation_charges';
            referencedColumns: ['organization_id', 'appointment_id'];
          },
          {
            foreignKeyName: 'payment_records_organization_id_recorded_by_fkey';
            columns: ['organization_id', 'recorded_by'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      prescription_items: {
        Row: {
          id: string;
          organization_id: string;
          prescription_id: string;
          line_number: number;
          medication: string;
          strength: string;
          dosage: string;
          frequency: string;
          duration: string;
          instructions: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          prescription_id: string;
          line_number: number;
          medication: string;
          strength: string;
          dosage: string;
          frequency: string;
          duration: string;
          instructions: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          prescription_id?: string;
          line_number?: number;
          medication?: string;
          strength?: string;
          dosage?: string;
          frequency?: string;
          duration?: string;
          instructions?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prescription_items_organization_id_prescription_id_fkey';
            columns: ['organization_id', 'prescription_id'];
            isOneToOne: false;
            referencedRelation: 'prescriptions';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      prescriptions: {
        Row: {
          id: string;
          organization_id: string;
          encounter_id: string;
          instructions: string;
          issued_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          encounter_id: string;
          instructions?: string;
          issued_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          encounter_id?: string;
          instructions?: string;
          issued_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'prescriptions_organization_id_encounter_id_fkey';
            columns: ['organization_id', 'encounter_id'];
            isOneToOne: true;
            referencedRelation: 'clinical_encounters';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      profiles: {
        Row: { id: string; name: string; email: string; active: boolean; created_at: string };
        Insert: { id: string; name: string; email: string; active?: boolean; created_at?: string };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      role_assignments: {
        Row: {
          organization_id: string;
          user_id: string;
          role: Database['public']['Enums']['clinic_role'];
        };
        Insert: {
          organization_id: string;
          user_id: string;
          role: Database['public']['Enums']['clinic_role'];
        };
        Update: {
          organization_id?: string;
          user_id?: string;
          role?: Database['public']['Enums']['clinic_role'];
        };
        Relationships: [
          {
            foreignKeyName: 'role_assignments_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      schedule_breaks: {
        Row: {
          id: string;
          organization_id: string;
          schedule_id: string;
          starts_at: string;
          ends_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          schedule_id: string;
          starts_at: string;
          ends_at: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          schedule_id?: string;
          starts_at?: string;
          ends_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'schedule_breaks_organization_id_schedule_id_fkey';
            columns: ['organization_id', 'schedule_id'];
            isOneToOne: false;
            referencedRelation: 'doctor_schedules';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      specialization_symptoms: {
        Row: { organization_id: string; specialization_id: string; symptom_category_id: string };
        Insert: { organization_id: string; specialization_id: string; symptom_category_id: string };
        Update: {
          organization_id?: string;
          specialization_id?: string;
          symptom_category_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'specialization_symptoms_organization_id_specialization_id_fkey';
            columns: ['organization_id', 'specialization_id'];
            isOneToOne: false;
            referencedRelation: 'specializations';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'specialization_symptoms_organization_id_symptom_category_i_fkey';
            columns: ['organization_id', 'symptom_category_id'];
            isOneToOne: false;
            referencedRelation: 'symptom_categories';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      specializations: {
        Row: { id: string; organization_id: string; name: string; description: string };
        Insert: { id?: string; organization_id: string; name: string; description?: string };
        Update: { id?: string; organization_id?: string; name?: string; description?: string };
        Relationships: [
          {
            foreignKeyName: 'specializations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      symptom_categories: {
        Row: { id: string; organization_id: string; name: string };
        Insert: { id?: string; organization_id: string; name: string };
        Update: { id?: string; organization_id?: string; name?: string };
        Relationships: [
          {
            foreignKeyName: 'symptom_categories_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      add_doctor_leave: {
        Args: { p_doctor_id: string; p_starts_at: string; p_ends_at: string; p_reason: string };
        Returns: string;
      };
      available_appointment_slots: {
        Args: { p_branch_id: string; p_doctor_id: string; p_date: string };
        Returns: Database['public']['Tables']['appointment_slots']['Row'][];
      };
      book_appointment: {
        Args: {
          p_slot_id: string;
          p_patient_id: string;
          p_reason: string;
          p_type?: Database['public']['Enums']['appointment_type'];
          p_source?: Database['public']['Enums']['appointment_source'];
        };
        Returns: string;
      };
      grant_clinical_access: {
        Args: {
          p_patient_id: string;
          p_branch_id: string;
          p_user_id: string;
          p_reason: string;
          p_can_write?: boolean;
          p_expires_at?: string;
        };
        Returns: string;
      };
      request_reschedule: {
        Args: { p_appointment_id: string; p_slot_id: string; p_reason: string };
        Returns: undefined;
      };
      revoke_clinical_access: { Args: { p_grant_id: string }; Returns: undefined };
      save_encounter: {
        Args: { p_appointment_id: string; p_notes: Json; p_items?: Json; p_sign?: boolean };
        Returns: string;
      };
      transition_appointment: {
        Args: {
          p_appointment_id: string;
          p_status: Database['public']['Enums']['appointment_status'];
        };
        Returns: undefined;
      };
    };
    Enums: {
      appointment_source: 'patient' | 'walk_in' | 'follow_up';
      appointment_status:
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
      appointment_type: 'physical' | 'remote';
      clinic_role: 'admin' | 'doctor' | 'patient' | 'clinical_staff';
      encounter_status: 'draft' | 'signed';
      invitation_status: 'draft' | 'sent' | 'accepted' | 'expired' | 'revoked';
      payment_status: 'unpaid' | 'paid' | 'waived';
    };
    CompositeTypes: { [_ in never]: never };
  };
};
