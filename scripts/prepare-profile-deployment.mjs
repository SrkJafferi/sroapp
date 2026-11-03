// Builds a strictly isolated local bundle. Does not link or execute remote SQL.
import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = 'supabase/proposals/profiles';
const candidate = '20261026192535_clinic_profiles_avatars.sql';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifests = await Promise.all(
  [
    'supabase/migration-manifest.json',
    'supabase/proposals/phase2b/manifest.json',
    'supabase/proposals/phase2c/manifest.json',
  ].map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
for (const m of manifests) assert.equal(m.projectRef, 'jyigxpjvygvtvcypujel');
const baseline = [
  ...manifests[0].candidateMigrations.map((m) => ({
    ...m,
    source: `supabase/migrations/${m.file}`,
  })),
  ...['phase2b', 'phase2c'].map((folder, i) => ({
    file: manifests[i + 1].candidate,
    sha256: manifests[i + 1].sha256,
    source: `supabase/proposals/${folder}/${manifests[i + 1].candidate}`,
  })),
];
const candidateBytes = await readFile(`${root}/${candidate}`);
const manifest = {
  projectRef: 'jyigxpjvygvtvcypujel',
  remoteApplyApproved: false,
  remoteApplied: false,
  candidate,
  sha256: hash(candidateBytes),
  dependsOnVersions: baseline.map((f) => f.file.split('_')[0]),
  newPrivateBucket: 'clinic-profile-avatars',
  newPrivateTables: ['clinic_private.profile_avatars'],
  newAuthenticatedInvokerRpcs: [
    'get_clinic_profile',
    'save_clinic_profile',
    'begin_profile_avatar',
    'discard_profile_avatar',
    'get_profile_assets',
    'get_profile_avatar_object',
  ],
  newServiceOnlyInvokerRpc: 'attest_profile_avatar',
  changedExistingPolicies: 0,
  storagePolicies: 8,
  seedIncluded: false,
  rolesFileIncluded: false,
  medicalDocumentProposalIncluded: false,
};
const files = [
  ...baseline,
  { file: candidate, sha256: manifest.sha256, source: `${root}/${candidate}` },
];
const directory = 'artifacts/profile-deployment/supabase/migrations';
await mkdir(directory, { recursive: true });
for (const file of files) {
  const bytes = await readFile(file.source);
  assert.equal(hash(bytes), file.sha256, file.file);
  await copyFile(file.source, path.join(directory, file.file));
}
assert.deepEqual((await readdir(directory)).sort(), files.map((f) => f.file).sort());
const config = await readFile('artifacts/phase2c-deployment/supabase/config.toml', 'utf8');
assert.match(config, /major_version\s*=\s*17\b/);
assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
assert.match(config, /sql_paths\s*=\s*\[\]/);
await writeFile('artifacts/profile-deployment/supabase/config.toml', config);
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  'artifacts/profile-deployment/manifest.json',
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
