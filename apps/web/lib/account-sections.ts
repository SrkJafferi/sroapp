export const ACCOUNT_PROFILE_SECTION_ID = 'account-profile';
export const ACCOUNT_SECURITY_SECTION_ID = 'account-security';

export function isAccountSection(id: string) {
  return id === ACCOUNT_PROFILE_SECTION_ID || id === ACCOUNT_SECURITY_SECTION_ID;
}

export function focusAccountSection(id: string) {
  if (!isAccountSection(id)) return false;
  const element = document.getElementById(id);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  if (rect.top < 12 || rect.bottom > window.innerHeight - 12) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }
  element.focus({ preventScroll: true });
  return true;
}
