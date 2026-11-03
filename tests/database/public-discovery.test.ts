import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, asUser, id } from './harness';
import { parseDiscoveryFeed } from '../../packages/data-access/src/public-discovery';

test('public publication boundary on local PostgreSQL', async (t) => {
  const db = await createDatabase();
  try {
    const policies = (
      await db.query('select * from pg_policies order by schemaname,tablename,policyname')
    ).rows;
    await db.exec(
      await readFile(
        'supabase/proposals/public-discovery/20261102180441_clinic_public_discovery.sql',
        'utf8',
      ),
    );
    const publicRead = async (sql: string, params: unknown[] = [], role = 'anon') => {
      await db.exec('begin');
      try {
        return await asUser(db, null, () => db.query(sql, params), role);
      } finally {
        await db.exec('rollback');
      }
    };
    const feed = async (org = id(1, 1)) =>
      parseDiscoveryFeed(
        (await publicRead('select public.get_public_discovery($1) feed', [org])).rows[0].feed,
      );
    const publish = (column: string, entity: string) =>
      db.query(
        `insert into clinic_discovery.publications(organization_id,${column},published) values($1,$2,true)`,
        [id(1, 1), entity],
      );
    await t.test('existing RLS policies unchanged', async () =>
      assert.deepEqual(
        (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
        policies,
      ),
    );
    await t.test('no publication means valid empty arrays', async () =>
      assert.deepEqual(await feed(), { version: 1, branches: [], doctors: [], departments: [] }),
    );
    await t.test('anonymous cannot read clinical tables or publication controls', async () => {
      for (const table of [
        'clinic_discovery.publications',
        'public.patients',
        'public.doctors',
        'public.branches',
        'public.appointments',
        'auth.users',
      ])
        await assert.rejects(publicRead(`select * from ${table}`));
    });
    await t.test('authenticated clients cannot publish records', async () => {
      await assert.rejects(
        publicRead(
          'insert into clinic_discovery.publications(organization_id,branch_id,published) values($1,$2,true)',
          [id(1, 1), id(2, 1)],
          'authenticated',
        ),
      );
    });
    await t.test('published branch exposes only approved minimal fields', async () => {
      await publish('branch_id', id(2, 1));
      const f = await feed();
      assert.equal(f.branches.length, 1);
      assert.equal(f.doctors.length, 0);
      assert.deepEqual(
        Object.keys(f.branches[0])
          .filter((k) => f.branches[0][k as keyof (typeof f.branches)[0]] !== undefined)
          .sort(),
        ['id', 'location', 'name'],
      );
    });
    await t.test(
      'doctor requires explicit publication plus published department and active assignment',
      async () => {
        await publish('doctor_id', id(4, 1));
        assert.equal((await feed()).doctors.length, 0);
        await publish('department_id', id(7, 1));
        const f = await feed();
        assert.equal(f.doctors.length, 1);
        assert.deepEqual(f.doctors[0].branchIds, [id(2, 1)]);
        assert.deepEqual(f.departments[0].doctorIds, [id(4, 1)]);
      },
    );
    await t.test('unpublished organizations and private fields never leak', async () => {
      assert.deepEqual(await feed(id(1, 2)), {
        version: 1,
        branches: [],
        doctors: [],
        departments: [],
      });
      const raw = JSON.stringify(
        (await publicRead('select public.get_public_discovery($1) feed', [id(1, 1)])).rows,
      );
      for (const key of [
        'user_id',
        'email',
        'phone',
        'patient',
        'prescription',
        'appointment',
        'loginEmail',
      ])
        assert.ok(!raw.includes(`"${key}"`));
    });
    await t.test('cross-tenant publication references rejected', async () => {
      await assert.rejects(
        db.query(
          'insert into clinic_discovery.publications(organization_id,branch_id,published) values($1,$2,true)',
          [id(1, 2), id(2, 1)],
        ),
      );
    });
    await t.test(
      'revocation removes branch and dependent doctor relationships immediately',
      async () => {
        await db.query(
          'update clinic_discovery.publications set published=false where branch_id=$1',
          [id(2, 1)],
        );
        const f = await feed();
        assert.equal(f.branches.length, 0);
        assert.equal(f.doctors.length, 0);
        assert.deepEqual(f.departments[0].branchIds, []);
      },
    );
    await t.test('private controls have forced RLS and definer has fixed search path', async () => {
      const r = (
        await db.query(
          "select relrowsecurity,relforcerowsecurity from pg_class where oid='clinic_discovery.publications'::regclass",
        )
      ).rows[0];
      assert.equal(r.relrowsecurity, true);
      assert.equal(r.relforcerowsecurity, true);
      const fn = (
        await db.query(
          "select prosecdef,proconfig from pg_proc where oid='clinic_discovery.read_feed(uuid)'::regprocedure",
        )
      ).rows[0];
      assert.equal(fn.prosecdef, true);
      assert.ok(String(fn.proconfig).includes('search_path='));
    });
  } finally {
    await db.close();
  }
});
