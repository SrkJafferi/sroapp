import type { ClinicalSnapshot } from './clinical-contracts';
import { ClinicalRequestError, readClinical } from './clinical-client';
import { patchProfile } from './profile-patch';
import type { EditableProfile } from './profile-contracts';

const FRESH_MS = 30_000;
type CacheEntry = { snapshot: ClinicalSnapshot; storedAt: number };
const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ClinicalSnapshot>>();
const writeSequence = new Map<string, number>();
let nextSequence = 0;
let generation = 0;
export const CLINICAL_CACHE_CLEARED = 'sro:clinical-cache-cleared';

export function clinicalCacheKey(identityId: string, role: string, organizationId: string) {
  return `${identityId}:${role}:${organizationId}`;
}
export function readClinicalCache(key: string) {
  const entry = entries.get(key);
  if (!entry) return null;
  return { snapshot: entry.snapshot, fresh: Date.now() - entry.storedAt < FRESH_MS };
}
export function writeClinicalCache(key: string, snapshot: ClinicalSnapshot) {
  entries.set(key, { snapshot, storedAt: Date.now() });
  writeSequence.set(key, ++nextSequence);
}
export function patchClinicalProfile(key: string, profile: EditableProfile) {
  const entry = entries.get(key);
  if (entry) writeClinicalCache(key, patchProfile(entry.snapshot, profile));
}
export function invalidateClinicalCache(key?: string) {
  if (key) entries.delete(key);
  else entries.clear();
}
export function clearClinicalCache() {
  generation += 1;
  entries.clear();
  inFlight.clear();
  writeSequence.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLINICAL_CACHE_CLEARED));
}
function startFetch(key: string, url: string) {
  const started = generation;
  const sequence = ++nextSequence;
  return readClinical(url).then((snapshot: ClinicalSnapshot) => {
    if (started !== generation)
      throw new ClinicalRequestError('Clinic authorization changed. Please sign in again.', 403);
    if (started === generation && sequence >= (writeSequence.get(key) ?? 0)) {
      entries.set(key, { snapshot, storedAt: Date.now() });
      writeSequence.set(key, sequence);
    }
    return snapshot;
  });
}
export function fetchClinicalSnapshot(key: string, url: string, force = false) {
  if (!force) {
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  const request = startFetch(key, url);
  if (force) return request;
  inFlight.set(key, request);
  const cleanup = () => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  };
  request.then(cleanup, cleanup);
  return request;
}
