import type {
  Appointment,
  Branch,
  ClinicNotification,
  ClinicRepository,
  Consultation,
  DoctorInvitation,
  MedicalDocument,
  MedicalHistory,
  Patient,
  PrescriptionItem,
  Schedule,
  UserProfile,
} from '@sro/types';
import { availableSlots, DEMO_DATE, statusLabels, transitions } from '@sro/clinic-core';
import {
  canManageAppointment,
  canRequestChange,
  canViewPatient,
  canWriteClinical,
} from '@sro/permissions';
import {
  bookingSchema,
  branchSchema,
  documentSchema,
  invitationSchema,
  prescriptionItemSchema,
  patientSchema,
  leaveSchema,
  clinicTimeSchema,
} from '@sro/validation';
import { createSeed } from './seed';
export { createSeed } from './seed';

export function createMockRepository(): ClinicRepository & {
  reset(): void;
  markRead(actor: UserProfile): void;
  invite(
    actor: UserProfile,
    input: Omit<DoctorInvitation, 'id' | 'status' | 'token'>,
  ): DoctorInvitation;
  saveBranch(actor: UserProfile, input: Omit<Branch, 'id' | 'organizationId'>, id?: string): void;
  grant(actor: UserProfile, patientId: string, userId: string, reason: string): void;
  addLeave(
    actor: UserProfile,
    doctorId: string,
    branchId: string,
    startDate: string,
    endDate: string,
    reason: string,
  ): void;
  saveSchedule(actor: UserProfile, input: Schedule): void;
  saveConsultation(
    actor: UserProfile,
    input: Omit<Consultation, 'id' | 'doctorId' | 'date' | 'branchId'>,
    items: PrescriptionItem[],
  ): void;
  addDocument(actor: UserProfile, input: Omit<MedicalDocument, 'id' | 'date' | 'demoOnly'>): void;
  addPatient(
    actor: UserProfile,
    input: Pick<Patient, 'name' | 'dateOfBirth' | 'gender' | 'phone' | 'email' | 'branchId'>,
  ): Patient;
  setTwoFactor(actor: UserProfile, enabled: boolean): void;
  saveProfile(
    actor: UserProfile,
    name: string,
    email: string,
    details?: { phone: string; dateOfBirth: string; gender: string; address: string },
  ): void;
  saveHistory(actor: UserProfile, patientId: string, history: MedicalHistory): void;
  saveFee(actor: UserProfile, doctorId: string, branchId: string, fee: number): void;
  addSpecialization(actor: UserProfile, name: string, description: string): void;
  setPayment(actor: UserProfile, id: string, paid: boolean): void;
  saveDoctor(
    actor: UserProfile,
    doctorId: string,
    input: { bio: string; qualifications: string; experience: number; specializationId: string },
  ): void;
  assignDoctor(actor: UserProfile, doctorId: string, branchId: string): void;
} {
  let state = createSeed();
  const listeners = new Set<() => void>();
  let sequence = 100;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const assert = (
    allowed: boolean,
    message = 'This action is unavailable for the selected demo role.',
  ) => {
    if (!allowed) throw new Error(message);
  };
  const admin = (actor: UserProfile) => assert(actor.role === 'admin');
  const notify = (
    kind: ClinicNotification['kind'],
    title: string,
    message: string,
    appointment?: Appointment,
    recipientIds?: string[],
  ) => {
    const recipients = recipientIds ?? [
      'u-admin',
      ...state.profiles
        .filter(
          (p) =>
            p.doctorId === appointment?.doctorId ||
            (appointment && p.patientId === appointment.patientId),
        )
        .map((p) => p.id),
    ];
    state.notifications.unshift({
      id: id('n'),
      kind,
      title,
      message,
      recipientIds: [...new Set(recipients)],
      readBy: [],
      time: 'Just now',
      appointmentId: appointment?.id,
    });
  };
  const commit = (actor: UserProfile, action: string) => {
    state.audit.unshift({ id: id('log'), actorId: actor.id, action, time: 'Just now' });
    state = { ...state };
    listeners.forEach((l) => l());
  };
  const find = (appointmentId: string) => {
    const a = state.appointments.find((x) => x.id === appointmentId);
    if (!a) throw new Error('Appointment not found.');
    return a;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      state = createSeed();
      sequence = 100;
      listeners.forEach((l) => l());
    },
    book(actor, input) {
      const data = bookingSchema.parse(input);
      assert(
        actor.role === 'admin' || actor.role === 'doctor' || actor.patientId === data.patientId,
      );
      assert(
        state.patients.some((p) => p.id === data.patientId),
        'Select a registered patient.',
      );
      assert(
        availableSlots(state, data.doctorId, data.branchId, data.date).includes(data.time),
        'This slot is no longer available. Please choose another time.',
      );
      const assignment = state.assignments.find(
        (a) => a.doctorId === data.doctorId && a.branchId === data.branchId,
      )!;
      const appointment: Appointment = {
        ...data,
        id: id('apt'),
        duration: assignment.slotMinutes,
        status: 'pending',
        fee: assignment.fee,
        paymentStatus: assignment.fee ? 'unpaid' : 'waived',
        source: data.source ?? 'patient',
      };
      state.appointments = [...state.appointments, appointment];
      notify(
        'request',
        'Appointment request submitted',
        'Your appointment is awaiting Admin or Doctor approval.',
        appointment,
      );
      commit(actor, 'Submitted appointment request');
      return appointment;
    },
    transition(actor, appointmentId, status) {
      const a = find(appointmentId);
      assert(
        status === 'cancellation_requested'
          ? canRequestChange(actor, a)
          : canManageAppointment(actor, a),
      );
      assert(
        transitions[a.status].includes(status),
        `Cannot change ${statusLabels[a.status]} to ${statusLabels[status]}.`,
      );
      if (status === 'confirmed') {
        const slot = a.requestedSlot ?? { date: a.date, time: a.time };
        assert(
          availableSlots(state, a.doctorId, a.branchId, slot.date, a.id).includes(slot.time),
          'The requested time is unavailable. Request another slot.',
        );
        a.date = slot.date;
        a.time = slot.time;
        delete a.requestedSlot;
        delete a.requestReason;
      }
      if (['cancelled', 'rejected'].includes(status)) delete a.requestedSlot;
      a.status = status;
      state.appointments = [...state.appointments];
      notify(
        status === 'confirmed'
          ? 'confirmation'
          : ['cancelled', 'rejected', 'cancellation_requested'].includes(status)
            ? 'cancellation'
            : status === 'completed'
              ? 'consultation'
              : 'request',
        statusLabels[status],
        `Appointment ${a.id}: ${statusLabels[status].toLowerCase()}.`,
        a,
      );
      commit(actor, `Appointment ${a.id}: ${statusLabels[status]}`);
    },
    requestReschedule(actor, appointmentId, date, time, reason) {
      const a = find(appointmentId);
      assert(canRequestChange(actor, a));
      assert(
        ['confirmed', 'reschedule_requested', 'doctor_unavailable'].includes(a.status),
        'This appointment cannot be rescheduled in its current state.',
      );
      assert(reason.trim().length >= 3, 'Please explain the rescheduling request.');
      assert(date !== a.date || time !== a.time, 'Choose a different appointment time.');
      assert(
        availableSlots(state, a.doctorId, a.branchId, date, a.id).includes(time),
        'Select an available slot.',
      );
      a.requestedSlot = { date, time };
      a.requestReason = reason;
      a.status = 'reschedule_requested';
      state.appointments = [...state.appointments];
      notify(
        'reschedule',
        'Reschedule approval needed',
        'The original slot is held until a new time is approved.',
        a,
      );
      commit(actor, `Requested reschedule for ${a.id}`);
    },
    markRead(actor) {
      state.notifications = state.notifications.map((n) =>
        n.recipientIds.includes(actor.id) && !n.readBy.includes(actor.id)
          ? { ...n, readBy: [...n.readBy, actor.id] }
          : n,
      );
      state = { ...state };
      listeners.forEach((l) => l());
    },
    invite(actor, input) {
      admin(actor);
      const data = invitationSchema.parse(input);
      assert(
        !state.invitations.some((i) => i.email === data.email && i.status === 'draft'),
        'A demo invitation already exists for this email.',
      );
      const invitation: DoctorInvitation = {
        ...data,
        id: id('invite'),
        status: 'draft',
        token: id('demo-token'),
      };
      state.invitations = [...state.invitations, invitation];
      notify(
        'invitation',
        'Demo invitation prepared',
        `${data.name}: no email was sent.`,
        undefined,
        [actor.id],
      );
      commit(actor, `Prepared mock doctor invitation for ${data.email}`);
      return invitation;
    },
    saveBranch(actor, input, branchId) {
      admin(actor);
      const data = branchSchema.parse(input);
      if (branchId)
        state.branches = state.branches.map((b) => (b.id === branchId ? { ...b, ...data } : b));
      else
        state.branches = [
          ...state.branches,
          { ...data, id: id('branch'), organizationId: state.organization.id },
        ];
      commit(actor, 'Updated branch directory');
    },
    grant(actor, patientId, userId, reason) {
      admin(actor);
      assert(
        state.patients.some((p) => p.id === patientId) &&
          state.profiles.some(
            (p) => p.id === userId && ['doctor', 'clinical_staff'].includes(p.role),
          ),
        'Choose a clinician and patient.',
      );
      assert(reason.trim().length >= 3, 'Enter an access reason.');
      state.grants = [
        ...state.grants.filter((g) => !(g.patientId === patientId && g.userId === userId)),
        { patientId, userId, grantedBy: actor.id, reason },
      ];
      commit(actor, 'Added authorized clinician to patient record');
    },
    addLeave(actor, doctorId, branchId, startDate, endDate, reason) {
      assert(actor.role === 'admin' || actor.doctorId === doctorId);
      leaveSchema.parse({ startDate, endDate, reason });
      assert(
        startDate >= DEMO_DATE && endDate >= startDate && reason.trim().length > 2,
        'Enter valid leave dates and a reason.',
      );
      assert(
        !state.appointments.some(
          (a) =>
            a.doctorId === doctorId &&
            a.date >= startDate &&
            a.date <= endDate &&
            ['in_consultation', 'checked_in'].includes(a.status),
        ),
        'Finish or resolve checked-in consultations before adding leave.',
      );
      state.leaves = [
        ...state.leaves,
        { id: id('leave'), doctorId, branchId, startDate, endDate, reason },
      ];
      state.appointments = state.appointments.map((a) => {
        if (
          a.doctorId !== doctorId ||
          !['pending', 'confirmed', 'reschedule_requested', 'cancellation_requested'].includes(
            a.status,
          )
        )
          return a;
        const currentAffected = a.date >= startDate && a.date <= endDate;
        const requestAffected =
          a.requestedSlot && a.requestedSlot.date >= startDate && a.requestedSlot.date <= endDate;
        if (!currentAffected && !requestAffected) return a;
        const next = { ...a, status: 'doctor_unavailable' as const, requestedSlot: undefined };
        notify(
          'leave',
          'Doctor unavailable',
          'Please choose a new time or request cancellation. No automatic reassignment has been made.',
          next,
        );
        return next;
      });
      notify('leave', 'Doctor leave recorded', `${startDate} to ${endDate}: ${reason}`, undefined, [
        'u-admin',
        `u-${doctorId}`,
      ]);
      commit(actor, 'Recorded doctor leave and flagged affected appointments');
    },
    saveSchedule(actor, input) {
      clinicTimeSchema.parse(input.start);
      clinicTimeSchema.parse(input.end);
      assert(actor.role === 'admin' || actor.doctorId === input.doctorId);
      assert(
        input.days.length > 0 &&
          input.start < input.end &&
          input.breaks.every(
            (b) => b.start >= input.start && b.end <= input.end && b.start < b.end,
          ),
        'Enter valid working hours and break times.',
      );
      const next = {
        ...state,
        schedules: [...state.schedules.filter((s) => s.id !== input.id), input],
      };
      const conflicts = state.appointments.filter(
        (a) =>
          a.doctorId === input.doctorId &&
          a.date >= DEMO_DATE &&
          [
            'pending',
            'confirmed',
            'checked_in',
            'in_consultation',
            'reschedule_requested',
            'cancellation_requested',
          ].includes(a.status),
      );
      assert(
        conflicts.every(
          (a) =>
            availableSlots(next, a.doctorId, a.branchId, a.date, a.id).includes(a.time) &&
            (!a.requestedSlot ||
              availableSlots(next, a.doctorId, a.branchId, a.requestedSlot.date, a.id).includes(
                a.requestedSlot.time,
              )),
        ),
        'The new schedule conflicts with existing appointments. Resolve those appointments or record leave first.',
      );
      state.schedules = next.schedules;
      commit(actor, 'Updated weekly availability');
    },
    saveConsultation(actor, input, items) {
      assert(canWriteClinical(actor, input.patientId, state));
      const a = find(input.appointmentId);
      assert(
        canManageAppointment(actor, a) && a.patientId === input.patientId,
        'Select your assigned consultation.',
      );
      assert(
        a.status === 'in_consultation',
        'Start the consultation before saving clinical notes.',
      );
      assert(input.symptoms.trim().length > 2, 'Enter presenting symptoms.');
      if (input.status === 'signed')
        assert(
          input.diagnosis.trim().length > 2 && input.plan.trim().length > 2,
          'Diagnosis and treatment plan are required to sign.',
        );
      const parsedItems = items.map((item) => prescriptionItemSchema.parse(item));
      const existing = state.consultations.find((c) => c.appointmentId === input.appointmentId);
      assert(
        existing?.status !== 'signed',
        'Signed consultations cannot be overwritten in the demo.',
      );
      const consultation: Consultation = {
        ...input,
        id: existing?.id ?? id('consultation'),
        doctorId: a.doctorId,
        branchId: a.branchId,
        date: DEMO_DATE,
      };
      state.consultations = [
        ...state.consultations.filter((c) => c.id !== consultation.id),
        consultation,
      ];
      if (parsedItems.length && input.status === 'signed') {
        state.prescriptions = [
          ...state.prescriptions,
          {
            id: id('rx'),
            consultationId: consultation.id,
            patientId: a.patientId,
            doctorId: a.doctorId,
            date: DEMO_DATE,
            items: parsedItems,
            instructions: input.followUp,
          },
        ];
        notify(
          'prescription',
          'New prescription available',
          'Your clinician added a digital prescription.',
          a,
        );
      }
      if (input.status === 'signed') {
        state.appointments = state.appointments.map((x) =>
          x.id === a.id ? { ...x, status: 'completed' } : x,
        );
        notify(
          'consultation',
          'Consultation completed',
          'Your visit summary is available in medical records.',
          a,
        );
      }
      commit(
        actor,
        input.status === 'signed'
          ? 'Signed consultation and completed visit'
          : 'Saved consultation draft',
      );
    },
    addDocument(actor, input) {
      assert(canWriteClinical(actor, input.patientId, state));
      documentSchema.parse(input);
      assert(canViewPatient(actor, input.patientId, state));
      state.documents = [
        ...state.documents,
        { ...input, id: id('document'), date: DEMO_DATE, demoOnly: true },
      ];
      commit(actor, 'Added local document metadata · no file uploaded');
    },
    addPatient(actor, input) {
      patientSchema.parse(input);
      assert(
        state.branches.some((b) => b.id === input.branchId && b.active),
        'Choose an active branch.',
      );
      assert(actor.role === 'admin' || actor.role === 'doctor');
      assert(
        input.name.trim().length > 2 && input.phone.length >= 10 && input.dateOfBirth <= DEMO_DATE,
        'Enter the patient name, date of birth, and phone.',
      );
      const patient: Patient = {
        ...input,
        id: id('patient'),
        initials: input.name
          .split(' ')
          .map((s) => s[0])
          .slice(0, 2)
          .join(''),
        address: '',
        history: {
          allergies: [],
          conditions: [],
          medications: [],
          surgeries: 'Not recorded',
          familyHistory: 'Not recorded',
          socialHistory: 'Not recorded',
          bloodGroup: 'Unknown',
          emergencyContact: 'Not recorded',
        },
      };
      state.patients = [...state.patients, patient];
      commit(actor, 'Registered fictional walk-in patient');
      return patient;
    },
    setTwoFactor(actor, enabled) {
      state.profiles = state.profiles.map((p) =>
        p.id === actor.id ? { ...p, twoFactorEnabled: enabled } : p,
      );
      commit(
        actor,
        `${enabled ? 'Enabled' : 'Disabled'} demo 2FA preference · no authentication configured`,
      );
    },
    saveHistory(actor, patientId, history) {
      assert(canWriteClinical(actor, patientId, state));
      assert(
        history.emergencyContact.trim().length > 2,
        'Record an emergency contact or explicitly mark it not recorded.',
      );
      state.patients = state.patients.map((p) => (p.id === patientId ? { ...p, history } : p));
      commit(actor, 'Updated structured medical history');
    },
    saveProfile(actor, name, email, details) {
      if (actor.patientId && details) {
        const patient = state.patients.find((p) => p.id === actor.patientId)!;
        patientSchema.parse({ ...patient, ...details, name, email });
        assert(details.dateOfBirth <= DEMO_DATE, 'Date of birth cannot be in the future.');
      }
      assert(
        name.trim().length > 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email),
        'Enter a name and valid email.',
      );
      state.profiles = state.profiles.map((p) => (p.id === actor.id ? { ...p, name, email } : p));
      if (actor.patientId)
        state.patients = state.patients.map((p) =>
          p.id === actor.patientId
            ? {
                ...p,
                ...details,
                name,
                email,
                initials: name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join(''),
              }
            : p,
        );
      if (actor.doctorId)
        state.doctors = state.doctors.map((d) =>
          d.id === actor.doctorId ? { ...d, name, email } : d,
        );
      commit(actor, 'Updated demo profile');
    },
    saveFee(actor, doctorId, branchId, fee) {
      admin(actor);
      assert(Number.isFinite(fee) && fee >= 0, 'Enter a valid consultation fee.');
      state.assignments = state.assignments.map((a) =>
        a.doctorId === doctorId && a.branchId === branchId ? { ...a, fee } : a,
      );
      commit(actor, 'Updated consultation fee for future bookings');
    },
    addSpecialization(actor, name, description) {
      admin(actor);
      assert(
        name.trim().length > 2 &&
          !state.specializations.some((s) => s.name.toLowerCase() === name.trim().toLowerCase()),
        'Enter a unique department name.',
      );
      state.specializations = [
        ...state.specializations,
        { id: id('specialty'), name: name.trim(), description, symptomCategories: [] },
      ];
      commit(actor, 'Added medical department');
    },
    setPayment(actor, appointmentId, paid) {
      const a = find(appointmentId);
      assert(canManageAppointment(actor, a));
      a.paymentStatus = a.fee === 0 ? 'waived' : paid ? 'paid' : 'unpaid';
      state.appointments = [...state.appointments];
      commit(actor, `Updated manual payment status for ${appointmentId}`);
    },
    saveDoctor(actor, doctorId, input) {
      assert(actor.role === 'admin' || actor.doctorId === doctorId);
      assert(
        input.qualifications.trim().length > 2 &&
          input.bio.trim().length > 5 &&
          Number.isFinite(input.experience) &&
          input.experience >= 0,
        'Enter professional details.',
      );
      state.doctors = state.doctors.map((d) => (d.id === doctorId ? { ...d, ...input } : d));
      commit(actor, 'Updated doctor professional profile');
    },
    assignDoctor(actor, doctorId, branchId) {
      admin(actor);
      assert(
        state.doctors.some((d) => d.id === doctorId) &&
          state.branches.some((b) => b.id === branchId),
        'Select a doctor and branch.',
      );
      assert(
        !state.assignments.some((a) => a.doctorId === doctorId && a.branchId === branchId),
        'This doctor is already assigned to the branch.',
      );
      state.assignments = [
        ...state.assignments,
        { doctorId, branchId, fee: 0, slotMinutes: 30, active: true },
      ];
      state.schedules = [
        ...state.schedules,
        {
          id: id('schedule'),
          doctorId,
          branchId,
          days: [1, 2, 3, 4, 5, 6],
          start: '09:00',
          end: '17:00',
          breaks: [{ start: '13:00', end: '14:00' }],
        },
      ];
      state.profiles = state.profiles.map((p) =>
        p.doctorId === doctorId ? { ...p, branchIds: [...p.branchIds, branchId] } : p,
      );
      commit(
        actor,
        'Assigned doctor to additional branch · review schedule to prevent travel conflicts',
      );
    },
  };
}
export const clinic = createMockRepository();
