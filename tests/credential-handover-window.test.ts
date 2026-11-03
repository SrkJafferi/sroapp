import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handoverWindowState, HANDOVER_WARNING_MS } from '../apps/web/lib/credential-handover-window';

const base = Date.parse('2026-11-01T12:00:00.000Z');
const at = (ms: number) => new Date(base + ms).toISOString();

test('handover countdown follows the server clock and never extends', () => {
  const expires = at(10 * 60 * 1000);
  const serverNow = at(0);

  const start = handoverWindowState(expires, serverNow, base, base);
  assert.ok(start);
  assert.equal(start.expired, false);
  assert.equal(start.warning, false);
  assert.equal(start.label, '10:00');
  assert.equal(start.remainingMs, 10 * 60 * 1000);

  const warning = handoverWindowState(expires, serverNow, base, base + 8 * 60 * 1000);
  assert.ok(warning);
  assert.equal(warning.warning, true);
  assert.equal(warning.label, '2:00');
  assert.equal(warning.remainingMs, HANDOVER_WARNING_MS);

  const boundary = handoverWindowState(expires, serverNow, base, base + 10 * 60 * 1000);
  assert.ok(boundary);
  assert.equal(boundary.expired, true);
  assert.equal(boundary.warning, false);
  assert.equal(boundary.label, '0:00');

  const late = handoverWindowState(expires, serverNow, base, base + 60 * 60 * 1000);
  assert.ok(late);
  assert.equal(late.expired, true);
  assert.equal(late.label, '0:00');
});

test('handover countdown corrects local clock skew from serverNow', () => {
  const localMountedAt = base + 5 * 60 * 1000;
  const expires = at(10 * 60 * 1000);
  const serverNow = at(0);
  const remaining = handoverWindowState(expires, serverNow, localMountedAt, localMountedAt);
  assert.ok(remaining);
  assert.equal(remaining.remainingMs, 10 * 60 * 1000);
  assert.equal(remaining.label, '10:00');
});

test('invalid or missing window data does not invent an expiry', () => {
  assert.equal(handoverWindowState(null, at(0), base, base), null);
  assert.equal(handoverWindowState(at(60000), undefined, base, base), null);
  assert.equal(handoverWindowState('not-a-date', at(0), base, base), null);
  assert.equal(handoverWindowState(at(60000), 'not-a-date', base, base), null);
});

test('recovery migration is pinned to SRO0009 and never creates identities', async () => {
  const sql = await readFile(
    'supabase/proposals/sro0009-recovery/20261101120000_clinic_sro0009_recovery.sql',
    'utf8',
  );
  const server = await readFile('apps/web/lib/sro0009-recovery.ts', 'utf8');
  for (const exact of [
    '43824fdc-558a-4321-95b5-e11bc43a94b3',
    '68b99984-1527-461b-b09a-7a9daaaa593d',
    '326b2c4e-baf5-4399-b4bf-ac31c2d6866c',
    '3185a2f6-7e3a-46de-b5c9-8ba530e5f333',
    'c9095e1e-b718-4c09-842f-df48970125af',
  ]) {
    assert.match(sql, new RegExp(exact));
    assert.match(server, new RegExp(exact));
  }
  assert.match(sql, /9d7e812b-3899-4475-8600-83e2d0794691/);
  assert.match(sql, /Ayesha Noor/);
  const sqlAttestation = sql.match(
    /I confirm that Ayesha Noor[^\n']*physical Patient identity verification\./,
  )?.[0];
  const serverAttestation = server.match(
    /I confirm that Ayesha Noor[^\n']*physical Patient identity verification\./,
  )?.[0];
  assert.ok(sqlAttestation, 'SQL ownership attestation is present');
  assert.equal(serverAttestation, sqlAttestation, 'server and SQL attestations match');
  assert.doesNotMatch(sql, /insert\s+into\s+auth\.users/i);
  assert.doesNotMatch(sql, /update\s+clinic_private\.patient_pilot_authorizations/i);
  assert.doesNotMatch(sql, /update\s+public\.patients/i);
  assert.match(sql, /reissue_count between 0 and 1/);
  assert.match(sql, /one_time boolean not null default true unique/);
  assert.match(sql, /patient_account_recovery_reset/);
  assert.doesNotMatch(sql, /identityCheck|in_person_verified/);
  assert.match(sql, /Handover expired — account needs review/);
});
