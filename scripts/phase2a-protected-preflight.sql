-- Read-only gate, not a migration. Recheck project identity through metadata first.
begin read only;
do $preflight$
begin
  if clock_timestamp()<timestamptz '2026-10-26 10:54:25+00' then raise exception 'Staging JWT residual cutoff has not passed'; end if;
  if current_setting('server_version_num')::int<>170011 then raise exception 'Re-review PostgreSQL version change'; end if;
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Apply owner must bypass FORCE RLS'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','clinic_private') and c.relkind in ('r','p','v','m','S','f'))
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private'))
    or exists(select 1 from pg_type where typnamespace='public'::regnamespace and typtype in ('e','d'))
    or to_regnamespace('clinic_private') is not null then raise exception 'Application baseline changed; stop'; end if;
  if exists(select 1 from auth.users) or exists(select 1 from storage.buckets) or exists(select 1 from storage.objects)
    or exists(select 1 from pg_roles where rolname='sro_phase2a5_runner') then raise exception 'Unexpected identity/storage/test state'; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists(select 1 from supabase_migrations.schema_migrations) then raise exception 'Unexpected remote migration history'; end if;
  end if;
  if exists(select 1 from pg_extension where extname='btree_gist') then raise exception 'Extension baseline changed; re-review'; end if;
  if not exists(select 1 from pg_available_extension_versions where name='btree_gist' and version='1.7' and trusted)
    or (select default_version from pg_available_extensions where name='btree_gist')<>'1.7' then raise exception 'Extension compatibility changed'; end if;
  if not has_database_privilege(current_user,current_database(),'CREATE') or not has_schema_privilege(current_user,'public','CREATE')
    or not has_schema_privilege(current_user,'extensions','CREATE') or not has_schema_privilege(current_user,'auth','USAGE')
    or not has_table_privilege(current_user,'auth.users','REFERENCES') or not has_function_privilege(current_user,'auth.uid()','EXECUTE') then raise exception 'Migration privileges missing'; end if;
  if current_setting('row_security')<>'on' or current_setting('standard_conforming_strings')<>'on'
    or current_setting('server_encoding')<>'UTF8' then raise exception 'Required settings changed'; end if;
end $preflight$;
select clock_timestamp() as checked_at,'Read-only empty-target SQL gate passed; explicit deployment approval and metadata identity check are still required' as result;
rollback;
