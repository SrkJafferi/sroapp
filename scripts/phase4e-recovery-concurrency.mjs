import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const REPO = process.cwd();
const HARNESS = process.env.PGLITE_HARNESS || path.join(os.tmpdir(), 'sro-phase4e-harness');
if (!existsSync(path.join(HARNESS, 'package.json')))
  throw Error(`Install @electric-sql/pglite-socket and pg in ${HARNESS} first.`);
const requireHarness = createRequire(path.join(HARNESS, 'package.json'));
const { Client } = requireHarness('pg');
const SERVER = path.join(
  HARNESS,
  'node_modules/@electric-sql/pglite-socket/dist/scripts/server.js',
);
const ORG = '88645fbe-34da-48aa-a509-c24441b7cf72';
const BRANCH = '20000000-0000-4000-8000-000000000001';
const ADMIN = '30000000-0000-4000-8000-000000000001';
const RECOVERY_PATIENT = '50000000-0000-4000-8000-000000000020';
const PORT_A = 55433;
const PORT_B = 55434;
const ATTESTATION =
  'I confirm that Ayesha Noor (SRO0009) is an authorized fictional clinic test record under operator control. I have verified the exact existing Patient, Auth identity, clinic ownership, original pilot, and quarantined handover state. I authorize one controlled test credential recovery without claiming physical Patient identity verification.';

const args = process.argv.slice(2);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
async function connect(port) {
  const client = new Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres' });
  await client.connect();
  return client;
}
async function waitForServer(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const client = await connect(port);
      await client.query('select 1');
      await client.end();
      return;
    } catch {
      await wait(500);
    }
  }
  throw Error(`PGlite socket server on ${port} did not become ready`);
}
async function startServer(dbPath, port) {
  rmSync(dbPath, { recursive: true, force: true });
  const child = spawn(
    process.execPath,
    [
      SERVER,
      `--db=${dbPath}`,
      `--port=${port}`,
      '--host=127.0.0.1',
      '--max-connections=4',
      '--extensions=btree_gist',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
  );
  await waitForServer(port);
  return child;
}
function stopServer(child) {
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  } catch {}
}
const shim = `
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
alter table auth.users add email text, add email_confirmed_at timestamptz, add banned_until timestamptz,
  add deleted_at timestamptz, add encrypted_password text, add last_sign_in_at timestamptz,
  add confirmation_sent_at timestamptz, add created_at timestamptz not null default now(),
  add raw_user_meta_data jsonb not null default '{}';
create table auth.identities(user_id uuid,provider text,primary key(user_id,provider));
create table auth.mfa_factors(user_id uuid,status text);
create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon,service_role;
grant select,insert,update,delete on storage.objects to authenticated;
grant select on storage.objects to anon;
`;
const proposalFiles = [
  'phase2b/20261026111934_clinic_auth_onboarding.sql',
  'phase2c/20261026123202_clinic_workspace_commands.sql',
  'profiles/20261026192535_clinic_profiles_avatars.sql',
  'patient-ids/20261026195847_clinic_patient_numbers.sql',
  'patient-age/20261026224947_clinic_patient_age.sql',
  'walk-in/20261027093051_clinic_walk_in_registration.sql',
  'staff-booking/20261027105809_clinic_staff_booking_profiles.sql',
  'patient-registration/20261027155325_clinic_patient_registration_timestamp.sql',
  'doctor-profile/20261027164031_clinic_doctor_verified_email.sql',
  'department-edit/20261027170222_clinic_department_edit.sql',
  'doctor-onboarding/20261027210515_clinic_doctor_onboarding_preview.sql',
  'single-email-onboarding/20261028103401_clinic_single_email_onboarding.sql',
  'invitation-management/20261028120915_clinic_invitation_management.sql',
  'incomplete-onboarding-recovery/20261028131406_clinic_incomplete_onboarding_recovery.sql',
  'patient-access/20261029182220_clinic_patient_account_access.sql',
  'patient-account-coordination/20261030065902_clinic_patient_account_coordination.sql',
  'patient-walkin-pilot/20261101090000_clinic_patient_walkin_pilot.sql',
  'sro0009-recovery/20261101120000_clinic_sro0009_recovery.sql',
];
async function setupDatabase(port) {
  const client = await connect(port);
  try {
    await client.query(shim);
    for (const file of readdirSync(path.join(REPO, 'supabase/migrations')).sort())
      await client.query(readFileSync(path.join(REPO, 'supabase/migrations', file), 'utf8'));
    for (const file of proposalFiles.slice(0, 3))
      await client.query(readFileSync(path.join(REPO, 'supabase/proposals', file), 'utf8'));
    const fixture = readFileSync(path.join(REPO, 'supabase/fixtures/fictional.sql'), 'utf8')
      .replaceAll('10000000-0000-4000-8000-000000000001', ORG)
      .replaceAll('50000000-0000-4000-8000-000000000001', '398cf267-bc60-41a4-91e6-478dcd86a069')
      .replaceAll('Fictional Patient A', 'Amina Noor');
    await client.query(fixture);
    await client.query(`
      delete from public.medical_documents;
      delete from public.patient_medical_history;
      delete from public.patient_branches where patient_id <> '398cf267-bc60-41a4-91e6-478dcd86a069';
      delete from public.patients where id <> '398cf267-bc60-41a4-91e6-478dcd86a069';
      update auth.users set email = id::text || '@example.test', email_confirmed_at = now(),
        encrypted_password = 'fictional-hash';
    `);
    for (const file of proposalFiles.slice(3))
      await client.query(readFileSync(path.join(REPO, 'supabase/proposals', file), 'utf8'));
    await client.query(readFileSync(path.join(REPO, 'artifacts/phase4e/concurrency-fixture.sql'), 'utf8'));
    await client.query('select public.patient_account_recovery_setup($1,$2)', [
      ADMIN,
      ATTESTATION,
    ]);
    const state = await client.query(`
      select jsonb_build_object(
        'patientCode',(select patient_code from public.patients where id='${RECOVERY_PATIENT}'),
        'accountState',(select state from clinic_private.patient_accounts where patient_id='${RECOVERY_PATIENT}'),
        'pilotState',(select state from clinic_private.patient_pilot_authorizations where patient_id='${RECOVERY_PATIENT}'),
        'recoveryTarget',(select patient_code from clinic_private.patient_account_recovery_targets),
        'resetFunction',(select pg_get_function_result(p.oid)||' ('||pg_get_function_identity_arguments(p.oid)||')'
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='patient_account_recovery_reset')
      ) as r
    `);
    return state.rows[0].r;
  } finally {
    await client.end();
  }
}
async function runScenarioA() {
  const dbPath = path.join(os.tmpdir(), `sro-phase4e-a-${process.pid}`);
  const child = await startServer(dbPath, PORT_A);
  try {
    const seed = await setupDatabase(PORT_A);
    const startAt = Date.now() + 3000;
    const jobs = ['A', 'B'].map((label) => {
      const out = path.join(os.tmpdir(), `sro-phase4e-a-${process.pid}-${label}.json`);
      const worker = spawn(
        process.execPath,
        [
          new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
          '--worker',
          '--scenario=a',
          `--port=${PORT_A}`,
          `--startAt=${startAt}`,
          `--out=${out}`,
          `--op=${randomUUID()}`,
          `--workerId=${randomUUID()}`,
          `--proof=${randomBytes(32).toString('base64url')}`,
          `--request=${randomUUID()}`,
        ],
        { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
      );
      return { label, out, worker };
    });
    await Promise.all(
      jobs.map(
        (job) =>
          new Promise((resolve) => {
            job.worker.on('close', resolve);
          }),
      ),
    );
    const results = jobs.map((job) => ({
      label: job.label,
      ...JSON.parse(readFileSync(job.out, 'utf8')),
    }));
    for (const job of jobs) rmSync(job.out, { force: true });
    const client = await connect(PORT_A);
    try {
      const facts = (
        await client.query(`
          select jsonb_build_object(
            'operations',(select jsonb_agg(jsonb_build_object('purpose',purpose,'phase',phase) order by created_at)
              from clinic_private.patient_operations where patient_id='${RECOVERY_PATIENT}'),
            'recovery',(select jsonb_build_object('state',state,'reissueCount',reissue_count,
              'operationId',operation_id,'workerId',worker_id)
              from clinic_private.patient_account_recoveries where patient_id='${RECOVERY_PATIENT}'),
            'account',(select jsonb_build_object('state',state) from clinic_private.patient_accounts
              where patient_id='${RECOVERY_PATIENT}'),
            'resetAudit',(select count(*) from public.audit_logs
              where entity_id='${RECOVERY_PATIENT}' and action='patient.account_recovery_reset_started'),
            'authRows',(select count(*) from auth.users)
          ) as r
        `)
      ).rows[0].r;
      return { seed, startAt, results, facts };
    } finally {
      await client.end();
    }
  } finally {
    stopServer(child);
    await wait(1000);
    rmSync(dbPath, { recursive: true, force: true });
  }
}
async function runScenarioB() {
  const dbPath = path.join(os.tmpdir(), `sro-phase4e-b-${process.pid}`);
  const child = await startServer(dbPath, PORT_B);
  try {
    const seed = await setupDatabase(PORT_B);
    const crashOut = path.join(os.tmpdir(), `sro-phase4e-b-${process.pid}-crash.json`);
    const crashOp = randomUUID();
    const crashWorker = randomUUID();
    const crash = spawn(
      process.execPath,
      [
        new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
        '--worker',
        '--scenario=b-crash',
        `--port=${PORT_B}`,
        `--out=${crashOut}`,
        `--op=${crashOp}`,
        `--workerId=${crashWorker}`,
        `--proof=${randomBytes(32).toString('base64url')}`,
        `--request=${randomUUID()}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    let crashStderr = '';
    crash.stderr.on('data', (chunk) => {
      crashStderr += chunk;
    });
    await new Promise((resolve) => crash.on('close', resolve));
    const crashResult = JSON.parse(readFileSync(crashOut, 'utf8'));
    rmSync(crashOut, { force: true });
    const retryOut = path.join(os.tmpdir(), `sro-phase4e-b-${process.pid}-retry.json`);
    const retry = spawn(
      process.execPath,
      [
        new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
        '--worker',
        '--scenario=b-retry',
        `--port=${PORT_B}`,
        `--out=${retryOut}`,
        `--op=${randomUUID()}`,
        `--workerId=${randomUUID()}`,
        `--proof=${randomBytes(32).toString('base64url')}`,
        `--request=${randomUUID()}`,
        `--originalOp=${crashResult.operationId}`,
        `--originalWorker=${crashWorker}`,
        `--originalFence=${crashResult.fence}`,
        `--wrongProof=${randomBytes(32).toString('base64url')}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    let retryStderr = '';
    retry.stderr.on('data', (chunk) => {
      retryStderr += chunk;
    });
    await new Promise((resolve) => retry.on('close', resolve));
    const retryResult = existsSync(retryOut)
      ? JSON.parse(readFileSync(retryOut, 'utf8'))
      : { outcome: 'worker_no_result', stderr: retryStderr.slice(0, 500) };
    rmSync(retryOut, { force: true });
    const client = await connect(PORT_B);
    try {
      const facts = (
        await client.query(`
          select jsonb_build_object(
            'operations',(select jsonb_agg(jsonb_build_object('purpose',purpose,'phase',phase) order by created_at)
              from clinic_private.patient_operations where patient_id='${RECOVERY_PATIENT}'),
            'recovery',(select jsonb_build_object('state',state,'reissueCount',reissue_count,
              'operationId',operation_id,'workerId',worker_id)
              from clinic_private.patient_account_recoveries where patient_id='${RECOVERY_PATIENT}'),
            'account',(select jsonb_build_object('state',state) from clinic_private.patient_accounts
              where patient_id='${RECOVERY_PATIENT}'),
            'ambiguousPasswordWrite',(select encrypted_password='ambiguous-synthetic-hash' from auth.users
              where id='30000000-0000-4000-8000-000000000020'),
            'handoverAudit',(select count(*) from public.audit_logs
              where entity_id='${RECOVERY_PATIENT}' and action='patient.account_handover')
          ) as r
        `)
      ).rows[0].r;
      return { seed, crashResult, retryResult, facts };
    } finally {
      await client.end();
    }
  } finally {
    stopServer(child);
    await wait(1000);
    rmSync(dbPath, { recursive: true, force: true });
  }
}
async function main() {
  const results = [];
  try {
    const a = await runScenarioA();
    results.push({ scenario: 'simultaneous-claim-reset', ...a });
    const b = await runScenarioB();
    results.push({ scenario: 'crash-after-provider', ...b });
  } catch (error) {
    results.push({ scenario: 'error', error: String(error).slice(0, 500) });
  }
  const a = results[0];
  const b = results[1];
  const checks = [];
  const check = (name, ok) => checks.push({ name, passed: !!ok });
  if (a?.results) {
    check(
      'simultaneous requests: exactly one authorized claim/reset',
      a.results.filter((r) => r.outcome === 'claimed_and_reset').length === 1,
    );
    check(
      'simultaneous requests: exactly one claim denial',
      a.results.filter((r) => r.outcome === 'claim_denied').length === 1,
    );
    check('simultaneous requests: one reset recovery audit', a.facts?.resetAudit === 1);
    check(
      'simultaneous requests: one reset operation only',
      a.facts?.operations?.filter((o) => o.purpose === 'reset').length === 1,
    );
    check('simultaneous requests: reissue count is one', a.facts?.recovery?.reissueCount === 1);
    check('simultaneous requests: account is fenced in resetting', a.facts?.account?.state === 'resetting');
    check('simultaneous requests: no new Auth identity', a.facts?.authRows === 14);
  }
  if (b?.retryResult) {
    check('crashed worker reached the provider boundary', b.crashResult?.outcome === 'crashed_after_provider_start');
    check('retry claim is denied', b.retryResult.claimDenied === true);
    check('retry reset is denied', b.retryResult.resetDenied === true);
    check('late confirmation with wrong proof is denied', b.retryResult.lateConfirmDenied === true);
    check('crashed reset operation remains fenced in started', b.facts?.operations?.some((o) => o.purpose === 'reset' && o.phase === 'started'));
    check('crashed recovery remains claimed with one reissue', b.facts?.recovery?.state === 'claimed' && b.facts?.recovery?.reissueCount === 1);
    check('ambiguous provider password write remains present', b.facts?.ambiguousPasswordWrite === true);
    check('no handover occurred after the crash', b.facts?.handoverAudit === 0);
    check('crashed recovery has exactly one reset operation', b.facts?.operations?.filter((o) => o.purpose === 'reset').length === 1);
  }
  const evidence = {
    checkedAt: new Date().toISOString(),
    harness: HARNESS,
    processes: 2,
    protectedTouched: false,
    syntheticOnly: true,
    results,
    checks,
    passed: checks.filter((c) => c.passed).length,
    failed: checks.filter((c) => !c.passed).length,
  };
  writeFileSync('artifacts/phase4e/concurrency.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.failed) process.exitCode = 1;
}
async function workerMode(argv) {
  const opt = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith('--') && arg.includes('='))
      .map((arg) => {
        const [key, ...value] = arg.slice(2).split('=');
        return [key, value.join('=')];
      }),
  );
  const client = await connect(Number(opt.port));
  const write = (result) =>
    writeFileSync(opt.out, JSON.stringify(result, null, 2) + '\n');
  try {
    if (opt.startAt) {
      const delay = Math.max(0, Number(opt.startAt) - Date.now());
      await wait(delay);
    }
    if (opt.scenario === 'a') {
      try {
        const claimed = (
          await client.query(
            `select public.patient_account_recovery_claim(${lit(ADMIN)}::uuid,${lit(opt.op)}::uuid,${lit(opt.workerId)}::uuid,${lit(opt.proof)},${lit(opt.request)}::uuid) as r`,
          )
        ).rows[0].r;
        try {
          const reset = (
            await client.query(
              `select public.patient_account_recovery_reset(${lit(ADMIN)}::uuid,${lit(opt.op)}::uuid,${lit(opt.workerId)}::uuid,${lit(opt.proof)},${lit(claimed.fence)}::bigint) as r`,
            )
          ).rows[0].r;
          write({ outcome: 'claimed_and_reset', patientId: reset.patientId });
        } catch (error) {
          write({ outcome: 'claimed_reset_denied', message: String(error.message).slice(0, 200) });
        }
      } catch (error) {
        write({ outcome: 'claim_denied', message: String(error.message).slice(0, 200) });
      }
    } else if (opt.scenario === 'b-crash') {
      const claimed = (
        await client.query(
          `select public.patient_account_recovery_claim(${lit(ADMIN)}::uuid,${lit(opt.op)}::uuid,${lit(opt.workerId)}::uuid,${lit(opt.proof)},${lit(opt.request)}::uuid) as r`,
        )
      ).rows[0].r;
      await client.query(
        `select public.patient_account_recovery_reset(${lit(ADMIN)}::uuid,${lit(opt.op)}::uuid,${lit(opt.workerId)}::uuid,${lit(opt.proof)},${lit(claimed.fence)}::bigint)`,
      );
      await client.query(
        `select public.patient_account_operation('start'::text,${lit(ADMIN)}::uuid,${lit(RECOVERY_PATIENT)}::uuid,${lit(opt.op)}::uuid,${lit(opt.workerId)}::uuid,${lit(opt.proof)},${lit(JSON.stringify({ fence: claimed.fence }))}::jsonb)`,
      );
      await client.query(
        "update auth.users set encrypted_password='ambiguous-synthetic-hash' where id='30000000-0000-4000-8000-000000000020'",
      );
      write({ outcome: 'crashed_after_provider_start', operationId: opt.op, fence: claimed.fence });
    } else if (opt.scenario === 'b-retry') {
      const claimDenied = await client
        .query(
          `select public.patient_account_recovery_claim(${lit(ADMIN)}::uuid,${lit(opt.op)}::uuid,${lit(opt.workerId)}::uuid,${lit(opt.proof)},${lit(opt.request)}::uuid) as r`,
        )
        .then(() => false)
        .catch(() => true);
      let resetAttempt;
      const fresh = await connect(Number(opt.port));
      try {
        const result = await fresh.query(
          `select public.patient_account_recovery_reset(${lit(ADMIN)}::uuid,${lit(opt.originalOp)}::uuid,${lit(opt.originalWorker)}::uuid,${lit(opt.wrongProof)},${lit(opt.originalFence)}::bigint) as r`,
        );
        resetAttempt = {
          ok: true,
          patientId: result.rows[0]?.r?.patientId ?? null,
          operationId: result.rows[0]?.r?.operationId ?? null,
        };
      } catch (error) {
        resetAttempt = { ok: false, message: String(error.message).slice(0, 200) };
      }
      const resetDenied = !resetAttempt.ok;
      const lateConfirmDenied = await fresh
        .query(
          `select public.patient_account_operation('confirm'::text,${lit(ADMIN)}::uuid,${lit(RECOVERY_PATIENT)}::uuid,${lit(opt.originalOp)}::uuid,${lit(opt.originalWorker)}::uuid,${lit(opt.wrongProof)},${lit(JSON.stringify({ fence: opt.originalFence }))}::jsonb) as r`,
        )
        .then(() => false)
        .catch(() => true);
      await fresh.end();
      write({ outcome: 'retry_denied', claimDenied, resetDenied, resetAttempt, lateConfirmDenied });
    } else {
      write({ outcome: 'unknown_scenario' });
    }
  } catch (error) {
    write({ outcome: 'worker_error', message: String(error.message).slice(0, 300) });
  } finally {
    await client.end();
  }
}

if (args.includes('--worker')) {
  await workerMode(args);
} else {
  await main();
}
