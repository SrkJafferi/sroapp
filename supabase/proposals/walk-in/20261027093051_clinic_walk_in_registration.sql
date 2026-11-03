-- Additive staff intake. Requires the separately reviewed Age candidate first. Remote approval required.
begin;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) or to_regprocedure('clinic_private.patient_number_guard()') is null or
   not exists(select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name='age_years') or
   exists(select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name='date_of_birth' and is_nullable<>'YES') then
   raise exception 'PostgreSQL 17, deployed numbering and approved Age migration required'; end if;
end $$;

create table clinic_private.patient_intakes (
 organization_id uuid not null,patient_id uuid not null,branch_id uuid not null,
 created_by uuid not null references public.profiles,request_id uuid not null,fields_hash bytea not null check(octet_length(fields_hash)=32),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 primary key(created_by,request_id),unique(patient_id),check(expires_at>created_at),
 foreign key(organization_id,patient_id,branch_id) references public.patient_branches(organization_id,patient_id,branch_id)
);
create index patient_intake_scope on clinic_private.patient_intakes(organization_id,branch_id,created_by,expires_at);
alter table clinic_private.patient_intakes enable row level security;
alter table clinic_private.patient_intakes force row level security;
revoke all on clinic_private.patient_intakes from public,anon,authenticated,service_role;

create function clinic_private.intake_staff_allowed(o uuid,b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.branches br where (br.organization_id,br.id)=(o,b) and br.active and (
  clinic_private.branch_role(o,b,array['admin']::public.clinic_role[]) or
  (clinic_private.branch_role(o,b,array['doctor']::public.clinic_role[]) and exists(
    select 1 from public.doctors d join public.doctor_branch_assignments a on (a.organization_id,a.doctor_id)=(d.organization_id,d.id)
    where d.organization_id=o and d.user_id=auth.uid() and d.active and a.branch_id=b and a.active))))
$$;
create function clinic_private.can_read_intake(o uuid,p uuid,b uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from clinic_private.patient_intakes i
  where i.organization_id=o and i.patient_id=p and (b is null or i.branch_id=b) and i.created_by=auth.uid()
   and i.expires_at>now() and clinic_private.intake_staff_allowed(o,i.branch_id))
$$;

create function clinic_private.register_walk_in(p_branch_id uuid,p_request_id uuid,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare br public.branches; i clinic_private.patient_intakes; pid uuid; code text; h bytea;
 nm text; em text; ph text; addr text; bg text; g text; ay smallint; normalized jsonb;
begin
 if auth.uid() is null or not clinic_private.phase2b_assurance() then raise exception 'Verified staff session required' using errcode='42501'; end if;
 perform clinic_private.phase2b_verified_email(auth.uid());
 select * into br from public.branches where id=p_branch_id and active for share;
 if not found or not clinic_private.intake_staff_allowed(br.organization_id,br.id) then raise exception 'Authorized branch staff required' using errcode='42501'; end if;
 -- Pin actual membership/role/Doctor assignment, then recheck after any transaction lock wait.
 perform 1 from public.organizations where id=br.organization_id for share;
 perform 1 from public.profiles where id=auth.uid() for share;
 perform 1 from public.organization_memberships where organization_id=br.organization_id and user_id=auth.uid() for share;
 perform 1 from public.branch_memberships where organization_id=br.organization_id and branch_id=br.id and user_id=auth.uid() for share;
 perform 1 from public.role_assignments where organization_id=br.organization_id and user_id=auth.uid() order by role for share;
 perform 1 from public.doctors where organization_id=br.organization_id and user_id=auth.uid() for share;
 perform 1 from public.doctor_branch_assignments where organization_id=br.organization_id and branch_id=br.id
   and doctor_id in(select id from public.doctors where organization_id=br.organization_id and user_id=auth.uid()) for share;
 if not clinic_private.intake_staff_allowed(br.organization_id,br.id) then raise exception 'Staff authorization changed' using errcode='42501'; end if;
 perform clinic_private.phase2b_verified_email(auth.uid());
 if p_request_id is null or p_fields is null or jsonb_typeof(p_fields)<>'object' or exists(
   select 1 from jsonb_object_keys(p_fields) k where k not in('name','ageYears','gender','phone','email','bloodGroup','address')) then
   raise exception 'Unsupported registration fields' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(p_fields) e where e.key<>'ageYears' and jsonb_typeof(e.value)<>'string') then raise exception 'Invalid text fields' using errcode='22023'; end if;
 nm:=btrim(p_fields->>'name');em:=lower(btrim(coalesce(p_fields->>'email','')));ph:=btrim(coalesce(p_fields->>'phone',''));
 addr:=btrim(coalesce(p_fields->>'address',''));bg:=coalesce(p_fields->>'bloodGroup','');g:=p_fields->>'gender';
 if nm is null or length(nm) not between 3 and 200 or nm~'[[:cntrl:]]' or g is null or g not in('Female','Male','Other','Prefer not to say') or
  length(em)>254 or (em<>'' and em!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or
  length(ph)>30 or (ph<>'' and (ph!~'^[+0-9 ()-]+$' or length(regexp_replace(ph,'[^0-9]','','g')) not between 7 and 20)) or
  length(addr)>500 or bg not in('','A+','A-','B+','B-','AB+','AB-','O+','O-') or
  coalesce(jsonb_typeof(p_fields->'ageYears'),'null')<>'number' then raise exception 'Invalid patient details' using errcode='22023'; end if;
 if (p_fields->>'ageYears')::numeric<>trunc((p_fields->>'ageYears')::numeric) or (p_fields->>'ageYears')::numeric not between 0 and 120 then raise exception 'Age must be 0 to 120' using errcode='22023'; end if;
 ay:=(p_fields->>'ageYears')::smallint;
 normalized:=jsonb_build_object('name',nm,'email',em,'phone',ph,'address',addr,'bloodGroup',bg,'gender',g,'ageYears',ay);
 h:=sha256(convert_to(normalized::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,207));
 select * into i from clinic_private.patient_intakes where created_by=auth.uid() and request_id=p_request_id;
 if found then
  if i.branch_id<>br.id or i.fields_hash<>h then raise exception 'Registration request was already used; check the patient directory' using errcode='23505'; end if;
  select patient_code into strict code from public.patients where id=i.patient_id;
  return jsonb_build_object('id',i.patient_id,'patientCode',code);
 end if;
 if (select count(*) from clinic_private.patient_intakes where created_by=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'Staff intake rate limit reached' using errcode='54000'; end if;
 insert into public.patients(organization_id,user_id,home_branch_id,name,initials,date_of_birth,age_years,age_recorded_on,gender,phone,email,address)
 values(br.organization_id,null,br.id,nm,upper(left(split_part(nm,' ',1),1)||left(split_part(nm,' ',2),1)),null,ay,current_date,g,ph,em,addr)
 returning id,patient_code into pid,code;
 insert into public.patient_branches(organization_id,patient_id,branch_id) values(br.organization_id,pid,br.id);
 -- Only intake blood group is recorded. Other clinical history remains explicitly unreviewed.
 insert into public.patient_medical_history(organization_id,patient_id,blood_group,updated_by) values(br.organization_id,pid,nullif(bg,''),auth.uid());
 insert into clinic_private.patient_intakes(organization_id,patient_id,branch_id,created_by,request_id,fields_hash)
  values(br.organization_id,pid,br.id,auth.uid(),p_request_id,h);
 insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
  values(br.organization_id,br.id,auth.uid(),'patient.walk_in_registered','patients',pid);
 return jsonb_build_object('id',pid,'patientCode',code);
end $$;

create function clinic_private.staff_patient_intakes(o uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('patientId',i.patient_id,'branchId',i.branch_id,'createdBy',i.created_by,'expiresAt',i.expires_at,'bloodGroup',h.blood_group,'clinicalAccess',clinic_private.care_access(i.organization_id,i.patient_id,i.branch_id,false))),'[]'::jsonb)
 from clinic_private.patient_intakes i join public.patient_medical_history h on (h.organization_id,h.patient_id)=(i.organization_id,i.patient_id)
 where i.organization_id=o and clinic_private.can_read_intake(o,i.patient_id,i.branch_id)
$$;
create function public.register_walk_in_patient(p_branch_id uuid,p_request_id uuid,p_fields jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select clinic_private.register_walk_in(p_branch_id,p_request_id,p_fields) $$;
create function public.staff_patient_intakes(p_organization_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select clinic_private.staff_patient_intakes(p_organization_id) $$;

-- Demographic intake visibility only. No care_access/history/encounter/document policy is widened.
create policy patient_intake_demographics on public.patients for select to authenticated
 using(clinic_private.can_read_intake(organization_id,id));
create or replace function clinic_private.can_book(o uuid,b uuid,d uuid,p uuid,source public.appointment_source) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and clinic_private.in_branch(o,b) and coalesce((
  (clinic_private.owns_patient(o,p) and source='patient') or clinic_private.branch_role(o,b,array['admin']::public.clinic_role[]) or
  (clinic_private.branch_role(o,b,array['doctor']::public.clinic_role[]) and exists(
   select 1 from public.doctors dr where dr.organization_id=o and dr.id=d and dr.active and dr.user_id=auth.uid() and (
    exists(select 1 from public.patient_assignments a where a.organization_id=o and a.patient_id=p and a.branch_id=b and a.doctor_id=d and a.active) or
    (source='walk_in' and clinic_private.can_read_intake(o,p,b)))))
 ),false)
$$;

-- Contact matches are review signals, never proof of ownership or automatic account linking.
-- Existing portal profile upserts continue unchanged. A verified new user matching a walk-in
-- must obtain clinic identity review before a separate, approved linking operation.
create function clinic_private.guard_walk_in_portal_signup() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.user_id is not null and not exists(select 1 from public.patients where organization_id=new.organization_id and user_id=new.user_id) and exists(
  select 1 from public.patients p join clinic_private.patient_intakes i on i.patient_id=p.id and i.organization_id=p.organization_id
  where p.organization_id=new.organization_id and p.user_id is null and (
   (btrim(new.email)<>'' and lower(btrim(p.email))=lower(btrim(new.email))) or
   (length(regexp_replace(new.phone,'[^0-9]','','g'))>=7 and regexp_replace(p.phone,'[^0-9]','','g')=regexp_replace(new.phone,'[^0-9]','','g')))) then
   raise exception 'Please contact the clinic to complete identity review before portal registration' using errcode='P2101';
 end if;
 return new;
end $$;
revoke all on function clinic_private.guard_walk_in_portal_signup() from public,anon,authenticated,service_role;
create trigger walk_in_portal_signup_review before insert on public.patients for each row execute function clinic_private.guard_walk_in_portal_signup();
revoke all on function clinic_private.intake_staff_allowed(uuid,uuid),clinic_private.can_read_intake(uuid,uuid,uuid),
 clinic_private.register_walk_in(uuid,uuid,jsonb),clinic_private.staff_patient_intakes(uuid),public.register_walk_in_patient(uuid,uuid,jsonb),public.staff_patient_intakes(uuid)
 from public,anon,authenticated,service_role;
grant execute on function clinic_private.intake_staff_allowed(uuid,uuid),clinic_private.can_read_intake(uuid,uuid,uuid),
 clinic_private.register_walk_in(uuid,uuid,jsonb),clinic_private.staff_patient_intakes(uuid),public.register_walk_in_patient(uuid,uuid,jsonb),public.staff_patient_intakes(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
