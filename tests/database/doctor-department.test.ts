import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, id, users, asUser } from './harness';
const org = '88645fbe-34da-48aa-a509-c24441b7cf72',
  patient = '398cf267-bc60-41a4-91e6-478dcd86a069';
test('Admin Doctor department profile transaction', async (t) => {
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

    await db.exec(
      await readFile(
        'supabase/proposals/doctor-profile/20261027164031_clinic_doctor_verified_email.sql',
        'utf8',
      ),
    );
    const baseline = (
      await db.query(
        "select proname,md5(prosrc) source_md5 from pg_proc where oid in ('clinic_private.read_profile(uuid,text,uuid)'::regprocedure,'clinic_private.save_profile(uuid,text,uuid,jsonb,text,uuid)'::regprocedure)",
      )
    ).rows;
    assert.deepEqual(
      baseline.map((r: any) => r.source_md5).sort(),
      ['f88468133a59962273b6fa2f703ed9ad', 'a1eb012d5093c6465b2861077dae01ba'].sort(),
    );
    const securityBefore = (
      await db.query(
        "select n.nspname,p.proname,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') order by p.oid",
      )
    ).rows;
    const policiesBefore = (
      await db.query('select * from pg_policies order by schemaname,tablename,policyname')
    ).rows;
    await db.exec(
      await readFile(
        'supabase/proposals/doctor-department/20261103053030_clinic_doctor_department_profile.sql',
        'utf8',
      ),
    );
    await db.query('insert into public.specializations(id,organization_id,name) values($1,$2,$3)', [
      id(7, 3),
      org,
      'Fictional Alternate Department',
    ]);
    assert.deepEqual(
      (
        await db.query(
          "select n.nspname,p.proname,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') order by p.oid",
        )
      ).rows,
      securityBefore,
    );
    assert.deepEqual(
      (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
      policiesBefore,
    );
    await db.exec(
      await readFile(
        'supabase/proposals/public-discovery/20261102180441_clinic_public_discovery.sql',
        'utf8',
      ),
    );
    for (const [column, entity] of [
      ['branch_id', id(2, 1)],
      ['branch_id', id(2, 2)],
      ['doctor_id', id(4, 1)],
      ['department_id', id(7, 1)],
      ['department_id', id(7, 3)],
    ])
      await db.query(
        'insert into clinic_discovery.publications(organization_id,' +
          column +
          ',published) values($1,$2,true)',
        [org, entity],
      );
    await db.exec('begin');
    const read = (caller: string | null, doctor = id(4, 1), role = 'authenticated') =>
      asUser(
        db,
        caller,
        async () =>
          (
            await db.query<{ p: Record<string, unknown> }>(
              'select public.get_clinic_profile($1,$2,$3) p',
              [org, 'doctor', doctor],
            )
          ).rows[0].p,
        role,
      );
    const save = (
      caller: string | null,
      department: unknown = id(7, 3),
      doctor = id(4, 1),
      role = 'authenticated',
      fields: Record<string, unknown> = {},
    ) =>
      asUser(
        db,
        caller,
        () =>
          db.query<{ p: Record<string, unknown> }>(
            'select public.save_clinic_profile($1,$2,$3,$4,$5,$6) p',
            [
              org,
              'doctor',
              doctor,
              JSON.stringify({
                name: 'Fictional Updated Doctor',
                specializationId: department,
                ...fields,
              }),
              'keep',
              null,
            ],
          ),
        role,
      );
    const isolated = async (run: () => Promise<void>) => {
      await db.exec('savepoint case_scope');
      try {
        await run();
      } finally {
        await db.exec('rollback to case_scope;release case_scope');
      }
    };
    const deny = (p: Promise<unknown>, codes = ['42501']) =>
      assert.rejects(p, (e: unknown) => codes.includes((e as { code: string }).code));
    await t.test('current department preselection and per-role editing capability', async () => {
      assert.equal((await read(users.adminAll)).specializationId, id(7, 1));
      assert.equal((await read(users.adminAll)).canEditDepartment, true);
      for (const user of [users.doctor, users.patient, users.adminA])
        assert.equal((await read(user)).canEditDepartment, false);
    });
    await t.test(
      'all-branch Admin updates department atomically, returns fresh value and audits each branch',
      () =>
        isolated(async () => {
          const before = (await db.query('select * from public.doctors where id=$1', [id(4, 1)]))
            .rows[0];
          const result = await save(users.adminAll);
          assert.equal(result.rows[0].p.specializationId, id(7, 3));
          assert.equal((await read(users.adminAll)).specializationId, id(7, 3));
          assert.equal((await read(users.doctor)).specializationId, id(7, 3));
          const after = (await db.query('select * from public.doctors where id=$1', [id(4, 1)]))
            .rows[0];
          for (const key of Object.keys(before))
            if (!['name', 'initials', 'specialization_id'].includes(key))
              assert.deepEqual(after[key], before[key], key);
          assert.equal(
            (
              await db.query(
                "select * from public.audit_logs where action='doctor.department.updated'",
              )
            ).rows.length,
            2,
          );
        }),
    );
    await t.test('branch Admin may update a Doctor assigned solely to their branch', () =>
      isolated(async () => {
        assert.equal((await read(users.adminA, id(4, 2))).canEditDepartment, true);
        assert.equal(
          (await save(users.adminA, id(7, 3), id(4, 2))).rows[0].p.specializationId,
          id(7, 3),
        );
      }),
    );
    await t.test(
      'dual-role Doctor/Admin cannot use self-edit to bypass all-branch Admin authority',
      () =>
        isolated(async () => {
          await db.query(
            "insert into public.role_assignments(organization_id,user_id,role) values($1,$2,'admin')",
            [org, users.doctor],
          );
          await db.query(
            'update public.branch_memberships set active=false where organization_id=$1 and user_id=$2 and branch_id=$3',
            [org, users.doctor, id(2, 2)],
          );
          assert.equal((await read(users.doctor)).canEdit, true);
          assert.equal((await read(users.doctor)).canEditDepartment, false);
          await deny(save(users.doctor));
        }),
    );
    await t.test('Doctor self cannot change department, even to the current value', async () => {
      await deny(save(users.doctor));
      await deny(save(users.doctor, id(7, 1)));
    });
    await t.test('Patient, clinical staff, anonymous and unrelated users denied', async () => {
      for (const user of [
        users.patient,
        users.staff,
        users.otherDoctor,
        users.outsider,
        users.otherOrgAdmin,
      ])
        await deny(save(user));
      await deny(save(null, id(7, 3), id(4, 1), 'anon'));
    });
    await t.test('partial branch Admin and unauthorized branch Doctor targets denied', async () => {
      await deny(save(users.adminA));
      await deny(save(users.adminA, id(7, 3), id(4, 3)));
    });
    await t.test(
      'invalid, missing, null and foreign-organization department IDs denied',
      async () => {
        for (const value of ['invalid', id(7, 999), null, '', id(7, 2), 12])
          await deny(save(users.adminAll, value), ['22023', '22P02']);
      },
    );
    await t.test('department rejected on non-Doctor profile saves', async () => {
      await deny(
        asUser(db, users.adminAll, () =>
          db.query('select public.save_clinic_profile($1,$2,$3,$4,$5,$6)', [
            org,
            'patient',
            patient,
            JSON.stringify({ name: 'Fictional Patient', specializationId: id(7, 3) }),
            'keep',
            null,
          ]),
        ),
        ['23514'],
      );
    });
    await t.test('validation failure rolls back department, other fields and audit', async () => {
      const before = (await db.query('select * from public.doctors order by id')).rows;
      const audits = (await db.query('select * from public.audit_logs order by id')).rows;
      await deny(save(users.adminAll, id(7, 3), id(4, 1), 'authenticated', { experience: 100 }), [
        '23514',
      ]);
      assert.deepEqual((await db.query('select * from public.doctors order by id')).rows, before);
      assert.deepEqual(
        (await db.query('select * from public.audit_logs order by id')).rows,
        audits,
      );
    });
    await t.test('unchanged department creates no department-change event', () =>
      isolated(async () => {
        await save(users.adminAll, id(7, 1));
        assert.equal(
          (
            await db.query(
              "select * from public.audit_logs where action='doctor.department.updated'",
            )
          ).rows.length,
          0,
        );
      }),
    );
    await t.test('Doctor ordinary profile editing remains available without department field', () =>
      isolated(async () => {
        await asUser(db, users.doctor, () =>
          db.query('select public.save_clinic_profile($1,$2,$3,$4,$5,$6)', [
            org,
            'doctor',
            id(4, 1),
            JSON.stringify({ name: 'Fictional Self Edited', bio: 'Updated biography' }),
            'keep',
            null,
          ]),
        );
        assert.equal((await read(users.doctor)).specializationId, id(7, 1));
      }),
    );
    await t.test('revoked Admin branch authority denied', () =>
      isolated(async () => {
        await db.query(
          'update public.branch_memberships set active=false where user_id=$1 and branch_id=$2',
          [users.adminAll, id(2, 2)],
        );
        await deny(save(users.adminAll));
      }),
    );
    await t.test('RLS, grants, Auth identities and clinical relationships unchanged', () =>
      isolated(async () => {
        const tables = [
          'patients',
          'appointments',
          'clinical_encounters',
          'prescriptions',
          'doctor_invitations',
          'doctor_branch_assignments',
        ];
        const before = await Promise.all(
          tables.map((table) => db.query('select * from public.' + table + ' order by 1')),
        );
        const auth = (await db.query('select * from auth.users order by id')).rows;
        await save(users.adminAll);
        for (let i = 0; i < tables.length; i++)
          assert.deepEqual(
            (await db.query('select * from public.' + tables[i] + ' order by 1')).rows,
            before[i].rows,
            tables[i],
          );
        assert.deepEqual((await db.query('select * from auth.users order by id')).rows, auth);
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              "select not has_table_privilege('authenticated','public.doctors','UPDATE') and not has_function_privilege('anon','public.save_clinic_profile(uuid,text,uuid,jsonb,text,uuid)','EXECUTE') as ok",
            )
          ).rows[0].ok,
          true,
        );
      }),
    );
    await t.test(
      'public Discovery joins the updated approved department and retains branch links',
      () =>
        isolated(async () => {
          const feed = async () =>
            asUser(
              db,
              null,
              async () =>
                (
                  await db.query<{
                    feed: {
                      doctors: { id: string; specialization: string; branchIds: string[] }[];
                      departments: { id: string; doctorIds: string[] }[];
                    };
                  }>('select public.get_public_discovery($1) feed', [org])
                ).rows[0].feed,
              'anon',
            );
          const before = await feed();
          const original = before.doctors.find((d) => d.id === id(4, 1))!;
          await save(users.adminAll);
          const after = await feed();
          assert.equal(
            after.doctors.find((d) => d.id === id(4, 1))?.specialization,
            'Fictional Alternate Department',
          );
          assert.deepEqual(
            after.doctors.find((d) => d.id === id(4, 1))?.branchIds,
            original.branchIds,
          );
          assert.ok(after.departments.find((d) => d.id === id(7, 3))?.doctorIds.includes(id(4, 1)));
          assert.ok(
            !after.departments.find((d) => d.id === id(7, 1))?.doctorIds.includes(id(4, 1)),
          );
          await db.query(
            'update clinic_discovery.publications set published=false where department_id=$1',
            [id(7, 3)],
          );
          assert.ok(!(await feed()).doctors.some((d) => d.id === id(4, 1)));
        }),
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
