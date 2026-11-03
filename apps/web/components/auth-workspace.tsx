'use client';
import { createContext, useContext, useEffect } from 'react';
import type { AuthIdentity } from '@sro/types';
import { hasWorkspace } from '@/lib/auth/policy';
import { clearClinicalCache } from '@/lib/clinical-cache';
import { ProfileAssetsProvider } from './profile-assets';
const IdentityContext = createContext<AuthIdentity | null>(null);
const authorizationKey = (identity: AuthIdentity) =>
  JSON.stringify([
    identity.id,
    identity.memberships
      .map((m) => [m.organizationId, [...m.roles].sort(), [...m.branchIds].sort()])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
export function AuthWorkspace({
  identity,
  children,
}: {
  identity: AuthIdentity;
  children: React.ReactNode;
}) {
  useEffect(() => {
    async function check() {
      if (document.visibilityState !== 'visible') return;
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      if (response.status === 401) {
        clearClinicalCache();
        window.location.replace('/auth/login');
      } else if (response.ok) {
        const result = await response.json();
        if (
          result.next === '/auth/two-factor' ||
          result.identity?.id !== identity.id ||
          authorizationKey(result.identity) !== authorizationKey(identity) ||
          !hasWorkspace(result.identity, window.location.pathname.split('/')[1])
        ) {
          clearClinicalCache();
          window.location.replace(result.next ?? '/auth/login');
        }
      }
    }
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
  }, [identity]);
  return (
    <IdentityContext.Provider value={identity}>
      <ProfileAssetsProvider
        key={identity.id}
        userId={identity.id}
        organizationIds={identity.memberships.map((m) => m.organizationId)}
      >
        {children}
      </ProfileAssetsProvider>
    </IdentityContext.Provider>
  );
}
export function useIdentity() {
  return useContext(IdentityContext);
}
