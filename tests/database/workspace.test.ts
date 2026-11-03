import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectClinicalRows } from '../../apps/web/lib/clinical-projector';
import { clinicalTables, type ClinicalRows } from '../../apps/web/lib/clinical-contracts';
import { createDatabase, users, id, asUser, book, transition } from './harness';
const branch = id(2, 1),
  doctor = id(4, 1),
  patient = id(5, 1);
test('Phase 2C additive workspace commands', async (t) => {
  const db = await createDatabase(true, (db) =>
    db.exec(
      `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);`,
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
    async function runAs(user: string, sql: string, args: unknown[] = []) {
      await db.exec('begin');
      try {
        return await asUser(db, user, () => db.query(sql, args));
      } finally {
        await db.exec('rollback');
      }
    }
    const manage = (action: string, data: unknown, b = branch) =>
      ['select public.manage_clinic($1,$2,$3)', [b, action, data]] as const;
    async function deny(user: string, action: string, data: unknown, b = branch) {
      const [sql, args] = manage(action, data, b);
      await assert.rejects(
        runAs(user, sql, [...args]),
        (e: unknown) => (e as { code: string }).code === '42501',
      );
    }
    await t.test(
      'Patient cannot change branches, departments, schedules or assignments',
      async () => {
        for (const action of ['branch', 'department', 'schedule', 'assignment'])
          await deny(users.patient, action, { doctorId: doctor, name: 'Fictional Department' });
      },
    );
    await t.test('branch Admin cannot edit unassigned or foreign branches', async () => {
      await deny(users.adminA, 'branch', { id: id(2, 2), name: 'Unassigned Clinic', active: true });
      await deny(users.otherOrgAdmin, 'department', { name: 'Foreign Department' });
    });
    await t.test('Doctor cannot change consultation fees', () =>
      deny(users.doctor, 'fee', { doctorId: doctor, fee: 100 }),
    );
    await t.test(
      'Patient, foreign Admin and unassigned branch cannot change consultation fees',
      async () => {
        await deny(users.patient, 'fee', { doctorId: doctor, fee: '1500.00' });
        await deny(users.otherOrgAdmin, 'fee', { doctorId: doctor, fee: '1500.00' });
        await deny(users.adminA, 'fee', { doctorId: doctor, fee: '1500.00' }, id(2, 2));
      },
    );
    await t.test(
      'Admin fee changes are branch-specific, exact, audited and preserve appointment quotes',
      async () => {
        await db.exec('begin');
        try {
          const before = (
            await db.query(
              'select appointment_id,amount_paisa from public.consultation_charges order by appointment_id',
            )
          ).rows;
          const other = (
            await db.query(
              'select fee_paisa from public.doctor_branch_assignments where doctor_id=$1 and branch_id=$2',
              [doctor, id(2, 2)],
            )
          ).rows;
          for (const [fee, paisa] of [
            ['1500.00', 150000],
            ['1.13', 113],
            ['0.00', 0],
            ['1000000.00', 100000000],
          ] as const) {
            const [sql, args] = manage('fee', { doctorId: doctor, fee });
            await asUser(db, users.adminA, () => db.query(sql, [...args]));
            const row = await db.query<{ fee_paisa: number }>(
              'select fee_paisa from public.doctor_branch_assignments where doctor_id=$1 and branch_id=$2',
              [doctor, branch],
            );
            assert.equal(Number(row.rows[0].fee_paisa), paisa);
          }
          assert.deepEqual(
            (
              await db.query(
                'select appointment_id,amount_paisa from public.consultation_charges order by appointment_id',
              )
            ).rows,
            before,
          );
          assert.deepEqual(
            (
              await db.query(
                'select fee_paisa from public.doctor_branch_assignments where doctor_id=$1 and branch_id=$2',
                [doctor, id(2, 2)],
              )
            ).rows,
            other,
          );
          assert.equal(
            (
              await db.query(
                "select id from public.audit_logs where actor_id=$1 and action='clinic.fee.saved'",
                [users.adminA],
              )
            ).rows.length,
            4,
          );
        } finally {
          await db.exec('rollback');
        }
      },
    );
    await t.test('RPC rejects negative, excessive and fractional-paisa fees', async () => {
      for (const fee of ['-0.01', '1000000.01', '1.001']) {
        const [sql, args] = manage('fee', { doctorId: doctor, fee });
        await assert.rejects(
          runAs(users.adminA, sql, [...args]),
          (e: unknown) => (e as { code: string }).code === '22023',
        );
      }
    });
    await t.test('Doctor cannot edit another Doctor schedule', () =>
      deny(users.doctor, 'schedule', {
        doctorId: id(4, 2),
        days: [1],
        start: '09:00',
        end: '11:00',
        breaks: [],
      }),
    );
    await t.test('Admin can create an authorized branch with an actor membership', async () => {
      const [sql, args] = manage('branch', {
        name: 'Additional Fictional Clinic',
        address: 'Test address',
        phone: '+923000000000',
      });
      const r = await runAs(users.adminA, sql, [...args]);
      assert.equal(r.rows.length, 1);
    });
    await t.test('profile updates cannot change another user or role', async () => {
      const [sql, args] = manage('profile', {
        name: 'Updated Fictional Name',
        userId: users.adminA,
        role: 'admin',
      });
      await db.exec('begin');
      try {
        await asUser(db, users.patient, () => db.query(sql, [...args]));
        const r = await db.query<{ name: string }>('select name from public.profiles where id=$1', [
          users.adminA,
        ]);
        assert.notEqual(r.rows[0].name, 'Updated Fictional Name');
        const roles = await db.query<{ role: string }>(
          'select role from public.role_assignments where user_id=$1',
          [users.patient],
        );
        assert.deepEqual(
          roles.rows.map((r) => r.role),
          ['patient'],
        );
      } finally {
        await db.exec('rollback');
      }
    });
    await t.test('Admin schedule saving publishes future slots atomically', async () => {
      await db.exec('begin');
      try {
        const [sql, args] = manage('schedule', {
          doctorId: doctor,
          days: [0, 1, 2, 3, 4, 5, 6],
          start: '09:00',
          end: '17:00',
          breaks: [{ start: '12:00', end: '13:00' }],
        });
        await asUser(db, users.adminA, () => db.query(sql, [...args]));
        const r = await db.query<{ n: number }>(
          "select count(*)::integer n from public.appointment_slots where doctor_id=$1 and starts_at>now() and starts_at<now()+interval '15 days'",
          [doctor],
        );
        assert.ok(r.rows[0].n > 0);
      } finally {
        await db.exec('rollback');
      }
    });
    await t.test('Patient cannot publish slots and publication is bounded', async () => {
      await assert.rejects(
        runAs(
          users.patient,
          'select public.publish_appointment_slots($1,$2,current_date,current_date+1)',
          [branch, doctor],
        ),
        (e: unknown) => (e as { code: string }).code === '42501',
      );
      await assert.rejects(
        runAs(
          users.adminA,
          'select public.publish_appointment_slots($1,$2,current_date,current_date+40)',
          [branch, doctor],
        ),
        (e: unknown) => (e as { code: string }).code === '22023',
      );
    });
    await t.test('Patient and Admin cannot write clinical history as a clinician', async () => {
      for (const who of [users.patient, users.adminA])
        await assert.rejects(
          runAs(who, 'select public.save_patient_history($1,$2,$3)', [
            patient,
            branch,
            { allergies: [], conditions: [], medications: [] },
          ]),
          (e: unknown) => (e as { code: string }).code === '42501',
        );
    });
    await t.test('treating Doctor can save history; unrelated Doctor cannot', async () => {
      await db.exec('begin');
      try {
        const apt = await book(db);
        await transition(db, apt, 'confirmed');
        const history = {
          allergies: ['Fictional allergy'],
          conditions: [],
          medications: [],
          surgeries: '',
          familyHistory: '',
          socialHistory: '',
          bloodGroup: '',
          emergencyContact: '',
        };
        await asUser(db, users.doctor, () =>
          db.query('select public.save_patient_history($1,$2,$3)', [patient, branch, history]),
        );
        const r = await db.query<{ review_state: string }>(
          'select review_state from public.patient_medical_history where patient_id=$1',
          [patient],
        );
        assert.equal(r.rows[0].review_state, 'reviewed');
        await assert.rejects(
          asUser(db, users.otherDoctor, () =>
            db.query('select public.save_patient_history($1,$2,$3)', [patient, branch, history]),
          ),
          (e: unknown) => (e as { code: string }).code === '42501',
        );
      } finally {
        await db.exec('rollback');
      }
    });
    await t.test('calendar edits cannot invalidate an existing reservation', async () => {
      await db.exec('begin');
      try {
        await book(db);
        const [sql, args] = manage('schedule', {
          doctorId: doctor,
          days: [1],
          start: '10:00',
          end: '11:00',
          breaks: [],
        });
        await assert.rejects(
          asUser(db, users.adminA, () => db.query(sql, [...args])),
          (e: unknown) => (e as { code: string }).code === '23514',
        );
      } finally {
        await db.exec('rollback');
      }
    });
    await t.test(
      'real SQL rows project the Patient to Admin to Doctor to Patient workflow',
      async () => {
        await db.exec('begin');
        try {
          const apt = await book(db);
          async function projection(user: string, role: 'admin' | 'doctor' | 'patient') {
            const entries = await asUser(db, user, async () => {
              const result = [];
              for (const table of clinicalTables) {
                const where =
                  table === 'profiles'
                    ? ''
                    : table === 'organizations'
                      ? ` where id='${id(1, 1)}'`
                      : ` where organization_id='${id(1, 1)}'`;
                result.push([
                  table,
                  (await db.query(`select * from public.${table}${where}`)).rows,
                ]);
              }
              return result;
            });
            return projectClinicalRows(
              Object.fromEntries(entries) as ClinicalRows,
              user,
              role,
              id(1, 1),
              [branch],
            );
          }
          const admin = await projection(users.adminA, 'admin');
          assert.ok(admin.state.appointments.some((a) => a.id === apt));
          const pending = await projection(users.doctor, 'doctor');
          assert.ok(!pending.state.patients.some((p) => p.id === patient));
          await transition(db, apt, 'confirmed');
          await transition(db, apt, 'checked_in', users.doctor);
          await transition(db, apt, 'in_consultation', users.doctor);
          const notes = {
            symptoms: 'Test symptoms',
            examination: 'Test findings',
            diagnosis: 'Test diagnosis',
            plan: 'Test plan',
            followUp: 'Test follow-up',
            vitals: {
              bloodPressure: '120/80',
              pulse: '72',
              temperature: '36.8',
              weight: '68',
              height: '170',
              oxygen: '98',
            },
          };
          const items = [
            {
              medication: 'Test medication',
              strength: '500 mg',
              dosage: 'One tablet',
              frequency: 'Daily',
              duration: 'Five days',
              instructions: 'Test instructions',
            },
          ];
          await asUser(db, users.doctor, () =>
            db.query('select public.save_encounter($1,$2,$3,true)', [apt, notes, items]),
          );
          const result = await projection(users.patient, 'patient');
          assert.equal(result.actor.patientId, patient);
          assert.equal(result.state.appointments.find((a) => a.id === apt)?.status, 'completed');
          assert.equal(result.state.consultations[0].vitals.bloodPressure, '120/80');
          assert.equal(result.state.prescriptions[0].items[0].medication, 'Test medication');
        } finally {
          await db.exec('rollback');
        }
      },
    );
    await t.test('only the scoped Admin can revoke an open invitation', async () => {
      const invitation = id(7, 99);
      const specialization = (
        await db.query<{ specialization_id: string }>(
          'select specialization_id from public.doctors where id=$1',
          [doctor],
        )
      ).rows[0].specialization_id;
      await db.query(
        `insert into public.doctor_invitations(id,organization_id,branch_id,specialization_id,name,email,invited_by,expires_at,status) values($1,$2,$3,$4,'Fictional Physician','physician@example.test',$5,now()+interval '1 day','sent')`,
        [invitation, id(1, 1), branch, specialization, users.adminA],
      );
      await deny(users.patient, 'revoke_invitation', { id: invitation });
      const [sql, args] = manage('revoke_invitation', { id: invitation });
      await db.exec('begin');
      try {
        await asUser(db, users.adminA, () => db.query(sql, [...args]));
        assert.equal(
          (
            await db.query<{ status: string }>(
              'select status from public.doctor_invitations where id=$1',
              [invitation],
            )
          ).rows[0].status,
          'revoked',
        );
      } finally {
        await db.exec('rollback');
      }
    });
    await t.test(
      'new wrappers are invoker-only and internal authorization helper is not callable',
      async () => {
        const r = await db.query<{ secure: boolean }>(
          `select not prosecdef and proconfig @> array['search_path=""'] and has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('service_role',oid,'EXECUTE') secure from pg_proc where pronamespace='public'::regnamespace and proname in ('manage_clinic','publish_appointment_slots','save_patient_history')`,
        );
        assert.equal(r.rows.length, 3);
        assert.ok(r.rows.every((r) => r.secure));
        const p = await db.query<{ allowed: boolean }>(
          `select has_function_privilege('authenticated','clinic_private.workspace_admin(uuid)','EXECUTE') allowed`,
        );
        assert.equal(p.rows[0].allowed, false);
      },
    );
    await t.test('prepared post-deployment checks match the proposed schema', async () => {
      await db.exec(
        `create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);insert into supabase_migrations.schema_migrations values('20261026024332'),('20261026024335'),('20261026024338'),('20261026111934'),('20261026123202');`,
      );
      await db.exec(await readFile('scripts/phase2c-post-deployment-checks.sql', 'utf8'));
    });
  } finally {
    await db.close();
  }
});
