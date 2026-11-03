-- Phase 4D preparation only. Do not apply without separate explicit approval.
-- One-time, identity-bound recovery authority for the existing SRO0009 handover failure.
-- It does not create a Patient/Auth identity, change the pilot row, or enable broad reset.
begin;

create table clinic_private.patient_account_recovery_targets (
  singleton boolean primary key default true check (singleton),
  recovery_key text not null unique check (length(btrim(recovery_key)) between 8 and 64),
  organization_id uuid not null,
  branch_id uuid not null,
  patient_id uuid not null unique,
  patient_code text not null check (patient_code ~ '^SRO[0-9]{4,}$'),
  patient_name text not null check (length(btrim(patient_name)) between 3 and 200),
  user_id uuid not null unique,
  provision_operation_id uuid not null unique,
  provision_actor_id uuid not null,
  pilot_id uuid not null unique,
  pilot_request_id uuid not null unique,
  admin_user_id uuid not null,
  attestation_text text not null check (length(btrim(attestation_text)) between 20 and 500),
  created_at timestamptz not null default clock_timestamp()
);
alter table clinic_private.patient_account_recovery_targets enable row level security;
alter table clinic_private.patient_account_recovery_targets force row level security;
revoke all on clinic_private.patient_account_recovery_targets from public,anon,authenticated,service_role;

insert into clinic_private.patient_account_recovery_targets(
  singleton, recovery_key, organization_id, branch_id, patient_id, patient_code,
  patient_name, user_id, provision_operation_id, provision_actor_id, pilot_id,
  pilot_request_id, admin_user_id, attestation_text
) values (
  true, 'sro0009-handover-recovery-20261101',
  '88645fbe-34da-48aa-a509-c24441b7cf72',
  '5680d806-8a14-48d3-a0ac-d1cd12eddff3',
  '43824fdc-558a-4321-95b5-e11bc43a94b3',
  'SRO0009',
  'Ayesha Noor',
  '68b99984-1527-461b-b09a-7a9daaaa593d',
  '9d7e812b-3899-4475-8600-83e2d0794691',
  '5c81354a-50df-4824-bf19-f80acf650c52',
  '326b2c4e-baf5-4399-b4bf-ac31c2d6866c',
  '3185a2f6-7e3a-46de-b5c9-8ba530e5f333',
  'c9095e1e-b718-4c09-842f-df48970125af',
  'I confirm that Ayesha Noor (SRO0009) is an authorized fictional clinic test record under operator control. I have verified the exact existing Patient, Auth identity, clinic ownership, original pilot, and quarantined handover state. I authorize one controlled test credential recovery without claiming physical Patient identity verification.'
);

create table clinic_private.patient_account_recoveries (
  recovery_id uuid primary key default gen_random_uuid(),
  one_time boolean not null default true unique check (one_time),
  recovery_key text not null unique references clinic_private.patient_account_recovery_targets(recovery_key),
  organization_id uuid not null,
  branch_id uuid not null,
  patient_id uuid not null unique,
  patient_code text not null,
  user_id uuid not null,
  pilot_id uuid not null unique,
  admin_user_id uuid not null,
  attestation text not null check (length(btrim(attestation)) between 20 and 500),
  state text not null default 'prepared'
    check (state in ('prepared','claimed','handover_pending','handover_confirmed','completed','quarantined')),
  reissue_count smallint not null default 0 check (reissue_count between 0 and 1),
  operation_id uuid unique,
  worker_id uuid,
  proof_hash bytea check (proof_hash is null or octet_length(proof_hash) = 32),
  handover_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  handover_pending_at timestamptz,
  handover_at timestamptz,
  first_change_at timestamptz,
  completed_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  foreign key (organization_id, branch_id) references public.branches(organization_id,id),
  foreign key (organization_id, patient_id) references public.patients(organization_id,id),
  foreign key (pilot_id) references clinic_private.patient_pilot_authorizations(pilot_id),
  foreign key (admin_user_id) references public.profiles(id)
);
alter table clinic_private.patient_account_recoveries enable row level security;
alter table clinic_private.patient_account_recoveries force row level security;
revoke all on clinic_private.patient_account_recoveries from public,anon,authenticated,service_role;

create function clinic_private.patient_account_recovery_authority()
returns clinic_private.patient_account_recovery_targets
language sql stable security definer set search_path='' as $$
  select * from clinic_private.patient_account_recovery_targets where singleton
$$;
revoke all on function clinic_private.patient_account_recovery_authority() from public,anon,authenticated,service_role;

create function clinic_private.patient_account_recovery_admin(p_actor uuid,p_patient uuid)
returns clinic_private.patient_account_recovery_targets
language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  if p_actor is null or p_patient is null or p_actor <> t.admin_user_id or p_patient <> t.patient_id
  then raise exception 'Recovery operator refused' using errcode='42501'; end if;
  perform clinic_private.phase2b_verified_email(p_actor);
  if not exists(
    select 1 from public.role_assignments r
    where r.organization_id = t.organization_id and r.user_id = p_actor and r.role = 'admin'
  ) then raise exception 'Recovery operator refused' using errcode='42501'; end if;
  if clinic_private.phase2b_admin(p_actor,t.branch_id) is distinct from t.organization_id
  then raise exception 'Recovery operator refused' using errcode='42501'; end if;
  return t;
end $$;
revoke all on function clinic_private.patient_account_recovery_admin(uuid,uuid) from public,anon,authenticated,service_role;

create function clinic_private.patient_account_recovery_live(t clinic_private.patient_account_recovery_targets,p_allowed_operation uuid default null)
returns clinic_private.patient_accounts
language plpgsql security definer set search_path='' as $$
declare p public.patients; a clinic_private.patient_accounts; u auth.users; z clinic_private.patient_pilot_authorizations;
begin
  select * into strict p from public.patients where id = t.patient_id for update;
  if p.organization_id <> t.organization_id or p.home_branch_id <> t.branch_id
    or p.patient_code <> t.patient_code or p.name <> t.patient_name or p.user_id is distinct from t.user_id
  then raise exception 'Recovery target mismatch' using errcode='42501'; end if;
  select * into a from clinic_private.patient_accounts where patient_id = t.patient_id for update;
  if a.patient_id is null or a.organization_id <> t.organization_id or a.branch_id <> t.branch_id
    or a.user_id is distinct from t.user_id or a.internal_email is null
    or a.internal_email !~ '^[0-9a-f]{32}@accounts[.]sro[.]invalid$'
    or a.operation_id is distinct from t.provision_operation_id
  then raise exception 'Recovery account mismatch' using errcode='42501'; end if;
  if a.state is distinct from 'pending_handover' or a.handover_hash is null
    or a.handover_expires_at is null or a.handover_expires_at > clock_timestamp()
    or a.password_changed_at is not null or a.allowed_session is not null
    or a.operated_by is distinct from t.provision_actor_id
  then raise exception 'Recovery account is not an expired pending handover' using errcode='42501'; end if;
  select * into u from auth.users where id = t.user_id;
  if u.id is null or u.email_confirmed_at is null or u.deleted_at is not null
    or (u.banned_until is not null and u.banned_until > clock_timestamp())
    or u.email is distinct from a.internal_email
  then raise exception 'Recovery Auth identity mismatch' using errcode='42501'; end if;
  if (select count(*) from auth.users where id = t.user_id) <> 1
    or (select count(*) from public.patients where user_id = t.user_id) <> 1
    or (select count(*) from public.role_assignments where user_id = t.user_id) <> 1
    or not exists(
      select 1 from public.role_assignments r
      where r.user_id = t.user_id and r.organization_id = t.organization_id and r.role = 'patient'
    )
    or not exists(select 1 from public.profiles where id = t.user_id and active)
    or not exists(
      select 1 from public.organization_memberships m
      where m.organization_id = t.organization_id and m.user_id = t.user_id and m.active
    )
    or not exists(
      select 1 from public.branch_memberships bm
      where bm.organization_id = t.organization_id and bm.branch_id = t.branch_id
        and bm.user_id = t.user_id and bm.active
    )
  then raise exception 'Recovery identity is not the single Patient principal' using errcode='42501'; end if;
  select * into z from clinic_private.patient_pilot_authorizations
    where pilot_id = t.pilot_id for share;
  if z.pilot_id is null or z.patient_id is distinct from t.patient_id
    or z.patient_code is distinct from t.patient_code
    or z.registration_request_id is distinct from t.pilot_request_id
    or z.organization_id is distinct from t.organization_id
    or z.branch_id is distinct from t.branch_id
    or z.doctor_user_id is distinct from t.provision_actor_id
    or z.state <> 'quarantined' or z.expected_fields->>'name' is distinct from t.patient_name
  then raise exception 'Recovery pilot is not the quarantined SRO0009 pilot' using errcode='42501'; end if;
  if not exists(
    select 1 from clinic_private.patient_operations o
    where o.operation_id = t.provision_operation_id and o.organization_id = t.organization_id
      and o.patient_id = t.patient_id and o.actor_id = t.provision_actor_id
      and o.purpose = 'provision' and o.phase = 'completed' and o.provider_uid = t.user_id
  ) then raise exception 'Recovery provisioning operation is not completed' using errcode='42501'; end if;
  if exists(
    select 1 from clinic_private.patient_operations o
    where o.patient_id = t.patient_id and o.phase <> 'completed'
      and o.operation_id is distinct from p_allowed_operation
  ) then raise exception 'Patient operation is awaiting review' using errcode='42501'; end if;
  return a;
end $$;
revoke all on function clinic_private.patient_account_recovery_live(clinic_private.patient_account_recovery_targets,uuid) from public,anon,authenticated,service_role;

create function public.patient_account_recovery_status(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; a clinic_private.patient_accounts; r clinic_private.patient_account_recoveries; ps text;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  perform clinic_private.patient_account_recovery_admin(p_actor,t.patient_id);
  select * into a from clinic_private.patient_accounts where patient_id = t.patient_id;
  select * into r from clinic_private.patient_account_recoveries where patient_id = t.patient_id;
  select state into ps from clinic_private.patient_pilot_authorizations where pilot_id = t.pilot_id;
  return jsonb_build_object(
    'recoveryId', r.recovery_id,
    'state', r.state,
    'reissueCount', r.reissue_count,
    'accountState', a.state,
    'pilotState', ps,
    'handoverExpiresAt', case when r.state = 'handover_pending' then r.handover_expires_at else a.handover_expires_at end,
    'handoverExpired',
      case when r.state = 'handover_pending' then r.handover_expires_at <= clock_timestamp()
           else a.handover_expires_at is not null and a.handover_expires_at <= clock_timestamp() end,
    'canSetup', r.recovery_id is null and a.state = 'pending_handover'
      and a.handover_expires_at is not null and a.handover_expires_at <= clock_timestamp()
      and ps = 'quarantined'
      and not exists(select 1 from clinic_private.patient_operations o where o.patient_id = t.patient_id and o.phase <> 'completed'),
    'canReset', r.state = 'prepared',
    'canHandover', r.state in ('claimed','handover_pending')
      and a.state = 'pending_handover' and a.handover_expires_at is not null
      and a.handover_expires_at > clock_timestamp(),
    'serverNow', clock_timestamp()
  );
end $$;
revoke all on function public.patient_account_recovery_status(uuid) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_status(uuid) to service_role;

create function public.patient_account_recovery_setup(p_actor uuid,p_attestation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; a clinic_private.patient_accounts; r clinic_private.patient_account_recoveries;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  perform clinic_private.patient_account_recovery_admin(p_actor,t.patient_id);
  if btrim(coalesce(p_attestation,'')) is distinct from t.attestation_text
  then raise exception 'Ownership attestation required' using errcode='42501'; end if;
  if exists(select 1 from clinic_private.patient_account_recoveries)
  then raise exception 'The one-time recovery is already prepared' using errcode='23505'; end if;
  a := clinic_private.patient_account_recovery_live(t);
  insert into clinic_private.patient_account_recoveries(
    recovery_key, organization_id, branch_id, patient_id, patient_code, user_id,
    pilot_id, admin_user_id, attestation, state
  ) values (
    t.recovery_key, t.organization_id, t.branch_id, t.patient_id, t.patient_code, t.user_id,
    t.pilot_id, t.admin_user_id, btrim(p_attestation), 'prepared'
  ) returning * into r;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(t.organization_id,t.branch_id,p_actor,'patient.account_recovery_prepared','patients',t.patient_id);
  return jsonb_build_object(
    'recoveryId', r.recovery_id, 'state', r.state, 'patientCode', t.patient_code,
    'patientName', t.patient_name, 'accountState', a.state,
    'originalHandoverExpiresAt', a.handover_expires_at, 'serverNow', clock_timestamp()
  );
end $$;
revoke all on function public.patient_account_recovery_setup(uuid,text) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_setup(uuid,text) to service_role;

create function public.patient_account_recovery_claim(p_actor uuid,p_operation uuid,p_worker uuid,p_proof text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; r clinic_private.patient_account_recoveries;
  a clinic_private.patient_accounts; op jsonb;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  perform clinic_private.patient_account_recovery_admin(p_actor,t.patient_id);
  if p_operation is null or p_worker is null or p_request is null
    or p_proof is null or p_proof !~ '^[A-Za-z0-9_-]{43}$'
  then raise exception 'Recovery operation refused' using errcode='42501'; end if;
  select * into r from clinic_private.patient_account_recoveries where patient_id = t.patient_id for update;
  if r.recovery_id is null or r.state <> 'prepared' or r.reissue_count <> 0
  then raise exception 'Recovery is not available for reset' using errcode='42501'; end if;
  a := clinic_private.patient_account_recovery_live(t);
  op := clinic_private.patient_operation_core(
    'claim', p_operation, t.organization_id, t.patient_id, p_actor, p_worker, p_proof,
    jsonb_build_object('purpose','reset','requestId',p_request)
  );
  if (op->>'operationId')::uuid is distinct from p_operation or op->>'phase' <> 'claimed'
  then raise exception 'Recovery operation was not claimed' using errcode='42501'; end if;
  update clinic_private.patient_account_recoveries
    set state = 'claimed', reissue_count = 1, operation_id = p_operation,
      worker_id = p_worker, proof_hash = sha256(convert_to(p_proof,'UTF8')),
      claimed_at = clock_timestamp(), last_error = null
    where recovery_id = r.recovery_id returning * into r;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(t.organization_id,t.branch_id,p_actor,'patient.account_recovery_reset_authorized','patients',t.patient_id);
  return jsonb_build_object(
    'recoveryId', r.recovery_id, 'state', r.state, 'patientId', t.patient_id,
    'patientCode', t.patient_code, 'operationId', p_operation, 'fence', op->>'fence'
  );
end $$;
revoke all on function public.patient_account_recovery_claim(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_claim(uuid,uuid,uuid,text,uuid) to service_role;

-- Recovery-specific reset domain. It never asserts physical identity verification; the exact
-- fictional-pilot attestation and live binding are the only substitute for this one target.
create function public.patient_account_recovery_reset(p_actor uuid,p_operation uuid,p_worker uuid,p_proof text,p_fence bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; r clinic_private.patient_account_recoveries;
  a clinic_private.patient_accounts; u auth.users;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  perform clinic_private.patient_account_recovery_admin(p_actor,t.patient_id);
  if p_operation is null or p_worker is null or p_fence is null or p_fence <= 0
    or p_proof is null or p_proof !~ '^[A-Za-z0-9_-]{43}$'
  then raise exception 'Recovery reset refused' using errcode='42501'; end if;
  select * into r from clinic_private.patient_account_recoveries where patient_id = t.patient_id for update;
  if r.recovery_id is null or r.state <> 'claimed' or r.reissue_count <> 1
    or r.operation_id is distinct from p_operation or r.worker_id is distinct from p_worker
    or r.proof_hash is distinct from sha256(convert_to(p_proof,'UTF8'))
  then raise exception 'Recovery reset refused' using errcode='42501'; end if;
  a := clinic_private.patient_account_recovery_live(t,p_operation);
  if a.operation_at > clock_timestamp() - interval '60 seconds'
  then raise exception 'Recovery cooldown required' using errcode='42501'; end if;
  select * into u from auth.users where id = t.user_id;
  if u.id is null or u.encrypted_password is null or u.encrypted_password = ''
    or exists(select 1 from public.role_assignments where user_id = t.user_id
      and (role <> 'patient' or organization_id <> t.organization_id))
    or exists(select 1 from public.patients where user_id = t.user_id and id <> t.patient_id)
  then raise exception 'Recovery identity is not eligible' using errcode='42501'; end if;
  update clinic_private.patient_accounts
    set state = 'resetting', operation_id = p_operation, operated_by = p_actor,
      operation_at = clock_timestamp(), handover_hash = null, handover_expires_at = null,
      allowed_session = null, session_valid_after = clock_timestamp()
    where patient_id = t.patient_id;
  perform clinic_private.patient_operation_core(
    'bind', p_operation, t.organization_id, t.patient_id, p_actor, p_worker, p_proof,
    jsonb_build_object('fence',p_fence,'userId',t.user_id,
      'beforeHash',encode(sha256(convert_to(u.encrypted_password,'UTF8')),'hex'))
  );
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(t.organization_id,t.branch_id,p_actor,'patient.account_recovery_reset_started','patients',t.patient_id);
  return jsonb_build_object(
    'patientId',t.patient_id,'patientCode',t.patient_code,'name',t.patient_name,
    'userId',t.user_id,'internalEmail',a.internal_email,'operationId',p_operation
  );
end $$;
revoke all on function public.patient_account_recovery_reset(uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_reset(uuid,uuid,uuid,text,bigint) to service_role;

create function public.patient_account_recovery_mark_handover(p_actor uuid,p_operation uuid,p_proof text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; r clinic_private.patient_account_recoveries;
  a clinic_private.patient_accounts; o clinic_private.patient_operations; z text;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  perform clinic_private.patient_account_recovery_admin(p_actor,t.patient_id);
  if p_operation is null or p_proof is null or p_proof !~ '^[A-Za-z0-9_-]{43}$'
  then raise exception 'Recovery handover marker refused' using errcode='42501'; end if;
  select * into r from clinic_private.patient_account_recoveries where patient_id = t.patient_id for update;
  if r.recovery_id is null or r.operation_id is distinct from p_operation
    or r.proof_hash is distinct from sha256(convert_to(p_proof,'UTF8'))
  then raise exception 'Recovery handover marker refused' using errcode='42501'; end if;
  select * into a from clinic_private.patient_accounts where patient_id = t.patient_id for update;
  if a.state <> 'pending_handover' or a.user_id is distinct from t.user_id
    or a.handover_hash is null or a.handover_expires_at is null
    or a.handover_expires_at <= clock_timestamp()
  then raise exception 'Recovery handover window unavailable' using errcode='42501'; end if;
  if r.state = 'handover_pending' then
    return jsonb_build_object(
      'recoveryId', r.recovery_id, 'state', r.state, 'handoverExpiresAt', r.handover_expires_at,
      'serverNow', clock_timestamp()
    );
  end if;
  if r.state <> 'claimed' or r.reissue_count <> 1
  then raise exception 'Recovery handover marker refused' using errcode='42501'; end if;
  select * into o from clinic_private.patient_operations where operation_id = p_operation for update;
  if o.operation_id is null or o.phase <> 'completed' or o.purpose <> 'reset'
    or o.patient_id <> t.patient_id or o.actor_id <> p_actor
    or o.proof_hash is distinct from r.proof_hash or o.provider_uid is distinct from t.user_id
  then raise exception 'Recovery reset is not completed' using errcode='42501'; end if;
  select state into z from clinic_private.patient_pilot_authorizations where pilot_id = t.pilot_id;
  if z <> 'quarantined' then raise exception 'Recovery pilot state changed' using errcode='42501'; end if;
  update clinic_private.patient_account_recoveries
    set state = 'handover_pending', handover_expires_at = a.handover_expires_at,
      handover_pending_at = clock_timestamp()
    where recovery_id = r.recovery_id returning * into r;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(t.organization_id,t.branch_id,p_actor,'patient.account_recovery_handover_pending','patients',t.patient_id);
  return jsonb_build_object(
    'recoveryId', r.recovery_id, 'state', r.state, 'handoverExpiresAt', r.handover_expires_at,
    'serverNow', clock_timestamp()
  );
end $$;
revoke all on function public.patient_account_recovery_mark_handover(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_mark_handover(uuid,uuid,text) to service_role;

create function public.patient_account_recovery_handover(p_actor uuid,p_operation uuid,p_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; r clinic_private.patient_account_recoveries;
  a clinic_private.patient_accounts; z text;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  perform clinic_private.patient_account_recovery_admin(p_actor,t.patient_id);
  if p_operation is null or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{43}$'
  then raise exception 'Recovery handover refused' using errcode='42501'; end if;
  select * into r from clinic_private.patient_account_recoveries where patient_id = t.patient_id for update;
  if r.recovery_id is null or r.operation_id is distinct from p_operation
    or r.state not in ('claimed','handover_pending')
  then raise exception 'Recovery handover refused' using errcode='42501'; end if;
  select * into a from clinic_private.patient_accounts where patient_id = t.patient_id for update;
  if a.state <> 'pending_handover' or a.user_id is distinct from t.user_id then
    raise exception 'Recovery handover refused' using errcode='42501';
  end if;
  if a.handover_expires_at is null or a.handover_expires_at <= clock_timestamp() then
    raise exception 'Handover expired — account needs review' using errcode='42501';
  end if;
  select state into z from clinic_private.patient_pilot_authorizations where pilot_id = t.pilot_id;
  if z <> 'quarantined' then raise exception 'Recovery pilot state changed' using errcode='42501'; end if;
  perform public.patient_account_command(
    'handover', p_actor, t.patient_id,
    jsonb_build_object('operationId',p_operation,
      'handoverHash',encode(sha256(convert_to(p_nonce,'UTF8')),'hex'))
  );
  update clinic_private.patient_account_recoveries
    set state = 'handover_confirmed', handover_at = clock_timestamp(), last_error = null
    where recovery_id = r.recovery_id returning * into r;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(t.organization_id,t.branch_id,p_actor,'patient.account_recovery_handover_confirmed','patients',t.patient_id);
  return jsonb_build_object(
    'recoveryId', r.recovery_id, 'state', r.state, 'handoverAt', r.handover_at,
    'serverNow', clock_timestamp()
  );
end $$;
revoke all on function public.patient_account_recovery_handover(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_handover(uuid,uuid,text) to service_role;

create function public.patient_account_recovery_first_change(p_actor uuid,p_patient uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; r clinic_private.patient_account_recoveries;
  a clinic_private.patient_accounts; z text;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  if p_actor is distinct from t.user_id or p_patient is distinct from t.patient_id
  then raise exception 'Recovery first-change marker refused' using errcode='42501'; end if;
  select * into r from clinic_private.patient_account_recoveries where patient_id = t.patient_id for update;
  if r.recovery_id is null then raise exception 'Recovery first-change marker refused' using errcode='42501'; end if;
  if r.state = 'completed' then return true; end if;
  if r.state <> 'handover_confirmed'
  then raise exception 'Recovery first-change marker refused' using errcode='42501'; end if;
  select * into a from clinic_private.patient_accounts where patient_id = t.patient_id for update;
  if a.state <> 'active' or a.user_id is distinct from t.user_id
    or a.password_changed_at is null or a.allowed_session is null
  then raise exception 'Recovery first change is not confirmed' using errcode='42501'; end if;
  select state into z from clinic_private.patient_pilot_authorizations where pilot_id = t.pilot_id;
  if z <> 'quarantined' then raise exception 'Recovery pilot state changed' using errcode='42501'; end if;
  update clinic_private.patient_account_recoveries
    set state = 'completed', first_change_at = a.password_changed_at,
      completed_at = clock_timestamp()
    where recovery_id = r.recovery_id;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(t.organization_id,t.branch_id,p_actor,'patient.account_recovery_completed','patients',t.patient_id);
  return true;
end $$;
revoke all on function public.patient_account_recovery_first_change(uuid,uuid) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_first_change(uuid,uuid) to service_role;

create function public.patient_account_recovery_quarantine(p_actor uuid,p_operation uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare t clinic_private.patient_account_recovery_targets; r clinic_private.patient_account_recoveries;
begin
  select * into strict t from clinic_private.patient_account_recovery_authority();
  perform clinic_private.patient_account_recovery_admin(p_actor,t.patient_id);
  select * into r from clinic_private.patient_account_recoveries where patient_id = t.patient_id for update;
  if r.recovery_id is null or r.operation_id is distinct from p_operation
  then raise exception 'Recovery quarantine refused' using errcode='42501'; end if;
  if r.state = 'completed' then raise exception 'Recovery quarantine refused' using errcode='42501'; end if;
  if r.state = 'quarantined' then return true; end if;
  if r.state not in ('claimed','handover_pending')
  then raise exception 'Recovery quarantine refused' using errcode='42501'; end if;
  update clinic_private.patient_account_recoveries
    set state = 'quarantined', last_error = left(coalesce(p_reason,'review required'),500)
    where recovery_id = r.recovery_id;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(t.organization_id,t.branch_id,p_actor,'patient.account_recovery_quarantined','patients',t.patient_id);
  return true;
end $$;
revoke all on function public.patient_account_recovery_quarantine(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.patient_account_recovery_quarantine(uuid,uuid,text) to service_role;

create function public.patient_account_handover_window(p_actor uuid,p_patient uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.patients; a clinic_private.patient_accounts;
begin
  select * into strict p from public.patients where id = p_patient;
  perform clinic_private.patient_account_actor(p.organization_id,p.home_branch_id,p.id,p_actor,true);
  select * into a from clinic_private.patient_accounts where patient_id = p.id;
  if a.patient_id is null then raise exception 'Patient account is unavailable' using errcode='42501'; end if;
  return jsonb_build_object(
    'patientId', p.id,
    'accountState', a.state,
    'handoverExpiresAt', a.handover_expires_at,
    'handoverExpired', a.handover_expires_at is not null and a.handover_expires_at <= clock_timestamp(),
    'serverNow', clock_timestamp()
  );
end $$;
revoke all on function public.patient_account_handover_window(uuid,uuid) from public,anon,authenticated;
grant execute on function public.patient_account_handover_window(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
