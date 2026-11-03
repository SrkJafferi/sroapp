'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react';
import { usePathname } from 'next/navigation';

type Route = { pathname: string; section: string; entityId?: string };
type WorkspaceRoute = Route & {
  navigate: (href: string, options?: { replace?: boolean }) => void;
};
type PathStore = {
  get: () => string;
  set: (pathname: string) => void;
  subscribe: (listener: () => void) => () => void;
};
const WorkspaceRouteContext = createContext<WorkspaceRoute | null>(null);

function parse(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  return { pathname, section: parts[1] ?? 'dashboard', entityId: parts[2] };
}
function normalize(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
function createPathStore(initial: string): PathStore {
  let value = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const onPopState = () => {
    value = normalize(window.location.pathname);
    notify();
  };
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener('popstate', onPopState);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) window.removeEventListener('popstate', onPopState);
      };
    },
  };
}
export function WorkspaceRouteProvider({
  initialPath,
  children,
}: {
  initialPath: string;
  children: React.ReactNode;
}) {
  const current = usePathname();
  const [store] = useState(() =>
    createPathStore(
      normalize(typeof window === 'undefined' ? initialPath : window.location.pathname),
    ),
  );
  const pathname = useSyncExternalStore(store.subscribe, store.get, () => normalize(initialPath));
  useEffect(() => {
    if (!current) return;
    const next = normalize(current);
    if (normalize(window.location.pathname) === next) store.set(next);
  }, [current, store]);
  const navigate = useCallback(
    (href: string, options?: { replace?: boolean }) => {
      if (!href.startsWith('/') || href.startsWith('//')) return;
      const next = normalize(href);
      if (normalize(window.location.pathname) === next) return;
      window.history[options?.replace ? 'replaceState' : 'pushState'](null, '', href);
      store.set(next);
      window.scrollTo({ top: 0, left: 0 });
    },
    [store],
  );
  const route = useMemo<WorkspaceRoute>(
    () => ({ ...parse(pathname), navigate }),
    [navigate, pathname],
  );
  return <WorkspaceRouteContext.Provider value={route}>{children}</WorkspaceRouteContext.Provider>;
}
export function useWorkspaceRoute() {
  const context = useContext(WorkspaceRouteContext);
  if (!context) throw new Error('WorkspaceRouteProvider is required');
  return context;
}
export function useWorkspaceNavigate() {
  return useWorkspaceRoute().navigate;
}
export function WorkspaceLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigate = useWorkspaceNavigate();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.currentTarget.target === '_blank'
    )
      return;
    if (!href.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    navigate(href);
  };
  return <a {...props} href={href} onClick={follow} />;
}
