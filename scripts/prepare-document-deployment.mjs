// Local artifacts only. No linking, schema changes, fixtures, bucket creation or remote apply.
import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const foundation = JSON.parse(await readFile('supabase/migration-manifest.json', 'utf8'));
const auth = JSON.parse(await readFile('supabase/proposals/phase2b/manifest.json', 'utf8'));
const workspace = JSON.parse(await readFile('supabase/proposals/phase2c/manifest.json', 'utf8'));
const documents = JSON.parse(await readFile('supabase/proposals/documents/manifest.json', 'utf8'));
for (const manifest of [foundation, auth, workspace, documents])
  assert.equal(manifest.projectRef, 'jyigxpjvygvtvcypujel');
const files = [
  ...foundation.candidateMigrations.map((m) => ({ ...m, source: `supabase/migrations/${m.file}` })),
  ...[
    ['phase2b', auth],
    ['phase2c', workspace],
    ['documents', documents],
  ].map(([folder, m]) => ({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  })),
];
const directory = 'artifacts/document-deployment/supabase/migrations';
await mkdir(directory, { recursive: true });
for (const file of files) {
  const bytes = await readFile(file.source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
  await copyFile(file.source, path.join(directory, file.file));
}
assert.deepEqual((await readdir(directory)).sort(), files.map((f) => f.file).sort());
const config = await readFile('artifacts/phase2c-deployment/supabase/config.toml', 'utf8');
assert.match(config, /major_version\s*=\s*17\b/);
assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
assert.match(config, /sql_paths\s*=\s*\[\]/);
await writeFile('artifacts/document-deployment/supabase/config.toml', config);
await writeFile(
  'artifacts/document-deployment/manifest.json',
  JSON.stringify(documents, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    filesVerified: files.length,
    candidate: documents.candidate,
    sha256: documents.sha256,
    remoteExecution: false,
  }),
);
