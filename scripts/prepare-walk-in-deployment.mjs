// Local bundle only. No remote migrations, seeds, fixture accounts or configuration mutations.
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const projectRef = 'jyigxpjvygvtvcypujel',
  candidate = '20261027093051_clinic_walk_in_registration.sql',
  root = 'supabase/proposals/walk-in';
const json = async (file) => JSON.parse(await readFile(file, 'utf8')),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const core = await json('supabase/migration-manifest.json');
assert.equal(core.projectRef, projectRef);
const baseline = core.candidateMigrations.map((m) => ({
  ...m,
  source: `supabase/migrations/${m.file}`,
}));
for (const folder of ['phase2b', 'phase2c', 'profiles', 'patient-ids']) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, projectRef);
  assert.equal(m.remoteApplied, true);
  baseline.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  });
}
const age = await json('supabase/proposals/patient-age/manifest.json');
assert.equal(age.projectRef, projectRef);
assert.equal(age.remoteApplied, false);
assert.equal(age.sha256, '7e9091c2657b33acaa99009dab0186c9745e7769505ba3bb5c7fcac89bf52aca');
const ageFile = {
  file: age.candidate,
  sha256: age.sha256,
  source: `supabase/proposals/patient-age/${age.candidate}`,
};
const bytes = await readFile(`${root}/${candidate}`);
const manifest = {
  projectRef,
  remoteApplyApproved: false,
  remoteApplied: false,
  candidate,
  sha256: hash(bytes),
  dependsOnVersions: [...baseline.map((f) => f.file.split('_')[0]), age.candidate.split('_')[0]],
  requiredPendingMigration: ageFile,
  newPrivateTables: ['clinic_private.patient_intakes'],
  newPublicAuthenticatedInvokerRpcs: ['register_walk_in_patient', 'staff_patient_intakes'],
  newPatientDemographicPolicy: 'patient_intake_demographics',
  replacedBookingHelper: 'clinic_private.can_book(uuid,uuid,uuid,uuid,public.appointment_source)',
  newSignupReviewTrigger: 'walk_in_portal_signup_review',
  intakeHours: 24,
  clinicalAccessPolicyChanges: 0,
  authUsersCreated: false,
  emailVerificationDisabled: false,
  seedIncluded: false,
  rolesFileIncluded: false,
  medicalDocumentProposalIncluded: false,
};
const files = [
  ...baseline,
  ageFile,
  { file: candidate, sha256: manifest.sha256, source: `${root}/${candidate}` },
];
assert.equal(files.length, 9);
const directory = 'artifacts/walk-in-deployment/supabase/migrations';
await mkdir(directory, { recursive: true });
for (const file of files) {
  const b = await readFile(file.source);
  assert.equal(hash(b), file.sha256, file.file);
  await copyFile(file.source, path.join(directory, file.file));
}
assert.deepEqual((await readdir(directory)).sort(), files.map((f) => f.file).sort());
const config = await readFile('artifacts/patient-age-deployment/supabase/config.toml', 'utf8');
assert.match(config, /major_version\s*=\s*17\b/);
assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
assert.match(config, /sql_paths\s*=\s*\[\]/);
await writeFile('artifacts/walk-in-deployment/supabase/config.toml', config);
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  'artifacts/walk-in-deployment/manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    verifiedFiles: 9,
    pending: [
      { file: ageFile.file, sha256: ageFile.sha256 },
      { file: candidate, sha256: manifest.sha256 },
    ],
    remoteExecution: false,
  }),
);
