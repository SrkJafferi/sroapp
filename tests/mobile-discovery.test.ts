import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDiscoveryFeed,
  searchDiscovery,
  reliableOpenStatus,
  loadDiscoveryFeed,
} from '../apps/mobile/src/discovery/data';
import { webAppLoginUrl } from '../apps/mobile/src/webapp-policy';
const fixture = () => ({
  version: 1,
  branches: [
    {
      id: 'test-branch',
      name: 'Fictional clinic fixture',
      location: 'Unit-test location',
      hours: 'Unverified hours',
      imageUrl: 'https://app.sropk.org/public/approved-image.png',
      patientNotes: 'must never pass',
    },
  ],
  doctors: [
    {
      id: 'test-doctor',
      name: 'Fictional test doctor',
      specialization: 'Test care',
      branchIds: ['test-branch'],
      loginEmail: 'must never pass',
    },
  ],
  departments: [
    {
      id: 'test-department',
      name: 'Test department',
      description: 'Unit-test public description',
      branchIds: ['test-branch'],
      doctorIds: ['test-doctor'],
    },
  ],
});
test('public parser projects only permitted fields and suppresses unverified hours', () => {
  const feed = parseDiscoveryFeed(fixture());
  assert.equal(feed.branches[0].hours, undefined);
  assert.ok(!JSON.stringify(feed).includes('must never pass'));
  assert.equal(feed.doctors[0].branchIds[0], 'test-branch');
});
test('public adapter rejects private clinical snapshot shape, bad schema and unapproved image host', () => {
  for (const v of [
    { state: { patients: [] } },
    { ...fixture(), version: 2 },
    {
      ...fixture(),
      branches: [
        { id: 'b', name: 'Test', location: 'Test', imageUrl: 'http://localhost/private.png' },
      ],
    },
    {
      ...fixture(),
      doctors: [{ id: 'd', name: 'Test', specialization: 'Test', branchIds: 'invalid' }],
    },
  ])
    assert.throws(() => parseDiscoveryFeed(v));
});
test('search covers clinics, doctors, specialties, departments and related branch names', () => {
  const feed = parseDiscoveryFeed(fixture());
  assert.equal(searchDiscovery(feed, 'TEST CARE').doctors.length, 1);
  assert.equal(searchDiscovery(feed, 'unit-test location').branches.length, 1);
  assert.equal(searchDiscovery(feed, 'department').departments.length, 1);
  assert.equal(searchDiscovery(feed, 'clinic fixture').doctors.length, 1);
  assert.deepEqual(searchDiscovery(feed, 'unmatched'), {
    version: 1,
    branches: [],
    doctors: [],
    departments: [],
  });
});
test('unknown, expired and implausibly long-lived open status is never displayed', () => {
  const b = parseDiscoveryFeed(fixture()).branches[0];
  assert.equal(reliableOpenStatus(b), undefined);
  for (const statusValidUntil of [
    'invalid',
    new Date(0).toISOString(),
    new Date(Date.now() + 172800000).toISOString(),
  ])
    assert.equal(reliableOpenStatus({ ...b, openNow: true, statusValidUntil }), undefined);
  assert.equal(
    reliableOpenStatus({
      ...b,
      openNow: false,
      statusValidUntil: new Date(Date.now() + 60000).toISOString(),
    }),
    false,
  );
});
test('fetch uses only public approved endpoint, omits credentials and fails rather than inventing rows', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, options) => {
      assert.equal(input, 'https://app.sropk.org/api/public/discovery');
      assert.equal(options?.credentials, 'omit');
      assert.equal(options?.redirect, 'error');
      return new Response(JSON.stringify(fixture()), {
        headers: { 'content-type': 'application/json' },
      });
    };
    assert.equal((await loadDiscoveryFeed(new AbortController().signal)).branches.length, 1);
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(() => loadDiscoveryFeed(new AbortController().signal));
  } finally {
    globalThis.fetch = original;
  }
});
test('protected destinations are fixed navigation intents, never arbitrary redirects or roles', () => {
  for (const intent of ['book', 'appointments', 'profile']) {
    const url = new URL(webAppLoginUrl('https://app.sropk.org', undefined, intent));
    assert.equal(url.pathname, '/auth/login');
    assert.equal(url.searchParams.get('intent'), intent);
    assert.equal(url.searchParams.has('preferredRole'), false);
  }
  assert.equal(
    new URL(webAppLoginUrl('https://app.sropk.org', undefined, 'https://evil.example')).search,
    '',
  );
});
