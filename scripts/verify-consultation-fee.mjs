// Ordinary authenticated HTTP/RPC checks. Only the selected fictional Doctor's fee changes;
// its original value is restored in finally, including when verification fails.
import { request } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
const vault = path.join(process.env.USERPROFILE, '.codex/secrets/sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const sessions = {},
  checks = [],
  contexts = [];
let assignment,
  originalFee,
  changed = false,
  restored = false,
  step = 'verified authentication';
const stateFor = async (role) => {
  const s = sessions[role];
  const r = await s.http.get(
    '/api/clinic?' + new URLSearchParams({ role, organizationId: s.organizationId }),
  );
  assert.equal(r.status(), 200);
  return (await r.json()).state;
};
const update = (role, fee, branch = assignment.branchId, claimedRole = role) =>
  sessions[role].http.post('/api/clinic', {
    headers: { Origin: origin },
    data: {
      role: claimedRole,
      organizationId: sessions[role].organizationId,
      command: 'configure',
      input: { branchId: branch, action: 'fee', data: { doctorId: assignment.doctorId, fee } },
    },
  });
try {
  for (const person of [{ ...admin, role: 'admin' }, ...accounts]) {
    const http = await request.newContext({ baseURL: origin });
    contexts.push(http);
    assert.equal(
      (
        await http.post('/api/auth/login', {
          headers: { Origin: origin },
          data: { email: person.email, password: person.password },
        })
      ).status(),
      200,
    );
    const identity = (await (await http.get('/api/auth/session')).json()).identity;
    const m = identity.memberships.find((m) => m.roles.includes(person.role) && m.branchIds.length);
    assert.ok(m);
    sessions[person.role] = { http, organizationId: m.organizationId };
  }
  const before = await stateFor('admin');
  const doctor = before.doctors.find((d) => d.name === 'Dr. Sara Malik');
  assert.ok(doctor);
  assignment = before.assignments.find((a) => a.doctorId === doctor.id && a.active);
  assert.ok(assignment);
  originalFee = assignment.fee;
  assert.equal(originalFee, 0, 'Expected original Free fee; stop on unexpected change.');
  const appointments = before.appointments;
  step = 'permission denials';
  for (const role of ['doctor', 'patient']) {
    assert.equal((await update(role, '1500.00')).status(), 403);
    assert.equal((await update(role, '1500.00', assignment.branchId, 'admin')).status(), 403);
    const person = accounts.find((p) => p.role === role);
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const login = await client.auth.signInWithPassword({
      email: person.email,
      password: person.password,
    });
    assert.ok(!login.error && login.data.user.email_confirmed_at);
    const denied = await client.rpc('manage_clinic', {
      p_branch_id: assignment.branchId,
      p_action: 'fee',
      p_data: { doctorId: doctor.id, fee: '1500.00' },
    });
    assert.equal(denied.error?.code, '42501');
    await client.auth.signOut({ scope: 'local' });
    checks.push(`${role}: API, forged Admin role and direct RPC fee updates denied`);
  }
  const unassignedBranch = '00000000-0000-4000-8000-000000000099';
  assert.equal((await update('admin', '1500.00', unassignedBranch)).status(), 403);
  checks.push('Admin unassigned branch API denied (real multi-branch fixtures tested locally)');
  for (const fee of ['-1', '1000000.01', '1.001', '1e3'])
    assert.equal((await update('admin', fee)).status(), 400);
  checks.push('Invalid amounts rejected by server');
  step = 'authorized paid fee';
  changed = true;
  const paidResponse = await update('admin', '1500.00');
  if (paidResponse.status() !== 200)
    console.log(
      JSON.stringify({
        paidStatus: paidResponse.status(),
        error: (await paidResponse.json()).error,
      }),
    );
  assert.equal(paidResponse.status(), 200);
  for (const role of ['admin', 'doctor', 'patient']) {
    step = `paid snapshot ${role}`;
    for (let n = 0; n < 2; n++) {
      const s = await stateFor(role);
      assert.equal(
        s.assignments.find((a) => a.doctorId === doctor.id && a.branchId === assignment.branchId)
          ?.fee,
        1500,
      );
    }
  }
  step = 'historical appointment preservation';
  assert.deepEqual((await stateFor('admin')).appointments, appointments);
  checks.push(
    'Admin Free → Rs. 1,500 persisted in two fresh API reads for all three roles; historical appointments unchanged',
  );
  step = 'restore original Free fee';
  assert.equal((await update('admin', '0.00')).status(), 200);
  restored = true;
  for (const role of ['admin', 'doctor', 'patient'])
    assert.equal(
      (await stateFor(role)).assignments.find(
        (a) => a.doctorId === doctor.id && a.branchId === assignment.branchId,
      )?.fee,
      0,
    );
  const after = await stateFor('admin');
  assert.deepEqual(after.appointments, appointments);
  step = 'human-readable fee audit confirmation';
  assert.ok(after.audit.filter((a) => a.action === 'clinic fee saved').length >= 2);
  checks.push('Paid → Free persisted for all roles; existing audit records fee changes');
  const report = {
    checkedAt: new Date().toISOString(),
    projectRef: ref,
    origin,
    originalFee,
    finalFee: 0,
    checks,
    newPatients: 0,
    newAppointments: 0,
  };
  await mkdir('artifacts/consultation-fee-validation', { recursive: true });
  await writeFile(
    'artifacts/consultation-fee-validation/live.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch {
  console.error(
    JSON.stringify({
      failed: step,
      detail: 'Sanitized verification failure; no credentials logged.',
    }),
  );
  process.exitCode = 1;
} finally {
  if (changed && !restored) {
    const r = await update('admin', String(originalFee));
    restored = r.status() === 200;
    console.log(JSON.stringify({ originalFeeRestored: restored }));
    if (!restored) process.exitCode = 1;
  }
  for (const c of contexts) await c.dispose();
}
