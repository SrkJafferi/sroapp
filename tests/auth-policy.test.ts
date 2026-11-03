import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWorkspace, homeFor, safeNext } from '../apps/web/lib/auth/policy';
const user = {
  id: 'fictional',
  email: 'patient@example.test',
  name: 'Fictional Patient',
  memberships: [{ organizationId: 'org', branchIds: ['branch'], roles: ['patient' as const] }],
};
test('only trusted patient role resolves patient workspace', () => {
  assert.equal(homeFor(user), '/patient');
  assert.equal(hasWorkspace(user, 'admin'), false);
  assert.equal(hasWorkspace(user, 'doctor'), false);
});
test('empty memberships and missing branches deny access', () => {
  assert.equal(homeFor({ ...user, memberships: [] }), '/auth/account-ready');
  assert.equal(
    hasWorkspace({ ...user, memberships: [{ ...user.memberships[0], branchIds: [] }] }, 'patient'),
    false,
  );
});
test('redirect targets stay on origin', () => {
  for (const target of ['//evil.test', 'https://evil.test', '/\\evil.test', '/\nfoo'])
    assert.equal(safeNext(target), '/');
  assert.equal(safeNext('/patient/settings'), '/patient/settings');
});
