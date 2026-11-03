import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '@/lib/supabase/server';
import { limit } from '@/lib/auth/rate-limit';
import { parseDiscoveryFeed } from '@sro/data-access/public-discovery';

const organization = '88645fbe-34da-48aa-a509-c24441b7cf72';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  if (new URL(request.url).search)
    return Response.json({ error: 'Unsupported query.' }, { status: 400, headers });
  try {
    // Supplemental per-process limiter; edge-wide protection required for multi-instance rollout.
    limit(
      'public-discovery',
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
      60,
      60_000,
    );
  } catch {
    return Response.json(
      { error: 'Please try again shortly.' },
      { status: 429, headers: { ...headers, 'Retry-After': '60' } },
    );
  }
  try {
    const { url, key } = publicConfig();
    // Separate anonymous client: no cookies, user JWT, service key or clinical snapshot reads.
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const result = await client
      .rpc('get_public_discovery', { p_organization_id: organization })
      .abortSignal(AbortSignal.timeout(8000));
    if (result.error) throw Error('Publication unavailable');
    return Response.json(parseDiscoveryFeed(result.data), { headers });
  } catch {
    return Response.json(
      { error: 'Public clinic information is currently unavailable.' },
      { status: 503, headers },
    );
  }
}
