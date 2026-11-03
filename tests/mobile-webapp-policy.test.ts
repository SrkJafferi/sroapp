import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED_WEBAPP_ORIGIN as origin,
  approvedWebAppOrigin,
  allowedWebAppNavigation,
  webAppLoginUrl,
} from '../apps/mobile/src/webapp-policy';
test('only explicitly approved clean HTTPS origin configures the portal', () => {
  assert.equal(approvedWebAppOrigin('https://app.sropk.org'), origin);
  for (const bad of [
    'http://app.sropk.org',
    'http://localhost:3100',
    'https://other.example',
    'https://app.sropk.org.evil.example',
    'https://user:secret@app.sropk.org',
    'https://app.sropk.org/path',
    'https://app.sropk.org?host=evil',
  ])
    assert.equal(approvedWebAppOrigin(bad), null);
});
test('WebView navigation rejects external schemes, origins and embedded credentials', () => {
  assert.equal(allowedWebAppNavigation(origin + '/auth/login', origin), true);
  for (const bad of [
    'javascript:alert(1)',
    'file:///data/local',
    'intent://login',
    'http://app.sropk.org',
    'https://app.sropk.org.evil.example',
    'https://other.example',
    'https://user:pass@app.sropk.org',
  ])
    assert.equal(allowedWebAppNavigation(bad, origin), false);
});
test('role is a preference parameter only and does not choose privileged workspace', () => {
  for (const role of ['patient', 'doctor', 'admin']) {
    const u = new URL(webAppLoginUrl(origin, role));
    assert.equal(u.pathname, '/auth/login');
    assert.equal(u.searchParams.get('preferredRole'), role);
  }
  assert.equal(new URL(webAppLoginUrl(origin, 'super-admin')).search, '');
});
