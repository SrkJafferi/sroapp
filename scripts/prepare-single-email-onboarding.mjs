import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const projectRef = 'jyigxpjvygvtvcypujel';
const source = 'supabase/proposals/single-email-onboarding';
const bundle = 'artifacts/single-email-onboarding-deployment';
const candidate = '20261028103401_clinic_single_email_onboarding.sql';
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
]) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, projectRef);
  prior.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  });
}
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
  'artifacts/doctor-onboarding-deployment/supabase/config.toml',
  `${bundle}/supabase/config.toml`,
);
const manifest = {
  projectRef,
  candidate,
  sha256: sha(await readFile(`${source}/${candidate}`)),
  remoteApplyApproved: false,
  remoteApplied: false,
  dependsOnVersions: prior.map((f) => f.file.split('_')[0]),
  privateTables: ['clinic_private.doctor_onboarding'],
  publicColumns: ['notifications.doctor_id', 'notifications.branch_id'],
  newServiceOnlyFunctions: ['phase2b_onboarding', 'phase2b_welcome_delivery'],
  replacedFunctions: ['phase2b_invitation_preview'],
  restrictivePolicies: ['onboarding_notification_scope'],
  authConfigurationChanges: 0,
  seeds: [],
  roles: [],
};
for (const root of [source, bundle])
  await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
