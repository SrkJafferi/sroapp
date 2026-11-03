-- Additive proposal: no remote execution without explicit approval.
-- Only scoped Doctor managers gain the Doctor's verified Auth email in the existing response.
begin;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or
    (select md5(prosrc) from pg_proc where oid='clinic_private.read_profile(uuid,text,uuid)'::regprocedure) is distinct from 'dadc37f5883879f3fb0827e12bdaa671' then
   raise exception 'Reviewed PostgreSQL 17 profile function baseline required'; end if;
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
   'canEdit',clinic_private.profile_allowed(o,k,t,true),
   'loginEmailVisible',coalesce(uid=auth.uid() or (k='doctor' and clinic_private.has_role(o,array['admin']::public.clinic_role[]) and clinic_private.profile_allowed(o,k,t,true)),false),
   'loginEmail',case when uid=auth.uid() then clinic_private.phase2b_verified_email(uid)
     when k='doctor' and clinic_private.has_role(o,array['admin']::public.clinic_role[]) and clinic_private.profile_allowed(o,k,t,true) then
       (select u.email from auth.users u where u.id=uid and u.email_confirmed_at is not null
         and (u.banned_until is null or u.banned_until<now()) and u.deleted_at is null
         and exists(select 1 from public.profiles p where p.id=uid and p.active))
     else null end);
end $$;


notify pgrst, 'reload schema';
commit;
