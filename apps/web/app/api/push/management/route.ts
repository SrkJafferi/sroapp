import { NextResponse, type NextRequest } from 'next/server';
import { ClinicalError } from '@/lib/clinical-server';
import { managementCapabilities } from '@/lib/push/management';
import { pushContext, pushEnabled, userPushCommand } from '@/lib/push/server';
import { audienceRoles } from '@/lib/push/contracts';
import { z } from 'zod';
export async function GET(request: NextRequest) {
  const reply = (data: unknown, status = 200) =>
    NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const { client, membership } = await pushContext(request, true);
    const branchId = request.nextUrl.searchParams.get('branchId') || '';
    if (branchId && !membership.branchIds.includes(branchId))
      throw new ClinicalError('Branch access denied.', 403);
    const input = { organizationId: membership.organizationId, branchId };
    const capability = await managementCapabilities(client, input);
    if (request.nextUrl.searchParams.get('audience') === '1') {
      if (!capability.individualTargeting)
        throw new ClinicalError('Individual targeting is awaiting publishing setup approval.', 503);
      const roles = z
        .array(z.enum(audienceRoles))
        .min(1)
        .max(3)
        .parse((request.nextUrl.searchParams.get('roles') ?? '').split(','));
      return reply(
        await userPushCommand(client, 'clinic_broadcast', 'audience', { ...input, roles }),
      );
    }
    return reply({ ...capability, webEnabled: pushEnabled() });
  } catch (e) {
    return reply(
      { error: e instanceof ClinicalError ? e.message : 'Unable to load notification management.' },
      e instanceof ClinicalError ? e.status : 400,
    );
  }
}
