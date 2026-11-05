// Pure policy shared by the Web server and Edge worker. No secrets or network.
export const pilotAdmin = 'c9095e1e-b718-4c09-842f-df48970125af';
export const pilotOrganization = '88645fbe-34da-48aa-a509-c24441b7cf72';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Env = { get(name: string): string | undefined };
export function utcMillis(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) return NaN;
  const n = Date.parse(value);
  return Number.isFinite(n) &&
    new Date(n).toISOString() === (value.includes('.') ? value : value.slice(0, -1) + '.000Z')
    ? n
    : NaN;
}
export function pilotScope(env: Env, now = Date.now(), delivery = false) {
  const userId = env.get('SRO_PUSH_PILOT_USER_ID');
  const organizationId = env.get('SRO_PUSH_PILOT_ORGANIZATION_ID');
  const installationId = env.get('SRO_PUSH_PILOT_INSTALLATION_ID') ?? '';
  const startsAt = utcMillis(env.get('SRO_PUSH_PILOT_STARTS_AT'));
  const expiresAt = utcMillis(env.get('SRO_PUSH_PILOT_EXPIRES_AT'));
  const notificationId = env.get('SRO_PUSH_PILOT_NOTIFICATION_ID') ?? '';
  const bindingId = env.get('SRO_PUSH_PILOT_BINDING_ID') ?? '';
  if (
    userId !== pilotAdmin ||
    organizationId !== pilotOrganization ||
    !uuid.test(installationId) ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= startsAt ||
    expiresAt - startsAt > 30 * 60_000 ||
    now < startsAt ||
    now >= expiresAt ||
    (delivery && (!uuid.test(notificationId) || !uuid.test(bindingId)))
  )
    return null;
  return { userId, organizationId, installationId, startsAt, expiresAt, notificationId, bindingId };
}
export function pilotIdentityMatches(
  scope: NonNullable<ReturnType<typeof pilotScope>>,
  identity: { userId: string; organizationId: string; role: string; installationId?: string },
) {
  return (
    identity.userId === scope.userId &&
    identity.organizationId === scope.organizationId &&
    identity.role === 'admin' &&
    (identity.installationId === undefined || identity.installationId === scope.installationId)
  );
}
