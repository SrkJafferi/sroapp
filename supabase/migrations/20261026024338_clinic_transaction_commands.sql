begin;

create function clinic_private.guard_reservation() returns trigger language plpgsql set search_path='' as $$
declare s public.appointment_slots; begin
  select * into strict s from public.appointment_slots where id=new.slot_id;
  if new.starts_at<>s.starts_at or new.ends_at<>s.ends_at then
    raise exception 'Reservation must match its published slot' using errcode='23514';
  end if;
  return new;
end $$;
create trigger reservation_slot_guard before insert or update on public.appointment_reservations
for each row execute function clinic_private.guard_reservation();

create function clinic_private.guard_break() returns trigger language plpgsql set search_path='' as $$
declare s public.doctor_schedules; begin
  select * into strict s from public.doctor_schedules where id=new.schedule_id and organization_id=new.organization_id;
  if new.starts_at<s.starts_at or new.ends_at>s.ends_at then
    raise exception 'Break must be inside schedule' using errcode='23514';
  end if;
  return new;
end $$;
create trigger schedule_break_guard before insert or update on public.schedule_breaks
for each row execute function clinic_private.guard_break();

-- Server provisioning has catalog DML privileges too. It must participate in
-- the SAME doctor lock as booking, not rely on a future application convention.
create function clinic_private.guard_calendar_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
declare o uuid; d uuid; b uuid; u uuid; w public.doctor_schedules; changing boolean:=false;
begin
  if tg_table_name='schedule_breaks' then
    if tg_op='UPDATE' and (new.organization_id,new.schedule_id) is distinct from (old.organization_id,old.schedule_id) then
      raise exception 'Calendar identity is immutable; create a new row' using errcode='23514'; end if;
    if tg_op='DELETE' then
      select * into strict w from public.doctor_schedules where id=old.schedule_id and organization_id=old.organization_id;
    else
      select * into strict w from public.doctor_schedules where id=new.schedule_id and organization_id=new.organization_id;
    end if;
    o:=w.organization_id; d:=w.doctor_id; b:=w.branch_id;
  else
    if tg_op='UPDATE' and (new.organization_id,new.doctor_id,new.branch_id) is distinct from (old.organization_id,old.doctor_id,old.branch_id) then
      raise exception 'Calendar identity is immutable; create a new row' using errcode='23514'; end if;
    if tg_op='DELETE' then o:=old.organization_id; d:=old.doctor_id; b:=old.branch_id;
    else o:=new.organization_id; d:=new.doctor_id; b:=new.branch_id; end if;
  end if;
  select user_id into strict u from public.doctors where organization_id=o and id=d for key share;
  if u is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,0)); end if;
  if tg_table_name='schedule_breaks' then
    if tg_op<>'DELETE' and exists(select 1 from public.appointment_reservations r join public.branches br on br.id=r.branch_id
      where r.organization_id=o and r.doctor_id=d and r.branch_id=b and r.active and r.ends_at>clock_timestamp()
        and extract(dow from r.starts_at at time zone br.timezone)=w.weekday
        and (r.starts_at at time zone br.timezone)::date>=w.valid_from
        and (w.valid_until is null or (r.starts_at at time zone br.timezone)::date<=w.valid_until)
        and (r.starts_at at time zone br.timezone)::time<new.ends_at
        and (r.ends_at at time zone br.timezone)::time>new.starts_at) then
      raise exception 'Break would invalidate a held appointment' using errcode='23514'; end if;
  else
    changing:=tg_op='DELETE';
    if tg_op='UPDATE' then
      if tg_table_name='doctor_schedules' then
        changing:=(new.weekday,new.starts_at,new.ends_at,new.valid_from,new.valid_until)
          is distinct from (old.weekday,old.starts_at,old.ends_at,old.valid_from,old.valid_until);
      else changing:=(new.active,new.slot_minutes) is distinct from (old.active,old.slot_minutes); end if;
    end if;
    if changing and exists(select 1 from public.appointment_reservations r where r.organization_id=o and r.doctor_id=d
      and r.branch_id=b and r.active and r.ends_at>clock_timestamp()) then
      raise exception 'Resolve future reservations before changing schedule capacity' using errcode='23514'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger calendar_capacity_guard before insert or update or delete on public.doctor_schedules
for each row execute function clinic_private.guard_calendar_capacity();
create trigger calendar_capacity_guard before insert or update or delete on public.schedule_breaks
for each row execute function clinic_private.guard_calendar_capacity();
create trigger calendar_capacity_guard before insert or update or delete on public.doctor_branch_assignments
for each row execute function clinic_private.guard_calendar_capacity();

create function clinic_private.guard_branch_timezone() returns trigger
language plpgsql security definer set search_path='' as $$
declare u uuid; begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then
    raise exception 'Unknown branch timezone' using errcode='23514'; end if;
  if tg_op='UPDATE' and new.timezone is distinct from old.timezone then
    -- Block FK KEY SHARE from NEW assignments until timezone validation commits.
    -- Existing-doctor advisory locks alone cannot cover assignment phantoms.
    perform 1 from public.branches where organization_id=old.organization_id and id=old.id for update;
    -- Consistent ordering for multi-doctor catalog maintenance.
    for u in select d.user_id from public.doctors d join public.doctor_branch_assignments ba
      on (ba.organization_id,ba.doctor_id)=(d.organization_id,d.id)
      where ba.organization_id=old.organization_id and ba.branch_id=old.id and d.user_id is not null
      order by d.user_id for key share of d
    loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,0)); end loop;
    if exists(select 1 from public.appointment_reservations r where r.organization_id=old.organization_id
      and r.branch_id=old.id and r.active and r.ends_at>clock_timestamp()) then
      raise exception 'Resolve future reservations before changing branch timezone' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger branch_timezone_guard before insert or update of timezone on public.branches
for each row execute function clinic_private.guard_branch_timezone();

create function clinic_private.guard_signed_encounter() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='signed' then raise exception 'Signed encounter is immutable; use a reviewed amendment' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger signed_encounter_guard before update or delete on public.clinical_encounters
for each row execute function clinic_private.guard_signed_encounter();

create function clinic_private.lock_doctor(d uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid; begin
  if auth.uid() is null then raise exception 'Authenticated caller required' using errcode='42501'; end if;
  select user_id into strict u from public.doctors where id=d for key share;
  if u is null then raise exception 'Doctor onboarding incomplete' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,0));
end $$;

create function clinic_private.assert_slot(sid uuid) returns public.appointment_slots
language plpgsql security definer set search_path='' as $$
declare s public.appointment_slots; a public.doctor_branch_assignments; d public.doctors;
  b public.branches; local_start timestamp; local_end timestamp;
begin
  if auth.uid() is null then raise exception 'Authenticated caller required' using errcode='42501'; end if;
  select * into strict s from public.appointment_slots where id=sid;
  select * into strict a from public.doctor_branch_assignments where (organization_id,doctor_id,branch_id)=(s.organization_id,s.doctor_id,s.branch_id);
  select * into strict d from public.doctors where id=s.doctor_id;
  select * into strict b from public.branches where id=s.branch_id;
  if not clinic_private.in_branch(s.organization_id,s.branch_id) or not b.active or not a.active or not d.active
    or not s.open or s.starts_at<=clock_timestamp()
    or not exists (select 1 from public.role_assignments r join public.organization_memberships m using(organization_id,user_id)
      join public.profiles p on p.id=m.user_id join public.branch_memberships bm using(organization_id,user_id)
      where r.organization_id=d.organization_id and r.user_id=d.user_id and r.role='doctor' and m.active and p.active
        and bm.branch_id=s.branch_id and bm.active)
  then raise exception 'Slot is unavailable' using errcode='23514'; end if;
  local_start := s.starts_at at time zone b.timezone; local_end := s.ends_at at time zone b.timezone;
  if local_start::date<>local_end::date or s.ends_at<>s.starts_at+make_interval(mins=>a.slot_minutes)
    or not exists (select 1 from public.doctor_schedules w where w.organization_id=s.organization_id
      and w.doctor_id=s.doctor_id and w.branch_id=s.branch_id and w.weekday=extract(dow from local_start)
      and local_start::date>=w.valid_from and (w.valid_until is null or local_start::date<=w.valid_until)
      and local_start::time>=w.starts_at and local_end::time<=w.ends_at
      and mod(extract(epoch from (local_start::time-w.starts_at))::integer,a.slot_minutes*60)=0
      and not exists (select 1 from public.schedule_breaks br where br.organization_id=w.organization_id and br.schedule_id=w.id
        and local_start::time<br.ends_at and local_end::time>br.starts_at))
    or exists (select 1 from public.doctor_leave l where l.organization_id=s.organization_id and l.doctor_id=s.doctor_id
      and l.active and l.period && tstzrange(s.starts_at,s.ends_at,'[)'))
  then raise exception 'Slot violates schedule, break, duration or leave' using errcode='23514'; end if;
  return s;
end $$;

create function clinic_private.event(aid uuid, event_action text, old_state public.appointment_status default null) returns void
language plpgsql security definer set search_path='' as $$
declare a public.appointments; n uuid; begin
  if auth.uid() is null then raise exception 'Authenticated caller required' using errcode='42501'; end if;
  select * into strict a from public.appointments where id=aid;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(a.organization_id,a.branch_id,auth.uid(),event_action,'appointment',a.id);
  if old_state is null or old_state<>a.status then
    insert into public.appointment_status_history(organization_id,appointment_id,old_status,new_status,actor_id)
      values(a.organization_id,a.id,old_state,a.status,auth.uid());
  end if;
  insert into public.notifications(organization_id,appointment_id,kind,title,message)
    values(a.organization_id,a.id,case when a.status='confirmed' then 'confirmation'
      when a.status in ('cancelled','cancellation_requested') then 'cancellation'
      when a.status='completed' then 'consultation' else 'request' end,
      'Appointment updated','Open the clinic workspace to review an appointment update.') returning id into n;
  -- Only current branch-authorized Admins, the assigned Doctor and the owning Patient.
  insert into public.notification_recipients(organization_id,notification_id,user_id)
    select a.organization_id,n,m.user_id from public.organization_memberships m join public.profiles p on p.id=m.user_id
    where m.organization_id=a.organization_id and m.active and p.active and (
      m.user_id=a.clinician_user_id or m.user_id=(select user_id from public.patients where id=a.patient_id)
      or exists (select 1 from public.role_assignments r join public.branch_memberships bm using(organization_id,user_id)
        where r.organization_id=a.organization_id and r.user_id=m.user_id and r.role='admin' and bm.branch_id=a.branch_id and bm.active)
    );
end $$;

create function clinic_private.book_appointment(p_slot_id uuid,p_patient_id uuid,p_reason text,
  p_type public.appointment_type default 'physical',p_source public.appointment_source default 'patient') returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.appointment_slots; a public.appointments; d public.doctors; fee bigint; begin
  if auth.uid() is null then raise exception 'Authenticated caller required' using errcode='42501'; end if;
  select * into strict s from public.appointment_slots where id=p_slot_id;
  if not clinic_private.can_book(s.organization_id,s.branch_id,s.doctor_id,p_patient_id,p_source) then
    raise exception 'Booking not authorized' using errcode='42501'; end if;
  perform clinic_private.lock_doctor(s.doctor_id);
  s := clinic_private.assert_slot(p_slot_id);
  if not clinic_private.can_book(s.organization_id,s.branch_id,s.doctor_id,p_patient_id,p_source) then
    raise exception 'Booking authority changed while waiting' using errcode='42501'; end if;
  select * into strict d from public.doctors where id=s.doctor_id;
  insert into public.appointments(organization_id,branch_id,patient_id,doctor_id,clinician_user_id,current_slot_id,reason,type,source,created_by)
    values(s.organization_id,s.branch_id,p_patient_id,s.doctor_id,d.user_id,s.id,p_reason,p_type,p_source,auth.uid()) returning * into a;
  insert into public.appointment_reservations(organization_id,appointment_id,kind,slot_id,doctor_id,branch_id,clinician_user_id,patient_id,starts_at,ends_at)
    values(a.organization_id,a.id,'original',s.id,a.doctor_id,a.branch_id,a.clinician_user_id,a.patient_id,s.starts_at,s.ends_at);
  select fee_paisa into strict fee from public.doctor_branch_assignments where (organization_id,doctor_id,branch_id)=(a.organization_id,a.doctor_id,a.branch_id);
  insert into public.consultation_charges(organization_id,appointment_id,amount_paisa,payment_status)
    values(a.organization_id,a.id,fee,case when fee=0 then 'waived'::public.payment_status else 'unpaid'::public.payment_status end);
  perform clinic_private.event(a.id,'appointment.requested');
  return a.id;
end $$;

create function clinic_private.request_reschedule(p_appointment_id uuid,p_slot_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.appointments; s public.appointment_slots; previous public.appointment_status; begin
  if auth.uid() is null or not clinic_private.read_appointment(p_appointment_id) then
    raise exception 'Reschedule not authorized' using errcode='42501'; end if;
  select * into strict a from public.appointments where id=p_appointment_id;
  perform clinic_private.lock_doctor(a.doctor_id);
  select * into strict a from public.appointments where id=p_appointment_id for update;
  if not clinic_private.read_appointment(a.id) then raise exception 'Reschedule authority changed while waiting' using errcode='42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'Reschedule reason required' using errcode='23514'; end if;
  if a.status not in ('confirmed','reschedule_requested','doctor_unavailable') then
    raise exception 'Appointment cannot be rescheduled' using errcode='23514'; end if;
  s := clinic_private.assert_slot(p_slot_id);
  if (s.organization_id,s.doctor_id,s.branch_id)<>(a.organization_id,a.doctor_id,a.branch_id) or s.id=a.current_slot_id then
    raise exception 'Choose a new slot for the same doctor and branch' using errcode='23514'; end if;
  insert into public.appointment_reservations(organization_id,appointment_id,kind,slot_id,doctor_id,branch_id,clinician_user_id,patient_id,starts_at,ends_at,request_reason)
    values(a.organization_id,a.id,'proposed',s.id,a.doctor_id,a.branch_id,a.clinician_user_id,a.patient_id,s.starts_at,s.ends_at,p_reason)
    on conflict(organization_id,appointment_id,kind) do update set slot_id=excluded.slot_id,starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,active=true,request_reason=excluded.request_reason;
  previous:=a.status;
  update public.appointments set status='reschedule_requested' where id=a.id;
  perform clinic_private.event(a.id,'appointment.reschedule_requested',previous);
end $$;

create function clinic_private.transition_appointment(p_appointment_id uuid,p_status public.appointment_status) returns void
language plpgsql security definer set search_path='' as $$
declare a public.appointments; s public.appointment_slots; proposed uuid; allowed text[]; begin
  if auth.uid() is null or not (clinic_private.manage_appointment(p_appointment_id)
    or (p_status='cancellation_requested' and clinic_private.read_appointment(p_appointment_id))) then
    raise exception 'Transition not authorized' using errcode='42501'; end if;
  select * into strict a from public.appointments where id=p_appointment_id;
  perform clinic_private.lock_doctor(a.doctor_id);
  select * into strict a from public.appointments where id=p_appointment_id for update;
  if not coalesce((clinic_private.manage_appointment(a.id)
    or (p_status='cancellation_requested' and clinic_private.read_appointment(a.id))),false) then
    raise exception 'Transition authority changed while waiting' using errcode='42501'; end if;
  allowed:=case a.status
    when 'pending' then array['confirmed','rejected','cancellation_requested','doctor_unavailable']
    when 'confirmed' then array['checked_in','in_consultation','cancellation_requested','no_show','doctor_unavailable']
    when 'checked_in' then array['in_consultation','doctor_unavailable']
    when 'reschedule_requested' then array['confirmed','cancellation_requested','doctor_unavailable']
    when 'cancellation_requested' then array['cancelled','confirmed','doctor_unavailable']
    when 'doctor_unavailable' then array['cancellation_requested','cancelled'] else array[]::text[] end;
  if p_status is null or not (p_status::text=any(allowed)) then
    raise exception 'Invalid appointment transition; completion requires signing' using errcode='23514'; end if;
  if p_status='confirmed' then
    select slot_id into proposed from public.appointment_reservations
      where appointment_id=a.id and kind='proposed' and active;
    s:=clinic_private.assert_slot(coalesce(proposed,a.current_slot_id));
    update public.appointment_reservations set slot_id=s.id,starts_at=s.starts_at,ends_at=s.ends_at,active=true
      where appointment_id=a.id and kind='original';
    delete from public.appointment_reservations where appointment_id=a.id and kind='proposed';
    update public.appointments set current_slot_id=s.id where id=a.id;
    insert into public.patient_assignments(organization_id,patient_id,doctor_id,branch_id,appointment_id)
      values(a.organization_id,a.patient_id,a.doctor_id,a.branch_id,a.id)
      on conflict(organization_id,appointment_id) do update set active=true;
  end if;
  if p_status in ('cancelled','rejected','no_show') then
    update public.appointment_reservations set active=false where appointment_id=a.id;
    update public.patient_assignments set active=false where appointment_id=a.id;
  end if;
  update public.appointments set status=p_status where id=a.id;
  perform clinic_private.event(a.id,'appointment.'||p_status::text,a.status);
end $$;

create function clinic_private.save_encounter(p_appointment_id uuid,p_notes jsonb,p_items jsonb default '[]',p_sign boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.appointments; eid uuid; rid uuid; item jsonb; i smallint:=0; k text; begin
  if auth.uid() is null or not clinic_private.manage_appointment(p_appointment_id) then
    raise exception 'Consultation not authorized' using errcode='42501'; end if;
  select * into strict a from public.appointments where id=p_appointment_id;
  perform clinic_private.lock_doctor(a.doctor_id);
  select * into strict a from public.appointments where id=p_appointment_id for update;
  if not clinic_private.manage_appointment(a.id) or a.clinician_user_id<>auth.uid()
    or not clinic_private.branch_role(a.organization_id,a.branch_id,array['doctor']::public.clinic_role[])
    or not exists(select 1 from public.patient_assignments pa where pa.appointment_id=a.id and pa.active) then
    raise exception 'Only the assigned Doctor can author/sign this encounter' using errcode='42501'; end if;
  if a.status<>'in_consultation' then raise exception 'Start consultation before saving' using errcode='23514'; end if;
  if p_notes is null or jsonb_typeof(p_notes)<>'object' or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)>30 or p_sign is null then
    raise exception 'Invalid consultation payload' using errcode='23514'; end if;
  if exists(select 1 from jsonb_object_keys(p_notes) v where v not in ('symptoms','examination','diagnosis','plan','followUp','vitals'))
    or exists(select 1 from jsonb_each(p_notes) v where v.key<>'vitals' and jsonb_typeof(v.value)<>'string')
    or (p_notes ? 'vitals' and jsonb_typeof(p_notes->'vitals')<>'object') then
    raise exception 'Unsupported clinical fields' using errcode='23514'; end if;
  if p_notes ? 'vitals' then
    if exists(select 1 from jsonb_each(p_notes->'vitals') v where v.key not in ('bloodPressure','pulse','temperature','oxygen','weight','height')
      or jsonb_typeof(v.value)<>'string') then raise exception 'Invalid vitals' using errcode='23514'; end if;
  end if;
  if octet_length(p_notes::text)>64000 then raise exception 'Clinical note too large' using errcode='23514'; end if;
  if p_sign and (coalesce(length(btrim(p_notes->>'diagnosis')),0)=0 or coalesce(length(btrim(p_notes->>'plan')),0)=0) then
    raise exception 'Diagnosis and treatment plan required for signing' using errcode='23514'; end if;
  insert into public.clinical_encounters(organization_id,appointment_id,patient_id,doctor_id,branch_id,author_id,symptoms,examination,diagnosis,plan,follow_up)
    values(a.organization_id,a.id,a.patient_id,a.doctor_id,a.branch_id,auth.uid(),coalesce(p_notes->>'symptoms',''),
      coalesce(p_notes->>'examination',''),coalesce(p_notes->>'diagnosis',''),coalesce(p_notes->>'plan',''),coalesce(p_notes->>'followUp',''))
    on conflict(organization_id,appointment_id) do update set symptoms=excluded.symptoms,examination=excluded.examination,
      diagnosis=excluded.diagnosis,plan=excluded.plan,follow_up=excluded.follow_up
    returning id into eid;
  insert into public.encounter_vitals(organization_id,encounter_id,blood_pressure,pulse,temperature,oxygen,weight,height)
    values(a.organization_id,eid,coalesce(p_notes#>>'{vitals,bloodPressure}',''),coalesce(p_notes#>>'{vitals,pulse}',''),
      coalesce(p_notes#>>'{vitals,temperature}',''),coalesce(p_notes#>>'{vitals,oxygen}',''),coalesce(p_notes#>>'{vitals,weight}',''),coalesce(p_notes#>>'{vitals,height}',''))
    on conflict(organization_id,encounter_id) do update set blood_pressure=excluded.blood_pressure,pulse=excluded.pulse,
      temperature=excluded.temperature,oxygen=excluded.oxygen,weight=excluded.weight,height=excluded.height;
  -- Persist drafts for the authorized care team; owning Patient cannot read them.
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) v
      where v not in ('medication','strength','dosage','frequency','duration','instructions')) then
      raise exception 'Invalid prescription item' using errcode='23514'; end if;
    foreach k in array array['medication','strength','dosage','frequency','duration','instructions'] loop
      if not (item ? k) or jsonb_typeof(item->k)<>'string' or length(btrim(item->>k))=0 then
        raise exception 'Complete all medication fields' using errcode='23514'; end if;
    end loop;
  end loop;
  if jsonb_array_length(p_items)>0 then
    insert into public.prescriptions(organization_id,encounter_id,instructions)
      values(a.organization_id,eid,coalesce(p_notes->>'followUp',''))
      on conflict(organization_id,encounter_id) do update set instructions=excluded.instructions returning id into rid;
    delete from public.prescription_items where prescription_id=rid;
    for item in select value from jsonb_array_elements(p_items) loop
      i:=i+1;
      insert into public.prescription_items(organization_id,prescription_id,line_number,medication,strength,dosage,frequency,duration,instructions)
        values(a.organization_id,rid,i,item->>'medication',item->>'strength',item->>'dosage',item->>'frequency',item->>'duration',item->>'instructions');
    end loop;
  else
    delete from public.prescription_items where prescription_id in (select id from public.prescriptions where encounter_id=eid);
    delete from public.prescriptions where encounter_id=eid;
  end if;
  if p_sign then
    update public.prescriptions set issued_at=now() where encounter_id=eid;
    update public.clinical_encounters set status='signed',signed_at=now() where id=eid;
    update public.appointments set status='completed' where id=a.id;
    update public.appointment_reservations set active=false where appointment_id=a.id;
    perform clinic_private.event(a.id,'consultation.signed',a.status);
  else
    insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
      values(a.organization_id,a.branch_id,auth.uid(),'consultation.draft_saved','encounter',eid);
  end if;
  return eid;
end $$;

create function clinic_private.grant_clinical_access(p_patient_id uuid,p_branch_id uuid,p_user_id uuid,
  p_reason text,p_can_write boolean default false,p_expires_at timestamptz default now()+interval '90 days') returns uuid
language plpgsql security definer set search_path='' as $$
declare o uuid; gid uuid; begin
  if auth.uid() is null then raise exception 'Authenticated caller required' using errcode='42501'; end if;
  select organization_id into strict o from public.patients where id=p_patient_id;
  if not clinic_private.branch_role(o,p_branch_id,array['admin']::public.clinic_role[]) then
    raise exception 'Only branch-authorized Admin can grant clinical access' using errcode='42501'; end if;
  if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '1 year' or p_can_write is null then
    raise exception 'Grant must expire within one year' using errcode='23514'; end if;
  if not exists(select 1 from public.organization_memberships m join public.profiles p on p.id=m.user_id
    join public.role_assignments r using(organization_id,user_id) join public.branch_memberships bm using(organization_id,user_id)
    where m.organization_id=o and m.user_id=p_user_id and m.active and p.active and bm.active and bm.branch_id=p_branch_id
      and r.role in ('doctor','clinical_staff')) then
    raise exception 'Recipient must already be an active branch clinician' using errcode='23514'; end if;
  insert into public.clinical_access_grants(organization_id,patient_id,branch_id,user_id,granted_by,reason,can_write,expires_at)
    values(o,p_patient_id,p_branch_id,p_user_id,auth.uid(),p_reason,p_can_write,p_expires_at) returning id into gid;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(o,p_branch_id,auth.uid(),'clinical_access.granted','grant',gid);
  return gid;
end $$;
create function clinic_private.revoke_clinical_access(p_grant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g public.clinical_access_grants; begin
  select * into g from public.clinical_access_grants where id=p_grant_id;
  if not found or auth.uid() is null or not clinic_private.branch_role(g.organization_id,g.branch_id,array['admin']::public.clinic_role[]) then
    raise exception 'Revocation not authorized' using errcode='42501'; end if;
  select * into strict g from public.clinical_access_grants where id=p_grant_id for update;
  if auth.uid() is null or not clinic_private.branch_role(g.organization_id,g.branch_id,array['admin']::public.clinic_role[]) then
    raise exception 'Revocation not authorized' using errcode='42501'; end if;
  update public.clinical_access_grants set revoked_at=coalesce(revoked_at,now()) where id=g.id;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(g.organization_id,g.branch_id,auth.uid(),'clinical_access.revoked','grant',g.id);
end $$;

create function clinic_private.add_doctor_leave(p_doctor_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.doctors; a public.appointments; lid uuid; begin
  if not clinic_private.manage_doctor_leave(p_doctor_id) then
    raise exception 'Doctor-wide leave not authorized' using errcode='42501'; end if;
  select * into strict d from public.doctors where id=p_doctor_id;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '1 year' then
    raise exception 'Invalid leave interval' using errcode='23514'; end if;
  perform clinic_private.lock_doctor(d.id);
  if not clinic_private.manage_doctor_leave(d.id) then
    raise exception 'Leave authority changed while waiting' using errcode='42501'; end if;
  if exists(select 1 from public.appointments ap join public.appointment_reservations r on r.appointment_id=ap.id
    where ap.doctor_id=d.id and ap.status in ('checked_in','in_consultation') and r.active
      and r.period && tstzrange(p_starts_at,p_ends_at,'[)')) then
    raise exception 'Resolve checked-in/active consultations before leave' using errcode='23514'; end if;
  insert into public.doctor_leave(organization_id,doctor_id,starts_at,ends_at,reason)
    values(d.organization_id,d.id,p_starts_at,p_ends_at,p_reason) returning id into lid;
  for a in select ap.* from public.appointments ap where ap.doctor_id=d.id
    and ap.status in ('pending','confirmed','reschedule_requested','cancellation_requested')
    and exists(select 1 from public.appointment_reservations r where r.appointment_id=ap.id and r.active
      and r.period && tstzrange(p_starts_at,p_ends_at,'[)')) for update
  loop
    update public.appointments set status='doctor_unavailable' where id=a.id;
    perform clinic_private.event(a.id,'appointment.doctor_unavailable',a.status);
  end loop;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)
    values(d.organization_id,auth.uid(),'doctor.leave_added','leave',lid);
  return lid;
end $$;

create function clinic_private.guard_vitals() returns trigger language plpgsql set search_path='' as $$
declare eid uuid;
begin
  eid:=case when tg_op='INSERT' then new.encounter_id else old.encounter_id end;
  if exists(select 1 from public.clinical_encounters where id=eid and status='signed')
    or (tg_op='UPDATE' and exists(select 1 from public.clinical_encounters where id=new.encounter_id and status='signed')) then
    raise exception 'Signed encounter vitals are immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger signed_vitals_guard before insert or update or delete on public.encounter_vitals for each row execute function clinic_private.guard_vitals();
create function clinic_private.deny_revision() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Append-only record; mutation denied' using errcode='23514'; end $$;
create trigger audit_append_only before update or delete on public.audit_logs for each row execute function clinic_private.deny_revision();
create trigger status_history_append_only before update or delete on public.appointment_status_history for each row execute function clinic_private.deny_revision();
create trigger payments_append_only before update or delete on public.payment_records for each row execute function clinic_private.deny_revision();
create function clinic_private.guard_prescription_revision() returns trigger language plpgsql set search_path='' as $$
declare eid uuid; rid uuid; begin
  if tg_table_name='prescriptions' then
    eid:=case when tg_op='INSERT' then new.encounter_id else old.encounter_id end;
  else
    rid:=case when tg_op='INSERT' then new.prescription_id else old.prescription_id end;
    select encounter_id into strict eid from public.prescriptions where id=rid;
  end if;
  if exists(select 1 from public.clinical_encounters where id=eid and status='signed') then
    raise exception 'Issued prescription is immutable' using errcode='23514'; end if;
  if tg_op='UPDATE' then
    if tg_table_name='prescriptions' then
      eid:=new.encounter_id;
    else
      select encounter_id into strict eid from public.prescriptions where id=new.prescription_id;
    end if;
    if exists(select 1 from public.clinical_encounters where id=eid and status='signed') then
      raise exception 'Cannot attach draft content to an issued prescription' using errcode='23514'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger prescription_immutable before insert or update or delete on public.prescriptions for each row execute function clinic_private.guard_prescription_revision();
create trigger prescription_items_immutable before insert or update or delete on public.prescription_items for each row execute function clinic_private.guard_prescription_revision();

-- The API layer contains no SECURITY DEFINER function. Sensitive implementations are
-- outside the exposed schema and validate caller identity/scope on every write.
create function clinic_private.slot_available(p_slot_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare s public.appointment_slots; u uuid; begin
  if auth.uid() is null then return false; end if;
  select * into s from public.appointment_slots where id=p_slot_id;
  if not found or not clinic_private.in_branch(s.organization_id,s.branch_id) then return false; end if;
  begin s:=clinic_private.assert_slot(s.id);
  exception when check_violation then return false; end;
  select user_id into u from public.doctors where id=s.doctor_id;
  return not exists(select 1 from public.appointment_reservations r where r.clinician_user_id=u
    and r.active and r.period && tstzrange(s.starts_at,s.ends_at,'[)'));
end $$;
create function public.available_appointment_slots(p_branch_id uuid,p_doctor_id uuid,p_date date)
returns setof public.appointment_slots language sql stable security invoker set search_path='' as $$
  select s.* from public.appointment_slots s join public.branches b on b.id=s.branch_id
  where s.branch_id=p_branch_id and s.doctor_id=p_doctor_id
    and s.starts_at >= (p_date::timestamp at time zone b.timezone)
    and s.starts_at < ((p_date+1)::timestamp at time zone b.timezone)
    and clinic_private.slot_available(s.id) order by s.starts_at
$$;
create function public.book_appointment(p_slot_id uuid,p_patient_id uuid,p_reason text,
  p_type public.appointment_type default 'physical',p_source public.appointment_source default 'patient') returns uuid
language sql security invoker set search_path='' as $$ select clinic_private.book_appointment(p_slot_id,p_patient_id,p_reason,p_type,p_source) $$;
create function public.request_reschedule(p_appointment_id uuid,p_slot_id uuid,p_reason text) returns void
language sql security invoker set search_path='' as $$ select clinic_private.request_reschedule(p_appointment_id,p_slot_id,p_reason) $$;
create function public.transition_appointment(p_appointment_id uuid,p_status public.appointment_status) returns void
language sql security invoker set search_path='' as $$ select clinic_private.transition_appointment(p_appointment_id,p_status) $$;
create function public.save_encounter(p_appointment_id uuid,p_notes jsonb,p_items jsonb default '[]',p_sign boolean default false) returns uuid
language sql security invoker set search_path='' as $$ select clinic_private.save_encounter(p_appointment_id,p_notes,p_items,p_sign) $$;
create function public.grant_clinical_access(p_patient_id uuid,p_branch_id uuid,p_user_id uuid,p_reason text,
  p_can_write boolean default false,p_expires_at timestamptz default now()+interval '90 days') returns uuid
language sql security invoker set search_path='' as $$ select clinic_private.grant_clinical_access(p_patient_id,p_branch_id,p_user_id,p_reason,p_can_write,p_expires_at) $$;
create function public.revoke_clinical_access(p_grant_id uuid) returns void
language sql security invoker set search_path='' as $$ select clinic_private.revoke_clinical_access(p_grant_id) $$;
create function public.add_doctor_leave(p_doctor_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text) returns uuid
language sql security invoker set search_path='' as $$ select clinic_private.add_doctor_leave(p_doctor_id,p_starts_at,p_ends_at,p_reason) $$;

do $$ declare f record; begin
  -- Revoke Supabase/Postgres default EXECUTE from every newly created private function.
  for f in select oid::regprocedure as signature,proname from pg_proc where pronamespace='clinic_private'::regnamespace loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f.signature);
    if f.proname in ('is_member','has_role','in_branch','branch_role','owns_patient','care_access','patient_access',
      'read_appointment','manage_appointment','read_encounter','read_prescription','slot_available','can_book','manage_doctor_leave',
      'book_appointment','request_reschedule','transition_appointment','save_encounter','grant_clinical_access','revoke_clinical_access','add_doctor_leave') then
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in (
    'available_appointment_slots','book_appointment','request_reschedule','transition_appointment','save_encounter','grant_clinical_access','revoke_clinical_access','add_doctor_leave') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
commit;
