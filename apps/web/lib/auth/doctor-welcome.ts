import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { provisioningCommand } from '../supabase/admin';
import { sendTransactionalEmail } from './mail';
import { doctorWelcomeTemplate } from './doctor-welcome-template';
const jobSchema = z.object({
  lease: z.uuid(),
  payload: z.object({
    name: z.string(),
    email: z.email(),
    branch: z.string(),
    department: z.string(),
    dashboardUrl: z.url(),
    templateVersion: z.literal('v1'),
  }),
});
export async function deliverDoctorWelcome(invitationId: string) {
  const result = await provisioningCommand('phase2b_welcome_delivery', {
    p_id: invitationId,
    p_action: 'claim',
  });
  if (!result) return 'idle' as const;
  const job = jobSchema.parse(result);
  let receipt: string;
  try {
    const content = (await readFile(path.join(process.cwd(), 'public/sro-logo.png'))).toString(
      'base64',
    );
    receipt = await sendTransactionalEmail(
      {
        to: job.payload.email,
        ...doctorWelcomeTemplate(job.payload),
        attachments: [{ filename: 'sro-logo.png', content, content_id: 'sro-logo' }],
      },
      `doctor-welcome/${invitationId}/v1`,
    );
  } catch {
    await provisioningCommand('phase2b_welcome_delivery', {
      p_id: invitationId,
      p_action: 'failed',
      p_lease: job.lease,
    });
    return 'queued' as const;
  }
  // If acknowledgement fails, keep the lease/first-attempt time. Never reset ambiguity.
  await provisioningCommand('phase2b_welcome_delivery', {
    p_id: invitationId,
    p_action: 'sent',
    p_lease: job.lease,
    p_message_id: receipt,
  });
  return 'sent' as const;
}
