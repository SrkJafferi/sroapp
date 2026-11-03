import type { ClinicState, UserProfile, DemoRole, ClinicNotification } from '@sro/types';
import type { ClinicalRows, ClinicalSnapshot } from './clinical-contracts';
import { localParts, displayName } from './clinical-clock';

export function projectClinicalRows(
  rows: ClinicalRows,
  userId: string,
  role: DemoRole,
  organizationId: string,
  branchIds: string[],
  intakes: NonNullable<ClinicState['patientIntakes']> = [],
): ClinicalSnapshot {
  const org = rows.organizations.find((o) => o.id === organizationId && o.active);
  const profile = rows.profiles.find((p) => p.id === userId && p.active);
  if (!org || !profile) throw new Error('Clinic access is no longer available.');
  const name = (value: string) => displayName(value);
  const initials = (value: string) =>
    value
      .replace(/^Dr\.\s*/, '')
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  const branchTime = (id: string) =>
    rows.branches.find((b) => b.id === id)?.timezone ?? org.timezone;
  const currentDoctor = rows.doctors.find((d) => d.user_id === userId && d.active);
  const currentPatient = rows.patients.find((p) => p.user_id === userId);
  const actor: UserProfile = {
    id: userId,
    name: name(currentDoctor?.name ?? currentPatient?.name ?? profile.name),
    email: profile.email,
    role,
    branchIds,
    doctorId: currentDoctor?.id,
    patientId: currentPatient?.id,
    twoFactorEnabled: false,
  };
  const groupedSchedules = new Map<string, ClinicState['schedules'][number]>();
  for (const s of rows.doctor_schedules) {
    const breaks = rows.schedule_breaks
      .filter((b) => b.schedule_id === s.id)
      .map((b) => ({ start: b.starts_at.slice(0, 5), end: b.ends_at.slice(0, 5) }));
    const key = [
      s.doctor_id,
      s.branch_id,
      s.starts_at,
      s.ends_at,
      s.valid_from,
      s.valid_until,
      JSON.stringify(breaks),
    ].join('|');
    const existing = groupedSchedules.get(key);
    if (existing) existing.days.push(s.weekday);
    else
      groupedSchedules.set(key, {
        id: s.id,
        doctorId: s.doctor_id,
        branchId: s.branch_id,
        days: [s.weekday],
        start: s.starts_at.slice(0, 5),
        end: s.ends_at.slice(0, 5),
        breaks,
      });
  }
  const state: ClinicState = {
    ...(intakes.length ? { patientIntakes: intakes } : {}),
    organization: { id: org.id, name: name(org.name), timezone: org.timezone, currency: 'PKR' },
    branches: rows.branches.map((b) => ({
      id: b.id,
      organizationId: b.organization_id,
      name: name(b.name),
      address: b.address,
      phone: b.phone,
      active: b.active,
      timezone: b.timezone,
    })),
    profiles: rows.profiles.map((p) => ({
      id: p.id,
      name: name(p.name),
      email: p.email,
      role:
        p.id === userId
          ? role
          : (rows.role_assignments.find((r) => r.user_id === p.id)?.role ?? 'patient'),
      branchIds: p.id === userId ? branchIds : [],
      doctorId: rows.doctors.find((d) => d.user_id === p.id)?.id,
      patientId: rows.patients.find((t) => t.user_id === p.id)?.id,
      twoFactorEnabled: false,
    })),
    doctors: rows.doctors
      .filter((d) => d.active)
      .map((d) => ({
        id: d.id,
        name: name(d.name),
        initials: d.initials || initials(d.name),
        gender: d.gender,
        specializationId: d.specialization_id,
        qualifications: d.qualifications,
        experience: d.experience,
        bio: d.bio,
        email: d.public_email,
        color: d.color,
      })),
    specializations: [...rows.specializations]
      .sort(
        (a, b) =>
          Number(b.name.trim().toLowerCase() === 'general checkup') -
          Number(a.name.trim().toLowerCase() === 'general checkup'),
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        symptomCategories: rows.specialization_symptoms
          .filter((m) => m.specialization_id === s.id)
          .map((m) => rows.symptom_categories.find((c) => c.id === m.symptom_category_id)?.name)
          .filter((v): v is string => !!v),
      })),
    patients: rows.patients.map((p) => {
      const h = rows.patient_medical_history.find((h) => h.patient_id === p.id);
      // Compatibility before the additive migration is approved. Once the column
      // exists, its value (including historical NULL) is the sole authority for all roles.
      const registration =
        p.registered_at === undefined
          ? rows.audit_logs
              .filter(
                (a) =>
                  a.entity_id === p.id &&
                  a.entity_type === 'patients' &&
                  ['patient.walk_in_registered', 'auth.demo_patient_profile_saved'].includes(
                    a.action,
                  ),
              )
              .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0]
          : undefined;
      const registeredAt = p.registered_at ?? registration?.occurred_at;
      return {
        id: p.id,
        ...(p.patient_code ? { patientCode: p.patient_code } : {}),
        ...(registeredAt
          ? {
              registeredAt,
            }
          : {}),
        name: name(p.name),
        initials: p.initials || initials(p.name),
        dateOfBirth: p.date_of_birth ?? '',
        ...(typeof p.age_years === 'number'
          ? { ageYears: p.age_years, ageRecordedOn: p.age_recorded_on ?? undefined }
          : {}),
        gender: p.gender,
        phone: p.phone,
        email: p.email,
        address: p.address,
        branchId: p.home_branch_id,
        history: {
          allergies: h?.allergies ?? [],
          conditions: h?.conditions ?? [],
          medications: h?.medications ?? [],
          surgeries: h?.surgeries ?? '',
          familyHistory: h?.family_history ?? '',
          socialHistory: h?.social_history ?? '',
          bloodGroup: h?.blood_group ?? intakes.find((i) => i.patientId === p.id)?.bloodGroup ?? '',
          emergencyContact: h?.emergency_contact ?? '',
          reviewState: h?.review_state === 'reviewed' ? 'reviewed' : 'unknown',
        },
      };
    }),
    assignments: rows.doctor_branch_assignments.map((a) => ({
      doctorId: a.doctor_id,
      branchId: a.branch_id,
      fee: Number(a.fee_paisa) / 100,
      slotMinutes: a.slot_minutes,
      active: a.active,
    })),
    schedules: [...groupedSchedules.values()],
    leaves: rows.doctor_leave
      .filter((l) => l.active)
      .map((l) => ({
        id: l.id,
        doctorId: l.doctor_id,
        branchId:
          rows.doctor_branch_assignments.find((a) => a.doctor_id === l.doctor_id)?.branch_id ??
          branchIds[0],
        startDate: localParts(l.starts_at).date,
        endDate: localParts(new Date(new Date(l.ends_at).getTime() - 1)).date,
        reason: l.reason,
      })),
    appointments: rows.appointments.map((a) => {
      const slot = rows.appointment_slots.find((s) => s.id === a.current_slot_id);
      if (!slot) throw new Error('Appointment schedule could not be loaded.');
      const proposed = rows.appointment_reservations.find(
        (r) => r.appointment_id === a.id && r.kind === 'proposed' && r.active,
      );
      const charge = rows.consultation_charges.find((c) => c.appointment_id === a.id);
      return {
        id: a.id,
        branchId: a.branch_id,
        patientId: a.patient_id,
        doctorId: a.doctor_id,
        date: localParts(slot.starts_at, branchTime(a.branch_id)).date,
        time: localParts(slot.starts_at, branchTime(a.branch_id)).time,
        duration: (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) / 60000,
        type: a.type,
        status: a.status,
        reason: a.reason,
        fee: Number(charge?.amount_paisa ?? 0) / 100,
        paymentStatus: charge?.payment_status ?? 'waived',
        source: a.source,
        requestedSlot: proposed
          ? localParts(proposed.starts_at, branchTime(a.branch_id))
          : undefined,
        requestReason: proposed?.request_reason ?? undefined,
      };
    }),
    consultations: rows.clinical_encounters.map((e) => {
      const v = rows.encounter_vitals.find((v) => v.encounter_id === e.id);
      return {
        id: e.id,
        appointmentId: e.appointment_id,
        patientId: e.patient_id,
        doctorId: e.doctor_id,
        branchId: e.branch_id,
        date: localParts(e.signed_at ?? e.created_at, branchTime(e.branch_id)).date,
        recordedAt: e.signed_at ?? e.created_at,
        symptoms: e.symptoms,
        examination: e.examination,
        diagnosis: e.diagnosis,
        plan: e.plan,
        followUp: e.follow_up,
        status: e.status,
        vitals: {
          bloodPressure: v?.blood_pressure ?? '',
          pulse: v?.pulse ?? '',
          temperature: v?.temperature ?? '',
          oxygen: v?.oxygen ?? '',
          weight: v?.weight ?? '',
          height: v?.height ?? '',
        },
      };
    }),
    prescriptions: rows.prescriptions.map((p) => {
      const encounter = rows.clinical_encounters.find((e) => e.id === p.encounter_id);
      if (!encounter) throw new Error('Prescription authorization changed.');
      return {
        id: p.id,
        patientId: encounter.patient_id,
        doctorId: encounter.doctor_id,
        consultationId: encounter.id,
        date: localParts(p.issued_at ?? encounter.created_at, branchTime(encounter.branch_id)).date,
        instructions: p.instructions,
        items: rows.prescription_items
          .filter((i) => i.prescription_id === p.id)
          .sort((a, b) => a.line_number - b.line_number)
          .map((i) => ({
            medication: i.medication,
            strength: i.strength,
            dosage: i.dosage,
            frequency: i.frequency,
            duration: i.duration,
            instructions: i.instructions,
          })),
      };
    }),
    documents: rows.medical_documents
      .filter((d) => !!d.storage_object_key)
      .map((d) => ({
        id: d.id,
        patientId: d.patient_id,
        doctorId: rows.doctors.find((doctor) => doctor.user_id === d.author_id)?.id ?? '',
        consultationId: d.encounter_id ?? undefined,
        kind: d.kind as 'report' | 'handwritten',
        name: d.name,
        mimeType: d.mime_type,
        size: d.size_bytes,
        date: localParts(d.created_at, branchTime(d.branch_id)).date,
        demoOnly: false,
      })),
    grants: rows.clinical_access_grants
      .filter(
        (g) => g.revoked_at === null && (!g.expires_at || new Date(g.expires_at) > new Date()),
      )
      .map((g) => ({
        patientId: g.patient_id,
        userId: g.user_id,
        grantedBy: g.granted_by,
        reason: g.reason,
      })),
    notifications: [...rows.notifications]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((n) => ({
        id: n.id,
        kind: n.kind as ClinicNotification['kind'],
        title: n.title,
        message: n.message,
        time: new Date(n.created_at).toLocaleString('en-PK', { timeZone: org.timezone }),
        appointmentId: n.appointment_id ?? undefined,
        doctorId: n.doctor_id ?? undefined,
        branchId: n.branch_id ?? undefined,
        recipientIds: rows.notification_recipients
          .filter((r) => r.notification_id === n.id)
          .map((r) => r.user_id),
        readBy: rows.notification_recipients
          .filter((r) => r.notification_id === n.id && r.read_at)
          .map((r) => r.user_id),
      })),
    audit: rows.audit_logs.map((a) => ({
      id: a.id,
      actorId: a.actor_id ?? '',
      action: a.action.replace(/demo_/gi, '').replace(/[._]/g, ' '),
      time: new Date(a.occurred_at).toLocaleString('en-PK', { timeZone: org.timezone }),
    })),
    invitations: rows.doctor_invitations.map((i) => ({
      createdAt: i.created_at,
      expiresAt: i.expires_at,
      sentAt:
        (i as typeof i & { sent_at?: string | null }).sent_at ??
        rows.audit_logs
          .filter((a) => a.entity_id === i.id && a.action === 'auth.invitation_sent')
          .map((a) => a.occurred_at)
          .sort()
          .at(-1),
      id: i.id,
      name: name(i.name),
      email: i.email,
      specializationId: i.specialization_id,
      branchId: i.branch_id,
      status: i.status,
      token: '',
    })),
  };
  return { state, actor, timezone: org.timezone, organizationId: org.id };
}
