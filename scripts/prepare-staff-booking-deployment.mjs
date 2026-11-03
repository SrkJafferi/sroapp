// Local preparation only. Never applies SQL, changes credentials or writes remote records.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = 'supabase/proposals/staff-booking';
const candidate = '20261027105809_clinic_staff_booking_profiles.sql';
const projectRef = 'jyigxpjvygvtvcypujel';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
try {
  const existing = await json(`${root}/manifest.json`);
  assert.notEqual(
    existing.remoteApplied,
    true,
    'Already deployed; preserve the approved manifest and reuse its evidence.',
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
for (const folder of ['phase2b', 'phase2c', 'profiles', 'patient-ids', 'patient-age', 'walk-in']) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, projectRef);
  assert.equal(m.remoteApplied, true);
  files.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  });
}
const bytes = await readFile(`${root}/${candidate}`);
const manifest = {
  projectRef,
  candidate,
  sha256: hash(bytes),
  remoteApplyApproved: false,
  remoteApplied: false,
  dependsOnVersions: files.map((f) => f.file.split('_')[0]),
  replacedPrivateFunctions: ['read_profile', 'save_profile', 'book_appointment'],
  newTables: [],
  newPublicRpcs: [],
  rlsPolicyChanges: 0,
  dataBackfill: false,
  oldPendingAppointmentsChanged: false,
  seedIncluded: false,
  rolesFileIncluded: false,
};
files.push({ file: candidate, sha256: manifest.sha256, source: `${root}/${candidate}` });
const bundle = 'artifacts/staff-booking-deployment';
const directory = `${bundle}/supabase/migrations`;
await mkdir(directory, { recursive: true });
for (const f of files) {
  assert.equal(hash(await readFile(f.source)), f.sha256, f.file);
  await copyFile(f.source, `${directory}/${f.file}`);
}
assert.deepEqual((await readdir(directory)).sort(), files.map((f) => f.file).sort());
await copyFile(
  'artifacts/walk-in-deployment/supabase/config.toml',
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
