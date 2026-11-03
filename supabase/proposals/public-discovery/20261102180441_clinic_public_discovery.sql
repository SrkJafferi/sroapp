begin;
-- Dedicated, non-exposed publication schema. No clinical-table grants or policy changes.
create schema clinic_discovery;
revoke all on schema clinic_discovery from public, anon, authenticated, service_role;
create table clinic_discovery.publications (
  organization_id uuid not null references public.organizations(id),
  branch_id uuid,
  doctor_id uuid,
  department_id uuid,
  published boolean not null default false,
  approved_at timestamptz not null default now(),
  constraint one_public_entity check (num_nonnulls(branch_id,doctor_id,department_id)=1),
  unique nulls not distinct (organization_id,branch_id,doctor_id,department_id),
  foreign key (organization_id,branch_id) references public.branches(organization_id,id),
  foreign key (organization_id,doctor_id) references public.doctors(organization_id,id),
  foreign key (organization_id,department_id) references public.specializations(organization_id,id)
);
alter table clinic_discovery.publications enable row level security;
alter table clinic_discovery.publications force row level security;
revoke all on clinic_discovery.publications from public, anon, authenticated, service_role;

-- Deliberately anonymous, read-only publication boundary; never an identity/clinical lookup.
-- Only the migration operator can approve/revoke listings. No implicit active=>public rule.
create function clinic_discovery.read_feed(p_organization_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with published as (
    select p.* from clinic_discovery.publications p
    join public.organizations o on o.id=p.organization_id and o.active
    where p.organization_id=p_organization_id and p.published
  ), branches as (
    select b.id,b.name,b.address from public.branches b
    join published p on p.branch_id=b.id and p.organization_id=b.organization_id
    where b.active
  ), departments as (
    select s.id,s.name,s.description from public.specializations s
    join published p on p.department_id=s.id and p.organization_id=s.organization_id
  ), assignments as (
    select a.doctor_id,a.branch_id from public.doctor_branch_assignments a
    join branches b on b.id=a.branch_id
    where a.organization_id=p_organization_id and a.active
  ), doctors as (
    select d.id,d.name,d.specialization_id from public.doctors d
    join published p on p.doctor_id=d.id and p.organization_id=d.organization_id
    join departments s on s.id=d.specialization_id
    where d.active and exists(select 1 from assignments a where a.doctor_id=d.id)
  )
  select jsonb_build_object(
    'version',1,
    'branches',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'name',b.name,'location',coalesce(nullif(b.address,''),'Location not published')
    ) order by b.name,b.id) from branches b),'[]'::jsonb),
    'doctors',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'name',d.name,'specialization',s.name,
      'branchIds',(select jsonb_agg(a.branch_id order by a.branch_id) from assignments a where a.doctor_id=d.id)
    ) order by d.name,d.id) from doctors d join departments s on s.id=d.specialization_id),'[]'::jsonb),
    'departments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'description',coalesce(nullif(s.description,''),'Description not published'),
      'branchIds',coalesce((select jsonb_agg(distinct a.branch_id order by a.branch_id)
        from assignments a join doctors d on d.id=a.doctor_id where d.specialization_id=s.id),'[]'::jsonb),
      'doctorIds',coalesce((select jsonb_agg(d.id order by d.id) from doctors d where d.specialization_id=s.id),'[]'::jsonb)
    ) order by (s.name='General Checkup') desc,s.name,s.id) from departments s),'[]'::jsonb)
  );
$$;
revoke all on function clinic_discovery.read_feed(uuid) from public,anon,authenticated,service_role;
grant usage on schema clinic_discovery to anon,authenticated;
grant execute on function clinic_discovery.read_feed(uuid) to anon,authenticated;
create function public.get_public_discovery(p_organization_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select clinic_discovery.read_feed(p_organization_id);
$$;
revoke all on function public.get_public_discovery(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_discovery(uuid) to anon,authenticated;
comment on function public.get_public_discovery(uuid) is 'Explicit operator-approved public catalog only; no patient, Auth, clinical or contact fields.';
commit;
