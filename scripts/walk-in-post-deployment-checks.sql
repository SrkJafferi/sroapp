-- Read-only assertions. Run only after the two explicitly approved candidates are applied.
do $$ declare n integer; begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name='date_of_birth' and is_nullable='YES') then raise exception 'Age compatibility not activated'; end if;
 if not exists(select 1 from pg_class where oid='clinic_private.patient_intakes'::regclass and relrowsecurity and relforcerowsecurity) then raise exception 'Private intake RLS missing'; end if;
 if has_table_privilege('authenticated','clinic_private.patient_intakes','select,insert,update,delete') or has_table_privilege('service_role','clinic_private.patient_intakes','select,insert,update,delete') then raise exception 'Unexpected direct intake grants'; end if;
 select count(*) into n from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('register_walk_in_patient','staff_patient_intakes') and not p.prosecdef and p.proconfig @> array['search_path=""'];
 if n<>2 then raise exception 'Two invoker wrappers required'; end if;
 if has_function_privilege('anon','public.register_walk_in_patient(uuid,uuid,jsonb)','execute') or has_function_privilege('service_role','public.register_walk_in_patient(uuid,uuid,jsonb)','execute') or not has_function_privilege('authenticated','public.register_walk_in_patient(uuid,uuid,jsonb)','execute') then raise exception 'Staff RPC grants differ'; end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='patients' and policyname='patient_intake_demographics' and cmd='SELECT') then raise exception 'Demographic intake policy missing'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.patients'::regclass and tgname='walk_in_portal_signup_review' and tgenabled='O') then raise exception 'Signup review guard missing'; end if;
 if exists(select 1 from public.patients where date_of_birth is null and (age_years is null or age_recorded_on is null)) then raise exception 'Invalid age-only patient'; end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='patient_medical_history' and policyname='medical_history_read' and qual like '%patient_access%') then raise exception 'Clinical history policy changed'; end if;
end $$;
