// Local preparation only. No network, .env loading, linking, seeding or deployment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const expected = [
  [
    '20261026024332_clinic_foundation.sql',
    'ac7ac330febc5ed3ff324677bf42a5bce9e0408e29f737aaa14e21ebe8e2a93e',
  ],
  [
    '20261026024335_clinic_access_policies.sql',
    '9f5f66f30540ff7fb5bb531f19979d6e9dc9d62ed6fbb6006be47a9039b4f546',
  ],
  [
    '20261026024338_clinic_transaction_commands.sql',
    'e50b0f0f0fbd0e1be545e841e4d207c604cf8ac5c2567fbbda8a2516baa26543',
  ],
];
const manifest = JSON.parse(await readFile('supabase/migration-manifest.json', 'utf8'));
assert.equal(manifest.projectRef, 'jyigxpjvygvtvcypujel');
assert.equal(manifest.remoteApplyApproved, false);
assert.deepEqual(
  manifest.candidateMigrations.map((m) => [m.file, m.sha256]),
  expected,
);
assert.deepEqual(
  (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort(),
  expected.map((e) => e[0]),
);
const bundle = path.resolve('artifacts/phase2a-deployment');
const destination = path.join(bundle, 'supabase', 'migrations');
await mkdir(destination, { recursive: true });
const results = [];
for (const [file, hash] of expected) {
  const bytes = await readFile('supabase/migrations/' + file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
  assert.ok(
    !/insert\s+into\s+auth\.users|sro_phase2a5_runner|disposable_fixture_reset/i.test(
      bytes.toString(),
    ),
    'Staging material in candidate',
  );
  await copyFile('supabase/migrations/' + file, path.join(destination, file));
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join(destination, file)))
      .digest('hex'),
    hash,
  );
  results.push({ file, sha256: hash });
}
assert.deepEqual(
  (await readdir(destination)).sort(),
  expected.map((e) => e[0]),
);
const configFile = path.join(bundle, 'supabase', 'config.toml');
try {
  let config = await readFile(configFile, 'utf8');
  assert.match(config, /major_version\s*=\s*17\b/, 'PostgreSQL 17 CLI configuration required');
  config = config.replace(/(\[db\.seed\][\s\S]*?enabled\s*=\s*)true/, '$1false');
  config = config.replace(/(\[db\.seed\][\s\S]*?sql_paths\s*=\s*)\[[^\]]*\]/, '$1[]');
  assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
  assert.match(config, /\[db\.seed\][\s\S]*?sql_paths\s*=\s*\[\]/);
  await writeFile(configFile, config);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const allSql = (await readdir(path.join(bundle, 'supabase'))).filter((f) => f.endsWith('.sql'));
assert.deepEqual(allSql, [], 'No seed/role/reset SQL allowed in deployment bundle root');
await writeFile(
  path.join(bundle, 'approved-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
await writeFile(
  'artifacts/phase2a-preflight/deployment-bundle.json',
  JSON.stringify(
    {
      projectRef: manifest.projectRef,
      bundle,
      candidates: results,
      remoteExecutionPerformed: false,
      seedIncluded: false,
      rolesIncluded: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ bundle, candidatesVerified: results.length, remoteExecutionPerformed: false }),
);
