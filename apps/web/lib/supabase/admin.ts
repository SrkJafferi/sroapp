import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { WorkspaceDatabase, Json } from '@sro/types';
import { publicConfig } from './server';

export function provisioningClient() {
  const { url } = publicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Server provisioning configuration is unavailable.');
  return createClient<WorkspaceDatabase>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
// The separately reviewed Phase 2B proposal adds these service-only signatures.
// Keep them out of the generated Phase 2A database contract until approved/deployed.
export type ProvisioningCommand =
  | 'manage_doctor_invitation'
  | 'phase2b_onboarding'
  | 'phase2b_welcome_delivery'
  | 'phase2b_invitation_preview'
  | 'phase2b_patient'
  | 'phase2b_invite'
  | 'phase2b_accept'
  | 'phase2b_invitation_delivery'
  | 'phase2b_email_limit';
export async function provisioningCommand(
  name: ProvisioningCommand,
  args: Record<string, unknown>,
) {
  const { data, error } = await provisioningClient().rpc(name as never, args as never);
  if (error)
    throw new Error(
      error.code === 'P2101'
        ? 'Please contact the clinic for identity review and secure linking before activating portal access.'
        : error.code === 'PGRST202'
          ? 'Clinic account activation is not available yet. Please contact the administrator.'
          : name === 'phase2b_patient' && error.code === '23502'
            ? 'Account provisioning is awaiting the approved patient-age database update. Please contact the clinic administrator.'
            : 'Account provisioning was refused. Check your account or contact the clinic administrator.',
    );
  return data as Json;
}
