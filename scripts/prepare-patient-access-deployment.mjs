import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const projectRef = 'jyigxpjvygvtvcypujel';
const source = 'supabase/proposals/patient-access';
const bundle = 'artifacts/patient-access-deployment';
const candidate = '20261029182220_clinic_patient_account_access.sql';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (data) => createHash('sha256').update(data).digest('hex');
try {
  assert.notEqual(
    (await json(`${source}/manifest.json`)).remoteApplied,
    true,
    'Already deployed: preserve migration-only approval and deployment evidence.',
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const base = await json('supabase/migration-manifest.json');
assert.equal(base.projectRef, projectRef);
const prior = base.candidateMigrations.map((f) => ({
  ...f,
  source: 'supabase/migrations/' + f.file,
}));
for (const folder of [
  'phase2b',
  'phase2c',
  'profiles',
  'patient-ids',
  'patient-age',
  'walk-in',
  'staff-booking',
  'patient-registration',
  'doctor-profile',
  'department-edit',
  'doctor-onboarding',
  'single-email-onboarding',
  'invitation-management',
  'incomplete-onboarding-recovery',
]) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, projectRef);
  prior.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  });
}
assert.equal(prior.length, 17);
await mkdir(`${bundle}/supabase/migrations`, { recursive: true });
for (const file of prior) {
  assert.equal(sha(await readFile(file.source)), file.sha256);
  await copyFile(file.source, `${bundle}/supabase/migrations/${file.file}`);
}
await copyFile(`${source}/${candidate}`, `${bundle}/supabase/migrations/${candidate}`);
assert.deepEqual(
  (await readdir(`${bundle}/supabase/migrations`)).sort(),
  [...prior.map((f) => f.file), candidate].sort(),
);
await writeFile(
  bundle + '/supabase/config.toml',
  `# Isolated candidate only. No seeds, roles or Vault configuration.
project_id = "patient-access-deployment"
[db]
major_version = 17
[db.seed]
enabled = false
sql_paths = []
`,
);
const manifest = {
  projectRef,
  candidate,
  sha256: sha(await readFile(`${source}/${candidate}`)),
  remoteApplyApproved: false,
  remoteApplied: false,
  dependsOnVersions: prior.map((f) => f.file.split('_')[0]),
  historicalFiles: prior.map(({ file, sha256 }) => ({ file, sha256 })),
  historicalRemoteVersionsReadOnlyVerified: true,
  privateTables: ['clinic_private.patient_accounts'],
  replacedFunctions: ['clinic_private.phase2b_assurance', 'public.get_clinic_profile'],
  changedConstraints: ['public.profiles.profiles_email_check'],
  newServiceOnlyFunctions: ['public.patient_account_command', 'public.patient_login_limit'],
  authConfigurationChanges: 0,
  authAccountChangesExecuted: 0,
  applicationFeatureEnabled: false,
  seeds: [],
  roles: [],
  controls: [
    'server-only Auth admin operations',
    'patient row locking and unique identity/operation constraints',
    'Doctor initial own recent intake only',
    'Admin-only reset with in-person verification attestation',
    'pending-handover and first-change clinical RLS gate',
    'Auth session_id and session epoch checks',
    'no password storage; ephemeral one-time handover only',
    'quarantine incomplete provider writes; no unsafe concurrent retry',
    'internal reserved .invalid aliases never represent contact ownership',
    'no mass provisioning; SRO0007/SRO0008 reviewed individually after approval',
  ],
};
for (const root of [source, bundle])
  await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({
    verifiedFiles: prior.length + 1,
    pending: candidate,
    sha256: manifest.sha256,
    remoteExecution: false,
  }),
);
