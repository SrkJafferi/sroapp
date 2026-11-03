// Test tooling only: reads credentials from owner-restricted storage outside webroot.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function loadStagingCredentials() {
  const config = JSON.parse(await readFile('artifacts/phase2a5/staging-private.json', 'utf8'));
  assert.equal(config.projectRef, 'ibulqvolmfouvkqczqhs');
  assert.equal(config.url, 'https://ibulqvolmfouvkqczqhs.supabase.co');
  assert.ok(
    config.schemaVersion === 2 && !Object.hasOwn(config, 'password'),
    'Legacy shared staging credentials are forbidden',
  );
  const expected = path.join(
    process.env.USERPROFILE,
    '.codex',
    'secrets',
    'sro-clinic',
    config.projectRef,
    'auth-users.json',
  );
  const actual = await realpath(config.authCredentialsFile);
  assert.ok(actual.toLowerCase() === expected.toLowerCase(), 'Unexpected staging credential file');
  const vault = JSON.parse(await readFile(actual, 'utf8'));
  assert.ok(
    vault.projectRef === config.projectRef && vault.users.length === 13,
    'Unexpected staging credential scope',
  );
  assert.ok(
    !Object.hasOwn(vault, 'legacySharedPassword'),
    'Remediation must be finalized before test tooling is reused',
  );
  assert.ok(
    new Set(vault.users.map((user) => user.password)).size === 13,
    'Unique per-user credentials required',
  );
  return {
    projectRef: config.projectRef,
    url: config.url,
    publishableKey: config.publishableKey,
    passwordForUser(number) {
      const user = vault.users.find((entry) => entry.number === number);
      assert.ok(
        user?.state === 'complete' && typeof user.password === 'string',
        'Missing rotated test credential',
      );
      return user.password;
    },
  };
}
