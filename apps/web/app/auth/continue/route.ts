import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authenticatedSession, loadIdentity } from '@/lib/auth/session';
import { discoveryDestination, discoveryIntent } from '@/lib/auth/discovery-intent';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const requested = discoveryIntent(url.searchParams.get('intent'));
  const intent = requested ?? discoveryIntent(jar.get('sro-discovery-intent')?.value);
  const session = await authenticatedSession();
  let path = '/auth/login';
  if (session?.needsMfa) path = '/auth/two-factor';
  else if (session?.needsPasswordChange) path = '/auth/change-password';
  else if (session) {
    const identity = await loadIdentity();
    path = identity ? discoveryDestination(identity, intent) : '/auth/account-ready';
  }
  const response = NextResponse.redirect(new URL(path, url.origin));
  response.headers.set('Cache-Control', 'private, no-store');
  if (intent && path.startsWith('/auth/')) {
    response.cookies.set('sro-discovery-intent', intent, {
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      path: '/',
      maxAge: 1800,
    });
  } else response.cookies.delete('sro-discovery-intent');
  return response;
}
