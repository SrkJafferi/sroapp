// Migration-only read/denial checks. Existing normal sessions stay in process memory.
// No Auth admin client, password generation/reset, provisioning, or clinical writes.
import { request } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import readline from 'node:readline';

process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
assert.match(
  await readFile('apps/web/lib/patient-access-feature.ts', 'utf8'),
  /PATIENT_ACCOUNT_ACCESS_ENABLED = false/,
);
const vault = path.join(process.env.USERPROFILE, '.codex/secrets/sro-clinic', ref);
const accounts = [
  {
    ...JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8')),
    role: 'admin',
  },
  ...JSON.parse(await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8')).accounts,
];
const sessions = [];
const evidence = {
  projectRef: ref,
  origin,
  featureEnabled: false,
  privilegedAccountMutations: 0,
  before: [],
  after: [],
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const directory = 'artifacts/patient-access-migration';
await mkdir(directory, { recursive: true });
const save = () =>
  writeFile(directory + '/session-regression.json', JSON.stringify(evidence, null, 2) + '\n');
async function rest(endpoint, token, body) {
  const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + endpoint, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function inspect(s, phase) {
  const session = await s.context.get('/api/auth/session');
  assert.equal(session.status(), 200, s.role + ' existing session');
  const identity = (await session.json()).identity;
  assert.equal(identity.id, s.userId, s.role + ' same identity');
  const clinical = await s.context.get(
    '/api/clinic?' + new URLSearchParams({ role: s.role, organizationId: s.org }),
  );
  assert.equal(clinical.status(), 200, s.role + ' clinical records');
  const state = (await clinical.json()).state;
  const selected = Object.fromEntries(
    [
      'patients',
      'doctors',
      'appointments',
      'consultations',
      'prescriptions',
      'documents',
      'branches',
      'assignments',
    ].map((k) => [k, state[k] ?? []]),
  );
  const fingerprint = digest(selected);
  if (phase === 'after')
    assert.equal(fingerprint, s.fingerprint, s.role + ' unchanged scoped clinical records');
  else s.fingerprint = fingerprint;
  const gate = await s.context.post('/api/patient-access', {
    headers: { Origin: origin },
    data: { action: 'status' },
  });
  assert.equal(gate.status(), 503, s.role + ' disabled feature gate');
  const denied = await s.context.get(
    '/api/clinic?' +
      new URLSearchParams({
        role: s.role === 'admin' ? 'patient' : 'admin',
        organizationId: s.org,
      }),
  );
  assert.equal(denied.status(), 403, s.role + ' cross-role denial');
  const visible = await rest('patients?select=id', s.token);
  assert.equal(visible.status, 200, s.role + ' ordinary JWT table read');
  assert.deepEqual(
    visible.body.map((p) => p.id).sort(),
    state.patients.map((p) => p.id).sort(),
    s.role + ' ordinary RLS patient scope',
  );
  const target = state.patients[0];
  assert.ok(target, s.role + ' existing Patient visibility');
  const profile = await s.context.get(
    '/api/profiles?' +
      new URLSearchParams({ organizationId: s.org, kind: 'patient', id: target.id }),
  );
  assert.equal(profile.status(), 200, s.role + ' existing authorized profile');
  const profileBody = (await profile.json()).profile;
  assert.ok(
    !JSON.stringify(profileBody).includes('@accounts.sro.invalid'),
    s.role + ' no internal aliases',
  );
  const profileHash = digest(profileBody);
  if (phase === 'after')
    assert.equal(profileHash, s.profileHash, s.role + ' unchanged profile/permissions');
  else s.profileHash = profileHash;
  let privilegedRpcDenied;
  if (phase === 'after') {
    // SELECT-only action: safe even if an unexpected EXECUTE grant were present.
    const rpc = await rest('rpc/patient_account_command', s.token, {
      p_action: 'self',
      p_actor: s.userId,
    });
    assert.equal(rpc.status, 403, s.role + ' privileged RPC denied');
    assert.equal(rpc.body.code, '42501', s.role + ' SQL EXECUTE restriction');
    privilegedRpcDenied = true;
  }
  return {
    role: s.role,
    sameSession: true,
    clinicalStatus: 200,
    clinicalFingerprint: fingerprint,
    profileFingerprint: profileHash,
    profileStatus: 200,
    internalAliasVisible: false,
    crossRoleStatus: 403,
    featureStatus: 503,
    rlsPatientRows: visible.body.length,
    patients: state.patients.length,
    appointments: state.appointments.length,
    prescriptions: state.prescriptions.length,
    privilegedRpcDenied,
  };
}
try {
  for (const account of accounts) {
    const context = await request.newContext({ baseURL: origin });
    const login = await context.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: account.email, password: account.password },
    });
    assert.equal(login.status(), 200, account.role + ' existing email login');
    const identity = (await (await context.get('/api/auth/session')).json()).identity;
    const org = identity.memberships.find((m) => m.roles.includes(account.role))?.organizationId;
    assert.ok(org, account.role + ' role assignment');
    const cookies = (await context.storageState()).cookies
      .filter(
        (c) =>
          c.name === 'sb-' + ref + '-auth-token' || c.name.startsWith('sb-' + ref + '-auth-token.'),
      )
      .sort(
        (a, b) => Number(a.name.split('.').at(-1) || 0) - Number(b.name.split('.').at(-1) || 0),
      );
    const encoded = cookies.map((c) => c.value).join('');
    const auth = JSON.parse(
      encoded.startsWith('base64-')
        ? Buffer.from(encoded.slice(7), 'base64url').toString('utf8')
        : encoded,
    );
    assert.ok(auth.access_token, account.role + ' existing user-scoped JWT');
    const s = { context, role: account.role, userId: identity.id, org, token: auth.access_token };
    sessions.push(s);
    evidence.before.push(await inspect(s, 'before'));
  }
  await save();
  console.log(
    JSON.stringify({
      phase: 'before',
      passed: true,
      checks: evidence.before,
      waitingForPostDeployment: true,
    }),
  );
  const input = readline.createInterface({ input: process.stdin });
  for await (const line of input) {
    if (line.trim() !== 'post') continue;
    for (const s of sessions) evidence.after.push(await inspect(s, 'after'));
    const anon = await request.newContext({ baseURL: origin });
    try {
      assert.equal(
        (
          await anon.get(
            '/api/clinic?' +
              new URLSearchParams({ role: 'admin', organizationId: sessions[0].org }),
          )
        ).status(),
        401,
      );
      const rpc = await rest('rpc/patient_account_command', null, { p_action: 'self' });
      assert.equal(rpc.status, 401);
      assert.equal(rpc.body.code, '42501');
      evidence.anonymous = { clinicalStatus: 401, privilegedRpcStatus: 401, sqlCode: '42501' };
    } finally {
      await anon.dispose();
    }
    await save();
    console.log(
      JSON.stringify({
        phase: 'after',
        passed: true,
        checks: evidence.after,
        anonymous: evidence.anonymous,
        samePreDeploymentSessions: true,
      }),
    );
    input.close();
    break;
  }
} catch (error) {
  console.error('Migration regression stopped: ' + error.message);
  process.exitCode = 1;
} finally {
  for (const s of sessions) await s.context.dispose();
}
