-- Read-only assertions after the specifically approved migration, no fixtures/writes.
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name='registered_at' and data_type='timestamp with time zone' and is_nullable='YES' and column_default is null) then raise exception 'Registration column contract mismatch'; end if;
 if (select count(*) from pg_trigger where tgrelid='public.patients'::regclass and tgname in('patient_registration_assign','patient_registration_immutable') and tgenabled='O' and not tgisinternal)<>2 then raise exception 'Registration guards unavailable'; end if;
 if not exists(select 1 from pg_proc where oid='clinic_private.patient_registration_guard()'::regprocedure and not prosecdef and 'search_path=""'=any(proconfig)) then raise exception 'Registration guard execution configuration mismatch'; end if;
 if has_function_privilege('authenticated','clinic_private.patient_registration_guard()','EXECUTE') or has_function_privilege('anon','clinic_private.patient_registration_guard()','EXECUTE') or has_function_privilege('service_role','clinic_private.patient_registration_guard()','EXECUTE') then raise exception 'Unexpected direct trigger execution privilege'; end if;
 if not (select relrowsecurity from pg_class where oid='public.patients'::regclass) or not (select relrowsecurity from pg_class where oid='public.audit_logs'::regclass) then raise exception 'RLS required'; end if;
 if has_table_privilege('authenticated','public.patients','UPDATE') or has_table_privilege('authenticated','public.patients','INSERT') then raise exception 'Unexpected direct patient mutation grants'; end if;
end $$;
