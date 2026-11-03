// Read-only regression against existing, operator-configured accounts. No fixture creation.
import { request } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
const vault = path.join(process.env.USERPROFILE, '.codex/secrets/sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = [
  { ...admin, role: 'admin' },
  ...JSON.parse(await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8')).accounts,
];
const checks = [];
let stage = 'login';
try {
  for (const account of accounts) {
    const context = await request.newContext({ baseURL: origin });
    try {
      stage = account.role + ' login';
      const login = await context.post('/api/auth/login', {
        headers: { Origin: origin },
        data: { email: account.email, password: account.password },
      });
      assert.equal(login.status(), 200);
      const identity = (await (await context.get('/api/auth/session')).json()).identity;
      const membership = identity.memberships.find((m) => m.roles.includes(account.role));
      assert.ok(membership);
      stage = account.role + ' clinical snapshot';
      const response = await context.get(
        '/api/clinic?' +
          new URLSearchParams({ role: account.role, organizationId: membership.organizationId }),
      );
      assert.equal(response.status(), 200);
      const state = (await response.json()).state;
      for (const key of [
        'appointments',
        'patients',
        'consultations',
        'prescriptions',
        'notifications',
      ])
        assert.ok(Array.isArray(state[key]));
      checks.push({
        role: account.role,
        loginStatus: 200,
        clinicalStatus: response.status(),
        appointments: state.appointments.length,
        patients: state.patients.length,
        consultations: state.consultations.length,
        prescriptions: state.prescriptions.length,
      });
      if (account.role === 'doctor') {
        const denied = await context.get(
          '/api/clinic?' +
            new URLSearchParams({ role: 'admin', organizationId: membership.organizationId }),
        );
        assert.equal(denied.status(), 403);
        checks.push({ doctorAdminDenial: 403 });
      }
    } finally {
      await context.dispose();
    }
  }
  const anonymous = await request.newContext({ baseURL: origin });
  try {
    assert.equal((await anonymous.get('/api/clinic?role=admin')).status(), 401);
    checks.push({ anonymousClinicalStatus: 401 });
  } finally {
    await anonymous.dispose();
  }
  const report = {
    checkedAt: new Date().toISOString(),
    projectRef: ref,
    clinicalMutations: 0,
    checks,
  };
  await mkdir('artifacts/single-email-onboarding-validation', { recursive: true });
  await writeFile(
    'artifacts/single-email-onboarding-validation/existing-workspaces.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch {
  console.error('Read-only live regression failed at ' + stage + '; no secrets logged.');
  process.exitCode = 1;
}
