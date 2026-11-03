import { approvedWebAppOrigin } from '../webapp-policy';

// Public, credential-free discovery only. Never used by the authentication WebView.
export function discoveryApiOrigin(
  development = typeof __DEV__ !== 'undefined' && __DEV__,
  configured = process.env.EXPO_PUBLIC_DISCOVERY_DEV_ORIGIN,
) {
  if (development && configured) {
    const url = new URL(configured);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '10.0.2.2' ||
      !['3100', '3101'].includes(url.port) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw Error('Unapproved development discovery origin.');
    return url.origin;
  }
  return approvedWebAppOrigin();
}
