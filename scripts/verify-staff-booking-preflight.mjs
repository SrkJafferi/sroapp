// Existing ordinary sessions only. Read-only clinical checks, no clinical writes.
import { request } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3100',
  ref = 'jyigxpjvygvtvcypujel';
assert.equal(
  JSON.parse(await readFile('supabase/proposals/staff-booking/manifest.json', 'utf8'))
    .remoteApplied,
  false,
  'Already deployed; use completed preflight evidence and post-deployment verification.',
);
const vault = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const checks = [],
  contexts = [];
let step = 'anonymous';
try {
  const anonymous = await request.newContext({ baseURL: origin });
  contexts.push(anonymous);
  assert.equal((await anonymous.get('/api/clinic?role=admin')).status(), 401);
  checks.push('Anonymous clinical access denied');
  for (const person of [{ ...admin, role: 'admin' }, ...accounts]) {
    step = person.role + ' login';
    const c = await request.newContext({ baseURL: origin });
    contexts.push(c);
    assert.equal(
      (
        await c.post('/api/auth/login', {
          headers: { Origin: origin },
          data: { email: person.email, password: person.password },
        })
      ).status(),
      200,
    );
    const identity = (await (await c.get('/api/auth/session')).json()).identity;
    const member = identity.memberships.find((m) => m.roles.includes(person.role));
    assert.ok(member);
    step = person.role + ' clinical reads';
    const r = await c.get(
      '/api/clinic?' +
        new URLSearchParams({ role: person.role, organizationId: member.organizationId }),
    );
    assert.equal(r.status(), 200);
    const snapshot = await r.json();
    assert.ok(snapshot.state.patients.length > 0);
    checks.push(person.role + ': authorized existing clinical records available');
    if (person.role !== 'admin') {
      assert.equal(
        (
          await c.get(
            '/api/clinic?' +
              new URLSearchParams({ role: 'admin', organizationId: member.organizationId }),
          )
        ).status(),
        403,
      );
      checks.push(person.role + ': Admin workspace denied');
    }
    if (person.role === 'admin') {
      const p = snapshot.state.patients[0];
      const r = await c.get(
        '/api/profiles?' +
          new URLSearchParams({ organizationId: member.organizationId, kind: 'patient', id: p.id }),
      );
      assert.equal(r.status(), 200);
      assert.equal((await r.json()).profile.canEditBloodGroup, undefined);
      checks.push(
        'New atomic blood-group capability correctly remains gated until migration approval',
      );
    }
  }
  await mkdir('artifacts/staff-booking-validation', { recursive: true });
  await writeFile(
    'artifacts/staff-booking-validation/preflight.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        origin,
        projectRef: ref,
        checks,
        clinicalWrites: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ passed: checks.length, checks, clinicalWrites: false }));
} catch {
  console.error(
    JSON.stringify({
      failed: step,
      details: 'Sanitized verification failed; no credential values logged.',
    }),
  );
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.dispose();
}
