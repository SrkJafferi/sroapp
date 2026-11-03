// Builds a strictly isolated local bundle. Does not link or execute remote SQL.
import { readFile, writeFile, copyFile, mkdir, readdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = 'supabase/proposals/patient-ids';
const candidate = '20261026195847_clinic_patient_numbers.sql';
const projectRef = 'jyigxpjvygvtvcypujel';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [core, phase2b, phase2c, profiles, documents] = await Promise.all(
  [
    'supabase/migration-manifest.json',
    'supabase/proposals/phase2b/manifest.json',
    'supabase/proposals/phase2c/manifest.json',
    'supabase/proposals/profiles/manifest.json',
    'supabase/proposals/documents/manifest.json',
  ].map(readJson),
);
for (const manifest of [core, phase2b, phase2c, profiles, documents])
  assert.equal(manifest.projectRef, projectRef);
for (const manifest of [phase2b, phase2c, profiles]) assert.equal(manifest.remoteApplied, true);
assert.equal(documents.remoteApplied, false);
const baseline = [
  ...core.candidateMigrations.map((m) => ({
    ...m,
    source: `supabase/migrations/${m.file}`,
  })),
  ...[
    ['phase2b', phase2b],
    ['phase2c', phase2c],
    ['profiles', profiles],
  ].map(([folder, manifest]) => ({
    file: manifest.candidate,
    sha256: manifest.sha256,
    source: `supabase/proposals/${folder}/${manifest.candidate}`,
  })),
];
assert.equal(baseline.length, 6);
assert.equal(new Set(baseline.map((f) => f.file.split('_')[0])).size, 6);
const candidateBytes = await readFile(`${root}/${candidate}`);
const manifest = {
  projectRef,
  remoteApplyApproved: false,
  remoteApplied: false,
  candidate,
  sha256: hash(candidateBytes),
  dependsOnVersions: baseline.map((f) => f.file.split('_')[0]),
  newColumns: ['public.patients.patient_number', 'public.patients.patient_code'],
  newPrivateTables: ['clinic_private.patient_number_counter'],
  newTriggers: ['patient_number_allocate', 'patient_number_immutable'],
  newPrivateFunctions: ['clinic_private.patient_number_guard()'],
  newPublicRpcs: 0,
  changedExistingPolicies: 0,
  changedExistingMigrations: 0,
  existingClinicalRecordsModified: false,
  backfill: 'Pinned Amina Noor baseline receives SRO0001; registration counter starts at 1',
  seedIncluded: false,
  rolesFileIncluded: false,
  medicalDocumentProposalIncluded: false,
};
const files = [
  ...baseline,
  { file: candidate, sha256: manifest.sha256, source: `${root}/${candidate}` },
];
const directory = 'artifacts/patient-id-deployment/supabase/migrations';
await mkdir(directory, { recursive: true });
for (const file of files) {
  const bytes = await readFile(file.source);
  assert.equal(hash(bytes), file.sha256, file.file);
  await copyFile(file.source, path.join(directory, file.file));
}
assert.deepEqual((await readdir(directory)).sort(), files.map((f) => f.file).sort());
const config = await readFile('artifacts/profile-deployment/supabase/config.toml', 'utf8');
assert.match(config, /major_version\s*=\s*17\b/);
assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
assert.match(config, /sql_paths\s*=\s*\[\]/);
await writeFile('artifacts/patient-id-deployment/supabase/config.toml', config);
const linked = await readFile('artifacts/profile-deployment/supabase/.temp/linked-project.json');
assert.equal(JSON.parse(linked).ref, projectRef);
await cp('artifacts/profile-deployment/supabase/.temp', 'artifacts/patient-id-deployment/supabase/.temp', {
  recursive: true,
});
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  'artifacts/patient-id-deployment/manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    verifiedFiles: files.length,
    candidate,
    sha256: manifest.sha256,
    remoteExecution: false,
  }),
);
