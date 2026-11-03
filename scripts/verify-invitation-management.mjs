// Existing account reads and denied writes only. No invitations, users or emails created.
import { request } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
const vault = path.join(process.env.USERPROFILE, '.codex/secrets/sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = [
  { ...admin, role: 'admin' },
  ...JSON.parse(await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8')).accounts,
];
const checks = [];
try {
  for (const account of accounts) {
    const c = await request.newContext({ baseURL: origin });
    try {
      assert.equal(
        (
          await c.post('/api/auth/login', {
            headers: { Origin: origin },
            data: { email: account.email, password: account.password },
          })
        ).status(),
        200,
      );
      const identity = (await (await c.get('/api/auth/session')).json()).identity;
      const org = identity.memberships.find((m) => m.roles.includes(account.role)).organizationId;
      const r = await c.get(
        '/api/clinic?' + new URLSearchParams({ role: account.role, organizationId: org }),
      );
      assert.equal(r.status(), 200);
      const state = (await r.json()).state;
      if (account.role !== 'admin') {
        assert.equal(state.invitations.length, 0);
        const denied = await c.post('/api/doctor-invitations', {
          headers: { Origin: origin },
          data: {
            organizationId: org,
            id: '00000000-0000-4000-8000-000000000001',
            action: 'revoke',
          },
        });
        assert.equal(denied.status(), 403);
      } else {
        assert.ok(state.invitations.every((i) => i.createdAt && i.expiresAt && i.token === ''));
        assert.equal(
          (
            await c.post('/api/doctor-invitations', {
              headers: { Origin: 'https://invalid.example' },
              data: {},
            })
          ).status(),
          403,
        );
      }
      checks.push({
        role: account.role,
        clinicalStatus: 200,
        invitationRows: state.invitations.length,
        authorizationPassed: true,
      });
    } finally {
      await c.dispose();
    }
  }
  const c = await request.newContext({ baseURL: origin });
  try {
    assert.equal(
      (
        await c.post('/api/doctor-invitations', {
          headers: { Origin: origin },
          data: {
            organizationId: '00000000-0000-4000-8000-000000000001',
            id: '00000000-0000-4000-8000-000000000001',
            action: 'resend',
          },
        })
      ).status(),
      401,
    );
  } finally {
    await c.dispose();
  }
  const report = {
    checkedAt: new Date().toISOString(),
    projectRef: ref,
    remoteMutations: 0,
    anonymousDenial: 401,
    checks,
  };
  await mkdir('artifacts/invitation-management-validation', { recursive: true });
  await writeFile(
    'artifacts/invitation-management-validation/live-read-only.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch {
  console.error('Read-only invitation regression failed; no credentials logged.');
  process.exitCode = 1;
}
