import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, asUser, users, id } from './harness';
const branch = id(2, 1),
  target = id(7, 1);
test('Admin department updates preserve ownership and relationships', async (t) => {
  const db = await createDatabase(true, (db) =>
    db.exec(
      `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);`,
    ),
  );
  try {
    for (const f of [
      'phase2b/20261026111934_clinic_auth_onboarding.sql',
      'phase2c/20261026123202_clinic_workspace_commands.sql',
    ])
      await db.exec(await readFile(`supabase/proposals/${f}`, 'utf8'));
    const run = async (
      caller: string,
      data: Record<string, unknown>,
      b = branch,
      action = 'department_update',
    ) => {
      await db.exec('begin');
      try {
        return await asUser(db, caller, () =>
          db.query('select public.manage_clinic($1,$2,$3) id', [b, action, JSON.stringify(data)]),
        );
      } finally {
        await db.exec('rollback');
      }
    };
    const fields = {
      id: target,
      name: 'General Checkup',
      description: 'Updated fictional department description',
    };
    await t.test(
      'old backend rejects new update action without inserting a department',
      async () => {
        const before = (await db.query('select * from public.specializations order by id')).rows;
        await assert.rejects(
          run(users.adminA, fields),
          (e: unknown) => (e as { code: string }).code === '22023',
        );
        assert.deepEqual(
          (await db.query('select * from public.specializations order by id')).rows,
          before,
        );
      },
    );
    const policies = (
      await db.query(
        "select * from pg_policies where schemaname='public' and tablename='specializations' order by policyname",
      )
    ).rows;
    await db.exec(
      await readFile(
        'supabase/proposals/department-edit/20261027170222_clinic_department_edit.sql',
        'utf8',
      ),
    );
    await db.query('insert into public.specializations(id,organization_id,name) values($1,$2,$3)', [
      id(7, 9),
      id(1, 1),
      'Cardiology',
    ]);
    await t.test(
      'Admin updates name/description in place with audit, preserving Doctor and symptom references',
      async () => {
        await db.exec('begin');
        try {
          const doctors = (
            await db.query('select id,specialization_id from public.doctors order by id')
          ).rows;
          const symptoms = (
            await db.query(
              'select * from public.specialization_symptoms order by specialization_id,symptom_category_id',
            )
          ).rows;
          const count = (await db.query('select id from public.specializations')).rows.length;
          await asUser(db, users.adminA, () =>
            db.query('select public.manage_clinic($1,$2,$3)', [
              branch,
              'department_update',
              JSON.stringify({
                ...fields,
                name: ' General Checkup ',
                description: ' Updated description ',
              }),
            ]),
          );
          const row = (
            await db.query<{ name: string; description: string }>(
              'select name,description from public.specializations where id=$1',
              [target],
            )
          ).rows[0];
          assert.deepEqual(row, { name: 'General Checkup', description: 'Updated description' });
          assert.equal(
            (await db.query('select id from public.specializations')).rows.length,
            count,
          );
          assert.deepEqual(
            (await db.query('select id,specialization_id from public.doctors order by id')).rows,
            doctors,
          );
          assert.deepEqual(
            (
              await db.query(
                'select * from public.specialization_symptoms order by specialization_id,symptom_category_id',
              )
            ).rows,
            symptoms,
          );
          assert.equal(
            (
              await db.query(
                "select id from public.audit_logs where actor_id=$1 and entity_id=$2 and action='clinic.department_update.saved'",
                [users.adminA, target],
              )
            ).rows.length,
            1,
          );
        } finally {
          await db.exec('rollback');
        }
      },
    );
    await t.test('Doctor, Patient, foreign Admin and unassigned branch denied', async () => {
      for (const [caller, b] of [
        [users.doctor, branch],
        [users.patient, branch],
        [users.otherOrgAdmin, branch],
        [users.adminA, id(2, 2)],
      ] as const)
        await assert.rejects(
          run(caller, fields, b),
          (e: unknown) => (e as { code: string }).code === '42501',
        );
    });
    await t.test(
      'an Admin cannot update another organization or a nonexistent department',
      async () => {
        await assert.rejects(
          run(users.otherOrgAdmin, fields, id(2, 3)),
          (e: unknown) => (e as { code: string }).code === '42501',
        );
        await assert.rejects(
          run(users.adminA, { ...fields, id: crypto.randomUUID() }),
          (e: unknown) => (e as { code: string }).code === '42501',
        );
      },
    );
    await t.test(
      'empty, excessive fields and duplicate department names rejected atomically',
      async () => {
        for (const extra of [
          { name: ' ' },
          { name: 'x'.repeat(101) },
          { description: 'x'.repeat(2001) },
        ])
          await assert.rejects(
            run(users.adminA, { ...fields, ...extra }),
            (e: unknown) => (e as { code: string }).code === '22023',
          );
        await assert.rejects(
          run(users.adminA, { ...fields, name: 'Cardiology' }),
          (e: unknown) => (e as { code: string }).code === '23505',
        );
      },
    );
    await t.test('description can be cleared; Add department remains available', async () => {
      assert.equal((await run(users.adminA, { ...fields, description: '' })).rows.length, 1);
      assert.equal(
        (
          await run(
            users.adminA,
            { name: 'New Fictional Department', description: 'Fictional' },
            branch,
            'department',
          )
        ).rows.length,
        1,
      );
    });
    await t.test('RLS and existing grants/path/wrapper security remain unchanged', async () => {
      assert.deepEqual(
        (
          await db.query(
            "select * from pg_policies where schemaname='public' and tablename='specializations' order by policyname",
          )
        ).rows,
        policies,
      );
      const r = await db.query<{ ok: boolean }>(
        `select not has_table_privilege('authenticated','public.specializations','UPDATE') and not has_function_privilege('anon','public.manage_clinic(uuid,text,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.manage_clinic(uuid,text,jsonb)','EXECUTE') and (select not prosecdef from pg_proc where oid='public.manage_clinic(uuid,text,jsonb)'::regprocedure) and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='clinic_private.manage_clinic(uuid,text,jsonb)'::regprocedure) ok`,
      );
      assert.equal(r.rows[0].ok, true);
    });
  } finally {
    await db.close();
  }
});
