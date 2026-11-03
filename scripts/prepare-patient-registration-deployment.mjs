// Local immutable bundle preparation only. No remote execution or credentials.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = 'supabase/proposals/patient-registration',
  candidate = '20261027155325_clinic_patient_registration_timestamp.sql',
  projectRef = 'jyigxpjvygvtvcypujel';
const json = async (f) => JSON.parse(await readFile(f, 'utf8'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
try {
  assert.notEqual(
    (await json(`${root}/manifest.json`)).remoteApplied,
    true,
    'Already deployed; preserve approved evidence.',
  );
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const base = await json('supabase/migration-manifest.json');
assert.equal(base.projectRef, projectRef);
const files = base.candidateMigrations.map((m) => ({
  ...m,
  source: `supabase/migrations/${m.file}`,
}));
for (const folder of [
  'phase2b',
  'phase2c',
  'profiles',
  'patient-ids',
  'patient-age',
  'walk-in',
  'staff-booking',
]) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, projectRef);
  assert.equal(m.remoteApplied, true);
  files.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  });
}
const manifest = {
  projectRef,
  candidate,
  sha256: hash(await readFile(`${root}/${candidate}`)),
  remoteApplyApproved: false,
  remoteApplied: false,
  dependsOnVersions: files.map((f) => f.file.split('_')[0]),
  newColumn: 'public.patients.registered_at',
  newPrivateInvokerTrigger: 'clinic_private.patient_registration_guard()',
  newPublicRpcs: [],
  rlsPolicyChanges: 0,
  authChanges: false,
  missingHistoricalEvidence: 'NULL',
  historicalSources: ['registration audit event', 'staff intake creation timestamp'],
  seedIncluded: false,
  rolesFileIncluded: false,
};
files.push({ file: candidate, sha256: manifest.sha256, source: `${root}/${candidate}` });
const bundle = 'artifacts/patient-registration-deployment',
  directory = `${bundle}/supabase/migrations`;
await mkdir(directory, { recursive: true });
for (const f of files) {
  assert.equal(hash(await readFile(f.source)), f.sha256, f.file);
  await copyFile(f.source, `${directory}/${f.file}`);
}
assert.deepEqual((await readdir(directory)).sort(), files.map((f) => f.file).sort());
await copyFile(
  'artifacts/staff-booking-deployment/supabase/config.toml',
  `${bundle}/supabase/config.toml`,
);
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(`${bundle}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({
    verifiedFiles: files.length,
    pending: { candidate, sha256: manifest.sha256 },
    remoteExecution: false,
  }),
);
