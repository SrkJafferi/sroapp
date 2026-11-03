-- READ ONLY assertions. Run only after the approved migration and target verification.
do $$
declare signature text:='public.phase2b_onboarding(text,uuid,bytea,uuid,jsonb,text,text)';
begin
  if not exists(select 1 from pg_proc where oid=signature::regprocedure
    and prosecdef and proconfig @> array['search_path=""']) then
    raise exception 'Unsafe replacement function configuration'; end if;
  if has_function_privilege('anon',signature,'EXECUTE') or
     has_function_privilege('authenticated',signature,'EXECUTE') or
     not has_function_privilege('service_role',signature,'EXECUTE') then
    raise exception 'Unexpected capability ACL: %',signature; end if;
  if not exists(select 1 from pg_proc where oid=signature::regprocedure
    and prosrc like '%recoverable%' and prosrc like '%demo_only%') then
    raise exception 'Missing proven-recovery eligibility branch'; end if;
  if exists(select 1 from pg_proc where oid=signature::regprocedure and prosrc like '%update auth.users%') then
    raise exception 'Database must never mutate Auth identities'; end if;
end $$;
