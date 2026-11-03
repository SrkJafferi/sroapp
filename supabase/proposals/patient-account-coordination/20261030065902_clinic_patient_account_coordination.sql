-- Prepared only. Protected deployment requires separate approval.
begin;
-- BEGIN COORDINATION CORE (also exercised in an isolated native-PG staging schema)
create sequence clinic_private.patient_operation_fence;
create table clinic_private.patient_operations (
 operation_id uuid primary key, organization_id uuid not null, patient_id uuid not null,
 actor_id uuid not null, worker_id uuid not null, request_id uuid not null,
 purpose text not null check(purpose in ('provision','reset','activate')),
 proof_hash bytea not null check(octet_length(proof_hash)=32),
 fence bigint not null unique default nextval('clinic_private.patient_operation_fence'),
 phase text not null default 'claimed' check(phase in ('claimed','started','confirmed','completed','quarantined')),
 created_at timestamptz not null default clock_timestamp(),
 start_before timestamptz not null default clock_timestamp()+interval '2 minutes',
 started_at timestamptz, finished_at timestamptz, provider_uid uuid, session_id uuid,
 before_password_hash bytea,
 foreign key(organization_id,patient_id) references public.patients(organization_id,id),
 unique(organization_id,patient_id,purpose,request_id)
);
create unique index patient_one_unfinished_operation on clinic_private.patient_operations(patient_id) where phase<>'completed';
create index patient_operations_actor on clinic_private.patient_operations(actor_id);
alter table clinic_private.patient_operations enable row level security;
alter table clinic_private.patient_operations force row level security;
revoke all on clinic_private.patient_operations from public,anon,authenticated,service_role;
revoke all on sequence clinic_private.patient_operation_fence from public,anon,authenticated,service_role;

-- Private primitive. Only the authorized wrappers below can execute it in production.
create function clinic_private.patient_operation_core(action text,op uuid,org uuid,patient uuid,actor uuid,worker uuid,proof text,data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r clinic_private.patient_operations;
begin
 if op is null or org is null or patient is null or actor is null or worker is null or proof is null or proof !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Operation refused' using errcode='42501'; end if;
 if action='claim' then
  insert into clinic_private.patient_operations(operation_id,organization_id,patient_id,actor_id,worker_id,request_id,purpose,proof_hash,session_id)
  values(op,org,patient,actor,worker,(data->>'requestId')::uuid,data->>'purpose',sha256(convert_to(proof,'UTF8')),(data->>'sessionId')::uuid) returning * into r;
 else
  select * into r from clinic_private.patient_operations where operation_id=op for update;
  if r.operation_id is null or r.organization_id<>org or r.patient_id<>patient or r.actor_id<>actor or r.worker_id<>worker or r.proof_hash<>sha256(convert_to(proof,'UTF8')) or r.fence is distinct from (data->>'fence')::bigint then raise exception 'Operation refused' using errcode='42501'; end if;
  if action='bind' then
   if r.phase<>'claimed' or r.provider_uid is not null then raise exception 'Operation refused' using errcode='42501'; end if;
   update clinic_private.patient_operations set provider_uid=(data->>'userId')::uuid,before_password_hash=decode(data->>'beforeHash','hex') where operation_id=op returning * into r;
  elsif action='start' then
   if r.phase<>'claimed' or r.provider_uid is null or r.start_before<=clock_timestamp() then raise exception 'Operation refused' using errcode='42501'; end if;
   update clinic_private.patient_operations set phase='started',started_at=clock_timestamp() where operation_id=op returning * into r;
  elsif action='confirm' then
   if r.phase<>'started' then raise exception 'Operation refused' using errcode='42501'; end if;
   update clinic_private.patient_operations set phase='confirmed' where operation_id=op returning * into r;
  elsif action='finish' then
   if r.phase<>'confirmed' then raise exception 'Operation refused' using errcode='42501'; end if;
   update clinic_private.patient_operations set phase='completed',finished_at=clock_timestamp() where operation_id=op returning * into r;
  elsif action='quarantine' then
   if r.phase='completed' then raise exception 'Operation refused' using errcode='42501'; end if;
   update clinic_private.patient_operations set phase='quarantined' where operation_id=op returning * into r;
  else raise exception 'Invalid operation' using errcode='22023'; end if;
 end if;
 return jsonb_build_object('operationId',r.operation_id,'fence',r.fence::text,'phase',r.phase,'userId',r.provider_uid);
end $$;
revoke all on function clinic_private.patient_operation_core(text,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
-- END COORDINATION CORE

-- Move the existing reviewed implementation behind the coordinated boundary. No body changes.
alter function public.patient_account_command(text,uuid,uuid,jsonb) set schema clinic_private;
alter function clinic_private.patient_account_command(text,uuid,uuid,jsonb) rename to patient_account_command_v1;
revoke all on function clinic_private.patient_account_command_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function clinic_private.patient_operation_authorize(actor uuid,patient uuid,purpose text,sid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.patients; a clinic_private.patient_accounts;
begin
 select * into strict p from public.patients where id=patient;
 select * into a from clinic_private.patient_accounts where patient_id=patient;
 if purpose='activate' then
  perform clinic_private.phase2b_verified_email(actor);
  if p.user_id is distinct from actor or a.state is distinct from 'change_required' or a.temporary_expires_at<=clock_timestamp() or
   not exists(select 1 from auth.sessions where id=sid and user_id=actor and created_at>=a.session_valid_after and (not_after is null or not_after>clock_timestamp())) or
   not exists(select 1 from public.role_assignments where user_id=actor and organization_id=p.organization_id and role='patient') or
   not exists(select 1 from public.profiles pr join public.organization_memberships om on om.user_id=pr.id and om.organization_id=p.organization_id join public.branch_memberships bm on bm.user_id=pr.id and bm.organization_id=om.organization_id and bm.branch_id=p.home_branch_id join public.organizations org on org.id=om.organization_id join public.branches br on br.id=bm.branch_id where pr.id=actor and pr.active and om.active and bm.active and org.active and br.active) or
   exists(select 1 from public.role_assignments where user_id=actor and (organization_id<>p.organization_id or role<>'patient')) then raise exception 'Denied' using errcode='42501'; end if;
 else
  if purpose not in ('provision','reset') then raise exception 'Denied' using errcode='42501'; end if;
  perform clinic_private.patient_account_actor(p.organization_id,p.home_branch_id,p.id,actor,purpose='provision');
 end if;
end $$;
revoke all on function clinic_private.patient_operation_authorize(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.patient_account_operation(p_action text,p_actor uuid,p_patient uuid,p_operation uuid,p_worker uuid,p_proof text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.patients; r clinic_private.patient_operations; a clinic_private.patient_accounts; result jsonb; purpose text; sid uuid; u auth.users;
begin
 select * into strict p from public.patients where id=p_patient for update;
 if p_action='claim' then purpose:=p_data->>'purpose';sid:=(p_data->>'sessionId')::uuid;
 else select * into r from clinic_private.patient_operations where operation_id=p_operation;purpose:=r.purpose;sid:=r.session_id; end if;
 if p_action<>'quarantine' then perform clinic_private.patient_operation_authorize(p_actor,p.id,purpose,sid); end if;
 if p_action='claim' then
  select * into a from clinic_private.patient_accounts where patient_id=p.id;
  if (purpose='provision' and (p.user_id is not null or a.patient_id is not null)) or
   (purpose='reset' and (p.user_id is null or a.state in ('provisioning','resetting') or p_data->>'identityCheck' is distinct from 'in_person_verified')) then raise exception 'Account not eligible' using errcode='42501'; end if;
  result:=clinic_private.patient_operation_core('claim',p_operation,p.organization_id,p.id,p_actor,p_worker,p_proof,p_data);
  if purpose='activate' then
   select * into a from clinic_private.patient_accounts where patient_id=p.id;
   select * into u from auth.users where id=a.user_id;
   result:=clinic_private.patient_operation_core('bind',p_operation,p.organization_id,p.id,p_actor,p_worker,p_proof,result||jsonb_build_object('userId',a.user_id,'beforeHash',encode(sha256(convert_to(u.encrypted_password,'UTF8')),'hex')));
  end if;
 elsif p_action='confirm' then
  select * into u from auth.users where id=r.provider_uid and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now());
  select * into a from clinic_private.patient_accounts where patient_id=p.id;
  if u.id is null or u.encrypted_password is null or (a.internal_email is not null and u.email is distinct from a.internal_email) or
   (r.purpose<>'provision' and sha256(convert_to(u.encrypted_password,'UTF8')) is not distinct from r.before_password_hash) then raise exception 'Provider result not confirmed' using errcode='42501'; end if;
  result:=clinic_private.patient_operation_core(p_action,p_operation,p.organization_id,p.id,p_actor,p_worker,p_proof,p_data);
 elsif p_action in ('start','quarantine') then
  result:=clinic_private.patient_operation_core(p_action,p_operation,p.organization_id,p.id,p_actor,p_worker,p_proof,p_data);
 else raise exception 'Invalid operation' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.patient_account_operation(text,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.patient_account_operation(text,uuid,uuid,uuid,uuid,text,jsonb) to service_role;

create function public.patient_account_command(p_action text,p_actor uuid default null,p_patient uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r clinic_private.patient_operations; p public.patients; d jsonb; result jsonb; u auth.users;
begin
 if p_action in ('status','resolve','self') then return clinic_private.patient_account_command_v1(p_action,p_actor,p_patient,p_data); end if;
 select * into strict p from public.patients where id=p_patient for update;
 if p_action in ('handover','disable','enable') then
  if exists(select 1 from clinic_private.patient_operations where patient_id=p.id and phase<>'completed') then raise exception 'Operation awaiting review' using errcode='42501'; end if;
  return clinic_private.patient_account_command_v1(p_action,p_actor,p_patient,p_data);
 end if;
 select * into r from clinic_private.patient_operations where operation_id=(p_data->>'operationId')::uuid for update;
 if r.patient_id is distinct from p.id or r.actor_id is distinct from p_actor or r.worker_id is distinct from (p_data->>'workerId')::uuid or r.fence is distinct from (p_data->>'fence')::bigint or r.proof_hash is distinct from sha256(convert_to(p_data->>'proof','UTF8')) then raise exception 'Operation refused' using errcode='42501'; end if;
 perform clinic_private.patient_operation_authorize(p_actor,p.id,r.purpose,r.session_id);
 d:=p_data-'workerId'-'proof'-'fence';
 if p_action in ('begin','reset') then
  if r.phase<>'claimed' or (p_action='begin' and r.purpose<>'provision') or (p_action='reset' and r.purpose<>'reset') then raise exception 'Operation refused' using errcode='42501'; end if;
  result:=clinic_private.patient_account_command_v1(p_action,p_actor,p.id,d);
  select * into u from auth.users where id=(result->>'userId')::uuid;
  perform clinic_private.patient_operation_core('bind',r.operation_id,p.organization_id,p.id,p_actor,r.worker_id,p_data->>'proof',jsonb_build_object('fence',r.fence,'userId',result->>'userId','beforeHash',case when u.id is null then null else encode(sha256(convert_to(u.encrypted_password,'UTF8')),'hex') end));
 elsif p_action in ('commit','change-complete') then
  if r.phase<>'confirmed' or (p_action='commit' and r.purpose not in ('provision','reset')) or (p_action='change-complete' and (r.purpose<>'activate' or (d->>'sessionId')::uuid is distinct from r.session_id)) then raise exception 'Operation refused' using errcode='42501'; end if;
  result:=clinic_private.patient_account_command_v1(p_action,p_actor,p.id,d);
  perform clinic_private.patient_operation_core('finish',r.operation_id,p.organization_id,p.id,p_actor,r.worker_id,p_data->>'proof',jsonb_build_object('fence',r.fence));
 else raise exception 'Invalid command' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.patient_account_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.patient_account_command(text,uuid,uuid,jsonb) to service_role;

-- Restrict active data sessions while ANY provider operation is unresolved, including first change.
alter function clinic_private.patient_account_session(uuid) rename to patient_account_session_v1;
revoke all on function clinic_private.patient_account_session_v1(uuid) from public,anon,authenticated,service_role;
create function clinic_private.patient_account_session(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select clinic_private.patient_account_session_v1(u) and not exists(
  select 1 from clinic_private.patient_operations o join public.patients p on p.id=o.patient_id where p.user_id=u and o.phase<>'completed')
$$;
-- Existing SQL functions bind the old function OID. Replace assurance explicitly with the
-- reviewed body plus the new wrapper so the session fence is actually used.
create or replace function clinic_private.phase2b_assurance() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and clinic_private.patient_account_session(auth.uid()) and (
  not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') or
  coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','aal1')='aal2')
$$;
revoke all on function clinic_private.patient_account_session(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
