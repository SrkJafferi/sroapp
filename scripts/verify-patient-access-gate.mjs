import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
const evidence = {
  projectRef: ref,
  at: new Date().toISOString(),
  featureEnabled: false,
  accountMutations: 0,
  checks: [],
};
for (const account of accounts) {
  const c = await request.newContext({ baseURL: origin });
  try {
    const login = await c.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: account.email, password: account.password },
    });
    assert.equal(login.status(), 200, account.role + ' existing email login');
    const session = await (await c.get('/api/auth/session')).json();
    const membership = session.identity?.memberships.find((m) => m.roles.includes(account.role));
    assert.ok(membership, account.role + ' workspace');
    const clinical = await c.get(
      '/api/clinic?' +
        new URLSearchParams({ role: account.role, organizationId: membership.organizationId }),
    );
    assert.equal(clinical.status(), 200, account.role + ' clinical reads');
    const gate = await c.post('/api/patient-access', {
      headers: { Origin: origin },
      data: {
        action: 'provision',
        patientId: '00000000-0000-4000-8000-000000000007',
        organizationId: membership.organizationId,
      },
    });
    assert.equal(gate.status(), 503, 'approval gate blocks before any identity write');
    evidence.checks.push({
      role: account.role,
      emailLogin: 200,
      clinicalRead: 200,
      provisioningGate: 503,
    });
  } finally {
    await c.dispose();
  }
}
const anon = await request.newContext({ baseURL: origin });
try {
  const r = await anon.get(
    '/api/clinic?role=admin&organizationId=88645fbe-34da-48aa-a509-c24441b7cf72',
  );
  assert.equal(r.status(), 401);
  evidence.checks.push({ role: 'anonymous', clinicalRead: 401 });
} finally {
  await anon.dispose();
}
await mkdir('artifacts/patient-access-validation', { recursive: true });
await writeFile(
  'artifacts/patient-access-validation/active-regression.json',
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
