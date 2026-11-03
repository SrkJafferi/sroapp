// Local-only literal-secret check. Never prints values or matching source fragments.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
const ref = 'jyigxpjvygvtvcypujel';
const web = parseEnv(await readFile('apps/web/.env.local', 'utf8'));
const mobile = parseEnv(await readFile('apps/mobile/.env.local', 'utf8'));
const mobileNames = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
assert.deepEqual(Object.keys(mobile).sort(), mobileNames.sort());
assert.ok(mobileNames.every((name) => mobile[name]?.trim()));
assert.equal(new URL(web.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
const privileged = Object.entries(web).filter(([name]) =>
  /SERVICE_ROLE|SECRET_KEY|RESEND_API_KEY/.test(name),
);
assert.ok(
  privileged.every(([name, value]) => !/^NEXT_PUBLIC_|^EXPO_PUBLIC_/.test(name) && value.trim()),
);
const vault = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const operator = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const configured = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
);
const secrets = [
  ...privileged.map(([, value]) => value),
  operator.password,
  ...configured.accounts.map((a) => a.password),
].filter(Boolean);
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
const assets = await files('apps/web/.next/static');
let matches = 0;
for (const file of assets) {
  const content = await readFile(file);
  for (const value of secrets) if (content.includes(Buffer.from(value))) matches++;
}
assert.equal(matches, 0, 'Private values detected in generated browser assets');
const report = {
  projectRef: ref,
  assetsScanned: assets.length,
  privateValuesChecked: secrets.length,
  matches,
  mobileOnlyPublicVariables: true,
  privilegedWebNamesUnprefixed: true,
  completedAt: new Date().toISOString(),
};
await writeFile(
  'artifacts/phase2c-validation/client-boundaries.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
