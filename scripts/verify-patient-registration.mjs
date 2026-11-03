// Read-only clinical comparisons via ordinary verified sessions. No new users or records.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const mode = process.argv[2],
  ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
assert.ok(['before', 'after'].includes(mode));
const manifest = JSON.parse(
  await readFile('supabase/proposals/patient-registration/manifest.json', 'utf8'),
);
assert.equal(manifest.projectRef, ref);
assert.equal(
  manifest.remoteApplied,
  mode === 'after',
  'Verification mode must match the actual deployment state.',
);
const vault = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const contexts = [],
  snapshots = {},
  checks = [];
let step = 'authentication';
try {
  for (const person of [{ ...admin, role: 'admin' }, ...accounts]) {
    const c = await request.newContext({ baseURL: origin });
    contexts.push(c);
    assert.equal(
      (
        await c.post('/api/auth/login', {
          headers: { Origin: origin },
          data: { email: person.email, password: person.password },
        })
      ).status(),
      200,
    );
    const identity = (await (await c.get('/api/auth/session')).json()).identity;
    const m = identity.memberships.find((m) => m.roles.includes(person.role) && m.branchIds.length);
    assert.ok(m);
    const url =
      '/api/clinic?' + new URLSearchParams({ role: person.role, organizationId: m.organizationId });
    step = person.role + ' projection';
    const r = await c.get(url);
    assert.equal(r.status(), 200);
    const s = await r.json();
    snapshots[person.role] = s;
    const repeated = await (await c.get(url)).json();
    assert.deepEqual(repeated.state.patients, s.state.patients);
    checks.push(person.role + ': repeat/refresh projection stable');
    if (person.role !== 'admin')
      assert.equal(
        (
          await c.get(
            '/api/clinic?' +
              new URLSearchParams({ role: 'admin', organizationId: m.organizationId }),
          )
        ).status(),
        403,
      );
  }
  step = 'same-patient comparison';
  const adminPatients = snapshots.admin.state.patients,
    doctorPatients = snapshots.doctor.state.patients;
  const comparisons = doctorPatients.map((p) => {
    const a = adminPatients.find((a) => a.id === p.id);
    assert.ok(a);
    if (mode === 'after') {
      assert.ok(a.registeredAt);
      assert.equal(p.registeredAt, a.registeredAt);
    } else {
      assert.ok(a.registeredAt);
      assert.equal(p.registeredAt, undefined);
    }
    return {
      patientCode: p.patientCode,
      adminRegisteredAt: a.registeredAt,
      doctorRegisteredAt: p.registeredAt ?? null,
    };
  });
  for (const code of ['SRO0001', 'SRO0002', 'SRO0006'])
    assert.ok(comparisons.some((p) => p.patientCode === code));
  assert.ok(
    snapshots.patient.state.patients.every((p) => p.id === snapshots.patient.actor.patientId),
  );
  if (mode === 'after')
    for (const p of snapshots.patient.state.patients)
      assert.equal(p.registeredAt, adminPatients.find((a) => a.id === p.id)?.registeredAt);
  checks.push(
    mode === 'after'
      ? 'All common Admin/Doctor timestamps identical'
      : 'Reproduced: Admin has timestamps, Doctor loses them',
  );
  const anonymous = await request.newContext({ baseURL: origin });
  contexts.push(anonymous);
  assert.equal((await anonymous.get('/api/clinic?role=doctor')).status(), 401);
  checks.push('Anonymous and cross-role access denied');
  const report = {
    checkedAt: new Date().toISOString(),
    mode,
    projectRef: ref,
    origin,
    comparisons,
    checks,
    clinicalWrites: 0,
  };
  await mkdir('artifacts/patient-registration-validation', { recursive: true });
  await writeFile(
    `artifacts/patient-registration-validation/${mode}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} catch {
  console.error(
    JSON.stringify({
      failed: step,
      mode,
      details: 'Sanitized verification failure. No credentials logged.',
    }),
  );
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.dispose();
}
