// Tests a NEW Doctor/branch assignment created after timezone validation.
import assert from 'node:assert/strict';
import { access, readFile, writeFile, unlink } from 'node:fs/promises';
import pg from '../../artifacts/phase2a5/runtime/node_modules/pg/lib/index.js';
const phase = process.argv[2];
assert.ok(['baseline', 'fixed'].includes(phase));
const config = JSON.parse(await readFile('artifacts/phase2a5/staging-private.json', 'utf8'));
assert.ok(
  config.schemaVersion === 2 && !config.sqlRunner?.retired,
  'SQL runner retired after credential remediation; explicit reprovisioning is required',
);
const target = JSON.parse(await readFile('artifacts/phase2a5/connection-target.json', 'utf8'));
assert.equal(config.projectRef, 'ibulqvolmfouvkqczqhs');
assert.equal(target.projectRef, config.projectRef);
assert.equal(target.host, 'aws-0-ap-south-1.pooler.supabase.com');
assert.equal(target.port, 5432);
const ca = await readFile('artifacts/phase2a5/supabase-root-ca.crt', 'utf8');
const make = () =>
  new pg.Client({
    host: target.host,
    port: target.port,
    database: 'postgres',
    user: `sro_phase2a5_runner.${config.projectRef}`,
    password: config.password,
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
  });
const a = make(),
  observer = make(),
  base = `artifacts/phase2a5/timezone-phantom-${phase}`;
for (const suffix of ['-release.json', '-ready.json', '-b-finished.json']) {
  await unlink(base + suffix).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
}
const result = { projectRef: config.projectRef, phase, passed: false, snapshots: [] };
try {
  await Promise.all([a.connect(), observer.connect()]);
  assert.equal(a.connection.stream.authorized, true);
  const identity = (
    await a.query(
      "select pg_backend_pid() as pid,inet_server_addr()::text as address,current_setting('server_version_num')::int as version",
    )
  ).rows[0];
  assert.equal(identity.address.split('/')[0], target.server_address);
  assert.equal(Math.floor(identity.version / 10000), 17);
  result.blockerPid = identity.pid;
  await a.query(`begin; set local role service_role; set local application_name='p2a5_timezone_phantom';
    update public.branches set timezone='America/New_York' where id='20000000-0000-4000-8000-000000000002';`);
  await writeFile(base + '-ready.json', JSON.stringify({ pid: identity.pid }) + '\n');
  console.log(`TIMEZONE_READY ${phase} backend ${identity.pid}`);
  let release = false;
  for (let n = 0; n < 400; n++) {
    const waiting = (
      await observer.query(
        'select pid,pg_blocking_pids(pid) as blockers from pg_stat_activity where $1=any(pg_blocking_pids(pid))',
        [identity.pid],
      )
    ).rows;
    if (waiting.length && !result.snapshots.length) result.snapshots.push(waiting);
    try {
      await access(base + '-release.json');
      release = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(release, 'Controller must release timezone transaction');
  await a.query('commit');
  // The controller waits for B's final outcome before acknowledging it here.
  for (let n = 0; n < 100; n++) {
    try {
      await access(base + '-b-finished.json');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const slot =
    phase === 'baseline'
      ? '60000000-0000-4000-8000-000000009000'
      : '60000000-0000-4000-8000-000000009001';
  await observer.query(
    "set role authenticated; select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',false)",
  );
  const r = (
    await observer.query(
      `select count(*)::int as active_holds,count(*) filter(where not exists(
    select 1 from public.doctor_schedules w where w.doctor_id=r.doctor_id and w.branch_id=r.branch_id
      and w.weekday=extract(dow from r.starts_at at time zone b.timezone)
      and (r.starts_at at time zone b.timezone)::time>=w.starts_at
      and (r.ends_at at time zone b.timezone)::time<=w.ends_at))::int as invalid_active_holds
    from public.appointment_reservations r join public.branches b on b.id=r.branch_id where r.slot_id=$1 and r.active`,
      [slot],
    )
  ).rows[0];
  result.invariants = r;
  assert.equal(
    r.invalid_active_holds,
    0,
    'A timezone commit must not invalidate a concurrently created held appointment',
  );
  if (phase === 'fixed')
    assert.ok(
      result.snapshots.length,
      'Must observe new-assignment writer blocked by timezone row lock',
    );
  result.passed = true;
  console.log(`PASS timezone new-assignment phantom ${phase}`);
} catch (e) {
  result.error = { code: e.code ?? 'ASSERTION', message: String(e.message).split('\n')[0] };
  console.log(`FAIL timezone new-assignment phantom ${phase}: ${result.error.message}`);
  process.exitCode = 1;
} finally {
  await a.query('rollback').catch(() => {});
  await Promise.all([a.end(), observer.end()]);
  await writeFile(base + '-result.json', JSON.stringify(result, null, 2) + '\n');
}
