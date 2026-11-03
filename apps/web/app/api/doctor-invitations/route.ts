import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { clinicalContext, ClinicalError } from '@/lib/clinical-server';
import { provisioningClient } from '@/lib/supabase/admin';
import { appOrigin, sendTransactionalEmail } from '@/lib/auth/mail';
import { limit } from '@/lib/auth/rate-limit';

const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== appOrigin())
      return response({ error: 'Request origin refused.' }, 403);
    const raw = await request.text();
    if (raw.length > 2048) return response({ error: 'Request too large.' }, 413);
    const input = z
      .object({ id: z.uuid(), organizationId: z.uuid(), action: z.enum(['resend', 'revoke']) })
      .strict()
      .parse(JSON.parse(raw));
    const context = await clinicalContext('admin', input.organizationId);
    limit('invitation-management', context.user.id, 10, 60_000);
    // Ordinary user SELECT is constrained by existing invitation RLS, not service-role listing.
    const { data: invitation, error } = await context.client
      .from('doctor_invitations')
      .select('id,branch_id')
      .eq('id', input.id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (error || !invitation || !context.membership.branchIds.includes(invitation.branch_id))
      return response({ error: 'Invitation management is not authorized.' }, 403);
    const requestId = randomUUID();
    const admin = provisioningClient();
    const command = async (
      action: string,
      hash: string | null = null,
      receipt: string | null = null,
    ) => {
      const result = await admin.rpc(
        'manage_doctor_invitation' as never,
        {
          p_actor: context.user.id,
          p_id: invitation.id,
          p_action: action,
          p_request: requestId,
          p_hash: hash,
          p_receipt: receipt,
        } as never,
      );
      if (result.error) {
        if (result.error.code === 'PGRST202')
          throw new ClinicalError(
            'Invitation management is awaiting the approved database update.',
            503,
          );
        throw new ClinicalError(
          result.error.code === '54000'
            ? 'Please wait before resending this invitation.'
            : 'Invitation changed or access was refused. Refresh and try again.',
          result.error.code === '54000' ? 429 : 409,
        );
      }
      return z.object({ id: z.uuid(), email: z.email() }).parse(result.data);
    };
    if (input.action === 'revoke') {
      await command('revoke');
      return response({ message: 'Invitation revoked successfully.' });
    }
    const token = randomBytes(32).toString('base64url');
    const rotated = await command(
      'rotate',
      '\\x' + createHash('sha256').update(token).digest('hex'),
    );
    const link = new URL('/auth/invitation', appOrigin());
    link.hash = new URLSearchParams({ id: invitation.id, token }).toString();
    try {
      const receipt = await sendTransactionalEmail(
        {
          to: rotated.email,
          subject: 'Your SRO Clinic doctor invitation',
          text: `You have been invited to join SRO Clinic as a Doctor. Open this private invitation within 24 hours to complete your profile, create your account and choose optional authenticator security. No separate signup verification email is required.\n\n${link}\n\nIf you did not request this, ignore this message.`,
        },
        `doctor-invitation/${requestId}`,
      );
      await command('sent', null, receipt);
    } catch {
      // A stale acknowledgement cannot undo concurrent revoke/rotation/completion.
      await command('failed').catch(() => undefined);
      return response(
        {
          error:
            'Invitation delivery could not be confirmed. The previous link remains invalid. Wait two minutes, then resend a fresh link.',
        },
        503,
      );
    }
    return response({ message: 'Invitation resent. It expires in 24 hours.' });
  } catch (error) {
    return response(
      {
        error:
          error instanceof ClinicalError
            ? error.message
            : 'Unable to manage this invitation. Please retry.',
      },
      error instanceof ClinicalError ? error.status : 400,
    );
  }
}
