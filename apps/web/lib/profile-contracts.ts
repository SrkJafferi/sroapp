import { z } from 'zod';
export const profileKind = z.enum(['profile', 'doctor', 'patient']);
export type ProfileKind = z.infer<typeof profileKind>;
export const profileTarget = z
  .object({ organizationId: z.uuid(), kind: profileKind, id: z.uuid() })
  .strict();
export type ProfileTarget = z.infer<typeof profileTarget>;
export const profileFields = z
  .object({
    name: z.string().trim().min(2).max(120),
    gender: z.enum(['Male', 'Female', 'Other', 'Not recorded']).optional(),
    qualifications: z.string().trim().max(300).optional(),
    experience: z.coerce.number().int().min(0).max(80).optional(),
    bio: z.string().trim().max(4000).optional(),
    email: z.union([z.email().max(254), z.literal('')]).optional(),
    phone: z.string().trim().max(40).optional(),
    address: z.string().trim().max(1000).optional(),
    bloodGroup: z.enum(['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
    ageYears: z.preprocess(
      (value) =>
        value === '' || value === null || value === undefined ? undefined : Number(value),
      z.number().int().min(0).max(120).optional(),
    ),
  })
  .strict();
export type ProfileFields = z.infer<typeof profileFields>;
export type EditableProfile = ProfileTarget &
  Omit<ProfileFields, 'ageYears'> & {
    userId: string | null;
    loginEmail: string | null;
    loginEmailVisible?: boolean;
    canEdit: boolean;
    avatarId: string | null;
    ageYears?: number | null;
    ageSource?: 'recorded' | null;
    ageRecordedOn?: string | null;
    canEditBloodGroup?: boolean;
  };
export type ProfileAsset = ProfileTarget & { avatarId: string; userId: string | null };
export const PROFILE_CHANGED = 'sro:profile-changed';
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_BUCKET = 'clinic-profile-avatars';
export function avatarSelectionError(file: { name: string; size: number; type: string }) {
  if (!file.size || file.size > MAX_AVATAR_BYTES) return 'Choose an image up to 2 MB.';
  const types: Record<string, string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
  };
  if (!types[file.type]?.includes(file.name.split('.').at(-1)?.toLowerCase() ?? ''))
    return 'Choose a JPEG, PNG or WebP image.';
  return '';
}
