import { redirect } from 'next/navigation';
import { loadIdentity } from '@/lib/auth/session';
import { homeFor } from '@/lib/auth/policy';
export default async function Page() {
  const identity = await loadIdentity();
  redirect(identity ? homeFor(identity) : '/auth/welcome');
}
