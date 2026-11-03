// Explicit operator invocation after approval only. Read-only anonymous API probes.
// Reads only the two public Web settings into use; never logs environment values.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const env = await readFile('apps/web/.env.local', 'utf8');
function value(name) {
  const match = env.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.*)$', 'm'));
  let text = match?.[1]?.trim();
  if (text && (text.startsWith('"') || text.startsWith("'")))
    text = text.slice(1, text.lastIndexOf(text[0]));
  else text = text?.replace(/\s+#.*$/, '').trim();
  return text;
}
const url = value('NEXT_PUBLIC_SUPABASE_URL');
const key = value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
assert.equal(new URL(url).origin, 'https://jyigxpjvygvtvcypujel.supabase.co');
assert.ok(key, 'Protected project publishable key required');
for (const probe of [
  {
    name: 'anonymous clinic read denied',
    path: '/rest/v1/organizations?select=id',
    headers: {},
    statuses: [401, 403],
    code: '42501',
  },
  {
    name: 'private schema excluded from Data API',
    path: '/rest/v1/invitation_secrets?select=invitation_id',
    headers: { 'Accept-Profile': 'clinic_private' },
    statuses: [406],
    code: 'PGRST106',
  },
]) {
  const r = await fetch(new URL(probe.path, url), {
    headers: { apikey: key, ...probe.headers },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  assert.ok(
    probe.statuses.includes(r.status) && data.code === probe.code,
    `${probe.name}: unexpected HTTP ${r.status}`,
  );
  console.log(JSON.stringify({ check: probe.name, passed: true, status: r.status }));
}
