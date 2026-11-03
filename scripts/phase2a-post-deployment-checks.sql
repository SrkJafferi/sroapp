-- Read-only verification. Execute only after separately approved deployment.
begin read only;
do $check$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','clinic_private') and c.relkind in ('r','p'))<>35 then raise exception 'Unexpected clinic table inventory'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','clinic_private') and c.relkind in ('v','m','S','f','p')) then raise exception 'Unexpected clinic view/sequence/partition/foreign relation'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','clinic_private') and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity)<>35 then
    raise exception 'Expected 35 enabled/forced RLS clinic tables'; end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace)<>8 then raise exception 'Expected eight public RPCs'; end if;
  if exists(select 1 from pg_proc p where pronamespace='public'::regnamespace and
    (prosecdef or not coalesce(proconfig @> array['search_path=""'],false) or has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE'))) then
    raise exception 'Public RPC privilege/search-path mismatch'; end if;
  if exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner where p.pronamespace='clinic_private'::regnamespace
    and p.prosecdef and (not(r.rolsuper or r.rolbypassrls) or not coalesce(proconfig @> array['search_path=""'],false))) then
    raise exception 'Definer owner/search-path mismatch'; end if;
  if exists(select 1 from pg_class c where c.relnamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and c.relkind='r'
    and has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) then raise exception 'Anonymous table access'; end if;
  if exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
    and has_table_privilege('authenticated',c.oid,'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER')) then raise exception 'Direct client DML privilege'; end if;
  if (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
    and has_table_privilege('authenticated',c.oid,'SELECT'))<>34 then raise exception 'Authenticated SELECT inventory mismatch'; end if;
  if exists(select 1 from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where c.relnamespace='public'::regnamespace and c.relkind='r' and has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')
      and (c.relname,a.attname)<>('notification_recipients','read_at')) then raise exception 'Unexpected client UPDATE column'; end if;
  if not has_column_privilege('authenticated','public.notification_recipients','read_at','UPDATE') then raise exception 'Missing narrow read marker privilege'; end if;
  if has_table_privilege('authenticated','clinic_private.invitation_secrets','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Client invitation hash access'; end if;
  if exists(select 1 from pg_proc p where p.pronamespace='clinic_private'::regnamespace and p.prorettype='trigger'::regtype
    and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))) then raise exception 'Callable internal trigger'; end if;
  if exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
    and c.relname in ('appointment_slots','appointments','appointment_reservations','appointment_status_history','patient_assignments',
      'clinical_access_grants','patient_medical_history','clinical_encounters','encounter_vitals','prescriptions','prescription_items',
      'medical_documents','consultation_charges','payment_records','notifications','notification_recipients','audit_logs','doctor_leave')
    and has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'Service-role workflow/clinical access'; end if;
  if exists(select 1 from pg_constraint where connamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and not convalidated) then raise exception 'Unvalidated constraint'; end if;
  if (select count(*) from pg_constraint where conrelid='public.appointment_reservations'::regclass and contype='x')<>2 then raise exception 'Missing reservation exclusions'; end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist' and e.extversion='1.7' and n.nspname='extensions') then raise exception 'Extension mismatch'; end if;
  if exists(select 1 from auth.users) or exists(select 1 from storage.buckets) or exists(select 1 from storage.objects)
    or exists(select 1 from pg_roles where rolname='sro_phase2a5_runner') then raise exception 'Unexpected bootstrap/fixture state'; end if;
  if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations)
    is distinct from array['20261026024332','20261026024335','20261026024338'] then raise exception 'Unexpected migration history'; end if;
end $check$;
select 'Phase 2A structural/ACL checks passed; private API probe and advisors still required' as result;
rollback;
