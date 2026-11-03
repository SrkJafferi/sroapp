import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATIENT_ACCESS_PILOT as pilot,
  authorizePilotOperator,
  assertPilotPatientBinding,
  assertPilotExecution,
  PilotAccessError,
  type PilotPrincipal,
  type PilotOperatorScope,
} from '../apps/web/lib/patient-access-pilot-policy';
import { guardPilotDependencies } from '../apps/web/lib/patient-access-pilot-adapter';
import type { AccessDependencies } from '../apps/web/lib/patient-access-protocol';
import { privateLogin } from '../apps/web/lib/patient-access-protocol';
import { limit } from '../apps/web/lib/auth/rate-limit';
import {
  runPilotAccountOperation,
  PilotOperationBusyError,
} from '../apps/web/lib/patient-access-operation-lock';
const principal: PilotPrincipal = {
  id: pilot.operatorId,
  verified: true,
  mfaSatisfied: true,
  memberships: [
    { organizationId: pilot.organizationId, roles: ['admin'], branchIds: [pilot.branchId] },
  ],
};
const scope = () => authorizePilotOperator(principal, pilot.organizationId, pilot.patientId);
const denial = (status: number) => (e: unknown) =>
  e instanceof PilotAccessError && e.status === status;

test(
  'approved pilot provider writes require a matching database operation claim',
  { skip: !pilot.executionApproved },
  async () => {
    const id = '00000000-0000-4000-8000-000000000003';
    const operationId = '00000000-0000-4000-8000-000000000004';
    const writes: string[] = [];
    const raw: AccessDependencies = {
      command: async () => ({
        patientId: pilot.patientId,
        patientCode: pilot.patientCode,
        userId: id,
        name: 'Fictional test sentinel',
        internalEmail: 'non-network-sentinel',
        operationId,
      }),
      createInternalUser: async () => {
        writes.push('create');
      },
      replacePassword: async () => {
        writes.push('reset');
      },
    };
    const deps = guardPilotDependencies(scope(), raw);
    await assert.rejects(
      () => deps.command('commit', pilot.operatorId, pilot.patientId, { operationId }),
      denial(403),
    );
    await deps.command('begin', pilot.operatorId, pilot.patientId, { operationId });
    await assert.rejects(
      () =>
        deps.createInternalUser({
          id: pilot.operatorId,
          email: 'non-network-sentinel',
          password: 'not-a-credential',
        }),
      denial(403),
    );
    await assert.rejects(() => deps.replacePassword(id, 'not-a-credential'), denial(403));
    await deps.createInternalUser({
      id,
      email: 'non-network-sentinel',
      password: 'not-a-credential',
    });
    await assert.rejects(
      () =>
        deps.command('commit', pilot.operatorId, pilot.patientId, { operationId: pilot.patientId }),
      denial(403),
    );
    await deps.command('commit', pilot.operatorId, pilot.patientId, { operationId });
    assert.deepEqual(writes, ['create']);
  },
);

test(
  'single-process pilot lock rejects overlap and releases after failure',
  { skip: !pilot.executionApproved },
  async () => {
    let release!: () => void;
    let entered = 0;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runPilotAccountOperation(async () => {
      entered++;
      await blocked;
    });
    await assert.rejects(
      () =>
        runPilotAccountOperation(async () => {
          entered++;
        }),
      PilotOperationBusyError,
    );
    release();
    await first;
    await assert.rejects(
      () =>
        runPilotAccountOperation(async () => {
          throw Error('Non-network failure');
        }),
      /Non-network failure/,
    );
    await runPilotAccountOperation(async () => {
      entered++;
    });
    assert.equal(entered, 2);
  },
);
test('pilot is confirmed and execution authorization is immutable', () => {
  assert.equal(pilot.fictionalOperatorControlledConfirmed, true);
  const approved = pilot.executionApproved;
  assert.equal(Reflect.set(pilot, 'executionApproved', !approved), false);
  assert.equal(pilot.executionApproved, approved);
  if (approved) assert.doesNotThrow(() => assertPilotExecution());
  else assert.throws(() => assertPilotExecution(), denial(503));
});
test('only the exact verified MFA-satisfied Admin operator can inspect the target', () => {
  assert.equal(scope().patientId, pilot.patientId);
  for (const bad of [
    { ...principal, id: '00000000-0000-4000-8000-000000000002' },
    { ...principal, verified: false },
    { ...principal, mfaSatisfied: false },
    { ...principal, memberships: [{ ...principal.memberships[0], roles: ['doctor'] }] },
    { ...principal, memberships: [{ ...principal.memberships[0], roles: ['patient'] }] },
    { ...principal, memberships: [{ ...principal.memberships[0], branchIds: [] }] },
    { ...principal, memberships: [] },
  ])
    assert.throws(
      () => authorizePilotOperator(bad, pilot.organizationId, pilot.patientId),
      denial(403),
    );
});
test('SRO strings, non-allowlisted Patient UUIDs and other organizations never authorize', () => {
  for (const id of ['SRO0007', 'SRO0008', '24e1c0ed-4419-43d4-abf0-a93fa1d97f4a'])
    assert.throws(() => authorizePilotOperator(principal, pilot.organizationId, id), denial(403));
  assert.throws(
    () =>
      authorizePilotOperator(principal, '00000000-0000-4000-8000-000000000002', pilot.patientId),
    denial(403),
  );
  assert.throws(
    () => assertPilotPatientBinding('24e1c0ed-4419-43d4-abf0-a93fa1d97f4a'),
    denial(403),
  );
  if (pilot.executionApproved)
    assert.doesNotThrow(() => assertPilotPatientBinding(pilot.patientId));
  else assert.throws(() => assertPilotPatientBinding(pilot.patientId), denial(503));
});
test(
  'read-only status is the sole permitted private command before approval',
  { skip: pilot.executionApproved },
  async () => {
    const calls: string[] = [];
    const raw: AccessDependencies = {
      command: async (action) => {
        calls.push(action);
        return { status: 'Not Provisioned' };
      },
      createInternalUser: async () => assert.fail('Auth creation must never run'),
      replacePassword: async () => assert.fail('Auth reset must never run'),
    };
    const deps = guardPilotDependencies(scope(), raw);
    await deps.command('status', pilot.operatorId, pilot.patientId, {});
    assert.deepEqual(calls, ['status']);
    for (const action of ['begin', 'reset', 'commit', 'handover', 'disable', 'enable'] as const)
      await assert.rejects(
        () => deps.command(action, pilot.operatorId, pilot.patientId, {}),
        denial(503),
      );
    for (const action of ['resolve', 'self', 'change-complete'] as const)
      await assert.rejects(
        () => deps.command(action, pilot.operatorId, pilot.patientId, {}),
        denial(403),
      );
    assert.deepEqual(calls, ['status']);
  },
);
test('low-level provider writes cannot run without a scoped claim', async () => {
  let calls = 0;
  const raw: AccessDependencies = {
    command: async () => {
      calls++;
    },
    createInternalUser: async () => {
      calls++;
    },
    replacePassword: async () => {
      calls++;
    },
  };
  const deps = guardPilotDependencies(scope(), raw);
  // Fixed non-secret sentinels; tests generate no password and make no Auth request.
  await assert.rejects(
    () =>
      deps.createInternalUser({
        id: pilot.operatorId,
        email: 'blocked',
        password: 'not-a-credential',
      }),
    denial(pilot.executionApproved ? 403 : 503),
  );
  await assert.rejects(
    () => deps.replacePassword(pilot.operatorId, 'not-a-credential'),
    denial(pilot.executionApproved ? 403 : 503),
  );
  assert.equal(calls, 0);
});
test('forged operator capabilities, actor IDs and target overrides fail before SQL', async () => {
  const raw: AccessDependencies = {
    command: async () => assert.fail('No SQL for unauthorized scope'),
    createInternalUser: async () => assert.fail('No Auth'),
    replacePassword: async () => assert.fail('No Auth'),
  };
  const real = scope();
  for (const forged of [
    { ...real },
    { ...real, operatorId: '00000000-0000-4000-8000-000000000002' },
    { ...real, organizationId: '00000000-0000-4000-8000-000000000002' },
    { ...real, branchId: '00000000-0000-4000-8000-000000000002' },
    { ...real, patientId: '24e1c0ed-4419-43d4-abf0-a93fa1d97f4a' },
  ])
    await assert.rejects(
      () =>
        guardPilotDependencies(forged as PilotOperatorScope, raw).command(
          'status',
          pilot.operatorId,
          pilot.patientId,
          {},
        ),
      denial(403),
    );
  const deps = guardPilotDependencies(real, raw);
  await assert.rejects(
    () => deps.command('status', '00000000-0000-4000-8000-000000000002', pilot.patientId, {}),
    denial(403),
  );
  await assert.rejects(
    () => deps.command('status', pilot.operatorId, '24e1c0ed-4419-43d4-abf0-a93fa1d97f4a', {}),
    denial(403),
  );
});
test('an environment/global rollout flag cannot authorize the server-side pilot', () => {
  const previous = process.env.SRO_PATIENT_ACCESS;
  try {
    process.env.SRO_PATIENT_ACCESS = '1';
    if (pilot.executionApproved) assert.doesNotThrow(() => assertPilotExecution());
    else assert.throws(() => assertPilotExecution(), denial(503));
  } finally {
    if (previous === undefined) delete process.env.SRO_PATIENT_ACCESS;
    else process.env.SRO_PATIENT_ACCESS = previous;
  }
});
test('failed sign-in limiter prevents provider attempts beyond its budget without exposing account existence', async () => {
  let providerCalls = 0;
  for (let attempt = 0; attempt < 11; attempt++) {
    await assert.rejects(
      () =>
        privateLogin('SRO9999', 'not-a-credential', {
          minimumMs: 0,
          limit: async () =>
            limit('pilot-preparation-negative-test', 'fixed-test-bucket', 10, 900000),
          resolve: async () => null,
          authenticate: async () => {
            providerCalls++;
            throw Error('Non-network test denial');
          },
          allow: async () => false,
        }),
      { message: 'Sign-in failed. Check your Patient ID or email and password.' },
    );
  }
  assert.equal(providerCalls, 10);
});
