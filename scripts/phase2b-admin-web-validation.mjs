// Focused post-deployment validation. Existing demo account only; no email or new users.
// Secrets remain in memory. No screenshots, traces, password output or raw SDK errors.
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = require('@supabase/supabase-js');
process.loadEnvFile('apps/web/.env.local');
const target = 'jyigxpjvygvtvcypujel';
const origin = process.env.SRO_APP_URL ?? 'http://localhost:3100';
const results = { projectRef: target, checks: [], outboundEmails: 0, accountsCreated: 0 };
let step = 'configuration';
let browser;
let publicClient;
async function check(name, run) {
  step = name;
  await run();
  results.checks.push({ name, passed: true });
}
async function main() {
  assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${target}.supabase.co`);
  const account = JSON.parse(
    await readFile(
      path.join(
        process.env.USERPROFILE,
        '.codex',
        'secrets',
        'sro-clinic',
        target,
        'phase2b-demo-admin.json',
      ),
      'utf8',
    ),
  );
  assert.equal(account.projectRef, target);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  let identity;
  await check('real Web Admin password login and trusted role resolution', async () => {
    const login = await context.request.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: account.email, password: account.password },
    });
    assert.equal(login.status(), 200);
    assert.equal((await login.json()).next, '/admin');
    const response = await context.request.get('/api/auth/session');
    assert.equal(response.status(), 200);
    identity = (await response.json()).identity;
    assert.equal(identity.id, account.userId);
    assert.equal(identity.name, account.name);
    assert.equal(identity.memberships.length, 1);
    assert.deepEqual(identity.memberships[0].roles, ['admin']);
    assert.equal(identity.memberships[0].branchIds.length, 1);
    const cookies = (await context.cookies()).filter((c) => c.name.includes('-auth-token'));
    assert.ok(cookies.length > 0 && cookies.every((c) => c.httpOnly && c.sameSite === 'Lax'));
  });
  await check('Admin dashboard and assigned-role-only selector', async () => {
    await page.goto('/');
    await page.waitForURL('**/admin');
    await page.getByText('ADMIN WORKSPACE', { exact: true }).waitFor({ state: 'visible' });
    assert.ok((await page.locator('.demo-strip').innerText()).includes(account.name));
    const roles = await page.locator('select[aria-label="Demo role"] option').allTextContents();
    assert.deepEqual(roles, ['Admin']);
  });
  await check('session persistence across browser refresh and new tab', async () => {
    await page.reload();
    await page.getByText('ADMIN WORKSPACE', { exact: true }).waitFor({ state: 'visible' });
    const second = await context.newPage();
    await second.goto('/admin/settings');
    await second
      .getByRole('heading', { name: 'Your verified account', exact: true })
      .waitFor({ state: 'visible' });
    await second.getByText(account.name, { exact: true }).waitFor({ state: 'visible' });
    await second.close();
  });
  await check(
    'real Admin invitation form uses authorized database branch and department without sending',
    async () => {
      await page.goto('/admin/settings');
      await page.getByRole('button', { name: 'Invite a doctor', exact: true }).click();
      await page
        .locator('select[name="branchId"]')
        .selectOption(identity.memberships[0].branchIds[0]);
      const option = page
        .locator('select[name="specializationId"] option')
        .filter({ hasText: 'General Medicine' });
      await option.waitFor({ state: 'attached' });
      assert.equal(await page.locator('select[name="branchId"] option').count(), 2);
    },
  );
  await check('Doctor and Patient workspace routes denied to Admin-only identity', async () => {
    for (const route of ['/doctor', '/patient', '/doctor/records/example']) {
      await page.goto(route);
      await page.waitForURL('**/auth/access-denied');
    }
  });
  publicClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await check('ordinary Admin JWT reads its real database Admin assignment', async () => {
    const login = await publicClient.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    assert.equal(login.error, null);
    const roles = await publicClient
      .from('role_assignments')
      .select('role')
      .eq('user_id', account.userId);
    assert.equal(roles.error, null);
    assert.deepEqual(
      roles.data.map((r) => r.role),
      ['admin'],
    );
  });
  await check('ordinary Admin JWT cannot self-assign another privileged role', async () => {
    const denied = await publicClient
      .from('role_assignments')
      .insert({
        organization_id: identity.memberships[0].organizationId,
        user_id: account.userId,
        role: 'doctor',
      });
    assert.equal(denied.error?.code, '42501');
  });
  await check('ordinary Admin and anonymous callers cannot EXECUTE bootstrap RPC', async () => {
    const args = {
      p_user: account.userId,
      p_name: account.name,
      p_clinic: 'Fictional test clinic',
      p_branch: 'Fictional test branch',
    };
    for (const caller of [
      publicClient,
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      ),
    ]) {
      const denied = await caller.rpc('phase2b_bootstrap', args);
      assert.equal(denied.error?.code, '42501');
      assert.match(denied.error.message, /permission denied for function/i);
    }
  });
  await check('global logout clears Web session and protects workspace', async () => {
    const logout = await context.request.post('/api/auth/logout', {
      headers: { Origin: origin },
      data: {},
    });
    assert.equal(logout.status(), 200);
    assert.equal((await context.request.get('/api/auth/session')).status(), 401);
    await page.goto('/admin');
    await page.waitForURL('**/auth/login');
  });
  results.completedAt = new Date().toISOString();
  await mkdir('artifacts/phase2b-validation', { recursive: true });
  await writeFile(
    'artifacts/phase2b-validation/admin-live-results.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      projectRef: target,
      checksPassed: results.checks.length,
      accountsCreated: 0,
      outboundEmails: 0,
      evidence: 'artifacts/phase2b-validation/admin-live-results.json',
    }),
  );
}
try {
  await main();
} catch {
  console.error(
    JSON.stringify({
      projectRef: target,
      passed: false,
      failedCheck: step,
      checksPassed: results.checks.length,
    }),
  );
  process.exitCode = 1;
} finally {
  if (publicClient) await publicClient.auth.signOut({ scope: 'global' }).catch(() => {});
  if (browser) await browser.close();
}
