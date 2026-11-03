-- Read-only; run only after separately approved Phase 2B migration.
begin read only;
do $$ begin
  if (select count(*) from pg_class c where c.relnamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity)<>38 then raise exception 'Expected 38 forced-RLS tables'; end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'phase2b_%')<>8 then raise exception 'Expected eight provisioning RPCs'; end if;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like 'phase2b_%' and (
    has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute') or not has_function_privilege('service_role',oid,'execute')
    or not prosecdef or not coalesce(proconfig @> array['search_path=""'],false))) then raise exception 'Provisioning RPC ACL/path mismatch'; end if;
  if (select count(*) from pg_policy where polname='phase2b_mfa_required' and not polpermissive)<>34 then raise exception 'Restrictive MFA policy inventory mismatch'; end if;
  if exists(select 1 from pg_class where relnamespace='clinic_private'::regnamespace and relname in ('auth_setup','demo_accounts','auth_email_limits') and (
    has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE'))) then raise exception 'Private provisioning table grants'; end if;
  if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations) is distinct from array['20261026024332','20261026024335','20261026024338','20261026111934'] then raise exception 'Unexpected migration history'; end if;
end $$;
select 'Phase 2B provisioning/MFA structure and ACL checks passed; operator bootstrap and real role-flow validation remain separate' as result;
rollback;
