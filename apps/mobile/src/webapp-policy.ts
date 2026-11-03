export const APPROVED_WEBAPP_ORIGIN = 'https://app.sropk.org';
export function approvedWebAppOrigin(
  value = process.env.EXPO_PUBLIC_SRO_WEBAPP_ORIGIN ?? APPROVED_WEBAPP_ORIGIN,
) {
  try {
    const url = new URL(value);
    return url.origin === APPROVED_WEBAPP_ORIGIN &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
export function allowedWebAppNavigation(value: string, origin: string) {
  try {
    const url = new URL(value);
    return url.origin === origin && url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function webAppLoginUrl(origin: string, role?: string, destination?: string) {
  const url = new URL('/auth/login', origin);
  if (['patient', 'doctor', 'admin'].includes(role ?? ''))
    url.searchParams.set('preferredRole', role!);
  if (['book', 'appointments', 'profile'].includes(destination ?? ''))
    url.searchParams.set('intent', destination!);
  return url.href;
}
