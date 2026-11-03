// Minimal live Auth smoke. Never sends email, changes passwords or grants roles.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac('sha1', key).update(time).digest();
  const offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const require = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = require('@supabase/supabase-js');
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
const account = JSON.parse(
  await readFile(
    path.join(
      process.env.USERPROFILE,
      '.codex',
      'secrets',
      'sro-clinic',
      ref,
      'phase2b-demo-admin.json',
    ),
    'utf8',
  ),
);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const publicClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data, error } = await admin.auth.admin.getUserById(account.userId);
assert.equal(error, null, 'Demo Auth lookup failed');
const login = await publicClient.auth.signInWithPassword({
  email: account.email,
  password: account.password,
});
if (!data.user.email_confirmed_at) {
  assert.equal(login.error?.code, 'email_not_confirmed');
  console.log(
    JSON.stringify({
      projectRef: ref,
      emailVerified: false,
      unverifiedPasswordLoginDenied: true,
      realPositiveSessionTests: 'pending human verification',
    }),
  );
} else {
  assert.equal(login.error, null, 'Verified demo login failed');
  assert.ok(login.data.session);
  const jwt = login.data.session.access_token;
  assert.equal((await publicClient.auth.getUser()).data.user?.id, account.userId);
  assert.equal((await publicClient.auth.refreshSession()).error, null);
  let totpPassed = false;
  const listed = await publicClient.auth.mfa.listFactors();
  assert.equal(listed.error, null, 'MFA listing failed');
  if (!listed.data.totp.some((f) => f.status === 'verified')) {
    const enrolled = await publicClient.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Temporary Phase 2B validation',
    });
    assert.equal(enrolled.error, null, 'MFA enrollment failed');
    const factorId = enrolled.data.id;
    try {
      const verify = await publicClient.auth.mfa.challengeAndVerify({
        factorId,
        code: totp(enrolled.data.totp.secret),
      });
      assert.equal(verify.error, null, 'MFA verification failed');
      assert.equal(
        (await publicClient.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel,
        'aal2',
      );
      const second = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      assert.equal(
        (await second.auth.signInWithPassword({ email: account.email, password: account.password }))
          .error,
        null,
      );
      const assurance = (await second.auth.mfa.getAuthenticatorAssuranceLevel()).data;
      assert.equal(assurance.currentLevel, 'aal1');
      assert.equal(assurance.nextLevel, 'aal2');
      totpPassed = true;
    } finally {
      assert.equal(
        (await publicClient.auth.mfa.unenroll({ factorId })).error,
        null,
        'Temporary MFA factor cleanup failed',
      );
    }
  }
  assert.equal((await publicClient.auth.signOut({ scope: 'global' })).error, null);
  const observer = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  assert.ok(
    (await observer.auth.refreshSession({ refresh_token: login.data.session.refresh_token })).error,
    'Logged-out refresh token unexpectedly accepted',
  );
  console.log(
    JSON.stringify({
      projectRef: ref,
      emailVerified: true,
      passwordLoginPassed: true,
      sessionRefreshPassed: true,
      totpEnrollmentVerificationAndAalStepUpPassed: totpPassed,
      temporaryTotpFactorRemoved: totpPassed,
      globalLogoutPassed: true,
      refreshTokenReuseDenied: true,
      accessJwtExpiresAt: new Date(
        JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000,
      ).toISOString(),
      note: 'Previously issued access JWTs can remain valid until expiry; clinic role/provisioning checks still apply.',
    }),
  );
}
