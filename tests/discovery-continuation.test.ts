import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryDestination, discoveryIntent } from '../apps/web/lib/auth/discovery-intent';
import { discoveryApiOrigin } from '../apps/mobile/src/discovery/origin';
const identity = {
  id: 'test',
  email: 'fictional@example.test',
  name: 'Test',
  memberships: [{ organizationId: 'org', branchIds: ['branch'], roles: ['patient' as const] }],
};
test('only fixed navigation intents survive; verified role selects workspace', () => {
  for (const value of ['https://evil.test', '//evil.test', 'admin', '/admin', null])
    assert.equal(discoveryIntent(value), null);
  assert.equal(discoveryDestination(identity, 'book'), '/patient/appointments?book=1');
  assert.equal(discoveryDestination(identity, 'profile'), '/patient/settings');
  assert.equal(
    discoveryDestination({ ...identity, memberships: [] }, 'book'),
    '/auth/account-ready',
  );
});
test('insecure emulator origin is public-discovery development-only', () => {
  assert.equal(discoveryApiOrigin(true, 'http://10.0.2.2:3100'), 'http://10.0.2.2:3100');
  assert.equal(discoveryApiOrigin(false, 'http://10.0.2.2:3100'), 'https://app.sropk.org');
  for (const url of [
    'http://evil.test:3100',
    'http://10.0.2.2:3100/private',
    'http://10.0.2.2:3100?token=x',
    'http://user@10.0.2.2:3100',
    'http://10.0.2.2:9999',
  ])
    assert.throws(() => discoveryApiOrigin(true, url));
});
