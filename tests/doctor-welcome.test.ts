import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  doctorWelcomeTemplate,
  type DoctorWelcome,
} from '../apps/web/lib/auth/doctor-welcome-template';
import { sendTransactionalEmail } from '../apps/web/lib/auth/mail';
const data: DoctorWelcome = {
  name: 'Dr. Fictional Clinician',
  email: 'doctor@example.test',
  branch: 'Fictional branch',
  department: 'General Checkup',
  dashboardUrl: 'https://clinic.example.test/doctor',
  templateVersion: 'v1',
};
test('welcome has branded HTML/plain text and one Doctor recipient without credential material', () => {
  const mail = doctorWelcomeTemplate(data);
  assert.equal(mail.subject, 'Welcome to SRO Clinic — Your Doctor Account Is Ready');
  assert.match(mail.html, /cid:sro-logo/);
  assert.match(mail.html, /name="viewport"/);
  for (const value of [
    data.name,
    data.email,
    data.branch,
    data.department,
    data.dashboardUrl,
    'support@sropk.org',
  ])
    assert.ok(mail.text.includes(value));
  assert.doesNotMatch(
    mail.text + mail.html,
    /token_hash|access_token|refresh_token|password:|MFA code|demo/i,
  );
});
test('HTML content is escaped and non-dashboard/unsafe destinations refused', () => {
  const result = doctorWelcomeTemplate({
    ...data,
    name: '<script>bad</script>',
    branch: '" & <b>',
  });
  assert.ok(result.html.includes('&lt;script&gt;'));
  assert.ok(!result.html.includes('<script>'));
  for (const dashboardUrl of [
    'javascript://localhost/doctor',
    'http://evil.example/doctor',
    'https://clinic.example.test/doctor#token=bad',
    'https://user:pass@clinic.example.test/doctor',
    'https://clinic.example.test/auth/invitation',
    'https://clinic.example.test/doctor?token=bad',
  ])
    assert.throws(() => doctorWelcomeTemplate({ ...data, dashboardUrl }));
});
test('server mail transport uses stable provider idempotency and returns a receipt', async () => {
  const before = globalThis.fetch;
  process.env.RESEND_API_KEY = 'fictional-unit-key';
  process.env.RESEND_FROM_EMAIL = 'support@sropk.org';
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(
      (options?.headers as Record<string, string>)['Idempotency-Key'],
      'doctor-welcome/fictional/v1',
    );
    requests.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ id: 'fictional-receipt' }), { status: 200 });
  };
  try {
    const receipt = await sendTransactionalEmail(
      { to: data.email, ...doctorWelcomeTemplate(data) },
      'doctor-welcome/fictional/v1',
    );
    assert.equal(receipt, 'fictional-receipt');
    assert.deepEqual(requests[0].to, [data.email]);
    assert.equal(requests[0].from, 'SRO Clinic <support@sropk.org>');
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(
      sendTransactionalEmail(
        { to: data.email, ...doctorWelcomeTemplate(data) },
        'doctor-welcome/fictional/v1',
      ),
    );
  } finally {
    globalThis.fetch = before;
  }
});
