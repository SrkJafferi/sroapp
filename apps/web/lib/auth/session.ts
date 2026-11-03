import 'server-only';
import { redirect } from 'next/navigation';
import type { AuthIdentity } from '@sro/types';
import { sessionClient } from '../supabase/server';
import { hasWorkspace } from './policy';
import { PATIENT_ACCOUNT_ACCESS_ENABLED } from '../patient-access-feature';
import { coordinatedPatientAccessRoutesEnabled } from '../patient-access-coordinated';
import { patientAccessSelf } from '../patient-access-server';
import { pilotExecutionEnabled, isReservedPatientIdentity } from '../patient-access-pilot-policy';

export async function authenticatedSession() {
  const client = await sessionClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at) return null;
  const access =
    PATIENT_ACCOUNT_ACCESS_ENABLED ||
    pilotExecutionEnabled() ||
    coordinatedPatientAccessRoutesEnabled() ||
    isReservedPatientIdentity(user.email)
      ? await patientAccessSelf(user.id)
      : null;
  if (access && !['active', 'change_required'].includes(access.state)) return null;
  if (!access && isReservedPatientIdentity(user.email)) return null;
  const { data: assurance, error: mfaError } =
    await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (mfaError) throw new Error('Unable to verify session assurance.');
  return {
    client,
    user,
    needsPasswordChange: access?.state === 'change_required',
    needsMfa: assurance?.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2',
  };
}
export async function loadIdentityFromSession(
  session: NonNullable<Awaited<ReturnType<typeof authenticatedSession>>>,
): Promise<AuthIdentity> {
  const { client, user } = session;
  const [profile, members, roles, branches, activeBranches, doctors] = await Promise.all([
    client.from('profiles').select('name,active').eq('id', user.id).maybeSingle(),
    client
      .from('organization_memberships')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('active', true),
    client.from('role_assignments').select('organization_id,role').eq('user_id', user.id),
    client
      .from('branch_memberships')
      .select('organization_id,branch_id')
      .eq('user_id', user.id)
      .eq('active', true),
    client.from('branches').select('id').eq('active', true),
    client.from('doctors').select('organization_id').eq('user_id', user.id).eq('active', true),
  ]);
  if ([profile, members, roles, branches, activeBranches, doctors].some((r) => r.error))
    throw new Error('Unable to verify clinic authorization.');
  return {
    id: user.id,
    email: user.email?.endsWith('@accounts.sro.invalid') ? '' : (user.email ?? ''),
    name: profile.data?.name ?? '',
    memberships: profile.data?.active
      ? (members.data ?? []).map((m) => ({
          organizationId: m.organization_id,
          branchIds: (branches.data ?? [])
            .filter(
              (b) =>
                b.organization_id === m.organization_id &&
                activeBranches.data?.some((a) => a.id === b.branch_id),
            )
            .map((b) => b.branch_id),
          roles: (roles.data ?? [])
            .filter(
              (r) =>
                r.organization_id === m.organization_id &&
                r.role !== 'clinical_staff' &&
                (r.role !== 'doctor' ||
                  doctors.data?.some((d) => d.organization_id === r.organization_id)),
            )
            .map((r) => r.role as 'admin' | 'doctor' | 'patient'),
        }))
      : [],
  };
}
export async function loadIdentity(): Promise<AuthIdentity | null> {
  const session = await authenticatedSession();
  if (!session) return null;
  if (session.needsMfa) redirect('/auth/two-factor');
  if (session.needsPasswordChange) redirect('/auth/change-password');
  return loadIdentityFromSession(session);
}
export async function requireWorkspace(role: string) {
  const identity = await loadIdentity();
  if (!identity) redirect('/auth/login');
  if (!hasWorkspace(identity, role)) redirect('/auth/access-denied');
  return identity;
}
