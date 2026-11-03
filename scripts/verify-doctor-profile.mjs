// Read-only and denied-write checks against the existing verified accounts; no Auth changes.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
process.loadEnvFile('apps/web/.env.local');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
const deployed = process.argv[2] === 'after';
assert.equal(
  JSON.parse(await readFile('supabase/proposals/doctor-profile/manifest.json', 'utf8'))
    .remoteApplied,
  deployed,
);
const vault = path.join(process.env.USERPROFILE, '.codex/secrets/sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const people = [
  { ...admin, role: 'admin' },
  ...JSON.parse(await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8')).accounts,
];
const contexts = [],
  checks = [];
let step = 'verified sessions',
  doctor,
  adminUser,
  organizationId;
try {
  for (const p of people) {
    const c = await request.newContext({ baseURL: origin });
    contexts.push(c);
    assert.equal(
      (
        await c.post('/api/auth/login', {
          headers: { Origin: origin },
          data: { email: p.email, password: p.password },
        })
      ).status(),
      200,
    );
    const identity = (await (await c.get('/api/auth/session')).json()).identity;
    const m = identity.memberships.find((m) => m.roles.includes(p.role));
    assert.ok(m);
    organizationId = m.organizationId;
    if (p.role === 'admin') {
      adminUser = identity.id;
      const s = await (
        await c.get('/api/clinic?' + new URLSearchParams({ role: 'admin', organizationId }))
      ).json();
      doctor = s.state.doctors.find((d) => d.name === 'Dr. Sara Malik');
      assert.ok(doctor);
    }
    step = p.role + ' profile';
    const target = { organizationId, kind: 'doctor', id: doctor.id };
    const start = Date.now(),
      r = await c.get('/api/profiles?' + new URLSearchParams(target));
    assert.equal(r.status(), 200);
    const profile = (await r.json()).profile;
    if (p.role === 'admin') {
      assert.equal(profile.canEdit, true);
      if (deployed) {
        assert.equal(profile.loginEmailVisible, true);
        assert.equal(
          profile.loginEmail.toLowerCase(),
          people.find((a) => a.role === 'doctor').email.toLowerCase(),
        );
      } else assert.equal(profile.loginEmail, null);
      checks.push({
        role: p.role,
        profileMs: Date.now() - start,
        verifiedEmail: deployed
          ? 'matches verified Doctor account'
          : 'blocked pending approved migration',
      });
    }
    if (p.role === 'doctor') {
      assert.equal(profile.canEdit, true);
      assert.equal(profile.loginEmail.toLowerCase(), p.email.toLowerCase());
      checks.push({
        role: p.role,
        profileMs: Date.now() - start,
        verifiedEmailMatchesAccount: true,
      });
    }
    if (p.role === 'patient') {
      assert.equal(profile.canEdit, false);
      assert.equal(profile.loginEmail, null);
      const denied = await c.post('/api/profiles', {
        headers: { Origin: origin },
        multipart: {
          ...target,
          fields: JSON.stringify({ name: doctor.name }),
          photo: 'keep',
          requestId: crypto.randomUUID(),
        },
      });
      assert.equal(denied.status(), 403);
      checks.push({
        role: p.role,
        profileMs: Date.now() - start,
        verifiedEmail: null,
        doctorWriteStatus: denied.status(),
      });
    }
    if (p.role === 'doctor') {
      const denied = await c.post('/api/profiles', {
        headers: { Origin: origin },
        multipart: {
          organizationId,
          kind: 'profile',
          id: adminUser,
          fields: JSON.stringify({ name: 'SRO Administrator' }),
          photo: 'keep',
          requestId: crypto.randomUUID(),
        },
      });
      assert.equal(denied.status(), 403);
      checks.push({ doctorCannotEditAdmin: true });
    }
    const malformed = await c.post('/api/profiles', {
      headers: { Origin: origin },
      multipart: {
        ...target,
        fields: JSON.stringify({ name: doctor.name, loginEmail: 'not-a-real-inbox@example.test' }),
        photo: 'keep',
        requestId: crypto.randomUUID(),
      },
    });
    assert.equal(malformed.status(), 400);
  }
  const anon = await request.newContext({ baseURL: origin });
  contexts.push(anon);
  assert.equal(
    (
      await anon.get(
        '/api/profiles?' + new URLSearchParams({ organizationId, kind: 'doctor', id: doctor.id }),
      )
    ).status(),
    401,
  );
  const report = {
    checkedAt: new Date().toISOString(),
    projectRef: ref,
    origin,
    checks,
    anonymousStatus: 401,
    authEmailWrites: 0,
    migrationsApplied: 0,
  };
  await mkdir('artifacts/doctor-profile-validation', { recursive: true });
  await writeFile(
    `artifacts/doctor-profile-validation/live-${deployed ? 'after' : 'preapproval'}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch {
  console.error(
    JSON.stringify({
      failed: step,
      details: 'Sanitized profile verification failure; no secrets logged.',
    }),
  );
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.dispose();
}
