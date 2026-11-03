-- Independent additive candidate. Explicit approval required before remote application.
begin;
lock table public.patients in share row exclusive mode;
do $$ begin
  if current_setting('server_version_num')::integer/10000<>17 or
    not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) or
    to_regprocedure('public.phase2b_patient(uuid,jsonb)') is null then
    raise exception 'Reviewed PostgreSQL 17 owner and existing registration command required';
  end if;
  -- There is no patients.created_at to infer historic registration order. Pin the reviewed baseline.
  if (select count(*) from public.patients)<>1 or not exists(
    select 1 from public.patients where id='398cf267-bc60-41a4-91e6-478dcd86a069'
      and organization_id='88645fbe-34da-48aa-a509-c24441b7cf72' and name='Amina Noor'
  ) then raise exception 'Patient baseline changed; stop and review the backfill'; end if;
end $$;

create table clinic_private.patient_number_counter (
  singleton boolean primary key default true check(singleton),
  last_number bigint not null check(last_number>0)
);
alter table clinic_private.patient_number_counter enable row level security;
alter table clinic_private.patient_number_counter force row level security;
revoke all on clinic_private.patient_number_counter from public,anon,authenticated,service_role;
insert into clinic_private.patient_number_counter(last_number) values(1);

alter table public.patients add column patient_number bigint;
update public.patients set patient_number=1;
alter table public.patients alter column patient_number set not null;
alter table public.patients add constraint patient_number_positive check(patient_number>0);
alter table public.patients add constraint patient_number_unique unique(patient_number);
-- Text is returned to JS so large bigint identifiers never pass through floating-point formatting.
alter table public.patients add column patient_code text generated always as (
  'SRO'||lpad(patient_number::text,greatest(4,length(patient_number::text)),'0')
) stored not null;

create function clinic_private.patient_number_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare n bigint;
begin
  if tg_op='UPDATE' then
    if new.patient_number is distinct from old.patient_number then
      raise exception 'Patient number is immutable' using errcode='42501';
    end if;
    return new;
  end if;
  if new.patient_number is not null then
    raise exception 'Patient numbers are database assigned' using errcode='42501';
  end if;
  -- Lock persists to transaction end. Counter changes roll back with the complete registration.
  -- This invoker trigger needs no extra definer privilege: approved provisioning already runs
  -- as its trusted owner. No counter/allocator privilege is granted to ordinary or service clients.
  perform 1 from clinic_private.patient_number_counter where singleton for update;
  if not found then raise exception 'Patient numbering is unavailable' using errcode='23514'; end if;
  -- ON CONFLICT DO UPDATE executes BEFORE INSERT. Reuse this row's existing identifier so
  -- normal profile upserts (and ignored existing-key inserts) never advance the counter.
  select p.patient_number into n from public.patients p where p.id=new.id;
  if n is null and new.user_id is not null then
    select p.patient_number into n from public.patients p
      where p.organization_id=new.organization_id and p.user_id=new.user_id;
  end if;
  if n is null then
    update clinic_private.patient_number_counter set last_number=last_number+1
      where singleton returning last_number into n;
  end if;
  new.patient_number:=n;
  return new;
end $$;
revoke all on function clinic_private.patient_number_guard() from public,anon,authenticated,service_role;
create trigger patient_number_allocate before insert on public.patients
  for each row execute function clinic_private.patient_number_guard();
create trigger patient_number_immutable before update of patient_number on public.patients
  for each row execute function clinic_private.patient_number_guard();
comment on column public.patients.patient_number is 'Immutable global SRO identifier, allocated transactionally by the database. UUID remains the relational primary key.';
notify pgrst,'reload schema';
commit;
