'use client';
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { CLINICAL_CACHE_CLEARED, clearClinicalCache } from '@/lib/clinical-cache';
import {
  PROFILE_CHANGED,
  type EditableProfile,
  type ProfileAsset,
  type ProfileKind,
} from '@/lib/profile-contracts';
type Context = { assets: ProfileAsset[]; saved: (profile: EditableProfile) => void };
const ProfileAssets = createContext<Context>({ assets: [], saved: () => {} });
export function ProfileAssetsProvider({
  userId,
  organizationIds,
  children,
}: {
  userId: string;
  organizationIds: string[];
  children: React.ReactNode;
}) {
  const [assets, setAssets] = useState<ProfileAsset[]>([]);
  const version = useRef(0);
  const scope = organizationIds.slice().sort().join(',');
  useEffect(() => {
    let active = true;
    const clear = () => {
      version.current++;
      setAssets([]);
    };
    window.addEventListener(CLINICAL_CACHE_CLEARED, clear);
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = ++version.current;
      try {
        const results = await Promise.all(
          scope
            .split(',')
            .filter(Boolean)
            .map(async (organizationId) => {
              const response = await fetch(
                `/api/profiles?assets=1&organizationId=${encodeURIComponent(organizationId)}`,
                { cache: 'no-store' },
              );
              if (response.status === 401 || response.status === 403) {
                clearClinicalCache();
                throw new Error('Authorization changed');
              }
              if (!response.ok) throw new Error('Photos unavailable');
              return (await response.json()).assets as ProfileAsset[];
            }),
        );
        if (active && current === version.current) setAssets(results.flat());
      } catch {
        if (active && current === version.current) setAssets([]);
      }
    };
    void load();
    window.addEventListener('focus', load);
    const timer = window.setInterval(load, 60000);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      window.removeEventListener(CLINICAL_CACHE_CLEARED, clear);
      window.clearInterval(timer);
    };
  }, [userId, scope]);
  const saved = useCallback((profile: EditableProfile) => {
    version.current++;
    setAssets((previous) => [
      ...previous.filter(
        (a) =>
          a.organizationId !== profile.organizationId ||
          a.kind !== profile.kind ||
          a.id !== profile.id,
      ),
      ...(profile.avatarId
        ? [
            {
              organizationId: profile.organizationId,
              kind: profile.kind,
              id: profile.id,
              userId: profile.userId,
              avatarId: profile.avatarId,
            },
          ]
        : []),
    ]);
    window.dispatchEvent(new CustomEvent(PROFILE_CHANGED, { detail: profile }));
  }, []);
  return <ProfileAssets.Provider value={{ assets, saved }}>{children}</ProfileAssets.Provider>;
}
export function useProfileAssets() {
  return useContext(ProfileAssets);
}
export function useAvatar(kind?: ProfileKind, id?: string, organizationId?: string) {
  return useProfileAssets().assets.find(
    (a) =>
      a.kind === kind && a.id === id && (!organizationId || a.organizationId === organizationId),
  )?.avatarId;
}
