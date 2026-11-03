-- Read-only verification. Only execute against the explicitly approved target after deployment.
do $$ declare n integer; begin
 if not exists(select 1 from storage.buckets where id='clinic-profile-avatars' and not public and file_size_limit=2097152 and allowed_mime_types=array['image/webp']) then raise exception 'Private bucket configuration mismatch'; end if;
 if not exists(select 1 from pg_class where oid='clinic_private.profile_avatars'::regclass and relrowsecurity and relforcerowsecurity) then raise exception 'Private avatar RLS missing'; end if;
 if has_table_privilege('authenticated','clinic_private.profile_avatars','select,insert,update,delete') or has_table_privilege('service_role','clinic_private.profile_avatars','select,insert,update,delete') then raise exception 'Unexpected direct table grants'; end if;
 select count(*) into n from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'clinic_avatar_%';
 if n<>8 then raise exception 'Eight avatar Storage policies required'; end if;
 select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in ('get_clinic_profile','save_clinic_profile','begin_profile_avatar','attest_profile_avatar','discard_profile_avatar','get_profile_assets','get_profile_avatar_object') and not p.prosecdef and p.proconfig @> array['search_path=""'];
 if n<>7 then raise exception 'Seven invoker RPCs with safe paths required'; end if;
 if has_function_privilege('authenticated','public.attest_profile_avatar(uuid,uuid,uuid,text,text)','execute') or has_function_privilege('anon','public.attest_profile_avatar(uuid,uuid,uuid,text,text)','execute') or not has_function_privilege('service_role','public.attest_profile_avatar(uuid,uuid,uuid,text,text)','execute') then raise exception 'Attestor grants mismatch'; end if;
 if has_function_privilege('service_role','public.save_clinic_profile(uuid,text,uuid,jsonb,text,uuid)','execute') then raise exception 'Service role must not execute profile updates'; end if;
end $$;
