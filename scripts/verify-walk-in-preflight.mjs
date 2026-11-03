// Before approval only: real sessions and denial/gate checks. No new clinical/Auth records.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = process.argv[2] ?? 'http://localhost:3100',
  label = process.argv[3] ?? 'dev';
const deployment = JSON.parse(await readFile('supabase/proposals/walk-in/manifest.json', 'utf8'));
assert.equal(
  deployment.remoteApplied,
  false,
  'Walk-in is already deployed; missing-RPC preflight must not create live test registrations. Reuse completed evidence.',
);
const vault = path.join(
  process.env.USERPROFILE,
  '.codex',
  'secrets',
  'sro-clinic',
  'jyigxpjvygvtvcypujel',
);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const clients = [],
  checks = [];
let step = 'anonymous denial';
try {
  const anon = await request.newContext({ baseURL: origin });
  clients.push(anon);
  assert.equal(
    (
      await anon.post('/api/clinic', {
        headers: { Origin: origin },
        data: {
          role: 'admin',
          organizationId: randomUUID(),
          command: 'register-walk-in',
          input: {},
        },
      })
    ).status(),
    401,
  );
  checks.push('Anonymous registration denied (401)');
  for (const person of [{ ...admin, role: 'admin' }, ...accounts]) {
    step = `${person.role} verified login`;
    const client = await request.newContext({ baseURL: origin });
    clients.push(client);
    assert.equal(
      (
        await client.post('/api/auth/login', {
          headers: { Origin: origin },
          data: { email: person.email, password: person.password },
        })
      ).status(),
      200,
    );
    const identity = (await (await client.get('/api/auth/session')).json()).identity;
    const member = identity.memberships.find(
      (m) => m.roles.includes(person.role) && m.branchIds.length,
    );
    assert.ok(member);
    const records = await client.get(
      '/api/clinic?' +
        new URLSearchParams({ role: person.role, organizationId: member.organizationId }),
    );
    assert.equal(records.status(), 200);
    assert.equal((await records.json()).state.patients.length, 1);
    checks.push(`${person.role}: existing clinic records remain available (200)`);
    const base = {
      requestId: randomUUID(),
      branchId: member.branchIds[0],
      name: 'Fictional Walk-in Preflight',
      ageYears: 26,
      gender: 'Other',
    };
    const post = (extra = {}, requestOrigin = origin) =>
      client.post('/api/clinic', {
        headers: { Origin: requestOrigin },
        data: {
          role: person.role,
          organizationId: member.organizationId,
          command: 'register-walk-in',
          input: { ...base, ...extra },
        },
      });
    step = `${person.role} registration gate`;
    const result = await post();
    if (person.role === 'patient') {
      assert.equal(result.status(), 403);
      checks.push('Patient cannot invoke staff registration (403)');
      continue;
    }
    assert.equal(result.status(), 503);
    assert.match((await result.json()).error, /Walk-in registration is awaiting activation/);
    checks.push(`${person.role}: no-email intake reaches explicit approval gate (503; no write)`);
    const contact = await post({
      requestId: randomUUID(),
      email: 'fictional@example.test',
      phone: '',
    });
    assert.equal(contact.status(), 503);
    checks.push(
      `${person.role}: optional contact email needs no verification; approval gate remains (503)`,
    );
    assert.equal((await post({ ageYears: 121 })).status(), 400);
    assert.equal((await post({ actorId: identity.id })).status(), 400);
    assert.equal((await post({ user_id: identity.id })).status(), 400);
    checks.push(`${person.role}: invalid age and forged actor/user IDs denied (400)`);
    assert.equal((await post({ branchId: randomUUID() })).status(), 403);
    assert.equal((await post({}, 'https://unrelated.example')).status(), 403);
    checks.push(`${person.role}: foreign branch and request origin denied (403)`);
  }
  await mkdir('artifacts/walk-in-validation', { recursive: true });
  await writeFile(
    `artifacts/walk-in-validation/${label}-preflight.json`,
    JSON.stringify(
      {
        origin,
        checks,
        staffRegistrations: 0,
        authUsersCreated: 0,
        emailsSent: 0,
        activationPending: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      origin,
      passed: checks.length,
      staffRegistrations: 0,
      authUsersCreated: 0,
      emailsSent: 0,
    }),
  );
} catch {
  console.error(JSON.stringify({ failedAt: step, secretValuesPrinted: false }));
  process.exitCode = 1;
} finally {
  for (const c of clients) await c.dispose();
}
