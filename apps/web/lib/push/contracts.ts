import { z } from 'zod';

export const audienceRoles = ['admin', 'doctor', 'patient'] as const;
export const broadcastSchema = z.object({
  organizationId: z.uuid(),
  branchId: z.union([z.uuid(), z.literal('')]).default(''),
  roles: z.array(z.enum(audienceRoles)).min(1).max(3),
  audienceMode: z.enum(['roles', 'individuals', 'pilot']).default('roles'),
  recipientIds: z.array(z.uuid()).max(100).default([]),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(250),
  requestId: z.uuid().optional(),
  confirmation: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
});
export const deviceSchema = z.object({
  scope: z.string().regex(/^[a-f0-9]{32}$/),
  installationId: z.uuid(),
  secret: z.string().regex(/^[a-f0-9]{64}$/),
  token: z
    .string()
    .regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$/)
    .optional(),
  enabled: z.boolean().optional(),
  appointments: z.boolean().optional(),
  clinical: z.boolean().optional(),
  announcements: z.boolean().optional(),
});
export const templates = {
  general: {
    title: 'Clinic announcement',
    message: 'A new update is available from your clinic. Sign in for details.',
  },
  doctor: {
    title: 'Welcome to our care team',
    message: 'A new doctor has joined our clinic. Explore the doctor directory for details.',
  },
  branch: {
    title: 'New clinic branch',
    message: 'Our clinic network is growing. Explore clinic branches for the latest information.',
  },
  appointment: {
    title: 'Appointment update',
    message: 'Please sign in to review your latest appointment information.',
  },
} as const;
export function privatePushPayload(job: {
  token: string;
  notificationId: string;
  bindingId: string;
  category: string;
}) {
  return {
    to: job.token,
    title: 'SRO Clinic',
    body: 'You have a new clinic notification. Sign in to view it.',
    sound: 'default',
    channelId: 'clinic-updates-v2',
    categoryId: 'clinic-update',
    ttl: 3600,
    collapseId: job.notificationId,
    tag: job.notificationId,
    data: { notificationId: job.notificationId, bindingId: job.bindingId },
  };
}
