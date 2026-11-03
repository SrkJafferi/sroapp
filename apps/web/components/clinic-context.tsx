'use client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import type { AuthIdentity, ClinicState, DemoRole, UserProfile } from '@sro/types';
import type { ClinicalSnapshot } from '@/lib/clinical-contracts';
import {
  createClinicalRepository,
  clinicalQuery,
  ClinicalRequestError,
  type WebClinicRepository,
} from '@/lib/clinical-client';
import {
  clinicalCacheKey,
  CLINICAL_CACHE_CLEARED,
  clearClinicalCache,
  fetchClinicalSnapshot,
  invalidateClinicalCache,
  readClinicalCache,
  patchClinicalProfile,
} from '@/lib/clinical-cache';
import { PROFILE_CHANGED, type EditableProfile } from '@/lib/profile-contracts';
import { patchProfile } from '@/lib/profile-patch';
import { CircleCheck, CircleAlert, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

type Frame = {
  role: DemoRole;
  branchId: string;
  setBranchId: (id: string) => void;
  setRole: (role: DemoRole) => void;
  refresh: () => Promise<void>;
  error: string;
};
type ToastNotice = { title?: string; message: string };
type Context = {
  state: ClinicState;
  role: DemoRole;
  actor: UserProfile;
  clinic: WebClinicRepository;
  organizationId: string;
  timezone: string;
  branchId: string;
  setBranchId: (id: string) => void;
  setRole: (role: DemoRole) => void;
  refresh: () => Promise<void>;
  pending: boolean;
  notify: (notice: ToastNotice & { error?: boolean }) => void;
  act: (
    fn: () => unknown | Promise<unknown>,
    success?: string | ToastNotice | (() => string | ToastNotice),
  ) => Promise<boolean>;
};
const ClinicFrameContext = createContext<Frame | null>(null);
const ClinicContext = createContext<Context | null>(null);
export function ClinicProvider({
  identity,
  role,
  children,
}: {
  identity: AuthIdentity;
  role: DemoRole;
  children: React.ReactNode;
}) {
  const membership = identity.memberships.find((m) => m.roles.includes(role) && m.branchIds.length);
  if (!membership) throw new Error('Authorized membership is required.');
  const organizationId = membership.organizationId;
  const router = useRouter();
  const cacheKey = clinicalCacheKey(identity.id, role, organizationId);
  const snapshotUrl = `/api/clinic?${clinicalQuery(role, organizationId)}`;
  const [data, setData] = useState<ClinicalSnapshot | null>(
    () => readClinicalCache(cacheKey)?.snapshot ?? null,
  );
  const [branchId, setBranch] = useState(membership.branchIds[0]);
  const version = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<(ToastNotice & { error: boolean }) | null>(null);
  const notify = useCallback(
    (notice: ToastNotice & { error?: boolean }) =>
      setToast({ ...notice, error: notice.error ?? false }),
    [],
  );
  useEffect(() => {
    const changed = (event: Event) => {
      const profile = (event as CustomEvent<EditableProfile>).detail;
      if (profile.organizationId !== organizationId) return;
      // Invalidate older in-flight reads before patching only this verified user's scoped cache.
      version.current += 1;
      patchClinicalProfile(cacheKey, profile);
      setData((current) => (current ? patchProfile(current, profile) : current));
      setToast({ message: 'Profile changes saved.', error: false });
    };
    window.addEventListener(PROFILE_CHANGED, changed);
    return () => window.removeEventListener(PROFILE_CHANGED, changed);
  }, [cacheKey, organizationId]);
  const clinic = useMemo(
    () => createClinicalRepository(role, organizationId, branchId),
    [role, organizationId, branchId],
  );
  const apply = useCallback((snapshot: ClinicalSnapshot) => {
    setData(snapshot);
    setError('');
    setBranch((current) => {
      if (snapshot.state.branches.some((b) => b.id === current && b.active)) return current;
      return (
        snapshot.state.branches.find((b) => snapshot.actor.branchIds.includes(b.id) && b.active)
          ?.id ?? ''
      );
    });
  }, []);
  const reload = useCallback(
    async (force = false) => {
      if (!force) {
        const cached = readClinicalCache(cacheKey);
        if (cached?.fresh) {
          if (mounted.current) apply(cached.snapshot);
          return;
        }
      }
      const current = ++version.current;
      try {
        const snapshot = await fetchClinicalSnapshot(cacheKey, snapshotUrl, force);
        if (mounted.current && current === version.current) apply(snapshot);
      } catch (e) {
        if (e instanceof ClinicalRequestError && [401, 403].includes(e.status)) {
          clearClinicalCache();
          if (mounted.current) setData(null);
        }
        throw e;
      }
    },
    [apply, cacheKey, snapshotUrl],
  );
  const refresh = useCallback(async () => {
    try {
      await reload(true);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : 'Unable to load clinic records.');
      throw e;
    }
  }, [reload]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const clear = () => {
      version.current += 1;
      setData(null);
      setToast(null);
    };
    window.addEventListener(CLINICAL_CACHE_CLEARED, clear);
    const load = (force = false) => {
      if (document.visibilityState !== 'visible' || busy.current) return;
      reload(force).catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load clinic records.');
      });
    };
    // Returning to the tab revalidates against the server so changes made in
    // another session appear without a reload; the short guard absorbs the
    // duplicate focus/visibilitychange event pair.
    let lastSync = 0;
    const sync = () => {
      const now = Date.now();
      if (now - lastSync < 5_000) return;
      lastSync = now;
      load(true);
    };
    load();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    const timer = window.setInterval(() => load(), 60_000);
    return () => {
      active = false;
      mounted.current = false;
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener(CLINICAL_CACHE_CLEARED, clear);
      window.clearInterval(timer);
    };
  }, [reload]);
  const act = useCallback(
    async (
      fn: () => unknown | Promise<unknown>,
      success: string | ToastNotice | (() => string | ToastNotice) = 'Changes saved successfully.',
    ) => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      try {
        await fn();
        invalidateClinicalCache(cacheKey);
        await reload(true);
        const notice = typeof success === 'function' ? success() : success;
        setToast(
          typeof notice === 'string'
            ? { message: notice, error: false }
            : { ...notice, error: false },
        );
        return true;
      } catch (e) {
        setToast({
          message: e instanceof Error ? e.message : 'Unable to save changes.',
          error: true,
        });
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [cacheKey, reload],
  );
  const setBranchId = useCallback(
    (id: string) => {
      const allowed = data?.actor.branchIds ?? membership.branchIds;
      if (!allowed.includes(id)) return;
      setBranch(id);
    },
    [data, membership.branchIds],
  );
  const setRole = useCallback(
    (value: DemoRole) => {
      if (!identity.memberships.some((m) => m.roles.includes(value) && m.branchIds.length)) return;
      clearClinicalCache();
      router.push(`/${value}`);
    },
    [identity.memberships, router],
  );
  const frame = useMemo<Frame>(
    () => ({
      role,
      branchId,
      setBranchId,
      setRole,
      refresh,
      error,
    }),
    [role, branchId, setBranchId, setRole, refresh, error],
  );
  return (
    <ClinicFrameContext.Provider value={frame}>
      <ReadyClinicContext
        data={data}
        role={role}
        clinic={clinic}
        organizationId={organizationId}
        branchId={branchId}
        pending={pending}
        refresh={refresh}
        notify={notify}
        act={act}
        setBranchId={setBranchId}
        setRole={setRole}
      >
        {children}
      </ReadyClinicContext>
      {pending && (
        <div className="toast" role="status">
          Saving your changes…
        </div>
      )}
      {toast && !pending && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleAlert size={19} /> : <CircleCheck size={19} />}
          <span className="toast-copy">
            {toast.title && <strong>{toast.title}</strong>}
            <span>{toast.message}</span>
          </span>
          <button aria-label="Dismiss message" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </ClinicFrameContext.Provider>
  );
}
function ReadyClinicContext({
  data,
  role,
  clinic,
  organizationId,
  branchId,
  pending,
  refresh,
  notify,
  act,
  setBranchId,
  setRole,
  children,
}: {
  data: ClinicalSnapshot | null;
  role: DemoRole;
  clinic: WebClinicRepository;
  organizationId: string;
  branchId: string;
  pending: boolean;
  refresh: Context['refresh'];
  notify: Context['notify'];
  act: Context['act'];
  setBranchId: Context['setBranchId'];
  setRole: Context['setRole'];
  children: React.ReactNode;
}) {
  const value = useMemo<Context | null>(
    () =>
      data
        ? {
            state: data.state,
            actor: data.actor,
            role,
            clinic,
            organizationId,
            timezone: data.timezone,
            branchId,
            pending,
            refresh,
            notify,
            act,
            setBranchId,
            setRole,
          }
        : null,
    [
      branchId,
      clinic,
      data,
      pending,
      refresh,
      notify,
      role,
      organizationId,
      act,
      setBranchId,
      setRole,
    ],
  );
  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}
export function useClinicFrame() {
  const context = useContext(ClinicFrameContext);
  if (!context) throw new Error('ClinicProvider is required');
  return context;
}
export function useClinicOptional() {
  return useContext(ClinicContext);
}
export function useClinic() {
  const context = useContext(ClinicContext);
  if (!context) throw new Error('ClinicProvider is required');
  return context;
}
