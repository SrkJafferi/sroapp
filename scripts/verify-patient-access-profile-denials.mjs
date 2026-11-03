// Post-deployment existing-account login and SELECT-only authorization regressions.
import { request } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
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
    featureEnabled: false,
    freshLogins: [],
    profileDenials: [],
    doctorEmailScope: {},
    accountMutations: 0,
  };
try {
  for (const account of accounts) {
    const c = await request.newContext({ baseURL: origin });
    const login = await c.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: account.email, password: account.password },
    });
    assert.equal(login.status(), 200, account.role + ' fresh login');
    const identity = (await (await c.get('/api/auth/session')).json()).identity;
    const org = identity.memberships.find((m) => m.roles.includes(account.role)).organizationId;
    const r = await c.get(
      '/api/clinic?' + new URLSearchParams({ role: account.role, organizationId: org }),
    );
    assert.equal(r.status(), 200, account.role + ' fresh-session clinical access');
    const data = await r.json();
    sessions.push({ role: account.role, c, org, ...data, identity });
    evidence.freshLogins.push({ role: account.role, loginStatus: 200, clinicalStatus: 200 });
  }
  const admin = sessions.find((s) => s.role === 'admin'),
    doctor = sessions.find((s) => s.role === 'doctor'),
    patient = sessions.find((s) => s.role === 'patient');
  const profile = (s, kind, id, organizationId = s.org) =>
    s.c.get('/api/profiles?' + new URLSearchParams({ organizationId, kind, id }));
  for (const s of [doctor, patient]) {
    const unrelated = admin.state.patients.find(
      (p) => !s.state.patients.some((visible) => visible.id === p.id),
    );
    assert.ok(unrelated, s.role + ' actual unrelated Patient');
    const denied = await profile(s, 'patient', unrelated.id);
    assert.equal(denied.status(), 403, s.role + ' unrelated Patient profile denial');
    evidence.profileDenials.push({ role: s.role, unrelatedExistingPatientStatus: 403 });
  }
  for (const s of sessions) {
    const denied = await profile(
      s,
      'patient',
      admin.state.patients[0].id,
      '00000000-0000-4000-8000-000000000001',
    );
    assert.equal(denied.status(), 403, s.role + ' wrong organization');
  }
  const own = await profile(doctor, 'doctor', doctor.actor.doctorId),
    managed = await profile(admin, 'doctor', doctor.actor.doctorId),
    publicView = await profile(patient, 'doctor', doctor.actor.doctorId);
  assert.equal(own.status(), 200);
  assert.equal(managed.status(), 200);
  assert.equal(publicView.status(), 200);
  const a = (await own.json()).profile,
    b = (await managed.json()).profile,
    p = (await publicView.json()).profile;
  assert.equal(a.loginEmail, doctor.identity.email);
  assert.equal(b.loginEmail, a.loginEmail);
  assert.equal(p.loginEmail, null);
  assert.equal(p.loginEmailVisible, false);
  for (const value of [a, b, p])
    assert.ok(!JSON.stringify(value).includes('@accounts.sro.invalid'));
  evidence.doctorEmailScope = {
    doctorSelf: true,
    authorizedAdminSameVerifiedEmail: true,
    patientEmailHidden: true,
    wrongOrganizationDenied: true,
    internalAliasesExposed: false,
  };
  const anonymous = await request.newContext({ baseURL: origin });
  try {
    assert.equal(
      (
        await anonymous.get(
          '/api/profiles?' +
            new URLSearchParams({
              organizationId: admin.org,
              kind: 'doctor',
              id: doctor.actor.doctorId,
            }),
        )
      ).status(),
      401,
    );
  } finally {
    await anonymous.dispose();
  }
  await writeFile(
    'artifacts/patient-access-migration/profile-authorization.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence));
} finally {
  for (const s of sessions) await s.c.dispose();
}
