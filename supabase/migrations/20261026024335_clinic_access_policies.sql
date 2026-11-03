begin;
alter default privileges in schema clinic_private revoke execute on functions from public;

-- These narrowly scoped helpers avoid recursive RLS on membership/assignment tables.
-- No JWT role metadata is trusted. The managed auth.uid() identifies the caller only.
create function clinic_private.is_member(o uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_memberships m join public.profiles p on p.id=m.user_id
      join public.organizations org on org.id=m.organization_id
    where m.organization_id=o and m.user_id=auth.uid() and m.active and p.active and org.active
  )
$$;
create function clinic_private.has_role(o uuid, roles public.clinic_role[]) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and clinic_private.is_member(o) and exists (
    select 1 from public.role_assignments r where r.organization_id=o and r.user_id=auth.uid() and r.role=any(roles)
      and (r.role<>'doctor' or exists(select 1 from public.doctors d where d.organization_id=o and d.user_id=auth.uid() and d.active))
  )
$$;
create function clinic_private.in_branch(o uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and clinic_private.is_member(o) and exists (
    select 1 from public.branch_memberships m where m.organization_id=o and m.branch_id=b and m.user_id=auth.uid() and m.active
  )
$$;
create function clinic_private.branch_role(o uuid,b uuid,roles public.clinic_role[]) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and clinic_private.in_branch(o,b) and clinic_private.has_role(o,roles)
$$;
create function clinic_private.owns_patient(o uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and clinic_private.has_role(o,array['patient']::public.clinic_role[]) and exists (
    select 1 from public.patients t where t.organization_id=o and t.id=p and t.user_id=auth.uid()
  )
$$;
create function clinic_private.care_access(o uuid,p uuid,b uuid,writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and clinic_private.is_member(o) and exists (
    select 1 from public.patient_branches pb where pb.organization_id=o and pb.patient_id=p and pb.branch_id=b
  ) and (
    (not writing and clinic_private.owns_patient(o,p) and clinic_private.in_branch(o,b))
    or (not writing and clinic_private.branch_role(o,b,array['admin']::public.clinic_role[]))
    or (clinic_private.branch_role(o,b,array['doctor','clinical_staff']::public.clinic_role[]) and (
      exists (select 1 from public.patient_assignments a join public.doctors d
        on (d.organization_id,d.id)=(a.organization_id,a.doctor_id)
        where a.organization_id=o and a.patient_id=p and a.branch_id=b and a.active and d.active
          and d.user_id=auth.uid() and clinic_private.has_role(o,array['doctor']::public.clinic_role[]))
      or exists (select 1 from public.clinical_access_grants g where g.organization_id=o and g.patient_id=p
        and g.branch_id=b and g.user_id=auth.uid() and g.revoked_at is null and g.expires_at>now()
        and (not writing or g.can_write))
    ))
  )
$$;
create function clinic_private.patient_access(o uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (select 1 from public.patient_branches b
    where b.organization_id=o and b.patient_id=p and clinic_private.care_access(o,p,b.branch_id,false))
$$;
create function clinic_private.can_book(o uuid,b uuid,d uuid,p uuid,source public.appointment_source) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and clinic_private.in_branch(o,b) and coalesce((
    (clinic_private.owns_patient(o,p) and source='patient')
    or clinic_private.branch_role(o,b,array['admin']::public.clinic_role[])
    or (clinic_private.branch_role(o,b,array['doctor']::public.clinic_role[]) and exists (
      select 1 from public.patient_assignments a join public.doctors dr on (dr.organization_id,dr.id)=(a.organization_id,a.doctor_id)
      where a.organization_id=o and a.branch_id=b and a.patient_id=p and a.doctor_id=d and a.active
        and dr.active and dr.user_id=auth.uid()
    ))
  ),false)
$$;
create function clinic_private.manage_doctor_leave(d uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.doctors dr where dr.id=d
    and clinic_private.is_member(dr.organization_id) and (
      (dr.user_id=auth.uid() and clinic_private.has_role(dr.organization_id,array['doctor']::public.clinic_role[]))
      or (clinic_private.has_role(dr.organization_id,array['admin']::public.clinic_role[]) and not exists (
        select 1 from public.doctor_branch_assignments ba where ba.organization_id=dr.organization_id and ba.doctor_id=dr.id and ba.active
          and not clinic_private.branch_role(ba.organization_id,ba.branch_id,array['admin']::public.clinic_role[])))
    ))
$$;
create function clinic_private.read_appointment(a uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (select 1 from public.appointments t where t.id=a and (
    (clinic_private.owns_patient(t.organization_id,t.patient_id) and clinic_private.in_branch(t.organization_id,t.branch_id))
    or clinic_private.branch_role(t.organization_id,t.branch_id,array['admin']::public.clinic_role[])
    or (clinic_private.branch_role(t.organization_id,t.branch_id,array['doctor']::public.clinic_role[]) and t.clinician_user_id=auth.uid()
      and (t.status in ('cancelled','rejected','no_show') or not exists(select 1 from public.patient_assignments pa where pa.appointment_id=t.id and not pa.active)))
  ))
$$;
create function clinic_private.manage_appointment(a uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (select 1 from public.appointments t where t.id=a and (
    clinic_private.branch_role(t.organization_id,t.branch_id,array['admin']::public.clinic_role[])
    or (clinic_private.branch_role(t.organization_id,t.branch_id,array['doctor']::public.clinic_role[]) and t.clinician_user_id=auth.uid()
      and not exists(select 1 from public.patient_assignments pa where pa.appointment_id=t.id and not pa.active))
  ))
$$;
create function clinic_private.read_encounter(e uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (select 1 from public.clinical_encounters c where c.id=e and (
    (c.status='signed' and clinic_private.owns_patient(c.organization_id,c.patient_id) and clinic_private.in_branch(c.organization_id,c.branch_id))
    or (clinic_private.branch_role(c.organization_id,c.branch_id,array['admin','doctor','clinical_staff']::public.clinic_role[])
      and clinic_private.care_access(c.organization_id,c.patient_id,c.branch_id,false))
  ))
$$;
create function clinic_private.read_prescription(p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (select 1 from public.prescriptions t where t.id=p and clinic_private.read_encounter(t.encounter_id))
$$;

-- Explicit grants; authenticated clients cannot mutate authority/clinical tables directly.
grant usage on schema clinic_private to authenticated;
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='clinic_private'::regnamespace loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f.signature);
    execute format('grant execute on function %s to authenticated, service_role',f.signature);
  end loop;
end $$;

create policy member_read on public.organizations for select to authenticated using (clinic_private.is_member(id));
create policy profile_read on public.profiles for select to authenticated using (
  (id=(select auth.uid()) and active) or exists (select 1 from public.branch_memberships m where m.user_id=profiles.id
    and clinic_private.branch_role(m.organization_id,m.branch_id,array['admin']::public.clinic_role[]))
);
create policy membership_read on public.organization_memberships for select to authenticated using (
  clinic_private.is_member(organization_id) and (user_id=(select auth.uid()) or clinic_private.has_role(organization_id,array['admin']::public.clinic_role[]))
);
create policy role_read on public.role_assignments for select to authenticated using (
  clinic_private.is_member(organization_id) and (user_id=(select auth.uid()) or clinic_private.has_role(organization_id,array['admin']::public.clinic_role[]))
);
create policy branch_read on public.branches for select to authenticated using (clinic_private.in_branch(organization_id,id));
create policy branch_membership_read on public.branch_memberships for select to authenticated using (
  clinic_private.is_member(organization_id) and (user_id=(select auth.uid()) or clinic_private.branch_role(organization_id,branch_id,array['admin']::public.clinic_role[]))
);
create policy specialization_read on public.specializations for select to authenticated using (clinic_private.is_member(organization_id));
create policy symptom_read on public.symptom_categories for select to authenticated using (clinic_private.is_member(organization_id));
create policy mapping_read on public.specialization_symptoms for select to authenticated using (clinic_private.is_member(organization_id));
create policy doctor_read on public.doctors for select to authenticated using (
  clinic_private.is_member(organization_id) and (user_id=(select auth.uid()) or exists (
    select 1 from public.doctor_branch_assignments a where a.organization_id=doctors.organization_id and a.doctor_id=doctors.id
      and clinic_private.in_branch(a.organization_id,a.branch_id) and (doctors.active and a.active
        or clinic_private.branch_role(a.organization_id,a.branch_id,array['admin']::public.clinic_role[]))
  ))
);
create policy doctor_branch_read on public.doctor_branch_assignments for select to authenticated using (clinic_private.in_branch(organization_id,branch_id));
create policy patient_read on public.patients for select to authenticated using (clinic_private.patient_access(organization_id,id));
create policy patient_branch_read on public.patient_branches for select to authenticated using (clinic_private.care_access(organization_id,patient_id,branch_id,false));
create policy invitation_read on public.doctor_invitations for select to authenticated using (clinic_private.branch_role(organization_id,branch_id,array['admin']::public.clinic_role[]));
-- No authenticated policy/grant on clinic_private.invitation_secrets.
create policy schedule_read on public.doctor_schedules for select to authenticated using (clinic_private.in_branch(organization_id,branch_id));
create policy break_read on public.schedule_breaks for select to authenticated using (exists (
  select 1 from public.doctor_schedules s where s.organization_id=schedule_breaks.organization_id and s.id=schedule_breaks.schedule_id
));
create policy leave_read on public.doctor_leave for select to authenticated using (exists (
  select 1 from public.doctors d where d.organization_id=doctor_leave.organization_id and d.id=doctor_leave.doctor_id and (
    d.user_id=(select auth.uid()) or exists (select 1 from public.doctor_branch_assignments a where a.organization_id=d.organization_id and a.doctor_id=d.id
      and clinic_private.branch_role(a.organization_id,a.branch_id,array['admin']::public.clinic_role[]))
  )
));
create policy slot_read on public.appointment_slots for select to authenticated using (clinic_private.in_branch(organization_id,branch_id));
create policy appointment_read on public.appointments for select to authenticated using (clinic_private.read_appointment(id));
create policy reservation_read on public.appointment_reservations for select to authenticated using (clinic_private.read_appointment(appointment_id));
create policy status_history_read on public.appointment_status_history for select to authenticated using (clinic_private.read_appointment(appointment_id));
create policy assignment_read on public.patient_assignments for select to authenticated using (clinic_private.care_access(organization_id,patient_id,branch_id,false));
create policy grant_read on public.clinical_access_grants for select to authenticated using (
  (clinic_private.owns_patient(organization_id,patient_id) and clinic_private.in_branch(organization_id,branch_id))
  or clinic_private.branch_role(organization_id,branch_id,array['admin']::public.clinic_role[])
  or (user_id=(select auth.uid()) and clinic_private.care_access(organization_id,patient_id,branch_id,false))
);
create policy medical_history_read on public.patient_medical_history for select to authenticated using (clinic_private.patient_access(organization_id,patient_id));
create policy encounter_read on public.clinical_encounters for select to authenticated using (clinic_private.read_encounter(id));
create policy vitals_read on public.encounter_vitals for select to authenticated using (clinic_private.read_encounter(encounter_id));
create policy prescription_read on public.prescriptions for select to authenticated using (clinic_private.read_encounter(encounter_id));
create policy medication_read on public.prescription_items for select to authenticated using (clinic_private.read_prescription(prescription_id));
create policy document_read on public.medical_documents for select to authenticated using (
  clinic_private.care_access(organization_id,patient_id,branch_id,false)
  and (encounter_id is null or clinic_private.read_encounter(encounter_id))
);
create policy charge_read on public.consultation_charges for select to authenticated using (clinic_private.read_appointment(appointment_id));
create policy payment_read on public.payment_records for select to authenticated using (clinic_private.read_appointment(appointment_id));
create policy recipient_read on public.notification_recipients for select to authenticated using (
  user_id=(select auth.uid()) and clinic_private.is_member(organization_id)
);
create policy recipient_update on public.notification_recipients for update to authenticated
  using (user_id=(select auth.uid()) and clinic_private.is_member(organization_id))
  with check (user_id=(select auth.uid()) and clinic_private.is_member(organization_id));
create policy notification_read on public.notifications for select to authenticated using (exists (
  select 1 from public.notification_recipients r where r.organization_id=notifications.organization_id and r.notification_id=notifications.id
));
create policy audit_read on public.audit_logs for select to authenticated using (
  (branch_id is null and clinic_private.has_role(organization_id,array['admin']::public.clinic_role[]))
  or clinic_private.branch_role(organization_id,branch_id,array['admin']::public.clinic_role[])
);

grant select on public.organizations, public.profiles, public.organization_memberships, public.role_assignments,
  public.branches, public.branch_memberships, public.specializations, public.symptom_categories, public.specialization_symptoms,
  public.doctors, public.doctor_branch_assignments, public.patients, public.patient_branches, public.doctor_invitations,
  public.doctor_schedules, public.schedule_breaks, public.doctor_leave, public.appointment_slots, public.appointments,
  public.appointment_reservations, public.appointment_status_history, public.patient_assignments, public.clinical_access_grants,
  public.patient_medical_history, public.clinical_encounters, public.encounter_vitals, public.prescriptions, public.prescription_items,
  public.medical_documents, public.consultation_charges, public.payment_records, public.notifications, public.notification_recipients,
  public.audit_logs to authenticated;
grant update(read_at) on public.notification_recipients to authenticated;
commit;
