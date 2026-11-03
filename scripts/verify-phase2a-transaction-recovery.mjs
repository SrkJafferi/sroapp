// New, targeted recovery rehearsal: ephemeral local WASM only, no remote URL.
// This is not the previously completed security suite or a full backup restore.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
const manifest = JSON.parse(await readFile('supabase/migration-manifest.json', 'utf8'));
const sources = await Promise.all(
  manifest.candidateMigrations.map((m) => readFile('supabase/migrations/' + m.file, 'utf8')),
);
async function createLocal() {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
  return db;
}
async function fingerprint(db) {
  return (
    await db.query(`select
    (select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','clinic_private') and c.relkind='r') as tables,
    (select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p where pronamespace in ('public'::regnamespace,to_regnamespace('clinic_private'))) as functions,
    (select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname) order by n.nspname,t.typname),'[]') from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','clinic_private') and t.typtype='e') as enums,
    (select jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname) from pg_extension) as extensions,
    (select count(*) from auth.users) as auth_users`)
  ).rows[0];
}
const results = [];
for (let failAt = 0; failAt < sources.length; failAt++) {
  const db = await createLocal();
  try {
    for (let j = 0; j < failAt; j++) await db.exec(sources[j]);
    const before = await fingerprint(db);
    assert.match(sources[failAt], /commit;\s*$/i);
    const fault = sources[failAt].replace(/commit;\s*$/i, 'select 1/0;\ncommit;');
    await assert.rejects(
      () => db.exec(fault),
      (e) => e.code === '22012',
    );
    await db.exec('rollback');
    assert.deepEqual(
      await fingerprint(db),
      before,
      'Failed-file objects/ACLs must roll back; earlier files must remain intact',
    );
    for (let j = failAt; j < sources.length; j++) await db.exec(sources[j]);
    const complete = (
      await db.query(`select
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','clinic_private') and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity) as rls_tables,
      (select count(*) from pg_proc where pronamespace='public'::regnamespace) as rpcs,
      (select count(*) from auth.users) as auth_users`)
    ).rows[0];
    assert.deepEqual(complete, { rls_tables: 35, rpcs: 8, auth_users: 0 });
    results.push({
      failedFile: manifest.candidateMigrations[failAt].file,
      rollbackRestoredPreviousCatalog: true,
      retryAndCompletionPassed: true,
    });
    console.log(
      'PASS failed-file rollback and reviewed retry: ' + manifest.candidateMigrations[failAt].file,
    );
  } finally {
    await db.close();
  }
}
await writeFile(
  'artifacts/phase2a-preflight/transaction-recovery.json',
  JSON.stringify(
    {
      runtime: 'PGlite 0.4.6 / PostgreSQL 17.5 WASM',
      remoteExecution: false,
      fullBackupRestoreVerified: false,
      results,
    },
    null,
    2,
  ) + '\n',
);
