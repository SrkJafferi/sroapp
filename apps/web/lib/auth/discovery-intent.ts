import type { AuthIdentity } from '@sro/types';
import { homeFor } from './policy';
export const discoveryIntents = ['book', 'appointments', 'profile', 'notifications'] as const;
export function discoveryIntent(value: unknown) {
  return typeof value === 'string' &&
    discoveryIntents.includes(value as (typeof discoveryIntents)[number])
    ? (value as (typeof discoveryIntents)[number])
    : null;
}
// The destination role comes only from the verified database identity.
export function discoveryDestination(identity: AuthIdentity, intent: unknown) {
  const home = homeFor(identity);
  if (!/^\/(admin|doctor|patient)$/.test(home)) return home;
  switch (discoveryIntent(intent)) {
    case 'notifications':
      return `${home}/notifications`;
    case 'book':
      return `${home}/appointments?book=1`;
    case 'appointments':
      return `${home}/appointments`;
    case 'profile':
      return `${home}/settings`;
    default:
      return home;
  }
}
