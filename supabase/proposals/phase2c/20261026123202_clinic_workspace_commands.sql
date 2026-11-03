-- Additive Phase 2C proposal. Separate approval required before remote application.
begin;
do $$ begin
  if current_setting('server_version_num')::integer/10000<>17 or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Reviewed PostgreSQL 17 migration owner required' using errcode='42501'; end if;
  if to_regprocedure('clinic_private.phase2b_assurance()') is null then raise exception 'Phase 2B dependency missing' using errcode='23514'; end if;
end $$;
create function clinic_private.workspace_admin(b uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
  if auth.uid() is null or not clinic_private.phase2b_assurance() then raise exception 'Verified clinic authorization required' using errcode='42501'; end if;
  select br.organization_id into o from public.branches br
    join public.organizations org on org.id=br.organization_id and org.active
    join public.profiles p on p.id=auth.uid() and p.active
    join public.organization_memberships m on m.organization_id=br.organization_id and m.user_id=p.id and m.active
    join public.branch_memberships bm on bm.organization_id=m.organization_id and bm.branch_id=br.id and bm.user_id=p.id and bm.active
    join public.role_assignments r on r.organization_id=m.organization_id and r.user_id=p.id and r.role='admin'
    where br.id=b and br.active for share of br,org,p,m,bm,r;
  if o is null then raise exception 'Branch Admin required' using errcode='42501'; end if;
  return o;
end $$;

create function clinic_private.publish_appointment_slots(p_branch_id uuid,p_doctor_id uuid,p_from date,p_until date)
returns integer language plpgsql security definer set search_path='' as $$
declare b public.branches; d public.doctors; a public.doctor_branch_assignments; w record; day date; ts timestamp; start_at timestamptz; sid uuid; n integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into strict b from public.branches where id=p_branch_id and active;
  select * into strict d from public.doctors where id=p_doctor_id and organization_id=b.organization_id and active;
  if not clinic_private.branch_role(b.organization_id,b.id,array['admin']::public.clinic_role[]) and not
    (d.user_id=auth.uid() and clinic_private.branch_role(b.organization_id,b.id,array['doctor']::public.clinic_role[])) then
    raise exception 'Calendar publication not authorized' using errcode='42501'; end if;
  select * into strict b from public.branches where id=p_branch_id and active for share;
  perform clinic_private.lock_doctor(p_doctor_id);
  if not clinic_private.branch_role(b.organization_id,b.id,array['admin']::public.clinic_role[]) and not
    (d.user_id=auth.uid() and clinic_private.branch_role(b.organization_id,b.id,array['doctor']::public.clinic_role[])) then
    raise exception 'Calendar authority changed while waiting' using errcode='42501'; end if;
  select * into strict a from public.doctor_branch_assignments where organization_id=b.organization_id and branch_id=b.id and doctor_id=d.id and active;
  if p_from is null or p_until is null or p_from<(now() at time zone b.timezone)::date or p_until<p_from or p_until>p_from+14
    or p_until>(now() at time zone b.timezone)::date+60 then raise exception 'Publish a bounded future calendar window' using errcode='22023'; end if;
  day:=p_from;
  while day<=p_until loop
    for w in select * from public.doctor_schedules where organization_id=b.organization_id and branch_id=b.id and doctor_id=d.id
      and weekday=extract(dow from day) and valid_from<=day and (valid_until is null or valid_until>=day) loop
      ts:=day+w.starts_at;
      while ts+make_interval(mins=>a.slot_minutes)<=day+w.ends_at loop
        start_at:=ts at time zone b.timezone;
        if start_at>clock_timestamp() and (start_at at time zone b.timezone)=ts
          and ((start_at+make_interval(mins=>a.slot_minutes)) at time zone b.timezone)=ts+make_interval(mins=>a.slot_minutes)
          and not exists(select 1 from public.schedule_breaks br where br.schedule_id=w.id and ts::time<br.ends_at and (ts+make_interval(mins=>a.slot_minutes))::time>br.starts_at)
          and not exists(select 1 from public.doctor_leave l where l.organization_id=b.organization_id and l.doctor_id=d.id and l.active and l.period && tstzrange(start_at,start_at+make_interval(mins=>a.slot_minutes),'[)')) then
          insert into public.appointment_slots(organization_id,doctor_id,branch_id,starts_at,ends_at)
            values(b.organization_id,d.id,b.id,start_at,start_at+make_interval(mins=>a.slot_minutes)) on conflict do nothing returning id into sid;
          if sid is not null then n:=n+1; end if;
        end if;
        ts:=ts+make_interval(mins=>a.slot_minutes);
      end loop;
    end loop;
    day:=day+1;
  end loop;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(b.organization_id,b.id,auth.uid(),'calendar.slots_published','doctors',d.id);
  return n;
end $$;

create function clinic_private.manage_clinic(p_branch_id uuid,p_action text,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o uuid; target uuid; d public.doctors; w uuid; day integer; item jsonb; b uuid; own_doctor boolean:=false;
begin
  if auth.uid() is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Invalid clinic command' using errcode='22023'; end if;
  if p_action not in ('branch','organization','profile','department','doctor','assignment','fee','schedule','revoke_invitation') then raise exception 'Unsupported clinic command' using errcode='22023'; end if;
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

create function clinic_private.save_patient_history(p_patient_id uuid,p_branch_id uuid,p_history jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
  select organization_id into strict o from public.patients where id=p_patient_id for update;
  if not clinic_private.branch_role(o,p_branch_id,array['doctor','clinical_staff']::public.clinic_role[]) or not clinic_private.care_access(o,p_patient_id,p_branch_id,true) then raise exception 'Authorized treating clinician required' using errcode='42501'; end if;
  if p_history is null or jsonb_typeof(p_history)<>'object' or octet_length(p_history::text)>16000
    or exists(select 1 from jsonb_object_keys(p_history) k where k not in ('allergies','conditions','medications','surgeries','familyHistory','socialHistory','bloodGroup','emergencyContact')) then raise exception 'Invalid history fields' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_history) v where v.key in ('allergies','conditions','medications') and (jsonb_typeof(v.value)<>'array' or jsonb_array_length(v.value)>100)) then raise exception 'History arrays required' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_history) v cross join lateral jsonb_array_elements(case when v.key in ('allergies','conditions','medications') then v.value else '[]'::jsonb end) a where jsonb_typeof(a.value)<>'string') then raise exception 'History entries must be text' using errcode='22023'; end if;
  insert into public.patient_medical_history(organization_id,patient_id,allergies,conditions,medications,surgeries,family_history,social_history,blood_group,emergency_contact,review_state,updated_by)
    values(o,p_patient_id,array(select jsonb_array_elements_text(p_history->'allergies')),array(select jsonb_array_elements_text(p_history->'conditions')),array(select jsonb_array_elements_text(p_history->'medications')),
      nullif(p_history->>'surgeries',''),nullif(p_history->>'familyHistory',''),nullif(p_history->>'socialHistory',''),nullif(p_history->>'bloodGroup',''),nullif(p_history->>'emergencyContact',''),'reviewed',auth.uid())
    on conflict(organization_id,patient_id) do update set allergies=excluded.allergies,conditions=excluded.conditions,medications=excluded.medications,surgeries=excluded.surgeries,
      family_history=excluded.family_history,social_history=excluded.social_history,blood_group=excluded.blood_group,emergency_contact=excluded.emergency_contact,review_state='reviewed',updated_by=auth.uid(),updated_at=now();
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id) values(o,p_branch_id,auth.uid(),'patient.history.reviewed','patients',p_patient_id);
end $$;

create function public.manage_clinic(p_branch_id uuid,p_action text,p_data jsonb) returns uuid language sql security invoker set search_path='' as $$select clinic_private.manage_clinic(p_branch_id,p_action,p_data)$$;
create function public.publish_appointment_slots(p_branch_id uuid,p_doctor_id uuid,p_from date,p_until date) returns integer language sql security invoker set search_path='' as $$select clinic_private.publish_appointment_slots(p_branch_id,p_doctor_id,p_from,p_until)$$;
create function public.save_patient_history(p_patient_id uuid,p_branch_id uuid,p_history jsonb) returns void language sql security invoker set search_path='' as $$select clinic_private.save_patient_history(p_patient_id,p_branch_id,p_history)$$;
revoke all on function clinic_private.workspace_admin(uuid) from public,anon,authenticated,service_role;
revoke all on function clinic_private.manage_clinic(uuid,text,jsonb),clinic_private.publish_appointment_slots(uuid,uuid,date,date),clinic_private.save_patient_history(uuid,uuid,jsonb),public.manage_clinic(uuid,text,jsonb),public.publish_appointment_slots(uuid,uuid,date,date),public.save_patient_history(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function clinic_private.manage_clinic(uuid,text,jsonb),clinic_private.publish_appointment_slots(uuid,uuid,date,date),clinic_private.save_patient_history(uuid,uuid,jsonb),public.manage_clinic(uuid,text,jsonb),public.publish_appointment_slots(uuid,uuid,date,date),public.save_patient_history(uuid,uuid,jsonb) to authenticated;
commit;
