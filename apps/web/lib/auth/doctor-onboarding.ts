import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { provisioningCommand } from '../supabase/admin';
export const invitationProof = z
  .object({ id: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const doctorDetails = z
  .object({
    name: z.string().trim().min(3).max(120),
    gender: z.enum(['Male', 'Female', 'Other', 'Not recorded']),
    qualifications: z.string().trim().max(300).optional(),
    experience: z.number().int().min(0).max(80).optional(),
    bio: z.string().trim().max(4000).optional(),
    email: z.union([z.email(), z.literal('')]).optional(),
  })
  .strict();
export const onboardingCookie = 'sro-doctor-invitation';
const key = () => {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw Error('Onboarding unavailable');
  return createHash('sha256')
    .update('sro-doctor-onboarding-v1\0' + secret)
    .digest();
};
export async function storeInvitation(value: z.infer<typeof invitationProof>, secure: boolean) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  (await cookies()).set(
    onboardingCookie,
    Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'),
    { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 86400 },
  );
}
export async function savedInvitation() {
  try {
    const raw = (await cookies()).get(onboardingCookie)?.value;
    if (!raw) return null;
    const b = Buffer.from(raw, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    return invitationProof.parse(
      JSON.parse(
        Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8'),
      ),
    );
  } catch {
    return null;
  }
}
export async function previewInvitation(proof: z.infer<typeof invitationProof>, userId?: string) {
  const result = await provisioningCommand('phase2b_invitation_preview', {
    p_id: proof.id,
    p_hash: '\\x' + createHash('sha256').update(proof.token).digest('hex'),
    p_user: userId ?? null,
  });
  return z
    .object({
      id: z.uuid(),
      name: z.string(),
      email: z.email(),
      organizationId: z.uuid(),
      branchId: z.uuid(),
      branch: z.string(),
      specializationId: z.uuid(),
      specialization: z.string(),
      accepted: z.boolean(),
      profileReady: z.boolean().optional().default(false),
      doctorId: z.uuid().nullable(),
    })
    .parse(result);
}
