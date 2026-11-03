// Explicitly authorized ONE SRO0007 reset; never run unattended or retry a started run.
import { readFile, mkdir, open, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { passwordSchema } from '../packages/validation/src/index.ts';
import { PilotLiveVerifier } from './patient-access-live-verifier.mjs';
import { privateTerminalInput } from './private-terminal-input.mjs';

const workspace = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(workspace, 'artifacts/patient-access-live-pilot');
const marker = path.join(output, 'controlled-reset-once.json');
const resultPath = path.join(output, 'operator-reset-result.json');
const expectedHash = 'fb9382e290899f02528b01a4de334a90de06665f6763dc275a22f738eb2bb79b';
let phase = 'local-preflight',
  verifier,
  current,
  replacement,
  confirmation;
const checks = [];
async function run(name, fn) {
  phase = name;
  const evidence = await fn();
  checks.push({ phase: name, passed: true, evidence });
  console.log(JSON.stringify({ phase: name, passed: true }));
}
try {
  process.chdir(workspace);
  phase = 'local-debug-logging-guard';
  if (process.env.DEBUG || process.env.PWDEBUG || process.env.NODE_DEBUG)
    throw Error('Debug logging must be disabled before private verification');
  const sql = await readFile(
    'supabase/proposals/patient-access/20261029182220_clinic_patient_account_access.sql',
  );
  phase = 'local-migration-hash';
  if (createHash('sha256').update(sql).digest('hex') !== expectedHash)
    throw Error('Migration drift');
  phase = 'local-feature-gates';
  if (
    !/PATIENT_ACCOUNT_ACCESS_ENABLED = false/.test(
      await readFile('apps/web/lib/patient-access-feature.ts', 'utf8'),
    ) ||
    !/executionApproved: true/.test(
      await readFile('apps/web/lib/patient-access-pilot-policy.ts', 'utf8'),
    )
  )
    throw Error('Feature configuration drift');
  if (process.argv[2] === '--check' && process.argv.length === 3) {
    console.log('Offline configuration check passed; no network or Auth operations performed.');
  } else {
    phase = 'local-interactive-terminal';
    if (process.argv.length !== 2 || !process.stdin.isTTY)
      throw Error('Interactive operator input required');
    phase = 'local-reset-marker';
    try {
      await readFile(marker);
      throw Error('A reset run already started; operator review required');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    console.log(
      'SRO0007 only. This uses the already approved ONE reset. Passwords are not echoed or saved.',
    );
    console.log('There are FOUR steps. Step 1 is the Patient ID confirmation, NOT a password.');
    phase = 'operator-attestation';
    const attestation = await privateTerminalInput(
      'STEP 1/4 - Type exactly SRO0007 (NOT your password; typing is hidden): ',
    );
    if (attestation !== 'SRO0007')
      throw Error('Step 1 requires exactly SRO0007, not a password. No Auth operation attempted.');
    phase = 'operator-current-password-entry';
    current = await privateTerminalInput('STEP 2/4 - CURRENT SRO0007 password (hidden): ');
    phase = 'operator-new-password-entry';
    replacement = await privateTerminalInput(
      'STEP 3/4 - NEW final password (different from current; 10-128 chars, uppercase and number; hidden): ',
    );
    phase = 'operator-new-password-confirmation-entry';
    confirmation = await privateTerminalInput(
      'STEP 4/4 - Repeat the NEW final password (hidden): ',
    );
    phase = 'operator-new-password-policy';
    if (!passwordSchema.max(128).safeParse(replacement).success)
      throw Error(
        'New password must contain 10-128 characters, an uppercase letter and a number. No reset attempted.',
      );
    phase = 'operator-new-password-confirmation';
    if (replacement !== confirmation)
      throw Error('New password confirmation did not match. No reset attempted.');
    phase = 'operator-new-password-distinctness';
    if (replacement === current)
      throw Error('Choose a new password different from the current password. No reset attempted.');
    confirmation = undefined;
    phase = 'private-verifier-initialization';
    verifier = await PilotLiveVerifier.initialize();
    await run('exact-pilot-auth-binding', () =>
      verifier.bindAuthUser('d2ee769c-0db8-4076-912f-89e06f6f694a'),
    );
    verifier.captureExistingPassword(current);
    current = undefined;
    await run('current-password-normal-login', () => verifier.loginWithExistingPassword());
    await run('active-jwt-and-role-isolation', () => verifier.activeChecks());
    await run('named-admin-zero-reset-preflight', () => verifier.resetPreflight());
    await mkdir(output, { recursive: true });
    // Durable non-secret write-ahead marker: any failed or interrupted run requires review.
    const lock = await open(marker, 'wx');
    await lock.writeFile(
      JSON.stringify({
        project: 'jyigxpjvygvtvcypujel',
        patientId: 'b9cb9ff4-0c77-4caa-b412-e5794b419f75',
        startedAt: new Date().toISOString(),
        authorization: 'one-controlled-reset',
        state: 'started-no-automatic-retry',
      }),
    );
    await lock.sync();
    await lock.close();
    await run('one-controlled-reset', () => verifier.resetExactlyOnce());
    await run('old-password-jwt-refresh-fencing', () => verifier.checkResetFencing());
    await run('new-temporary-pending-handover-denial', () => verifier.pendingProviderChecks());
    await run('private-reset-handover-and-replay-denial', () =>
      verifier.acknowledgeResetHandover(),
    );
    await run('patient-id-mandatory-first-change-denial', () => verifier.patientLogin());
    await run('operator-chosen-final-password-change', () =>
      verifier.changePasswordViaAuthorizedApi(replacement),
    );
    replacement = undefined;
    await run('final-active-jwt-and-role-isolation', () => verifier.activeChecks());
    await run('retired-jwt-still-denied-after-activation', () =>
      verifier.verifyRetiredSessionsAfterActivation(),
    );
    await run('fresh-final-password-login', () => verifier.freshLogin());
    await run('one-reset-and-clinical-preservation', () => verifier.resetPostflight());
    await verifier.saveEvidence();
    await writeFile(
      resultPath,
      JSON.stringify({ completed: true, checks, completedAt: new Date().toISOString() }, null, 2),
    );
    console.log(
      'Pilot API checks completed. Use your chosen final password in the browser. Broader rollout stays OFF.',
    );
  }
} catch (error) {
  // Never serialize an SDK error, request, response, password, token or private alias.
  const safeLocalReasons = new Set([
    'Debug logging must be disabled before private verification',
    'Migration drift',
    'Feature configuration drift',
    'Interactive operator input required',
    'A reset run already started; operator review required',
    'Operator attestation refused',
    'Step 1 requires exactly SRO0007, not a password. No Auth operation attempted.',
    'An operator-controlled interactive terminal is required.',
    'Operator cancelled private entry.',
    'New password must contain 10-128 characters, an uppercase letter and a number. No reset attempted.',
    'New password confirmation did not match. No reset attempted.',
    'Choose a new password different from the current password. No reset attempted.',
  ]);
  const safeReason = safeLocalReasons.has(error?.message)
    ? error.message
    : 'Private error details suppressed; review the stopped checkpoint.';
  await mkdir(output, { recursive: true });
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        completed: false,
        stoppedAt: phase,
        safeReason,
        checks,
        recovery:
          'STOP. Do not rerun or remove the reset marker. Review the exact pilot state before any further write.',
      },
      null,
      2,
    ),
  );
  console.error('STOP at ' + phase + '. Sanitized result saved; no automatic retry.');
  console.error(safeReason);
  process.exitCode = 1;
} finally {
  current = replacement = confirmation = undefined;
  await verifier?.saveEvidence();
  await verifier?.disposeAndForget();
}
