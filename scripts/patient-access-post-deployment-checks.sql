-- Read-only assertions after separately approved deployment. No Auth/clinical fixture creation.
begin read only;
do $$
declare f text; r text;
begin
 if current_setting('server_version_num')::integer/10000<>17 then raise exception 'Expected PostgreSQL 17'; end if;
 if not exists(select 1 from pg_class where oid='clinic_private.patient_accounts'::regclass and relrowsecurity and relforcerowsecurity) then raise exception 'Private RLS missing'; end if;
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'clinic_private.patient_accounts','select,insert,update,delete') then raise exception 'Unexpected direct account table grant'; end if;
 end loop;
 foreach f in array array['public.patient_account_command(text,uuid,uuid,jsonb)','public.patient_login_limit(text,text)'] loop
  if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute') or not has_function_privilege('service_role',f,'execute') then raise exception 'Incorrect service RPC grant'; end if;
  if not exists(select 1 from pg_proc where oid=f::regprocedure and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Unsafe function configuration'; end if;
 end loop;
 if position('patient_account_session' in pg_get_functiondef('clinic_private.phase2b_assurance()'::regprocedure))=0 then raise exception 'Managed-session gate missing'; end if;
 if exists(select 1 from clinic_private.patient_accounts a join public.patients p on p.id=a.patient_id where p.organization_id<>a.organization_id or (p.user_id is not null and p.user_id<>a.user_id)) then raise exception 'Patient binding mismatch'; end if;
end $$;
select count(*) as patients,count(user_id) as linked_auth_patients from public.patients;
select patient_code,user_id is not null as linked_auth from public.patients where patient_code in ('SRO0007','SRO0008') order by patient_code;
rollback;
