// Focused live authorization checks for the newly approved commands; no fixtures or service key.
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname, `${ref}.supabase.co`);
const vault = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const operator = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const configured = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
);
const evidence = JSON.parse(
  await readFile('artifacts/phase2c-validation/workflow-results.json', 'utf8'),
);
const makeClient = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
const sessions = new Map();
const checks = [];
let step = 'verified login';
try {
  for (const person of [{ ...operator, role: 'admin' }, ...configured.accounts]) {
    const client = makeClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: person.email,
      password: person.password,
    });
    assert.ok(!error && data.user?.email_confirmed_at);
    sessions.set(person.role, client);
  }
  const { data: a, error } = await sessions
    .get('admin')
    .from('appointments')
    .select('branch_id,patient_id,doctor_id')
    .eq('id', evidence.appointmentId)
    .single();
  assert.ok(!error && a);
  const history = {
    allergies: ['Penicillin'],
    conditions: [],
    medications: [],
    surgeries: '',
    familyHistory: '',
    socialHistory: '',
    bloodGroup: '',
    emergencyContact: '',
  };
  const cases = [
    [
      'Patient clinic management denied',
      'patient',
      'manage_clinic',
      {
        p_branch_id: a.branch_id,
        p_action: 'branch',
        p_data: { id: a.branch_id, name: 'SRO Main Clinic', active: true },
      },
    ],
    [
      'Doctor Admin-only clinic management denied',
      'doctor',
      'manage_clinic',
      {
        p_branch_id: a.branch_id,
        p_action: 'branch',
        p_data: { id: a.branch_id, name: 'SRO Main Clinic', active: true },
      },
    ],
    [
      'Patient slot publication denied',
      'patient',
      'publish_appointment_slots',
      {
        p_branch_id: a.branch_id,
        p_doctor_id: a.doctor_id,
        p_from: '2026-10-27',
        p_until: '2026-10-27',
      },
    ],
    [
      'Patient clinical history write denied',
      'patient',
      'save_patient_history',
      { p_branch_id: a.branch_id, p_patient_id: a.patient_id, p_history: history },
    ],
    [
      'Admin clinical history write denied',
      'admin',
      'save_patient_history',
      { p_branch_id: a.branch_id, p_patient_id: a.patient_id, p_history: history },
    ],
    [
      'Unassigned branch authority denied',
      'doctor',
      'manage_clinic',
      {
        p_branch_id: '00000000-0000-4000-8000-000000000001',
        p_action: 'profile',
        p_data: { name: 'Dr. Sara Malik' },
      },
    ],
  ];
  for (const [name, role, fn, args] of cases) {
    step = name;
    const { error: denial } = await sessions.get(role).rpc(fn, args);
    assert.equal(denial?.code, '42501');
    checks.push({ name, passed: true, code: denial.code });
  }
  const anonymous = makeClient();
  for (const [, , fn, args] of cases.filter((_, i) => [0, 2, 3].includes(i))) {
    step = `Anonymous ${fn} denied`;
    const { error: denial } = await anonymous.rpc(fn, args);
    assert.equal(denial?.code, '42501');
    checks.push({ name: step, passed: true, code: denial.code });
  }
  step = 'Private helper absent from exposed API schemas';
  const { error: privateError } = await sessions
    .get('patient')
    .schema('clinic_private')
    .rpc('workspace_admin', { p_branch_id: a.branch_id });
  assert.equal(privateError?.code, 'PGRST106');
  checks.push({ name: step, passed: true, code: privateError.code });
  await writeFile(
    'artifacts/phase2c-validation/rpc-denials.json',
    JSON.stringify(
      {
        projectRef: ref,
        checks,
        completedAt: new Date().toISOString(),
        clinicalServiceKeyUsed: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({ projectRef: ref, passed: checks.length, clinicalServiceKeyUsed: false }),
  );
} catch {
  console.error(JSON.stringify({ passed: false, failedStep: step, checksPassed: checks.length }));
  process.exitCode = 1;
} finally {
  for (const client of sessions.values()) await client.auth.signOut({ scope: 'local' });
}
