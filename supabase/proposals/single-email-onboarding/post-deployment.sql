-- READ ONLY assertions. Run only after the approved migration and target verification.
do $$
declare signature text;
begin
  if to_regclass('clinic_private.doctor_onboarding') is null then raise exception 'Missing completion state'; end if;
  if not exists(select 1 from pg_class where oid='clinic_private.doctor_onboarding'::regclass and relrowsecurity and relforcerowsecurity) then
    raise exception 'Private state must force RLS'; end if;
  foreach signature in array array[
    'public.phase2b_onboarding(text,uuid,bytea,uuid,jsonb,text,text)',
    'public.phase2b_welcome_delivery(uuid,text,uuid,text)',
    'public.phase2b_invitation_preview(uuid,bytea,uuid)',
    'public.phase2b_accept(uuid,uuid,bytea)'
  ] loop
    if has_function_privilege('anon',signature,'EXECUTE') or
       has_function_privilege('authenticated',signature,'EXECUTE') or
       not has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'Unexpected capability ACL: %',signature; end if;
    if not exists(select 1 from pg_proc where oid=signature::regprocedure and prosecdef and proconfig @> array['search_path=""']) then
      raise exception 'Unsafe function configuration: %',signature; end if;
  end loop;
  if has_table_privilege('anon','clinic_private.doctor_onboarding','SELECT') or
     has_table_privilege('authenticated','clinic_private.doctor_onboarding','SELECT') or
     has_table_privilege('service_role','clinic_private.doctor_onboarding','SELECT') then
    raise exception 'Private state grant exposed'; end if;
  if not exists(select 1 from pg_policy where polrelid='public.notifications'::regclass and
    polname='onboarding_notification_scope' and not polpermissive) then
    raise exception 'Missing restrictive notification scope'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='doctor_id') or
     not exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='branch_id') then
    raise exception 'Missing tenant-scoped notification context'; end if;
end $$;
