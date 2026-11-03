import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase } from './harness';

test('Phase 2B proposed provisioning and authorization', async (t) => {
  const db = await createDatabase(false, (db) =>
    db.exec(
      `alter table auth.users add email text, add email_confirmed_at timestamptz, add banned_until timestamptz, add deleted_at timestamptz;
      create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);`,
    ),
  );
  try {
    await db.exec(
      await readFile(
        'supabase/proposals/phase2b/20261026111934_clinic_auth_onboarding.sql',
        'utf8',
      ),
    );
    const admin = '10000000-0000-4000-8000-000000000001';
    const doctor = '10000000-0000-4000-8000-000000000002';
    const patient = '10000000-0000-4000-8000-000000000003';
    const outsider = '10000000-0000-4000-8000-000000000004';
    await db.query(
      `insert into auth.users(id,email) values($1,'admin@example.test'),($2,'doctor@example.test'),($3,'patient@example.test'),($4,'outsider@example.test')`,
      [admin, doctor, patient, outsider],
    );
    async function call(name: string, args: unknown[]) {
      return db.query<{ result: unknown }>(
        `select public.${name}(${args.map((arg, i) => '$' + (i + 1) + (typeof arg === 'string' && arg.startsWith('\\x') ? '::text::bytea' : '')).join(',')}) as result`,
        args,
      );
    }
    async function denied(name: string, args: unknown[], role = 'service_role') {
      await db.exec('begin');
      try {
        await db.exec(`set local role ${role}`);
        await assert.rejects(call(name, args), (e: unknown) =>
          ['42501', '54000'].includes((e as { code: string }).code),
        );
      } finally {
        await db.exec('rollback');
      }
    }
    await t.test('unverified initial Admin cannot bootstrap', () =>
      denied('phase2b_bootstrap', [admin, 'Demo Admin', 'Demo Clinic', 'Main Clinic']),
    );
    await db.exec('update auth.users set email_confirmed_at=now()');
    await t.test('authenticated callers cannot invoke any provisioning command', async () => {
      const rows = await db.query<{ allowed: boolean }>(
        `select has_function_privilege('authenticated',oid,'execute') allowed from pg_proc where pronamespace='public'::regnamespace and proname like 'phase2b_%'`,
      );
      assert.ok(rows.rows.length >= 8);
      assert.ok(rows.rows.every((r) => !r.allowed));
      await denied(
        'phase2b_bootstrap',
        [admin, 'Demo Admin', 'Demo Clinic', 'Main Clinic'],
        'authenticated',
      );
    });
    let organizationId = '',
      branchId = '';
    await t.test('verified operator bootstrap creates exactly scoped Admin', async () => {
      await db.exec('set role service_role');
      const result = (
        await call('phase2b_bootstrap', [admin, 'Demo Admin', 'Demo Clinic', 'Main Clinic'])
      ).rows[0].result as { organizationId: string; branchId: string };
      organizationId = result.organizationId;
      branchId = result.branchId;
      await db.exec('reset role');
      const role = await db.query(`select * from public.role_assignments where user_id=$1`, [
        admin,
      ]);
      assert.equal(role.rows.length, 1);
    });
    await t.test('bootstrap is single-use', () =>
      denied('phase2b_bootstrap', [outsider, 'Other Admin', 'Other Clinic', 'Other Branch']),
    );
    const profile = {
      name: 'Fictional Patient',
      phone: '+923000000000',
      dateOfBirth: '1990-01-01',
      gender: 'Other',
      address: 'Fictional address',
    };
    await t.test('verified patient gets only patient role and own branch', async () => {
      await call('phase2b_patient', [patient, profile]);
      const r = await db.query<{ role: string }>(
        'select role from public.role_assignments where user_id=$1',
        [patient],
      );
      assert.deepEqual(
        r.rows.map((x) => x.role),
        ['patient'],
      );
    });
    await t.test('patient cannot create an invitation', () =>
      denied('phase2b_invite', [
        patient,
        branchId,
        branchId,
        'Doctor',
        'doctor@example.test',
        '\\x' + 'ab'.repeat(32),
      ]),
    );
    const specialization = (await db.query<{ id: string }>('select id from public.specializations'))
      .rows[0].id;
    let invitation = '';
    const hash = '\\x' + 'ab'.repeat(32);
    await t.test('Admin creates draft invitation but no Doctor privilege', async () => {
      const r = await call('phase2b_invite', [
        admin,
        branchId,
        specialization,
        'Fictional Doctor',
        'doctor@example.test',
        hash,
      ]);
      invitation = (r.rows[0].result as { id: string }).id;
      assert.equal((await db.query('select * from public.doctors')).rows.length, 0);
    });
    await t.test('undelivered invitation cannot activate', () =>
      denied('phase2b_accept', [doctor, invitation, hash]),
    );
    await call('phase2b_invitation_delivery', [admin, invitation, true]);
    await t.test('invitation cannot activate a different email', () =>
      denied('phase2b_accept', [outsider, invitation, hash]),
    );
    await t.test('wrong secret cannot activate', () =>
      denied('phase2b_accept', [doctor, invitation, '\\x' + 'cd'.repeat(32)]),
    );
    await t.test('unverified Doctor cannot activate', async () => {
      await db.query('update auth.users set email_confirmed_at=null where id=$1', [doctor]);
      await denied('phase2b_accept', [doctor, invitation, hash]);
      await db.query('update auth.users set email_confirmed_at=now() where id=$1', [doctor]);
    });
    await t.test('expired invitation denied', async () => {
      await db.query(
        `update public.doctor_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1`,
        [invitation],
      );
      await denied('phase2b_accept', [doctor, invitation, hash]);
      await db.query(
        `update public.doctor_invitations set expires_at=now()+interval '1 day' where id=$1`,
        [invitation],
      );
    });
    await t.test('matching verified Doctor consumes invitation atomically', async () => {
      await call('phase2b_accept', [doctor, invitation, hash]);
      const r = await db.query<{ status: string }>(
        `select status from public.doctor_invitations where id=$1`,
        [invitation],
      );
      assert.equal(r.rows[0].status, 'accepted');
      assert.equal(
        (await db.query('select * from public.doctor_branch_assignments')).rows.length,
        1,
      );
    });
    await t.test('consumed invitation replay denied', () =>
      denied('phase2b_accept', [doctor, invitation, hash]),
    );
    await t.test('Doctor cannot self-enroll into patient privileges', () =>
      denied('phase2b_patient', [doctor, profile]),
    );
    await t.test('patient can update own non-authority fields', async () => {
      await call('phase2b_patient', [
        patient,
        { ...profile, name: 'Updated Fictional Patient', role: 'admin' },
      ]);
      assert.deepEqual(
        (
          await db.query<{ role: string }>(
            'select role from public.role_assignments where user_id=$1',
            [patient],
          )
        ).rows.map((x) => x.role),
        ['patient'],
      );
    });
    await t.test('invitation branch permission denied outside Admin branch', async () => {
      const b = (
        await db.query<{ id: string }>(
          `insert into public.branches(organization_id,name) values($1,'Unassigned branch') returning id`,
          [organizationId],
        )
      ).rows[0].id;
      await denied('phase2b_invite', [
        admin,
        b,
        specialization,
        'Other Doctor',
        'other@example.test',
        hash,
      ]);
    });
    await t.test('durable email limit rejects fourth request', async () => {
      for (let i = 0; i < 3; i++) await call('phase2b_email_limit', ['ef'.repeat(32)]);
      await denied('phase2b_email_limit', ['ef'.repeat(32)]);
    });
    await t.test('all new private tables force RLS with no client grants', async () => {
      const r = await db.query<{ secure: boolean }>(
        `select relrowsecurity and relforcerowsecurity and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') secure from pg_class where relnamespace='clinic_private'::regnamespace and relname in ('auth_setup','demo_accounts','auth_email_limits')`,
      );
      assert.equal(r.rows.length, 3);
      assert.ok(r.rows.every((x) => x.secure));
    });
    await t.test('enrolled TOTP blocks aal1 direct reads and membership checks', async () => {
      await db.query(`insert into auth.mfa_factors(user_id,status) values($1,'verified')`, [
        patient,
      ]);
      await db.query(
        `select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{"aal":"aal1"}',false)`,
        [patient],
      );
      await db.exec('set role authenticated');
      try {
        assert.equal((await db.query('select * from public.patients')).rows.length, 0);
        assert.equal((await db.query('select * from public.profiles')).rows.length, 0);
        assert.equal(
          (
            await db.query<{ allowed: boolean }>('select clinic_private.is_member($1) as allowed', [
              organizationId,
            ])
          ).rows[0].allowed,
          false,
        );
      } finally {
        await db.exec('reset role');
      }
    });
    await t.test('aal2 restores only the same patient authorization', async () => {
      await db.exec(
        `select set_config('request.jwt.claims','{"aal":"aal2"}',false);set role authenticated;`,
      );
      try {
        assert.equal((await db.query('select * from public.patients')).rows.length, 1);
      } finally {
        await db.exec('reset role');
      }
    });
    await t.test(
      'anonymous callers have no provisioning EXECUTE and every definer has safe search_path',
      async () => {
        const r = await db.query<{ secure: boolean }>(
          `select not has_function_privilege('anon',oid,'execute') and proconfig @> array['search_path=""'] secure from pg_proc where proname like 'phase2b_%' and pronamespace in ('public'::regnamespace,'clinic_private'::regnamespace)`,
        );
        assert.ok(r.rows.length >= 10);
        assert.ok(r.rows.every((f) => f.secure));
      },
    );
    await t.test('disable demo account immediately removes RLS authority', async () => {
      await call('phase2b_disable_demo', [patient]);
      await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [patient]);
      await db.exec('set role authenticated');
      assert.equal((await db.query('select * from public.patients')).rows.length, 0);
      await db.exec('reset role');
      await denied('phase2b_patient', [patient, profile]);
    });
    await t.test('prepared post-deployment SQL passes against the local proposal', async () => {
      await db.exec(
        `create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key); insert into supabase_migrations.schema_migrations values('20261026024332'),('20261026024335'),('20261026024338'),('20261026111934');`,
      );
      await db.exec(await readFile('scripts/phase2b-post-deployment-checks.sql', 'utf8'));
    });
  } finally {
    await db.close();
  }
});
