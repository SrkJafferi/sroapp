import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, id, users, asUser, transition } from './harness';

const org = '88645fbe-34da-48aa-a509-c24441b7cf72',
  patient = '398cf267-bc60-41a4-91e6-478dcd86a069',
  branch = id(2, 1);

const shim = `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon,service_role;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`;

async function ageDatabase() {
  const db = await createDatabase(false, (db) => db.exec(shim));
  try {
    for (const file of [
      'supabase/proposals/phase2b/20261026111934_clinic_auth_onboarding.sql',
      'supabase/proposals/phase2c/20261026123202_clinic_workspace_commands.sql',
      'supabase/proposals/profiles/20261026192535_clinic_profiles_avatars.sql',
    ])
      await db.exec(await readFile(file, 'utf8'));
    let fixture = await readFile('supabase/fixtures/fictional.sql', 'utf8');
    fixture = fixture
      .replaceAll(id(1, 1), org)
      .replaceAll(id(5, 1), patient)
      .replaceAll('Fictional Patient A', 'Amina Noor');
    await db.exec(fixture);
    await db.query('delete from public.medical_documents where patient_id<>$1', [patient]);
    await db.query('delete from public.patient_medical_history where patient_id<>$1', [patient]);
    await db.query('delete from public.patient_branches where patient_id<>$1', [patient]);
    await db.query('delete from public.patients where id<>$1', [patient]);
    await db.query("update public.patients set date_of_birth=date '1994-04-12' where id=$1", [
      patient,
    ]);
    await db.exec(
      `update auth.users set email=id::text||'@example.test',email_confirmed_at=now(),banned_until=null,deleted_at=null;insert into clinic_private.auth_setup(organization_id,registration_branch_id,bootstrap_user_id) values('${org}','${branch}','${users.adminA}');`,
    );
    await db.exec(
      await readFile('supabase/proposals/patient-ids/20261026195847_clinic_patient_numbers.sql', 'utf8'),
    );
    await db.exec(
      await readFile('supabase/proposals/patient-age/20261026224947_clinic_patient_age.sql', 'utf8'),
    );
    for (const file of [
      'supabase/proposals/walk-in/20261027093051_clinic_walk_in_registration.sql',
      'supabase/proposals/staff-booking/20261027105809_clinic_staff_booking_profiles.sql',
    ])
      await db.exec(await readFile(file, 'utf8'));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

const manualAgeMigration =
  'supabase/proposals/patient-age-manual/20261027134307_clinic_manual_patient_age.sql';

test('patient age and blood group additive candidate', async (t) => {
  const db = await ageDatabase();
  try {
    await db.exec(await readFile(manualAgeMigration, 'utf8'));
    await db.exec('begin');
    const appointment = await asUser(db, users.patient, async () => {
      const r = await db.query<{ id: string }>(
        'select public.book_appointment($1,$2,$3) id',
        [id(6, 1), patient, 'Fictional age candidate visit'],
      );
      return r.rows[0].id;
    });
    await transition(db, appointment, 'confirmed');
    const today = (
      await db.query<{ d: string }>('select current_date::text d')
    ).rows[0].d;
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
    const invalid = (run: Promise<unknown>, code = '23514') =>
      assert.rejects(run, (e: unknown) => (e as { code: string }).code === code);
    const attempt = async <T>(run: () => Promise<T>) => {
      await db.exec('savepoint attempt_scope');
      try {
        return await run();
      } catch (e) {
        await db.exec('rollback to savepoint attempt_scope');
        throw e;
      } finally {
        await db.exec('release savepoint attempt_scope');
      }
    };
    const row = async (pid = patient) =>
      (
        await db.query<{
          date_of_birth: string | null;
          age_years: number | null;
          age_recorded_on: string | null;
          patient_code: string;
          blood_group: string | null;
        }>(
          'select date_of_birth::text,age_years,age_recorded_on::text,patient_code,(select blood_group from public.patient_medical_history h where h.patient_id=p.id) blood_group from public.patients p where id=$1',
          [pid],
        )
      ).rows[0];
    const save = (
      user = users.patient,
      data: Record<string, unknown> = { name: 'Amina Noor' },
      target = patient,
      k = 'patient',
      o = org,
    ) =>
      asUser(db, user, () =>
        db.query<{ p: Record<string, unknown> }>(
          'select public.save_clinic_profile($1,$2,$3,$4,$5,$6) p',
          [o, k, target, JSON.stringify(data), 'keep', null],
        ),
      );
    const read = (user = users.patient, target = patient) =>
      asUser(db, user, () =>
        db.query<{ p: Record<string, unknown> }>(
          'select public.get_clinic_profile($1,$2,$3) p',
          [org, 'patient', target],
        ),
      );
    const register = async (user: string, data: Record<string, unknown>) => {
      await db.exec('set role service_role');
      try {
        const result = await attempt(() =>
          db.query<{ id: string }>('select public.phase2b_patient($1,$2) id', [
            user,
            JSON.stringify(data),
          ]),
        );
        return result.rows[0].id;
      } finally {
        await db.exec('reset role');
      }
    };
    const history = {
      allergies: ['Fictional reported allergy'],
      conditions: [],
      medications: [],
      surgeries: '',
      familyHistory: '',
      socialHistory: '',
      bloodGroup: 'O+',
      emergencyContact: '',
    };
    const saveHistory = (user = users.doctor, value = history) =>
      asUser(db, user, () =>
        db.query('select public.save_patient_history($1,$2,$3)', [
          patient,
          branch,
          JSON.stringify(value),
        ]),
      );

    await t.test('reviewed build stores age 32 and preserves the legacy birth date', async () => {
      const r = await row();
      assert.equal(r.date_of_birth, '1994-04-12');
      assert.equal(r.age_years, 32);
      assert.equal(r.age_recorded_on, today);
      const columns = await db.query<{ column_name: string; is_nullable: string }>(
        `select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='patients' and column_name in ('age_years','age_recorded_on','date_of_birth') order by column_name`,
      );
      assert.deepEqual(columns.rows, [
        { column_name: 'age_recorded_on', is_nullable: 'YES' },
        { column_name: 'age_years', is_nullable: 'YES' },
        { column_name: 'date_of_birth', is_nullable: 'YES' },
      ]);
      const constraints = await db.query<{ conname: string }>(
        `select conname from pg_constraint where conrelid='public.patients'::regclass and conname like 'patients_age%' order by conname`,
      );
      assert.deepEqual(
        constraints.rows.map((c) => c.conname),
        [
          'patients_age_known',
          'patients_age_recorded_on_range',
          'patients_age_recorded_pair',
          'patients_age_years_range',
        ],
      );
      const audit = await db.query<{ n: number }>(
        `select count(*)::integer n from public.audit_logs where action='patient.age.backfilled' and entity_id=$1`,
        [patient],
      );
      assert.equal(audit.rows[0].n, 1);
    });

    await t.test('profile returns the stored age without a birth-date fallback', async () => {
      const profile = (await read()).rows[0].p;
      assert.equal(profile.ageYears, 32);
      assert.equal(profile.ageSource, 'recorded');
      assert.equal(profile.ageRecordedOn, today);
      assert.equal('dateOfBirth' in profile, false);
    });

    await t.test('authorized age changes store the stated date and never touch the birth date', () =>
      isolated(async () => {
        for (const value of [35, 0, 120]) {
          const saved = await save(users.patient, { name: 'Amina Noor', ageYears: value });
          assert.equal(saved.rows[0].p.ageYears, value);
          assert.equal(saved.rows[0].p.ageSource, 'recorded');
          assert.equal(saved.rows[0].p.ageRecordedOn, today);
          const stored = await row();
          assert.equal(stored.age_years, value);
          assert.equal(stored.age_recorded_on, today);
          assert.equal(stored.date_of_birth, '1994-04-12');
        }
        await save(users.adminA, { name: 'Amina Noor', ageYears: 36 });
        assert.deepEqual(await row(), {
          date_of_birth: '1994-04-12',
          age_years: 36,
          age_recorded_on: today,
          patient_code: 'SRO0001',
          blood_group: null,
        });
        await save(users.doctor, { name: 'Amina Noor', ageYears: 37 });
        assert.equal((await row()).age_years, 37);
        const audits = await db.query<{ actor_id: string; n: number }>(
          `select actor_id,count(*)::integer n from public.audit_logs where action='patient.age.updated' and entity_id=$1 group by actor_id order by actor_id`,
          [patient],
        );
        assert.deepEqual(audits.rows, [
          { actor_id: users.adminA, n: 1 },
          { actor_id: users.doctor, n: 1 },
          { actor_id: users.patient, n: 3 },
        ]);
        await save(users.doctor, { name: 'Amina Noor', ageYears: 37 });
        assert.equal(
          (
            await db.query<{ n: number }>(
              `select count(*)::integer n from public.audit_logs where action='patient.age.updated' and entity_id=$1`,
              [patient],
            )
          ).rows[0].n,
          5,
        );
      }),
    );

    await t.test('a stored age never advances from its recorded date', () =>
      isolated(async () => {
        const twoYearsAgo = (
          await db.query<{ d: string }>(`select (current_date-interval '2 years')::date::text d`)
        ).rows[0].d;
        await db.query(
          `update public.patients set age_years=30,age_recorded_on=current_date-interval '2 years' where id=$1`,
          [patient],
        );
        const profile = (await read()).rows[0].p;
        assert.equal(profile.ageYears, 30);
        assert.equal(profile.ageSource, 'recorded');
        assert.equal(profile.ageRecordedOn, twoYearsAgo);
        await save(users.patient, { name: 'Amina Noor', ageYears: 33 });
        assert.equal((await read()).rows[0].p.ageYears, 33);
        assert.equal((await row()).date_of_birth, '1994-04-12');
        assert.equal(
          (
            await db.query<{ n: number }>(
              `select count(*)::integer n from public.audit_logs where action='patient.age.updated' and entity_id=$1`,
              [patient],
            )
          ).rows[0].n,
          1,
        );
      }),
    );

    await t.test('invalid ages and birth-date writes are rejected', () =>
      isolated(async () => {
        for (const ageYears of [-1, 121, 1.5, '30', null])
          await invalid(save(users.patient, { name: 'Amina Noor', ageYears }));
        await invalid(save(users.patient, { name: 'Amina Noor', dateOfBirth: '1990-01-01' }));
        await invalid(
          save(users.adminA, { name: 'Amina Noor', dateOfBirth: '1990-01-01' }),
        );
      }),
    );

    await t.test('unassigned Doctor and unrelated Patient cannot change age', async () => {
      await denied(save(users.otherDoctor, { name: 'Amina Noor', ageYears: 50 }));
      await denied(save(users.otherPatient, { name: 'Amina Noor', ageYears: 50 }, patient));
      await denied(
        save(users.patient, { name: 'Amina Noor', ageYears: 50 }, patient, 'patient', id(1, 2)),
      );
    });

    await t.test('age-only registration stores the age without inventing a birth date', () =>
      isolated(async () => {
        const pid = await register(users.otherPatient, {
          name: 'Fictional Age Only',
          phone: '03001234567',
          ageYears: 42,
          gender: 'Other',
          address: 'Fictional address',
        });
        assert.deepEqual(await row(pid), {
          date_of_birth: null,
          age_years: 42,
          age_recorded_on: today,
          patient_code: 'SRO0002',
          blood_group: null,
        });
        const profile = (await read(users.otherPatient, pid)).rows[0].p;
        assert.equal(profile.ageYears, 42);
        assert.equal(profile.ageSource, 'recorded');
        assert.equal(profile.ageRecordedOn, today);
        assert.equal('dateOfBirth' in profile, false);
        const again = await register(users.otherPatient, {
          name: 'Fictional Age Only Updated',
          phone: '03001234567',
          ageYears: 43,
          gender: 'Other',
          address: 'Fictional address',
        });
        assert.equal(again, pid);
        assert.equal((await row(pid)).age_years, 43);
        assert.equal(
          (await db.query<{ n: number }>('select count(*)::integer n from public.patients')).rows[0]
            .n,
          2,
        );
      }),
    );

    await t.test('legacy birth-date registration shows no recorded age until one is entered', () =>
      isolated(async () => {
        const pid = await register(users.otherPatient, {
          name: 'Fictional Legacy Date',
          phone: '03001234567',
          dateOfBirth: '2000-01-01',
          gender: 'Other',
        });
        const stored = await row(pid);
        assert.equal(stored.date_of_birth, '2000-01-01');
        assert.equal(stored.age_years, null);
        assert.equal(stored.age_recorded_on, null);
        const profile = (await read(users.otherPatient, pid)).rows[0].p;
        assert.equal(profile.ageSource, null);
        assert.equal(profile.ageYears, null);
        assert.equal(profile.ageRecordedOn, null);
        assert.equal('dateOfBirth' in profile, false);
        const saved = await save(users.adminA, { name: 'Fictional Legacy Date', ageYears: 25 }, pid);
        assert.equal(saved.rows[0].p.ageYears, 25);
        assert.equal(saved.rows[0].p.ageSource, 'recorded');
        const updated = await row(pid);
        assert.equal(updated.date_of_birth, '2000-01-01');
        assert.equal(updated.age_years, 25);
        await register(users.otherPatient, {
          name: 'Fictional Legacy Date',
          phone: '03001234567',
          dateOfBirth: '1990-01-01',
          gender: 'Other',
        });
        const after = await row(pid);
        assert.equal(after.date_of_birth, '2000-01-01');
        assert.equal(after.age_years, 25);
      }),
    );

    await t.test('registration requires an age or birth date and rejects invalid ages', () =>
      isolated(async () => {
        const details = { name: 'Fictional Missing Age', phone: '03001234567', gender: 'Other' };
        await invalid(attempt(() => register(users.otherOrgPatient, details)), '22023');
        await invalid(
          attempt(() => register(users.otherOrgPatient, { ...details, ageYears: 121 })),
          '22023',
        );
        await invalid(
          attempt(() => register(users.otherOrgPatient, { ...details, dateOfBirth: '2999-01-01' })),
          '22023',
        );
        await invalid(
          attempt(() => register(users.otherOrgPatient, { ...details, ageYears: '40' })),
          '22023',
        );
      }),
    );

    await t.test('a patient must always have an age or a birth date', () =>
      isolated(async () => {
        await invalid(
          attempt(() =>
            db.query(
              'update public.patients set date_of_birth=null,age_years=null,age_recorded_on=null where id=$1',
              [patient],
            ),
          ),
        );
        await invalid(
          attempt(() =>
            db.query('update public.patients set age_years=30,age_recorded_on=null where id=$1', [
              patient,
            ]),
          ),
        );
        await invalid(
          attempt(() =>
            db.query(
              'update public.patients set age_years=121,age_recorded_on=current_date where id=$1',
              [patient],
            ),
          ),
        );
      }),
    );

    await t.test('the reviewed age remains stored before a clinician records blood group', async () => {
      assert.equal((await row()).blood_group, null);
      const profile = (await read()).rows[0].p;
      assert.equal(profile.ageYears, 32);
      assert.equal(profile.ageSource, 'recorded');
      assert.equal(profile.ageRecordedOn, today);
    });

    await t.test('assigned Doctor saves blood group with the complete history', () =>
      isolated(async () => {
        await saveHistory();
        assert.deepEqual(await row(), {
          date_of_birth: '1994-04-12',
          age_years: 32,
          age_recorded_on: today,
          patient_code: 'SRO0001',
          blood_group: 'O+',
        });
        const stored = await db.query<{ allergies: string[]; review_state: string }>(
          'select allergies,review_state from public.patient_medical_history where patient_id=$1',
          [patient],
        );
        assert.deepEqual(stored.rows[0], {
          allergies: ['Fictional reported allergy'],
          review_state: 'reviewed',
        });
        const audit = await db.query<{ n: number }>(
          `select count(*)::integer n from public.audit_logs where action='patient.history.reviewed' and actor_id=$1 and entity_id=$2`,
          [users.doctor, patient],
        );
        assert.equal(audit.rows[0].n, 1);
        await saveHistory(users.doctor, { ...history, bloodGroup: '' });
        assert.equal((await row()).blood_group, null);
        await invalid(saveHistory(users.doctor, { ...history, bloodGroup: 'X+' }));
      }),
    );

    await t.test('Patient, Admin and unassigned Doctor cannot write the blood group', async () => {
      await denied(saveHistory(users.patient));
      await denied(saveHistory(users.adminA));
      await denied(saveHistory(users.adminAll));
      await denied(saveHistory(users.otherDoctor));
      await denied(saveHistory(users.otherOrgDoctor));
    });

    await t.test('Age cannot be changed through unrestricted direct table writes', async () => {
      for (const user of [users.patient, users.adminA, users.doctor])
        await denied(
          asUser(db, user, () =>
            db.query('update public.patients set age_years=50 where id=$1', [patient]),
          ),
        );
      const grants = await db.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='patients' and grantee='authenticated' order by privilege_type`,
      );
      assert.deepEqual(
        grants.rows.map((g) => g.privilege_type),
        ['SELECT'],
      );
      const clientWrites = await db.query<{ n: number }>(
        `select count(*)::integer n from information_schema.role_table_grants where table_schema='public' and table_name='patients' and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')`,
      );
      assert.equal(clientWrites.rows[0].n, 0);
      assert.equal((await row()).age_years, 32);
    });

    await t.test('migration keeps patient identifiers and clinical records intact', async () => {
      const counts = await db.query<{
        patients: number;
        history: number;
        appointments: number;
        assignments: number;
      }>(
        `select (select count(*)::integer from public.patients) patients,
          (select count(*)::integer from public.patient_medical_history) history,
          (select count(*)::integer from public.appointments) appointments,
          (select count(*)::integer from public.patient_assignments) assignments`,
      );
      assert.deepEqual(counts.rows[0], {
        patients: 1,
        history: 1,
        appointments: 1,
        assignments: 1,
      });
      const stored = await row();
      assert.equal(stored.patient_code, 'SRO0001');
      assert.equal(stored.age_years, 32);
      assert.equal(stored.date_of_birth, '1994-04-12');
    });
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});

test('reviewed backfill accepts an already recorded demo age 32', async () => {
  const db = await ageDatabase();
  try {
    await db.query(
      "update public.patients set age_years=32,age_recorded_on=date '2026-10-27' where id=$1",
      [patient],
    );
    await db.exec(await readFile(manualAgeMigration, 'utf8'));
    const stored = (
      await db.query<{ age_years: number; age_recorded_on: string; date_of_birth: string }>(
        'select age_years,age_recorded_on::text,date_of_birth::text from public.patients where id=$1',
        [patient],
      )
    ).rows[0];
    assert.deepEqual(stored, {
      age_years: 32,
      age_recorded_on: '2026-10-27',
      date_of_birth: '1994-04-12',
    });
    assert.equal(
      (
        await db.query<{ n: number }>(
          `select count(*)::integer n from public.audit_logs where action='patient.age.backfilled' and entity_id=$1`,
          [patient],
        )
      ).rows[0].n,
      0,
    );
    await db.exec('begin');
    const profile = await asUser(db, users.patient, () =>
      db.query<{ p: Record<string, unknown> }>('select public.get_clinic_profile($1,$2,$3) p', [
        org,
        'patient',
        patient,
      ]),
    );
    assert.equal(profile.rows[0].p.ageYears, 32);
    assert.equal(profile.rows[0].p.ageSource, 'recorded');
    assert.equal(profile.rows[0].p.ageRecordedOn, '2026-10-27');
  } finally {
    await db.close();
  }
});
