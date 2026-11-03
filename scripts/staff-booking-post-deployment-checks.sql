-- Read-only assertions: run after approved deployment. No fixtures or clinical writes.
do $$ declare f record; begin
 if current_setting('server_version_num')::int/10000<>17 then raise exception 'PostgreSQL 17 required'; end if;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','clinic_private') and p.proname in ('book_appointment','read_profile','save_profile','get_clinic_profile','save_clinic_profile') loop
   if f.prosecdef is distinct from (f.nspname='clinic_private') or not ('search_path=""'=any(f.proconfig)) then
     raise exception 'Unexpected execution configuration: %.%',f.nspname,f.proname; end if;
   if not has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') then
     raise exception 'Unexpected execute privilege: %.%',f.nspname,f.proname; end if;
 end loop;
 if position('clinic_private.transition_appointment(a.id' in pg_get_functiondef('clinic_private.book_appointment(uuid,uuid,text,public.appointment_type,public.appointment_source)'::regprocedure))=0 or
  position('patient.blood_group.updated' in pg_get_functiondef('clinic_private.save_profile(uuid,text,uuid,jsonb,text,uuid)'::regprocedure))=0 then
  raise exception 'Reviewed command behavior is absent'; end if;
 if has_table_privilege('authenticated','public.patient_medical_history','UPDATE') then raise exception 'Unexpected direct history update grant'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Public table without RLS'; end if;
end $$;
