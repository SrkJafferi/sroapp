import 'server-only';
import type { DemoRole } from '@sro/types';
import { authenticatedSession, loadIdentity } from './auth/session';
import { hasWorkspace } from './auth/policy';
import { clinicalTables, type ClinicalRows, type ClinicalTable } from './clinical-contracts';
import { projectClinicalRows } from './clinical-projector';
import { localParts } from './clinical-clock';
import { z } from 'zod';

export class ClinicalError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export async function clinicalContext(role: DemoRole, organizationId?: string) {
  const session = await authenticatedSession();
  if (!session) throw new ClinicalError('Please sign in.', 401);
  if (session.needsMfa) throw new ClinicalError('Authenticator verification required.', 403);
  if (session.needsPasswordChange)
    throw new ClinicalError('Initial password change required.', 403);
  const identity = await loadIdentity();
  if (!identity || !hasWorkspace(identity, role))
    throw new ClinicalError('This workspace is not authorized.', 403);
  const membership = identity.memberships.find(
    (m) =>
      m.roles.includes(role) &&
      m.branchIds.length &&
      (!organizationId || m.organizationId === organizationId),
  );
  if (!membership) throw new ClinicalError('Clinic membership is unavailable.', 403);
  return { ...session, identity, membership };
}
export async function snapshot(role: DemoRole, organizationId?: string) {
  // Resolve trusted authorization before starting any clinical table reads.
  // Keep this on the established Auth API used by the verified Phase 2C path.
  const { client, user, membership } = await clinicalContext(role, organizationId);
  const rows = await readClinicalTables(client, membership.organizationId, role);
  // Only the specifically not-yet-deployed additive RPC may be absent; real read failures surface.
  let intakes = [] as NonNullable<import('@sro/types').ClinicState['patientIntakes']>;
  if (role !== 'patient') {
    const result = await client.rpc('staff_patient_intakes', {
      p_organization_id: membership.organizationId,
    });
    if (result.error && result.error.code !== 'PGRST202')
      throw new ClinicalError('Patient intake access could not be verified. Please retry.', 503);
    if (!result.error) {
      const parsed = z
        .array(
          z.object({
            patientId: z.uuid(),
            branchId: z.uuid(),
            createdBy: z.uuid(),
            expiresAt: z.iso.datetime({ offset: true }),
            bloodGroup: z.string().nullable(),
            clinicalAccess: z.boolean(),
          }),
        )
        .safeParse(result.data);
      if (!parsed.success)
        throw new ClinicalError('Patient intake access returned an invalid response.', 503);
      intakes = parsed.data;
    }
  }
  const members = new Set(rows.role_assignments.map((r) => r.user_id));
  members.add(user.id);
  rows.profiles = rows.profiles.filter((p) => members.has(p.id));
  return projectClinicalRows(
    rows,
    user.id,
    role,
    membership.organizationId,
    membership.branchIds,
    intakes,
  );
}
async function readClinicalTables(
  client: NonNullable<Awaited<ReturnType<typeof authenticatedSession>>>['client'],
  organizationId: string,
  role: DemoRole,
) {
  const tables = clinicalTables.filter(
    (table) =>
      table !== 'appointment_slots' &&
      (role === 'admin' || (table !== 'audit_logs' && table !== 'doctor_invitations')),
  );
  const byTable = new Map<string, Promise<ClinicalRows[ClinicalTable]>>();
  for (const table of tables) {
    byTable.set(
      table,
      (async () => {
        let query = client.from(table).select('*');
        if (table === 'organizations') query = query.filter('id', 'eq', organizationId);
        else if (table !== 'profiles')
          query = query.filter('organization_id', 'eq', organizationId);
        const response = await query.limit(1000);
        if (response.error)
          throw new ClinicalError('Clinic records could not be loaded. Please retry.', 503);
        if (!Array.isArray(response.data))
          throw new ClinicalError(
            'Clinic records returned an invalid response. Please retry.',
            503,
          );
        return response.data as ClinicalRows[ClinicalTable];
      })(),
    );
  }
  const slotsPromise = (async () => {
    const [appointments, reservations] = await Promise.all([
      byTable.get('appointments')!,
      byTable.get('appointment_reservations')!,
    ]);
    const slotIds = [
      ...new Set([
        ...(appointments as ClinicalRows['appointments']).map((a) => a.current_slot_id),
        ...(reservations as ClinicalRows['appointment_reservations']).map((r) => r.slot_id),
      ]),
    ];
    if (!slotIds.length) return [] as ClinicalRows['appointment_slots'];
    const slots = await client
      .from('appointment_slots')
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', slotIds);
    if (slots.error) throw new ClinicalError('Appointment dates could not be loaded.', 503);
    if (!Array.isArray(slots.data))
      throw new ClinicalError('Appointment dates returned an invalid response.', 503);
    return slots.data as ClinicalRows['appointment_slots'];
  })();
  const [entries, slots] = await Promise.all([
    Promise.all([...byTable].map(async ([table, promise]) => [table, await promise] as const)),
    slotsPromise,
  ]);
  const rows = Object.fromEntries(
    clinicalTables.map((table) => [table, []]),
  ) as unknown as ClinicalRows;
  for (const [table, data] of entries) (rows as Record<string, unknown>)[table] = data;
  rows.appointment_slots = slots;
  return rows;
}
export function checkDatabaseError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === '42501')
    throw new ClinicalError('You do not have permission for this action.', 403);
  if (error.code === '23P01')
    throw new ClinicalError('This slot was just reserved. Choose another available time.', 409);
  if (error.code === '23505')
    throw new ClinicalError('A conflicting record already exists. Refresh and try again.', 409);
  if (error.code === '23514')
    throw new ClinicalError(
      'This change is not permitted. Check the fields and resolve existing reservations.',
      409,
    );
  if (error.code === 'PGRST202')
    throw new ClinicalError(
      'Clinic configuration changes are awaiting activation. Please contact your administrator.',
      503,
    );
  throw new ClinicalError('The update could not be completed. Refresh the records and try again.');
}
export function branchInstant(date: string, time: string, timezone: string) {
  const target = Date.parse(`${date}T${time}:00Z`);
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(instant), timezone);
    const current = Date.parse(`${p.date}T${p.time}:00Z`);
    instant += target - current;
  }
  const result = localParts(new Date(instant), timezone);
  if (result.date !== date || result.time !== time)
    throw new ClinicalError('This local time does not exist in the branch timezone.');
  return new Date(instant).toISOString();
}
