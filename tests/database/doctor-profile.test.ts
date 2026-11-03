import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, id, users, asUser } from './harness';
const org = '88645fbe-34da-48aa-a509-c24441b7cf72',
  patient = '398cf267-bc60-41a4-91e6-478dcd86a069';
test('scoped Doctor verified login email proposal', async (t) => {
  const db = await createDatabase(false, (db) =>
    db.exec(
      `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon,service_role;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`,
    ),
  );
  try {
    for (const f of [
      'phase2b/20261026111934_clinic_auth_onboarding.sql',
      'phase2c/20261026123202_clinic_workspace_commands.sql',
      'profiles/20261026192535_clinic_profiles_avatars.sql',
    ])
      await db.exec(await readFile(`supabase/proposals/${f}`, 'utf8'));
    await db.exec(
      (await readFile('supabase/fixtures/fictional.sql', 'utf8'))
        .replaceAll(id(1, 1), org)
        .replaceAll(id(5, 1), patient)
        .replaceAll('Fictional Patient A', 'Amina Noor'),
    );
    for (const table of ['medical_documents', 'patient_medical_history', 'patient_branches'])
      await db.query(`delete from public.${table} where patient_id<>$1`, [patient]);
    await db.query('delete from public.patients where id<>$1', [patient]);
    await db.exec(
      `update auth.users set email=id::text||'@example.test',email_confirmed_at=now();`,
    );
    for (const f of [
      'patient-ids/20261026195847_clinic_patient_numbers.sql',
      'patient-age/20261026224947_clinic_patient_age.sql',
      'walk-in/20261027093051_clinic_walk_in_registration.sql',
      'staff-booking/20261027105809_clinic_staff_booking_profiles.sql',
      'patient-registration/20261027155325_clinic_patient_registration_timestamp.sql',
    ])
      await db.exec(await readFile(`supabase/proposals/${f}`, 'utf8'));
    const previous = (await db.query('select id,name,public_email from public.doctors order by id'))
      .rows;
    await db.exec(
      await readFile(
        'supabase/proposals/doctor-profile/20261027164031_clinic_doctor_verified_email.sql',
        'utf8',
      ),
    );
    await db.exec('begin');
    const read = (caller: string | null, doctor = id(4, 1), o = org, role = 'authenticated') =>
      asUser(
        db,
        caller,
        async () =>
          (
            await db.query<{
              p: {
                loginEmail: string | null;
                loginEmailVisible: boolean;
                email: string;
                canEdit: boolean;
              };
            }>('select public.get_clinic_profile($1,$2,$3) p', [o, 'doctor', doctor])
          ).rows[0].p,
        role,
      );
    const deny = (p: Promise<unknown>) =>
      assert.rejects(p, (e: unknown) => (e as { code: string }).code === '42501');
    const isolated = async (fn: () => Promise<void>) => {
      await db.exec('savepoint test_scope');
      try {
        await fn();
      } finally {
        await db.exec('rollback to savepoint test_scope;release savepoint test_scope');
      }
    };
    await t.test(
      'Doctor self sees same verified email as authorized all-branch Admin',
      async () => {
        const self = await read(users.doctor),
          admin = await read(users.adminAll);
        assert.equal(self.loginEmail, users.doctor + '@example.test');
        assert.equal(admin.loginEmail, self.loginEmail);
        assert.equal(admin.canEdit, true);
        assert.equal(admin.loginEmailVisible, true);
      },
    );
    await t.test('branch Admin sees email only for Doctor they may manage', async () => {
      assert.equal(
        (await read(users.adminA, id(4, 2))).loginEmail,
        users.otherDoctor + '@example.test',
      );
      const partial = await read(users.adminA);
      assert.equal(partial.canEdit, false);
      assert.equal(partial.loginEmail, null);
      assert.equal(partial.loginEmailVisible, false);
    });
    await t.test(
      'Patient and unrelated Doctor can browse profile without receiving login email',
      async () => {
        for (const caller of [users.patient, users.otherDoctor]) {
          const p = await read(caller);
          assert.equal(p.loginEmail, null);
          assert.equal(p.loginEmailVisible, false);
          assert.equal(p.canEdit, false);
        }
      },
    );
    await t.test('anonymous, cross-organization and unassigned-branch callers denied', async () => {
      await deny(read(null, id(4, 1), org, 'anon'));
      await deny(read(users.otherOrgAdmin));
      await deny(read(users.adminA, id(4, 3)));
      await deny(read(users.adminAll, id(4, 4), id(1, 2)));
    });
    await t.test('public contact email is distinct from Auth login email', () =>
      isolated(async () => {
        await db.query('update public.doctors set public_email=$1 where id=$2', [
          'public-contact@example.test',
          id(4, 1),
        ]);
        const p = await read(users.adminAll);
        assert.equal(p.email, 'public-contact@example.test');
        assert.equal(p.loginEmail, users.doctor + '@example.test');
      }),
    );
    await t.test('unverified, banned and deleted target accounts do not disclose email', () =>
      isolated(async () => {
        for (const change of [
          'email_confirmed_at=null',
          "banned_until=now()+interval '1 day'",
          'deleted_at=now()',
        ]) {
          await db.query(
            `update auth.users set email_confirmed_at=now(),banned_until=null,deleted_at=null where id=$1`,
            [users.otherDoctor],
          );
          await db.query(`update auth.users set ${change} where id=$1`, [users.otherDoctor]);
          const p = await read(users.adminA, id(4, 2));
          assert.equal(p.loginEmailVisible, true);
          assert.equal(p.loginEmail, null);
        }
      }),
    );
    await t.test('revoked branch authority removes previously granted email access', () =>
      isolated(async () => {
        await db.query(
          'update public.branch_memberships set active=false where user_id=$1 and branch_id=$2',
          [users.adminA, id(2, 1)],
        );
        await deny(read(users.adminA, id(4, 2)));
      }),
    );
    await t.test(
      'Admin cannot change Auth email through profile save; unknown Auth field denied',
      async () => {
        await assert.rejects(
          asUser(db, users.adminAll, () =>
            db.query('select public.save_clinic_profile($1,$2,$3,$4,$5,$6)', [
              org,
              'doctor',
              id(4, 1),
              JSON.stringify({ name: 'Fictional Doctor', loginEmail: 'attacker@example.test' }),
              'keep',
              null,
            ]),
          ),
        );
        assert.equal((await read(users.adminAll)).loginEmail, users.doctor + '@example.test');
      },
    );
    await t.test(
      'no Auth table grants or private helper access introduced; wrapper unchanged',
      async () => {
        const r = await db.query<{ ok: boolean }>(
          `select not has_table_privilege('authenticated','auth.users','SELECT') and not has_function_privilege('anon','public.get_clinic_profile(uuid,text,uuid)','EXECUTE') and has_function_privilege('authenticated','clinic_private.read_profile(uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','clinic_private.read_profile(uuid,text,uuid)','EXECUTE') and not has_function_privilege('service_role','clinic_private.read_profile(uuid,text,uuid)','EXECUTE') and (select not prosecdef from pg_proc where oid='public.get_clinic_profile(uuid,text,uuid)'::regprocedure) ok`,
        );
        assert.equal(r.rows[0].ok, true);
        assert.deepEqual(
          (await db.query('select id,name,public_email from public.doctors order by id')).rows,
          previous,
        );
      },
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});

