export const SIDEBAR_PREFERENCE_COOKIE = 'sro_sidebar_collapsed';
export const SIDEBAR_PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

export function isSidebarCollapsedPreference(value?: string) {
  return value === '1';
}

export function writeSidebarPreference(collapsed: boolean) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SIDEBAR_PREFERENCE_COOKIE}=${collapsed ? '1' : '0'}; Path=/; Max-Age=${SIDEBAR_PREFERENCE_MAX_AGE}; SameSite=Lax${secure}`;
}
