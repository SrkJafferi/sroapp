-- READ ONLY. Run only after a separately approved migration; creates no fixtures/Auth users.
begin read only;
do $$
declare role_name text; f text;
begin
 if current_setting('server_version_num')::integer / 10000 <> 17 then raise exception 'Expected PostgreSQL 17'; end if;
 if not exists(select 1 from pg_class where oid='clinic_private.patient_operations'::regclass and relrowsecurity and relforcerowsecurity) then raise exception 'Operation RLS missing'; end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(role_name,'clinic_private.patient_operations','select,insert,update,delete') or has_any_column_privilege(role_name,'clinic_private.patient_operations','select,insert,update') then raise exception 'Unexpected operation table privileges'; end if;
  foreach f in array array['clinic_private.patient_operation_core(text,uuid,uuid,uuid,uuid,uuid,text,jsonb)','clinic_private.patient_operation_authorize(uuid,uuid,text,uuid)','clinic_private.patient_account_command_v1(text,uuid,uuid,jsonb)','clinic_private.patient_account_session_v1(uuid)'] loop
   if has_function_privilege(role_name,f,'execute') then raise exception 'Private function exposed'; end if;
  end loop;
 end loop;
 foreach f in array array['public.patient_account_operation(text,uuid,uuid,uuid,uuid,text,jsonb)','public.patient_account_command(text,uuid,uuid,jsonb)'] loop
  if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute') or not has_function_privilege('service_role',f,'execute') then raise exception 'Incorrect service RPC grant'; end if;
  if not exists(select 1 from pg_proc where oid=f::regprocedure and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Unsafe function configuration'; end if;
 end loop;
 if position('patient_account_session(auth.uid())' in pg_get_functiondef('clinic_private.phase2b_assurance()'::regprocedure))=0 then raise exception 'New session assurance wrapper missing'; end if;
 if exists(select 1 from clinic_private.patient_operations o join public.patients p on p.id=o.patient_id where o.organization_id<>p.organization_id) then raise exception 'Tenant binding mismatch'; end if;
end $$;
select purpose,phase,count(*) from clinic_private.patient_operations group by purpose,phase;
rollback;
