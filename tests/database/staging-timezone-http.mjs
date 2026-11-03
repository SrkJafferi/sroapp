import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { loadStagingCredentials } from './staging-credentials.mjs';
const c = await loadStagingCredentials();
assert.equal(c.projectRef, 'ibulqvolmfouvkqczqhs');
assert.equal(c.url, 'https://ibulqvolmfouvkqczqhs.supabase.co');
const results = [];
async function request(path, token, body) {
  const r = await fetch(c.url + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: c.publishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
const session = await request('/auth/v1/token?grant_type=password', null, {
  email: 'persona8@example.test',
  password: c.passwordForUser(8),
});
assert.equal(session.status, 200);
const token = session.data.access_token;
const suffix = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
for (const [date, slot] of [
  ['2100-03-13', 9002],
  ['2100-03-14', 9003],
  ['2100-11-06', 9005],
  ['2100-11-07', 9006],
]) {
  const r = await request('/rest/v1/rpc/available_appointment_slots', token, {
    p_branch_id: '20000000-0000-4000-8000-000000000002',
    p_doctor_id: '40000000-0000-4000-8000-000000000001',
    p_date: date,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.data.map((s) => s.id),
    [suffix(slot)],
  );
  results.push({ name: `NY local 09:00 and UTC offset on ${date}`, passed: true });
}
for (const slot of [9004, 9007]) {
  const r = await request('/rest/v1/rpc/book_appointment', token, {
    p_slot_id: suffix(slot),
    p_patient_id: '50000000-0000-4000-8000-000000000003',
    p_reason: 'Fictional denied timezone boundary',
  });
  assert.equal(r.data.code, '23514');
  results.push({ name: `Reject before-opening or previous-local-day slot ${slot}`, passed: true });
}
const booked = await request('/rest/v1/rpc/book_appointment', token, {
  p_slot_id: suffix(9003),
  p_patient_id: '50000000-0000-4000-8000-000000000003',
  p_reason: 'Fictional valid DST appointment',
});
assert.equal(booked.status, 200);
assert.match(booked.data, /^[0-9a-f-]{36}$/);
results.push({
  name: 'Valid spring DST slot can actually be reserved by its Patient',
  passed: true,
});
const authHealth = await request('/auth/v1/health');
const rest = await request('/rest/v1/', token);
const report = {
  projectRef: c.projectRef,
  passed: results.length,
  failed: 0,
  results,
  authVersion: authHealth.status === 200 ? authHealth.data.version : 'unavailable',
  postgrestVersion: rest.status === 200 ? rest.data.info?.version : 'unavailable',
};
await writeFile(
  'artifacts/phase2a5/timezone-http-results.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    passed: report.passed,
    failed: 0,
    authVersion: report.authVersion,
    postgrestVersion: report.postgrestVersion,
  }),
);
