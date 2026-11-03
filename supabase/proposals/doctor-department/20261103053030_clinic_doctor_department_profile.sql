-- Doctor department editing: additive RPC-only proposal; explicit remote approval required.
-- Reuses doctors.specialization_id; no table, Auth, RLS, publication or grant changes.
begin;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or
    not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) or
    (select md5(prosrc) from pg_proc where oid='clinic_private.read_profile(uuid,text,uuid)'::regprocedure) is distinct from 'f88468133a59962273b6fa2f703ed9ad' or
    (select md5(prosrc) from pg_proc where oid='clinic_private.save_profile(uuid,text,uuid,jsonb,text,uuid)'::regprocedure) is distinct from 'a1eb012d5093c6465b2861077dae01ba' then
   raise exception 'Reviewed PostgreSQL 17 owner and exact deployed profile baseline required'; end if;
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
 elsif k='doctor' then select user_id,jsonb_build_object('name',name,'gender',gender,'qualifications',qualifications,'experience',experience,'bio',bio,'email',public_email,'specializationId',specialization_id,
   'canEditDepartment',clinic_private.has_role(o,array['admin']::public.clinic_role[]) and clinic_private.profile_allowed(o,k,t,true) and exists(select 1 from public.doctor_branch_assignments da
     join public.branches br on (br.organization_id,br.id)=(da.organization_id,da.branch_id)
     where da.organization_id=o and da.doctor_id=t and da.active and br.active
       and clinic_private.branch_role(o,da.branch_id,array['admin']::public.clinic_role[]))
   and not exists(select 1 from public.doctor_branch_assignments da
     where da.organization_id=o and da.doctor_id=t and da.active
       and not clinic_private.branch_role(o,da.branch_id,array['admin']::public.clinic_role[])))
   into uid,result from public.doctors where organization_id=o and id=t;
 else select id,jsonb_build_object('name',name) into uid,result from public.profiles where id=t; end if;
 select id into avatar from clinic_private.profile_avatars where organization_id=o and kind=k and target_id=t and state='current';
 return result||jsonb_build_object('organizationId',o,'kind',k,'id',t,'userId',uid,'avatarId',avatar,
   'canEdit',clinic_private.profile_allowed(o,k,t,true),
   'loginEmailVisible',coalesce(uid=auth.uid() or (k='doctor' and clinic_private.has_role(o,array['admin']::public.clinic_role[]) and clinic_private.profile_allowed(o,k,t,true)),false),
   'loginEmail',case when uid=auth.uid() then clinic_private.phase2b_verified_email(uid)
     when k='doctor' and clinic_private.has_role(o,array['admin']::public.clinic_role[]) and clinic_private.profile_allowed(o,k,t,true) then
       (select u.email from auth.users u where u.id=uid and u.email_confirmed_at is not null
         and (u.banned_until is null or u.banned_until<now()) and u.deleted_at is null
         and exists(select 1 from public.profiles p where p.id=uid and p.active))
     else null end);
end $$;

create or replace function clinic_private.save_profile(o uuid,k text,t uuid,d jsonb,photo text,aid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare allowed text[]; a clinic_private.profile_avatars; s storage.objects; uid uuid; b uuid; nm text; ay smallint; department uuid; previous_department uuid;
begin
 perform clinic_private.lock_profile_edit(o,k,t);
 allowed:=case k when 'patient' then array['name','gender','ageYears','phone','email','address','bloodGroup'] when 'doctor' then array['name','gender','qualifications','experience','bio','email','specializationId'] else array['name'] end;
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
 if d ? 'specializationId' then
   -- The department is organization-wide. The existing locked profile guard requires
   -- Admin authority over EVERY active branch assignment, not merely one branch.
   if k<>'doctor' or not clinic_private.has_role(o,array['admin']::public.clinic_role[]) or not (exists(select 1 from public.doctor_branch_assignments da
     join public.branches br on (br.organization_id,br.id)=(da.organization_id,da.branch_id)
     where da.organization_id=o and da.doctor_id=t and da.active and br.active
       and clinic_private.branch_role(o,da.branch_id,array['admin']::public.clinic_role[]))
   and not exists(select 1 from public.doctor_branch_assignments da
     where da.organization_id=o and da.doctor_id=t and da.active
       and not clinic_private.branch_role(o,da.branch_id,array['admin']::public.clinic_role[]))) then
     raise exception 'Only authorized Admins may change Doctor departments' using errcode='42501'; end if;
   if jsonb_typeof(d->'specializationId')<>'string' then
     raise exception 'Select a valid department' using errcode='22023'; end if;
   department:=(d->>'specializationId')::uuid;
   perform 1 from public.specializations where organization_id=o and id=department for share;
   if not found then raise exception 'Department does not belong to this clinic' using errcode='22023'; end if;
   select specialization_id into previous_department from public.doctors where organization_id=o and id=t;
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
    gender=coalesce(d->>'gender',gender),qualifications=coalesce(d->>'qualifications',qualifications),experience=coalesce((d->>'experience')::smallint,experience),bio=coalesce(d->>'bio',bio),public_email=coalesce(d->>'email',public_email),specialization_id=coalesce(department,specialization_id)
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
 if department is not null and department is distinct from previous_department then
   for b in select branch_id from public.doctor_branch_assignments where organization_id=o and doctor_id=t and active order by branch_id loop
     insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
       values(o,b,auth.uid(),'doctor.department.updated','doctors',t);
   end loop;
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

notify pgrst, 'reload schema';
commit;

