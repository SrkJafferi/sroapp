import 'server-only';

export function appOrigin() {
  const raw =
    process.env.SRO_APP_URL ??
    (process.env.NODE_ENV !== 'production' ? 'http://localhost:3100' : '');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('HTTPS application origin required.');
  return url.origin;
}
export async function sendAccountEmail(
  to: string,
  subject: string,
  message: string,
  link: string,
  id: string,
) {
  await sendTransactionalEmail(
    {
      to,
      subject,
      text: `${message}\n\n${link}\n\nIf you did not request this, ignore this message.`,
    },
    id,
  );
}
export async function sendTransactionalEmail(
  mail: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: { filename: string; content: string; content_id: string }[];
  },
  id: string,
) {
  const key = process.env.RESEND_API_KEY;
  if (!key || process.env.RESEND_FROM_EMAIL !== 'support@sropk.org')
    throw new Error('Verified server mail configuration is required.');
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': id,
    },
    body: JSON.stringify({
      from: 'SRO Clinic <support@sropk.org>',
      ...mail,
      to: [mail.to],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error('Email delivery could not be confirmed. Please retry later.');
  const receipt = (await result.json()) as { id?: string };
  if (!receipt.id) throw new Error('Email delivery receipt unavailable.');
  return receipt.id;
}
