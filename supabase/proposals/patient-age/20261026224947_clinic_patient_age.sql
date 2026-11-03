-- Independent additive candidate. Explicit approval required before remote application.
begin;
lock table public.patients in share row exclusive mode;
do $$ begin
  if current_setting('server_version_num')::integer/10000<>17 or
    not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) or
    to_regprocedure('public.phase2b_patient(uuid,jsonb)') is null or
    to_regprocedure('public.save_clinic_profile(uuid,text,uuid,jsonb,text,uuid)') is null or
    to_regprocedure('public.save_patient_history(uuid,uuid,jsonb)') is null or
    to_regprocedure('clinic_private.patient_number_guard()') is null or
    not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='patients' and column_name='patient_code') then
    raise exception 'Reviewed PostgreSQL 17 owner, patient numbering and existing patient/profile/history commands required';
  end if;
  -- Pin the reviewed hosted patient baseline before widening the age contract.
  if (select count(*) from public.patients)<>1 or not exists(
    select 1 from public.patients where id='398cf267-bc60-41a4-91e6-478dcd86a069'
      and organization_id='88645fbe-34da-48aa-a509-c24441b7cf72' and name='Amina Noor'
      and date_of_birth is not null
  ) then raise exception 'Patient baseline changed; stop and review the age candidate'; end if;
end $$;

-- Existing dates of birth stay untouched. Age-only records are stored with the date
-- the age was stated so the current age can be advanced without inventing a birth date.
alter table public.patients add column age_years smallint;
alter table public.patients add column age_recorded_on date;
alter table public.patients alter column date_of_birth drop not null;
alter table public.patients add constraint patients_age_years_range
  check(age_years is null or age_years between 0 and 120);
alter table public.patients add constraint patients_age_recorded_pair
  check((age_years is null)=(age_recorded_on is null));
alter table public.patients add constraint patients_age_recorded_on_range
  check(age_recorded_on is null or age_recorded_on between date '1900-01-01' and current_date);
alter table public.patients add constraint patients_age_known
  check(date_of_birth is not null or age_years is not null);

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
   'gender',gender,'phone',phone,'email',email,'address',address)
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
 allowed:=case k when 'patient' then array['name','gender','ageYears','phone','email','address'] when 'doctor' then array['name','gender','qualifications','experience','bio','email'] else array['name'] end;
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

create or replace function public.phase2b_patient(p_user uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare e text; b uuid; o uuid; pid uuid; pname text; ay smallint; dob date;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,205));
  e:=clinic_private.phase2b_verified_email(p_user);
  b:=public.phase2b_registration_branch();
  select organization_id into o from public.branches where id=b for share;
  if o is null then raise exception 'Registration is not configured' using errcode='42501'; end if;
  pname:=btrim(p_data->>'name');
  if length(pname) not between 3 and 200 or length(coalesce(p_data->>'phone',''))>30
    or length(coalesce(p_data->>'gender','')) not between 1 and 40 or length(coalesce(p_data->>'address',''))>500 then
    raise exception 'Invalid patient details' using errcode='22023'; end if;
  if p_data ? 'ageYears' then
    if jsonb_typeof(p_data->'ageYears')<>'number' then raise exception 'Invalid patient age' using errcode='22023'; end if;
    if (p_data->>'ageYears')::numeric<>trunc((p_data->>'ageYears')::numeric) or (p_data->>'ageYears')::numeric not between 0 and 120 then
      raise exception 'Invalid patient age' using errcode='22023'; end if;
    ay:=(p_data->>'ageYears')::smallint;
  end if;
  if p_data ? 'dateOfBirth' then
    dob:=(p_data->>'dateOfBirth')::date;
    if dob is null or dob>current_date or dob<date '1900-01-01' then raise exception 'Invalid birth date' using errcode='22023'; end if;
  end if;
  if ay is null and dob is null then raise exception 'Patient age is required' using errcode='22023'; end if;
  if exists(select 1 from public.role_assignments where user_id=p_user and role<>'patient') then
    raise exception 'Staff cannot self-enroll as patients' using errcode='42501'; end if;
  insert into public.profiles(id,name,email) values(p_user,pname,e)
    on conflict(id) do update set name=excluded.name,email=excluded.email;
  insert into public.organization_memberships values(o,p_user,true) on conflict do nothing;
  if not exists(select 1 from public.organization_memberships where organization_id=o and user_id=p_user and active) then
    raise exception 'Membership disabled' using errcode='42501'; end if;
  insert into public.role_assignments values(o,p_user,'patient') on conflict do nothing;
  insert into public.branch_memberships values(o,b,p_user,true) on conflict do nothing;
  if not exists(select 1 from public.branch_memberships where organization_id=o and branch_id=b and user_id=p_user and active) then
    raise exception 'Branch membership disabled' using errcode='42501'; end if;
  insert into public.patients as patient_row(organization_id,user_id,home_branch_id,name,date_of_birth,age_years,age_recorded_on,gender,phone,email,address)
    values(o,p_user,b,pname,dob,ay,case when ay is not null then current_date end,p_data->>'gender',p_data->>'phone',e,coalesce(p_data->>'address',''))
    on conflict(organization_id,user_id) do update set name=excluded.name,
      date_of_birth=coalesce(patient_row.date_of_birth,excluded.date_of_birth),
      age_years=coalesce(excluded.age_years,patient_row.age_years),
      age_recorded_on=case when excluded.age_years is not null then excluded.age_recorded_on else patient_row.age_recorded_on end,
      gender=excluded.gender,phone=excluded.phone,address=excluded.address,email=excluded.email returning id into pid;
  insert into public.patient_branches values(o,pid,b) on conflict do nothing;
  insert into clinic_private.demo_accounts(user_id) values(p_user) on conflict do nothing;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(o,b,p_user,'auth.demo_patient_profile_saved','patients',pid);
  return pid;
end $$;

do $$ begin
  if not exists(select 1 from public.patients where date_of_birth is not null) then
    raise exception 'Existing birth dates were not preserved'; end if;
  if exists(select 1 from public.patients where age_years is not null) then
    raise exception 'Age backfill is unexpected'; end if;
end $$;
notify pgrst,'reload schema';
commit;
