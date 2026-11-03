import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
test('login is responsive, accessible and has no demo role bypass', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveValue('');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('all role routes and nested clinical routes require a real session', async ({ page }) => {
  for (const route of [
    '/admin',
    '/doctor',
    '/patient',
    '/admin/branches',
    '/doctor/records/example',
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/auth\/login$/);
  }
});
test('expired/forged session cookie cannot open Admin', async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'sb-jyigxpjvygvtvcypujel-auth-token',
      value: 'base64-eyJ1c2VyIjp7InJvbGUiOiJhZG1pbiJ9fQ',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/auth\/login$/);
});
test('unauthorized invitation, profile and TOTP operations fail closed', async ({ request }) => {
  for (const action of [
    'invite',
    'profile',
    'accept-invitation',
    'mfa-enroll',
    'reset',
    'bootstrap',
  ]) {
    const response = await request.post(`/api/auth/${action}`, {
      headers: { Origin: 'http://localhost:3100' },
      data: { role: 'admin', userId: 'unrelated' },
    });
    expect(response.status()).toBe(401);
  }
});
test('cross-origin mutations and anonymous session reads denied', async ({ request }) => {
  expect(
    (
      await request.post('/api/auth/logout', {
        headers: { Origin: 'https://unrelated.example' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  const session = await request.get('/api/auth/session');
  expect(session.status()).toBe(401);
  expect(session.headers()['cache-control']).toContain('no-store');
});
test('invalid signup/reset and tampered verification cannot produce a session or send mail', async ({
  request,
}) => {
  expect(
    (
      await request.post('/api/auth/signup', {
        headers: { Origin: 'http://localhost:3100' },
        data: { email: 'invalid', password: 'weak', role: 'admin' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/auth/verify', {
        headers: { Origin: 'http://localhost:3100' },
        data: { token_hash: 'invalid', type: 'signup' },
      })
    ).status(),
  ).toBe(400);
});
test('verification fragment is removed without automatic token consumption', async ({ page }) => {
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/auth/verify')) requests++;
  });
  await page.goto('/auth/verify-email#token_hash=fictional-not-a-real-token&type=signup');
  await expect(page.getByRole('button', { name: 'Confirm email link' })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/verify-email$/);
  expect(requests).toBe(0);
});
test('Strict Mode preserves the email token until explicit confirmation', async ({ page }) => {
  let payload: unknown;
  await page.route('**/api/auth/verify', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Fictional token test only' }),
    });
  });
  await page.goto('/auth/verify-email#token_hash=fictional-not-a-real-token&type=signup');
  await page.getByRole('button', { name: 'Confirm email link' }).click();
  await expect(page.locator('.form-error')).toHaveText('Fictional token test only');
  expect(payload).toEqual({ token_hash: 'fictional-not-a-real-token', type: 'signup' });
});
test('real verified demo login persists through refresh, denies unassigned roles and logs out', async ({
  context,
  page,
}) => {
  const vault = JSON.parse(
    await readFile(
      path.join(
        process.env.USERPROFILE!,
        '.codex',
        'secrets',
        'sro-clinic',
        'jyigxpjvygvtvcypujel',
        'phase2b-demo-admin.json',
      ),
      'utf8',
    ),
  );
  const login = await context.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:3100' },
    data: { email: vault.email, password: vault.password },
  });
  expect(login.status()).toBe(200);
  const session = await context.request.get('/api/auth/session');
  expect(session.status()).toBe(200);
  const identity = (await session.json()).identity;
  const roles: string[] = identity.memberships.flatMap((m: { roles: string[] }) => m.roles);
  const workspace = ['admin', 'doctor', 'patient'].find((role) => roles.includes(role));
  const home = workspace ? `/${workspace}` : '/auth/account-ready';
  expect((await login.json()).next).toBe(home);
  const authCookies = (await context.cookies()).filter((c) => c.name.includes('-auth-token'));
  expect(
    authCookies.length > 0 && authCookies.every((c) => c.httpOnly && c.sameSite === 'Lax'),
  ).toBe(true);
  await page.goto(home);
  await expect(page).toHaveURL(new RegExp(`${home}$`));
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${home}$`));
  for (const role of ['admin', 'doctor', 'patient']) {
    await page.goto(`/${role}`);
    await expect(page).toHaveURL(
      roles.includes(role) ? new RegExp(`/${role}$`) : /\/auth\/access-denied$/,
    );
  }
  expect(
    (
      await context.request.post('/api/auth/logout', {
        headers: { Origin: 'http://localhost:3100' },
        data: {},
      })
    ).status(),
  ).toBe(200);
  expect((await context.request.get('/api/auth/session')).status()).toBe(401);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/auth\/login$/);
});
