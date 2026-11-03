-- Proposal only: explicit remote approval required.
-- Reason: legacy invitation signups created an Auth identity through the app's signup route
-- (user_metadata demo_only=true) and never completed email verification. The single-email
-- onboarding candidate intentionally never force-confirms that identity, so registration stalls.
-- This additive migration replaces only public.phase2b_onboarding and changes only 'prepare':
-- it reports recoverable=true solely when database evidence proves the pending identity was
-- created by this application inside a previously delivered invitation for the same email/name,
-- has never been confirmed or signed in, holds no profile/role/membership/doctor/MFA access,
-- and the current invitation proof (hash, status sent, expiry, inviter) is valid.
-- Auth confirmation/password mutation stays in the server route and rechecks GoTrue immediately
-- before each admin update. Verified accounts and accounts with clinic access are never eligible.
begin;
create or replace function public.phase2b_onboarding(
  p_action text,p_invitation uuid,p_hash bytea,p_user uuid default null,
  p_fields jsonb default null,p_aal text default null,p_origin text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations; s clinic_private.doctor_onboarding;
  did uuid; nid uuid; uid uuid; email text; completed timestamptz; branch_name text; department text;
  recoverable boolean:=false;
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
    -- Recovery eligibility is computed from server-controlled Auth and invitation history only.
    -- No client input contributes; a verified identity or any clinic access makes it false.
    select exists (
      select 1 from auth.users u
      where u.id=uid and lower(u.email)=lower(i.email)
        and u.email_confirmed_at is null and u.last_sign_in_at is null
        and u.confirmation_sent_at is not null
        and (u.banned_until is null or u.banned_until<clock_timestamp())
        and u.raw_user_meta_data->>'demo_only'='true'
        and nullif(btrim(u.raw_user_meta_data->>'name'),'') is not null
        and (select count(*) from auth.users x
          where lower(x.email)=lower(i.email) and x.deleted_at is null)=1
        and exists(select 1 from auth.identities ai where ai.user_id=u.id and ai.provider='email')
        and not exists(select 1 from auth.identities ai where ai.user_id=u.id and ai.provider<>'email')
        and not exists(select 1 from public.profiles p where p.id=u.id)
        and not exists(select 1 from public.doctors d where d.user_id=u.id)
        and not exists(select 1 from public.role_assignments r where r.user_id=u.id)
        and not exists(select 1 from public.organization_memberships m where m.user_id=u.id)
        and not exists(select 1 from public.branch_memberships b where b.user_id=u.id)
        and not exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified')
        and exists (
          select 1 from public.doctor_invitations h
          join clinic_private.invitation_secrets hs on hs.invitation_id=h.id
          where h.id<>i.id and h.organization_id=i.organization_id
            and lower(h.email)=lower(i.email) and h.status in ('draft','sent','revoked')
            and h.sent_at is not null
            and u.created_at between h.sent_at and h.expires_at
            and h.name=u.raw_user_meta_data->>'name'
            and (hs.consumed_at is null or hs.consumed_at>=u.created_at)
        )
    ) into recoverable;
    return jsonb_build_object('existingUserId',uid,'recoverable',recoverable);
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
revoke all on function public.phase2b_onboarding(text,uuid,bytea,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.phase2b_onboarding(text,uuid,bytea,uuid,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
commit;
