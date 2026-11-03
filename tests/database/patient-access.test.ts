import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, asUser, users, id } from './harness';
import { patientOperationCases } from './patient-operation-cases';
test('patient account lifecycle and deny-first access', async (t) => {
  const db = await createDatabase(false, (db) =>
    db.exec(`
    alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz,add encrypted_password text,add last_sign_in_at timestamptz,add confirmation_sent_at timestamptz,add created_at timestamptz not null default now(),add raw_user_meta_data jsonb not null default '{}';
    create table auth.identities(user_id uuid,provider text,primary key(user_id,provider));
    create table auth.mfa_factors(user_id uuid,status text);
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon,service_role;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;
  `),
  );
  try {
    t.diagnostic(
      'Isolated SQL runtime: ' +
        (await db.query<{ version: string }>('select version()')).rows[0].version,
    );
    const replay = async (file: string) =>
      db.exec(await readFile('supabase/proposals/' + file, 'utf8'));
    for (const file of [
      'phase2b/20261026111934_clinic_auth_onboarding.sql',
      'phase2c/20261026123202_clinic_workspace_commands.sql',
      'profiles/20261026192535_clinic_profiles_avatars.sql',
    ])
      await replay(file);
    const org = '88645fbe-34da-48aa-a509-c24441b7cf72',
      legacyPatient = '398cf267-bc60-41a4-91e6-478dcd86a069';
    const fixture = (await readFile('supabase/fixtures/fictional.sql', 'utf8'))
      .replaceAll(id(1, 1), org)
      .replaceAll(id(5, 1), legacyPatient)
      .replaceAll('Fictional Patient A', 'Amina Noor');
    await db.exec(fixture);
    for (const table of ['medical_documents', 'patient_medical_history', 'patient_branches'])
      await db.query('delete from public.' + table + ' where patient_id<>$1', [legacyPatient]);
    await db.query('delete from public.patients where id<>$1', [legacyPatient]);
    await db.exec(
      `update auth.users set email=id::text||'@example.test',email_confirmed_at=now(),encrypted_password='fictional-hash';`,
    );
    await db.query(
      'insert into clinic_private.auth_setup(organization_id,registration_branch_id,bootstrap_user_id) values($1,$2,$3)',
      [org, id(2, 1), users.adminA],
    );
    for (const file of [
      'patient-ids/20261026195847_clinic_patient_numbers.sql',
      'patient-age/20261026224947_clinic_patient_age.sql',
      'walk-in/20261027093051_clinic_walk_in_registration.sql',
      'staff-booking/20261027105809_clinic_staff_booking_profiles.sql',
      'patient-registration/20261027155325_clinic_patient_registration_timestamp.sql',
      'doctor-profile/20261027164031_clinic_doctor_verified_email.sql',
      'department-edit/20261027170222_clinic_department_edit.sql',
      'doctor-onboarding/20261027210515_clinic_doctor_onboarding_preview.sql',
      'single-email-onboarding/20261028103401_clinic_single_email_onboarding.sql',
      'invitation-management/20261028120915_clinic_invitation_management.sql',
      'incomplete-onboarding-recovery/20261028131406_clinic_incomplete_onboarding_recovery.sql',
      'patient-access/20261029182220_clinic_patient_account_access.sql',
    ])
      await replay(file);
    await db.exec(await readFile('scripts/patient-access-post-deployment-checks.sql', 'utf8'));
    const row = (
      await db.query<{ id: string; organization_id: string; home_branch_id: string }>(
        'select * from public.patients where user_id=$1',
        [users.patient],
      )
    ).rows[0];
    const p = row.id;
    await db.query('update public.patients set user_id=null where id=$1', [p]);
    const command = (
      action: string,
      actor: string | null = users.adminA,
      data: Record<string, unknown> = {},
    ) =>
      db.query<{ r: Record<string, unknown> }>(
        'select public.patient_account_command($1,$2,$3,$4) r',
        [action, actor, p, JSON.stringify(data)],
      );
    const rejected = async (fn: () => Promise<unknown>) => {
      await db.exec('savepoint denied');
      try {
        await assert.rejects(fn());
      } finally {
        await db.exec('rollback to savepoint denied;release savepoint denied');
      }
    };
    const scenario = (name: string, fn: () => Promise<void>) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await fn();
        } finally {
          await db.exec('rollback');
        }
      });
    const prepare = async (actor = users.adminA) => {
      const op = randomUUID();
      const a = (await command('begin', actor, { operationId: op })).rows[0].r;
      await db.query(
        'insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,now(),$3)',
        [a.userId, a.internalEmail, 'temporary-auth-hash'],
      );
      await command('commit', actor, { operationId: op, handoverHash: 'a'.repeat(64) });
      return { op, a };
    };
    await scenario('existing linked Auth identity is never replaced', async () => {
      await db.query('update public.patients set user_id=$1 where id=$2', [users.patient, p]);
      await rejected(() => command('begin', users.adminA, { operationId: randomUUID() }));
      assert.equal(
        (
          await db.query<{ user_id: string }>('select user_id from public.patients where id=$1', [
            p,
          ])
        ).rows[0].user_id,
        users.patient,
      );
    });
    await scenario(
      'Doctor initial provisioning requires their own unexpired intake; reset remains Admin-only',
      async () => {
        await db.query(
          'insert into clinic_private.patient_intakes(organization_id,patient_id,branch_id,created_by,request_id,fields_hash) values($1,$2,$3,$4,$5,$6)',
          [
            row.organization_id,
            p,
            row.home_branch_id,
            users.doctor,
            randomUUID(),
            Buffer.alloc(32),
          ],
        );
        const { op } = await prepare(users.doctor);
        await rejected(() =>
          command('handover', users.otherDoctor, { operationId: op, handoverHash: 'a'.repeat(64) }),
        );
        await command('handover', users.doctor, { operationId: op, handoverHash: 'a'.repeat(64) });
        await rejected(() =>
          command('reset', users.doctor, {
            identityCheck: 'in_person_verified',
            operationId: randomUUID(),
          }),
        );
        await rejected(() => command('status', users.doctor));
      },
    );
    await scenario(
      'expired intake and removed branch membership deny Doctor provisioning',
      async () => {
        await db.query(
          "insert into clinic_private.patient_intakes(organization_id,patient_id,branch_id,created_by,request_id,fields_hash,created_at,expires_at) values($1,$2,$3,$4,$5,$6,now()-interval '2 days',now()-interval '1 day')",
          [
            row.organization_id,
            p,
            row.home_branch_id,
            users.doctor,
            randomUUID(),
            Buffer.alloc(32),
          ],
        );
        await rejected(() => command('begin', users.doctor, { operationId: randomUUID() }));
        await db.query(
          "update clinic_private.patient_intakes set expires_at=now()+interval '1 day'",
        );
        await db.query('update public.branch_memberships set active=false where user_id=$1', [
          users.doctor,
        ]);
        await rejected(() => command('begin', users.doctor, { operationId: randomUUID() }));
      },
    );
    await scenario(
      'incomplete external Auth operations stay quarantined; retries cannot supersede them',
      async () => {
        await command('begin', users.adminA, { operationId: randomUUID() });
        await db.exec(
          "update clinic_private.patient_accounts set operation_at=now()-interval '1 day'",
        );
        await rejected(() =>
          command('reset', users.adminA, {
            identityCheck: 'in_person_verified',
            operationId: randomUUID(),
          }),
        );
        await rejected(() => command('disable'));
        assert.equal(
          (await db.query<{ state: string }>('select state from clinic_private.patient_accounts'))
            .rows[0].state,
          'provisioning',
        );
      },
    );
    await scenario(
      'durable identifier and IP rate limiter rejects attempts beyond its window',
      async () => {
        for (let i = 0; i < 10; i++)
          await db.query('select public.patient_login_limit($1,$2)', [
            'a'.repeat(64),
            'b'.repeat(64),
          ]);
        await rejected(() =>
          db.query('select public.patient_login_limit($1,$2)', ['a'.repeat(64), 'c'.repeat(64)]),
        );
        await rejected(() =>
          db.query('select public.patient_login_limit($1,$2)', ['c'.repeat(64), 'b'.repeat(64)]),
        );
      },
    );
    await scenario(
      'first-change RLS denies actual SELECT; active session sees only its own clinical patient',
      async () => {
        const { op, a } = await prepare();
        const sid = randomUUID();
        await command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) });
        await db.query('insert into auth.sessions values($1,$2,clock_timestamp(),null)', [
          sid,
          a.userId,
        ]);
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ session_id: sid }),
        ]);
        const visible = () =>
          asUser(db, a.userId as string, () =>
            db.query<{ id: string }>('select id from public.patients'),
          );
        assert.equal((await visible()).rows.length, 0);
        await db.query("update auth.users set encrypted_password='new-private-hash' where id=$1", [
          a.userId,
        ]);
        await command('change-complete', a.userId as string, { sessionId: sid });
        assert.deepEqual(
          (await visible()).rows.map((r) => r.id),
          [p],
        );
        const profile = await asUser(db, a.userId as string, () =>
          db.query<{ r: Record<string, unknown> }>('select public.get_clinic_profile($1,$2,$3) r', [
            row.organization_id,
            'patient',
            p,
          ]),
        );
        assert.equal(profile.rows[0].r.loginEmail, null);
        await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [
          a.userId,
        ]);
        assert.equal((await visible()).rows.length, 0);
      },
    );
    await scenario(
      'expired temporary credentials cannot resolve for Patient ID login',
      async () => {
        const { op, a } = await prepare();
        await command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) });
        await db.exec(
          "update clinic_private.patient_accounts set temporary_expires_at=now()-interval '1 minute'",
        );
        assert.equal((await command('resolve', null, { code: a.patientCode })).rows[0].r, null);
        assert.equal((await command('self', a.userId as string)).rows[0].r.state, 'expired');
        assert.equal((await command('status')).rows[0].r.status, 'Pending Handover');
      },
    );
    await scenario('legacy verified-email patients retain ordinary RLS and metadata', async () => {
      await db.query('update public.patients set user_id=$1 where id=$2', [users.patient, p]);
      const r = await asUser(db, users.patient, () =>
        db.query<{ id: string }>('select id from public.patients'),
      );
      assert.deepEqual(
        r.rows.map((r) => r.id),
        [p],
      );
      const resolved = (await command('resolve', null, { code: 'SRO0001' })).rows[0].r;
      assert.equal(resolved.userId, users.patient);
    });
    await scenario(
      'anonymous Doctor Patient and foreign Admin cannot provision unrelated patients',
      async () => {
        for (const u of [null, users.doctor, users.patient, users.otherOrgAdmin])
          await rejected(() => command('begin', u, { operationId: randomUUID() }));
      },
    );
    await scenario(
      'unique clinical patient retains identity and repeated begin cannot overwrite',
      async () => {
        const original = (
          await db.query('select id,patient_code from public.patients where id=$1', [p])
        ).rows;
        await prepare();
        await rejected(() => command('begin', users.adminA, { operationId: randomUUID() }));
        assert.deepEqual(
          (await db.query('select id,patient_code from public.patients where id=$1', [p])).rows,
          original,
        );
      },
    );
    await scenario(
      'pending handover and first-change state cannot access clinical data',
      async () => {
        const { op, a } = await prepare();
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select clinic_private.patient_account_session($1) ok',
              [a.userId],
            )
          ).rows[0].ok,
          false,
        );
        await command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) });
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select clinic_private.patient_account_session($1) ok',
              [a.userId],
            )
          ).rows[0].ok,
          false,
        );
      },
    );
    await scenario(
      'wrong handover, stale operation and duplicate acknowledgement fail',
      async () => {
        const { op } = await prepare();
        await rejected(() =>
          command('handover', users.adminA, { operationId: op, handoverHash: 'b'.repeat(64) }),
        );
        await rejected(() =>
          command('handover', users.adminA, {
            operationId: randomUUID(),
            handoverHash: 'a'.repeat(64),
          }),
        );
        await command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) });
        await rejected(() =>
          command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) }),
        );
      },
    );
    await scenario('expired handover cannot be activated', async () => {
      const { op } = await prepare();
      await db.exec(
        "update clinic_private.patient_accounts set handover_expires_at=now()-interval '1 minute'",
      );
      await rejected(() =>
        command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) }),
      );
    });
    await scenario(
      'password change must be attested and session-bound; reset immediately invalidates old JWT session',
      async () => {
        const { op, a } = await prepare();
        await command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) });
        const sid = randomUUID();
        await db.query('insert into auth.sessions values($1,$2,clock_timestamp(),null)', [
          sid,
          a.userId,
        ]);
        await rejected(() => command('change-complete', a.userId as string, { sessionId: sid }));
        await db.query('update auth.users set encrypted_password=$1 where id=$2', [
          'new-private-hash',
          a.userId,
        ]);
        await command('change-complete', a.userId as string, { sessionId: sid });
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ session_id: sid }),
        ]);
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select clinic_private.patient_account_session($1) ok',
              [a.userId],
            )
          ).rows[0].ok,
          true,
        );
        await rejected(() =>
          command('reset', users.doctor, {
            operationId: randomUUID(),
            identityCheck: 'in_person_verified',
          }),
        );
        await db.exec(
          "update clinic_private.patient_accounts set operation_at=now()-interval '2 minutes'",
        );
        await rejected(() => command('reset', users.adminA, { operationId: randomUUID() }));
        await command('reset', users.adminA, {
          operationId: randomUUID(),
          identityCheck: 'in_person_verified',
        });
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select clinic_private.patient_account_session($1) ok',
              [a.userId],
            )
          ).rows[0].ok,
          false,
        );
      },
    );
    await scenario('private storage and service commands are not client callable', async () => {
      const r = await db.query<{ ok: boolean }>(
        "select not has_table_privilege('authenticated','clinic_private.patient_accounts','select') and not has_function_privilege('authenticated','public.patient_account_command(text,uuid,uuid,jsonb)','execute') ok",
      );
      assert.equal(r.rows[0].ok, true);
    });
    await scenario('disable and premature enable cannot bypass first password change', async () => {
      await prepare();
      await command('disable');
      await rejected(() => command('enable'));
    });
    await scenario(
      'Admin reset reissues only a new pending handover and preserves clinical identifiers',
      async () => {
        const { a } = await prepare();
        await db.exec(
          "update clinic_private.patient_accounts set operation_at=now()-interval '2 minutes'",
        );
        const op = randomUUID();
        const reset = (
          await command('reset', users.adminA, {
            operationId: op,
            identityCheck: 'in_person_verified',
          })
        ).rows[0].r;
        assert.equal(reset.userId, a.userId);
        assert.equal(reset.patientCode, a.patientCode);
        await db.query(
          "update auth.users set encrypted_password='replacement-provider-hash' where id=$1",
          [a.userId],
        );
        await command('commit', users.adminA, { operationId: op, handoverHash: 'b'.repeat(64) });
        await rejected(() =>
          command('handover', users.adminA, { operationId: op, handoverHash: 'a'.repeat(64) }),
        );
        await command('handover', users.adminA, { operationId: op, handoverHash: 'b'.repeat(64) });
        const sid = randomUUID();
        await db.query('insert into auth.sessions values($1,$2,clock_timestamp(),null)', [
          sid,
          a.userId,
        ]);
        await db.query(
          "update auth.users set encrypted_password='patient-chosen-replacement-hash' where id=$1",
          [a.userId],
        );
        await command('change-complete', a.userId as string, { sessionId: sid });
        await command('disable');
        await command('enable');
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ session_id: sid }),
        ]);
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select clinic_private.patient_account_session($1) ok',
              [a.userId],
            )
          ).rows[0].ok,
          false,
          'Enable requires a fresh login; an old JWT stays revoked',
        );
      },
    );
    await scenario(
      'unverified or multi-role linked identities are refused before reset',
      async () => {
        await db.query('update public.patients set user_id=$1 where id=$2', [users.patient, p]);
        await db.query('update auth.users set email_confirmed_at=null where id=$1', [
          users.patient,
        ]);
        await rejected(() =>
          command('reset', users.adminA, {
            operationId: randomUUID(),
            identityCheck: 'in_person_verified',
          }),
        );
        await db.query('update auth.users set email_confirmed_at=now() where id=$1', [
          users.patient,
        ]);
        await db.query("insert into public.role_assignments values($1,$2,'doctor')", [
          row.organization_id,
          users.patient,
        ]);
        await rejected(() =>
          command('reset', users.adminA, {
            operationId: randomUUID(),
            identityCheck: 'in_person_verified',
          }),
        );
        await rejected(() => command('disable'));
      },
    );
    await scenario(
      'out-of-scope Admin branch cannot provision or see account metadata',
      async () => {
        await db.query(
          'update public.branch_memberships set active=false where user_id=$1 and branch_id=$2',
          [users.adminA, row.home_branch_id],
        );
        await rejected(() => command('begin', users.adminA, { operationId: randomUUID() }));
        await rejected(() => command('status'));
      },
    );
    await patientOperationCases(t, db, p, users.adminA, users.doctor);
  } finally {
    await db.close();
  }
});
