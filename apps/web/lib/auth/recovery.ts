import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
const secret = () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Recovery configuration missing.');
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
};
export function recoveryProof(userId: string) {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('hex')}`;
}
export function validRecovery(value: string | undefined, userId: string) {
  if (!value) return false;
  const [id, time, signature = ''] = value.split('.');
  if (value.split('.').length !== 3 || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (
    id !== userId ||
    !Number.isFinite(Number(time)) ||
    Date.now() - Number(time) > 600_000 ||
    Number(time) > Date.now()
  )
    return false;
  const expected = createHmac('sha256', secret()).update(`${id}.${time}`).digest();
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
