import type { ClinicalSnapshot } from './clinical-contracts';
import type { EditableProfile } from './profile-contracts';
export function patchProfile(
  snapshot: ClinicalSnapshot,
  profile: EditableProfile,
): ClinicalSnapshot {
  if (snapshot.organizationId !== profile.organizationId) return snapshot;
  const { name, id, kind } = profile;
  const initials = name
    .replace(/^Dr\.\s*/i, '')
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const own =
    (kind === 'profile' && snapshot.actor.id === id) ||
    (kind === 'doctor' && snapshot.actor.doctorId === id) ||
    (kind === 'patient' && snapshot.actor.patientId === id);
  return {
    ...snapshot,
    actor: own ? { ...snapshot.actor, name } : snapshot.actor,
    state: {
      ...snapshot.state,
      profiles: snapshot.state.profiles.map((p) =>
        p.id === (kind === 'profile' ? id : profile.userId) ? { ...p, name } : p,
      ),
      doctors: snapshot.state.doctors.map((d) =>
        kind === 'doctor' && d.id === id
          ? {
              ...d,
              name,
              initials,
              gender: profile.gender ?? d.gender,
              qualifications: profile.qualifications ?? d.qualifications,
              experience: profile.experience ?? d.experience,
              bio: profile.bio ?? d.bio,
              email: profile.email ?? d.email,
              specializationId: profile.specializationId ?? d.specializationId,
            }
          : d,
      ),
      patients: snapshot.state.patients.map((p) =>
        kind === 'patient' && p.id === id
          ? {
              ...p,
              name,
              initials,
              gender: profile.gender ?? p.gender,
              ...(typeof profile.ageYears === 'number'
                ? {
                    ageYears: profile.ageYears,
                    ageRecordedOn: profile.ageRecordedOn ?? undefined,
                  }
                : {}),
              phone: profile.phone ?? p.phone,
              email: profile.email ?? p.email,
              address: profile.address ?? p.address,
              history:
                profile.bloodGroup === undefined
                  ? p.history
                  : { ...p.history, bloodGroup: profile.bloodGroup },
            }
          : p,
      ),
    },
  };
}
