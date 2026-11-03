import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkInPatientSchema } from '../packages/validation/src/index';
import { canDiscoverPatient, canViewPatient } from '../packages/permissions/src/index';
import { createMockRepository } from '../packages/data-access/src/index';
import { appointmentRequestSource } from '../packages/clinic-core/src/index';
test('directory-preselected new intake books as walk-in, never as an unauthorized follow-up', () => {
  const state = createMockRepository().getSnapshot();
  const actor = state.profiles.find((p) => p.role === 'doctor')!;
  const p = state.patients[0];
  const branch = actor.branchIds[0];
  state.patientIntakes = [
    {
      patientId: p.id,
      branchId: branch,
      createdBy: actor.id,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      bloodGroup: null,
      clinicalAccess: false,
    },
  ];
  assert.equal(appointmentRequestSource(actor, state, p.id, branch, true), 'walk_in');
  state.patientIntakes[0].clinicalAccess = true;
  assert.equal(appointmentRequestSource(actor, state, p.id, branch, true), 'follow_up');
});
test('staff registration needs age and name, not email/phone/Auth account', () => {
  const input = {
    name: 'Fictional Walk-in',
    ageYears: 0,
    gender: 'Other',
    requestId: crypto.randomUUID(),
    branchId: crypto.randomUUID(),
  };
  const p = walkInPatientSchema.parse(input);
  assert.equal(p.email, '');
  assert.equal(p.phone, '');
  assert.equal(p.bloodGroup, '');
  for (const bad of [
    { ...input, ageYears: 121 },
    { ...input, user_id: crypto.randomUUID() },
    { ...input, email: 'bad' },
    { ...input, dateOfBirth: '2000-01-01' },
  ])
    assert.equal(walkInPatientSchema.safeParse(bad).success, false);
});
test('temporary intake discovery never implies clinical-record access, even with a pending appointment', () => {
  const state = createMockRepository().getSnapshot();
  const actor = state.profiles.find((p) => p.role === 'doctor')!;
  const p = state.patients[0];
  state.grants = [];
  state.patientIntakes = [
    {
      patientId: p.id,
      branchId: actor.branchIds[0],
      createdBy: actor.id,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      bloodGroup: 'B+',
      clinicalAccess: false,
    },
  ];
  state.appointments = state.appointments.filter((a) => a.patientId !== p.id);
  assert.equal(canDiscoverPatient(actor, p.id, state, actor.branchIds[0]), true);
  assert.equal(canViewPatient(actor, p.id, state), false);
  state.patientIntakes[0].clinicalAccess = true;
  assert.equal(canViewPatient(actor, p.id, state), true);
  state.patientIntakes[0].clinicalAccess = false;
  state.patientIntakes[0].expiresAt = new Date(0).toISOString();
  assert.equal(canDiscoverPatient(actor, p.id, state, actor.branchIds[0]), false);
});
