// Read-only/denial checks only. Valid requests must stop at the not-yet-deployed RPC gate.
import { request } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin = process.argv[2] ?? 'http://localhost:3100';
const label = process.argv[3] ?? 'dev';
const root = path.join(
  process.env.USERPROFILE,
  '.codex',
  'secrets',
  'sro-clinic',
  'jyigxpjvygvtvcypujel',
);
const accounts = JSON.parse(
  await readFile(path.join(root, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const clients = [];
const checks = [];
let step = 'initialization';
const max = 10 * 1024 * 1024;
try {
  const anonymous = await request.newContext({ baseURL: origin });
  clients.push(anonymous);
  const denied = await anonymous.post('/api/medical-documents', {
    headers: { Origin: origin },
    data: {},
  });
  assert.equal(denied.status(), 401);
  checks.push('Anonymous upload denied (401)');
  const doctor = await request.newContext({ baseURL: origin });
  clients.push(doctor);
  const credentials = accounts.find((a) => a.role === 'doctor');
  const login = await doctor.post('/api/auth/login', {
    headers: { Origin: origin },
    data: { email: credentials.email, password: credentials.password },
  });
  assert.equal(login.status(), 200);
  const identity = (await (await doctor.get('/api/auth/session')).json()).identity;
  const membership = identity.memberships.find((m) => m.roles.includes('doctor'));
  const snapshot = await (
    await doctor.get(
      '/api/clinic?' +
        new URLSearchParams({ role: 'doctor', organizationId: membership.organizationId }),
    )
  ).json();
  const patient = snapshot.state.patients[0];
  assert.ok(patient);
  const base = {
    organizationId: membership.organizationId,
    patientId: patient.id,
    branchId: membership.branchIds[0],
    kind: 'report',
  };
  async function post(name, mimeType, buffer) {
    return doctor.post('/api/medical-documents', {
      headers: { Origin: origin },
      multipart: { ...base, requestId: randomUUID(), file: { name, mimeType, buffer } },
    });
  }
  step = 'spoofed PDF denial';
  assert.equal(
    (await post('report.pdf', 'application/pdf', Buffer.from('MZ NOT_A_PDF'))).status(),
    415,
  );
  checks.push('Spoofed executable/PDF rejected (415)');
  step = 'oversized file denial';
  assert.equal((await post('report.pdf', 'application/pdf', Buffer.alloc(max + 1))).status(), 413);
  checks.push('File over 10 MiB rejected (413)');
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]).drawText('Clinical report - Amina Noor');
  const small = Buffer.from(await pdf.save());
  await mkdir('artifacts/document-validation', { recursive: true });
  await writeFile('artifacts/document-validation/Clinical report.pdf', small);
  step = 'valid PDF approval gate';
  const pending = await post('Clinical report.pdf', 'application/pdf', small);
  assert.equal(pending.status(), 503);
  assert.match((await pending.json()).error, /awaiting activation/);
  checks.push('Valid PDF stops at explicit remote activation gate (503; no upload)');
  step = 'exact 10 MiB body reaches activation gate';
  let count = max - 1024,
    large;
  for (let i = 0; i < 4; i++) {
    const d = await PDFDocument.create();
    const page = d.addPage([300, 400]);
    const stream = d.context.register(d.context.stream(Buffer.alloc(count, 32)));
    page.node.set((await import('pdf-lib')).PDFName.of('Contents'), stream);
    large = Buffer.from(await d.save({ useObjectStreams: false }));
    if (large.length === max) break;
    count += max - large.length;
  }
  assert.equal(large.length, max);
  const boundary = await post('Large clinical report.pdf', 'application/pdf', large);
  assert.equal(boundary.status(), 503);
  assert.match((await boundary.json()).error, /awaiting activation/);
  checks.push(
    'Exactly 10 MiB plus multipart overhead reaches validation/gate without Proxy truncation',
  );
  const patientClient = await request.newContext({ baseURL: origin });
  clients.push(patientClient);
  const patientAccount = accounts.find((a) => a.role === 'patient');
  assert.equal(
    (
      await patientClient.post('/api/auth/login', {
        headers: { Origin: origin },
        data: { email: patientAccount.email, password: patientAccount.password },
      })
    ).status(),
    200,
  );
  step = 'Patient write denial';
  assert.equal(
    (
      await patientClient.post('/api/medical-documents', { headers: { Origin: origin }, data: {} })
    ).status(),
    403,
  );
  checks.push('Patient upload denied (403)');
  step = 'unknown download denial';
  assert.equal(
    (
      await doctor.get(
        '/api/medical-documents/' +
          randomUUID() +
          '?' +
          new URLSearchParams({ role: 'doctor', organizationId: membership.organizationId }),
      )
    ).status(),
    404,
  );
  checks.push('Unregistered document cannot be downloaded (404)');
  step = 'origin enforcement';
  assert.equal(
    (
      await doctor.post('/api/medical-documents', {
        headers: { Origin: 'https://unrelated.example' },
        data: {},
      })
    ).status(),
    403,
  );
  checks.push('Cross-origin upload denied (403)');
  await writeFile(
    `artifacts/document-validation/${label}-preflight.json`,
    JSON.stringify(
      {
        origin,
        checks,
        realStorageUploads: 0,
        remoteChanges: false,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({ origin, passed: checks.length, realStorageUploads: 0, remoteChanges: false }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ passed: false, step, completed: checks.length, errorType: error.name }),
  );
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.dispose();
}
