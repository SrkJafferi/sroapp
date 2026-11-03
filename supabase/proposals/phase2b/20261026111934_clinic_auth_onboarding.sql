-- PHASE 2B PROPOSAL ONLY. Separate remote approval required. Original 2A files remain immutable.
begin;
create index phase2b_invitation_actor_time on public.doctor_invitations(invited_by,created_at desc);
create table clinic_private.auth_setup (
  singleton boolean primary key default true check (singleton),
  organization_id uuid not null references public.organizations,
  registration_branch_id uuid not null references public.branches,
  bootstrap_user_id uuid not null references public.profiles,
  created_at timestamptz not null default now()
);
create table clinic_private.demo_accounts (
  user_id uuid primary key references public.profiles,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create table clinic_private.auth_email_limits (
  bucket text primary key, starts_at timestamptz not null, attempts integer not null
);
alter table clinic_private.auth_email_limits enable row level security;
alter table clinic_private.auth_email_limits force row level security;
revoke all on clinic_private.auth_email_limits from public,anon,authenticated,service_role;
alter table clinic_private.auth_setup enable row level security;
alter table clinic_private.auth_setup force row level security;
alter table clinic_private.demo_accounts enable row level security;
alter table clinic_private.demo_accounts force row level security;
revoke all on clinic_private.auth_setup, clinic_private.demo_accounts from public,anon,authenticated,service_role;

create function clinic_private.phase2b_verified_email(u uuid) returns text
language plpgsql security definer set search_path='' as $$
declare e text;
begin
  select email into e from auth.users where id=u and email_confirmed_at is not null
    and (banned_until is null or banned_until<now()) and deleted_at is null;
  if e is null then raise exception 'Verified active Auth account required' using errcode='42501'; end if;
  if exists(select 1 from public.profiles where id=u and not active) then
    raise exception 'Account disabled' using errcode='42501'; end if;
  return e;
end $$;
create function public.phase2b_email_limit(p_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare n integer; k text;
begin
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid email bucket' using errcode='22023'; end if;
  foreach k in array array['global',p_hash] loop
    insert into clinic_private.auth_email_limits(bucket,starts_at,attempts) values(k,now(),1)
    on conflict(bucket) do update set
      starts_at=case when auth_email_limits.starts_at<now()-interval '1 hour' then now() else auth_email_limits.starts_at end,
      attempts=case when auth_email_limits.starts_at<now()-interval '1 hour' then 1 else auth_email_limits.attempts+1 end returning attempts into n;
    if n>(case when k='global' then 50 else 3 end) then raise exception 'Email limit reached' using errcode='54000'; end if;
  end loop;
end $$;
create function clinic_private.phase2b_admin(u uuid,b uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
  perform clinic_private.phase2b_verified_email(u);
  select t.organization_id into o from public.branches t
    join public.organizations org on org.id=t.organization_id and org.active
    join public.organization_memberships m on m.organization_id=t.organization_id and m.user_id=u and m.active
    join public.profiles p on p.id=u and p.active
    join public.branch_memberships bm on bm.organization_id=t.organization_id and bm.branch_id=t.id and bm.user_id=u and bm.active
    join public.role_assignments r on r.organization_id=t.organization_id and r.user_id=u and r.role='admin'
    where t.id=b and t.active for share of t,org,m,p,bm,r;
  if o is null then raise exception 'Branch administrator required' using errcode='42501'; end if;
  return o;
end $$;
create function public.phase2b_bootstrap(p_user uuid,p_name text,p_clinic text,p_branch text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e text; o uuid; b uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(261026,205);
  e:=clinic_private.phase2b_verified_email(p_user);
  if exists(select 1 from clinic_private.auth_setup) or exists(select 1 from public.organizations)
    or exists(select 1 from public.role_assignments) then raise exception 'Initial bootstrap already closed' using errcode='42501'; end if;
  insert into public.organizations(name) values(p_clinic) returning id into o;
  insert into public.branches(organization_id,name) values(o,p_branch) returning id into b;
  insert into public.profiles(id,name,email) values(p_user,p_name,e);
  insert into public.organization_memberships values(o,p_user,true);
  insert into public.role_assignments values(o,p_user,'admin');
  insert into public.branch_memberships values(o,b,p_user,true);
  insert into public.specializations(organization_id,name) values(o,'General Medicine');
  insert into clinic_private.auth_setup values(true,o,b,p_user,now());
  insert into clinic_private.demo_accounts(user_id) values(p_user);
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(o,b,p_user,'auth.demo_admin_bootstrapped','profiles',p_user);
  return jsonb_build_object('organizationId',o,'branchId',b);
end $$;
create function public.phase2b_registration_branch() returns uuid
language sql security definer set search_path='' as $$
  select s.registration_branch_id from clinic_private.auth_setup s
    join public.branches b on b.id=s.registration_branch_id and b.active
    join public.organizations o on o.id=s.organization_id and o.active
$$;
create function public.phase2b_patient(p_user uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare e text; b uuid; o uuid; pid uuid; pname text;
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
  insert into public.patients(organization_id,user_id,home_branch_id,name,date_of_birth,gender,phone,email,address)
    values(o,p_user,b,pname,(p_data->>'dateOfBirth')::date,p_data->>'gender',p_data->>'phone',e,coalesce(p_data->>'address',''))
    on conflict(organization_id,user_id) do update set name=excluded.name,date_of_birth=excluded.date_of_birth,
      gender=excluded.gender,phone=excluded.phone,address=excluded.address,email=excluded.email returning id into pid;
  insert into public.patient_branches values(o,pid,b) on conflict do nothing;
  insert into clinic_private.demo_accounts(user_id) values(p_user) on conflict do nothing;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(o,b,p_user,'auth.demo_patient_profile_saved','patients',pid);
  return pid;
end $$;
create function public.phase2b_invite(p_actor uuid,p_branch uuid,p_specialization uuid,p_name text,p_email text,p_hash bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; i uuid; expiry timestamptz:=now()+interval '24 hours';
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,206));
  o:=clinic_private.phase2b_admin(p_actor,p_branch);
  if (select count(*) from public.doctor_invitations where invited_by=p_actor and created_at>now()-interval '1 hour')>=10 then
    raise exception 'Invitation limit reached' using errcode='54000'; end if;
  if octet_length(p_hash)<>32 or length(btrim(p_name)) not between 3 and 200 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid invitation' using errcode='22023'; end if;
  update public.doctor_invitations set status='expired' where organization_id=o and lower(email)=lower(p_email)
    and status in ('draft','sent') and expires_at<=now();
  insert into public.doctor_invitations(organization_id,branch_id,specialization_id,name,email,invited_by,expires_at)
    values(o,p_branch,p_specialization,btrim(p_name),lower(p_email),p_actor,expiry) returning id into i;
  insert into clinic_private.invitation_secrets(invitation_id,token_hash) values(i,p_hash);
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(o,p_branch,p_actor,'auth.doctor_invitation_created','doctor_invitations',i);
  return jsonb_build_object('id',i,'expiresAt',expiry);
end $$;
create function public.phase2b_invitation_delivery(p_actor uuid,p_id uuid,p_sent boolean) returns void
language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations;
begin
  select * into strict i from public.doctor_invitations where id=p_id for update;
  perform clinic_private.phase2b_admin(p_actor,i.branch_id);
  if i.invited_by<>p_actor or i.status<>'draft' then raise exception 'Invalid delivery transition' using errcode='42501'; end if;
  update public.doctor_invitations set status=case when p_sent then 'sent'::public.invitation_status else 'revoked'::public.invitation_status end where id=p_id;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(i.organization_id,i.branch_id,p_actor,case when p_sent then 'auth.invitation_sent' else 'auth.invitation_delivery_failed' end,'doctor_invitations',p_id);
end $$;
create function public.phase2b_accept(p_user uuid,p_invitation uuid,p_hash bytea) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations; e text; did uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,205));
  e:=clinic_private.phase2b_verified_email(p_user);
  select * into strict i from public.doctor_invitations where id=p_invitation for update;
  perform clinic_private.phase2b_admin(i.invited_by,i.branch_id);
  if i.status<>'sent' or i.expires_at<=now() or lower(i.email)<>lower(e) or not exists(
    select 1 from clinic_private.invitation_secrets where invitation_id=i.id and token_hash=p_hash and consumed_at is null
  ) then raise exception 'Invitation is invalid or expired' using errcode='42501'; end if;
  insert into public.profiles(id,name,email) values(p_user,i.name,e) on conflict(id) do nothing;
  insert into public.organization_memberships values(i.organization_id,p_user,true) on conflict do nothing;
  if not exists(select 1 from public.organization_memberships where organization_id=i.organization_id and user_id=p_user and active) then
    raise exception 'Membership disabled' using errcode='42501'; end if;
  insert into public.branch_memberships values(i.organization_id,i.branch_id,p_user,true) on conflict do nothing;
  if not exists(select 1 from public.branch_memberships where organization_id=i.organization_id and branch_id=i.branch_id and user_id=p_user and active) then
    raise exception 'Branch membership disabled' using errcode='42501'; end if;
  insert into public.role_assignments values(i.organization_id,p_user,'doctor') on conflict do nothing;
  insert into public.doctors(organization_id,user_id,specialization_id,name,active)
    values(i.organization_id,p_user,i.specialization_id,i.name,true) returning id into did;
  insert into public.doctor_branch_assignments(organization_id,doctor_id,branch_id) values(i.organization_id,did,i.branch_id);
  update clinic_private.invitation_secrets set consumed_at=now() where invitation_id=i.id;
  update public.doctor_invitations set status='accepted',accepted_user_id=p_user where id=i.id;
  insert into clinic_private.demo_accounts(user_id) values(p_user) on conflict do nothing;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(i.organization_id,i.branch_id,p_user,'auth.demo_doctor_activated','doctors',did);
  return did;
end $$;
create function public.phase2b_disable_demo(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare m record;
begin
  if not exists(select 1 from clinic_private.demo_accounts where user_id=p_user) then
    raise exception 'Demo account marker required' using errcode='42501'; end if;
  update public.profiles set active=false where id=p_user;
  update public.organization_memberships set active=false where user_id=p_user;
  update public.branch_memberships set active=false where user_id=p_user;
  update public.doctors set active=false where user_id=p_user;
  update clinic_private.demo_accounts set disabled_at=now() where user_id=p_user;
  for m in select organization_id from public.organization_memberships where user_id=p_user loop
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)
      values(m.organization_id,p_user,'auth.demo_account_disabled','profiles',p_user);
  end loop;
end $$;
-- Service-only provisioning entrypoints: never executable by anon/authenticated/PUBLIC.
-- Optional TOTP is enforced for direct Data API reads and clinical commands too.
create function clinic_private.phase2b_assurance() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
    or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','aal1')='aal2'
  )
$$;
create or replace function clinic_private.is_member(o uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and clinic_private.phase2b_assurance() and exists (
    select 1 from public.organization_memberships m join public.profiles p on p.id=m.user_id
      join public.organizations org on org.id=m.organization_id
    where m.organization_id=o and m.user_id=auth.uid() and m.active and p.active and org.active
  )
$$;
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('create policy phase2b_mfa_required on public.%I as restrictive for all to authenticated using ((select clinic_private.phase2b_assurance())) with check ((select clinic_private.phase2b_assurance()))',t.tablename);
  end loop;
end $$;
do $$ declare f record; begin
  for f in select oid::regprocedure signature,pronamespace='public'::regnamespace exposed from pg_proc
    where proname like 'phase2b_%' and pronamespace in ('public'::regnamespace,'clinic_private'::regnamespace) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.exposed then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end $$;
grant execute on function clinic_private.phase2b_assurance() to authenticated;
commit;
