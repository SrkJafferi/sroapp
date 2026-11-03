import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doctorDetails } from '../apps/web/lib/auth/doctor-onboarding';

test('compact onboarding omits later professional fields rather than clearing them', () => {
  const result = doctorDetails.parse({ name: 'Dr. Fictional Clinician', gender: 'Female' });
  for (const key of ['qualifications', 'bio', 'email', 'experience'])
    assert.equal(Object.hasOwn(result, key), false);
  assert.equal(doctorDetails.parse({ ...result, experience: 0 }).experience, 0);
});

test('onboarding rejects authority fields and invalid experience instead of coercing blanks', () => {
  const details = { name: 'Dr. Fictional Clinician', gender: 'Female' };
  for (const experience of ['', -1, 81, 1.5, '7', null])
    assert.equal(doctorDetails.safeParse({ ...details, experience }).success, false);
  for (const key of ['role', 'branchId', 'specializationId', 'loginEmail', 'organizationId'])
    assert.equal(doctorDetails.safeParse({ ...details, [key]: 'forged' }).success, false);
});

test('legacy professional profile submissions retain validated optional values', () => {
  const details = {
    name: 'Dr. Fictional Clinician',
    gender: 'Other',
    qualifications: 'MBBS',
    experience: 8,
    bio: 'Fictional biography',
    email: 'clinician@example.test',
  };
  assert.deepEqual(doctorDetails.parse(details), details);
});
