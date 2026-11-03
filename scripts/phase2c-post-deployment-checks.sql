begin read only;
do $$ begin
  if (select count(*) from pg_class where relnamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and relkind='r' and relrowsecurity and relforcerowsecurity)<>38 then raise exception 'Table RLS inventory changed'; end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('manage_clinic','publish_appointment_slots','save_patient_history') and not prosecdef and proconfig @> array['search_path=""'] and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute'))<>3 then raise exception 'Workspace RPC grant/path mismatch'; end if;
  if has_function_privilege('authenticated','clinic_private.workspace_admin(uuid)','execute') or has_function_privilege('anon','clinic_private.workspace_admin(uuid)','execute') then raise exception 'Internal authorization helper exposed'; end if;
  if exists(select 1 from pg_proc where pronamespace='clinic_private'::regnamespace and proname in ('manage_clinic','publish_appointment_slots','save_patient_history','workspace_admin') and (not prosecdef or not coalesce(proconfig @> array['search_path=""'],false))) then raise exception 'Unsafe private function configuration'; end if;
  if (select count(*) from pg_policy where polname='phase2b_mfa_required' and not polpermissive)<>34 then raise exception 'MFA policy drift'; end if;
  if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind='r' and has_table_privilege('authenticated',oid,'INSERT,DELETE,TRUNCATE')) then raise exception 'Unexpected direct clinical writes'; end if;
  if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations) is distinct from array['20261026024332','20261026024335','20261026024338','20261026111934','20261026123202'] then raise exception 'Unexpected migration history'; end if;
end $$;
select clock_timestamp() as checked_at,'Phase 2C command/RLS checks passed' as result;
rollback;
