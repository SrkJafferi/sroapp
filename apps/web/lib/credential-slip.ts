export type CredentialSlip = { name: string; patientCode: string; temporaryPassword: string };
export function credentialText(slip: CredentialSlip) {
  return `SRO Clinic\n${slip.name}\nPatient ID: ${slip.patientCode}\nTemporary Password: ${slip.temporaryPassword}\nChange this password at first sign-in. Keep this slip private.`;
}
// All variable values enter text nodes, never HTML, URLs or persistent storage.
export function buildCredentialPrint(doc: Document, slip: CredentialSlip, origin: string) {
  doc.title = 'SRO Clinic — Private login credentials';
  doc.documentElement.lang = 'en';
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  doc.head.append(referrer);
  const style = doc.createElement('style');
  style.textContent = `@page{size:A5 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;background:white;color:#211845;font:16px/1.6 Arial,sans-serif}.slip{max-width:560px;margin:auto;padding:28px;border:1px solid #dfd8ed;border-radius:16px}.brand{width:230px;max-width:100%;height:auto}h1{font-size:27px;margin:22px 0 6px}h2{font-size:17px;color:#0b8c50;margin:0}dt{color:#625575;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-top:20px}dd{margin:5px 0;overflow-wrap:anywhere;font-size:16px}.secret{font-family:monospace;font-size:20px;font-weight:bold;padding:15px;background:#f4f0fa;border:1px dashed #b3a2d1;border-radius:8px}.note{margin-top:24px;padding:15px 18px;border-left:4px solid #098c54;background:#f0faf5}.privacy{font-size:12.5px;color:#625575;margin-top:26px}@media print{body{display:flex;align-items:center;min-height:182mm}.slip{border:0;padding:0;width:100%;max-width:none}.secret{print-color-adjust:exact}}`;
  doc.head.append(style);
  const article = doc.createElement('article');
  article.className = 'slip';
  const logo = doc.createElement('img');
  logo.src = new URL('/sro-logo.png', origin).href;
  logo.alt = 'Social Responsibility Organization';
  logo.className = 'brand';
  article.append(logo);
  const text = (tag: string, value: string, className?: string) => {
    const el = doc.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  };
  article.append(
    text('h1', 'Your clinic account'),
    text('h2', 'Private Patient login credentials'),
  );
  const dl = doc.createElement('dl');
  for (const [label, value] of [
    ['Patient name', slip.name],
    ['Patient ID', slip.patientCode],
    ['Temporary password', slip.temporaryPassword],
  ])
    dl.append(
      text('dt', label),
      text('dd', value, label === 'Temporary password' ? 'secret' : undefined),
    );
  article.append(
    dl,
    text(
      'p',
      'Sign in using your Patient ID and temporary password. You must choose a new private password before accessing your Dashboard or medical records.',
      'note',
    ),
    text(
      'p',
      'Keep this slip private. Do not share it or leave it at a public printer. Your existing password cannot be retrieved; contact the clinic if this slip is lost.',
      'privacy',
    ),
  );
  doc.body.replaceChildren(article);
  return logo;
}
