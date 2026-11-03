import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLogin,
  privateLogin,
} from '../apps/web/lib/patient-access-protocol';
import { credentialText } from '../apps/web/lib/credential-slip';

const syntheticPassword = 'SYNTHETIC-Only_47Characters-NotARealCredential9!';
const internalAlias = 'af2a01c84577464d81b606eb1c044c4b@accounts.sro.invalid';
const slip = {
  name: 'Synthetic Patient',
  patientCode: 'SRO0009',
  temporaryPassword: syntheticPassword,
};

test('Patient ID normalization is exact but case/edge-whitespace tolerant', () => {
  assert.deepEqual(normalizeLogin('SRO0009'), { kind: 'patientId', value: 'SRO0009' });
  assert.deepEqual(normalizeLogin('  sro0009  '), { kind: 'patientId', value: 'SRO0009' });
  assert.equal(normalizeLogin('SRO0009\nTemporary Password: x').kind, 'invalid');
  assert.equal(normalizeLogin('SRO 0009').kind, 'invalid');
  assert.equal(normalizeLogin(internalAlias).kind, 'invalid');
  assert.deepEqual(normalizeLogin('patient@example.test'), {
    kind: 'email',
    value: 'patient@example.test',
  });
});

test('Patient ID login resolves the exact internal alias and preserves password bytes', async () => {
  const calls = [];
  const result = await privateLogin('SRO0009', syntheticPassword, {
    minimumMs: 0,
    limit: async () => calls.push('limit'),
    resolve: async (code) => {
      calls.push(`resolve:${code}`);
      return { email: internalAlias };
    },
    authenticate: async (email, password) => {
      calls.push(`authenticate:${email}:${password}`);
      return { userId: 'synthetic-user' };
    },
    allow: async () => {
      calls.push('allow');
      return true;
    },
  });
  assert.deepEqual(result, { userId: 'synthetic-user' });
  assert.deepEqual(calls, [
    'limit',
    'resolve:SRO0009',
    `authenticate:${internalAlias}:${syntheticPassword}`,
    'allow',
  ]);
});

test('Auth invalid_credentials is propagated as a safe code without the submitted secret', async () => {
  await assert.rejects(
    () =>
      privateLogin('SRO0009', 'wrong-synthetic-password', {
        minimumMs: 0,
        limit: async () => {},
        resolve: async () => ({ email: internalAlias }),
        authenticate: async () => {
          throw Object.assign(Error('provider details must not escape'), {
            authCode: 'invalid_credentials',
          });
        },
        allow: async () => true,
      }),
    (error) => {
      assert.equal(error.authCode, 'invalid_credentials');
      assert.match(error.message, /Check your Patient ID or email and password/);
      assert.doesNotMatch(error.message, /wrong-synthetic-password|provider details/);
      return true;
    },
  );
});

test('a malformed SRO-prefixed identifier is not resolved and cannot leak a provider detail', async () => {
  let resolveCalled = false;
  let attemptedEmail = '';
  await assert.rejects(
    () =>
      privateLogin('SRO0009\nTemporary Password: synthetic', syntheticPassword, {
        minimumMs: 0,
        limit: async () => {},
        resolve: async () => {
          resolveCalled = true;
          return { email: internalAlias };
        },
        authenticate: async (email) => {
          attemptedEmail = email;
          throw Object.assign(Error('provider details'), { authCode: 'invalid_credentials' });
        },
        allow: async () => true,
      }),
    /Check your Patient ID or email and password/,
  );
  assert.equal(resolveCalled, false);
  assert.match(attemptedEmail, /^[0-9a-f]{32}@accounts\.sro\.invalid$/);
});

test('the full handover slip is not the password and includes extra text', () => {
  const copied = credentialText(slip);
  assert.notEqual(copied, syntheticPassword);
  assert.ok(copied.includes(syntheticPassword));
  assert.match(copied, /Patient ID: SRO0009/);
  assert.match(copied, /Temporary Password:/);
});
