import 'server-only';
import {
  pilotIdentityMatches,
  pilotScope,
} from '../../../../supabase/functions/_shared/push-pilot-policy';
import { ClinicalError } from '../clinical-server';

export function assertWebPushPilot(identity: {
  userId: string;
  organizationId: string;
  role: string;
  installationId?: string;
}) {
  const scope = pilotScope({ get: (name) => process.env[name] });
  if (!scope || !pilotIdentityMatches(scope, identity))
    throw new ClinicalError('Notification pilot is unavailable for this session.', 403);
}
