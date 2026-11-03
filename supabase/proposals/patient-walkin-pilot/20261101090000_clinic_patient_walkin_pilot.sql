-- Phase 4B preparation only. Do not apply without separate explicit approval.
begin;
create table clinic_private.patient_pilot_authorizations (
  pilot_id uuid primary key default gen_random_uuid(),
  pilot_key text not null unique check (length(btrim(pilot_key)) between 8 and 64),
  organization_id uuid not null,
  branch_id uuid not null,
  doctor_user_id uuid not null references public.profiles(id),
  expected_fields jsonb not null,
  expected_fields_hash bytea not null check (octet_length(expected_fields_hash) = 32),
  registration_request_id uuid not null unique,
  state text not null default 'issued'
    check (state in ('issued','registering','registered','provisioning','provisioned','handover','completed','quarantined')),
  patient_id uuid unique references public.patients(id),
  patient_code text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  registered_at timestamptz,
  provisioned_at timestamptz,
  handover_at timestamptz,
  completed_at timestamptz,
  last_error text,
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  check (expires_at > created_at),
  check (patient_code is null or patient_code ~ '^SRO[0-9]{4,}$')
);
alter table clinic_private.patient_pilot_authorizations enable row level security;
alter table clinic_private.patient_pilot_authorizations force row level security;
revoke all on clinic_private.patient_pilot_authorizations from public, anon, authenticated, service_role;

create function clinic_private.patient_pilot_doctor_allowed(o uuid, b uuid, u uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.profiles p
    join public.organization_memberships m on m.organization_id = o and m.user_id = p.id and m.active
    join public.branch_memberships bm on bm.organization_id = o and bm.branch_id = b and bm.user_id = p.id and bm.active
    join public.role_assignments r on r.organization_id = o and r.user_id = p.id and r.role = 'doctor'
    join public.doctors d on d.organization_id = o and d.user_id = p.id and d.active
    join public.doctor_branch_assignments a on a.organization_id = o and a.doctor_id = d.id and a.branch_id = b and a.active
    join public.organizations org on org.id = o and org.active
    join public.branches br on br.organization_id = o and br.id = b and br.active
    join auth.users au on au.id = p.id
      and au.email_confirmed_at is not null and au.deleted_at is null
      and (au.banned_until is null or au.banned_until < now())
    where p.id = u and p.active
  )
$$;

create function clinic_private.patient_pilot_normalize(p_fields jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare nm text; em text; ph text; addr text; bg text; g text; ay numeric; f jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_fields) k
    where k not in ('name','ageYears','gender','phone','email','bloodGroup','address')
  ) then raise exception 'Unsupported pilot fields' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_fields) e where e.key <> 'ageYears' and jsonb_typeof(e.value) <> 'string')
  then raise exception 'Invalid pilot fields' using errcode='22023'; end if;
  nm := btrim(coalesce(p_fields->>'name',''));
  em := lower(btrim(coalesce(p_fields->>'email','')));
  ph := btrim(coalesce(p_fields->>'phone',''));
  addr := btrim(coalesce(p_fields->>'address',''));
  bg := coalesce(p_fields->>'bloodGroup','');
  g := p_fields->>'gender';
  if nm is null or length(nm) not between 3 and 200 or nm ~ '[[:cntrl:]]'
    or g is null or g not in ('Female','Male','Other','Prefer not to say')
    or length(em) > 254 or (em <> '' and em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or length(ph) > 30 or (ph <> '' and (ph !~ '^[+0-9 ()-]+$' or length(regexp_replace(ph,'[^0-9]','','g')) not between 7 and 20))
    or length(addr) > 500
    or bg not in ('','A+','A-','B+','B-','AB+','AB-','O+','O-')
    or coalesce(jsonb_typeof(p_fields->'ageYears'),'null') <> 'number'
  then raise exception 'Invalid pilot patient details' using errcode='22023'; end if;
  ay := (p_fields->>'ageYears')::numeric;
  if ay <> trunc(ay) or ay not between 0 and 120
  then raise exception 'Pilot age must be 0 to 120' using errcode='22023'; end if;
  f := jsonb_build_object('name',nm,'email',em,'phone',ph,'address',addr,'bloodGroup',bg,'gender',g,'ageYears',ay::smallint);
  return f;
end $$;

create function clinic_private.patient_pilot_hash(f jsonb)
returns bytea language sql immutable set search_path='' as $$
  select sha256(convert_to(f::text,'UTF8'))
$$;

create function public.patient_pilot_setup(p_key text, p_organization uuid, p_branch uuid, p_doctor uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f jsonb; r clinic_private.patient_pilot_authorizations; req uuid := gen_random_uuid();
begin
  if p_key is null or length(btrim(p_key)) not between 8 and 64
    or p_organization is null or p_branch is null or p_doctor is null
  then raise exception 'Invalid pilot setup' using errcode='22023'; end if;
  if not clinic_private.patient_pilot_doctor_allowed(p_organization, p_branch, p_doctor)
  then raise exception 'Pilot doctor is not authorized for this branch' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 408));
  if exists (select 1 from clinic_private.patient_pilot_authorizations)
  then raise exception 'The one-time pilot is already prepared' using errcode='23505'; end if;
  f := clinic_private.patient_pilot_normalize(p_fields);
  insert into clinic_private.patient_pilot_authorizations(
    pilot_key, organization_id, branch_id, doctor_user_id,
    expected_fields, expected_fields_hash, registration_request_id, state, expires_at
  ) values (
    btrim(p_key), p_organization, p_branch, p_doctor,
    f, clinic_private.patient_pilot_hash(f), req, 'issued', clock_timestamp() + interval '7 days'
  ) returning * into r;
  return jsonb_build_object(
    'pilotId', r.pilot_id, 'registrationRequestId', r.registration_request_id,
    'organizationId', r.organization_id, 'branchId', r.branch_id,
    'doctorUserId', r.doctor_user_id, 'expectedFields', r.expected_fields,
    'state', r.state, 'expiresAt', r.expires_at
  );
end $$;

create function public.patient_pilot_status(p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'pilotId', a.pilot_id, 'state', a.state,
    'registrationRequestId', a.registration_request_id,
    'organizationId', a.organization_id, 'branchId', a.branch_id,
    'expectedFields', a.expected_fields, 'patientCode', a.patient_code,
    'expiresAt', a.expires_at
  )
  from clinic_private.patient_pilot_authorizations a
  where a.doctor_user_id = p_actor
$$;

create function public.patient_pilot_begin(p_actor uuid, p_request uuid, p_branch uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r clinic_private.patient_pilot_authorizations; f jsonb; h bytea;
begin
  f := clinic_private.patient_pilot_normalize(p_fields);
  h := clinic_private.patient_pilot_hash(f);
  select * into r from clinic_private.patient_pilot_authorizations
    where registration_request_id = p_request for update;
  if r.pilot_id is null then return jsonb_build_object('pilot', false); end if;
  if r.doctor_user_id <> p_actor or r.branch_id <> p_branch
    or r.expected_fields_hash <> h or r.expires_at <= clock_timestamp()
    or not clinic_private.patient_pilot_doctor_allowed(r.organization_id, r.branch_id, p_actor)
  then raise exception 'Pilot registration refused' using errcode='42501'; end if;
  if r.state = 'issued' then
    update clinic_private.patient_pilot_authorizations
      set state = 'registering' where pilot_id = r.pilot_id returning * into r;
  elsif r.state <> 'registering' then
    raise exception 'Pilot registration already used' using errcode='42501';
  end if;
  return jsonb_build_object('pilot', true, 'pilotId', r.pilot_id, 'state', r.state);
end $$;

create function public.patient_pilot_bind(p_pilot uuid, p_actor uuid, p_patient uuid, p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r clinic_private.patient_pilot_authorizations;
begin
  select * into r from clinic_private.patient_pilot_authorizations where pilot_id = p_pilot for update;
  if r.pilot_id is null or r.doctor_user_id <> p_actor or r.state <> 'registering'
    or r.expires_at <= clock_timestamp()
    or not clinic_private.patient_pilot_doctor_allowed(r.organization_id, r.branch_id, p_actor)
  then raise exception 'Pilot binding refused' using errcode='42501'; end if;
  if r.patient_id is not null and r.patient_id <> p_patient
  then raise exception 'Pilot patient already bound' using errcode='42501'; end if;
  if not exists (
    select 1 from public.patients p
    where p.id = p_patient and p.organization_id = r.organization_id
      and p.home_branch_id = r.branch_id and p.patient_code = p_code and p.user_id is null
  ) then raise exception 'Pilot patient binding mismatch' using errcode='42501'; end if;
  update clinic_private.patient_pilot_authorizations
    set patient_id = p_patient, patient_code = p_code, state = 'registered', registered_at = clock_timestamp()
    where pilot_id = p_pilot returning * into r;
  return jsonb_build_object('pilotId', r.pilot_id, 'patientId', r.patient_id, 'patientCode', r.patient_code, 'state', r.state);
end $$;

create function public.patient_pilot_authorize_provision(p_actor uuid, p_patient uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r clinic_private.patient_pilot_authorizations;
begin
  select * into r from clinic_private.patient_pilot_authorizations where patient_id = p_patient for update;
  if r.pilot_id is null or r.doctor_user_id <> p_actor or r.state <> 'registered'
    or r.expires_at <= clock_timestamp()
    or not clinic_private.patient_pilot_doctor_allowed(r.organization_id, r.branch_id, p_actor)
  then raise exception 'Pilot provisioning refused' using errcode='42501'; end if;
  update clinic_private.patient_pilot_authorizations set state = 'provisioning' where pilot_id = r.pilot_id;
  return jsonb_build_object('pilotId', r.pilot_id, 'state', 'provisioning');
end $$;

create function public.patient_pilot_mark_provisioned(p_pilot uuid, p_patient uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update clinic_private.patient_pilot_authorizations
    set state = 'provisioned', provisioned_at = clock_timestamp()
    where pilot_id = p_pilot and patient_id = p_patient and state = 'provisioning';
  if not found then raise exception 'Pilot provisioning marker refused' using errcode='42501'; end if;
end $$;

create function public.patient_pilot_authorize_handover(p_actor uuid, p_patient uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r clinic_private.patient_pilot_authorizations;
begin
  select * into r from clinic_private.patient_pilot_authorizations where patient_id = p_patient for update;
  if r.pilot_id is null or r.doctor_user_id <> p_actor or r.state <> 'provisioned'
    or r.expires_at <= clock_timestamp()
    or not clinic_private.patient_pilot_doctor_allowed(r.organization_id, r.branch_id, p_actor)
  then raise exception 'Pilot handover refused' using errcode='42501'; end if;
  update clinic_private.patient_pilot_authorizations
    set state = 'handover', handover_at = clock_timestamp() where pilot_id = r.pilot_id;
  return jsonb_build_object('pilotId', r.pilot_id, 'state', 'handover');
end $$;

create function public.patient_pilot_complete(p_patient uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update clinic_private.patient_pilot_authorizations
    set state = 'completed', completed_at = clock_timestamp()
    where patient_id = p_patient and state = 'handover';
  return found;
end $$;

create function public.patient_pilot_quarantine(p_pilot uuid, p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update clinic_private.patient_pilot_authorizations
    set state = 'quarantined', last_error = left(coalesce(p_reason,'review required'),500)
    where pilot_id = p_pilot and state <> 'completed';
end $$;

revoke all on function clinic_private.patient_pilot_doctor_allowed(uuid,uuid,uuid),
  clinic_private.patient_pilot_normalize(jsonb),
  clinic_private.patient_pilot_hash(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.patient_pilot_setup(text,uuid,uuid,uuid,jsonb),
  public.patient_pilot_status(uuid),
  public.patient_pilot_begin(uuid,uuid,uuid,jsonb),
  public.patient_pilot_bind(uuid,uuid,uuid,text),
  public.patient_pilot_authorize_provision(uuid,uuid),
  public.patient_pilot_mark_provisioned(uuid,uuid),
  public.patient_pilot_authorize_handover(uuid,uuid),
  public.patient_pilot_complete(uuid),
  public.patient_pilot_quarantine(uuid,text) from public,anon,authenticated;
grant execute on function public.patient_pilot_setup(text,uuid,uuid,uuid,jsonb),
  public.patient_pilot_status(uuid),
  public.patient_pilot_begin(uuid,uuid,uuid,jsonb),
  public.patient_pilot_bind(uuid,uuid,uuid,text),
  public.patient_pilot_authorize_provision(uuid,uuid),
  public.patient_pilot_mark_provisioned(uuid,uuid),
  public.patient_pilot_authorize_handover(uuid,uuid),
  public.patient_pilot_complete(uuid),
  public.patient_pilot_quarantine(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
