import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockRepository } from '../packages/data-access/src/index';
import { createClinicalRepository } from '../apps/web/lib/clinical-client';
import { profileFields } from '../apps/web/lib/profile-contracts';
import { patchProfile } from '../apps/web/lib/profile-patch';
test('booking result uses database status rather than inferring success from the selected role', async () => {
  const original = globalThis.fetch;
  const state = createMockRepository().getSnapshot(),
    actor = state.profiles.find((p) => p.role === 'doctor')!;
  const clinic = createClinicalRepository('doctor', state.organization.id, actor.branchIds[0]);
  try {
    const input = {
      branchId: actor.branchIds[0],
      doctorId: actor.doctorId!,
      patientId: state.patients[0].id,
      slotId: 'slot',
      date: '2099-01-01',
      time: '09:00',
      reason: 'Fictional visit',
      type: 'physical' as const,
      source: 'follow_up' as const,
    };
    for (const status of ['pending', 'confirmed']) {
      globalThis.fetch = async () => Response.json({ saved: true, id: 'appointment-id', status });
      assert.deepEqual(await clinic.book(actor, input), { id: 'appointment-id', status });
    }
    globalThis.fetch = async () =>
      Response.json({ error: 'Booking not authorized' }, { status: 403 });
    await assert.rejects(clinic.book(actor, input), /Booking not authorized/);
  } finally {
    globalThis.fetch = original;
  }
});
test('validated blood-group profile patch changes only the authorized patient history field', () => {
  const state = createMockRepository().getSnapshot(),
    patient = state.patients[0];
  const snapshot = {
    state,
    actor: state.profiles[0],
    organizationId: state.organization.id,
    timezone: state.organization.timezone,
  };
  const profile = {
    organizationId: state.organization.id,
    kind: 'patient' as const,
    id: patient.id,
    name: patient.name,
    userId: null,
    loginEmail: null,
    canEdit: true,
    avatarId: null,
    bloodGroup: 'AB+' as const,
    canEditBloodGroup: true,
  };
  const result = patchProfile(snapshot, profile);
  assert.equal(result.state.patients[0].history.bloodGroup, 'AB+');
  assert.deepEqual(
    { ...result.state.patients[0].history, bloodGroup: patient.history.bloodGroup },
    patient.history,
  );
  assert.deepEqual(result.state.consultations, snapshot.state.consultations);
  assert.deepEqual(result.state.prescriptions, snapshot.state.prescriptions);
  assert.equal(patchProfile(snapshot, { ...profile, organizationId: 'unrelated' }), snapshot);
  assert.equal(profileFields.safeParse({ name: patient.name, bloodGroup: 'AB+' }).success, true);
  assert.equal(
    profileFields.safeParse({ name: patient.name, bloodGroup: 'executable' }).success,
    false,
  );
});
