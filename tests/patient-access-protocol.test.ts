import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLogin,
  prepareHandover,
  privateLogin,
  type AccessDependencies,
} from '../apps/web/lib/patient-access-protocol';
test('identifiers normalize without accepting private aliases or arbitrary numbers', () => {
  assert.deepEqual(normalizeLogin(' sro0007 '), { kind: 'patientId', value: 'SRO0007' });
  assert.equal(normalizeLogin('SRO10000').kind, 'patientId');
  assert.equal(normalizeLogin('7').kind, 'invalid');
  assert.equal(normalizeLogin('a@accounts.sro.invalid').kind, 'invalid');
  assert.equal(normalizeLogin('PATIENT@example.com').value, 'patient@example.com');
});
test('approval gate prevents even database claims and Auth writes', async () => {
  let calls = 0;
  const deps = {
    command: async () => {
      calls++;
    },
  } as unknown as AccessDependencies;
  await assert.rejects(
    prepareHandover(deps, { approved: false, actor: 'staff', patientId: 'patient' }),
  );
  assert.equal(calls, 0);
});
test('password is random, safe handover omits alias and RPC sees only nonce hash', async () => {
  const writes: unknown[] = [];
  let createdPassword = '';
  const deps: AccessDependencies = {
    command: async (action, _actor, patient, data) => {
      writes.push({ action, ...data });
      return {
        patientId: patient,
        patientCode: 'SRO0007',
        name: 'Fictional Patient',
        userId: 'u',
        internalEmail: 'a'.repeat(32) + '@accounts.sro.invalid',
        operationId: data.operationId,
      };
    },
    createInternalUser: async (data) => {
      createdPassword = data.password;
    },
    replacePassword: async () => assert.fail('must not reset'),
  };
  const r = await prepareHandover(deps, { approved: true, actor: 'a', patientId: 'p' });
  assert.equal(createdPassword, r.temporaryPassword);
  assert.ok(r.temporaryPassword.length > 40);
  assert.ok(!('internalEmail' in r));
  assert.ok(!JSON.stringify(writes).includes(r.temporaryPassword));
  assert.ok(!JSON.stringify(writes).includes(r.handoverNonce));
});
test('failed Auth leaves claim locked and never returns credentials or retries as overwrite', async () => {
  let commit = 0;
  const deps: AccessDependencies = {
    command: async (action, _a, p, d) => {
      if (action === 'commit') commit++;
      return {
        patientId: p,
        operationId: d.operationId,
        internalEmail: 'a'.repeat(32) + '@accounts.sro.invalid',
      };
    },
    createInternalUser: async () => {
      throw Error('provider failed');
    },
    replacePassword: async () => {},
  };
  await assert.rejects(prepareHandover(deps, { approved: true, actor: 'a', patientId: 'p' }));
  assert.equal(commit, 0);
});
test('unknown ID and bad password return the same public failure', async () => {
  const run = (id: string) =>
    privateLogin(id, 'wrong', {
      minimumMs: 0,
      limit: async () => {},
      resolve: async () => null,
      authenticate: async () => {
        throw Error('private provider reason');
      },
      allow: async () => false,
    });
  for (const id of ['SRO0007', 'SRO9999', 'bad'])
    await assert.rejects(run(id), {
      message: 'Sign-in failed. Check your Patient ID or email and password.',
    });
});
