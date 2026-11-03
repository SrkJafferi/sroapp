-- PREPARED ONLY. No remote application without explicit approval.
begin;
create table clinic_private.patient_accounts (
 organization_id uuid not null, patient_id uuid primary key, branch_id uuid not null,
 user_id uuid not null unique, internal_email text unique,
 state text not null check(state in ('provisioning','pending_handover','change_required','active','disabled','resetting')),
 operation_id uuid not null unique, operated_by uuid not null references public.profiles,
 operation_at timestamptz not null default clock_timestamp(), handover_hash bytea,
 handover_expires_at timestamptz, temporary_expires_at timestamptz, password_fingerprint bytea,
 password_changed_at timestamptz, session_valid_after timestamptz not null default clock_timestamp(),
 allowed_session uuid,
 foreign key(organization_id,patient_id,branch_id) references public.patient_branches(organization_id,patient_id,branch_id),
 check(internal_email is null or internal_email ~ '^[0-9a-f]{32}@accounts[.]sro[.]invalid$'),
 check(handover_hash is null or octet_length(handover_hash)=32)
);
create index patient_accounts_operator on clinic_private.patient_accounts(operated_by);
alter table clinic_private.patient_accounts enable row level security;
alter table clinic_private.patient_accounts force row level security;
revoke all on clinic_private.patient_accounts from public,anon,authenticated,service_role;
create function public.patient_login_limit(p_identifier text,p_ip text) returns void
language plpgsql security definer set search_path='' as $$
declare b text; n integer;
begin
 if p_identifier is null or p_ip is null or p_identifier !~ '^[0-9a-f]{64}$' or p_ip !~ '^[0-9a-f]{64}$' then raise exception 'Invalid bucket' using errcode='22023'; end if;
 foreach b in array array['patient-login-id:'||p_identifier,'patient-login-ip:'||p_ip] loop
  insert into clinic_private.auth_email_limits values(b,clock_timestamp(),1)
  on conflict(bucket) do update set starts_at=case when auth_email_limits.starts_at<clock_timestamp()-interval '15 minutes' then clock_timestamp() else auth_email_limits.starts_at end,
   attempts=case when auth_email_limits.starts_at<clock_timestamp()-interval '15 minutes' then 1 else auth_email_limits.attempts+1 end returning attempts into n;
  if n>10 then raise exception 'Login limited' using errcode='54000'; end if;
 end loop;
end $$;
revoke all on function public.patient_login_limit(text,text) from public,anon,authenticated;
grant execute on function public.patient_login_limit(text,text) to service_role;

create function clinic_private.patient_account_actor(o uuid,b uuid,p uuid,u uuid,initial boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform clinic_private.phase2b_verified_email(u);
 if exists(select 1 from public.role_assignments where organization_id=o and user_id=u and role='admin') then
  if clinic_private.phase2b_admin(u,b) is distinct from o then raise exception 'Denied' using errcode='42501'; end if;
 elsif initial then
  perform 1 from clinic_private.patient_intakes i
  join public.doctors d on d.organization_id=i.organization_id and d.user_id=u and d.active
  join public.doctor_branch_assignments a on a.organization_id=d.organization_id and a.doctor_id=d.id and a.branch_id=b and a.active
  join public.profiles pr on pr.id=u and pr.active
  join public.organization_memberships m on m.organization_id=o and m.user_id=u and m.active
  join public.branch_memberships bm on bm.organization_id=o and bm.branch_id=b and bm.user_id=u and bm.active
  join public.role_assignments r on r.organization_id=o and r.user_id=u and r.role='doctor'
  join public.branches br on br.organization_id=o and br.id=b and br.active
  join public.organizations org on org.id=o and org.active
  where i.organization_id=o and i.patient_id=p and i.branch_id=b and i.created_by=u and i.expires_at>clock_timestamp()
  for share of i,d,a,pr,m,bm,r,br,org;
  if not found then raise exception 'Denied' using errcode='42501'; end if;
 else raise exception 'Denied' using errcode='42501'; end if;
end $$;

-- Blank public email is allowed only for a mapped internal Patient principal; never expose aliases.
create function clinic_private.patient_internal_identity(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from clinic_private.patient_accounts where user_id=u and internal_email is not null)
$$;
alter table public.profiles drop constraint profiles_email_check;
alter table public.profiles add constraint profiles_email_check check(length(email) between 3 and 320 or (email='' and clinic_private.patient_internal_identity(id)));
revoke all on function clinic_private.patient_internal_identity(uuid) from public,anon,authenticated,service_role;

-- Authoritative gate also used by every existing restrictive MFA policy and membership check.
create function clinic_private.patient_account_session(u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from clinic_private.patient_accounts where user_id=u) or exists(
  select 1 from clinic_private.patient_accounts a join auth.sessions s on s.user_id=u
   join auth.users usr on usr.id=u and usr.deleted_at is null and usr.email_confirmed_at is not null
    and (usr.banned_until is null or usr.banned_until<now())
  where a.user_id=u and a.state='active' and s.id::text=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')
   and (s.not_after is null or s.not_after>now())
   and (s.created_at>=a.session_valid_after or s.id=a.allowed_session)
 )
$$;
create or replace function clinic_private.phase2b_assurance() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and clinic_private.patient_account_session(auth.uid()) and (
  not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') or
  coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','aal1')='aal2')
$$;

-- Service-only capability. p_actor/p_session come only from freshly verified server sessions.
create function public.patient_account_command(p_action text,p_actor uuid default null,p_patient uuid default null,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.patients; a clinic_private.patient_accounts; u auth.users; sid uuid; alias text; verified boolean;
begin
 if p_action='resolve' then
  select * into p from public.patients where patient_code=p_data->>'code';
  if p.user_id is null or not exists(select 1 from public.role_assignments where organization_id=p.organization_id and user_id=p.user_id and role='patient') or exists(select 1 from public.role_assignments where user_id=p.user_id and role<>'patient') then return null; end if;
  select * into u from auth.users where id=p.user_id and deleted_at is null and email_confirmed_at is not null and (banned_until is null or banned_until<now());
  if u.id is null then return null; end if;
  select * into a from clinic_private.patient_accounts where patient_id=p.id;
  if a.state in ('disabled','resetting','provisioning','pending_handover') or (a.state='change_required' and a.temporary_expires_at<=clock_timestamp()) then return null; end if;
  return jsonb_build_object('email',u.email,'userId',u.id);
 end if;
 if p_action='self' then
  select * into a from clinic_private.patient_accounts where user_id=p_actor;
  return case when a.patient_id is null then null else jsonb_build_object('state',case when a.state='change_required' and a.temporary_expires_at<=clock_timestamp() then 'expired' else a.state end,'internal',a.internal_email is not null,'patientId',a.patient_id) end;
 end if;
 if p_action='change-complete' then
  select * into a from clinic_private.patient_accounts where user_id=p_actor for update;
  sid:=(p_data->>'sessionId')::uuid;
  perform clinic_private.phase2b_verified_email(p_actor);
  select * into u from auth.users where id=p_actor;
  if a.state is distinct from 'change_required' or a.temporary_expires_at<=clock_timestamp() or sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=p_actor and created_at>=a.session_valid_after and (not_after is null or not_after>clock_timestamp())) or
    a.password_fingerprint is null or sha256(convert_to(u.encrypted_password,'UTF8'))=a.password_fingerprint then
   raise exception 'Password change not confirmed' using errcode='42501'; end if;
  update clinic_private.patient_accounts set state='active',password_fingerprint=null,password_changed_at=clock_timestamp(),session_valid_after=clock_timestamp(),allowed_session=sid where patient_id=a.patient_id;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id) values(a.organization_id,a.branch_id,p_actor,'patient.account_password_changed','patients',a.patient_id);
  return jsonb_build_object('changed',true);
 end if;
 select * into strict p from public.patients where id=p_patient for update;
 select * into a from clinic_private.patient_accounts where patient_id=p.id for update;
 perform clinic_private.patient_account_actor(p.organization_id,coalesce(a.branch_id,p.home_branch_id),p.id,p_actor,
  p_action='begin' or (p_action in ('commit','handover') and a.internal_email is not null and a.password_changed_at is null and a.operated_by=p_actor));
 if p_action='status' then
  select * into u from auth.users where id=p.user_id;
  return jsonb_build_object('patientCode',p.patient_code,'status',case when a.state in ('disabled','resetting') or (p.user_id is not null and (u.id is null or u.deleted_at is not null or u.email_confirmed_at is null or u.banned_until>now())) then 'Disabled' when a.state in ('pending_handover','provisioning') or (a.state='change_required' and a.temporary_expires_at<=clock_timestamp()) then 'Pending Handover' when p.user_id is null then 'Not Provisioned' else 'Active' end,
    'mustChangePassword',a.state='change_required','loginMethod',case when p.user_id is null then null when a.internal_email is not null then 'Patient ID' else 'Patient ID / verified email' end,
    'emailVerified',u.email_confirmed_at is not null and a.internal_email is null,'lastSignInAt',u.last_sign_in_at,'passwordChangedAt',a.password_changed_at);
 elsif p_action='begin' then
  if p.user_id is not null or a.patient_id is not null then raise exception 'Existing identity or operation; review required' using errcode='42501'; end if;
  alias:=replace(gen_random_uuid()::text,'-','')||'@accounts.sro.invalid';
  insert into clinic_private.patient_accounts(organization_id,patient_id,branch_id,user_id,internal_email,state,operation_id,operated_by)
   values(p.organization_id,p.id,p.home_branch_id,gen_random_uuid(),alias,'provisioning',(p_data->>'operationId')::uuid,p_actor) returning * into a;
 elsif p_action='reset' then
  -- Never start a second external Auth write while a prior provider operation may still be in flight.
  -- Failed/ambiguous provisioning and resetting operations require explicit operator recovery review.
  if a.state in ('provisioning','resetting') then raise exception 'Incomplete provider operation; operator recovery required' using errcode='42501'; end if;
  if p_data->>'identityCheck' is distinct from 'in_person_verified' or a.operation_at>clock_timestamp()-interval '60 seconds' then raise exception 'Identity verification/cooldown required' using errcode='42501'; end if;
  if p.user_id is null and a.user_id is null then raise exception 'Provision first' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=coalesce(p.user_id,a.user_id) and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now())) then raise exception 'Verified existing Patient identity required' using errcode='42501'; end if;
  if exists(select 1 from public.role_assignments where user_id=coalesce(p.user_id,a.user_id) and (role<>'patient' or organization_id<>p.organization_id)) or
     exists(select 1 from public.patients where user_id=coalesce(p.user_id,a.user_id) and id<>p.id) then raise exception 'Shared/privileged identity refused' using errcode='42501'; end if;
  insert into clinic_private.patient_accounts(organization_id,patient_id,branch_id,user_id,state,operation_id,operated_by)
   values(p.organization_id,p.id,p.home_branch_id,coalesce(p.user_id,a.user_id),'resetting',(p_data->>'operationId')::uuid,p_actor)
   on conflict(patient_id) do update set state='resetting',operation_id=excluded.operation_id,operated_by=p_actor,operation_at=clock_timestamp(),handover_hash=null,handover_expires_at=null,allowed_session=null,session_valid_after=clock_timestamp()
   returning * into a;
 elsif p_action='commit' then
  if a.state not in ('provisioning','resetting') or a.operation_id is distinct from (p_data->>'operationId')::uuid or a.operated_by<>p_actor or p_data->>'handoverHash' !~ '^[0-9a-f]{64}$' or p_data->>'handoverHash' is null then raise exception 'Operation mismatch' using errcode='42501'; end if;
  select * into u from auth.users where id=a.user_id and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now());
  if u.id is null or u.encrypted_password is null or u.encrypted_password='' or (a.internal_email is not null and u.email is distinct from a.internal_email) or (p.user_id is not null and p.user_id<>a.user_id) then raise exception 'Identity mismatch' using errcode='42501'; end if;
  if exists(select 1 from public.role_assignments where user_id=a.user_id and (role<>'patient' or organization_id<>p.organization_id)) then raise exception 'Privileged/shared identity refused' using errcode='42501'; end if;
  insert into public.profiles(id,name,email) values(a.user_id,p.name,case when a.internal_email is null then u.email else '' end) on conflict(id) do nothing;
  insert into public.organization_memberships values(p.organization_id,a.user_id,true) on conflict do nothing;
  insert into public.branch_memberships values(p.organization_id,p.home_branch_id,a.user_id,true) on conflict do nothing;
  if not exists(select 1 from public.profiles where id=a.user_id and active) or not exists(select 1 from public.organization_memberships where organization_id=p.organization_id and user_id=a.user_id and active) or not exists(select 1 from public.branch_memberships where organization_id=p.organization_id and branch_id=p.home_branch_id and user_id=a.user_id and active) then raise exception 'Disabled membership refused' using errcode='42501'; end if;
  insert into public.role_assignments values(p.organization_id,a.user_id,'patient') on conflict do nothing;
  update public.patients set user_id=a.user_id where id=p.id;
  update clinic_private.patient_accounts set state='pending_handover',handover_hash=decode(p_data->>'handoverHash','hex'),handover_expires_at=clock_timestamp()+interval '10 minutes',temporary_expires_at=clock_timestamp()+interval '24 hours',password_fingerprint=sha256(convert_to(u.encrypted_password,'UTF8')),session_valid_after=clock_timestamp(),allowed_session=null where patient_id=p.id returning * into a;
 elsif p_action='handover' then
  if a.state is distinct from 'pending_handover' or a.operated_by<>p_actor or a.handover_expires_at<=clock_timestamp() or a.operation_id is distinct from (p_data->>'operationId')::uuid or a.handover_hash is distinct from decode(p_data->>'handoverHash','hex') or a.handover_hash is null then raise exception 'Handover refused' using errcode='42501'; end if;
  update clinic_private.patient_accounts set state='change_required',handover_hash=null,handover_expires_at=null where patient_id=p.id returning * into a;
 elsif p_action='disable' then
  if a.state in ('provisioning','resetting') then raise exception 'Incomplete provider operation; access already blocked' using errcode='42501'; end if;
  if p.user_id is null or exists(select 1 from public.role_assignments where user_id=p.user_id and (role<>'patient' or organization_id<>p.organization_id)) or exists(select 1 from public.patients where user_id=p.user_id and id<>p.id) then raise exception 'Patient identity required' using errcode='42501'; end if;
  insert into clinic_private.patient_accounts(organization_id,patient_id,branch_id,user_id,state,operation_id,operated_by) values(p.organization_id,p.id,p.home_branch_id,p.user_id,'disabled',gen_random_uuid(),p_actor)
  on conflict(patient_id) do update set state='disabled',allowed_session=null,session_valid_after=clock_timestamp(),handover_hash=null;
 elsif p_action='enable' then
  -- Only a previously activated account may resume. Pending initial/reset handovers must be reissued.
  if a.state is distinct from 'disabled' or (a.internal_email is not null and a.password_changed_at is null) or a.password_fingerprint is not null then raise exception 'Verified reissue required' using errcode='42501'; end if;
  update clinic_private.patient_accounts set state='active',allowed_session=null,session_valid_after=clock_timestamp() where patient_id=p.id;
 else raise exception 'Invalid command' using errcode='22023'; end if;
 insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id) values(p.organization_id,p.home_branch_id,p_actor,'patient.account_'||p_action,'patients',p.id);
 -- Internal identity fields never leave trusted server; HTTP handlers must use the explicit safe projection.
 return jsonb_build_object('patientId',p.id,'patientCode',p.patient_code,'name',p.name,'userId',a.user_id,'internalEmail',a.internal_email,'operationId',a.operation_id);
end $$;
revoke all on function clinic_private.patient_account_actor(uuid,uuid,uuid,uuid,boolean),clinic_private.patient_account_session(uuid) from public,anon,authenticated,service_role;
revoke all on function public.patient_account_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.patient_account_command(text,uuid,uuid,jsonb) to service_role;

-- Preserve reviewed profile reader and redact internal principal addresses at its public boundary.
create or replace function public.get_clinic_profile(p_organization_id uuid,p_kind text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 r:=clinic_private.read_profile(p_organization_id,p_kind,p_target_id);
 if exists(select 1 from clinic_private.patient_accounts where user_id=(r->>'userId')::uuid and internal_email is not null) then r:=r||jsonb_build_object('loginEmail',null,'loginEmailVisible',false); end if;
 return r;
end $$;
notify pgrst,'reload schema';
commit;
