-- DESTRUCTIVE FIXTURE RESET. Only the explicitly approved disposable project
-- ibulqvolmfouvkqczqhs; NEVER jyigxpjvygvtvcypujel. Caller must enforce that ref.
-- Keeps managed Auth identities/configuration, extensions and migration history.
begin;
set local search_path=pg_catalog;
do $reset$
declare p record; t record; f record; names text;
  allowed text[]:=array['organizations','profiles','organization_memberships','role_assignments','branches','branch_memberships',
    'specializations','symptom_categories','specialization_symptoms','doctors','doctor_branch_assignments','patients',
    'patient_branches','doctor_invitations','doctor_schedules','schedule_breaks','doctor_leave','appointment_slots',
    'appointments','appointment_reservations','appointment_status_history','patient_assignments','clinical_access_grants',
    'patient_medical_history','clinical_encounters','encounter_vitals','prescriptions','prescription_items','medical_documents',
    'consultation_charges','payment_records','notifications','notification_recipients','audit_logs'];
begin
  if not exists(select 1 from pg_roles where rolname='sro_phase2a5_runner')
    or (select count(*) from pg_tables where schemaname='public')<>34
    or exists(select 1 from pg_tables where schemaname='public' and not(tablename=any(allowed)))
    or (select count(*) from public.patients)<>4 or (select count(*) from public.profiles)<>13
    or exists(select 1 from public.profiles where email not like 'persona%@example.test')
    or exists(select 1 from public.patients where position('Fictional' in name)=0)
  then raise exception 'Not the expected disposable fictional fixture; refuse reset'; end if;
  for p in select polname,c.relname,n.nspname from pg_policy pol join pg_class c on c.oid=pol.polrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(allowed)
  loop execute format('drop policy %I on %I.%I',p.polname,p.nspname,p.relname); end loop;
  for t in select tr.tgname,c.relname,n.nspname from pg_trigger tr join pg_class c on c.oid=tr.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(allowed) and not tr.tgisinternal
  loop execute format('drop trigger %I on %I.%I',t.tgname,t.nspname,t.relname); end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('available_appointment_slots','book_appointment','request_reschedule','transition_appointment',
      'save_encounter','grant_clinical_access','revoke_clinical_access','add_doctor_leave')
  loop execute format('drop function %s',f.signature); end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='clinic_private'::regnamespace
  loop execute format('drop function %s',f.signature); end loop;
  select string_agg(format('%I.%I',schemaname,tablename),',') into names from pg_tables
    where (schemaname='public' and tablename=any(allowed)) or (schemaname='clinic_private' and tablename='invitation_secrets');
  execute 'drop table '||names; -- Explicit owned objects together, no CASCADE.
  for t in select typname from pg_type where typnamespace='public'::regnamespace and typtype='e'
    and typname in ('clinic_role','appointment_status','appointment_type','appointment_source','encounter_status','payment_status','invitation_status')
  loop execute format('drop type public.%I',t.typname); end loop;
  execute 'drop schema clinic_private';
end $reset$;
commit;
