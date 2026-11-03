import assert from 'node:assert/strict';
import { readFile, writeFile, access, unlink } from 'node:fs/promises';
import pg from '../../artifacts/phase2a5/runtime/node_modules/pg/lib/index.js';
import { raceCases, stagingRef, protectedRef } from './staging-races.mjs';

const index = Number(process.argv[2]);
const c = raceCases[index];
assert.ok(c, 'Known case required');
const config = JSON.parse(await readFile('artifacts/phase2a5/staging-private.json', 'utf8'));
assert.ok(
  config.schemaVersion === 2 && !config.sqlRunner?.retired,
  'SQL runner retired after credential remediation; explicit reprovisioning is required',
);
const target = JSON.parse(await readFile('artifacts/phase2a5/connection-target.json', 'utf8'));
assert.equal(config.projectRef, stagingRef);
assert.equal(target.projectRef, stagingRef);
assert.notEqual(stagingRef, protectedRef);
assert.equal(target.host, 'aws-0-ap-south-1.pooler.supabase.com');
assert.equal(target.port, 5432);
const ca = await readFile('artifacts/phase2a5/supabase-root-ca.crt', 'utf8');
const clients = Array.from(
  { length: 3 },
  () =>
    new pg.Client({
      host: target.host,
      port: target.port,
      user: `sro_phase2a5_runner.${stagingRef}`,
      password: config.password,
      database: 'postgres',
      ssl: { ca, rejectUnauthorized: true },
      connectionTimeoutMillis: 10000,
    }),
);
const result = {
  projectRef: stagingRef,
  name: c.name,
  expected: c.expect,
  passed: false,
  snapshots: [],
};
const base = `artifacts/phase2a5/race-${index}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await unlink(base + '-revoked.json').catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
try {
  await Promise.all(clients.map((client) => client.connect()));
  const identity = await Promise.all(
    clients.map(async (client) => {
      assert.equal(client.connection.stream.authorized, true, 'Verified TLS required');
      const r = (
        await client.query(
          "select pg_backend_pid() as pid,current_user,current_setting('server_version_num')::int as version,inet_server_addr()::text as address",
        )
      ).rows[0];
      assert.equal(r.current_user, 'sro_phase2a5_runner');
      assert.equal(Math.floor(r.version / 10000), 17);
      assert.equal(r.address.split('/')[0], target.server_address);
      return r;
    }),
  );
  result.identities = identity;
  assert.equal(
    new Set(identity.map((r) => r.pid)).size,
    3,
    'Three independent PostgreSQL backends required',
  );
  const [a, b, observer] = clients;
  await a.query(c.beginA); // A retains its transaction locks while idle.
  let bError;
  const blocked = b.query(c.beginB).catch((error) => {
    bError = error;
  });
  let seen = false;
  for (let n = 0; n < 30; n++) {
    const snapshot = (
      await observer.query(
        `select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) as blockers
      from pg_stat_activity where pid=any($1::int[]) order by pid`,
        [[identity[0].pid, identity[1].pid]],
      )
    ).rows;
    if (snapshot.some((r) => r.pid === identity[1].pid && r.blockers.includes(identity[0].pid))) {
      result.snapshots.push(snapshot);
      seen = true;
      break;
    }
    if (bError) throw bError;
    await sleep(100);
  }
  assert.equal(seen, true, 'Must observe B blocked by A before release');
  if (c.revoke) {
    await writeFile(
      base + '-waiting.json',
      JSON.stringify({ name: c.name, identities: identity, blocked: true }) + '\n',
    );
    console.log(`WAITING_FOR_REVOCATION ${index} ${c.name}`);
    let acknowledged = false;
    for (let n = 0; n < 250; n++) {
      try {
        await access(base + '-revoked.json');
        acknowledged = true;
        break;
      } catch {
        await sleep(100);
      }
    }
    assert.equal(
      acknowledged,
      true,
      'Revocation must commit on a separate connection before releasing A',
    );
  }
  await a.query(c.aRollback ? 'rollback' : 'commit');
  await blocked;
  if (bError) throw bError;
  await b.query('commit');
  await observer.query(
    `begin; set local role authenticated; set local request.jwt.claim.sub='30000000-0000-4000-8000-000000000002'; ${c.after} commit;`,
  );
  result.passed = true;
  console.log(
    `PASS native race ${index}: ${c.name}; independent PIDs ${identity.map((r) => r.pid).join(',')}; observed blocked waiter; expected ${c.expect}`,
  );
} catch (error) {
  result.error = {
    code: error.code ?? 'ASSERTION',
    message: String(error.message).replaceAll(config.password, '[redacted]').slice(0, 220),
  };
  console.log(
    `FAIL native race ${index}: ${c.name}; ${result.error.code}: ${result.error.message}`,
  );
  process.exitCode = 1;
} finally {
  await Promise.all(
    clients.map(async (client) => {
      await client.query('rollback').catch(() => {});
      await client.end().catch(() => {});
    }),
  );
  await writeFile(base + '-result.json', JSON.stringify(result, null, 2) + '\n');
}
