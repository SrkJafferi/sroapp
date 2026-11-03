import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockRepository } from '../packages/data-access/src/index';
import { profileFields, type EditableProfile } from '../apps/web/lib/profile-contracts';
import { patchProfile } from '../apps/web/lib/profile-patch';
import type { ClinicalSnapshot } from '../apps/web/lib/clinical-contracts';

test('department profile contract accepts UUIDs only and rejects client permission flags', () => {
  const id = '70000000-0000-4000-8000-000000000003';
  assert.equal(
    profileFields.parse({ name: 'Fictional Doctor', specializationId: id }).specializationId,
    id,
  );
  for (const specializationId of ['', 'Cardiology', null, ['anything'], 1])
    assert.equal(
      profileFields.safeParse({ name: 'Fictional Doctor', specializationId }).success,
      false,
    );
  assert.equal(
    profileFields.safeParse({ name: 'Fictional Doctor', canEditDepartment: true }).success,
    false,
  );
});

test('department response updates directory/filter cache without changing clinical or branch data', () => {
  const state = createMockRepository().getSnapshot();
  const doctor = state.doctors[0];
  const snapshot: ClinicalSnapshot = {
    state,
    actor: state.profiles[0],
    organizationId: state.organization.id,
    timezone: state.organization.timezone,
  };
  const profile: EditableProfile = {
    organizationId: snapshot.organizationId,
    kind: 'doctor',
    id: doctor.id,
    userId: null,
    name: doctor.name,
    loginEmail: null,
    canEdit: true,
    canEditDepartment: true,
    specializationId: 'updated-department',
    avatarId: null,
  };
  const patched = patchProfile(snapshot, profile);
  assert.equal(patched.state.doctors[0].specializationId, 'updated-department');
  assert.deepEqual(patched.state.doctors.slice(1), state.doctors.slice(1));
  assert.deepEqual(patched.state.appointments, state.appointments);
  assert.deepEqual(patched.state.consultations, state.consultations);
  assert.deepEqual(patched.state.prescriptions, state.prescriptions);
  assert.deepEqual(patched.state.assignments, state.assignments);
  assert.equal(
    patchProfile(snapshot, { ...profile, organizationId: 'unrelated-organization' }),
    snapshot,
  );
  assert.equal(
    patchProfile(snapshot, { ...profile, specializationId: undefined }).state.doctors[0]
      .specializationId,
    doctor.specializationId,
  );
});
