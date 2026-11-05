import 'server-only';
import { ClinicalError } from '../clinical-server';
import type { sessionClient } from '../supabase/server';
import { z } from 'zod';
const capability = z.object({
  version: z.literal(2),
  individualTargeting: z.boolean(),
  readCounts: z.boolean(),
  databaseEnabled: z.boolean(),
  broadcastsEnabled: z.boolean(),
  pilotEligible: z.boolean(),
  pilotPrepared: z.boolean(),
  pilotOwnDevice: z.boolean(),
});
export async function managementCapabilities(
  client: Awaited<ReturnType<typeof sessionClient>>,
  input: unknown,
) {
  const r = await client.rpc(
    'clinic_broadcast' as never,
    { p_action: 'capabilities', p_input: input } as never,
  );
  if (r.error) {
    // Known legacy command does not implement this read action. Do not disguise
    // any other database/auth/query failure as an empty or enabled capability.
    if (r.error.code === '22023')
      return {
        version: 1 as const,
        individualTargeting: false,
        readCounts: false,
        databaseEnabled: false,
        broadcastsEnabled: false,
        pilotEligible: false,
        pilotPrepared: false,
        pilotOwnDevice: false,
      };
    throw new ClinicalError(
      'Notification publishing setup could not be verified.',
      r.error.code === '42501' ? 403 : 503,
    );
  }
  const parsed = capability.safeParse(r.data);
  if (!parsed.success)
    throw new ClinicalError('Notification publishing setup returned an invalid response.', 503);
  return parsed.data;
}
