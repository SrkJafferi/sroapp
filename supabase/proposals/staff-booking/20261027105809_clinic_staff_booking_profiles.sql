-- Additive candidate. Explicit approval required before remote application.
-- No new tables, grants, RLS policies, data backfill or public RPC signatures.
begin;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or
  not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) or
  to_regprocedure('clinic_private.lock_profile_edit(uuid,text,uuid)') is null or
  to_regprocedure('clinic_private.can_read_intake(uuid,uuid,uuid)') is null or
  not exists(select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name='age_years') then
  raise exception 'Reviewed PostgreSQL 17 owner and deployed age/walk-in/profile commands required'; end if;
end $$;
create or replace function clinic_private.read_profile(o uuid,k text,t uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; uid uuid; avatar uuid;
begin
 if not clinic_private.profile_allowed(o,k,t,false) then raise exception 'Profile access denied' using errcode='42501'; end if;
 if k='patient' then select user_id,jsonb_build_object(
   'name',name,
   'ageYears',case
     when age_years is not null then age_years+date_part('year',age(current_date,age_recorded_on))::integer
     when date_of_birth is not null then date_part('year',age(current_date,date_of_birth))::integer
   end,
   'ageSource',case when age_years is not null then 'recorded' when date_of_birth is not null then 'dateOfBirth' end,
   'ageRecordedOn',age_recorded_on,
   'gender',gender,'phone',phone,'email',email,'address',address,
   'bloodGroup',coalesce((select h.blood_group from public.patient_medical_history h where h.organization_id=o and h.patient_id=t),''),
   'canEditBloodGroup',clinic_private.profile_allowed(o,k,t,true) and clinic_private.has_role(o,array['admin','doctor']::public.clinic_role[]) and exists(select 1 from public.patient_branches pb join public.branches br on (br.organization_id,br.id)=(pb.organization_id,pb.branch_id) where pb.organization_id=o and pb.patient_id=t and br.active and clinic_private.branch_role(o,pb.branch_id,array['admin','doctor']::public.clinic_role[])))
   into uid,result from public.patients where organization_id=o and id=t;
 elsif k='doctor' then select user_id,jsonb_build_object('name',name,'gender',gender,'qualifications',qualifications,'experience',experience,'bio',bio,'email',public_email)
   into uid,result from public.doctors where organization_id=o and id=t;
 else select id,jsonb_build_object('name',name) into uid,result from public.profiles where id=t; end if;
 select id into avatar from clinic_private.profile_avatars where organization_id=o and kind=k and target_id=t and state='current';
 return result||jsonb_build_object('organizationId',o,'kind',k,'id',t,'userId',uid,'avatarId',avatar,
   'canEdit',clinic_private.profile_allowed(o,k,t,true),'loginEmail',case when uid=auth.uid() then clinic_private.phase2b_verified_email(uid) else null end);
end $$;

create or replace function clinic_private.save_profile(o uuid,k text,t uuid,d jsonb,photo text,aid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare allowed text[]; a clinic_private.profile_avatars; s storage.objects; uid uuid; b uuid; nm text; ay smallint;
begin
 perform clinic_private.lock_profile_edit(o,k,t);
 allowed:=case k when 'patient' then array['name','gender','ageYears','phone','email','address','bloodGroup'] when 'doctor' then array['name','gender','qualifications','experience','bio','email'] else array['name'] end;
 if d is null or jsonb_typeof(d)<>'object' or exists(select 1 from jsonb_object_keys(d) key where not key=any(allowed))
   or photo is null or photo not in ('keep','replace','remove') or (photo='replace') is distinct from (aid is not null) then raise exception 'Unsupported profile fields' using errcode='23514'; end if;
 nm:=btrim(d->>'name');
 if nm is null or length(nm) not between 2 and 120 or nm ~ '[[:cntrl:]]' then raise exception 'Invalid full name' using errcode='23514'; end if;
 if d ? 'gender' and coalesce(d->>'gender','') not in ('Male','Female','Other','Not recorded') then raise exception 'Invalid gender' using errcode='23514'; end if;
 if d ? 'email' and (d->>'email' is null or length(d->>'email')>254 or ((d->>'email')<>'' and (d->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then raise exception 'Invalid contact email' using errcode='23514'; end if;
 if coalesce(length(d->>'phone'),0)>40 or coalesce(length(d->>'address'),0)>1000 or coalesce(length(d->>'qualifications'),0)>300 or coalesce(length(d->>'bio'),0)>4000 then raise exception 'Profile value too long' using errcode='23514'; end if;
 if d ? 'experience' and (jsonb_typeof(d->'experience')<>'number' or (d->>'experience')::numeric<>trunc((d->>'experience')::numeric) or (d->>'experience')::numeric not between 0 and 80) then raise exception 'Invalid experience' using errcode='23514'; end if;
 if d ? 'ageYears' then
   if jsonb_typeof(d->'ageYears')<>'number' then raise exception 'Invalid age' using errcode='23514'; end if;
   if (d->>'ageYears')::numeric<>trunc((d->>'ageYears')::numeric) or (d->>'ageYears')::numeric not between 0 and 120 then raise exception 'Invalid age' using errcode='23514'; end if;
   ay:=(d->>'ageYears')::smallint;
 end if;
 if d ? 'bloodGroup' then
   if k<>'patient' or not clinic_private.has_role(o,array['admin','doctor']::public.clinic_role[]) or not exists(
     select 1 from public.patient_branches pb join public.branches br on (br.organization_id,br.id)=(pb.organization_id,pb.branch_id)
     where pb.organization_id=o and pb.patient_id=t and br.active and clinic_private.branch_role(o,pb.branch_id,array['admin','doctor']::public.clinic_role[])) then
     raise exception 'Authorized staff required for blood group changes' using errcode='42501'; end if;
   if jsonb_typeof(d->'bloodGroup')<>'string' or (d->>'bloodGroup') not in ('','A+','A-','B+','B-','AB+','AB-','O+','O-') then
     raise exception 'Invalid blood group' using errcode='23514'; end if;
 end if;
 if k='patient' then
   -- Date of birth is intentionally absent from this contract. Existing values are never overwritten.
   update public.patients set name=nm,initials=upper(left(split_part(nm,' ',1),1)||left(split_part(nm,' ',2),1)),
    gender=coalesce(d->>'gender',gender),age_years=coalesce(ay,age_years),
    age_recorded_on=case when ay is not null then current_date else age_recorded_on end,
    phone=coalesce(d->>'phone',phone),email=coalesce(d->>'email',email),address=coalesce(d->>'address',address)
    where organization_id=o and id=t returning user_id,home_branch_id into uid,b;
 elsif k='doctor' then
   update public.doctors set name=nm,initials=upper(left(split_part(regexp_replace(nm,'^Dr\.\s*','','i'),' ',1),1)||left(split_part(regexp_replace(nm,'^Dr\.\s*','','i'),' ',2),1)),
    gender=coalesce(d->>'gender',gender),qualifications=coalesce(d->>'qualifications',qualifications),experience=coalesce((d->>'experience')::smallint,experience),bio=coalesce(d->>'bio',bio),public_email=coalesce(d->>'email',public_email)
    where organization_id=o and id=t returning user_id into uid;
 else uid:=t; end if;
 -- Blood group is a field-level update under the same locked profile transaction.
 -- It neither overwrites clinical history nor marks unrelated history as reviewed.
 if k='patient' and d ? 'bloodGroup' then
   insert into public.patient_medical_history(organization_id,patient_id,blood_group,updated_by)
     values(o,t,nullif(d->>'bloodGroup',''),auth.uid())
     on conflict(organization_id,patient_id) do update set blood_group=excluded.blood_group,updated_by=auth.uid(),updated_at=now();
   insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
     values(o,b,auth.uid(),'patient.blood_group.updated','patients',t);
 end if;
 -- Global account name changes only by the account owner. Cross-user edits affect the clinic entity.
 if uid=auth.uid() then update public.profiles set name=nm where id=uid; end if;
 if photo<>'keep' then
   if photo='replace' then
    select * into strict a from clinic_private.profile_avatars where id=aid and author_id=auth.uid() and (organization_id,kind,target_id)=(o,k,t) for update;
    if a.state not in ('validated','current') then raise exception 'Avatar requires trusted byte validation' using errcode='23514'; end if;
    select * into strict s from storage.objects where bucket_id='clinic-profile-avatars' and name=a.object_key for update;
    if s.id is distinct from a.object_id or s.version is distinct from a.object_version or (s.metadata->>'size')::int is distinct from a.size_bytes then raise exception 'Avatar version changed' using errcode='23514'; end if;
   end if;
   update clinic_private.profile_avatars set state='retired',expires_at=clock_timestamp()+interval '60 seconds' where organization_id=o and kind=k and target_id=t and state='current' and (aid is null or id<>aid);
   if photo='replace' then update clinic_private.profile_avatars set state='current' where id=aid; end if;
 end if;
 insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
  values(o,b,auth.uid(),'profile.updated.'||photo,k,t);
 return clinic_private.read_profile(o,k,t);
end $$;


create or replace function clinic_private.book_appointment(p_slot_id uuid,p_patient_id uuid,p_reason text,
  p_type public.appointment_type default 'physical',p_source public.appointment_source default 'patient') returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.appointment_slots; a public.appointments; d public.doctors; fee bigint; begin
  if auth.uid() is null then raise exception 'Authenticated caller required' using errcode='42501'; end if;
  select * into strict s from public.appointment_slots where id=p_slot_id;
  if not clinic_private.can_book(s.organization_id,s.branch_id,s.doctor_id,p_patient_id,p_source) then
    raise exception 'Booking not authorized' using errcode='42501'; end if;
  perform clinic_private.lock_doctor(s.doctor_id);
  s := clinic_private.assert_slot(p_slot_id);
  if not clinic_private.can_book(s.organization_id,s.branch_id,s.doctor_id,p_patient_id,p_source) then
    raise exception 'Booking authority changed while waiting' using errcode='42501'; end if;
  select * into strict d from public.doctors where id=s.doctor_id;
  insert into public.appointments(organization_id,branch_id,patient_id,doctor_id,clinician_user_id,current_slot_id,reason,type,source,created_by)
    values(s.organization_id,s.branch_id,p_patient_id,s.doctor_id,d.user_id,s.id,p_reason,p_type,p_source,auth.uid()) returning * into a;
  insert into public.appointment_reservations(organization_id,appointment_id,kind,slot_id,doctor_id,branch_id,clinician_user_id,patient_id,starts_at,ends_at)
    values(a.organization_id,a.id,'original',s.id,a.doctor_id,a.branch_id,a.clinician_user_id,a.patient_id,s.starts_at,s.ends_at);
  select fee_paisa into strict fee from public.doctor_branch_assignments where (organization_id,doctor_id,branch_id)=(a.organization_id,a.doctor_id,a.branch_id);
  insert into public.consultation_charges(organization_id,appointment_id,amount_paisa,payment_status)
    values(a.organization_id,a.id,fee,case when fee=0 then 'waived'::public.payment_status else 'unpaid'::public.payment_status end);
  perform clinic_private.event(a.id,'appointment.requested');
  -- Staff bookings are confirmed atomically using the reviewed transition command.
  -- Authority is derived from the current database caller, never p_source/browser role.
  -- can_book above still requires the Doctor's own patient or scoped new intake.
  if clinic_private.branch_role(a.organization_id,a.branch_id,array['admin']::public.clinic_role[]) or
    (a.clinician_user_id=auth.uid() and clinic_private.branch_role(a.organization_id,a.branch_id,array['doctor']::public.clinic_role[])) then
    perform clinic_private.transition_appointment(a.id,'confirmed');
  end if;
  return a.id;
end $$;


-- CREATE OR REPLACE preserves existing owners and EXECUTE ACLs. Public wrappers
-- remain SECURITY INVOKER. No direct patient/history write grants are introduced.
notify pgrst,'reload schema';
commit;
