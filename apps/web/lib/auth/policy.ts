import type { AuthIdentity, WorkspaceRole } from '@sro/types';

export function hasWorkspace(identity: AuthIdentity, role: string): role is WorkspaceRole {
  return identity.memberships.some(
    (m) => m.branchIds.length > 0 && m.roles.includes(role as WorkspaceRole),
  );
}
export function homeFor(identity: AuthIdentity) {
  const role = (['admin', 'doctor', 'patient'] as const).find((r) => hasWorkspace(identity, r));
  return role ? `/${role}` : '/auth/account-ready';
}
export function safeNext(value: string | null, fallback = '/') {
  return value && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value)
    ? value
    : fallback;
}
