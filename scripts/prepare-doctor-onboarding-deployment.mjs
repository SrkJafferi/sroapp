import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = 'supabase/proposals/doctor-onboarding',
  bundle = 'artifacts/doctor-onboarding-deployment',
  candidate = '20261027210515_clinic_doctor_onboarding_preview.sql';
const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  sha = (b) => createHash('sha256').update(b).digest('hex');
const b = await json('supabase/migration-manifest.json'),
  files = b.candidateMigrations.map((m) => ({ ...m, source: 'supabase/migrations/' + m.file }));
for (const f of [
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
]) {
  const m = await json(`supabase/proposals/${f}/manifest.json`);
  assert.equal(m.projectRef, 'jyigxpjvygvtvcypujel');
  if (f === 'department-edit') {
    // Observed remotely during this task: version exists and prosrc MD5 matches the local candidate.
    assert.equal(m.sha256, '7afafe7b2fedcd144dcd84ca105c5cff0ee94bd7b2deff52d1e23a37ede8dd92');
  } else assert.equal(m.remoteApplied, true);
  files.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${f}/${m.candidate}`,
  });
}
await mkdir(`${bundle}/supabase/migrations`, { recursive: true });
for (const f of files) {
  assert.equal(sha(await readFile(f.source)), f.sha256);
  await copyFile(f.source, `${bundle}/supabase/migrations/${f.file}`);
}
await copyFile(`${root}/${candidate}`, `${bundle}/supabase/migrations/${candidate}`);
assert.deepEqual(
  (await readdir(`${bundle}/supabase/migrations`)).sort(),
  [...files.map((f) => f.file), candidate].sort(),
);
await copyFile(
  'artifacts/doctor-profile-deployment/supabase/config.toml',
  `${bundle}/supabase/config.toml`,
);
const manifest = {
  projectRef: b.projectRef,
  candidate,
  sha256: sha(await readFile(`${root}/${candidate}`)),
  remoteApplyApproved: false,
  remoteApplied: false,
  dependsOnVersions: files.map((f) => f.file.split('_')[0]),
  newPublicRpc: 'phase2b_invitation_preview(uuid,bytea,uuid)',
  executeRole: 'service_role only',
  newTables: [],
  rlsChanges: 0,
  seeds: [],
  roles: [],
  observedExistingMigration: {version:'20261027170222',sourceMd5:'ca42929ed9900c8ffd12ac838e46ab45',appliedByThisTask:false},
};
for (const d of [root, bundle])
  await writeFile(`${d}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
