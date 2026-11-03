-- Separate approval required. One existing private function; no new tables/grants/policies.
begin;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or
    (select md5(prosrc) from pg_proc where oid='clinic_private.manage_clinic(uuid,text,jsonb)'::regprocedure) is distinct from '7bf548852330446e483a1385501c8ebc' then
   raise exception 'Reviewed PostgreSQL 17 clinic command baseline required'; end if;
end $$;
create or replace function clinic_private.manage_clinic(p_branch_id uuid,p_action text,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o uuid; target uuid; d public.doctors; w uuid; day integer; item jsonb; b uuid; own_doctor boolean:=false;
begin
  if auth.uid() is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Invalid clinic command' using errcode='22023'; end if;
  if p_action not in ('branch','organization','profile','department','department_update','doctor','assignment','fee','schedule','revoke_invitation') then raise exception 'Unsupported clinic command' using errcode='22023'; end if;
  if p_action='profile' then
    if not clinic_private.in_branch((select organization_id from public.branches where id=p_branch_id and active),p_branch_id) then raise exception 'Active clinic membership required' using errcode='42501'; end if;
    update public.profiles set name=p_data->>'name' where id=auth.uid() and active;
    select organization_id into o from public.branches where id=p_branch_id;
    insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id) values(o,p_branch_id,auth.uid(),'profile.saved','profiles',auth.uid());
    return auth.uid();
  end if;
  if p_action in ('doctor','schedule') then
    target:=(p_data->>'doctorId')::uuid;
    select * into strict d from public.doctors where id=target and exists(select 1 from public.doctor_branch_assignments a where a.doctor_id=target and a.branch_id=p_branch_id and a.active);
    own_doctor:=d.user_id=auth.uid() and d.active and exists(select 1 from public.branches where id=p_branch_id and active) and clinic_private.branch_role(d.organization_id,p_branch_id,array['doctor']::public.clinic_role[]);
  end if;
  if own_doctor then o:=d.organization_id; else o:=clinic_private.workspace_admin(p_branch_id); end if;
  if p_action in ('doctor','schedule') then
    perform clinic_private.lock_doctor(target);
    if own_doctor and not clinic_private.branch_role(o,p_branch_id,array['doctor']::public.clinic_role[]) then raise exception 'Doctor authority changed while waiting' using errcode='42501'; end if;
  end if;
  b:=p_branch_id;
  if p_action='revoke_invitation' then
    target:=(p_data->>'id')::uuid;
    perform 1 from public.doctor_invitations where id=target and organization_id=o and branch_id=b for update;
    if not found then raise exception 'Invitation scope mismatch' using errcode='42501'; end if;
    update public.doctor_invitations set status='revoked' where id=target and organization_id=o and branch_id=b and status in ('draft','sent');
    if not found then raise exception 'Only open invitations can be revoked' using errcode='23514'; end if;
  elsif p_action='organization' then
    update public.organizations set name=p_data->>'name' where id=o;
    target:=o;
  elsif p_action='branch' then
    target:=nullif(p_data->>'id','')::uuid;
    if target is null then
      insert into public.branches(organization_id,name,address,phone,timezone) select o,p_data->>'name',coalesce(p_data->>'address',''),coalesce(p_data->>'phone',''),timezone from public.branches where id=b returning id into target;
      insert into public.branch_memberships(organization_id,branch_id,user_id) values(o,target,auth.uid());
    else
      perform clinic_private.workspace_admin(target);
      if not exists(select 1 from public.branches where id=target and organization_id=o) then raise exception 'Cross-organization branch denied' using errcode='42501'; end if;
      if coalesce((p_data->>'active')::boolean,true)=false and exists(select 1 from public.appointment_reservations where branch_id=target and active and ends_at>clock_timestamp()) then raise exception 'Resolve reservations before deactivating branch' using errcode='23514'; end if;
      update public.branches set name=p_data->>'name',address=coalesce(p_data->>'address',''),phone=coalesce(p_data->>'phone',''),active=coalesce((p_data->>'active')::boolean,true) where id=target and organization_id=o;
    end if;
  elsif p_action='department' then
    insert into public.specializations(organization_id,name,description) values(o,p_data->>'name',coalesce(p_data->>'description','')) returning id into target;
  elsif p_action='department_update' then
    target:=(p_data->>'id')::uuid;
    if p_data->>'name' is null or length(btrim(p_data->>'name')) not between 2 and 100 or length(coalesce(p_data->>'description',''))>2000 then
      raise exception 'Invalid department fields' using errcode='22023'; end if;
    update public.specializations set name=btrim(p_data->>'name'),description=btrim(coalesce(p_data->>'description',''))
      where organization_id=o and id=target;
    if not found then raise exception 'Department scope denied' using errcode='42501'; end if;
  elsif p_action='doctor' then
    if d.organization_id<>o then raise exception 'Doctor organization mismatch' using errcode='42501'; end if;
    update public.doctors set name=coalesce(p_data->>'name',name),bio=coalesce(p_data->>'bio',''),qualifications=coalesce(p_data->>'qualifications',''),experience=coalesce((p_data->>'experience')::smallint,0),
      specialization_id=case when own_doctor then specialization_id else (p_data->>'specializationId')::uuid end where id=target;
  elsif p_action in ('assignment','fee') then
    target:=(p_data->>'doctorId')::uuid;
    perform clinic_private.lock_doctor(target);
    o:=clinic_private.workspace_admin(p_branch_id);
    select * into strict d from public.doctors where id=target and organization_id=o and active;
    if p_action='assignment' then
      if not clinic_private.has_role(o,array['admin']::public.clinic_role[]) then raise exception 'Admin required' using errcode='42501'; end if;
      insert into public.branch_memberships(organization_id,branch_id,user_id) values(o,b,d.user_id) on conflict do nothing;
      if not exists(select 1 from public.branch_memberships where organization_id=o and branch_id=b and user_id=d.user_id and active) then raise exception 'Doctor branch membership disabled' using errcode='42501'; end if;
      insert into public.doctor_branch_assignments(organization_id,doctor_id,branch_id) values(o,target,b) on conflict do nothing;
    else
      if (p_data->>'fee')::numeric<0 or (p_data->>'fee')::numeric>1000000 or (p_data->>'fee')::numeric*100<>trunc((p_data->>'fee')::numeric*100) then raise exception 'Invalid fee' using errcode='22023'; end if;
      update public.doctor_branch_assignments set fee_paisa=((p_data->>'fee')::numeric*100)::bigint where organization_id=o and branch_id=b and doctor_id=target and active;
      if not found then raise exception 'Doctor assignment missing' using errcode='23514'; end if;
    end if;
  elsif p_action='schedule' then
    if d.organization_id<>o or jsonb_typeof(p_data->'days')<>'array' or jsonb_array_length(p_data->'days') not between 1 and 7
      or coalesce(jsonb_array_length(p_data->'breaks'),0)>8 then raise exception 'Invalid weekly schedule' using errcode='22023'; end if;
    -- Existing reservation/calendar guards refuse destructive capacity changes.
    delete from public.schedule_breaks where organization_id=o and schedule_id in(select id from public.doctor_schedules where organization_id=o and doctor_id=target and branch_id=b);
    delete from public.doctor_schedules where organization_id=o and doctor_id=target and branch_id=b;
    for day in select distinct value::integer from jsonb_array_elements_text(p_data->'days') loop
      insert into public.doctor_schedules(organization_id,doctor_id,branch_id,weekday,starts_at,ends_at,valid_from)
        values(o,target,b,day,(p_data->>'start')::time,(p_data->>'end')::time,(now() at time zone (select timezone from public.branches where id=b))::date) returning id into w;
      for item in select value from jsonb_array_elements(coalesce(p_data->'breaks','[]'::jsonb)) loop
        insert into public.schedule_breaks(organization_id,schedule_id,starts_at,ends_at) values(o,w,(item->>'start')::time,(item->>'end')::time);
      end loop;
    end loop;
    perform clinic_private.publish_appointment_slots(b,target,(now() at time zone (select timezone from public.branches where id=b))::date,(now() at time zone (select timezone from public.branches where id=b))::date+14);
  end if;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(o,b,auth.uid(),'clinic.'||p_action||'.saved','clinic_catalog',target);
  return target;
end $$;


notify pgrst, 'reload schema';
commit;
