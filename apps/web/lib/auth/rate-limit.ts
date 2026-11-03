import 'server-only';
import { createHash } from 'node:crypto';
const buckets = new Map<string, { count: number; reset: number }>();
// Per-process protection supplements GoTrue limits; invitations also have transactional DB limits.
// Multi-instance production needs a shared edge/Redis limiter before public rollout.
export function limit(action: string, subject: string, max = 5, window = 15 * 60_000) {
  const now = Date.now();
  for (const [key, entry] of buckets) if (entry.reset < now) buckets.delete(key);
  const key = createHash('sha256').update(`${action}:${subject.toLowerCase()}`).digest('hex');
  const entry = buckets.get(key) ?? { count: 0, reset: now + window };
  entry.count++;
  buckets.set(key, entry);
  if (entry.count > max || buckets.size > 10_000)
    throw new Error('Too many attempts. Please try again later.');
}
