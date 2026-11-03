import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockRepository } from '../packages/data-access/src/index';
import type { ClinicalSnapshot } from '../apps/web/lib/clinical-contracts';
import { ClinicalRequestError } from '../apps/web/lib/clinical-client';
import {
  clearClinicalCache,
  clinicalCacheKey,
  fetchClinicalSnapshot,
  readClinicalCache,
  writeClinicalCache,
  patchClinicalProfile,
} from '../apps/web/lib/clinical-cache';

// Isolated HTTP/cache tests only; the application continues to use real PostgreSQL.
const state = createMockRepository().getSnapshot();
const snapshot: ClinicalSnapshot = {
  state,
  actor: state.profiles[0],
  organizationId: state.organization.id,
  timezone: state.organization.timezone,
};
const key = clinicalCacheKey(snapshot.actor.id, 'admin', snapshot.organizationId);

test('clinical cache response and authorization recovery', async (t) => {
  const original = globalThis.fetch;
  try {
    await t.test(
      'profile patch updates only the current scoped cache and survives an older fetch',
      async () => {
        clearClinicalCache();
        writeClinicalCache(key, snapshot);
        const otherKey = clinicalCacheKey('other-user', 'admin', snapshot.organizationId);
        writeClinicalCache(otherKey, snapshot);
        let release!: (response: Response) => void;
        globalThis.fetch = async () =>
          new Promise((resolve) => {
            release = resolve;
          });
        const pending = fetchClinicalSnapshot(key, '/api/clinic', true);
        patchClinicalProfile(key, {
          organizationId: snapshot.organizationId,
          kind: 'profile',
          id: snapshot.actor.id,
          name: 'Fictional Updated Profile',
          userId: snapshot.actor.id,
          loginEmail: null,
          canEdit: true,
          avatarId: null,
        });
        release(Response.json(snapshot));
        await pending;
        assert.equal(readClinicalCache(key)?.snapshot.actor.name, 'Fictional Updated Profile');
        assert.equal(readClinicalCache(otherKey)?.snapshot.actor.name, snapshot.actor.name);
        assert.deepEqual(
          readClinicalCache(key)?.snapshot.state.consultations,
          snapshot.state.consultations,
        );
      },
    );
    await t.test(
      'concurrent readers deduplicate without caching failures as empty records',
      async () => {
        clearClinicalCache();
        let calls = 0;
        let release!: (response: Response) => void;
        globalThis.fetch = async () => {
          calls++;
          return new Promise((resolve) => {
            release = resolve;
          });
        };
        const first = fetchClinicalSnapshot(key, '/api/clinic');
        const second = fetchClinicalSnapshot(key, '/api/clinic');
        assert.equal(first, second);
        assert.equal(calls, 1);
        release(Response.json(snapshot));
        await first;
        assert.deepEqual(readClinicalCache(key)?.snapshot, snapshot);
      },
    );
    await t.test(
      'temporary 503 preserves previously authorized records and surfaces failure',
      async () => {
        clearClinicalCache();
        writeClinicalCache(key, snapshot);
        globalThis.fetch = async () =>
          Response.json(
            { error: 'Clinic records could not be loaded. Please retry.' },
            { status: 503 },
          );
        await assert.rejects(
          fetchClinicalSnapshot(key, '/api/clinic', true),
          (e) => e instanceof ClinicalRequestError && e.status === 503,
        );
        assert.deepEqual(readClinicalCache(key)?.snapshot, snapshot);
      },
    );
    await t.test(
      'late responses after account/authorization reset cannot return or cache old records',
      async () => {
        clearClinicalCache();
        let release!: (response: Response) => void;
        globalThis.fetch = async () =>
          new Promise((resolve) => {
            release = resolve;
          });
        const pending = fetchClinicalSnapshot(key, '/api/clinic');
        const denial = assert.rejects(
          pending,
          (e) => e instanceof ClinicalRequestError && e.status === 403,
        );
        clearClinicalCache();
        release(Response.json(snapshot));
        await denial;
        assert.equal(readClinicalCache(key), null);
        assert.equal(
          readClinicalCache(clinicalCacheKey('other-user', 'patient', snapshot.organizationId)),
          null,
        );
      },
    );
    await t.test('401 and 403 remain distinguishable from retriable server errors', async () => {
      for (const status of [401, 403]) {
        clearClinicalCache();
        globalThis.fetch = async () => Response.json({ error: 'Not authorized' }, { status });
        await assert.rejects(
          fetchClinicalSnapshot(key, '/api/clinic'),
          (e) => e instanceof ClinicalRequestError && e.status === status,
        );
        assert.equal(readClinicalCache(key), null);
      }
    });
  } finally {
    globalThis.fetch = original;
    clearClinicalCache();
  }
});
