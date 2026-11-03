import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const projectRef = 'jyigxpjvygvtvcypujel';
const source = 'supabase/proposals/incomplete-onboarding-recovery';
const bundle = 'artifacts/incomplete-onboarding-recovery-deployment';
const candidate = '20261028131406_clinic_incomplete_onboarding_recovery.sql';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (data) => createHash('sha256').update(data).digest('hex');
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
]) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, projectRef);
  prior.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  });
}
assert.equal(prior.length, 16);
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
await copyFile(
  'artifacts/invitation-management-deployment/supabase/config.toml',
  `${bundle}/supabase/config.toml`,
);
const manifest = {
  projectRef,
  candidate,
  sha256: sha(await readFile(`${source}/${candidate}`)),
  remoteApplyApproved: false,
  remoteApplied: false,
  reason:
    'prepare() must report database-proven eligibility for a legacy unverified app-created Auth identity so the server route can confirm/set its password without a second verification email.',
  dependsOnVersions: prior.map((f) => f.file.split('_')[0]),
  privateTables: [],
  publicColumns: [],
  newServiceOnlyFunctions: [],
  replacedFunctions: ['phase2b_onboarding'],
  authConfigurationChanges: 0,
  seeds: [],
  roles: [],
  controls: [
    'database never mutates auth.users',
    'verified or previously signed-in identities are never eligible',
    'any profile/doctor/role/membership/branch membership or verified MFA denies',
    'eligibility requires the sole email identity marked demo_only inside a delivered historical invitation window with matching name and unconsumed/after-creation secret',
    'current invitation hash, sent status, expiry and inviter authority are revalidated under lock',
    'service_role-only EXECUTE with empty search_path',
  ],
};
for (const root of [source, bundle])
  await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
