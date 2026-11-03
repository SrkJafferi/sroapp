-- Phase 2A candidate. Local replay only until project + plan are approved.
begin;
set local search_path = pg_catalog, public, extensions;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Clinic migration owner must bypass FORCE RLS' using errcode='42501';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 then
    raise exception 'Reviewed migrations require PostgreSQL 17' using errcode='0A000';
  end if;
end $$;
create schema clinic_private;
revoke all on schema clinic_private from public, anon, authenticated;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = pg_catalog, public, extensions;

create type public.clinic_role as enum ('admin','doctor','patient','clinical_staff');
create type public.appointment_status as enum (
  'pending','confirmed','rejected','reschedule_requested','cancellation_requested',
  'cancelled','checked_in','in_consultation','completed','no_show','doctor_unavailable'
);
create type public.appointment_type as enum ('physical','remote');
create type public.appointment_source as enum ('patient','walk_in','follow_up');
create type public.encounter_status as enum ('draft','signed');
create type public.payment_status as enum ('unpaid','paid','waived');
create type public.invitation_status as enum ('draft','sent','accepted','expired','revoked');

create table public.organizations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 200),
  timezone text not null default 'Asia/Karachi',
  currency text not null default 'PKR' check (currency='PKR'),
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 200),
  email text not null check (length(email) between 3 and 320),
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now()
);
create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  active boolean not null default true,
  primary key (organization_id,user_id)
);
create table public.role_assignments (
  organization_id uuid not null,
  user_id uuid not null,
  role public.clinic_role not null,
  primary key (organization_id,user_id,role),
  foreign key (organization_id,user_id) references public.organization_memberships
);
create table public.branches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(btrim(name)) between 3 and 200),
  address text not null default '', phone text not null default '',
  timezone text not null default 'Asia/Karachi',
  active boolean not null default true,
  unique (organization_id,id), unique (organization_id,name)
);
create table public.branch_memberships (
  organization_id uuid not null, branch_id uuid not null, user_id uuid not null,
  active boolean not null default true,
  primary key (organization_id,branch_id,user_id),
  foreign key (organization_id,branch_id) references public.branches(organization_id,id),
  foreign key (organization_id,user_id) references public.organization_memberships
);
create table public.specializations (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null references public.organizations,
  name text not null check (length(btrim(name)) between 2 and 100), description text not null default '',
  unique (organization_id,id), unique (organization_id,name)
);
create table public.symptom_categories (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null references public.organizations,
  name text not null check (length(btrim(name)) between 2 and 100),
  unique (organization_id,id), unique (organization_id,name)
);
create table public.specialization_symptoms (
  organization_id uuid not null, specialization_id uuid not null, symptom_category_id uuid not null,
  primary key (organization_id,specialization_id,symptom_category_id),
  foreign key (organization_id,specialization_id) references public.specializations(organization_id,id),
  foreign key (organization_id,symptom_category_id) references public.symptom_categories(organization_id,id)
);
create table public.doctors (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null references public.organizations,
  user_id uuid, specialization_id uuid not null,
  name text not null, initials text not null default '', gender text not null default '',
  qualifications text not null default '', experience smallint not null default 0 check (experience between 0 and 80),
  bio text not null default '', color text not null default 'purple', public_email text not null default '',
  active boolean not null default false,
  unique (organization_id,id), unique (organization_id,user_id), unique (organization_id,id,user_id),
  foreign key (organization_id,user_id) references public.organization_memberships,
  foreign key (organization_id,specialization_id) references public.specializations(organization_id,id),
  check (not active or user_id is not null)
);
create table public.doctor_branch_assignments (
  organization_id uuid not null, doctor_id uuid not null, branch_id uuid not null,
  fee_paisa bigint not null default 0 check (fee_paisa between 0 and 100000000),
  slot_minutes smallint not null default 30 check (slot_minutes between 5 and 240),
  active boolean not null default true,
  primary key (organization_id,doctor_id,branch_id),
  foreign key (organization_id,doctor_id) references public.doctors(organization_id,id),
  foreign key (organization_id,branch_id) references public.branches(organization_id,id)
);
create table public.patients (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null references public.organizations,
  user_id uuid, home_branch_id uuid not null, name text not null check (length(btrim(name)) between 3 and 200),
  initials text not null default '', date_of_birth date not null check (date_of_birth >= date '1900-01-01' and date_of_birth<=current_date),
  gender text not null, phone text not null default '', email text not null default '', address text not null default '',
  unique (organization_id,id), unique (organization_id,user_id),
  foreign key (organization_id,user_id) references public.organization_memberships,
  foreign key (organization_id,home_branch_id) references public.branches(organization_id,id)
);
create table public.patient_branches (
  organization_id uuid not null, patient_id uuid not null, branch_id uuid not null,
  primary key (organization_id,patient_id,branch_id),
  foreign key (organization_id,patient_id) references public.patients(organization_id,id),
  foreign key (organization_id,branch_id) references public.branches(organization_id,id)
);
create table public.doctor_invitations (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, branch_id uuid not null,
  specialization_id uuid not null, name text not null, email text not null,
  status public.invitation_status not null default 'draft',
  invited_by uuid not null, accepted_user_id uuid, expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id,id),
  foreign key (organization_id,branch_id) references public.branches(organization_id,id),
  foreign key (organization_id,specialization_id) references public.specializations(organization_id,id),
  foreign key (organization_id,invited_by) references public.organization_memberships,
  foreign key (organization_id,accepted_user_id) references public.organization_memberships,
  check (expires_at > created_at), check ((status='accepted') = (accepted_user_id is not null))
);
create unique index doctor_invitation_open_email on public.doctor_invitations(organization_id,lower(email))
  where status in ('draft','sent');
-- Only a future trusted onboarding service may access token hashes. Never store raw tokens.
create table clinic_private.invitation_secrets (
  invitation_id uuid primary key references public.doctor_invitations(id),
  token_hash bytea not null unique check (octet_length(token_hash)=32), consumed_at timestamptz
);
create table public.doctor_schedules (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, doctor_id uuid not null, branch_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null, ends_at time not null, valid_from date not null, valid_until date,
  unique (organization_id,id),
  foreign key (organization_id,doctor_id,branch_id) references public.doctor_branch_assignments,
  check (ends_at > starts_at), check (valid_until is null or valid_until >= valid_from)
);
create table public.schedule_breaks (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, schedule_id uuid not null,
  starts_at time not null, ends_at time not null,
  foreign key (organization_id,schedule_id) references public.doctor_schedules(organization_id,id),
  check (ends_at > starts_at)
);
create table public.doctor_leave (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, doctor_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null,
  period tstzrange generated always as (tstzrange(starts_at,ends_at,'[)')) stored,
  reason text not null check (length(btrim(reason)) between 3 and 1000), active boolean not null default true,
  foreign key (organization_id,doctor_id) references public.doctors(organization_id,id), check (ends_at > starts_at)
);
create table public.appointment_slots (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, doctor_id uuid not null, branch_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null, open boolean not null default true,
  unique (organization_id,id), unique (organization_id,id,doctor_id,branch_id),
  unique (organization_id,doctor_id,branch_id,starts_at),
  foreign key (organization_id,doctor_id,branch_id) references public.doctor_branch_assignments,
  check (ends_at > starts_at and ends_at <= starts_at + interval '4 hours')
);
create table public.appointments (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, branch_id uuid not null,
  patient_id uuid not null, doctor_id uuid not null, clinician_user_id uuid not null, current_slot_id uuid not null,
  type public.appointment_type not null default 'physical', status public.appointment_status not null default 'pending',
  reason text not null check (length(btrim(reason)) between 3 and 1000), source public.appointment_source not null default 'patient',
  created_by uuid not null, created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id,id), unique (organization_id,id,patient_id,doctor_id,branch_id),
  unique (organization_id,id,doctor_id,branch_id),
  foreign key (organization_id,patient_id,branch_id) references public.patient_branches,
  foreign key (organization_id,doctor_id,clinician_user_id) references public.doctors(organization_id,id,user_id),
  foreign key (organization_id,current_slot_id,doctor_id,branch_id) references public.appointment_slots(organization_id,id,doctor_id,branch_id),
  foreign key (organization_id,created_by) references public.organization_memberships
);
create table public.appointment_reservations (
  organization_id uuid not null, appointment_id uuid not null, kind text not null check (kind in ('original','proposed')),
  slot_id uuid not null, doctor_id uuid not null, branch_id uuid not null, clinician_user_id uuid not null,
  patient_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null,
  period tstzrange generated always as (tstzrange(starts_at,ends_at,'[)')) stored,
  active boolean not null default true, request_reason text,
  primary key (organization_id,appointment_id,kind),
  foreign key (organization_id,appointment_id,patient_id,doctor_id,branch_id)
    references public.appointments(organization_id,id,patient_id,doctor_id,branch_id),
  foreign key (organization_id,doctor_id,clinician_user_id) references public.doctors(organization_id,id,user_id),
  foreign key (organization_id,slot_id,doctor_id,branch_id) references public.appointment_slots(organization_id,id,doctor_id,branch_id),
  check (ends_at > starts_at), check (kind='original' or (request_reason is not null and length(btrim(request_reason)) between 3 and 1000)),
  -- Ignore overlap of the SAME appointment's original/proposed intervals, not other appointments.
  constraint no_doctor_double_booking exclude using gist
    (clinician_user_id with =, period with &&, appointment_id with <>) where (active),
  constraint no_patient_double_booking exclude using gist
    (patient_id with =, period with &&, appointment_id with <>) where (active)
);
create table public.appointment_status_history (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, appointment_id uuid not null,
  old_status public.appointment_status, new_status public.appointment_status not null,
  actor_id uuid references public.profiles, created_at timestamptz not null default pg_catalog.now(),
  foreign key (organization_id,appointment_id) references public.appointments(organization_id,id)
);
create table public.patient_assignments (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, patient_id uuid not null,
  doctor_id uuid not null, branch_id uuid not null, appointment_id uuid not null, active boolean not null default true,
  unique (organization_id,appointment_id),
  foreign key (organization_id,appointment_id,patient_id,doctor_id,branch_id)
    references public.appointments(organization_id,id,patient_id,doctor_id,branch_id)
);
create table public.clinical_access_grants (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, patient_id uuid not null, branch_id uuid not null,
  user_id uuid not null, granted_by uuid not null, can_write boolean not null default false,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default pg_catalog.now(),
  foreign key (organization_id,patient_id,branch_id) references public.patient_branches,
  foreign key (organization_id,branch_id,user_id) references public.branch_memberships,
  foreign key (organization_id,granted_by) references public.organization_memberships,
  check (expires_at > created_at)
);
create table public.patient_medical_history (
  organization_id uuid not null, patient_id uuid not null,
  allergies text[], conditions text[], medications text[], surgeries text, family_history text, social_history text,
  blood_group text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  emergency_contact text, review_state text not null default 'unknown' check (review_state in ('unknown','reviewed')),
  updated_by uuid references public.profiles, updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id,patient_id),
  foreign key (organization_id,patient_id) references public.patients(organization_id,id)
);
create table public.clinical_encounters (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, appointment_id uuid not null,
  patient_id uuid not null, doctor_id uuid not null, branch_id uuid not null, author_id uuid not null,
  symptoms text not null default '', examination text not null default '', diagnosis text not null default '',
  plan text not null default '', follow_up text not null default '', status public.encounter_status not null default 'draft',
  signed_at timestamptz, created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id,id), unique (organization_id,appointment_id), unique (organization_id,id,patient_id,branch_id),
  foreign key (organization_id,appointment_id,patient_id,doctor_id,branch_id)
    references public.appointments(organization_id,id,patient_id,doctor_id,branch_id),
  foreign key (organization_id,doctor_id,author_id) references public.doctors(organization_id,id,user_id),
  check ((status='signed') = (signed_at is not null)),
  check (status<>'signed' or (length(btrim(diagnosis))>0 and length(btrim(plan))>0))
);
create table public.encounter_vitals (
  organization_id uuid not null, encounter_id uuid not null,
  blood_pressure text not null default '', pulse text not null default '', temperature text not null default '',
  oxygen text not null default '', weight text not null default '', height text not null default '',
  primary key (organization_id,encounter_id),
  foreign key (organization_id,encounter_id) references public.clinical_encounters(organization_id,id)
);
create table public.prescriptions (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, encounter_id uuid not null,
  instructions text not null default '', issued_at timestamptz,
  unique (organization_id,id), unique (organization_id,encounter_id),
  foreign key (organization_id,encounter_id) references public.clinical_encounters(organization_id,id)
);
create table public.prescription_items (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, prescription_id uuid not null,
  line_number smallint not null check (line_number between 1 and 30),
  medication text not null check (length(btrim(medication)) between 1 and 500),
  strength text not null check (length(btrim(strength)) between 1 and 200),
  dosage text not null check (length(btrim(dosage)) between 1 and 500),
  frequency text not null check (length(btrim(frequency)) between 1 and 500),
  duration text not null check (length(btrim(duration)) between 1 and 500),
  instructions text not null check (length(btrim(instructions)) between 1 and 1000),
  unique (organization_id,prescription_id,line_number),
  foreign key (organization_id,prescription_id) references public.prescriptions(organization_id,id)
);
create table public.medical_documents (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, patient_id uuid not null, branch_id uuid not null,
  encounter_id uuid, author_id uuid not null, kind text not null check (kind in ('report','handwritten')),
  name text not null check (length(name) between 1 and 250),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  storage_object_key text unique, created_at timestamptz not null default pg_catalog.now(),
  foreign key (organization_id,patient_id,branch_id) references public.patient_branches,
  foreign key (organization_id,encounter_id,patient_id,branch_id)
    references public.clinical_encounters(organization_id,id,patient_id,branch_id),
  foreign key (organization_id,author_id) references public.organization_memberships,
  check (storage_object_key is null or storage_object_key not like '%://%')
);
create table public.consultation_charges (
  organization_id uuid not null, appointment_id uuid not null, amount_paisa bigint not null check (amount_paisa between 0 and 100000000),
  currency text not null default 'PKR' check (currency='PKR'), payment_status public.payment_status not null,
  primary key (organization_id,appointment_id),
  foreign key (organization_id,appointment_id) references public.appointments(organization_id,id),
  check ((amount_paisa=0) = (payment_status='waived'))
);
create table public.payment_records (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null, appointment_id uuid not null,
  amount_paisa bigint not null check (amount_paisa between 1 and 100000000), method text not null default 'manual' check (method='manual'),
  recorded_by uuid not null, recorded_at timestamptz not null default pg_catalog.now(),
  foreign key (organization_id,appointment_id) references public.consultation_charges,
  foreign key (organization_id,recorded_by) references public.organization_memberships
);
create table public.notifications (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null references public.organizations,
  appointment_id uuid, kind text not null check (kind in ('request','confirmation','cancellation','reminder','reschedule','leave','consultation','prescription','invitation')),
  title text not null check (length(title) between 1 and 120),
  message text not null check (length(message) between 1 and 250), created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id,id), foreign key (organization_id,appointment_id) references public.appointments(organization_id,id)
);
create table public.notification_recipients (
  organization_id uuid not null, notification_id uuid not null, user_id uuid not null, read_at timestamptz,
  primary key (organization_id,notification_id,user_id),
  foreign key (organization_id,notification_id) references public.notifications(organization_id,id),
  foreign key (organization_id,user_id) references public.organization_memberships
);
create table public.audit_logs (
  id uuid primary key default pg_catalog.gen_random_uuid(), organization_id uuid not null references public.organizations,
  branch_id uuid, actor_id uuid references public.profiles, action text not null,
  entity_type text not null, entity_id uuid not null, occurred_at timestamptz not null default pg_catalog.now(),
  -- Deliberately no clinical note/request payload or token column.
  foreign key (organization_id,branch_id) references public.branches(organization_id,id)
);

-- Index foreign-key columns (including reversed join directions) and RLS lookups.
create index membership_user on public.organization_memberships(user_id,organization_id) where active;
create index roles_user on public.role_assignments(user_id,organization_id,role);
create index branch_member_user on public.branch_memberships(user_id,organization_id,branch_id) where active;
create index branch_doctors on public.doctor_branch_assignments(organization_id,branch_id,doctor_id);
create index doctor_specialization on public.doctors(organization_id,specialization_id);
create index symptom_specializations on public.specialization_symptoms(organization_id,symptom_category_id);
create index patient_branch_patients on public.patient_branches(organization_id,branch_id,patient_id);
create index schedule_lookup on public.doctor_schedules(organization_id,doctor_id,branch_id,weekday);
create index break_schedule on public.schedule_breaks(organization_id,schedule_id);
create index leave_lookup on public.doctor_leave(organization_id,doctor_id,starts_at,ends_at) where active;
create index slot_branch_time on public.appointment_slots(organization_id,branch_id,starts_at);
create index appointment_patient on public.appointments(organization_id,patient_id,branch_id);
create index appointment_doctor on public.appointments(organization_id,doctor_id,branch_id,status);
create index appointment_current_slot on public.appointments(organization_id,current_slot_id);
create index history_appointment on public.appointment_status_history(organization_id,appointment_id,created_at);
create index assigned_patient on public.patient_assignments(organization_id,patient_id,branch_id,doctor_id) where active;
create index clinician_grants on public.clinical_access_grants(user_id,organization_id,patient_id,branch_id,expires_at) where revoked_at is null;
create index encounter_patient on public.clinical_encounters(organization_id,patient_id,branch_id,created_at);
create index document_patient on public.medical_documents(organization_id,patient_id,branch_id);
create index document_encounter on public.medical_documents(organization_id,encounter_id);
create index recipient_user on public.notification_recipients(user_id,organization_id,notification_id);
create index notification_appointment on public.notifications(organization_id,appointment_id);
create index payments_appointment on public.payment_records(organization_id,appointment_id);
create index audit_branch_time on public.audit_logs(organization_id,branch_id,occurred_at);

-- Install RLS and remove inherited/default Supabase grants in the same transaction.
do $$ declare t record; begin
  for t in select tablename, schemaname from pg_tables
    where schemaname in ('public','clinic_private') and tablename in (
      'organizations','profiles','organization_memberships','role_assignments','branches','branch_memberships',
      'specializations','symptom_categories','specialization_symptoms','doctors','doctor_branch_assignments',
      'patients','patient_branches','doctor_invitations','invitation_secrets','doctor_schedules','schedule_breaks',
      'doctor_leave','appointment_slots','appointments','appointment_reservations','appointment_status_history',
      'patient_assignments','clinical_access_grants','patient_medical_history','clinical_encounters','encounter_vitals',
      'prescriptions','prescription_items','medical_documents','consultation_charges','payment_records',
      'notifications','notification_recipients','audit_logs')
  loop
    execute format('alter table %I.%I enable row level security',t.schemaname,t.tablename);
    execute format('alter table %I.%I force row level security',t.schemaname,t.tablename);
    execute format('revoke all on %I.%I from public, anon, authenticated, service_role',t.schemaname,t.tablename);
  end loop;
end $$;
-- The trusted provisioning service may manage identities/catalogs. It receives
-- neither clinical/workflow SELECT nor mutation grants; use ordinary user JWTs.
grant select,insert,update,delete on public.organizations,public.profiles,public.organization_memberships,
  public.role_assignments,public.branches,public.branch_memberships,public.specializations,public.symptom_categories,
  public.specialization_symptoms,public.doctors,public.doctor_branch_assignments,public.patients,public.patient_branches,
  public.doctor_invitations,clinic_private.invitation_secrets,public.doctor_schedules,public.schedule_breaks to service_role;
-- Do not change public-schema default privileges for unrelated applications.
-- Every future clinic migration must explicitly harden its own objects.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant usage on schema clinic_private to service_role;
commit;
