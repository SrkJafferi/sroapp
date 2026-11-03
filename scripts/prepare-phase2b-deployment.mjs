// Local-only closed deployment bundle. This script never connects/applies/bootstrap-provisions.
import { readFile, mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const phase2a = JSON.parse(await readFile('supabase/migration-manifest.json', 'utf8'));
const proposal = JSON.parse(await readFile('supabase/proposals/phase2b/manifest.json', 'utf8'));
assert.equal(proposal.projectRef, 'jyigxpjvygvtvcypujel');
assert.equal(phase2a.projectRef, proposal.projectRef);
const bundle = path.resolve('artifacts/phase2b-deployment');
const migrations = path.join(bundle, 'supabase', 'migrations');
await mkdir(migrations, { recursive: true });
const files = [
  ...phase2a.candidateMigrations.map((m) => ({ ...m, source: 'supabase/migrations/' + m.file })),
  {
    file: proposal.candidate,
    sha256: proposal.sha256,
    source: 'supabase/proposals/phase2b/' + proposal.candidate,
  },
];
for (const f of files) {
  const bytes = await readFile(f.source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256);
  await copyFile(f.source, path.join(migrations, f.file));
}
assert.deepEqual((await readdir(migrations)).sort(), files.map((f) => f.file).sort());
const config = await readFile('artifacts/phase2a-deployment/supabase/config.toml', 'utf8');
assert.match(config, /major_version\s*=\s*17\b/);
assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
assert.match(config, /\[db\.seed\][\s\S]*?sql_paths\s*=\s*\[\]/);
await writeFile(path.join(bundle, 'supabase', 'config.toml'), config);
await writeFile(
  path.join(bundle, 'proposal-manifest.json'),
  JSON.stringify(proposal, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    bundle,
    hashesVerified: files.length,
    pendingCandidate: proposal.candidate,
    remoteApplyPerformed: false,
  }),
);
