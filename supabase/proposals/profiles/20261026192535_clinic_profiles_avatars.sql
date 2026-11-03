-- Independent additive candidate. No medical-document proposal dependency. Remote approval required.
begin;
do $$ begin
  if current_setting('server_version_num')::int/10000<>17 or to_regprocedure('clinic_private.workspace_admin(uuid)') is null
    or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Reviewed PostgreSQL 17 owner and deployed Phase 2B/2C required'; end if;
  if exists(select 1 from storage.buckets where id='clinic-profile-avatars') then raise exception 'Unexpected existing avatar bucket'; end if;
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then raise exception 'Storage RLS required'; end if;
end $$;

-- One metadata/lifecycle source for all avatars, including not-yet-linked clinic identities.
create table clinic_private.profile_avatars (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  kind text not null check(kind in ('profile','doctor','patient')), target_id uuid not null,
  author_id uuid not null references public.profiles, request_id uuid not null,
  object_key text not null unique, size_bytes integer not null check(size_bytes between 1 and 2097152),
  state text not null default 'pending' check(state in ('pending','validated','current','retired')),
  object_id uuid, object_version text, sha256 text check(sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
  unique(author_id,request_id), check(state not in ('validated','current') or (object_id is not null and object_version is not null and sha256 is not null))
);
create unique index profile_avatar_current on clinic_private.profile_avatars(organization_id,kind,target_id) where state='current';
create index profile_avatar_author on clinic_private.profile_avatars(author_id,created_at);
alter table clinic_private.profile_avatars enable row level security;
alter table clinic_private.profile_avatars force row level security;
revoke all on clinic_private.profile_avatars from public,anon,authenticated,service_role;

create function clinic_private.profile_allowed(o uuid,k text,t uuid,writing boolean) returns boolean
language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and clinic_private.phase2b_assurance() and clinic_private.is_member(o) and coalesce(case k
 when 'profile' then exists(select 1 from public.profiles p where p.id=t and p.active and p.id=auth.uid())
 when 'doctor' then exists(select 1 from public.doctors d where d.id=t and d.organization_id=o and d.active and (
   (d.user_id=auth.uid() and clinic_private.has_role(o,array['doctor']::public.clinic_role[])) or
   (exists(select 1 from public.doctor_branch_assignments a join public.branches b on b.id=a.branch_id and b.active
      where a.organization_id=o and a.doctor_id=d.id and a.active and clinic_private.in_branch(o,a.branch_id)) and
     (not writing or (clinic_private.has_role(o,array['admin']::public.clinic_role[]) and not exists(
       select 1 from public.doctor_branch_assignments a where a.organization_id=o and a.doctor_id=d.id and a.active
         and not clinic_private.branch_role(o,a.branch_id,array['admin']::public.clinic_role[])))))
 ))
 when 'patient' then exists(select 1 from public.patients p where p.id=t and p.organization_id=o and (
   (p.user_id=auth.uid() and clinic_private.owns_patient(o,t) and clinic_private.in_branch(o,p.home_branch_id)) or
   (not writing and clinic_private.patient_access(o,t)) or
   (writing and clinic_private.has_role(o,array['admin']::public.clinic_role[]) and
     exists(select 1 from public.patient_branches pb where pb.organization_id=o and pb.patient_id=t) and not exists(
       select 1 from public.patient_branches pb where pb.organization_id=o and pb.patient_id=t
         and not clinic_private.branch_role(o,pb.branch_id,array['admin']::public.clinic_role[]))) or
   (writing and exists(select 1 from public.patient_assignments pa
     join public.doctors d on (d.organization_id,d.id)=(pa.organization_id,pa.doctor_id) and d.active and d.user_id=auth.uid()
     join public.doctor_branch_assignments da on (da.organization_id,da.doctor_id,da.branch_id)=(pa.organization_id,pa.doctor_id,pa.branch_id) and da.active
     join public.patient_branches pb on (pb.organization_id,pb.patient_id,pb.branch_id)=(pa.organization_id,pa.patient_id,pa.branch_id)
     join public.branches b on b.id=pa.branch_id and b.active
     where pa.organization_id=o and pa.patient_id=t and pa.active and clinic_private.branch_role(o,pa.branch_id,array['doctor']::public.clinic_role[])))
 )) else false end,false)
$$;

create function clinic_private.lock_profile_edit(o uuid,k text,t uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not clinic_private.profile_allowed(o,k,t,true) then raise exception 'Profile edit denied' using errcode='42501'; end if;
 -- Lock target plus current authority rows, then re-evaluate in a fresh statement after any wait.
 -- Concurrent revocations/deactivations either precede this check or wait until the edit commits.
 if k='patient' then
   perform 1 from public.patients where organization_id=o and id=t for update;
   perform 1 from public.patient_assignments where organization_id=o and patient_id=t order by id for share;
   perform 1 from public.patient_branches where organization_id=o and patient_id=t order by branch_id for share;
 elsif k='doctor' then perform 1 from public.doctors where organization_id=o and id=t for update;
 else perform 1 from public.profiles where id=t for update; end if;
 perform 1 from public.organizations where id=o for share;
 perform 1 from public.profiles where id=auth.uid() for share;
 perform 1 from public.organization_memberships where organization_id=o and user_id=auth.uid() for share;
 perform 1 from public.role_assignments where organization_id=o and user_id=auth.uid() order by role for share;
 perform 1 from public.branch_memberships where organization_id=o and user_id=auth.uid() order by branch_id for share;
 perform 1 from public.doctors where organization_id=o and user_id=auth.uid() for share;
 perform 1 from public.doctor_branch_assignments where organization_id=o and
   (doctor_id=t or doctor_id in(select id from public.doctors where organization_id=o and user_id=auth.uid())) order by doctor_id,branch_id for share;
 perform 1 from public.branches where organization_id=o order by id for share;
 if not clinic_private.profile_allowed(o,k,t,true) then raise exception 'Profile authorization changed' using errcode='42501'; end if;
end $$;

create function clinic_private.read_profile(o uuid,k text,t uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; uid uuid; avatar uuid;
begin
 if not clinic_private.profile_allowed(o,k,t,false) then raise exception 'Profile access denied' using errcode='42501'; end if;
 if k='patient' then select user_id,jsonb_build_object('name',name,'dateOfBirth',date_of_birth,'gender',gender,'phone',phone,'email',email,'address',address)
   into uid,result from public.patients where organization_id=o and id=t;
 elsif k='doctor' then select user_id,jsonb_build_object('name',name,'gender',gender,'qualifications',qualifications,'experience',experience,'bio',bio,'email',public_email)
   into uid,result from public.doctors where organization_id=o and id=t;
 else select id,jsonb_build_object('name',name) into uid,result from public.profiles where id=t; end if;
 select id into avatar from clinic_private.profile_avatars where organization_id=o and kind=k and target_id=t and state='current';
 return result||jsonb_build_object('organizationId',o,'kind',k,'id',t,'userId',uid,'avatarId',avatar,
   'canEdit',clinic_private.profile_allowed(o,k,t,true),'loginEmail',case when uid=auth.uid() then clinic_private.phase2b_verified_email(uid) else null end);
end $$;

create function clinic_private.begin_profile_avatar(o uuid,k text,t uuid,r uuid,s integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a clinic_private.profile_avatars; aid uuid:=gen_random_uuid();
begin
 perform clinic_private.lock_profile_edit(o,k,t);
 if r is null or s is null or s not between 1 and 2097152 then raise exception 'Invalid avatar' using errcode='23514'; end if;
 select * into a from clinic_private.profile_avatars where author_id=auth.uid() and request_id=r for update;
 if found then
   if (a.organization_id,a.kind,a.target_id,a.size_bytes) is distinct from (o,k,t,s) then raise exception 'Request reused' using errcode='23505'; end if;
   if a.state='retired' or (a.state='pending' and a.expires_at<=clock_timestamp()) then raise exception 'Upload expired' using errcode='23514'; end if;
 else
   if (select count(*) from clinic_private.profile_avatars where author_id=auth.uid() and state in ('pending','validated') and created_at>clock_timestamp()-interval '1 hour')>=5 then raise exception 'Pending upload limit' using errcode='54000'; end if;
   insert into clinic_private.profile_avatars(id,organization_id,kind,target_id,author_id,request_id,object_key,size_bytes)
    values(aid,o,k,t,auth.uid(),r,o||'/'||aid||'.webp',s) returning * into a;
 end if;
 return jsonb_build_object('id',a.id,'objectKey',a.object_key,'state',a.state,'sha256',a.sha256);
end $$;

-- Single trusted byte-validation attestor, no profile/clinical update privilege.
create function clinic_private.attest_profile_avatar(aid uuid,actor uuid,oid uuid,v text,h text) returns void
language plpgsql security definer set search_path='' as $$
declare a clinic_private.profile_avatars; s storage.objects;
begin
 select * into strict a from clinic_private.profile_avatars where id=aid and author_id=actor for update;
 if a.state<>'pending' or a.expires_at<=clock_timestamp() or h is null or h !~ '^[0-9a-f]{64}$' then raise exception 'Avatar cannot be validated' using errcode='23514'; end if;
 select * into strict s from storage.objects where bucket_id='clinic-profile-avatars' and name=a.object_key for update;
 if s.id is distinct from oid or s.version is distinct from v or s.owner_id is distinct from actor::text
   or (s.metadata->>'size')::int is distinct from a.size_bytes or s.metadata->>'mimetype' is distinct from 'image/webp' then raise exception 'Avatar object differs' using errcode='23514'; end if;
 update clinic_private.profile_avatars set state='validated',object_id=s.id,object_version=s.version,sha256=h where id=aid;
end $$;

create function clinic_private.save_profile(o uuid,k text,t uuid,d jsonb,photo text,aid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare allowed text[]; a clinic_private.profile_avatars; s storage.objects; uid uuid; b uuid; nm text; dob date;
begin
 perform clinic_private.lock_profile_edit(o,k,t);
 allowed:=case k when 'patient' then array['name','gender','dateOfBirth','phone','email','address'] when 'doctor' then array['name','gender','qualifications','experience','bio','email'] else array['name'] end;
 if d is null or jsonb_typeof(d)<>'object' or exists(select 1 from jsonb_object_keys(d) key where not key=any(allowed))
   or photo is null or photo not in ('keep','replace','remove') or (photo='replace') is distinct from (aid is not null) then raise exception 'Unsupported profile fields' using errcode='23514'; end if;
 nm:=btrim(d->>'name');
 if nm is null or length(nm) not between 2 and 120 or nm ~ '[[:cntrl:]]' then raise exception 'Invalid full name' using errcode='23514'; end if;
 if d ? 'gender' and coalesce(d->>'gender','') not in ('Male','Female','Other','Not recorded') then raise exception 'Invalid gender' using errcode='23514'; end if;
 if d ? 'email' and (d->>'email' is null or length(d->>'email')>254 or ((d->>'email')<>'' and (d->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then raise exception 'Invalid contact email' using errcode='23514'; end if;
 if coalesce(length(d->>'phone'),0)>40 or coalesce(length(d->>'address'),0)>1000 or coalesce(length(d->>'qualifications'),0)>300 or coalesce(length(d->>'bio'),0)>4000 then raise exception 'Profile value too long' using errcode='23514'; end if;
 if d ? 'experience' and (jsonb_typeof(d->'experience')<>'number' or (d->>'experience')::numeric<>trunc((d->>'experience')::numeric) or (d->>'experience')::numeric not between 0 and 80) then raise exception 'Invalid experience' using errcode='23514'; end if;
 if k='patient' then
   if d ? 'dateOfBirth' then dob:=(d->>'dateOfBirth')::date; if dob is null or dob>current_date or dob<current_date-interval '130 years' then raise exception 'Invalid birth date' using errcode='23514'; end if; end if;
   update public.patients set name=nm,initials=upper(left(split_part(nm,' ',1),1)||left(split_part(nm,' ',2),1)),
    gender=coalesce(d->>'gender',gender),date_of_birth=coalesce(dob,date_of_birth),phone=coalesce(d->>'phone',phone),email=coalesce(d->>'email',email),address=coalesce(d->>'address',address)
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

create function clinic_private.discard_profile_avatar(aid uuid) returns text
language plpgsql security definer set search_path='' as $$
declare a clinic_private.profile_avatars;
begin
 select * into strict a from clinic_private.profile_avatars where id=aid for update;
 perform clinic_private.lock_profile_edit(a.organization_id,a.kind,a.target_id);
 if a.state='current' or (a.state<>'retired' and a.author_id<>auth.uid()) then raise exception 'Avatar cannot be discarded' using errcode='42501'; end if;
 update clinic_private.profile_avatars set state='retired',expires_at=clock_timestamp()+interval '60 seconds' where id=aid;
 return a.object_key;
end $$;

create function clinic_private.profile_avatar_access(key text,operation text) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from clinic_private.profile_avatars a where a.object_key=key and (
   (operation='read' and a.state='current' and clinic_private.profile_allowed(a.organization_id,a.kind,a.target_id,false)) or
   (a.state='retired' and clinic_private.profile_allowed(a.organization_id,a.kind,a.target_id,true) and
      (operation='delete' or (operation='read' and a.expires_at>clock_timestamp()))) or
   (a.author_id=auth.uid() and clinic_private.profile_allowed(a.organization_id,a.kind,a.target_id,true) and (
     (operation='insert' and a.state='pending' and a.expires_at>clock_timestamp()) or
     (operation='read' and a.state in ('pending','validated'))))))
$$;

create function public.get_clinic_profile(p_organization_id uuid,p_kind text,p_target_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select clinic_private.read_profile(p_organization_id,p_kind,p_target_id) $$;
create function public.save_clinic_profile(p_organization_id uuid,p_kind text,p_target_id uuid,p_fields jsonb,p_photo text,p_upload_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select clinic_private.save_profile(p_organization_id,p_kind,p_target_id,p_fields,p_photo,p_upload_id) $$;
create function public.begin_profile_avatar(p_organization_id uuid,p_kind text,p_target_id uuid,p_request_id uuid,p_size integer) returns jsonb
language sql security invoker set search_path='' as $$ select clinic_private.begin_profile_avatar(p_organization_id,p_kind,p_target_id,p_request_id,p_size) $$;
create function public.attest_profile_avatar(p_upload_id uuid,p_author_id uuid,p_object_id uuid,p_version text,p_sha256 text) returns void
language sql security invoker set search_path='' as $$ select clinic_private.attest_profile_avatar(p_upload_id,p_author_id,p_object_id,p_version,p_sha256) $$;
create function public.discard_profile_avatar(p_upload_id uuid) returns text
language sql security invoker set search_path='' as $$ select clinic_private.discard_profile_avatar(p_upload_id) $$;
create function clinic_private.profile_assets(o uuid) returns jsonb
language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organizationId',a.organization_id,'kind',a.kind,'id',a.target_id,'avatarId',a.id)), '[]'::jsonb)
 from clinic_private.profile_avatars a where a.organization_id=o and a.state='current' and clinic_private.profile_allowed(o,a.kind,a.target_id,false)
$$;
create function public.get_profile_assets(p_organization_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select clinic_private.profile_assets(p_organization_id) $$;
create function clinic_private.profile_avatar_object(aid uuid) returns text
language sql security definer set search_path='' as $$
 select a.object_key from clinic_private.profile_avatars a where a.id=aid and a.state='current' and clinic_private.profile_allowed(a.organization_id,a.kind,a.target_id,false)
$$;
create function public.get_profile_avatar_object(p_avatar_id uuid) returns text
language sql security invoker set search_path='' as $$ select clinic_private.profile_avatar_object(p_avatar_id) $$;

-- Only exact new signatures are touched; existing grants/policies/functions are preserved.
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','clinic_private') and p.proname in ('profile_allowed','lock_profile_edit','read_profile','begin_profile_avatar','attest_profile_avatar','save_profile','discard_profile_avatar','profile_avatar_access','profile_assets','profile_avatar_object','get_clinic_profile','save_clinic_profile','get_profile_assets','get_profile_avatar_object') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
  execute format('grant execute on function %s to %I',f.sig,case when f.proname='attest_profile_avatar' then 'service_role' else 'authenticated' end);
 end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('clinic-profile-avatars','clinic-profile-avatars',false,2097152,array['image/webp']);
create policy clinic_avatar_insert on storage.objects for insert to authenticated
 with check(bucket_id='clinic-profile-avatars' and owner_id=auth.uid()::text and clinic_private.profile_avatar_access(name,'insert'));
create policy clinic_avatar_read on storage.objects for select to authenticated
 using(bucket_id='clinic-profile-avatars' and clinic_private.profile_avatar_access(name,'read'));
create policy clinic_avatar_delete on storage.objects for delete to authenticated
 using(bucket_id='clinic-profile-avatars' and clinic_private.profile_avatar_access(name,'delete'));
create policy clinic_avatar_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'clinic-profile-avatars' or (owner_id=auth.uid()::text and clinic_private.profile_avatar_access(name,'insert')));
create policy clinic_avatar_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'clinic-profile-avatars' or clinic_private.profile_avatar_access(name,'read'));
create policy clinic_avatar_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'clinic-profile-avatars' or clinic_private.profile_avatar_access(name,'delete'));
create policy clinic_avatar_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'clinic-profile-avatars') with check(bucket_id<>'clinic-profile-avatars');
create policy clinic_avatar_anon_guard on storage.objects as restrictive for all to anon
 using(bucket_id<>'clinic-profile-avatars') with check(bucket_id<>'clinic-profile-avatars');
notify pgrst,'reload schema';
commit;
