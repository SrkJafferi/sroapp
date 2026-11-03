// Before-approval checks only: existing user sessions, reads, denials, and the missing-RPC gate.
// Never apply SQL, alter credentials or claim real avatar storage has been tested.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const origin = process.argv[2] ?? 'http://localhost:3100',
  label = process.argv[3] ?? 'dev';
const vault = path.join(
  process.env.USERPROFILE,
  '.codex',
  'secrets',
  'sro-clinic',
  'jyigxpjvygvtvcypujel',
);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const people = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const clients = [],
  checks = [];
let step = 'initialization';
try {
  const anonymous = await request.newContext({ baseURL: origin });
  clients.push(anonymous);
  assert.equal((await anonymous.get('/api/profiles')).status(), 401);
  checks.push('Anonymous profile read denied (401)');
  const photo = await sharp({
    create: { width: 720, height: 540, channels: 3, background: '#443080' },
  })
    .png()
    .toBuffer();
  await mkdir('artifacts/profile-validation', { recursive: true });
  await writeFile('artifacts/profile-validation/Profile photo.png', photo);
  for (const person of [{ ...admin, role: 'admin' }, ...people]) {
    step = `${person.role} login and own-profile read`;
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
    const m = identity.memberships.find((m) => m.roles.includes(person.role) && m.branchIds.length);
    assert.ok(m);
    const snapshot = await (
      await client.get(
        '/api/clinic?' +
          new URLSearchParams({ role: person.role, organizationId: m.organizationId }),
      )
    ).json();
    const target = {
      organizationId: m.organizationId,
      kind: person.role === 'admin' ? 'profile' : person.role,
      id:
        person.role === 'admin'
          ? identity.id
          : person.role === 'doctor'
            ? snapshot.actor.doctorId
            : snapshot.actor.patientId,
    };
    const own = await client.get('/api/profiles?' + new URLSearchParams(target));
    assert.equal(own.status(), 200);
    const p = (await own.json()).profile;
    assert.equal(p.loginEmail, person.email);
    assert.equal(p.canEdit, true);
    assert.ok(p.name);
    checks.push(`${person.role}: verified own-profile read and editable fields (200)`);
    async function post(fields = { name: p.name }, extra = {}) {
      return client.post('/api/profiles', {
        headers: { Origin: origin },
        multipart: {
          ...target,
          requestId: randomUUID(),
          fields: JSON.stringify(fields),
          photo: 'keep',
          ...extra,
        },
      });
    }
    step = `${person.role} activation gate`;
    const gate = await post();
    assert.equal(gate.status(), 503);
    assert.match((await gate.json()).error, /awaiting activation/);
    checks.push(`${person.role}: profile save stops at approval gate (503; no mutation)`);
    assert.equal((await post({ name: p.name, role: 'admin' })).status(), 400);
    checks.push(`${person.role}: forged role input rejected (400)`);
    const invalid = await post(
      { name: p.name },
      {
        photo: 'replace',
        file: { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('MZ executable') },
      },
    );
    assert.equal(invalid.status(), 415);
    const oversize = await post(
      { name: p.name },
      {
        photo: 'replace',
        file: { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(2097153) },
      },
    );
    assert.equal(oversize.status(), 413);
    const valid = await post(
      { name: p.name },
      {
        photo: 'replace',
        file: { name: 'Profile photo.png', mimeType: 'image/png', buffer: photo },
      },
    );
    assert.equal(valid.status(), 503);
    assert.match((await valid.json()).error, /awaiting activation/);
    checks.push(
      `${person.role}: spoofed image (415), oversize (413), valid processed photo reaches approval gate (503)`,
    );
    const forged = await client.get(
      '/api/profiles?' + new URLSearchParams({ ...target, id: randomUUID() }),
    );
    assert.equal(forged.status(), 403);
    const foreign = await client.get(
      '/api/profiles?' + new URLSearchParams({ ...target, organizationId: randomUUID() }),
    );
    assert.equal(foreign.status(), 403);
    const crossOrigin = await client.post('/api/profiles', {
      headers: { Origin: 'https://unrelated.example' },
      data: {},
    });
    assert.equal(crossOrigin.status(), 403);
    checks.push(
      `${person.role}: forged target, foreign organization and cross-origin denied (403)`,
    );
  }
  const report = { origin, checks, profileWrites: 0, avatarUploads: 0, activationPending: true };
  await writeFile(
    `artifacts/profile-validation/${label}-preflight.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({ origin, passed: checks.length, profileWrites: 0, avatarUploads: 0 }),
  );
} catch {
  console.error(JSON.stringify({ failedAt: step, secretValuesPrinted: false }));
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.dispose();
}
