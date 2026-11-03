import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { WorkspaceDatabase } from '@sro/types';
import { appOrigin } from '../auth/mail';

export function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Protected by default. A staging-only deployment may name its exact Supabase host.
  const allowedHost =
    process.env.SRO_ALLOWED_SUPABASE_HOST ?? 'jyigxpjvygvtvcypujel.supabase.co';
  if (!url || !key || new URL(url).hostname !== allowedHost)
    throw new Error('Supabase configuration is missing or targets another project.');
  return { url, key };
}
export async function sessionClient() {
  const jar = await cookies();
  const { url, key } = publicConfig();
  return createServerClient<WorkspaceDatabase>(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: appOrigin().startsWith('https:'),
      path: '/',
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* Server Components cannot write cookies; proxy refreshes before rendering. */
        }
      },
    },
  });
}
