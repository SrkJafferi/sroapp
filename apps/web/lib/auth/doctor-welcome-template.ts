// Pure rendering: no credentials, Auth proof, medical data or browser-provided links.
export type DoctorWelcome = {
  name: string;
  email: string;
  branch: string;
  department: string;
  dashboardUrl: string;
  templateVersion: 'v1';
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function doctorWelcomeTemplate(data: DoctorWelcome) {
  const url = new URL(data.dashboardUrl);
  if (
    url.pathname !== '/doctor' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw Error('Invalid welcome destination.');
  const subject = 'Welcome to SRO Clinic — Your Doctor Account Is Ready';
  const text = `Welcome, ${data.name}.\n\nYour Doctor account is active.\nDepartment: ${data.department}\nClinic branch: ${data.branch}\nVerified login email: ${data.email}\n\nOpen Doctor Dashboard: ${data.dashboardUrl}\n\nYou can complete your professional profile and manage optional authenticator security in Settings.\nNeed help? Contact support@sropk.org.\n\nSocial Responsibility Organization · Pakistan`;
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#f5f6fb;font-family:Arial,sans-serif;color:#211746"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #e8e3f2;border-radius:16px"><tr><td style="padding:28px 28px 12px"><img src="cid:sro-logo" alt="SRO Clinic — Social Responsibility Organization" width="210" style="max-width:100%;height:auto"><p style="font-size:12px;letter-spacing:2px;color:#087c50;margin-top:28px">WELCOME TO YOUR CARE TEAM</p><h1 style="font-size:27px;line-height:1.3;margin:12px 0">Welcome, ${escape(data.name)}</h1><p style="color:#62617a;line-height:1.7">Your Doctor account is active and ready. We’re pleased to welcome you to SRO Clinic.</p></td></tr><tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="12" style="background:#f7f5fc;border-radius:10px;font-size:14px"><tr><td>Department<br><strong>${escape(data.department)}</strong></td></tr><tr><td>Clinic branch<br><strong>${escape(data.branch)}</strong></td></tr><tr><td>Verified login email<br><strong style="overflow-wrap:anywhere">${escape(data.email)}</strong></td></tr></table></td></tr><tr><td style="padding:24px 28px 28px"><a href="${escape(data.dashboardUrl)}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#38216b;color:#fff;text-decoration:none;font-weight:bold">Open Doctor Dashboard</a><p style="font-size:14px;line-height:1.7;color:#62617a">Complete your professional profile and manage optional authenticator security in Settings.</p><p style="font-size:13px;color:#62617a">Need help? <a href="mailto:support@sropk.org" style="color:#38216b">support@sropk.org</a></p><p style="font-size:11px;color:#858294;border-top:1px solid #edeaf4;padding-top:18px">Social Responsibility Organization · Pakistan</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
