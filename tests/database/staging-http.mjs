// Explicitly approved disposable staging only. Never loads application .env files.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { loadStagingCredentials } from './staging-credentials.mjs';

const STAGING = 'ibulqvolmfouvkqczqhs';
const PROTECTED = 'jyigxpjvygvtvcypujel';
const config = await loadStagingCredentials();
const origin = new URL(config.url);
assert.equal(config.projectRef, STAGING);
assert.notEqual(config.projectRef, PROTECTED);
assert.equal(origin.origin, `https://${STAGING}.supabase.co`);
assert.equal(origin.pathname, '/');
assert.ok(config.publishableKey && typeof config.passwordForUser === 'function');
const id = (g, n) => `${g}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const results = [];
const sessions = new Map();
const notificationOnly = process.argv.includes('--notification-only');
const metadataOnly = process.argv.includes('--metadata-only');
const tables = [
  'organizations',
  'profiles',
  'organization_memberships',
  'role_assignments',
  'branches',
  'branch_memberships',
  'specializations',
  'symptom_categories',
  'specialization_symptoms',
  'doctors',
  'doctor_branch_assignments',
  'patients',
  'patient_branches',
  'doctor_invitations',
  'doctor_schedules',
  'schedule_breaks',
  'doctor_leave',
  'appointment_slots',
  'appointments',
  'appointment_reservations',
  'appointment_status_history',
  'patient_assignments',
  'clinical_access_grants',
  'patient_medical_history',
  'clinical_encounters',
  'encounter_vitals',
  'prescriptions',
  'prescription_items',
  'medical_documents',
  'consultation_charges',
  'payment_records',
  'notifications',
  'notification_recipients',
  'audit_logs',
];

async function request(path, user, { method = 'GET', body, headers = {}, token } = {}) {
  assert.ok(path.startsWith('/auth/v1/') || path.startsWith('/rest/v1/'));
  const bearer = token ?? sessions.get(user);
  const response = await fetch(origin.origin + path, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: config.publishableKey,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data };
}
function ok(r) {
  assert.ok(r.status >= 200 && r.status < 300, `HTTP ${r.status}, code ${r.data?.code ?? 'none'}`);
  return r.data;
}
function denied(r, sqlstate = '42501') {
  assert.ok([401, 403].includes(r.status), `Expected denial, HTTP ${r.status}`);
  if (sqlstate) assert.equal(r.data?.code, sqlstate);
}
const read = async (table, user, query = '') =>
  ok(await request(`/rest/v1/${table}?select=*${query}`, user));
const rpc = (name, args, user) =>
  request(`/rest/v1/rpc/${name}`, user, { method: 'POST', body: args });
async function test(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (e) {
    // Only assertion summaries, never HTTP bodies, JWTs, passwords or configuration.
    const reason = String(e.message).split('\n')[0].slice(0, 180);
    results.push({ name, passed: false, reason });
    console.log(`FAIL ${name}: ${reason}`);
  }
}

// Auth users/identities were provisioned with isolated SQL fixtures; these are real
// GoTrue password grants and server-signed sessions, not locally minted JWTs.
for (const n of notificationOnly
  ? [6]
  : metadataOnly
    ? [10]
    : Array.from({ length: 13 }, (_, i) => i + 1)) {
  const r = await request('/auth/v1/token?grant_type=password', null, {
    method: 'POST',
    body: { email: `persona${n}@example.test`, password: config.passwordForUser(n) },
  });
  if (r.status !== 200 || !r.data?.access_token)
    throw new Error(`Auth session ${n}: HTTP ${r.status}`);
  const claims = JSON.parse(Buffer.from(r.data.access_token.split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, id(3, n));
  assert.equal(claims.iss, `${origin.origin}/auth/v1`);
  assert.equal(claims.role, 'authenticated');
  sessions.set(n, r.data.access_token);
}
console.log(
  `Real Auth password sessions established for ${sessions.size} fictional identities; no tokens logged.`,
);

async function notificationCheck() {
  const recipient = (await read('notification_recipients', 6))[0];
  assert.ok(recipient);
  // Hosted PostgREST requires an explicit WHERE clause even when RLS scopes rows.
  const filter = `?organization_id=eq.${recipient.organization_id}&notification_id=eq.${recipient.notification_id}&user_id=eq.${id(3, 6)}`;
  ok(
    await request('/rest/v1/notification_recipients' + filter, 6, {
      method: 'PATCH',
      body: { read_at: new Date().toISOString() },
    }),
  );
  denied(
    await request('/rest/v1/notification_recipients' + filter, 6, {
      method: 'PATCH',
      body: { user_id: id(3, 1) },
    }),
  );
}
if (notificationOnly) {
  await test(
    'notification read marker is writable but recipient identity is protected',
    notificationCheck,
  );
  await writeFile(
    'artifacts/phase2a5/http-notification-regression.json',
    JSON.stringify({ projectRef: STAGING, results }, null, 2) + '\n',
  );
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}
async function metadataCheck() {
  ok(
    await request('/auth/v1/user', 10, {
      method: 'PUT',
      body: { data: { role: 'admin', branchIds: [id(2, 1)] } },
    }),
  );
  const fresh = ok(
    await request('/auth/v1/token?grant_type=password', null, {
      method: 'POST',
      body: { email: 'persona10@example.test', password: config.passwordForUser(10) },
    }),
  );
  const claims = JSON.parse(Buffer.from(fresh.access_token.split('.')[1], 'base64url').toString());
  assert.equal(claims.user_metadata.role, 'admin');
  assert.equal(claims.role, 'authenticated');
  sessions.set(10, fresh.access_token);
  assert.equal((await read('patients', 10)).length, 0);
  denied(
    await rpc(
      'book_appointment',
      { p_slot_id: id(6, 1), p_patient_id: id(5, 1), p_reason: 'Fictional forged authority' },
      10,
    ),
  );
}
if (metadataOnly) {
  await test(
    'fresh signed JWT with forged user metadata cannot grant Admin authority',
    metadataCheck,
  );
  await writeFile(
    'artifacts/phase2a5/http-metadata-regression.json',
    JSON.stringify({ projectRef: STAGING, results }, null, 2) + '\n',
  );
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}
assert.equal(
  (await read('appointments', 2)).length,
  0,
  'Requires the fresh isolated fixture; no automatic cleanup',
);

await test('Auth server validates a real Doctor session', async () => {
  assert.equal(ok(await request('/auth/v1/user', 3)).id, id(3, 3));
});
for (const table of tables) {
  await test(`anon cannot SELECT ${table}`, async () =>
    denied(await request(`/rest/v1/${table}?select=*`, null)));
  await test(`Admin cannot INSERT directly into ${table}`, async () =>
    denied(await request(`/rest/v1/${table}`, 1, { method: 'POST', body: {} })));
}
await test('private schema is not exposed through PostgREST', async () => {
  const r = await request('/rest/v1/invitation_secrets?select=*', 1, {
    headers: { 'Accept-Profile': 'clinic_private' },
  });
  assert.equal(r.status, 406);
  assert.equal(r.data.code, 'PGRST106');
});
await test('invalid JWT signature is rejected', async () => {
  const parts = sessions.get(6).split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const r = await request('/rest/v1/patients?select=id', null, { token: parts.join('.') });
  assert.equal(r.status, 401);
});
await test('forged user metadata cannot grant Admin authority', async () => {
  await metadataCheck();
});
await test('Doctor cannot manufacture initial care through self-booking', async () => {
  denied(
    await rpc(
      'book_appointment',
      { p_slot_id: id(6, 1), p_patient_id: id(5, 1), p_reason: 'Fictional denied intake' },
      3,
    ),
  );
});
await test('Patient cannot book another patient', async () => {
  denied(
    await rpc(
      'book_appointment',
      { p_slot_id: id(6, 1), p_patient_id: id(5, 2), p_reason: 'Fictional denied patient' },
      6,
    ),
  );
});
await test('Patient cannot book across an unauthorized branch', async () => {
  denied(
    await rpc(
      'book_appointment',
      { p_slot_id: id(6, 6), p_patient_id: id(5, 1), p_reason: 'Fictional denied branch' },
      6,
    ),
  );
});
await test('directory and patient rows respect branch and tenant boundaries', async () => {
  assert.equal((await read('branches', 6)).length, 1);
  assert.equal((await read('branches', 2)).length, 2);
  assert.equal((await read('patients', 6)).length, 1);
  assert.equal((await read('patients', 6, `&id=eq.${id(5, 2)}`)).length, 0);
  assert.equal((await read('patients', 9, `&organization_id=eq.${id(1, 1)}`)).length, 0);
});

const booking = {
  p_slot_id: id(6, 1),
  p_patient_id: id(5, 1),
  p_reason: 'Fictional real JWT consultation',
};
const a = ok(await rpc('book_appointment', booking, 6));
assert.match(a, /^[0-9a-f-]{36}$/);
const transition = (state, user = 1) =>
  rpc('transition_appointment', { p_appointment_id: a, p_status: state }, user);
await test('pending booking does not grant Doctor clinical access', async () => {
  assert.equal((await read('appointments', 3)).length, 1);
  for (const t of ['patient_medical_history', 'clinical_encounters', 'medical_documents'])
    assert.equal((await read(t, 3)).length, 0);
});
await test('Patient, unrelated Doctor and wrong-branch clinician cannot approve', async () => {
  for (const u of [6, 4, 11, 9]) denied(await transition('confirmed', u));
});
await test('branch Admin approves and primary Doctor gains authorized history', async () => {
  ok(await transition('confirmed'));
  assert.equal((await read('patient_medical_history', 3)).length, 1);
  assert.equal((await read('patient_medical_history', 4)).length, 0);
});
ok(await transition('in_consultation', 3));
const notes = {
  symptoms: 'Fictional symptoms',
  examination: 'Fictional examination',
  diagnosis: 'Fictional assessment',
  plan: 'Fictional plan',
  followUp: 'Fictional follow-up',
  vitals: { bloodPressure: '120/80', pulse: '72' },
};
const items = [
  {
    medication: 'Demo medicine',
    strength: 'Fictional',
    dosage: 'Fictional',
    frequency: 'Fictional',
    duration: 'Fictional',
    instructions: 'Not a real prescription',
  },
];
const save = (sign, user = 3) =>
  rpc(
    'save_encounter',
    { p_appointment_id: a, p_notes: notes, p_items: items, p_sign: sign },
    user,
  );
const encounter = ok(await save(false));
await test('draft notes, vitals and Rx are visible to care team/Admin but hidden from Patient', async () => {
  for (const t of [
    'clinical_encounters',
    'encounter_vitals',
    'prescriptions',
    'prescription_items',
  ]) {
    assert.equal((await read(t, 3)).length, 1);
    assert.equal((await read(t, 1)).length, 1);
    assert.equal((await read(t, 6)).length, 0);
  }
});
await test('Admin and unrelated Doctor cannot author or sign the consultation', async () => {
  for (const u of [1, 4, 5, 6]) denied(await save(true, u));
});
const grantArgs = {
  p_patient_id: id(5, 1),
  p_branch_id: id(2, 1),
  p_user_id: id(3, 4),
  p_reason: 'Fictional authorized review',
};
let grant;
await test('Admin grant permits additional Doctor read without durable primary care', async () => {
  grant = ok(await rpc('grant_clinical_access', grantArgs, 1));
  assert.equal((await read('clinical_encounters', 4)).length, 1);
  denied(
    await rpc(
      'book_appointment',
      {
        p_slot_id: id(6, 8),
        p_patient_id: id(5, 1),
        p_reason: 'Fictional denied grant laundering',
      },
      4,
    ),
  );
  denied(await save(true, 4));
  denied(await rpc('grant_clinical_access', { ...grantArgs, p_user_id: id(3, 5) }, 4));
});
await test('grant revocation immediately removes clinical visibility', async () => {
  ok(await rpc('revoke_clinical_access', { p_grant_id: grant }, 1));
  assert.equal((await read('clinical_encounters', 4)).length, 0);
});
await test('expired grant removes clinical access on a new real JWT request', async () => {
  ok(
    await rpc(
      'grant_clinical_access',
      { ...grantArgs, p_expires_at: new Date(Date.now() + 12000).toISOString() },
      1,
    ),
  );
  assert.equal((await read('clinical_encounters', 4)).length, 1);
  await new Promise((resolve) => setTimeout(resolve, 13000));
  assert.equal((await read('clinical_encounters', 4)).length, 0);
});
await test('Doctor signing atomically completes visit and publishes own Patient Rx', async () => {
  assert.equal(ok(await save(true)), encounter);
  assert.equal((await read('appointments', 6, `&id=eq.${a}`))[0].status, 'completed');
  assert.equal((await read('clinical_encounters', 6))[0].status, 'signed');
  assert.equal((await read('prescription_items', 6)).length, 1);
  assert.equal((await read('clinical_encounters', 7)).length, 0);
  assert.equal((await read('clinical_encounters', 9)).length, 0);
  assert.ok((await read('appointment_reservations', 6)).every((r) => !r.active));
});
await test('signed note cannot be overwritten by direct client PATCH or repeated signing', async () => {
  denied(
    await request(`/rest/v1/clinical_encounters?id=eq.${encounter}`, 3, {
      method: 'PATCH',
      body: { diagnosis: 'Fictional forbidden change' },
    }),
  );
  const r = await save(true);
  assert.equal(r.data.code, '23514');
  assert.equal((await read('clinical_encounters', 6))[0].diagnosis, notes.diagnosis);
});
await test('notification read marker is writable but recipient identity is protected', async () => {
  await notificationCheck();
  assert.equal((await read('notifications', 7)).length, 0);
});
const anonArgs = {
  available_appointment_slots: {
    p_branch_id: id(2, 1),
    p_doctor_id: id(4, 1),
    p_date: '2100-01-04',
  },
  book_appointment: booking,
  request_reschedule: { p_appointment_id: a, p_slot_id: id(6, 2), p_reason: 'Fictional' },
  transition_appointment: { p_appointment_id: a, p_status: 'confirmed' },
  save_encounter: { p_appointment_id: a, p_notes: notes },
  grant_clinical_access: grantArgs,
  revoke_clinical_access: { p_grant_id: grant },
  add_doctor_leave: {
    p_doctor_id: id(4, 1),
    p_starts_at: '2100-01-04T04:00Z',
    p_ends_at: '2100-01-04T05:00Z',
    p_reason: 'Fictional',
  },
};
for (const [name, args] of Object.entries(anonArgs))
  await test(`anon cannot EXECUTE ${name}`, async () => denied(await rpc(name, args, null)));

const report = {
  projectRef: STAGING,
  checkedAt: new Date().toISOString(),
  realAuthSessions: sessions.size,
  authProvisioning: 'SQL fictional users/identities; real GoTrue password grants',
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  appointmentId: a,
  encounterId: encounter,
  results,
};
await writeFile('artifacts/phase2a5/http-results.json', JSON.stringify(report, null, 2) + '\n');
console.log(`HTTP validation: ${report.passed} passed, ${report.failed} failed.`);
if (report.failed) process.exitCode = 1;
