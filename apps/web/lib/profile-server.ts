import 'server-only';
import { authenticatedSession, loadIdentityFromSession } from './auth/session';
import { ClinicalError } from './clinical-server';
import { profileTarget, type ProfileTarget, type EditableProfile } from './profile-contracts';
export async function profileSession(organizationId?: string) {
  const session = await authenticatedSession();
  if (!session) throw new ClinicalError('Please sign in.', 401);
  if (session.needsMfa) throw new ClinicalError('Authenticator verification required.', 403);
  if (session.needsPasswordChange) throw new ClinicalError('Password change required.', 403);
  const identity = await loadIdentityFromSession(session);
  const membership = identity.memberships.find(
    (m) =>
      (!organizationId || m.organizationId === organizationId) &&
      m.branchIds.length &&
      m.roles.length,
  );
  if (!membership) throw new ClinicalError('Clinic access denied.', 403);
  return { ...session, identity, membership };
}
export function profileDatabaseError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === 'PGRST202')
    throw new ClinicalError(
      'Profile updates and private photos are awaiting activation. Please contact the clinic administrator.',
      503,
    );
  if (['42501', 'P0002'].includes(error.code ?? ''))
    throw new ClinicalError('This profile action is not authorized.', 403);
  if (['23514', '23505', '54000', '22007', '22008', '22P02', '22023'].includes(error.code ?? ''))
    throw new ClinicalError(
      'Profile details or upload request are invalid. Check your entries and retry.',
      409,
    );
  throw new ClinicalError('The profile could not be saved. Please retry.', 503);
}
export async function readProfile(target: ProfileTarget) {
  const { client, user, membership } = await profileSession(target.organizationId);
  const result = await client.rpc('get_clinic_profile', {
    p_organization_id: target.organizationId,
    p_kind: target.kind,
    p_target_id: target.id,
  });
  if (result.error?.code !== 'PGRST202') {
    profileDatabaseError(result.error);
    return result.data as unknown as EditableProfile;
  }
  // Read-only compatibility while profile commands are unavailable. Never substitutes a write.
  const table =
    target.kind === 'profile' ? 'profiles' : target.kind === 'doctor' ? 'doctors' : 'patients';
  const fields =
    target.kind === 'profile'
      ? 'id,name'
      : target.kind === 'doctor'
        ? 'id,user_id,name,gender,qualifications,experience,bio,public_email'
        : 'id,user_id,name,age_years,age_recorded_on,gender,phone,email,address';
  let query = client.from(table).select(fields).eq('id', target.id);
  if (table !== 'profiles') query = query.filter('organization_id', 'eq', target.organizationId);
  const response = await query.maybeSingle();
  if (response.error) throw new ClinicalError('Unable to load this profile.', 503);
  if (!response.data) throw new ClinicalError('Profile access denied.', 403);
  const row = response.data as unknown as Record<string, string | number | null>;
  const uid = target.kind === 'profile' ? String(row.id) : (row.user_id as string | null);
  return {
    ...target,
    name: String(row.name),
    userId: uid,
    loginEmail:
      uid === user.id && !user.email?.endsWith('@accounts.sro.invalid')
        ? (user.email ?? null)
        : null,
    canEdit:
      uid === user.id &&
      membership.roles.includes(target.kind === 'profile' ? 'admin' : target.kind),
    avatarId: null,
    ...(target.kind === 'doctor'
      ? {
          gender: normalizedGender(row.gender),
          qualifications: String(row.qualifications),
          experience: Number(row.experience),
          bio: String(row.bio),
          email: String(row.public_email),
        }
      : {}),
    ...(target.kind === 'patient'
      ? {
          ageYears: typeof row.age_years === 'number' ? row.age_years : null,
          ageSource: typeof row.age_years === 'number' ? 'recorded' : null,
          ageRecordedOn: (row.age_recorded_on as string | null) ?? null,
          gender: normalizedGender(row.gender),
          phone: String(row.phone),
          email: String(row.email),
          address: String(row.address),
        }
      : {}),
  } satisfies EditableProfile;
}
function normalizedGender(value: unknown): EditableProfile['gender'] {
  return value === 'Male' || value === 'Female' || value === 'Other' ? value : 'Not recorded';
}
export function targetFromUrl(url: URL) {
  return profileTarget.parse({
    organizationId: url.searchParams.get('organizationId'),
    kind: url.searchParams.get('kind'),
    id: url.searchParams.get('id'),
  });
}
