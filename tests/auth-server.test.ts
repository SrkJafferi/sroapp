// Run with --conditions=react-server so the standard server-only package permits imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendAccountEmail } from '../apps/web/lib/auth/mail';
import { recoveryProof, validRecovery } from '../apps/web/lib/auth/recovery';
import { limit } from '../apps/web/lib/auth/rate-limit';
test('Resend adapter uses server credentials and verified sender without live delivery', async () => {
  process.env.RESEND_API_KEY = 'fictional-unit-test-key';
  process.env.RESEND_FROM_EMAIL = 'support@sropk.org';
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url, init) => {
    count++;
    assert.equal(url, 'https://api.resend.com/emails');
    const data = JSON.parse(String(init?.body));
    assert.equal(data.from, 'SRO Clinic <support@sropk.org>');
    assert.deepEqual(data.to, ['doctor@example.test']);
    assert.ok(data.text.includes('#id=fictional&token=fictional'));
    return new Response(JSON.stringify({ id: 'fictional-id' }), { status: 200 });
  };
  try {
    await sendAccountEmail(
      'doctor@example.test',
      'Fictional invitation',
      'Fictional test',
      'https://clinic.example.test/auth/invitation#id=fictional&token=fictional',
      'fictional-id',
    );
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('Resend failure gives a safe error and unverified sender is refused', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  try {
    await assert.rejects(
      sendAccountEmail(
        'doctor@example.test',
        'Test',
        'Test',
        'https://clinic.example.test',
        'test',
      ),
      /delivery could not be confirmed/,
    );
    process.env.RESEND_FROM_EMAIL = 'wrong@example.test';
    await assert.rejects(
      sendAccountEmail(
        'doctor@example.test',
        'Test',
        'Test',
        'https://clinic.example.test',
        'test',
      ),
      /Verified server/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('password recovery proof is user-bound, tamper-resistant and expires', () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-unit-test-signing-key';
  const now = Date.now;
  const proof = recoveryProof('fictional-user');
  try {
    assert.equal(validRecovery(proof, 'fictional-user'), true);
    assert.equal(validRecovery(proof, 'other-user'), false);
    assert.equal(validRecovery(proof + '00', 'fictional-user'), false);
    Date.now = () => now() + 601_000;
    assert.equal(validRecovery(proof, 'fictional-user'), false);
  } finally {
    Date.now = now;
  }
});
test('local limiter rejects repeated attempts', () => {
  limit('unit-test', 'fictional-subject', 1);
  assert.throws(() => limit('unit-test', 'fictional-subject', 1), /Too many attempts/);
});
