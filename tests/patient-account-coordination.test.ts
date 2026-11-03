import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coordinatedAccountWrite,
  prepareDistributedHandover,
  completeDistributedPasswordChange,
  type CoordinationRpc,
} from '../apps/web/lib/patient-account-coordination';
import { registerWalkInWithAccount } from '../apps/web/lib/walk-in-account-integration';
import { credentialText, buildCredentialPrint } from '../apps/web/lib/credential-slip';

const base = {
  purpose: 'provision' as const,
  actorId: 'actor',
  patientId: 'patient',
  requestId: 'request',
};
function harness(fail?: string) {
  const calls: string[] = [];
  const rpc: CoordinationRpc = async (action, input) => {
    calls.push(action);
    if (action === fail) throw Error('SYNTHETIC provider details must not escape');
    return {
      operationId: input.operationId,
      fence: '9007199254740993',
      phase: action === 'claim' ? 'claimed' : action === 'start' ? 'started' : 'confirmed',
    };
  };
  return { calls, rpc };
}
test('distributed protocol preserves bigint fence and returns only after committed provider result', async () => {
  const h = harness();
  const result = await coordinatedAccountWrite({
    ...base,
    rpc: h.rpc,
    prepare: async () => {
      h.calls.push('prepare');
    },
    provider: async () => {
      h.calls.push('provider');
      return 'synthetic-result';
    },
    commit: async (binding) => {
      assert.equal(binding.fence, '9007199254740993');
      h.calls.push('commit');
    },
  });
  assert.equal(result, 'synthetic-result');
  assert.deepEqual(h.calls, ['claim', 'prepare', 'start', 'provider', 'confirm', 'commit']);
});

test('a reviewed claim hook owns the claim and afterCommit runs only after commit', async () => {
  const calls: string[] = [];
  let claimInput: Record<string, unknown> | undefined;
  const rpc: CoordinationRpc = async (action, input) => {
    calls.push(action === 'claim' ? 'standard-claim' : action);
    return {
      operationId: input.operationId,
      fence: '42',
      phase: action === 'claim' ? 'claimed' : action === 'start' ? 'started' : 'confirmed',
    };
  };
  const result = await coordinatedAccountWrite({
    purpose: 'reset',
    actorId: 'admin',
    patientId: 'patient',
    requestId: 'request',
    identityVerified: true,
    rpc,
    claim: async (input) => {
      calls.push('recovery-claim');
      claimInput = input;
      return { operationId: input.operationId, fence: '42', phase: 'claimed' };
    },
    prepare: async () => {
      calls.push('prepare');
    },
    provider: async () => {
      calls.push('provider');
      return 'temporary-synthetic';
    },
    commit: async () => {
      calls.push('commit');
    },
    afterCommit: async () => {
      calls.push('after-commit');
    },
  });
  assert.equal(result, 'temporary-synthetic');
  assert.deepEqual(calls, [
    'recovery-claim',
    'prepare',
    'start',
    'provider',
    'confirm',
    'commit',
    'after-commit',
  ]);
  assert.equal(claimInput?.requestId, 'request');
  assert.match(String(claimInput?.proof), /^[A-Za-z0-9_-]{43}$/);
});

test('afterCommit is skipped and quarantine is attempted when the provider fails', async () => {
  const calls: string[] = [];
  const rpc: CoordinationRpc = async (action, input) => {
    calls.push(action);
    return {
      operationId: input.operationId,
      fence: '42',
      phase: action === 'claim' ? 'claimed' : action === 'start' ? 'started' : 'confirmed',
    };
  };
  await assert.rejects(
    () =>
      coordinatedAccountWrite({
        ...base,
        rpc,
        provider: async () => {
          calls.push('provider');
          throw Error('synthetic provider failure');
        },
        commit: async () => {
          calls.push('commit');
        },
        afterCommit: async () => {
          calls.push('after-commit');
        },
      }),
    /clinic review/,
  );
  assert.ok(calls.includes('quarantine'));
  assert.ok(!calls.includes('commit'));
  assert.ok(!calls.includes('after-commit'));
});

test('the narrow recovery authority is separate from the in-person reset requirement', async () => {
  const h = harness();
  await assert.rejects(
    () =>
      coordinatedAccountWrite({
        ...base,
        purpose: 'reset',
        rpc: h.rpc,
        provider: async () => 'synthetic',
        commit: async () => {},
      }),
    /In-person identity verification required/,
  );
  assert.deepEqual(h.calls, []);
  const calls: string[] = [];
  const result = await coordinatedAccountWrite({
    ...base,
    purpose: 'reset',
    recoveryAuthorized: true,
    rpc: async (action, input) => {
      calls.push(action);
      return {
        operationId: input.operationId,
        fence: '42',
        phase: action === 'claim' ? 'claimed' : action === 'start' ? 'started' : 'confirmed',
      };
    },
    claim: async (input) => {
      calls.push('recovery-claim');
      return { operationId: input.operationId, fence: '42', phase: 'claimed' };
    },
    provider: async () => 'synthetic',
    commit: async () => {
      calls.push('commit');
    },
  });
  assert.equal(result, 'synthetic');
  assert.deepEqual(calls, ['recovery-claim', 'start', 'confirm', 'commit']);
});
for (const failure of ['claim', 'prepare', 'start', 'provider', 'confirm', 'commit'])
  test(`failure at ${failure} never retries provider or releases ambiguous claim`, async () => {
    const h = harness(failure);
    const step = async (name: string) => {
      h.calls.push(name);
      if (name === failure) throw Error('SYNTHETIC provider details must not escape');
    };
    await assert.rejects(() =>
      coordinatedAccountWrite({
        ...base,
        rpc: h.rpc,
        prepare: () => step('prepare'),
        provider: () => step('provider'),
        commit: () => step('commit'),
      }),
    );
    assert.ok(h.calls.filter((x) => x === 'provider').length <= 1);
    if (failure !== 'claim') assert.equal(h.calls.at(-1), 'quarantine');
    if (['claim', 'prepare', 'start'].includes(failure)) assert.ok(!h.calls.includes('provider'));
    if (['provider', 'confirm'].includes(failure)) assert.ok(!h.calls.includes('commit'));
  });
test('unverified reset and malformed claim cannot reach provider', async () => {
  const h = harness();
  await assert.rejects(() =>
    coordinatedAccountWrite({
      ...base,
      purpose: 'reset',
      rpc: h.rpc,
      provider: async () => {},
      commit: async () => {},
    }),
  );
  assert.equal(h.calls.length, 0);
  await assert.rejects(
    () =>
      coordinatedAccountWrite({
        ...base,
        rpc: async () => ({ phase: 'claimed', fence: 1 }),
        provider: async () => {
          throw Error('must not run');
        },
        commit: async () => {},
      }),
    /claim unconfirmed/,
  );
});
test('future privileged adapters remain gated before any SQL or Auth call', async () => {
  let writes = 0;
  const never = async () => {
    writes++;
    throw Error('must not run');
  };
  await assert.rejects(
    () =>
      prepareDistributedHandover(
        { command: never, operation: never, createInternalUser: never, replacePassword: never },
        { actorId: 'a', patientId: 'p', requestId: 'r' },
      ),
    /not activated/,
  );
  await assert.rejects(
    () =>
      completeDistributedPasswordChange({
        ...base,
        sessionId: 's',
        rpc: never,
        command: never,
        replaceOwnPassword: never,
      }),
    /not activated/,
  );
  assert.equal(writes, 0);
});
test('walk-in preparation keeps clinical registration and never provisions while global gate is OFF', async () => {
  let provisions = 0;
  const patient = { id: 'existing-uuid', patientCode: 'SROTEST0001' };
  const result = await registerWalkInWithAccount({
    register: async () => patient,
    provision: async () => {
      provisions++;
    },
  });
  assert.equal(result.patient, patient);
  assert.equal(result.account, 'disabled');
  assert.equal(provisions, 0);
});
test('copy and print slip use exact synthetic text and text nodes, never executable interpolation', () => {
  class Element {
    tagName: string;
    textContent = '';
    className = '';
    children: Element[] = [];
    src = '';
    name = '';
    content = '';
    alt = '';
    lang = '';
    constructor(tag: string) {
      this.tagName = tag;
    }
    append(...children: Element[]) {
      this.children.push(...children);
    }
    replaceChildren(...children: Element[]) {
      this.children = children;
    }
  }
  const doc = {
    head: new Element('head'),
    body: new Element('body'),
    documentElement: new Element('html'),
    title: '',
    createElement: (tag: string) => new Element(tag),
  };
  const slip = {
    name: '<script>never execute</script>',
    patientCode: 'SROTEST0001',
    temporaryPassword: 'SYNTHETIC&<>"',
  };
  const logo = buildCredentialPrint(doc as unknown as Document, slip, 'https://clinic.example');
  assert.equal(logo.src, 'https://clinic.example/sro-logo.png');
  const all = (e: Element): Element[] => [e, ...e.children.flatMap(all)];
  const elements = all(doc.body);
  assert.ok(elements.some((e) => e.tagName === 'dd' && e.textContent === slip.name));
  assert.ok(elements.some((e) => e.tagName === 'dd' && e.textContent === slip.temporaryPassword));
  assert.ok(!elements.some((e) => e.tagName === 'script'));
  assert.ok(doc.head.children.some((e) => e.name === 'referrer' && e.content === 'no-referrer'));
  assert.equal(
    credentialText(slip),
    `SRO Clinic\n${slip.name}\nPatient ID: SROTEST0001\nTemporary Password: ${slip.temporaryPassword}\nChange this password at first sign-in. Keep this slip private.`,
  );
});
import {
  coordinatedMutationAuthorized,
  coordinatedPatientMutationsEnabled,
  requireCoordinatedPatientAccessRoutes,
  requireCoordinatedPatientMutations,
} from '../apps/web/lib/patient-access-coordinated';
test('coordinated reads and mutations have independent server-only gates', async () => {
  const previousRoutes = process.env.SRO_COORDINATED_PATIENT_ACCESS;
  const previousMutations = process.env.SRO_COORDINATED_PATIENT_MUTATIONS;
  delete process.env.SRO_COORDINATED_PATIENT_ACCESS;
  delete process.env.SRO_COORDINATED_PATIENT_MUTATIONS;
  try {
    assert.throws(() => requireCoordinatedPatientAccessRoutes());
    assert.equal(coordinatedPatientMutationsEnabled(), false);
    assert.throws(() => requireCoordinatedPatientMutations());
    assert.equal(coordinatedMutationAuthorized('status'), true);
    assert.equal(coordinatedMutationAuthorized('change-password'), true);
    for (const action of ['provision', 'reset', 'handover', 'disable', 'enable'])
      assert.equal(coordinatedMutationAuthorized(action), false, action);
    process.env.SRO_COORDINATED_PATIENT_ACCESS = '1';
    assert.throws(() => requireCoordinatedPatientMutations());
    for (const action of ['provision', 'reset', 'handover', 'disable', 'enable'])
      assert.equal(coordinatedMutationAuthorized(action), false, action);
    const blockedCalls: string[] = [];
    await assert.rejects(() =>
      prepareDistributedHandover(
        {
          async command() {
            blockedCalls.push('command');
            return {};
          },
          async createInternalUser() {
            blockedCalls.push('provider');
          },
          async replacePassword() {
            blockedCalls.push('replace');
          },
          async operation() {
            blockedCalls.push('operation');
            return {};
          },
        },
        { actorId: 'actor', patientId: 'patient', requestId: 'request' },
      ),
    );
    assert.deepEqual(blockedCalls, []);
    delete process.env.SRO_COORDINATED_PATIENT_ACCESS;
    process.env.SRO_COORDINATED_PATIENT_MUTATIONS = '1';
    assert.equal(coordinatedMutationAuthorized('provision'), false);
    process.env.SRO_COORDINATED_PATIENT_ACCESS = '1';
    assert.equal(coordinatedMutationAuthorized('provision'), true);
    requireCoordinatedPatientMutations();
    const calls: string[] = [];
    const result = await prepareDistributedHandover(
      {
        async command(action, _actor, _patient, data) {
          calls.push(action);
          return {
            patientId: 'patient',
            patientCode: 'SRO9001',
            name: 'Synthetic Patient',
            userId: '10000000-0000-4000-8000-000000000001',
            internalEmail: 'a'.repeat(32) + '@accounts.sro.invalid',
            operationId: data.operationId,
          };
        },
        async createInternalUser() {
          calls.push('provider');
        },
        async replacePassword() {
          calls.push('replace');
        },
        async operation(action, input) {
          calls.push(action);
          return {
            operationId: input.operationId,
            fence: '1',
            phase: action === 'claim' ? 'claimed' : action === 'start' ? 'started' : 'confirmed',
          };
        },
      },
      {
        actorId: 'actor',
        patientId: 'patient',
        requestId: 'request',
      },
    );
    assert.equal(result.patientCode, 'SRO9001');
    assert.ok(result.temporaryPassword.length > 20);
    assert.deepEqual(calls, ['claim', 'begin', 'start', 'provider', 'confirm', 'commit']);
  } finally {
    if (previousRoutes === undefined) delete process.env.SRO_COORDINATED_PATIENT_ACCESS;
    else process.env.SRO_COORDINATED_PATIENT_ACCESS = previousRoutes;
    if (previousMutations === undefined) delete process.env.SRO_COORDINATED_PATIENT_MUTATIONS;
    else process.env.SRO_COORDINATED_PATIENT_MUTATIONS = previousMutations;
  }
});
import { patientAccountCapabilitiesFor } from '../apps/web/lib/patient-access-coordinated';
test('account capability matrix requires master plus each narrow capability', () => {
  const keys = [
    'SRO_COORDINATED_PATIENT_ACCESS',
    'SRO_COORDINATED_PATIENT_MUTATIONS',
    'SRO_ACCOUNT_ADMIN_PROVISION',
    'SRO_ACCOUNT_DOCTOR_WALKIN_PROVISION',
    'SRO_ACCOUNT_PASSWORD_RESET',
    'SRO_ACCOUNT_DISABLE_ENABLE',
    'SRO_WALK_IN_AUTO_PROVISION',
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    let caps = patientAccountCapabilitiesFor('admin');
    assert.deepEqual(
      [caps.provision, caps.reset, caps.disable, caps.autoProvision],
      [false, false, false, false],
    );
    for (const key of [
      'SRO_ACCOUNT_ADMIN_PROVISION',
      'SRO_ACCOUNT_DOCTOR_WALKIN_PROVISION',
      'SRO_ACCOUNT_PASSWORD_RESET',
      'SRO_ACCOUNT_DISABLE_ENABLE',
      'SRO_WALK_IN_AUTO_PROVISION',
    ] as const)
      process.env[key] = '1';
    caps = patientAccountCapabilitiesFor('admin');
    assert.deepEqual(
      [caps.provision, caps.reset, caps.disable, caps.autoProvision],
      [false, false, false, false],
    );
    for (const key of [
      'SRO_ACCOUNT_ADMIN_PROVISION',
      'SRO_ACCOUNT_DOCTOR_WALKIN_PROVISION',
      'SRO_ACCOUNT_PASSWORD_RESET',
      'SRO_ACCOUNT_DISABLE_ENABLE',
      'SRO_WALK_IN_AUTO_PROVISION',
    ] as const)
      delete process.env[key];
    process.env.SRO_COORDINATED_PATIENT_ACCESS = '1';
    process.env.SRO_COORDINATED_PATIENT_MUTATIONS = '1';
    let admin = patientAccountCapabilitiesFor('admin');
    assert.deepEqual(
      [admin.provision, admin.handover, admin.reset, admin.disable, admin.autoProvision],
      [false, false, false, false, false],
    );
    process.env.SRO_ACCOUNT_ADMIN_PROVISION = '1';
    admin = patientAccountCapabilitiesFor('admin');
    assert.deepEqual(
      [admin.provision, admin.handover, admin.reset, admin.disable, admin.autoProvision],
      [true, true, false, false, false],
    );
    assert.equal(patientAccountCapabilitiesFor('doctor').provision, false);
    delete process.env.SRO_ACCOUNT_ADMIN_PROVISION;
    process.env.SRO_ACCOUNT_DOCTOR_WALKIN_PROVISION = '1';
    let doctor = patientAccountCapabilitiesFor('doctor');
    assert.deepEqual(
      [doctor.provision, doctor.handover, doctor.reset, doctor.disable, doctor.autoProvision],
      [true, true, false, false, false],
    );
    assert.equal(patientAccountCapabilitiesFor('admin').provision, false);
    process.env.SRO_ACCOUNT_PASSWORD_RESET = '1';
    assert.equal(patientAccountCapabilitiesFor('admin').reset, true);
    assert.equal(patientAccountCapabilitiesFor('doctor').reset, false);
    process.env.SRO_ACCOUNT_DISABLE_ENABLE = '1';
    assert.equal(patientAccountCapabilitiesFor('admin').disable, true);
    assert.equal(patientAccountCapabilitiesFor('doctor').disable, false);
    process.env.SRO_WALK_IN_AUTO_PROVISION = '1';
    doctor = patientAccountCapabilitiesFor('doctor');
    assert.equal(doctor.autoProvision, true);
    assert.equal(patientAccountCapabilitiesFor('admin').autoProvision, false);
    process.env.SRO_ACCOUNT_ADMIN_PROVISION = '1';
    admin = patientAccountCapabilitiesFor('admin');
    assert.deepEqual(
      [admin.provision, admin.handover, admin.reset, admin.disable, admin.autoProvision],
      [true, true, true, true, true],
    );
    delete process.env.SRO_COORDINATED_PATIENT_MUTATIONS;
    const masterOff = patientAccountCapabilitiesFor('doctor');
    assert.deepEqual(
      [masterOff.provision, masterOff.handover, masterOff.reset, masterOff.disable, masterOff.autoProvision],
      [false, false, false, false, false],
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
