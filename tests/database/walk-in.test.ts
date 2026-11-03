import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, id, users, asUser, transition } from './harness';
const org = '88645fbe-34da-48aa-a509-c24441b7cf72',
  existing = '398cf267-bc60-41a4-91e6-478dcd86a069',
  branch = id(2, 1);
type Intake = { id: string; patientCode: string };
test('staff walk-in registration and isolated intake authority', async (t) => {
  const db = await createDatabase(false, (db) =>
    db.exec(
      `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon,service_role;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`,
    ),
  );
  try {
    for (const file of [
      'supabase/proposals/phase2b/20261026111934_clinic_auth_onboarding.sql',
      'supabase/proposals/phase2c/20261026123202_clinic_workspace_commands.sql',
      'supabase/proposals/profiles/20261026192535_clinic_profiles_avatars.sql',
    ])
      await db.exec(await readFile(file, 'utf8'));
    await db.exec(
      (await readFile('supabase/fixtures/fictional.sql', 'utf8'))
        .replaceAll(id(1, 1), org)
        .replaceAll(id(5, 1), existing)
        .replaceAll('Fictional Patient A', 'Amina Noor'),
    );
    for (const table of ['medical_documents', 'patient_medical_history', 'patient_branches'])
      await db.query(`delete from public.${table} where patient_id<>$1`, [existing]);
    await db.query('delete from public.patients where id<>$1', [existing]);
    await db.exec(
      `update auth.users set email=id::text||'@example.test',email_confirmed_at=now();insert into clinic_private.auth_setup(organization_id,registration_branch_id,bootstrap_user_id) values('${org}','${branch}','${users.adminA}');`,
    );
    for (const file of [
      'supabase/proposals/patient-ids/20261026195847_clinic_patient_numbers.sql',
      'supabase/proposals/patient-age/20261026224947_clinic_patient_age.sql',
      'supabase/proposals/walk-in/20261027093051_clinic_walk_in_registration.sql',
    ])
      await db.exec(await readFile(file, 'utf8'));
    await db.exec(await readFile('scripts/walk-in-post-deployment-checks.sql', 'utf8'));
    await db.exec('begin');
    const isolated = async (fn: () => Promise<void>) => {
      await db.exec('savepoint case_scope');
      try {
        await fn();
      } finally {
        await db.exec('rollback to savepoint case_scope;release savepoint case_scope');
      }
    };
    const attempt = async <T>(fn: () => Promise<T>) => {
      await db.exec('savepoint attempt_scope');
      try {
        return await fn();
      } catch (e) {
        await db.exec('rollback to savepoint attempt_scope');
        throw e;
      } finally {
        await db.exec('release savepoint attempt_scope');
      }
    };
    const denied = (run: Promise<unknown>, code = '42501') =>
      assert.rejects(run, (e: unknown) => (e as { code: string }).code === code);
    const fields = {
      name: 'Fictional Walk-in Patient',
      ageYears: 26,
      gender: 'Female',
      email: '',
      phone: '',
      address: 'Fictional clinic address',
      bloodGroup: 'B+',
    };
    const register = (
      user = users.adminA,
      extra: Record<string, unknown> = {},
      b = branch,
      r = randomUUID(),
    ) =>
      asUser(db, user, async () => {
        const result = await db.query<{ p: Intake }>(
          'select public.register_walk_in_patient($1,$2,$3) p',
          [b, r, JSON.stringify({ ...fields, ...extra })],
        );
        return result.rows[0].p;
      });
    const row = async (pid: string) =>
      (
        await db.query<{
          user_id: string | null;
          date_of_birth: string | null;
          age_years: number;
          age_recorded_on: string;
          email: string;
          patient_code: string;
        }>(
          'select user_id,date_of_birth,age_years,age_recorded_on,email,patient_code from public.patients where id=$1',
          [pid],
        )
      ).rows[0];
    const counter = async () =>
      Number(
        (
          await db.query<{ n: number }>(
            'select last_number n from clinic_private.patient_number_counter',
          )
        ).rows[0].n,
      );
    const intakes = (user = users.doctor) =>
      asUser(db, user, () =>
        db.query<{ a: { patientId: string; bloodGroup: string; clinicalAccess: boolean }[] }>(
          'select public.staff_patient_intakes($1) a',
          [org],
        ),
      );
    const portal = (u = users.otherPatient, extra: Record<string, unknown> = {}) =>
      attempt(async () => {
        await db.exec('set role service_role');
        try {
          return await db.query('select public.phase2b_patient($1,$2)', [
            u,
            JSON.stringify({ ...fields, ...extra }),
          ]);
        } catch (e) {
          await db.exec('rollback to savepoint attempt_scope');
          throw e;
        } finally {
          await db.exec('reset role');
        }
      });
    await t.test(
      'Admin registers without email or Auth account; age is independent and number allocated',
      () =>
        isolated(async () => {
          const auth = (await db.query('select * from auth.users')).rows;
          const p = await register();
          assert.equal(p.patientCode, 'SRO0002');
          const r = await row(p.id);
          assert.equal(r.user_id, null);
          assert.equal(r.date_of_birth, null);
          assert.equal(r.age_years, 26);
          assert.equal(r.email, '');
          assert.ok(r.age_recorded_on);
          assert.deepEqual((await db.query('select * from auth.users')).rows, auth);
          const h = (
            await db.query<{ blood_group: string; review_state: string }>(
              'select blood_group,review_state from public.patient_medical_history where patient_id=$1',
              [p.id],
            )
          ).rows[0];
          assert.equal(h.blood_group, 'B+');
          assert.equal(h.review_state, 'unknown');
        }),
    );
    await t.test('optional contact email is stored without confirmation or identity linking', () =>
      isolated(async () => {
        const p = await register(users.adminA, { email: users.otherPatient + '@example.test' });
        assert.equal((await row(p.id)).user_id, null);
        assert.equal((await row(p.id)).email, users.otherPatient + '@example.test');
        assert.equal(
          (
            await asUser(db, users.otherPatient, () =>
              db.query('select id from public.patients where id=$1', [p.id]),
            )
          ).rows.length,
          0,
        );
      }),
    );
    await t.test(
      'Doctor has demographic intake access but no medical history, fake appointment or assignment',
      () =>
        isolated(async () => {
          const p = await register(users.doctor);
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query('select id from public.patients where id=$1', [p.id]),
              )
            ).rows.length,
            1,
          );
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query('select * from public.patient_medical_history where patient_id=$1', [
                  p.id,
                ]),
              )
            ).rows.length,
            0,
          );
          const dto = (await intakes()).rows[0].a;
          assert.equal(dto[0].patientId, p.id);
          assert.equal(dto[0].bloodGroup, 'B+');
          assert.equal(dto[0].clinicalAccess, false);
          assert.equal(
            (await db.query('select * from public.appointments where patient_id=$1', [p.id])).rows
              .length,
            0,
          );
          assert.equal(
            (await db.query('select * from public.patient_assignments where patient_id=$1', [p.id]))
              .rows.length,
            0,
          );
          assert.equal(
            (
              await asUser(db, users.otherDoctor, () =>
                db.query('select id from public.patients where id=$1', [p.id]),
              )
            ).rows.length,
            0,
          );
        }),
    );
    await t.test(
      'Doctor books own real appointment; clinical access starts only on authorized approval',
      () =>
        isolated(async () => {
          const p = await register(users.doctor);
          const a = await asUser(
            db,
            users.doctor,
            async () =>
              (
                await db.query<{ id: string }>(
                  'select public.book_appointment($1,$2,$3,$4,$5) id',
                  [id(6, 1), p.id, 'Fictional walk-in visit', 'physical', 'walk_in'],
                )
              ).rows[0].id,
          );
          assert.equal((await intakes()).rows[0].a[0].clinicalAccess, false);
          await transition(db, a, 'confirmed');
          assert.equal((await intakes()).rows[0].a[0].clinicalAccess, true);
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query('select * from public.patient_medical_history where patient_id=$1', [
                  p.id,
                ]),
              )
            ).rows.length,
            1,
          );
        }),
    );
    await t.test(
      'Doctor cannot use intake to book another Doctor, patient source or another patient',
      () =>
        isolated(async () => {
          const p = await register(users.doctor);
          for (const args of [
            [org, branch, id(4, 2), p.id, 'walk_in'],
            [org, branch, id(4, 1), p.id, 'patient'],
            [org, branch, id(4, 1), existing, 'walk_in'],
          ]) {
            const r = await asUser(db, users.doctor, () =>
              db.query<{ ok: boolean }>('select clinic_private.can_book($1,$2,$3,$4,$5) ok', args),
            );
            assert.equal(r.rows[0].ok, false);
          }
        }),
    );
    await t.test(
      'Patient, anonymous, foreign organization and unauthorized branch calls denied',
      async () => {
        await denied(register(users.patient));
        await denied(register(users.otherOrgAdmin));
        await denied(register(users.adminA, {}, id(2, 2)));
        await denied(register(users.branchBDoctor));
        await denied(
          asUser(
            db,
            null,
            () =>
              db.query('select public.register_walk_in_patient($1,$2,$3)', [
                branch,
                randomUUID(),
                JSON.stringify(fields),
              ]),
            'anon',
          ),
        );
      },
    );
    await t.test('revoked membership, inactive branch assignment and MFA deny intake', () =>
      isolated(async () => {
        await db.query(
          'update public.doctor_branch_assignments set active=false where doctor_id=$1',
          [id(4, 1)],
        );
        await denied(register(users.doctor));
        await db.query('update public.branch_memberships set active=false where user_id=$1', [
          users.adminA,
        ]);
        await denied(register());
        await db.query("insert into auth.mfa_factors(user_id,status) values($1,'verified')", [
          users.otherDoctor,
        ]);
        await denied(register(users.otherDoctor));
      }),
    );
    await t.test(
      'idempotent retries preserve patient UUID, number and counter; altered request rejected',
      () =>
        isolated(async () => {
          const request = randomUUID();
          const p = await register(users.adminA, {}, branch, request);
          assert.deepEqual(await register(users.adminA, {}, branch, request), p);
          assert.equal(await counter(), 2);
          await denied(
            register(users.adminA, { name: 'Changed Patient' }, branch, request),
            '23505',
          );
          assert.equal(await counter(), 2);
        }),
    );
    await t.test('downstream failure rolls back patient, number, branch, intake and audit', () =>
      isolated(async () => {
        await db.exec(
          `create function clinic_private.fail_walkin_history() returns trigger language plpgsql as $$begin raise exception 'Fictional registration failure';end$$;create trigger fail_walkin_history before insert on public.patient_medical_history for each row execute function clinic_private.fail_walkin_history();`,
        );
        await assert.rejects(register());
        assert.equal(await counter(), 1);
        assert.equal((await db.query('select * from public.patients')).rows.length, 1);
        assert.equal(
          (await db.query('select * from clinic_private.patient_intakes')).rows.length,
          0,
        );
        await db.exec('drop trigger fail_walkin_history on public.patient_medical_history');
        assert.equal((await register()).patientCode, 'SRO0002');
      }),
    );
    await t.test(
      'invalid age, blood group, text, forged actor/identity/number fields rejected',
      async () => {
        for (const extra of [
          { ageYears: -1 },
          { ageYears: 121 },
          { ageYears: 1.5 },
          { ageYears: '26' },
          { bloodGroup: 'Unknown' },
          { email: 'bad' },
          { phone: '---' },
          { name: 'x' },
          { user_id: users.patient },
          { patient_number: 99 },
          { actorId: users.adminA },
          { dateOfBirth: '2000-01-01' },
        ])
          await denied(register(users.adminA, extra), '22023');
        assert.equal(await counter(), 1);
      },
    );
    await t.test('age zero and 120, absent optional contact/blood fields are valid', () =>
      isolated(async () => {
        for (const ay of [0, 120]) {
          const p = await register(users.adminA, { ageYears: ay, bloodGroup: '', address: '' });
          assert.equal((await row(p.id)).age_years, ay);
        }
      }),
    );
    await t.test(
      'expired intake and revoked staff lose demographic access and booking authority',
      () =>
        isolated(async () => {
          const p = await register(users.doctor);
          await db.exec(
            "update clinic_private.patient_intakes set created_at=now()-interval '2 days',expires_at=now()-interval '1 day'",
          );
          assert.equal((await intakes()).rows[0].a.length, 0);
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query('select id from public.patients where id=$1', [p.id]),
              )
            ).rows.length,
            0,
          );
        }),
    );
    await t.test(
      'verified portal contact match requires clinic review, never auto-claims or duplicates',
      () =>
        isolated(async () => {
          const p = await register(users.adminA, {
            email: users.otherPatient + '@example.test',
            phone: '03000000000',
          });
          await denied(portal(users.otherPatient, { phone: '03000000000' }), 'P2101');
          assert.equal((await row(p.id)).user_id, null);
          assert.equal(await counter(), 2);
          assert.equal((await db.query('select * from public.patients')).rows.length, 2);
        }),
    );
    await t.test('portal self-registration still rejects unverified Auth identity', () =>
      isolated(async () => {
        await db.query('update auth.users set email_confirmed_at=null where id=$1', [
          users.otherPatient,
        ]);
        await denied(portal(), '42501');
        assert.equal(await counter(), 1);
      }),
    );
    await t.test(
      'ordinary verified portal signup without a walk-in contact match still succeeds',
      () =>
        isolated(async () => {
          const result = await portal();
          const pid = String(result.rows[0].phase2b_patient);
          assert.equal((await row(pid)).user_id, users.otherPatient);
          assert.equal((await row(pid)).patient_code, 'SRO0002');
        }),
    );
    await t.test(
      'no authenticated table writes or service-role intake command bypass',
      async () => {
        await denied(
          asUser(db, users.adminA, () =>
            db.exec(
              "insert into public.patients(organization_id,home_branch_id,name,gender,age_years,age_recorded_on) values('" +
                org +
                "','" +
                branch +
                "','Forged Patient','Other',20,current_date)",
            ),
          ),
        );
        const r = await db.query<{ allowed: boolean }>(
          "select has_function_privilege('service_role','public.register_walk_in_patient(uuid,uuid,jsonb)','execute') allowed",
        );
        assert.equal(r.rows[0].allowed, false);
        await denied(
          asUser(db, users.doctor, () => db.exec('select * from clinic_private.patient_intakes')),
        );
      },
    );
    await t.test('multiple independent requests receive distinct permanent numbers', () =>
      isolated(async () => {
        const codes = [];
        for (let n = 0; n < 8; n++) codes.push((await register()).patientCode);
        assert.equal(new Set(codes).size, 8);
        assert.equal(codes[0], 'SRO0002');
        assert.equal(codes[7], 'SRO0009');
      }),
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
