import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { AuthWorkspace } from '@/components/auth-workspace';
import { ClinicShell } from '@/components/clinic-app';
import { ClinicProvider } from '@/components/clinic-context';
import { WorkspaceRouteProvider } from '@/components/workspace-route';
import { requireWorkspace } from '@/lib/auth/session';
import {
  isSidebarCollapsedPreference,
  SIDEBAR_PREFERENCE_COOKIE,
} from '@/lib/sidebar-preference';
import type { DemoRole } from '@sro/types';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ role: string; path?: string[] }>;
}) {
  const { role, path = [] } = await params;
  if (!['admin', 'doctor', 'patient'].includes(role) || path.length > 2) notFound();
  if (path[0] === 'notification-management' && role !== 'admin') notFound();
  const identity = await requireWorkspace(role);
  const sidebarCollapsed = isSidebarCollapsedPreference(
    (await cookies()).get(SIDEBAR_PREFERENCE_COOKIE)?.value,
  );
  const initialPath = `/${role}${path.length ? `/${path.join('/')}` : ''}`;
  return (
    <AuthWorkspace identity={identity}>
      <ClinicProvider key={`${identity.id}-${role}`} identity={identity} role={role as DemoRole}>
        <WorkspaceRouteProvider initialPath={initialPath}>
          <ClinicShell initialSidebarCollapsed={sidebarCollapsed}>{children}</ClinicShell>
        </WorkspaceRouteProvider>
      </ClinicProvider>
    </AuthWorkspace>
  );
}
