// Ordinary public-key user sessions only. Real profile/avatar/RLS checks; no service-role clinical reads.
import { createServerClient } from '@supabase/ssr';
import { readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = 'http://localhost:3100';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
const vault = path.join(process.env.USERPROFILE, '.codex/secrets/sro-clinic', ref),
  privateFile = path.join(vault, 'single-email-onboarding-tests.json');
const fixture = JSON.parse(await readFile(privateFile, 'utf8')),
  checks = [];
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join(''),
    key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function login(account) {
  const jar = new Map();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) => values.forEach((v) => jar.set(v.name, v.value)),
      },
    },
  );
  const r = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  assert.equal(r.error, null);
  assert.ok(r.data.user.email_confirmed_at);
  const factors = (await client.auth.mfa.listFactors()).data.totp.filter(
    (f) => f.status === 'verified',
  );
  if (factors.length) {
    assert.ok(account.mfaSecret);
    assert.equal(
      (
        await client.auth.mfa.challengeAndVerify({
          factorId: factors[0].id,
          code: totp(account.mfaSecret),
        })
      ).error,
      null,
    );
  }
  const web = (url, options = {}) =>
    fetch(origin + url, {
      ...options,
      headers: {
        Origin: origin,
        Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '),
        ...options.headers,
      },
      redirect: 'manual',
    });
  return { client, web, userId: r.data.user.id, factors: factors.length };
}
let stage = 'Doctor sessions';
try {
  for (const account of fixture.accounts) {
    stage = account.kind + ' profile and RLS';
    const { client, web, userId, factors } = await login(account);
    account.userId = userId;
    assert.equal(factors, account.kind === 'mfa' ? 1 : 0);
    const doctor = await client
      .from('doctors')
      .select('id,name,gender,experience,specialization_id')
      .eq('user_id', userId)
      .single();
    assert.equal(doctor.error, null);
    account.doctorId = doctor.data.id;
    assert.equal(doctor.data.name, account.name);
    assert.equal(doctor.data.gender, 'Female');
    assert.equal(doctor.data.experience, account.kind === 'mfa' ? 7 : 5);
    assert.equal(doctor.data.specialization_id, account.specializationId);
    const assignment = await client
      .from('doctor_branch_assignments')
      .select('branch_id')
      .eq('doctor_id', account.doctorId)
      .eq('branch_id', account.branchId);
    assert.equal(assignment.error, null);
    assert.equal(assignment.data.length, 1);
    const history = await client.from('patient_medical_history').select('patient_id');
    assert.equal(history.error, null);
    assert.equal(history.data.length, 0);
    const notifications = await client
      .from('notifications')
      .select('id')
      .eq('doctor_id', account.doctorId);
    assert.equal(notifications.error, null);
    assert.equal(notifications.data.length, 0);
    const denied = await client.rpc('phase2b_onboarding', {
      p_action: 'prepare',
      p_invitation: account.invitationId,
      p_hash: '\\x' + '00'.repeat(32),
    });
    assert.equal(denied.error?.code, '42501');
    const target = { organizationId: account.organizationId, kind: 'doctor', id: account.doctorId };
    const profilePath = '/api/profiles?' + new URLSearchParams(target);
    const profileResponse = await web(profilePath);
    assert.equal(profileResponse.status, 200);
    let profile = (await profileResponse.json()).profile;
    assert.equal(profile.loginEmail, account.email);
    stage = account.kind + ' private avatar';
    if (!profile.avatarId) {
      const initials = account.kind === 'mfa' ? 'ZI' : 'HF';
      const image = await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#38216b"/><text x="320" y="300" text-anchor="middle" font-family="Arial" font-size="150" fill="white">${initials}</text></svg>`,
        ),
      )
        .png()
        .toBuffer();
      const form = new FormData();
      for (const [k, v] of Object.entries({
        ...target,
        fields: JSON.stringify({ name: account.name }),
        photo: 'replace',
        requestId: randomUUID(),
        cropX: '0.5',
        cropY: '0.5',
        cropZoom: '1',
      }))
        form.set(k, v);
      form.set(
        'file',
        new Blob([image], { type: 'image/png' }),
        'fictional-' + initials.toLowerCase() + '.png',
      );
      assert.equal((await web('/api/profiles', { method: 'POST', body: form })).status, 200);
      profile = (await (await web(profilePath)).json()).profile;
    }
    assert.ok(profile.avatarId);
    account.avatarId = profile.avatarId;
    const imageResponse = await web('/api/profiles/avatar/' + profile.avatarId);
    assert.equal(imageResponse.status, 302);
    const location = imageResponse.headers.get('location');
    assert.equal(new URL(location).hostname, ref + '.supabase.co');
    const image = await fetch(location);
    assert.equal(image.status, 200);
    const bytes = Buffer.from(await image.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.format, 'webp');
    const anonymous = await fetch(origin + '/api/profiles/avatar/' + profile.avatarId, {
      redirect: 'manual',
    });
    assert.equal(anonymous.status, 401);
    const clinical = await web(
      '/api/clinic?' +
        new URLSearchParams({ role: 'doctor', organizationId: account.organizationId }),
    );
    assert.equal(clinical.status, 200);
    const wrongRole = await web(
      '/api/clinic?' +
        new URLSearchParams({ role: 'admin', organizationId: account.organizationId }),
    );
    assert.equal(wrongRole.status, 403);
    const params = new URLSearchParams(new URL(account.invitationUrl).hash.slice(1));
    const replay = await fetch(origin + '/api/doctor-onboarding', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'preview',
        proof: { id: params.get('id'), token: params.get('token') },
      }),
    });
    assert.equal(replay.status, 400);
    checks.push({
      kind: account.kind,
      verifiedIdentity: true,
      verifiedMfaFactors: factors,
      correctProfileAndAssignment: true,
      unrelatedMedicalHistoryRows: 0,
      adminNotificationRowsVisible: 0,
      privilegedRpcDenied: denied.error.code,
      privateAvatarBytes: bytes.length,
      avatarDimensions: '512x512',
      anonymousAvatarStatus: anonymous.status,
      clinicalStatus: clinical.status,
      crossRoleStatus: wrongRole.status,
      anonymousConsumedProofStatus: replay.status,
    });
    await writeFile(privateFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  stage = 'Admin notifications';
  const admin = await login(
    JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8')),
  );
  const n = await admin.client
    .from('notifications')
    .select('id,doctor_id,branch_id,title,kind,created_at')
    .in(
      'doctor_id',
      fixture.accounts.map((a) => a.doctorId),
    );
  assert.equal(n.error, null);
  assert.equal(n.data.length, 2);
  for (const account of fixture.accounts) {
    const events = n.data.filter((n) => n.doctor_id === account.doctorId);
    assert.equal(events.length, 1);
    assert.equal(events[0].branch_id, account.branchId);
    assert.equal(events[0].kind, 'invitation');
    account.notificationId = events[0].id;
  }
  const recipient = await admin.client
    .from('notification_recipients')
    .select('notification_id,user_id,read_at')
    .in(
      'notification_id',
      n.data.map((n) => n.id),
    );
  assert.equal(recipient.error, null);
  assert.equal(recipient.data.length, 2);
  assert.ok(recipient.data.every((r) => r.user_id === admin.userId));
  stage = 'Patient notification isolation';
  const patientData = JSON.parse(
    await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
  ).accounts.find((a) => a.role === 'patient');
  const patient = await login(patientData);
  const p = await patient.client
    .from('notifications')
    .select('id')
    .in(
      'doctor_id',
      fixture.accounts.map((a) => a.doctorId),
    );
  assert.equal(p.error, null);
  assert.equal(p.data.length, 0);
  await writeFile(privateFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  const report = {
    checkedAt: new Date().toISOString(),
    projectRef: ref,
    checks,
    adminCompletionNotifications: n.data,
    adminRecipientRows: recipient.data.length,
    patientOnboardingNotificationRows: 0,
  };
  await writeFile(
    'artifacts/single-email-onboarding-validation/live-security.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch {
  console.error(
    'Live onboarding security verification failed at ' + stage + '; no secrets logged.',
  );
  process.exitCode = 1;
}
