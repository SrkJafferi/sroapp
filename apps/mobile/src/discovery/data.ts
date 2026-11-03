import { parseDiscoveryFeed, type DiscoveryFeed } from '@sro/data-access/public-discovery';
export * from '@sro/data-access/public-discovery';
import { discoveryApiOrigin } from './origin';
export async function loadDiscoveryFeed(signal: AbortSignal): Promise<DiscoveryFeed> {
  const origin = discoveryApiOrigin();
  if (!origin) throw Error('Approved clinic connection is unavailable.');
  const response = await fetch(origin + '/api/public/discovery', {
    signal,
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    throw Error('Public clinic information is currently unavailable.');
  const body = await response.text();
  if (body.length > 1_000_000) throw Error('Public feed too large.');
  return parseDiscoveryFeed(JSON.parse(body));
}
