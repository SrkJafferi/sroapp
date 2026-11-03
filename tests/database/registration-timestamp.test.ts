import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, id, users, asUser, transition, notes } from './harness';
import { projectClinicalRows } from '../../apps/web/lib/clinical-projector';
import { clinicalTables, type ClinicalRows } from '../../apps/web/lib/clinical-contracts';
const org = '88645fbe-34da-48aa-a509-c24441b7cf72',
  patient = '398cf267-bc60-41a4-91e6-478dcd86a069',
  branch = id(2, 1);
test('immutable registration timestamps, genuine backfill and authorized projection', async (t) => {
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
      `update auth.users set email=id::text||'@example.test',email_confirmed_at=now();insert into clinic_private.auth_setup(organization_id,registration_branch_id,bootstrap_user_id) values('${org}','${branch}','${users.adminA}');`,
    );
    for (const f of [
      'patient-ids/20261026195847_clinic_patient_numbers.sql',
      'patient-age/20261026224947_clinic_patient_age.sql',
      'walk-in/20261027093051_clinic_walk_in_registration.sql',
      'staff-booking/20261027105809_clinic_staff_booking_profiles.sql',
    ])
      await db.exec(await readFile(`supabase/proposals/${f}`, 'utf8'));
    await db.exec('begin');
    const fields = {
      name: 'Fictional Registration Patient',
      ageYears: 25,
      gender: 'Other',
      email: '',
      phone: '',
      address: '',
      bloodGroup: '',
    };
    const register = (
      user = users.doctor,
      extra: Record<string, unknown> = {},
      requestId = crypto.randomUUID(),
    ) =>
      asUser(
        db,
        user,
        async () =>
          (
            await db.query<{ p: { id: string } }>(
              'select public.register_walk_in_patient($1,$2,$3) p',
              [branch, requestId, JSON.stringify({ ...fields, ...extra })],
            )
          ).rows[0].p.id,
      );
    const walk = await register(),
      fallback = id(5, 8),
      unknown = id(5, 9);
    await db.query(
      "insert into public.audit_logs(organization_id,action,entity_type,entity_id,occurred_at) values($1,'patient.walk_in_registered','patients',$2,'2020-02-02T10:08:00Z')",
      [org, walk],
    );
    await db.query(
      "update clinic_private.patient_intakes set created_at='2020-02-02T10:09:00Z' where patient_id=$1",
      [walk],
    );
    await db.query(
      "insert into public.patients(id,organization_id,home_branch_id,name,date_of_birth,gender) values($1,$2,$3,'Fictional Intake-only History','1990-01-01','Other')",
      [fallback, org, branch],
    );
    await db.query(
      'insert into public.patient_branches(organization_id,patient_id,branch_id) values($1,$2,$3)',
      [org, fallback, branch],
    );
    await db.query(
      "insert into clinic_private.patient_intakes(organization_id,patient_id,branch_id,created_by,request_id,fields_hash,created_at) values($1,$2,$3,$4,$5,sha256(convert_to('fictional legacy intake','UTF8')),'2020-03-03T12:34:00Z')",
      [org, fallback, branch, users.adminA, crypto.randomUUID()],
    );
    await db.query(
      "insert into public.patients(id,organization_id,home_branch_id,name,date_of_birth,gender) values($1,$2,$3,'Fictional Unknown Registration','1990-01-01','Other')",
      [unknown, org, branch],
    );
    await db.query(
      'insert into public.patient_branches(organization_id,patient_id,branch_id) values($1,$2,$3)',
      [org, unknown, branch],
    );
    await db.query(
      "insert into public.audit_logs(organization_id,action,entity_type,entity_id,occurred_at) values($1,'auth.demo_patient_profile_saved','patients',$2,'2020-01-01T18:45:00Z'),($1,'auth.demo_patient_profile_saved','patients',$2,'2021-01-01T18:45:00Z'),($1,'patient.history.reviewed','patients',$2,'2010-01-01'),($1,'profile.updated.keep','patients',$3,'2010-01-01'),($1,'auth.demo_patient_profile_saved','doctors',$2,'2010-01-01')",
      [org, patient, unknown],
    );
    await db.query(
      "insert into public.audit_logs(organization_id,action,entity_type,entity_id,occurred_at) values($1,'auth.demo_patient_profile_saved','patients',$2,'2001-01-01')",
      [id(1, 2), patient],
    );
    await db.query(
      "insert into public.audit_logs(organization_id,action,entity_type,entity_id,occurred_at) values($1,'patient.walk_in_registered','patients',$2,clock_timestamp()+interval '1 year'),($1,'patient.walk_in_registered','patients',$2,'infinity')",
      [org, unknown],
    );
    const before = (await db.query('select to_jsonb(p) p from public.patients p order by id')).rows;
    const policies = (
      await db.query('select * from pg_policies order by schemaname,tablename,policyname')
    ).rows;
    // Candidate has its own transaction boundary; fixture setup commits only to this isolated WASM DB.
    await db.exec('commit');
    await db.exec(
      await readFile(
        'supabase/proposals/patient-registration/20261027155325_clinic_patient_registration_timestamp.sql',
        'utf8',
      ),
    );
    await db.exec(
      await readFile('scripts/patient-registration-post-deployment-checks.sql', 'utf8'),
    );
    await db.exec('begin');
    const isolated = async (fn: () => Promise<void>) => {
      await db.exec('savepoint test_case');
      try {
        await fn();
      } finally {
        await db.exec('rollback to savepoint test_case;release savepoint test_case');
      }
    };
    const attempt = async (fn: () => Promise<unknown>) => {
      await db.exec('savepoint attempt');
      try {
        return await fn();
      } catch (e) {
        await db.exec('rollback to savepoint attempt');
        throw e;
      } finally {
        await db.exec('release savepoint attempt');
      }
    };
    const denied = (p: Promise<unknown>, code = '42501') =>
      assert.rejects(p, (e: unknown) => (e as { code: string }).code === code);
    const stamp = async (pid = patient) =>
      (
        await db.query<{ stamp: string | null }>(
          'select registered_at::text stamp from public.patients where id=$1',
          [pid],
        )
      ).rows[0].stamp;
    const readRows = (u: string) =>
      asUser(db, u, async () => {
        const rows = {} as ClinicalRows;
        for (const table of clinicalTables)
          (rows[table] as unknown[]) = (
            await db.query<{ row: unknown }>(`select to_jsonb(t) row from public.${table} t`)
          ).rows.map((r) => r.row);
        return rows;
      });
    const save = (u = users.adminA, pid = patient) =>
      asUser(db, u, () =>
        db.query('select public.save_clinic_profile($1,$2,$3,$4,$5,$6)', [
          org,
          'patient',
          pid,
          JSON.stringify({ name: 'Fictional Updated Name', ageYears: 40, bloodGroup: 'B+' }),
          'keep',
          null,
        ]),
      );
    const book = () =>
      asUser(
        db,
        users.patient,
        async () =>
          (
            await db.query<{ id: string }>('select public.book_appointment($1,$2,$3) id', [
              id(6, 1),
              patient,
              'Fictional registration regression',
            ])
          ).rows[0].id,
      );
    const portal = async (data: Record<string, unknown>) =>
      attempt(async () => {
        await db.exec('set role service_role');
        try {
          return await db.query<{ id: string }>('select public.phase2b_patient($1,$2) id', [
            users.otherPatient,
            JSON.stringify({ ...fields, ...data }),
          ]);
        } finally {
          await db.exec('reset role');
        }
      });
    await t.test(
      'backfill uses earliest matching registration event, not other entities or tenants',
      async () => {
        assert.equal(new Date((await stamp())!).toISOString(), '2020-01-01T18:45:00.000Z');
        assert.equal(new Date((await stamp(walk))!).toISOString(), '2020-02-02T10:08:00.000Z');
      },
    );
    await t.test(
      'genuine intake creation is a fallback; unknown historical dates remain NULL',
      async () => {
        assert.equal(new Date((await stamp(fallback))!).toISOString(), '2020-03-03T12:34:00.000Z');
        assert.equal(await stamp(unknown), null);
      },
    );
    await t.test(
      'all existing patient fields and identifiers, grants and RLS remain unchanged',
      async () => {
        assert.deepEqual(
          (
            await db.query(
              "select to_jsonb(p)-'registered_at' p from public.patients p order by id",
            )
          ).rows,
          before,
        );
        assert.deepEqual(
          (await db.query('select * from pg_policies order by schemaname,tablename,policyname'))
            .rows,
          policies,
        );
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_table_privilege('authenticated','public.patients','INSERT') allowed",
            )
          ).rows[0].allowed,
          false,
        );
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege('authenticated','clinic_private.patient_registration_guard()','EXECUTE') allowed",
            )
          ).rows[0].allowed,
          false,
        );
      },
    );
    await t.test(
      'Admin and assigned Doctor projections return the identical canonical timestamp with no Doctor audit logs',
      () =>
        isolated(async () => {
          const a = await book();
          await transition(db, a, 'confirmed');
          const adminRows = await readRows(users.adminA),
            doctorRows = await readRows(users.doctor);
          assert.deepEqual(doctorRows.audit_logs, []);
          const admin = projectClinicalRows(adminRows, users.adminA, 'admin', org, [branch]),
            doctor = projectClinicalRows(doctorRows, users.doctor, 'doctor', org, [
              branch,
              id(2, 2),
            ]);
          for (const pid of [patient, walk])
            assert.equal(
              doctor.state.patients.find((p) => p.id === pid)?.registeredAt,
              admin.state.patients.find((p) => p.id === pid)?.registeredAt,
            );
          assert.ok(doctor.state.patients.find((p) => p.id === patient)?.registeredAt);
          // Repeated role-scoped reads do not depend on cached Admin data.
          assert.equal(
            projectClinicalRows(await readRows(users.doctor), users.doctor, 'doctor', org, [
              branch,
            ]).state.patients.find((p) => p.id === patient)?.registeredAt,
            doctor.state.patients.find((p) => p.id === patient)?.registeredAt,
          );
        }),
    );
    await t.test(
      'Patient reads own timestamp, not other patients; unassigned/cross-branch/cross-tenant Doctors denied',
      () =>
        isolated(async () => {
          assert.ok(
            (
              await asUser(db, users.patient, () =>
                db.query('select registered_at from public.patients where id=$1', [patient]),
              )
            ).rows[0],
          );
          for (const u of [
            users.patient,
            users.otherDoctor,
            users.branchBDoctor,
            users.otherOrgDoctor,
          ])
            assert.equal(
              (
                await asUser(db, u, () =>
                  db.query('select registered_at from public.patients where id=$1', [walk]),
                )
              ).rows.length,
              0,
            );
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query('select registered_at from public.patients where id=$1', [patient]),
              )
            ).rows.length,
            0,
          );
          await denied(
            asUser(
              db,
              null,
              () => db.query('select registered_at from public.patients where id=$1', [patient]),
              'anon',
            ),
          );
        }),
    );
    await t.test('expired intake and revoked assignment remove timestamp visibility', () =>
      isolated(async () => {
        await db.query(
          "update clinic_private.patient_intakes set expires_at=now()-interval '1 second' where patient_id=$1",
          [walk],
        );
        assert.equal(
          (
            await asUser(db, users.doctor, () =>
              db.query('select registered_at from public.patients where id=$1', [walk]),
            )
          ).rows.length,
          0,
        );
        const a = await book();
        await transition(db, a, 'confirmed');
        await db.query(
          'update public.patient_assignments set active=false where appointment_id=$1',
          [a],
        );
        assert.equal(
          (
            await asUser(db, users.doctor, () =>
              db.query('select registered_at from public.patients where id=$1', [patient]),
            )
          ).rows.length,
          0,
        );
      }),
    );
    await t.test('new Doctor/Admin walk-ins get actual database timestamps automatically', () =>
      isolated(async () => {
        const start = (await db.query<{ t: string }>('select clock_timestamp()::text t')).rows[0].t;
        for (const u of [users.adminA, users.doctor]) {
          const pid = await register(u);
          assert.ok(new Date((await stamp(pid))!).getTime() >= new Date(start).getTime());
        }
      }),
    );
    await t.test(
      'normal verified online registration records a timestamp and repeated provisioning preserves it',
      () =>
        isolated(async () => {
          const created = await portal({ name: 'Fictional Verified Online Patient' });
          const pid = (created as { rows: { id: string }[] }).rows[0].id;
          const first = await stamp(pid);
          assert.ok(first);
          await portal({
            name: 'Fictional Verified Online Patient Updated',
            registered_at: '1999-01-01',
          });
          assert.equal(await stamp(pid), first);
        }),
    );
    await t.test(
      'profile/age/blood-group edits and medical history updates cannot change registration time',
      () =>
        isolated(async () => {
          const first = await stamp();
          await save();
          const a = await book();
          await transition(db, a, 'confirmed');
          await asUser(db, users.doctor, () =>
            db.query('select public.save_patient_history($1,$2,$3)', [
              patient,
              branch,
              JSON.stringify({
                allergies: [],
                conditions: [],
                medications: [],
                surgeries: '',
                familyHistory: '',
                socialHistory: '',
                bloodGroup: 'A+',
                emergencyContact: '',
              }),
            ]),
          );
          assert.equal(await stamp(), first);
        }),
    );
    await t.test(
      'booking, approval and signed encounter writes preserve the original timestamp',
      () =>
        isolated(async () => {
          const first = await stamp();
          const a = await book();
          await transition(db, a, 'confirmed');
          await transition(db, a, 'in_consultation', users.doctor);
          await asUser(db, users.doctor, () =>
            db.query('select public.save_encounter($1,$2,$3,true)', [
              a,
              JSON.stringify(notes),
              '[]',
            ]),
          );
          assert.equal(await stamp(), first);
        }),
    );
    await t.test('explicit INSERT timestamp is rejected and allocator rolls back with it', () =>
      isolated(async () => {
        const n = (await db.query('select last_number from clinic_private.patient_number_counter'))
          .rows;
        await denied(
          attempt(() =>
            db.query(
              "insert into public.patients(organization_id,home_branch_id,name,date_of_birth,gender,registered_at) values($1,$2,'Fictional Forged Time','1990-01-01','Other','1999-01-01')",
              [org, branch],
            ),
          ),
        );
        assert.deepEqual(
          (await db.query('select last_number from clinic_private.patient_number_counter')).rows,
          n,
        );
      }),
    );
    await t.test(
      'even owner updates cannot overwrite, clear or fill historical NULL timestamps',
      () =>
        isolated(async () => {
          for (const [pid, value] of [
            [patient, '1999-01-01'],
            [patient, null],
            [unknown, '1999-01-01'],
          ])
            await denied(
              attempt(() =>
                db.query('update public.patients set registered_at=$1 where id=$2', [value, pid]),
              ),
            );
          assert.equal(await stamp(unknown), null);
        }),
    );
    await t.test(
      'existing-id upsert preserves unknown NULL instead of inventing a registration time',
      () =>
        isolated(async () => {
          await db.query(
            "insert into public.patients(id,organization_id,home_branch_id,name,date_of_birth,gender) values($1,$2,$3,'Fictional Unknown Updated','1990-01-01','Other') on conflict(id) do update set name=excluded.name,registered_at=excluded.registered_at",
            [unknown, org, branch],
          );
          assert.equal(await stamp(unknown), null);
        }),
    );
    await t.test(
      'client registration payloads cannot assign timestamps and direct authenticated writes remain denied',
      () =>
        isolated(async () => {
          await denied(register(users.doctor, { registered_at: '1999-01-01' }), '22023');
          for (const u of [users.adminA, users.doctor, users.patient])
            await denied(
              asUser(db, u, () =>
                db.query("update public.patients set registered_at='1999-01-01' where id=$1", [
                  patient,
                ]),
              ),
            );
        }),
    );
    await t.test('walk-in retries retain the same timestamp and patient identifier', () =>
      isolated(async () => {
        const requestId = crypto.randomUUID();
        const pid = await register(users.doctor, {}, requestId),
          first = await stamp(pid);
        assert.equal(await register(users.doctor, {}, requestId), pid);
        assert.equal(await stamp(pid), first);
      }),
    );
    await t.test(
      'canonical historical NULL never falls back to later audit evidence in the UI',
      () =>
        isolated(async () => {
          await db.query(
            "insert into public.audit_logs(organization_id,action,entity_type,entity_id) values($1,'auth.demo_patient_profile_saved','patients',$2)",
            [org, unknown],
          );
          const result = projectClinicalRows(
            await readRows(users.adminA),
            users.adminA,
            'admin',
            org,
            [branch],
          );
          assert.equal(
            result.state.patients.find((p) => p.id === unknown)?.registeredAt,
            undefined,
          );
        }),
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
