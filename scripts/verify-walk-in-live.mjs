// Approved protected-project verification. Only the two named fictional staff registrations below.
// Uses ordinary verified user sessions. No Auth creation, emails, service credentials or deletions.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
assert.ok(
  process.argv.includes('--approved-protected-registration-tests'),
  'Explicit approved-test flag required',
);
try {
  await readFile('artifacts/walk-in-validation/live-results.json');
  throw new Error(
    'Live verification already completed; reuse its evidence instead of creating more patients.',
  );
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const origin = 'http://localhost:3100',
  ref = 'jyigxpjvygvtvcypujel';
const vault = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const clients = [],
  identities = {},
  checks = [];
let step = 'login';
try {
  for (const person of [{ ...admin, role: 'admin' }, ...accounts]) {
    const c = await request.newContext({ baseURL: origin });
    clients.push(c);
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
    const member = identity.memberships.find(
      (m) => m.roles.includes(person.role) && m.branchIds.length,
    );
    assert.ok(member);
    identities[person.role] = { c, member };
  }
  async function snapshot(role) {
    const { c, member } = identities[role];
    const r = await c.get(
      '/api/clinic?' + new URLSearchParams({ role, organizationId: member.organizationId }),
    );
    assert.equal(r.status(), 200);
    return r.json();
  }
  const baseline = await snapshot('admin');
  const nadia = baseline.state.patients.find((p) => p.name === 'Nadia Farooq');
  assert.ok(nadia);
  assert.ok(nadia.patientCode);
  assert.equal(nadia.dateOfBirth, '');
  assert.equal(nadia.ageYears, 26);
  assert.equal(nadia.email, '');
  assert.equal(nadia.phone, '');
  assert.equal(nadia.history.bloodGroup, 'B+');
  checks.push(
    'Doctor browser registration persisted without email/phone/DOB, with age and Blood Group',
  );
  const input = {
    branchId: identities.admin.member.branchIds[0],
    ageYears: 42,
    gender: 'Male',
    bloodGroup: 'O+',
    requestId: randomUUID(),
    name: 'Hassan Raza',
    email: '',
    phone: '',
    address: '',
  };
  const contact = {
    ...input,
    requestId: randomUUID(),
    name: 'Mariam Asif',
    gender: 'Female',
    ageYears: 30,
    bloodGroup: 'A+',
    email: 'mariam.asif@example.test',
  };
  const post = (body) =>
    identities.admin.c.post('/api/clinic', {
      headers: { Origin: origin },
      data: {
        role: 'admin',
        organizationId: identities.admin.member.organizationId,
        command: 'register-walk-in',
        input: body,
      },
    });
  console.log('READY_FOR_NATIVE_COUNTER_LOCK');
  if (process.argv.includes('--wait-for-lock')) {
    await new Promise((resolve) => process.stdin.once('data', resolve));
    process.stdin.pause();
  }
  step = 'concurrent Admin registrations';
  const results = await Promise.all([post(input), post(contact)]);
  const saved = [];
  for (const r of results) {
    assert.equal(r.status(), 200);
    const data = await r.json();
    assert.equal(data.saved, true);
    saved.push(data.id);
  }
  assert.equal(new Set(saved.map((x) => x.id)).size, 2);
  assert.equal(new Set(saved.map((x) => x.patientCode)).size, 2);
  checks.push(
    'Concurrent Admin no-email/contact-email registrations returned distinct UUIDs and permanent SRO codes',
  );
  step = 'concurrent idempotent retries';
  const retries = await Promise.all([post(input), post(input)]);
  for (const r of retries) {
    assert.equal(r.status(), 200);
    assert.deepEqual((await r.json()).id, saved[0]);
  }
  checks.push(
    'Concurrent same-request retries returned the original UUID/code without duplicate registration',
  );
  step = 'scope and persistence';
  const a = await snapshot('admin'),
    d = await snapshot('doctor'),
    p = await snapshot('patient');
  for (const s of saved) {
    assert.ok(a.state.patients.some((p) => p.id === s.id && p.patientCode === s.patientCode));
    assert.ok(!d.state.patients.some((p) => p.id === s.id));
    assert.ok(!p.state.patients.some((p) => p.id === s.id));
  }
  assert.ok(d.state.patients.some((p) => p.id === nadia.id));
  assert.ok(!p.state.patients.some((p) => p.id === nadia.id));
  checks.push(
    'Admin persisted both patients; unrelated Doctor and Patient cannot read their records',
  );
  const record = await identities.doctor.c.get(
    '/api/profiles?' +
      new URLSearchParams({
        organizationId: identities.doctor.member.organizationId,
        kind: 'patient',
        id: nadia.id,
      }),
  );
  assert.equal(record.status(), 403);
  checks.push('Doctor intake discovery does not grant profile/medical-record access');
  for (const key of ['appointments', 'consultations', 'prescriptions']) {
    for (const original of baseline.state[key])
      assert.deepEqual(
        a.state[key].find((x) => x.id === original.id),
        original,
      );
  }
  checks.push('Existing appointments, signed consultations and prescriptions unchanged');
  const patientDenied = await identities.patient.c.post('/api/clinic', {
    headers: { Origin: origin },
    data: {
      role: 'patient',
      organizationId: identities.patient.member.organizationId,
      command: 'register-walk-in',
      input,
    },
  });
  assert.equal(patientDenied.status(), 403);
  checks.push('Patient role cannot invoke staff registration');
  await mkdir('artifacts/walk-in-validation', { recursive: true });
  const report = {
    projectRef: ref,
    origin,
    checks,
    newStaffPatients: saved,
    doctorBrowserPatient: { id: nadia.id, patientCode: nadia.patientCode },
    authUsersCreated: 0,
    emailsSent: 0,
    existingClinicalRecordsChanged: 0,
  };
  await writeFile(
    'artifacts/walk-in-validation/live-results.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      newStaffPatients: saved,
      authUsersCreated: 0,
      emailsSent: 0,
      existingClinicalRecordsChanged: 0,
    }),
  );
} catch {
  console.error(JSON.stringify({ failedAt: step, secretValuesPrinted: false }));
  process.exitCode = 1;
} finally {
  for (const c of clients) await c.dispose();
}
