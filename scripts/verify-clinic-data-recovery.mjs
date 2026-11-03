// Read-only clinical regression checks. No users, appointments, notes, or credentials are changed.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin = process.argv[2] ?? 'http://localhost:3100';
const label = process.argv[3] ?? 'dev';
const vault = path.join(
  process.env.USERPROFILE,
  '.codex',
  'secrets',
  'sro-clinic',
  'jyigxpjvygvtvcypujel',
);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const report = { origin, checks: [], counts: {}, clinicalWrites: 0 };
const clients = [];
const fields = [
  'branches',
  'profiles',
  'doctors',
  'specializations',
  'patients',
  'assignments',
  'schedules',
  'leaves',
  'appointments',
  'consultations',
  'prescriptions',
  'documents',
  'grants',
  'notifications',
  'audit',
  'invitations',
];
function fingerprint(data) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        ['patients', 'appointments', 'consultations', 'prescriptions'].map((key) => [
          key,
          [...data.state[key]].sort((a, b) => a.id.localeCompare(b.id)),
        ]),
      ),
    )
    .digest('hex');
}
let step = 'initialization';
try {
  const anon = await request.newContext({ baseURL: origin });
  clients.push(anon);
  const denied = await anon.get('/api/clinic?role=admin');
  assert.equal(denied.status(), 401);
  report.checks.push('Anonymous clinical reads denied (401)');
  for (const person of [{ ...admin, role: 'admin' }, ...accounts].filter(
    (p) => !process.argv[4] || p.role === process.argv[4],
  )) {
    step = `${person.role} verified login`;
    const client = await request.newContext({ baseURL: origin });
    clients.push(client);
    const login = await client.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: person.email, password: person.password },
    });
    assert.equal(login.status(), 200);
    const session = await client.get('/api/auth/session');
    assert.equal(session.status(), 200);
    const identity = (await session.json()).identity;
    const membership = identity.memberships.find(
      (m) => m.roles.includes(person.role) && m.branchIds.length,
    );
    assert.ok(membership);
    const url =
      '/api/clinic?' +
      new URLSearchParams({ role: person.role, organizationId: membership.organizationId });
    step = `${person.role} scoped clinical snapshot`;
    const started = performance.now();
    const response = await client.get(url);
    const elapsedMs = Math.round(performance.now() - started);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['cache-control'], /private.*no-store/);
    const snapshot = await response.json();
    assert.equal(snapshot.actor.id, identity.id);
    assert.equal(snapshot.actor.role, person.role);
    assert.equal(snapshot.organizationId, membership.organizationId);
    for (const field of fields) assert.ok(Array.isArray(snapshot.state[field]), field);
    assert.ok(snapshot.state.appointments.length > 0);
    assert.ok(snapshot.state.consultations.some((c) => c.status === 'signed'));
    assert.ok(snapshot.state.prescriptions.length > 0);
    if (person.role === 'patient') {
      assert.ok(snapshot.state.patients.every((p) => p.id === snapshot.actor.patientId));
      assert.ok(snapshot.state.appointments.every((a) => a.patientId === snapshot.actor.patientId));
      assert.ok(
        snapshot.state.consultations.every(
          (c) => c.patientId === snapshot.actor.patientId && c.status === 'signed',
        ),
      );
    }
    if (person.role === 'doctor')
      assert.ok(snapshot.state.appointments.every((a) => a.doctorId === snapshot.actor.doctorId));
    const original = fingerprint(snapshot);
    const repeated = await client.get(url);
    assert.equal(repeated.status(), 200);
    assert.equal(fingerprint(await repeated.json()), original);
    const noOrganization = await client.get(
      '/api/clinic?' + new URLSearchParams({ role: person.role }),
    );
    assert.equal(noOrganization.status(), 200);
    assert.equal((await noOrganization.json()).organizationId, membership.organizationId);
    report.checks.push(
      `${person.role}: verified session, scoped complete arrays, signed records and repeated/deep-link reads`,
    );
    report.counts[person.role] = {
      status: response.status(),
      elapsedMs,
      appointments: snapshot.state.appointments.length,
      signedConsultations: snapshot.state.consultations.filter((c) => c.status === 'signed').length,
      prescriptions: snapshot.state.prescriptions.length,
      recordsFingerprint: original,
    };
    if (person.role !== 'admin') {
      const forged = await client.get(
        '/api/clinic?' +
          new URLSearchParams({ role: 'admin', organizationId: membership.organizationId }),
      );
      assert.equal(forged.status(), 403);
      report.checks.push(`${person.role}: Admin impersonation denied (403)`);
    }
    const foreign = await client.get(
      '/api/clinic?' +
        new URLSearchParams({
          role: person.role,
          organizationId: '00000000-0000-4000-8000-000000000001',
        }),
    );
    assert.equal(foreign.status(), 403);
    report.checks.push(`${person.role}: unrelated organization denied (403)`);
  }
  report.completedAt = new Date().toISOString();
  await mkdir('artifacts/clinic-data-recovery', { recursive: true });
  await writeFile(
    `artifacts/clinic-data-recovery/${label}-api.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: report.checks.length,
      origin,
      counts: report.counts,
      clinicalWrites: 0,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ passed: false, step, errorType: error.name, completed: report.checks.length }),
  );
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.dispose();
}
