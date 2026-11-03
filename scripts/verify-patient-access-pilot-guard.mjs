// Existing normal sessions, read-only status, and expected denials only. No Auth Admin API.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
const organizationId = '88645fbe-34da-48aa-a509-c24441b7cf72',
  patientId = 'b9cb9ff4-0c77-4caa-b412-e5794b419f75',
  otherId = '24e1c0ed-4419-43d4-abf0-a93fa1d97f4a',
  operatorId = 'c9095e1e-b718-4c09-842f-df48970125af';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
assert.match(
  await readFile('apps/web/lib/patient-access-feature.ts', 'utf8'),
  /PATIENT_ACCOUNT_ACCESS_ENABLED = false/,
);
const pilotEnabled = /executionApproved: true/.test(
  await readFile('apps/web/lib/patient-access-pilot-policy.ts', 'utf8'),
);
const vault = path.join(process.env.USERPROFILE, '.codex/secrets/sro-clinic', ref);
const accounts = [
  {
    ...JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8')),
    role: 'admin',
  },
  ...JSON.parse(await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8')).accounts,
];
const sessions = [],
  evidence = {
    at: new Date().toISOString(),
    projectRef: ref,
    globalFeature: false,
    pilotExecution: pilotEnabled,
    privilegedAuthOperations: 0,
    checks: [],
  };
const post = (c, action, id = patientId, extra = {}) =>
  c.post('/api/patient-access', {
    headers: { Origin: origin },
    data: { action, organizationId, patientId: id, ...extra },
  });
async function rpc(token) {
  const headers = {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(
    process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rpc/patient_account_command',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_action: 'self', p_actor: operatorId, p_patient: patientId }),
    },
  );
  return { status: r.status, code: (await r.json()).code };
}
try {
  for (const account of accounts) {
    const c = await request.newContext({ baseURL: origin });
    const login = await c.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: account.email, password: account.password },
    });
    assert.equal(login.status(), 200, account.role + ' existing email login');
    const identity = (await (await c.get('/api/auth/session')).json()).identity;
    if (account.role === 'admin')
      assert.equal(identity.id, operatorId, 'Named actual Admin operator');
    const org = identity.memberships.find((m) => m.roles.includes(account.role))?.organizationId;
    assert.equal(org, organizationId);
    const clinical = await c.get(
      '/api/clinic?' + new URLSearchParams({ role: account.role, organizationId }),
    );
    assert.equal(clinical.status(), 200, account.role + ' existing records preserved');
    const state = (await clinical.json()).state;
    const s = { c, role: account.role };
    sessions.push(s);
    const status = await post(c, 'status');
    assert.equal(
      status.status(),
      account.role === 'admin' ? 200 : 403,
      account.role + ' target status scope',
    );
    if (account.role === 'admin') {
      const body = await status.json();
      assert.equal(body.patientCode, 'SRO0007');
      assert.ok(
        ['Not Provisioned', 'Pending Handover', 'Active', 'Disabled'].includes(body.status),
      );
      assert.equal(body.pilotExecutionEnabled, pilotEnabled);
      assert.ok(!JSON.stringify(body).includes('@accounts.sro.invalid'));
      if (!pilotEnabled)
        for (const action of ['provision', 'reset', 'handover', 'disable', 'enable'])
          assert.equal((await post(c, action)).status(), 503, action + ' no execution approval');
      for (const action of ['status', 'provision', 'reset'])
        assert.equal(
          (await post(c, action, otherId)).status(),
          403,
          action + ' other Patient denied',
        );
      assert.equal(
        (
          await post(c, 'status', patientId, {
            organizationId: '00000000-0000-4000-8000-000000000001',
          })
        ).status(),
        403,
        'wrong organization denied',
      );
      assert.equal(
        (await post(c, 'provision', patientId, { actorId: operatorId, roles: ['admin'] })).status(),
        400,
        'forged authority fields denied',
      );
    } else {
      for (const action of ['provision', 'reset', 'handover', 'disable', 'enable'])
        assert.equal(
          (await post(c, action)).status(),
          403,
          account.role + ' ' + action + ' denied',
        );
    }
    assert.equal(
      (await post(c, 'change-password')).status(),
      403,
      account.role + ' cannot change pilot password without bound identity',
    );
    const cookies = (await c.storageState()).cookies
      .filter(
        (v) =>
          v.name === 'sb-' + ref + '-auth-token' || v.name.startsWith('sb-' + ref + '-auth-token.'),
      )
      .sort(
        (a, b) => Number(a.name.split('.').at(-1) || 0) - Number(b.name.split('.').at(-1) || 0),
      );
    const encoded = cookies.map((c) => c.value).join('');
    const auth = JSON.parse(
      encoded.startsWith('base64-')
        ? Buffer.from(encoded.slice(7), 'base64url').toString()
        : encoded,
    );
    const denied = await rpc(auth.access_token);
    assert.equal(denied.status, 403);
    assert.equal(denied.code, '42501');
    evidence.checks.push({
      role: account.role,
      emailLogin: 200,
      clinicalRead: 200,
      patients: state.patients.length,
      targetStatus: status.status(),
      nonOperatorMutationsDenied: account.role !== 'admin',
      operatorMutationsBlocked: account.role === 'admin' && !pilotEnabled,
      unrelatedPatientDenied: account.role === 'admin',
      directRpcStatus: denied.status,
      directRpcCode: denied.code,
    });
  }
  const anonymous = await request.newContext({ baseURL: origin });
  try {
    const r = await post(anonymous, 'status');
    assert.ok([401, 403].includes(r.status()));
    const denied = await rpc(null);
    assert.equal(denied.status, 401);
    assert.equal(denied.code, '42501');
    const errors = [];
    for (const id of ['SRO0007', 'SRO0008', 'SRO9999']) {
      const r = await anonymous.post('/api/auth/login', {
        headers: { Origin: origin },
        data: { email: id, password: 'guard-negative-test-only' },
      });
      assert.equal(r.status(), 400);
      errors.push((await r.json()).error);
    }
    assert.ok(errors.every((e) => e === errors[0]));
    assert.equal(errors[0], 'Sign-in failed. Check your Patient ID or email and password.');
    const page = await anonymous.get('/auth/patient-pilot');
    const markup = await page.text();
    assert.ok([200, 404].includes(page.status()));
    assert.ok(
      pilotEnabled
        ? markup.includes('Patient ID or Email')
        : markup.includes('This clinic page was not found'),
      'Pilot page matches the explicit execution state',
    );
    if (!pilotEnabled)
      assert.ok(!/<input[^>]+name="password"/.test(markup), 'No pilot login form is rendered');
    evidence.anonymous = {
      managementDenied: true,
      directRpcStatus: 401,
      sqlCode: '42501',
      patientIdFailuresIdentical: true,
      pilotLoginPage: {
        httpStatus: page.status(),
        notFound: !pilotEnabled,
        loginForm: pilotEnabled,
      },
    };
  } finally {
    await anonymous.dispose();
  }
  const outputDir = pilotEnabled
    ? 'artifacts/patient-access-live-pilot'
    : 'artifacts/patient-access-pilot';
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputDir + '/http-guard.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  for (const s of sessions) await s.c.dispose();
}
