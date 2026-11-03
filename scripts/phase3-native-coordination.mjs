// Staging-only. No protected connection, Auth account/password operation or raw secret output.
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from '../artifacts/phase2a5/runtime/node_modules/pg/lib/index.js';
const exec = promisify(execFile),
  ref = 'ibulqvolmfouvkqczqhs';
const schema = 'sro_phase3_' + randomBytes(5).toString('hex'),
  role = 'sro_phase3_' + randomBytes(5).toString('hex');
const out = 'artifacts/phase3-account-readiness';
await mkdir(out, { recursive: true });
let phase = 'setup',
  db,
  config;
const children = [];
const results = [];
let sequence = 0;
async function sql(text) {
  const file = out + '/management-' + randomUUID() + '.sql';
  await writeFile(file, text);
  const env = { ...process.env };
  delete env.DEBUG;
  delete env.PWDEBUG;
  delete env.NODE_DEBUG;
  let stdout;
  try {
    ({ stdout } = await exec(
      process.execPath,
      [
        path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
        '--yes',
        'supabase@2.122.0',
        'db',
        'query',
        '--linked',
        '--project-ref',
        ref,
        '--file',
        path.resolve(file),
        '--output',
        'json',
        '--log-level',
        'error',
      ],
      { env, windowsHide: true, maxBuffer: 2e6 },
    ));
  } catch (e) {
    const diagnostic = String(e.stderr ?? '') + ' ' + String(e.stdout ?? '');
    console.error(
      JSON.stringify({
        cliFailure: true,
        exitCode: e.code,
        sqlstate: diagnostic.match(/\b[0-9A-Z]{5}\b(?=\))/)?.[0],
        pathError: /not recognized|cannot find|no such file|could not read/i.test(diagnostic),
        syntaxError: /syntax error/i.test(diagnostic),
        missingObject: /does not exist/i.test(diagnostic),
        permissionError: /permission denied/i.test(diagnostic),
      }),
    );
    throw Error('Private CLI failure');
  }
  // CLI results may include a harmless prefix. Never print raw output: setup returns a secret.
  // Current CLI releases return an array; older ones returned { rows }. Accept both.
  const parsed = JSON.parse(stdout.slice(stdout.search(/[[{]/)));
  return Array.isArray(parsed) ? parsed : parsed.rows;
}
const safe = (ok, label) => {
  if (!ok) throw Error(label);
};
function worker() {
  const child = fork('tests/database/phase3-operation-worker.mjs', [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  children.push(child);
  const pending = new Map();
  child.on('message', (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.progress) {
      p.progress?.();
      return;
    }
    pending.delete(m.id);
    p.resolve(m);
  });
  child.on('exit', () => {
    for (const [id, p] of pending) {
      pending.delete(id);
      p.resolve({ ok: false, code: 'WORKER_EXIT' });
    }
  });
  return {
    send(m, progress) {
      return new Promise((resolve) => {
        const id = ++sequence;
        pending.set(id, { resolve, progress });
        child.send({ ...m, id });
      });
    },
    child,
  };
}
const patient = '50000000-0000-4000-8000-000000000001',
  org = '10000000-0000-4000-8000-000000000001',
  actor = '30000000-0000-4000-8000-000000000002';
const cap = (purpose = 'provision') => ({
  op: randomUUID(),
  worker: randomUUID(),
  proof: randomBytes(32).toString('base64url'),
  request: randomUUID(),
  purpose,
  fence: null,
});
const query = (c, action, data = {}) => ({
  type: 'query',
  text: `select ${schema}.patient_operation_core($1,$2,$3,$4,$5,$6,$7,$8) r`,
  values: [
    action,
    c.op,
    org,
    patient,
    actor,
    c.worker,
    c.proof,
    JSON.stringify({ purpose: c.purpose, requestId: c.request, fence: c.fence, ...data }),
  ],
});
async function own(c, action, data) {
  const q = query(c, action, data);
  return (await db.query(q.text, q.values)).rows[0].r;
}
async function claim(c) {
  const r = await own(c, 'claim');
  c.fence = r.fence;
  return c;
}
async function bind(c) {
  await own(c, 'bind', { userId: randomUUID() });
}
async function scenario(name, run) {
  phase = name;
  await db.query(`select ${schema}.clear_fixture()`);
  await run();
  results.push({ name, passed: true });
  console.log(JSON.stringify({ case: name, passed: true }));
}
try {
  const source = await readFile(
    'supabase/proposals/patient-account-coordination/20261030065902_clinic_patient_account_coordination.sql',
    'utf8',
  );
  const core = source
    .split('-- BEGIN COORDINATION CORE')[1]
    .split('\n')
    .slice(1)
    .join('\n')
    .split('-- END COORDINATION CORE')[0]
    .replaceAll('clinic_private', schema);
  await sql(`create schema ${schema};${core}
 create function ${schema}.clear_fixture() returns void language sql security definer set search_path='' as 'delete from ${schema}.patient_operations';
 create function ${schema}.expire_fixture(op uuid) returns void language sql security definer set search_path='' as 'update ${schema}.patient_operations set start_before=clock_timestamp()-interval ''1 day'' where operation_id=op';
 revoke all on function ${schema}.clear_fixture(),${schema}.expire_fixture(uuid) from public,anon,authenticated,service_role;
 do $setup$ declare secret text:=encode(extensions.gen_random_bytes(32),'hex');begin execute format('create role ${role} login nosuperuser nocreatedb nocreaterole noreplication password %L',secret);perform set_config('sro.phase3_secret',secret,true);end $setup$;
 grant usage on schema ${schema} to ${role};grant execute on all functions in schema ${schema} to ${role};grant select(operation_id,phase,fence,started_at) on ${schema}.patient_operations to ${role};
 select current_setting('sro.phase3_secret') as password;`).then(async (rows) => {
    safe(typeof rows[0]?.password === 'string', 'Staging runner setup failed');
    config = {
      host: 'aws-0-ap-south-1.pooler.supabase.com',
      port: 5432,
      user: role + '.' + ref,
      password: rows[0].password,
      database: 'postgres',
      ssl: {
        ca: await readFile('artifacts/phase2a5/supabase-root-ca.crt', 'utf8'),
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: 15000,
    };
  });
  db = new pg.Client(config);
  await db.connect();
  safe(db.connection.stream.authorized, 'TLS failed');
  const identity = (
    await db.query(
      "select current_setting('server_version') version,pg_backend_pid() pid,current_user",
    )
  ).rows[0];
  safe(identity.version.startsWith('17.'), 'PostgreSQL 17 required');
  safe(identity.current_user === role, 'Wrong runner');
  const a = worker(),
    b = worker();
  const ids = await Promise.all([
    a.send({ type: 'connect', config }),
    b.send({ type: 'connect', config }),
  ]);
  safe(
    ids.every((x) => x.ok) && new Set(ids.map((x) => x.backend).concat(identity.pid)).size === 3,
    'Independent backends required',
  );
  await scenario('simultaneous-provision-claims', async () => {
    const x = cap(),
      y = cap();
    const q = query(x, 'claim');
    const first = a.send({
      type: 'query',
      text: `begin;select ${schema}.patient_operation_core('${q.values[0]}','${x.op}','${org}','${patient}','${actor}','${x.worker}','${x.proof}','${q.values[7]}');select pg_sleep(0.5);commit;`,
    });
    await new Promise((r) => setTimeout(r, 100));
    const second = b.send(query(y, 'claim'));
    const r = await Promise.all([first, second]);
    safe(r[0].ok && !r[1].ok && r[1].code === '23505', 'Duplicate claim accepted');
  });
  await scenario('one-provider-start-across-processes', async () => {
    const x = await claim(cap());
    await bind(x);
    const r = await Promise.all([a.send(query(x, 'start')), b.send(query(x, 'start'))]);
    safe(
      r.filter((y) => y.ok).length === 1 && r.some((y) => y.code === '42501'),
      'Provider started twice',
    );
  });
  await scenario('reset-excludes-activation', async () => {
    const x = await claim(cap('reset'));
    await bind(x);
    await own(x, 'start');
    const r = await b.send(query(cap('activate'), 'claim'));
    safe(r.code === '23505', 'Overlapping password writes admitted');
  });
  await scenario('expired-claimed-operation-cannot-start-or-replace', async () => {
    const x = await claim(cap());
    await bind(x);
    await db.query(`select ${schema}.expire_fixture($1)`, [x.op]);
    safe((await a.send(query(x, 'start'))).code === '42501', 'Expired start accepted');
    safe((await b.send(query(cap(), 'claim'))).code === '23505', 'Expired claim replaced');
  });
  await scenario('ambiguous-outcome-never-auto-reclaimed', async () => {
    const x = await claim(cap());
    await bind(x);
    await own(x, 'start');
    await db.query(`select ${schema}.expire_fixture($1)`, [x.op]);
    await own(x, 'quarantine');
    safe((await b.send(query(cap(), 'claim'))).code === '23505', 'Quarantine replaced');
    safe((await a.send(query(x, 'confirm'))).code === '42501', 'Late confirmation accepted');
  });
  await scenario('stale-fence-and-wrong-worker-denied', async () => {
    const x = await claim(cap());
    await bind(x);
    for (const bad of [
      { ...x, fence: String(BigInt(x.fence) + 1n) },
      { ...x, worker: randomUUID() },
      { ...x, proof: 'z'.repeat(43) },
    ])
      safe((await b.send(query(bad, 'start'))).code === '42501', 'Forged capability accepted');
  });
  await scenario('completed-operation-cannot-commit-into-next-generation', async () => {
    const x = await claim(cap());
    await bind(x);
    await own(x, 'start');
    await own(x, 'confirm');
    await own(x, 'finish');
    const y = await claim(cap('reset'));
    safe(BigInt(y.fence) > BigInt(x.fence), 'Fence not monotonic');
    safe((await a.send(query(x, 'finish'))).code === '42501', 'Stale completion accepted');
  });
  await scenario('network-provider-delay-holds-no-db-transaction', async () => {
    const x = await claim(cap());
    await bind(x);
    let ready;
    const started = new Promise((r) => {
      ready = r;
    });
    const delayed = a.send({ ...query(x, 'start'), type: 'delay' }, ready);
    await started;
    const row = (
      await db.query(
        'select state,xact_start is null as no_transaction from pg_stat_activity where pid=$1',
        [ids[0].backend],
      )
    ).rows[0];
    safe(row?.state === 'idle' && row.no_transaction, 'Transaction held during provider call');
    safe(
      (await b.send(query(cap(), 'claim'))).code === '23505',
      'Second writer admitted while provider delayed',
    );
    safe((await delayed).ok, 'Delayed provider fixture failed');
  });
  await scenario('worker-crash-keeps-operation-fenced', async () => {
    const x = await claim(cap());
    await bind(x);
    let ready;
    const started = new Promise((r) => {
      ready = r;
    });
    const crashed = a.send({ ...query(x, 'start'), type: 'delay', crash: true }, ready);
    await started;
    await crashed;
    safe((await b.send(query(cap(), 'claim'))).code === '23505', 'Crashed worker replaced');
    await own(x, 'quarantine');
    safe((await b.send(query(x, 'confirm'))).code === '42501', 'Quarantine bypassed');
  });
  await writeFile(
    out + '/native-results.json',
    JSON.stringify(
      {
        projectRef: ref,
        schema,
        role,
        postgres: identity.version,
        workerProcessIds: ids.map((x) => x.pid),
        backendPids: [identity.pid, ...ids.map((x) => x.backend)],
        provider: 'synthetic delayed/crashed provider boundary; no GoTrue mutation',
        cases: results,
        passed: results.length,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: results.length, stagingOnly: true }));
} catch {
  await writeFile(
    out + '/native-failure.json',
    JSON.stringify({ phase, passedCases: results, stagingOnly: true }),
  );
  console.error('Native staging checks stopped at ' + phase);
  process.exitCode = 1;
} finally {
  for (const child of children) if (child.connected) child.kill();
  await db?.end();
  if (config) {
    await sql(
      `alter role ${role} nologin password null;revoke all on all functions in schema ${schema} from ${role};revoke select(operation_id,phase,fence,started_at) on ${schema}.patient_operations from ${role};revoke all on all tables in schema ${schema} from ${role};revoke all on schema ${schema} from ${role};`,
    ).catch(() => {
      console.error('Staging runner retirement requires review');
      process.exitCode = 1;
    });
    config.password = undefined;
  }
}
