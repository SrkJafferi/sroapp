import { patientIdSignIn, patientAccessSelf } from '@/lib/patient-access-server';
import {
  isPatientIdAttempt,
  isReservedPatientIdentity,
  pilotExecutionEnabled,
} from '@/lib/patient-access-pilot-policy';
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  loginSchema,
  passwordSchema,
  authSignupSchema as signup,
  authPatientProfileSchema as patient,
} from '@sro/validation';
import { sessionClient } from '@/lib/supabase/server';
import { provisioningClient, provisioningCommand } from '@/lib/supabase/admin';
import { authenticatedSession, loadIdentity } from '@/lib/auth/session';
import { hasWorkspace } from '@/lib/auth/policy';
import { appOrigin, sendAccountEmail } from '@/lib/auth/mail';
import { limit } from '@/lib/auth/rate-limit';
import { recoveryProof, validRecovery } from '@/lib/auth/recovery';
import { savedInvitation } from '@/lib/auth/doctor-onboarding';

const uuid = z.uuid();
const tokenHash = (token: string) => '\\x' + createHash('sha256').update(token).digest('hex');
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!['session', 'account'].includes(action)) return json({ error: 'Not found.' }, 404);
  const session = await authenticatedSession();
  if (!session) return json({ error: 'Please sign in.' }, 401);
  if (session.needsMfa) return json({ next: '/auth/two-factor' });
  if (session.needsPasswordChange) return json({ next: '/auth/change-password' });
  const identity = await loadIdentity();
  if (action === 'account') {
    const { data: patient } = await session.client
      .from('patients')
      .select('name,phone,gender,address')
      .eq('user_id', session.user.id)
      .maybeSingle();
    const branches = await session.client
      .from('branches')
      .select('id,name,organization_id')
      .eq('active', true);
    const specialties = await session.client
      .from('specializations')
      .select('id,name,organization_id');
    const adminBranches =
      identity?.memberships.filter((m) => m.roles.includes('admin')).flatMap((m) => m.branchIds) ??
      [];
    return json({
      patient,
      branches: (branches.data ?? []).filter((b) => adminBranches.includes(b.id)),
      specializations: specialties.data ?? [],
    });
  }
  return json({ identity, next: identity ? '/auth/continue' : '/auth/login' });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    // Explicit Origin check on every cookie-authenticated mutation, including login/logout.
    if (request.headers.get('origin') !== appOrigin())
      return json({ error: 'Request origin refused.' }, 403);
    if (Number(request.headers.get('content-length') ?? 0) > 8192)
      return json({ error: 'Request too large.' }, 413);
    const text = await request.text();
    if (text.length > 8192) return json({ error: 'Request too large.' }, 413);
    const input = JSON.parse(text || '{}');
    const { action } = await params;
    const client = await sessionClient();
    if (
      action === 'login' &&
      (isPatientIdAttempt(input.email) || isReservedPatientIdentity(input.email))
    ) {
      const data = z
        .object({ email: z.string().min(3).max(254), password: z.string().min(1).max(128) })
        .parse(input);
      try {
        const login = await patientIdSignIn(
          data.email,
          data.password,
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
        );
        const session = await authenticatedSession();
        if (session?.needsMfa) return json({ next: '/auth/two-factor' });
        if (login.access?.state === 'change_required')
          return json({ next: '/auth/change-password' });
        const identity = await loadIdentity();
        return json({ next: identity ? '/auth/continue' : '/auth/account-ready' });
      } catch (error) {
        console.warn('Patient ID sign-in rejected', {
          authCode: (error as { authCode?: string } | null)?.authCode ?? 'unknown',
        });
        return json({ error: 'Sign-in failed. Check your Patient ID or email and password.' }, 400);
      }
    }
    if (action === 'login') {
      const data = loginSchema.parse(input);
      limit('login', data.email, 10);
      const { error } = await client.auth.signInWithPassword(data);
      if (error)
        return json(
          { error: 'Sign-in failed. Check your email, password and email verification.' },
          400,
        );
      const session = await authenticatedSession();
      if (session?.needsMfa) return json({ next: '/auth/two-factor' });
      const identity = await loadIdentity();
      return json({ next: identity ? '/auth/continue' : '/auth/account-ready' });
    }
    if (action === 'signup' || action === 'forgot') {
      if (isReservedPatientIdentity(input.email))
        return json({ message: 'If eligible, your email request will be processed.' });
      const data =
        action === 'signup' ? signup.parse(input) : z.object({ email: z.email() }).parse(input);
      limit('email', data.email, 3, 60 * 60_000);
      await provisioningCommand('phase2b_email_limit', {
        p_hash: createHash('sha256').update(data.email.toLowerCase()).digest('hex'),
      });
      // generateLink does not send Supabase SMTP mail. Delivery stays in this server-only Resend adapter.
      const admin = provisioningClient();
      const result =
        action === 'signup'
          ? await admin.auth.admin.generateLink({
              type: 'signup',
              email: data.email,
              password: (data as z.infer<typeof signup>).password,
              options: { data: { name: (data as z.infer<typeof signup>).name, demo_only: true } },
            })
          : await admin.auth.admin.generateLink({ type: 'recovery', email: data.email });
      if (!result.error && result.data.properties?.hashed_token) {
        const link = new URL('/auth/verify-email', appOrigin());
        link.hash = new URLSearchParams({
          token_hash: result.data.properties.hashed_token,
          type: action === 'signup' ? 'signup' : 'recovery',
        }).toString();
        await sendAccountEmail(
          data.email,
          action === 'signup' ? 'Verify your SRO Clinic account' : 'Reset your SRO Clinic password',
          'Open the link and confirm to continue. This link expires and can be used once.',
          link.toString(),
          randomUUID(),
        );
      }
      // Same response for absent/existing accounts; never expose GoTrue administrative errors.
      return json({
        message:
          'If your request is eligible, a verification email has been sent. Check your inbox or contact the clinic.',
      });
    }
    if (action === 'verify') {
      const data = z
        .object({
          token_hash: z.string().min(20).max(512),
          type: z.enum(['signup', 'recovery', 'magiclink']),
        })
        .parse(input);
      limit('verify', data.token_hash, 5);
      const { data: verified, error } = await client.auth.verifyOtp(data);
      if (error || !verified.user)
        return json({ error: 'The email link is invalid, expired or already used.' }, 400);
      if (data.type === 'recovery') {
        (await cookies()).set('sro-recovery', recoveryProof(verified.user.id), {
          httpOnly: true,
          sameSite: 'strict',
          secure: appOrigin().startsWith('https:'),
          path: '/',
          maxAge: 600,
        });
      }
      return json({
        next:
          data.type === 'recovery'
            ? '/auth/reset'
            : (await savedInvitation())
              ? '/auth/invitation'
              : '/auth/account-ready',
      });
    }
    if (action === 'logout') {
      // Revoke delivery bindings before invalidating cookies/sessions. Fail
      // closed if active push infrastructure cannot confirm revocation.
      await (await import('@/lib/push/server')).revokePushBeforeLogout();
      const { error } = await client.auth.signOut({ scope: 'global' });
      if (error) return json({ error: 'Sign-out could not be confirmed. Please retry.' }, 503);
      (await cookies()).delete('sro-recovery');
      return json({ next: '/auth/login' });
    }
    const session = await authenticatedSession();
    if (!session) return json({ error: 'Please sign in.' }, 401);
    if (session.needsMfa && !['mfa-list', 'mfa-verify'].includes(action))
      return json({ error: 'Authenticator verification required.', next: '/auth/two-factor' }, 403);
    if (session.needsPasswordChange && !['mfa-list', 'mfa-verify'].includes(action))
      return json(
        { error: 'Choose your private password first.', next: '/auth/change-password' },
        403,
      );
    limit(action, session.user.id, 15);
    if (action === 'reset') {
      const data = z.object({ password: passwordSchema }).parse(input);
      const jar = await cookies();
      if (!validRecovery(jar.get('sro-recovery')?.value, session.user.id))
        return json({ error: 'Open a new password recovery email first.' }, 403);
      const { error } = await client.auth.updateUser(data);
      if (error) return json({ error: 'Password could not be updated.' }, 400);
      jar.delete('sro-recovery');
      await client.auth.signOut({ scope: 'global' });
      return json({ next: '/auth/login', message: 'Password updated. Please sign in again.' });
    }
    if (action === 'profile') {
      if (
        isReservedPatientIdentity(session.user.email) ||
        (pilotExecutionEnabled() && (await patientAccessSelf(session.user.id))?.internal)
      )
        return json({ error: 'Update your existing Patient profile from your workspace.' }, 403);
      await provisioningCommand('phase2b_patient', {
        p_user: session.user.id,
        p_data: patient.parse(input),
      });
      return json({ next: '/patient', message: 'Patient profile saved.' });
    }
    if (action === 'accept-invitation') {
      return json(
        { error: 'Complete your original Doctor invitation onboarding to activate your account.' },
        409,
      );
    }
    if (action === 'invite') {
      const identity = await loadIdentity();
      if (!identity || !hasWorkspace(identity, 'admin'))
        return json({ error: 'Administrator required.' }, 403);
      const data = z
        .object({
          branchId: uuid,
          specializationId: uuid,
          name: z.string().trim().min(3).max(200),
          email: z.email(),
        })
        .parse(input);
      if (
        !identity.memberships.some(
          (m) => m.roles.includes('admin') && m.branchIds.includes(data.branchId),
        )
      )
        return json({ error: 'Branch administrator required.' }, 403);
      const token = randomBytes(32).toString('base64url');
      const result = (await provisioningCommand('phase2b_invite', {
        p_actor: identity.id,
        p_branch: data.branchId,
        p_specialization: data.specializationId,
        p_name: data.name,
        p_email: data.email,
        p_hash: tokenHash(token),
      })) as { id: string };
      const link = new URL('/auth/invitation', appOrigin());
      link.hash = new URLSearchParams({ id: result.id, token }).toString();
      try {
        await sendAccountEmail(
          data.email,
          'Your SRO Clinic doctor invitation',
          'You have been invited to join SRO Clinic as a Doctor. Open this private invitation within 24 hours to complete your profile, create your account and choose optional authenticator security. No separate signup verification email is required.',
          link.toString(),
          result.id,
        );
        await provisioningCommand('phase2b_invitation_delivery', {
          p_actor: identity.id,
          p_id: result.id,
          p_sent: true,
        });
      } catch {
        await provisioningCommand('phase2b_invitation_delivery', {
          p_actor: identity.id,
          p_id: result.id,
          p_sent: false,
        });
        return json(
          {
            error:
              'Invitation delivery could not be confirmed. The invitation was revoked; retry later.',
          },
          503,
        );
      }
      return json({ message: 'Invitation sent. It expires in 24 hours and can be used once.' });
    }
    if (action === 'mfa-list') {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw new Error('Unable to load authenticators.');
      return json({
        factors: data.totp.map((f) => ({ id: f.id, status: f.status, name: f.friendly_name })),
      });
    }
    if (action === 'mfa-enroll') {
      const { data, error } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `SRO Clinic ${new Date().toISOString().slice(0, 19)}`,
      });
      if (error) throw new Error('Authenticator enrollment failed.');
      return json({ factorId: data.id, qr: data.totp.qr_code });
    }
    if (action === 'mfa-verify') {
      const data = z.object({ factorId: uuid, code: z.string().regex(/^\d{6}$/) }).parse(input);
      const { error } = await client.auth.mfa.challengeAndVerify(data);
      if (error) return json({ error: 'Authenticator code invalid or expired.' }, 400);
      return json({
        next: (await savedInvitation()) ? '/auth/invitation' : '/auth/continue',
        message: 'Authenticator verified.',
      });
    }
    if (action === 'mfa-remove') {
      const data = z.object({ factorId: uuid }).parse(input);
      const { error } = await client.auth.mfa.unenroll(data);
      if (error) return json({ error: 'Verify your authenticator before removing it.' }, 400);
      return json({ message: 'Authenticator removed.' });
    }
    return json({ error: 'Unknown operation.' }, 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? 'Invalid details.')
            : error instanceof Error &&
                /^(Account provisioning|Clinic account activation|Too many|Email delivery|Verified server|HTTPS application|Authenticator|Unable to load)/.test(
                  error.message,
                )
              ? error.message
              : 'Unable to complete this request. Please try again or contact the clinic.',
      },
      400,
    );
  }
}
