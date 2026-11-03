// Client-safe display math only. The database owns the 10-minute handover boundary.
export const HANDOVER_WARNING_MS = 2 * 60 * 1000;

export type HandoverWindowState = {
  remainingMs: number;
  expired: boolean;
  warning: boolean;
  label: string;
};

/**
 * `serverNow` is captured together with the browser time at mount. The countdown then
 * follows the server clock without ever extending the server-issued expiry.
 */
export function handoverWindowState(
  expiresAt: string | null | undefined,
  serverNow: string | null | undefined,
  mountedAt: number,
  now: number,
): HandoverWindowState | null {
  if (!expiresAt || !serverNow) return null;
  const expiry = Date.parse(expiresAt);
  const server = Date.parse(serverNow);
  if (!Number.isFinite(expiry) || !Number.isFinite(server)) return null;
  const elapsed = Math.max(0, now - mountedAt);
  const remainingMs = expiry - server - elapsed;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return {
    remainingMs,
    expired: remainingMs <= 0,
    warning: remainingMs > 0 && remainingMs <= HANDOVER_WARNING_MS,
    label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  };
}
