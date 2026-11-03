// Operator-only provisioning. No public bootstrap endpoint, password arguments or secret output.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = require('@supabase/supabase-js');
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, 'Server provisioning key required');
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const mode = process.argv[2];
const vaultDir = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const vaultFile = path.join(vaultDir, 'phase2b-demo-admin.json');
async function vault() {
  return JSON.parse(await readFile(vaultFile, 'utf8'));
}
async function command(name, args) {
  const r = await client.rpc(name, args);
  if (r.error)
    throw new Error(
      `Provisioning refused (${r.error.code}); check migration approval and account verification.`,
    );
  return r.data;
}
async function run() {
  if (mode === 'prepare') {
    const email = process.argv[3];
    assert.ok(
      email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email),
      'Operator-controlled verification inbox required',
    );
    try {
      await readFile(vaultFile);
      throw new Error(
        'Private Admin configuration already exists. Use status; do not create another account.',
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await mkdir(vaultDir, { recursive: true });
    assert.equal(
      process.platform,
      'win32',
      'Private Windows ACL setup is required on this operator machine',
    );
    const owner = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    execFileSync(
      'icacls',
      [vaultDir, '/inheritance:r', '/grant:r', `${owner}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'],
      { stdio: 'pipe' },
    );
    const password = `Sro!${randomBytes(32).toString('base64url')}`;
    const origin = new URL(process.env.SRO_APP_URL ?? 'http://localhost:3100').origin;
    assert.ok(
      origin.startsWith('https:') || new URL(origin).hostname === 'localhost',
      'Safe application origin required',
    );
    // Save the generated password BEFORE account creation, outside the repository/webroot.
    const record = {
      projectRef: ref,
      email,
      password,
      name: 'SRO Demo Administrator',
      demoOnly: true,
      createdAt: new Date().toISOString(),
      userId: null,
      verificationSent: false,
    };
    await writeFile(vaultFile, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const result = await client.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: { data: { name: record.name, demo_only: true } },
    });
    if (result.error || !result.data.properties?.hashed_token)
      throw new Error(
        'Admin signup preparation failed; private configuration retained for inspection.',
      );
    record.userId = result.data.user.id;
    assert.ok(
      !result.data.user.email_confirmed_at,
      'Expected an unverified signup; stop without granting privileges.',
    );
    await writeFile(vaultFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    const link = new URL('/auth/verify-email', origin);
    link.hash = new URLSearchParams({
      token_hash: result.data.properties.hashed_token,
      type: 'signup',
    }).toString();
    assert.equal(
      process.env.RESEND_FROM_EMAIL,
      'support@sropk.org',
      'Verified sender configuration required',
    );
    assert.ok(process.env.RESEND_API_KEY, 'Server mail key required');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `demo-admin-${record.userId}`,
      },
      body: JSON.stringify({
        from: 'SRO Clinic <support@sropk.org>',
        to: [email],
        subject: 'Verify your SRO Clinic Admin account',
        text: `Verify ownership of this inbox to continue your clinic account setup. Open this link and press Confirm email link:\n\n${link}\n\nClinic access will be activated by your administrator after verification.`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        'Admin verification email delivery unconfirmed; no Admin privileges granted.',
      );
    record.verificationSent = true;
    await writeFile(vaultFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    console.log(
      JSON.stringify({
        projectRef: ref,
        userId: record.userId,
        verificationEmailSent: true,
        verified: false,
        adminPrivilegesGranted: false,
        passwordStoredPrivately: true,
        vaultFile,
      }),
    );
    return;
  }
  const account = await vault();
  assert.equal(account.projectRef, ref);
  const result = await client.auth.admin.getUserById(account.userId);
  if (result.error) throw new Error('Unable to inspect demo Auth account');
  if (mode === 'status') {
    console.log(
      JSON.stringify({
        projectRef: ref,
        userId: account.userId,
        emailVerified: !!result.data.user.email_confirmed_at,
        demoOnly: account.demoOnly,
      }),
    );
  } else if (mode === 'bootstrap') {
    assert.ok(
      result.data.user.email_confirmed_at,
      'Human email verification is required; never auto-confirm',
    );
    const data = await command('phase2b_bootstrap', {
      p_user: account.userId,
      p_name: account.name,
      p_clinic: 'SRO Clinic Demo',
      p_branch: 'SRO Main Clinic Demo',
    });
    console.log(JSON.stringify({ projectRef: ref, bootstrapped: true, demoOnly: true, ...data }));
  } else if (mode === 'disable') {
    const targetId = process.argv[3] ?? account.userId;
    assert.match(targetId, /^[0-9a-f-]{36}$/i, 'A demo Auth user UUID is required');
    // Database denial is immediate, including existing JWTs; Auth ban revokes future login.
    await command('phase2b_disable_demo', { p_user: targetId });
    const ban = await client.auth.admin.updateUserById(targetId, { ban_duration: '876000h' });
    if (ban.error) throw new Error('DB access disabled; Auth ban requires operator follow-up');
    // Revoke all sessions using an access token from a new password login BEFORE ban is not safe.
    // admin.signOut requires an existing access JWT. Ban + DB denial apply immediately; operator
    // must revoke any separately retained test sessions and account for their JWT expiry.
    console.log(
      JSON.stringify({
        projectRef: ref,
        userId: targetId,
        databaseAccessDisabled: true,
        authLoginBanned: true,
        sessionRevocationRequiresRetainedAccessToken: true,
      }),
    );
  } else throw new Error('Use prepare <verification inbox>, status, bootstrap, or disable.');
}
run().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Operator action failed');
  process.exitCode = 1;
});
