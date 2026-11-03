-- Proposal: explicit approval required. Existing migrations and Auth settings stay unchanged.
begin;
alter table public.notifications add column doctor_id uuid, add column branch_id uuid;
alter table public.notifications add constraint notification_doctor_tenant
  foreign key (organization_id,doctor_id) references public.doctors(organization_id,id);
alter table public.notifications add constraint notification_branch_tenant
  foreign key (organization_id,branch_id) references public.branches(organization_id,id);
alter table public.notifications add constraint notification_doctor_branch_required
  check (doctor_id is null or branch_id is not null);
create index notification_doctor_target on public.notifications(organization_id,doctor_id)
  where doctor_id is not null;
create index notification_branch_target on public.notifications(organization_id,branch_id)
  where branch_id is not null;
create policy onboarding_notification_scope on public.notifications as restrictive for select to authenticated
  using (doctor_id is null or clinic_private.branch_role(organization_id,branch_id,array['admin']::public.clinic_role[]));

create table clinic_private.doctor_onboarding (
  invitation_id uuid primary key references public.doctor_invitations,
  user_id uuid not null references auth.users,
  fields jsonb not null,
  staged_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  doctor_id uuid references public.doctors,
  notification_id uuid unique references public.notifications,
  welcome_payload jsonb,
  welcome_status text not null default 'pending' check (welcome_status in ('pending','sending','sent','review')),
  first_attempt_at timestamptz,
  lease_id uuid, lease_until timestamptz,
  provider_message_id text check (length(provider_message_id)<=200),
  check ((completed_at is null)=(doctor_id is null)),
  check ((completed_at is null)=(notification_id is null)),
  check ((completed_at is null)=(welcome_payload is null)),
  check (welcome_status<>'sent' or provider_message_id is not null)
);
alter table clinic_private.doctor_onboarding enable row level security;
alter table clinic_private.doctor_onboarding force row level security;
revoke all on clinic_private.doctor_onboarding from public,anon,authenticated,service_role;
create index onboarding_user on clinic_private.doctor_onboarding(user_id);
create index onboarding_doctor on clinic_private.doctor_onboarding(doctor_id) where doctor_id is not null;

-- Service caller supplies only a verified Auth user ID and server-observed assurance.
-- No client can call this capability or supply authority directly.
create function public.phase2b_onboarding(
  p_action text,p_invitation uuid,p_hash bytea,p_user uuid default null,
  p_fields jsonb default null,p_aal text default null,p_origin text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations; s clinic_private.doctor_onboarding;
  did uuid; nid uuid; uid uuid; email text; completed timestamptz; branch_name text; department text;
begin
  if p_user is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,205));
  end if;
  select * into strict i from public.doctor_invitations where id=p_invitation for update;
  if p_action='receipt' then
    -- Recovery of a lost final HTTP response requires the already accepted verified identity.
    -- Does not accept a bearer token, assign roles, expose metadata or emit any side effect.
    email:=clinic_private.phase2b_verified_email(p_user);
    if i.status='accepted' and i.accepted_user_id=p_user and lower(i.email)=lower(email) and
      exists(select 1 from public.doctors where organization_id=i.organization_id and user_id=p_user and active) and
      (not exists(select 1 from auth.mfa_factors where user_id=p_user and status='verified') or p_aal='aal2') then
      return jsonb_build_object('closed',true);
    end if;
    raise exception 'Completed identity required' using errcode='42501';
  end if;
  -- Rechecks hash, expiry, revocation, organization, branch and inviter authority under lock.
  perform public.phase2b_invitation_preview(p_invitation,p_hash,p_user);
  if p_action='prepare' then
    if i.status<>'sent' then raise exception 'Invitation already used' using errcode='42501'; end if;
    select u.id into uid from auth.users u where lower(u.email)=lower(i.email) and u.deleted_at is null;
    return jsonb_build_object('existingUserId',uid);
  end if;
  email:=clinic_private.phase2b_verified_email(p_user);
  if lower(email)<>lower(i.email) then raise exception 'Identity mismatch' using errcode='42501'; end if;
  select * into s from clinic_private.doctor_onboarding where invitation_id=i.id for update;
  if s.invitation_id is not null and s.user_id<>p_user then
    raise exception 'Bound identity mismatch' using errcode='42501'; end if;
  if p_action='close' then
    if i.status<>'accepted' then raise exception 'Completion required' using errcode='42501'; end if;
    if exists(select 1 from auth.mfa_factors where user_id=p_user and status='verified') and
      p_aal is distinct from 'aal2' then raise exception 'MFA required' using errcode='42501'; end if;
    -- Retire consumed bearer proofs after the optional photo save; no new activation or resume.
    update clinic_private.invitation_secrets set token_hash=decode(
      replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex')
      where invitation_id=i.id and consumed_at is not null;
    return jsonb_build_object('closed',true);
  end if;
  if p_action='stage' then
    if i.status='accepted' then return jsonb_build_object('ready',true); end if;
    if p_fields is null or jsonb_typeof(p_fields)<>'object' or
      exists(select 1 from jsonb_object_keys(p_fields) k where k not in ('name','gender','experience')) or
      jsonb_typeof(p_fields->'name') is distinct from 'string' or
      length(btrim(p_fields->>'name')) not between 3 and 120 or
      coalesce(p_fields->>'gender','') not in ('Male','Female','Other','Not recorded') or
      (p_fields ? 'experience' and (jsonb_typeof(p_fields->'experience') is distinct from 'number' or
        (p_fields->>'experience')::numeric not between 0 and 80 or
        (p_fields->>'experience')::numeric<>trunc((p_fields->>'experience')::numeric))) then
      raise exception 'Invalid profile' using errcode='22023';
    end if;
    insert into clinic_private.doctor_onboarding(invitation_id,user_id,fields)
      values(i.id,p_user,p_fields) on conflict(invitation_id) do update set fields=excluded.fields;
    return jsonb_build_object('ready',true);
  end if;
  if p_action<>'complete' then raise exception 'Invalid operation' using errcode='22023'; end if;
  if exists(select 1 from auth.mfa_factors where user_id=p_user and status='verified') and
    p_aal is distinct from 'aal2' then raise exception 'MFA required' using errcode='42501'; end if;
  if i.status='accepted' then
    -- Historical accounts are preserved; no retroactive completion emails/notifications.
    select id into strict did from public.doctors
      where organization_id=i.organization_id and user_id=p_user and active;
    return jsonb_build_object('doctorId',did,'completed',true,'legacy',s.invitation_id is null);
  end if;
  if s.invitation_id is null or s.completed_at is not null then
    raise exception 'Saved registration required' using errcode='42501'; end if;
  if p_origin is null or not (p_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' or
    p_origin ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$') then
    raise exception 'Invalid server origin' using errcode='22023'; end if;
  -- Existing trusted acceptance atomically grants exactly the invited Doctor/branch role.
  if i.expires_at<=clock_timestamp() then raise exception 'Invitation expired' using errcode='42501'; end if;
  did:=public.phase2b_accept(p_user,i.id,p_hash);
  update public.doctors set name=btrim(s.fields->>'name'),gender=s.fields->>'gender',
    experience=case when s.fields ? 'experience' then (s.fields->>'experience')::integer else experience end
    where id=did and organization_id=i.organization_id and user_id=p_user;
  update public.profiles set name=btrim(s.fields->>'name') where id=p_user;
  completed:=clock_timestamp();
  select name into branch_name from public.branches where id=i.branch_id;
  select name into department from public.specializations where id=i.specialization_id;
  insert into public.notifications(organization_id,kind,title,message,created_at,doctor_id,branch_id)
    values(i.organization_id,'invitation','New Doctor Onboarded',
      left(format('%s has successfully completed registration and joined %s as a %s Doctor.',
        btrim(s.fields->>'name'),branch_name,department),250),completed,did,i.branch_id) returning id into nid;
  insert into public.notification_recipients(organization_id,notification_id,user_id)
    select distinct i.organization_id,nid,m.user_id from public.organization_memberships m
    join public.profiles p on p.id=m.user_id and p.active
    join public.branch_memberships b on b.organization_id=m.organization_id and b.user_id=m.user_id
      and b.branch_id=i.branch_id and b.active
    join public.role_assignments r on r.organization_id=m.organization_id and r.user_id=m.user_id and r.role='admin'
    where m.organization_id=i.organization_id and m.active;
  update clinic_private.doctor_onboarding set completed_at=completed,doctor_id=did,notification_id=nid,
    welcome_payload=jsonb_build_object('name',btrim(s.fields->>'name'),'email',email,
      'branch',branch_name,'department',department,'dashboardUrl',p_origin||'/doctor','templateVersion','v1')
    where invitation_id=i.id;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id,occurred_at)
    values(i.organization_id,i.branch_id,p_user,'auth.doctor_onboarding_completed','doctors',did,completed);
  return jsonb_build_object('doctorId',did,'completed',true,'legacy',false);
end $$;

-- Durable, leased outbox. Ambiguous sends are retried with the same frozen payload/key
-- only inside the provider's 24h idempotency window (23h conservative cutoff).
create function public.phase2b_welcome_delivery(p_id uuid,p_action text,p_lease uuid default null,p_message_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s clinic_private.doctor_onboarding; lease uuid;
begin
  select * into s from clinic_private.doctor_onboarding where invitation_id=p_id for update;
  if not found then return null; end if;
  if s.completed_at is null then raise exception 'Completion required' using errcode='42501'; end if;
  if p_action='claim' then
    if s.welcome_status in ('sent','review') or
      (s.welcome_status='sending' and s.lease_until>clock_timestamp()) then return null; end if;
    -- Suspend a queued "account ready" message after offboarding or an Auth email change.
    if not exists(select 1 from auth.users u
      join public.profiles p on p.id=u.id and p.active
      join public.doctors d on d.id=s.doctor_id and d.user_id=u.id and d.active
      join public.doctor_invitations i on i.id=s.invitation_id and i.organization_id=d.organization_id
      join public.organizations o on o.id=i.organization_id and o.active
      join public.branches b on b.id=i.branch_id and b.organization_id=o.id and b.active
      join public.organization_memberships m on m.organization_id=o.id and m.user_id=u.id and m.active
      join public.branch_memberships bm on bm.organization_id=o.id and bm.branch_id=b.id and bm.user_id=u.id and bm.active
      join public.role_assignments r on r.organization_id=o.id and r.user_id=u.id and r.role='doctor'
      join public.doctor_branch_assignments a on a.organization_id=o.id and a.doctor_id=d.id and a.branch_id=b.id and a.active
      where u.id=s.user_id and u.email_confirmed_at is not null and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<clock_timestamp())
        and lower(u.email)=lower(s.welcome_payload->>'email')) then
      update clinic_private.doctor_onboarding set welcome_status='review',lease_id=null,lease_until=null where invitation_id=p_id;
      return null;
    end if;
    if s.first_attempt_at<clock_timestamp()-interval '23 hours' then
      update clinic_private.doctor_onboarding set welcome_status='review',lease_id=null,lease_until=null where invitation_id=p_id;
      return null;
    end if;
    lease:=gen_random_uuid();
    update clinic_private.doctor_onboarding set welcome_status='sending',lease_id=lease,
      lease_until=clock_timestamp()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,clock_timestamp())
      where invitation_id=p_id;
    return jsonb_build_object('lease',lease,'payload',s.welcome_payload);
  end if;
  if p_action not in ('sent','failed') or s.welcome_status<>'sending' or
    p_lease is null or p_lease is distinct from s.lease_id then
    raise exception 'Delivery lease mismatch' using errcode='42501'; end if;
  if p_action='sent' and (p_message_id is null or length(p_message_id) not between 1 and 200) then
    raise exception 'Provider receipt required' using errcode='22023'; end if;
  update clinic_private.doctor_onboarding set welcome_status=case when p_action='sent' then 'sent' else 'pending' end,
    provider_message_id=case when p_action='sent' then p_message_id else provider_message_id end,
    lease_id=null,lease_until=null where invitation_id=p_id;
  return null;
end $$;

create or replace function public.phase2b_invitation_preview(p_id uuid,p_hash bytea,p_user uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations; did uuid; ready boolean:=false;
begin
  select * into i from public.doctor_invitations where id=p_id;
  if not found or p_hash is null or octet_length(p_hash)<>32 or i.expires_at<=clock_timestamp() or not exists(
    select 1 from clinic_private.invitation_secrets s where s.invitation_id=i.id and s.token_hash=p_hash
    and ((i.status='sent' and s.consumed_at is null) or
      (i.status='accepted' and i.accepted_user_id=p_user and s.consumed_at is not null))
  ) then raise exception 'Invalid invitation' using errcode='42501'; end if;
  perform clinic_private.phase2b_admin(i.invited_by,i.branch_id);
  if i.status='accepted' then
    if lower(clinic_private.phase2b_verified_email(p_user))<>lower(i.email) then
      raise exception 'Identity mismatch' using errcode='42501'; end if;
    select id into strict did from public.doctors where organization_id=i.organization_id and user_id=p_user and active;
  end if;
  if p_user is not null and lower(clinic_private.phase2b_verified_email(p_user))=lower(i.email) then
    select exists(select 1 from clinic_private.doctor_onboarding where invitation_id=i.id and user_id=p_user) into ready;
  end if;
  return jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'organizationId',i.organization_id,
    'branchId',i.branch_id,'branch',(select name from public.branches where id=i.branch_id),
    'specializationId',i.specialization_id,'specialization',(select name from public.specializations where id=i.specialization_id and organization_id=i.organization_id),
    'doctorId',did,'accepted',i.status='accepted','profileReady',ready or i.status='accepted');
end $$;
revoke all on function public.phase2b_onboarding(text,uuid,bytea,uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.phase2b_welcome_delivery(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.phase2b_onboarding(text,uuid,bytea,uuid,jsonb,text,text),
  public.phase2b_welcome_delivery(uuid,text,uuid,text) to service_role;
-- Preview retains its already restricted service-only ACL.
notify pgrst,'reload schema';
commit;
