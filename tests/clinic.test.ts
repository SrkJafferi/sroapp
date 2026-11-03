import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockRepository } from '../packages/data-access/src/index';
import { availableSlots, DEMO_DATE, getActor } from '../packages/clinic-core/src/index';
import { canViewPatient } from '../packages/permissions/src/index';
test('booking holds a slot, requires approval, and rejects double booking', () => {
  const repo = createMockRepository();
  const actor = getActor(repo.getSnapshot(), 'patient');
  const time = availableSlots(repo.getSnapshot(), 'd1', 'b1', DEMO_DATE)[0];
  const input = {
    doctorId: 'd1',
    branchId: 'b1',
    patientId: 'p1',
    date: DEMO_DATE,
    time,
    type: 'physical' as const,
    reason: 'Routine check-up',
  };
  const a = repo.book(actor, input);
  assert.equal(a.status, 'pending');
  assert.throws(() => repo.book(actor, input), /slot is no longer available/);
  assert.throws(() => repo.transition(actor, a.id, 'confirmed'));
  repo.transition(getActor(repo.getSnapshot(), 'admin'), a.id, 'confirmed');
  assert.equal(repo.getSnapshot().appointments.find((x) => x.id === a.id)?.status, 'confirmed');
});
test('rescheduling holds original and requested slots until approval', () => {
  const repo = createMockRepository();
  const state = repo.getSnapshot();
  const patient = getActor(state, 'patient');
  const time = availableSlots(state, 'd1', 'b1', '2026-10-27')[0];
  repo.requestReschedule(patient, 'a6', '2026-10-27', time, 'Work commitment');
  assert(!availableSlots(repo.getSnapshot(), 'd1', 'b1', DEMO_DATE).includes('11:30'));
  assert(!availableSlots(repo.getSnapshot(), 'd1', 'b1', '2026-10-27').includes(time));
  repo.transition(getActor(state, 'admin'), 'a6', 'confirmed');
  assert(availableSlots(repo.getSnapshot(), 'd1', 'b1', DEMO_DATE).includes('11:30'));
});
test('leave disables availability across branches and flags affected bookings', () => {
  const repo = createMockRepository();
  const admin = getActor(repo.getSnapshot(), 'admin');
  repo.addLeave(admin, 'd2', 'b1', DEMO_DATE, DEMO_DATE, 'Planned leave');
  assert.deepEqual(availableSlots(repo.getSnapshot(), 'd2', 'b1', DEMO_DATE), []);
  assert.equal(
    repo.getSnapshot().appointments.find((a) => a.id === 'a2')?.status,
    'doctor_unavailable',
  );
});
test('unassigned doctors cannot view records unless explicitly granted', () => {
  const repo = createMockRepository();
  const state = repo.getSnapshot();
  const doctor = state.profiles.find((p) => p.doctorId === 'd2')!;
  assert.equal(canViewPatient(doctor, 'p1', state), false);
  repo.grant(getActor(state, 'admin'), 'p1', doctor.id, 'Shared clinical care');
  assert.equal(canViewPatient(doctor, 'p1', repo.getSnapshot()), true);
  assert.equal(canViewPatient(getActor(state, 'patient'), 'p2', state), false);
});
test('cancellation is a request and notifies recipients without refresh', () => {
  const repo = createMockRepository();
  const state = repo.getSnapshot();
  let updates = 0;
  const unsubscribe = repo.subscribe(() => updates++);
  repo.transition(getActor(state, 'patient'), 'a6', 'cancellation_requested');
  assert.equal(
    repo.getSnapshot().appointments.find((a) => a.id === 'a6')?.status,
    'cancellation_requested',
  );
  repo.transition(getActor(state, 'admin'), 'a6', 'cancelled');
  assert.equal(updates, 2);
  assert(repo.getSnapshot().notifications[0].recipientIds.includes('u-patient'));
  unsubscribe();
});
test('consultations must be assigned and started before signing', () => {
  const repo = createMockRepository();
  const state = repo.getSnapshot();
  const doctor = getActor(state, 'doctor');
  const data = {
    appointmentId: 'a6',
    patientId: 'p1',
    symptoms: 'Follow-up',
    vitals: { bloodPressure: '', pulse: '', temperature: '', weight: '', oxygen: '', height: '' },
    examination: '',
    diagnosis: 'Fictional diagnosis',
    plan: 'Fictional plan',
    followUp: '',
    status: 'signed' as const,
  };
  assert.throws(() => repo.saveConsultation(doctor, data, []), /Start the consultation/);
  repo.transition(doctor, 'a6', 'in_consultation');
  repo.saveConsultation(doctor, data, []);
  assert.equal(repo.getSnapshot().appointments.find((a) => a.id === 'a6')?.status, 'completed');
});
test('additional branches share doctor conflict checks', () => {
  const repo = createMockRepository();
  const admin = getActor(repo.getSnapshot(), 'admin');
  repo.saveBranch(admin, {
    name: 'Demo Outreach',
    address: 'Fictional outreach location',
    phone: '+92 300 000 1122',
    active: true,
  });
  const branch = repo.getSnapshot().branches[1];
  repo.assignDoctor(admin, 'd1', branch.id);
  assert(!availableSlots(repo.getSnapshot(), 'd1', branch.id, DEMO_DATE).includes('11:30'));
  assert(availableSlots(repo.getSnapshot(), 'd1', branch.id, DEMO_DATE).includes('09:30'));
});
test('schedules cannot invalidate existing bookings', () => {
  const repo = createMockRepository();
  const state = repo.getSnapshot();
  const schedule = state.schedules[0];
  assert.throws(
    () => repo.saveSchedule(getActor(state, 'admin'), { ...schedule, start: '12:00' }),
    /conflicts/,
  );
  assert.equal(repo.getSnapshot().schedules[0].start, '09:00');
});
test('invalid documents and patient dates do not mutate data', () => {
  const repo = createMockRepository();
  const state = repo.getSnapshot();
  assert.throws(() =>
    repo.addDocument(getActor(state, 'doctor'), {
      patientId: 'p1',
      doctorId: 'd1',
      name: 'test.exe',
      mimeType: 'application/octet-stream',
      size: 5,
      kind: 'report',
    }),
  );
  assert.throws(() =>
    repo.addPatient(getActor(state, 'admin'), {
      name: 'Fictional Patient',
      email: 'person@example.test',
      dateOfBirth: 'invalid-date',
      gender: 'Other',
      phone: '+92 300 000 1234',
      branchId: 'b1',
    }),
  );
  assert.equal(repo.getSnapshot().documents.length, 1);
  assert.equal(repo.getSnapshot().patients.length, 12);
});
test('medical history requires a clinician and profile edits stay consistent', () => {
  const repo = createMockRepository();
  const state = repo.getSnapshot();
  const history = { ...state.patients[0].history, allergies: ['Fictional allergy'] };
  assert.throws(() => repo.saveHistory(getActor(state, 'patient'), 'p1', history));
  repo.saveHistory(getActor(state, 'doctor'), 'p1', history);
  assert.equal(repo.getSnapshot().patients[0].history.allergies[0], 'Fictional allergy');
  repo.saveProfile(getActor(state, 'patient'), 'Ali Demo', 'ali.demo@example.test', {
    phone: '+92 300 000 0001',
    dateOfBirth: '1992-01-15',
    gender: 'Male',
    address: 'Fictional address',
  });
  assert.equal(repo.getSnapshot().patients[0].name, 'Ali Demo');
  assert.equal(getActor(repo.getSnapshot(), 'patient').name, 'Ali Demo');
});
