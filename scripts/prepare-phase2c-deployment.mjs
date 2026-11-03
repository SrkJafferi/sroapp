// Local bundle only. No connection, application, reset, seed or credential operations.
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const a = JSON.parse(await readFile('supabase/migration-manifest.json', 'utf8'));
const b = JSON.parse(await readFile('supabase/proposals/phase2b/manifest.json', 'utf8'));
const c = JSON.parse(await readFile('supabase/proposals/phase2c/manifest.json', 'utf8'));
assert.equal(c.projectRef, 'jyigxpjvygvtvcypujel');
assert.equal(a.projectRef, c.projectRef);
assert.equal(b.projectRef, c.projectRef);
const files = [
  ...a.candidateMigrations.map((m) => ({ ...m, source: 'supabase/migrations/' + m.file })),
  { file: b.candidate, sha256: b.sha256, source: 'supabase/proposals/phase2b/' + b.candidate },
  { file: c.candidate, sha256: c.sha256, source: 'supabase/proposals/phase2c/' + c.candidate },
];
const bundle = path.resolve('artifacts/phase2c-deployment');
const destination = path.join(bundle, 'supabase', 'migrations');
await mkdir(destination, { recursive: true });
for (const f of files) {
  const bytes = await readFile(f.source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256, f.file);
  await copyFile(f.source, path.join(destination, f.file));
}
assert.deepEqual((await readdir(destination)).sort(), files.map((f) => f.file).sort());
const config = await readFile('artifacts/phase2b-deployment/supabase/config.toml', 'utf8');
assert.match(config, /major_version\s*=\s*17\b/);
assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
assert.match(config, /\[db\.seed\][\s\S]*?sql_paths\s*=\s*\[\]/);
await writeFile(path.join(bundle, 'supabase', 'config.toml'), config);
await writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(c, null, 2) + '\n');
console.log(
  JSON.stringify({
    bundle,
    filesVerified: files.length,
    candidateMigration: c.candidate,
    remoteExecution: false,
  }),
);
