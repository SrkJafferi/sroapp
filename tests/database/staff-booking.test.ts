import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, id, users, asUser, transition, notes } from './harness';
const org = '88645fbe-34da-48aa-a509-c24441b7cf72',
  patient = '398cf267-bc60-41a4-91e6-478dcd86a069',
  branch = id(2, 1);
test('staff profile blood group and transactional booking confirmation', async (t) => {
  const db = await createDatabase(false, (db) =>
    db.exec(`
    alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;
    create table auth.mfa_factors(user_id uuid,status text);
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon,service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on storage.objects to anon;`),
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
    ])
      await db.exec(await readFile(`supabase/proposals/${f}`, 'utf8'));
    const permissions = () =>
      db.query(
        `select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') order by n.nspname,p.proname,p.oid`,
      );
    const policies = () =>
      db.query(
        'select schemaname,tablename,policyname,qual,with_check from pg_policies order by schemaname,tablename,policyname',
      );
    const priorPermissions = (await permissions()).rows,
      priorPolicies = (await policies()).rows;
    await db.exec(
      await readFile(
        'supabase/proposals/staff-booking/20261027105809_clinic_staff_booking_profiles.sql',
        'utf8',
      ),
    );
    await db.exec(await readFile('scripts/staff-booking-post-deployment-checks.sql', 'utf8'));
    await db.exec('begin');
    const isolated = async (fn: () => Promise<void>) => {
      await db.exec('savepoint case_scope');
      try {
        await fn();
      } finally {
        await db.exec('rollback to savepoint case_scope;release savepoint case_scope');
      }
    };
    const denied = (p: Promise<unknown>, code = '42501') =>
      assert.rejects(p, (e: unknown) => (e as { code: string }).code === code);
    const book = (user = users.patient, slot = 1, pid = patient, source = 'patient') =>
      asUser(
        db,
        user,
        async () =>
          (
            await db.query<{ id: string }>('select public.book_appointment($1,$2,$3,$4,$5) id', [
              id(6, slot),
              pid,
              'Fictional routine visit',
              'physical',
              source,
            ])
          ).rows[0].id,
      );
    const status = async (aid: string) =>
      (
        await db.query<{ status: string }>('select status from public.appointments where id=$1', [
          aid,
        ])
      ).rows[0].status;
    const save = (
      u = users.adminA,
      fields: Record<string, unknown> = { bloodGroup: 'B+' },
      pid = patient,
      o = org,
    ) =>
      asUser(db, u, () =>
        db.query<{ p: Record<string, unknown> }>(
          'select public.save_clinic_profile($1,$2,$3,$4,$5,$6) p',
          [o, 'patient', pid, JSON.stringify({ name: 'Amina Noor', ...fields }), 'keep', null],
        ),
      );
    const register = (u = users.doctor) =>
      asUser(
        db,
        u,
        async () =>
          (
            await db.query<{ p: { id: string } }>(
              'select public.register_walk_in_patient($1,$2,$3) p',
              [
                branch,
                crypto.randomUUID(),
                JSON.stringify({
                  name: 'Fictional Clinic Patient',
                  ageYears: 25,
                  gender: 'Female',
                  bloodGroup: 'A+',
                }),
              ],
            )
          ).rows[0].p.id,
      );
    await t.test(
      'migration preserves all function privileges, definer/search-path flags and RLS policies',
      async () => {
        assert.deepEqual((await permissions()).rows, priorPermissions);
        assert.deepEqual((await policies()).rows, priorPolicies);
      },
    );
    await t.test(
      'patient self-booking stays pending with no clinical assignment, even spoofing staff source',
      () =>
        isolated(async () => {
          const a = await book();
          assert.equal(await status(a), 'pending');
          assert.equal(
            (
              await db.query('select * from public.patient_assignments where appointment_id=$1', [
                a,
              ])
            ).rows.length,
            0,
          );
          await denied(book(users.patient, 2, patient, 'walk_in'));
        }),
    );
    await t.test('Admin booking is immediately confirmed, reserved, assigned and audited', () =>
      isolated(async () => {
        const a = await book(users.adminA, 1, patient, 'walk_in');
        assert.equal(await status(a), 'confirmed');
        assert.equal(
          (
            await db.query(
              'select * from public.patient_assignments where appointment_id=$1 and active',
              [a],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query(
              'select * from public.appointment_reservations where appointment_id=$1 and active',
              [a],
            )
          ).rows.length,
          1,
        );
        assert.deepEqual(
          (
            await db.query(
              'select new_status from public.appointment_status_history where appointment_id=$1 order by created_at,id',
              [a],
            )
          ).rows
            .map((r) => r.new_status)
            .sort(),
          ['confirmed', 'pending'],
        );
        assert.equal(
          (
            await db.query(
              "select * from public.audit_logs where entity_id=$1 and action='appointment.confirmed'",
              [a],
            )
          ).rows.length,
          1,
        );
      }),
    );
    await t.test(
      'assigned Doctor follow-up is confirmed even if browser supplies patient source',
      () =>
        isolated(async () => {
          const existing = await book();
          await transition(db, existing, 'confirmed');
          const a = await book(users.doctor, 2, patient, 'follow_up');
          assert.equal(await status(a), 'confirmed');
          assert.equal(await status(await book(users.doctor, 3, patient, 'patient')), 'confirmed');
        }),
    );
    await t.test(
      'Doctor intake appointment confirms through the authorized real-booking path',
      () =>
        isolated(async () => {
          const p = await register();
          const a = await book(users.doctor, 1, p, 'walk_in');
          assert.equal(await status(a), 'confirmed');
          const r = await save(users.doctor, { bloodGroup: 'O-' }, p);
          assert.equal(r.rows[0].p.bloodGroup, 'O-');
        }),
    );
    await t.test(
      'unassigned Doctor, wrong Doctor target, cross-branch and cross-tenant bookings denied',
      () =>
        isolated(async () => {
          await denied(book(users.doctor, 1));
          await denied(book(users.otherDoctor, 1));
          await denied(book(users.adminA, 6));
          await denied(book(users.otherOrgAdmin, 1));
          await denied(book(users.doctor, 8));
        }),
    );
    await t.test('slot collisions still reject a second confirmed booking', () =>
      isolated(async () => {
        await book(users.adminA, 1, patient, 'walk_in');
        await denied(book(users.adminA, 1, patient, 'walk_in'), '23P01');
      }),
    );
    await t.test(
      'confirmation failure rolls back appointment, reservation, charge, assignment and events',
      () =>
        isolated(async () => {
          const tables = [
            'appointments',
            'appointment_reservations',
            'consultation_charges',
            'patient_assignments',
            'notifications',
            'audit_logs',
          ];
          const counts = async () =>
            Promise.all(
              tables.map(
                async (t) => (await db.query(`select count(*) n from public.${t}`)).rows[0],
              ),
            );
          const before = await counts();
          await db.exec(
            "create function clinic_private.test_deny_assignment() returns trigger language plpgsql as $$begin raise exception 'Test confirmation failure' using errcode='23514'; end$$;create trigger test_deny_assignment before insert on public.patient_assignments for each row execute function clinic_private.test_deny_assignment();",
          );
          await denied(book(users.adminA, 1, patient, 'walk_in'), '23514');
          assert.deepEqual(await counts(), before);
        }),
    );
    await t.test(
      'Admin blood-group save preserves all other history, review state, DOB and permanent ID',
      () =>
        isolated(async () => {
          const before = (
            await db.query('select * from public.patient_medical_history where patient_id=$1', [
              patient,
            ])
          ).rows[0];
          const row = (
            await db.query('select date_of_birth,patient_code from public.patients where id=$1', [
              patient,
            ])
          ).rows[0];
          const p = (await save()).rows[0].p;
          assert.equal(p.bloodGroup, 'B+');
          assert.equal(p.canEditBloodGroup, true);
          const after = (
            await db.query('select * from public.patient_medical_history where patient_id=$1', [
              patient,
            ])
          ).rows[0];
          for (const key of [
            'allergies',
            'conditions',
            'medications',
            'surgeries',
            'family_history',
            'social_history',
            'emergency_contact',
            'review_state',
          ])
            assert.deepEqual(after[key], before[key], key);
          assert.deepEqual(
            (
              await db.query('select date_of_birth,patient_code from public.patients where id=$1', [
                patient,
              ])
            ).rows[0],
            row,
          );
          assert.equal(
            (
              await db.query(
                "select * from public.audit_logs where entity_id=$1 and action='patient.blood_group.updated'",
                [patient],
              )
            ).rows.length,
            1,
          );
        }),
    );
    await t.test(
      'authorized Doctor can edit blood group and owning Patient reads the persisted change',
      () =>
        isolated(async () => {
          const a = await book();
          await transition(db, a, 'confirmed');
          await save(users.doctor, { bloodGroup: 'AB-' });
          const p = await asUser(db, users.patient, () =>
            db.query<{ p: Record<string, unknown> }>(
              'select public.get_clinic_profile($1,$2,$3) p',
              [org, 'patient', patient],
            ),
          );
          assert.equal(p.rows[0].p.bloodGroup, 'AB-');
          assert.equal(p.rows[0].p.canEditBloodGroup, false);
        }),
    );
    await t.test(
      'Patient, unrelated Doctor, clinical staff and foreign Admin cannot write blood group',
      () =>
        isolated(async () => {
          for (const u of [
            users.patient,
            users.otherPatient,
            users.doctor,
            users.otherDoctor,
            users.staff,
            users.branchBDoctor,
            users.otherOrgAdmin,
          ])
            await denied(save(u));
          await denied(save(users.adminA, { bloodGroup: 'A+' }, patient, id(1, 2)));
        }),
    );
    await t.test('branch-limited Admin cannot edit a different branch patient blood group', () =>
      isolated(async () => {
        const p = id(5, 3);
        await db.query(
          'insert into public.patients(id,organization_id,home_branch_id,name,date_of_birth,gender) values($1,$2,$3,$4,$5,$6)',
          [p, org, id(2, 2), 'Fictional Branch Patient', '1990-01-01', 'Other'],
        );
        await db.query(
          'insert into public.patient_branches(organization_id,patient_id,branch_id) values($1,$2,$3)',
          [org, p, id(2, 2)],
        );
        await denied(save(users.adminA, { bloodGroup: 'A+' }, p));
        assert.equal(
          (await save(users.adminAll, { bloodGroup: 'AB+' }, p)).rows[0].p.bloodGroup,
          'AB+',
        );
      }),
    );
    await t.test('invalid blood group rejects the entire profile transaction', () =>
      isolated(async () => {
        const before = (await db.query('select * from public.patients where id=$1', [patient]))
          .rows[0];
        for (const bloodGroup of ['invalid', 'A++', null, 12])
          await denied(save(users.adminA, { name: 'Changed Name', bloodGroup }), '23514');
        assert.deepEqual(
          (await db.query('select * from public.patients where id=$1', [patient])).rows[0],
          before,
        );
      }),
    );
    await t.test(
      'clearing a blood group is supported without marking unknown history reviewed',
      () =>
        isolated(async () => {
          const p = await register(users.adminA);
          await save(users.adminA, { bloodGroup: '' }, p);
          const h = (
            await db.query(
              'select blood_group,review_state from public.patient_medical_history where patient_id=$1',
              [p],
            )
          ).rows[0];
          assert.equal(h.blood_group, null);
          assert.equal(h.review_state, 'unknown');
        }),
    );
    await t.test('revoked assignment and disabled branch deny subsequent Doctor updates', () =>
      isolated(async () => {
        const a = await book();
        await transition(db, a, 'confirmed');
        await db.query(
          'update public.patient_assignments set active=false where appointment_id=$1',
          [a],
        );
        await denied(save(users.doctor));
        await db.query('update public.branches set active=false where id=$1', [branch]);
        await denied(save());
        await denied(book(users.adminA), '23514');
      }),
    );
    await t.test('anonymous/service-role and direct writes retain existing restrictions', () =>
      isolated(async () => {
        await denied(
          asUser(
            db,
            null,
            () =>
              db.query('select public.save_clinic_profile($1,$2,$3,$4,$5,$6)', [
                org,
                'patient',
                patient,
                '{"name":"Amina Noor","bloodGroup":"A+"}',
                'keep',
                null,
              ]),
            'anon',
          ),
        );
        await denied(
          asUser(db, users.adminA, () =>
            db.query(
              "update public.patient_medical_history set blood_group='A+' where patient_id=$1",
              [patient],
            ),
          ),
        );
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege('service_role','public.save_clinic_profile(uuid,text,uuid,jsonb,text,uuid)','execute') allowed",
            )
          ).rows[0].allowed,
          false,
        );
      }),
    );
    await t.test('signed encounters and prescriptions remain unchanged after profile edit', () =>
      isolated(async () => {
        const a = await book();
        await transition(db, a, 'confirmed');
        await transition(db, a, 'in_consultation', users.doctor);
        await asUser(db, users.doctor, () =>
          db.query('select public.save_encounter($1,$2,$3,true)', [a, JSON.stringify(notes), '[]']),
        );
        const before = (
          await db.query('select * from public.clinical_encounters where appointment_id=$1', [a])
        ).rows;
        await save();
        assert.deepEqual(
          (await db.query('select * from public.clinical_encounters where appointment_id=$1', [a]))
            .rows,
          before,
        );
        await denied(
          asUser(db, users.doctor, () =>
            db.query('select public.save_encounter($1,$2,$3,true)', [
              a,
              JSON.stringify(notes),
              '[]',
            ]),
          ),
          '23514',
        );
      }),
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
