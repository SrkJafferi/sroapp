import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, asUser, users, id, book, transition } from './harness';
const org = id(1, 1),
  patient = id(5, 1),
  doctor = id(4, 1);
test('profile and private avatar additive candidate', async (t) => {
  const db = await createDatabase(true, (db) =>
    db.exec(
      `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon,service_role;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`,
    ),
  );
  try {
    await db.exec(
      await readFile(
        'supabase/proposals/phase2b/20261026111934_clinic_auth_onboarding.sql',
        'utf8',
      ),
    );
    await db.exec(
      await readFile(
        'supabase/proposals/phase2c/20261026123202_clinic_workspace_commands.sql',
        'utf8',
      ),
    );
    await db.exec(
      await readFile(
        'supabase/proposals/profiles/20261026192535_clinic_profiles_avatars.sql',
        'utf8',
      ),
    );
    await db.exec(
      `update auth.users set email='fictional@example.test',email_confirmed_at=now();begin;`,
    );
    const appointment = await book(db);
    await transition(db, appointment, 'confirmed');
    const isolated = async (run: () => Promise<void>) => {
      await db.exec('savepoint case_scope');
      try {
        await run();
      } finally {
        await db.exec('rollback to savepoint case_scope;release savepoint case_scope');
      }
    };
    const denied = (run: Promise<unknown>) =>
      assert.rejects(run, (e: unknown) => (e as { code: string }).code === '42501');
    const save = (
      user = users.patient,
      k = 'patient',
      target = patient,
      data: unknown = { name: 'Fictional Updated' },
      photo = 'keep',
      aid: string | null = null,
      o = org,
    ) =>
      asUser(db, user, () =>
        db.query<{ p: Record<string, unknown> }>(
          'select public.save_clinic_profile($1,$2,$3,$4,$5,$6) p',
          [o, k, target, JSON.stringify(data), photo, aid],
        ),
      );
    const begin = (user = users.patient, k = 'patient', target = patient) =>
      asUser(db, user, async () => {
        const r = await db.query<{ a: { id: string; objectKey: string } }>(
          'select public.begin_profile_avatar($1,$2,$3,$4,100) a',
          [org, k, target, randomUUID()],
        );
        return r.rows[0].a;
      });
    await t.test('replay, private bucket, forced RLS and no table grants', async () => {
      await db.exec(await readFile('scripts/profile-post-deployment-checks.sql', 'utf8'));
      const r = await db.query<{ public: boolean; file_size_limit: number }>(
        'select public,file_size_limit from storage.buckets',
      );
      assert.equal(r.rows[0].public, false);
      assert.equal(r.rows[0].file_size_limit, 2097152);
      const check = await db.query<{ rls: boolean; grants: boolean }>(
        `select relrowsecurity and relforcerowsecurity rls,has_table_privilege('authenticated','clinic_private.profile_avatars','SELECT') grants from pg_class where oid='clinic_private.profile_avatars'::regclass`,
      );
      assert.equal(check.rows[0].rls, true);
      assert.equal(check.rows[0].grants, false);
    });
    await t.test('Admin, Doctor and Patient edit own permitted fields', () =>
      isolated(async () => {
        await save(users.adminA, 'profile', users.adminA);
        await save(users.doctor, 'doctor', doctor, {
          name: 'Dr. Fictional Updated',
          qualifications: 'MBBS',
          experience: 5,
          bio: 'Fictional biography',
          email: 'contact@example.test',
        });
        const r = await save(users.patient, 'patient', patient, {
          name: 'Fictional Updated',
          dateOfBirth: '1990-06-01',
          email: 'different@example.test',
          phone: '000',
          address: 'Fictional address',
        });
        assert.equal(r.rows[0].p.email, 'different@example.test');
        assert.equal(r.rows[0].p.loginEmail, 'fictional@example.test');
      }),
    );
    await t.test('Admin can edit scoped Doctor and Patient; audit records actor and target', () =>
      isolated(async () => {
        await save(users.adminAll, 'doctor', doctor);
        await save(users.adminA, 'patient', patient);
        const r = await db.query<{ n: number }>(
          `select count(*)::int n from public.audit_logs where action='profile.updated.keep' and actor_id=$1 and entity_id=$2`,
          [users.adminA, patient],
        );
        assert.equal(r.rows[0].n, 1);
      }),
    );
    await t.test('partial branch Admin cannot alter global multi-branch Doctor profile', () =>
      denied(save(users.adminA, 'doctor', doctor)),
    );
    await t.test('assigned Doctor can edit Patient without changing signed clinical data', () =>
      isolated(async () => {
        await save(users.doctor, 'patient', patient);
        assert.equal(
          (
            await db.query<{ name: string }>('select name from public.patients where id=$1', [
              patient,
            ])
          ).rows[0].name,
          'Fictional Updated',
        );
      }),
    );
    await t.test('unassigned Doctor and unrelated Patient denied', async () => {
      await denied(save(users.otherDoctor));
      await denied(save(users.otherPatient));
      await denied(begin(users.otherDoctor));
    });
    await t.test('Doctor cannot edit other Doctor or Admin', async () => {
      await denied(save(users.doctor, 'doctor', id(4, 2)));
      await denied(save(users.doctor, 'profile', users.adminA));
    });
    await t.test('revoked assignment denies edits and avatar begins', () =>
      isolated(async () => {
        await db.exec('update public.patient_assignments set active=false');
        await denied(save(users.doctor));
        await denied(begin(users.doctor));
      }),
    );
    await t.test('clinical grant or historical appointment alone never grants profile writes', () =>
      isolated(async () => {
        await db.exec(
          `update public.patient_assignments set active=false;insert into public.clinical_access_grants(organization_id,patient_id,branch_id,user_id,can_write,reason,expires_at,granted_by) values('${org}','${patient}','${id(2, 1)}','${users.otherDoctor}',true,'Fictional',now()+interval '1 day','${users.adminA}')`,
        );
        await denied(save(users.otherDoctor));
      }),
    );
    await t.test('inactive Doctor branch assignment denies patient edits', () =>
      isolated(async () => {
        await transition(db, appointment, 'cancellation_requested');
        await transition(db, appointment, 'cancelled');
        await db.query(
          'update public.doctor_branch_assignments set active=false where doctor_id=$1',
          [doctor],
        );
        await denied(save(users.doctor));
      }),
    );
    await t.test('foreign branch, organization and forged target denied', async () => {
      await denied(save(users.doctor, 'patient', id(5, 3)));
      await denied(save(users.otherOrgAdmin));
      await denied(
        save(users.patient, 'patient', patient, { name: 'Fictional' }, 'keep', null, id(1, 2)),
      );
      await denied(save(users.patient, 'patient', randomUUID()));
    });
    await t.test(
      'role, IDs, Auth email, medical fields, invalid dates and extra keys rejected',
      async () => {
        for (const data of [
          { name: 'Fictional', role: 'admin' },
          { name: 'Fictional', user_id: users.adminA },
          { name: 'Fictional', organization_id: id(1, 2) },
          { name: 'Fictional', active: false },
          { name: 'Fictional', loginEmail: 'attacker@example.test' },
          { name: 'Fictional', diagnosis: 'rewrite' },
          { name: 'Fictional', dateOfBirth: '2999-01-01' },
        ])
          await assert.rejects(save(users.patient, 'patient', patient, data));
      },
    );
    await t.test('anonymous, direct metadata writes and self-attestation denied', async () => {
      await denied(
        asUser(
          db,
          null,
          () => db.query('select public.get_clinic_profile($1,$2,$3)', [org, 'patient', patient]),
          'anon',
        ),
      );
      await denied(
        asUser(db, users.patient, () => db.exec(`update public.patients set name='Forbidden'`)),
      );
      await denied(
        asUser(db, users.patient, () =>
          db.query('select public.attest_profile_avatar($1,$2,$3,$4,$5)', [
            randomUUID(),
            users.patient,
            randomUUID(),
            '1',
            'a'.repeat(64),
          ]),
        ),
      );
    });
    await t.test(
      'trusted byte attestation, private registration, immutable current object and removal',
      () =>
        isolated(async () => {
          const a = await begin();
          await asUser(db, users.patient, () =>
            db.query(
              `insert into storage.objects(bucket_id,name,owner_id,metadata) values('clinic-profile-avatars',$1,$2,'{"size":100,"mimetype":"image/webp"}')`,
              [a.objectKey, users.patient],
            ),
          );
          await assert.rejects(
            save(users.patient, 'patient', patient, { name: 'Fictional' }, 'replace', a.id),
          );
          const obj = (
            await db.query<{ id: string; version: string }>(
              'select id,version from storage.objects where name=$1',
              [a.objectKey],
            )
          ).rows[0];
          await db.exec('set role service_role');
          await db.query('select public.attest_profile_avatar($1,$2,$3,$4,$5)', [
            a.id,
            users.patient,
            obj.id,
            obj.version,
            'a'.repeat(64),
          ]);
          await db.exec('reset role');
          const updated = await save(
            users.patient,
            'patient',
            patient,
            { name: 'Fictional' },
            'replace',
            a.id,
          );
          assert.equal(updated.rows[0].p.avatarId, a.id);
          const own = await asUser(db, users.patient, () =>
            db.query('select * from storage.objects'),
          );
          assert.equal(own.rows.length, 1);
          const unrelated = await asUser(db, users.otherPatient, () =>
            db.query('select * from storage.objects'),
          );
          assert.equal(unrelated.rows.length, 0);
          const stranger = await asUser(db, users.otherDoctor, () =>
            db.query('select * from storage.objects'),
          );
          assert.equal(stranger.rows.length, 0);
          const assigned = await asUser(db, users.doctor, () =>
            db.query('select * from storage.objects'),
          );
          assert.equal(assigned.rows.length, 1);
          const overwritten = await asUser(db, users.patient, () =>
            db.exec("update storage.objects set version='changed'"),
          );
          assert.equal(overwritten[0].affectedRows, 0);
          await denied(
            asUser(db, users.patient, () =>
              db.query('select public.discard_profile_avatar($1)', [a.id]),
            ),
          );
          await save(users.patient, 'patient', patient, { name: 'Fictional' }, 'remove');
          assert.equal(
            (await asUser(db, users.otherDoctor, () => db.query('select * from storage.objects')))
              .rows.length,
            0,
          );
          await asUser(db, users.patient, () =>
            db.query('delete from storage.objects where name=$1', [a.objectKey]),
          );
          assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
        }),
    );
    await t.test('revocation during an upload denies registration', () =>
      isolated(async () => {
        const a = await begin(users.doctor);
        await db.exec('update public.patient_assignments set active=false');
        await denied(
          save(users.doctor, 'patient', patient, { name: 'Fictional' }, 'replace', a.id),
        );
      }),
    );
    await t.test('MFA, disabled memberships and branch revocation cannot be bypassed', () =>
      isolated(async () => {
        await db.query("insert into auth.mfa_factors(user_id,status) values($1,'verified')", [
          users.doctor,
        ]);
        await denied(save(users.doctor));
        await db.exec('delete from auth.mfa_factors');
        await db.query('update public.branch_memberships set active=false where user_id=$1', [
          users.doctor,
        ]);
        await denied(save(users.doctor));
        await db.query('update public.organization_memberships set active=false where user_id=$1', [
          users.patient,
        ]);
        await denied(save());
      }),
    );
    await t.test('Storage guards deny forged paths, owners and future broad policies', () =>
      isolated(async () => {
        const a = await begin();
        await db.exec(
          `create policy future_broad on storage.objects for all to authenticated using(true) with check(true);create policy future_anon on storage.objects for select to anon using(true);`,
        );
        await denied(
          asUser(db, users.otherPatient, () =>
            db.query(
              `insert into storage.objects(bucket_id,name,owner_id) values('clinic-profile-avatars',$1,$2)`,
              [a.objectKey, users.otherPatient],
            ),
          ),
        );
        await denied(
          asUser(db, users.patient, () =>
            db.query(
              `insert into storage.objects(bucket_id,name,owner_id) values('clinic-profile-avatars',$1,$2)`,
              [randomUUID() + '.webp', users.patient],
            ),
          ),
        );
        await denied(
          asUser(db, users.patient, () =>
            db.query(
              `insert into storage.objects(bucket_id,name,owner_id) values('clinic-profile-avatars',$1,$2)`,
              [a.objectKey, users.adminA],
            ),
          ),
        );
        await asUser(db, users.patient, () =>
          db.query(
            `insert into storage.objects(bucket_id,name,owner_id,metadata) values('clinic-profile-avatars',$1,$2,'{"size":100,"mimetype":"image/webp"}')`,
            [a.objectKey, users.patient],
          ),
        );
        assert.equal(
          (await asUser(db, users.otherPatient, () => db.query('select * from storage.objects')))
            .rows.length,
          0,
        );
        assert.equal(
          (await asUser(db, null, () => db.query('select * from storage.objects'), 'anon')).rows
            .length,
          0,
        );
        const updated = await asUser(db, users.patient, () =>
          db.exec(`update storage.objects set version='forbidden'`),
        );
        assert.equal(updated[0].affectedRows, 0);
      }),
    );
    await t.test('service-only attestor cannot execute ordinary profile updates', async () => {
      const grants = await db.query<{ role: string; allowed: boolean }>(
        `select role,has_function_privilege(role,'public.save_clinic_profile(uuid,text,uuid,jsonb,text,uuid)','execute') allowed from (values('anon'),('authenticated'),('service_role')) r(role)`,
      );
      assert.deepEqual(grants.rows, [
        { role: 'anon', allowed: false },
        { role: 'authenticated', allowed: true },
        { role: 'service_role', allowed: false },
      ]);
    });
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
