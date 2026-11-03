import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { appOrigin } from '@/lib/auth/mail';
import { limit } from '@/lib/auth/rate-limit';
import { authenticatedSession } from '@/lib/auth/session';
import { provisioningClient, provisioningCommand } from '@/lib/supabase/admin';
import { sessionClient } from '@/lib/supabase/server';
import { deliverDoctorWelcome } from '@/lib/auth/doctor-welcome';
import {
  invitationProof,
  previewInvitation,
  savedInvitation,
  storeInvitation,
  onboardingCookie,
  doctorDetails,
} from '@/lib/auth/doctor-onboarding';
import { passwordSchema } from '@sro/validation';
export const maxDuration = 120;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
const deferWelcome = (id: string) =>
  after(async () => {
    try {
      await deliverDoctorWelcome(id);
    } catch {
      /* Durable outbox retains safe retry state. */
    }
  });
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== appOrigin())
      return reply({ error: 'Request origin refused.' }, 403);
    const text = await request.text();
    if (text.length > 10000) return reply({ error: 'Request too large.' }, 413);
    const input = z
      .object({
        action: z.enum(['preview', 'start', 'activate', 'finish', 'close']),
        proof: invitationProof.optional(),
        password: passwordSchema.optional(),
        details: doctorDetails.optional(),
      })
      .strict()
      .parse(JSON.parse(text));
    const proof = input.proof ?? (await savedInvitation());
    if (!proof) return reply({ error: 'Open your original invitation email.' }, 400);
    limit('doctor-invitation', proof.id, 30);
    let session = await authenticatedSession();
    let invitation: Awaited<ReturnType<typeof previewInvitation>>;
    try {
      invitation = await previewInvitation(proof, session?.user.id);
    } catch (error) {
      if (session && !session.needsMfa && ['preview', 'close'].includes(input.action)) {
        try {
          const assurance = await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
          if (assurance.error) throw error;
          await provisioningCommand('phase2b_onboarding', {
            p_action: 'receipt',
            p_invitation: proof.id,
            p_hash: null,
            p_user: session.user.id,
            p_aal: assurance.data.currentLevel,
          });
          (await cookies()).delete(onboardingCookie);
          return reply({ finished: true, next: '/doctor' });
        } catch {
          /* No completed identity recovery; original invitation failure stays authoritative. */
        }
      }
      throw error;
    }
    if (input.proof) await storeInvitation(proof, appOrigin().startsWith('https:'));
    const matches = () =>
      !!session && session.user.email?.toLowerCase() === invitation.email.toLowerCase();
    if (input.action === 'preview') {
      const assurance = matches()
        ? await session!.client.auth.mfa.getAuthenticatorAssuranceLevel()
        : null;
      if (assurance?.error) return reply({ error: 'Unable to verify account security.' }, 503);
      return reply({
        invitation,
        verified: matches(),
        securityVerified: assurance?.data?.currentLevel === 'aal2',
      });
    }
    const hash = '\\x' + createHash('sha256').update(proof.token).digest('hex');
    const command = (action: string, extra: object = {}) =>
      provisioningCommand('phase2b_onboarding', {
        p_action: action,
        p_invitation: proof.id,
        p_hash: hash,
        ...extra,
      });
    if (input.action === 'start') {
      const password = passwordSchema.parse(input.password);
      doctorDetails.parse(input.details); // Validate before creating any Auth identity.
      limit('doctor-registration', proof.id, 5, 3600000);
      // Capability must be deployed before any Auth mutation; lookup is exact-invitation-email only.
      const prepared = z
        .object({
          existingUserId: z.uuid().nullable(),
          recoverable: z.boolean().optional().default(false),
        })
        .parse(await command('prepare'));
      let recovered = false;
      if (prepared.existingUserId && prepared.recoverable) {
        // Database-proven: sole unverified app-created identity inside this invitation's history.
        // Never confirm or reset a verified identity; recheck GoTrue immediately before mutation.
        const existingId = prepared.existingUserId;
        const admin = provisioningClient();
        const eligibleUser = async () => {
          const current = await admin.auth.admin.getUserById(existingId);
          const user = current.error ? null : current.data.user;
          return user &&
            !user.email_confirmed_at &&
            user.email?.toLowerCase() === invitation.email.toLowerCase()
            ? user
            : null;
        };
        // Revalidate the pending invitation proof and provenance in the database immediately
        // before every privileged Auth mutation; revoked, rotated, expired or consumed proofs
        // and identities that became verified or gained access make this false.
        const revalidate = async () => {
          try {
            const fresh = z
              .object({
                existingUserId: z.uuid().nullable(),
                recoverable: z.boolean().optional().default(false),
              })
              .parse(await command('prepare'));
            return fresh.existingUserId === existingId && fresh.recoverable;
          } catch {
            return false;
          }
        };
        const refused = () =>
          reply(
            {
              error:
                'This invitation cannot safely reopen that unverified account. Complete its original verification email, use Forgot password, or contact support. No password was changed.',
            },
            409,
          );
        if (!(await eligibleUser())) return refused();
        const probe = await (await sessionClient()).auth.signInWithPassword({
          email: invitation.email,
          password,
        });
        const code = probe.error?.code ?? '';
        if (!probe.error && probe.data.user?.email_confirmed_at) {
          recovered = true;
        } else if (code === 'email_not_confirmed') {
          // Correct password already proves ownership; confirm without replacing it.
          if (!(await eligibleUser()) || !(await revalidate())) return refused();
          const confirmed = await admin.auth.admin.updateUserById(existingId, {
            email_confirm: true,
          });
          if (confirmed.error)
            return reply(
              {
                error:
                  'Account activation could not be completed. Please retry with the same password.',
              },
              503,
            );
          recovered = true;
        } else if (code === 'invalid_credentials') {
          // Wrong password on a proven app-created pending identity: set only this identity's password.
          if (!(await eligibleUser()) || !(await revalidate())) return refused();
          const activated = await admin.auth.admin.updateUserById(existingId, {
            email_confirm: true,
            password,
          });
          if (activated.error)
            return reply(
              {
                error:
                  'Account activation could not be completed. Please retry with the same password.',
              },
              503,
            );
          recovered = true;
        } else {
          return reply(
            { error: 'Unable to verify the earlier account right now. Please retry in a moment.' },
            503,
          );
        }
      }
      if (!prepared.existingUserId) {
        await provisioningCommand('phase2b_email_limit', {
          p_hash: createHash('sha256').update(invitation.email.toLowerCase()).digest('hex'),
        });
        // Revalidate the pending proof immediately before creating an Auth identity; if another
        // request established the identity first, never create a duplicate — sign-in decides.
        const stillPending = z
          .object({ existingUserId: z.uuid().nullable() })
          .parse(await command('prepare'));
        // The validated invitation is the ownership proof, scoped solely to this new invited email.
        // Never confirm, update or reset an existing user's credentials.
        const created = stillPending.existingUserId
          ? null
          : await provisioningClient().auth.admin.createUser({
              email: invitation.email,
              password,
              email_confirm: true,
              user_metadata: { name: invitation.name },
            });
        if (
          created?.error &&
          !['email_exists', 'user_already_exists'].includes(created.error.code ?? '')
        )
          return reply(
            {
              error:
                'Account creation could not be confirmed. Please retry using the same password. No existing account credentials were changed.',
            },
            503,
          );
        // A concurrent create may have won. Only the correct existing password can establish a session.
      }
      const client = await sessionClient();
      const login = await client.auth.signInWithPassword({ email: invitation.email, password });
      if (login.error || !login.data.user?.email_confirmed_at)
        return reply(
          {
            error: recovered
              ? 'Your account is verified. Retry registration with the same password.'
              : 'Unable to sign in. If this email already has an account, use its existing password and verified login. An earlier unverified account must complete its original verification or contact support. No existing password was changed.',
          },
          recovered ? 503 : 409,
        );
      session = await authenticatedSession();
    }
    if (!matches() || !session)
      return reply({ error: 'Sign in to the matching verified invited account.' }, 403);
    if (session.needsMfa)
      return reply(
        { error: 'Verify your existing authenticator to continue.', next: '/auth/two-factor' },
        403,
      );
    if (input.action === 'start' || input.action === 'activate') {
      const details = doctorDetails.parse(input.details);
      const fields = {
        name: details.name,
        gender: details.gender,
        ...(details.experience !== undefined ? { experience: details.experience } : {}),
      };
      await command('stage', { p_user: session.user.id, p_fields: fields });
      return reply({ invitation: { ...invitation, profileReady: true }, verified: true });
    }
    if (input.action === 'finish') {
      const assurance = await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) return reply({ error: 'Unable to verify account security.' }, 503);
      const result = z.object({ doctorId: z.uuid(), completed: z.literal(true) }).parse(
        await command('complete', {
          p_user: session.user.id,
          p_aal: assurance.data.currentLevel,
          p_origin: appOrigin(),
        }),
      );
      deferWelcome(proof.id); // Email latency/failure never rolls back committed activation.
      return reply({
        invitation: {
          ...invitation,
          doctorId: result.doctorId,
          accepted: true,
          profileReady: true,
        },
      });
    }
    if (!invitation.accepted) return reply({ error: 'Complete account security first.' }, 409);
    const assurance = await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) return reply({ error: 'Unable to verify account security.' }, 503);
    await command('close', { p_user: session.user.id, p_aal: assurance.data.currentLevel });
    deferWelcome(proof.id);
    (await cookies()).delete(onboardingCookie);
    return reply({ next: '/doctor' });
  } catch (e) {
    return reply(
      {
        error:
          e instanceof z.ZodError
            ? 'Check the onboarding fields and try again.'
            : e instanceof Error && e.message.startsWith('Clinic account activation')
              ? e.message
              : 'This invitation cannot continue. It may be unavailable, expired or revoked, or awaiting the approved onboarding update. Contact the clinic if the problem continues.',
      },
      400,
    );
  }
}
