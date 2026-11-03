-- Additive candidate. Explicit approval required before remote application.
begin;
lock table public.patients in share row exclusive mode;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or
  not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) or
  to_regprocedure('public.register_walk_in_patient(uuid,uuid,jsonb)') is null or
  to_regprocedure('public.phase2b_patient(uuid,jsonb)') is null or
  to_regclass('clinic_private.patient_intakes') is null then
   raise exception 'Reviewed PostgreSQL 17 owner and deployed registration workflows required';
 end if;
end $$;

-- Nullable for historical patients without reliable registration evidence.
-- Do not default old records to the deployment date or to a clinical visit date.
alter table public.patients add column registered_at timestamptz;
update public.patients p set registered_at=coalesce(
 (select min(a.occurred_at) from public.audit_logs a
   where a.organization_id=p.organization_id and a.entity_id=p.id and a.entity_type='patients'
    and a.action in('patient.walk_in_registered','auth.demo_patient_profile_saved')
    and isfinite(a.occurred_at) and a.occurred_at<=statement_timestamp()),
 (select min(i.created_at) from clinic_private.patient_intakes i
   where i.organization_id=p.organization_id and i.patient_id=p.id
    and isfinite(i.created_at) and i.created_at<=statement_timestamp())
);

-- Registration commands already insert patients in an atomic transaction. A single
-- invoker trigger covers both walk-in and verified online registration without
-- changing either command, Auth verification, numbering or row access.
create function clinic_private.patient_registration_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare recorded timestamptz; existing boolean;
begin
 if tg_op='UPDATE' then
   if new.registered_at is distinct from old.registered_at then
     raise exception 'Patient registration timestamp is immutable' using errcode='42501';
   end if;
   return new;
 end if;
 if new.registered_at is not null then
   raise exception 'Patient registration timestamp is database assigned' using errcode='42501';
 end if;
 -- BEFORE INSERT also executes during ON CONFLICT DO UPDATE. Preserve the
 -- original value (including an unknown historical NULL) for existing identities.
 select p.registered_at into recorded from public.patients p
   where p.organization_id=new.organization_id and p.id=new.id;
 existing:=found;
 if not existing and new.user_id is not null then
   select p.registered_at into recorded from public.patients p
     where p.organization_id=new.organization_id and p.user_id=new.user_id;
   existing:=found;
 end if;
 new.registered_at:=case when existing then recorded else clock_timestamp() end;
 return new;
end $$;
revoke all on function clinic_private.patient_registration_guard() from public,anon,authenticated,service_role;
create trigger patient_registration_assign before insert on public.patients
 for each row execute function clinic_private.patient_registration_guard();
create trigger patient_registration_immutable before update on public.patients
 for each row execute function clinic_private.patient_registration_guard();
comment on column public.patients.registered_at is
 'Immutable database-owned patient registration timestamp. Historical NULL means no reliable registration evidence was available. Read access follows existing patient RLS.';
notify pgrst,'reload schema';
commit;
