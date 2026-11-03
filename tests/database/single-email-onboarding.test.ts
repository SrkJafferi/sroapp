import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, users, id, asUser } from './harness';

test('single-email staged onboarding, final authorization and delivery outbox', async (t) => {
  const db = await createDatabase(true, (db) =>
    db.exec(`
    alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz,
      add last_sign_in_at timestamptz,add confirmation_sent_at timestamptz,
      add created_at timestamptz not null default now(),add raw_user_meta_data jsonb not null default '{}';
    create table auth.identities(user_id uuid not null,provider text not null,primary key(user_id,provider));
    create table auth.mfa_factors(user_id uuid,status text);`),
  );
  try {
    for (const file of [
      'phase2b/20261026111934_clinic_auth_onboarding.sql',
      'doctor-onboarding/20261027210515_clinic_doctor_onboarding_preview.sql',
      'single-email-onboarding/20261028103401_clinic_single_email_onboarding.sql',
      'invitation-management/20261028120915_clinic_invitation_management.sql',
      'incomplete-onboarding-recovery/20261028131406_clinic_incomplete_onboarding_recovery.sql',
    ])
      await db.exec(await readFile('supabase/proposals/' + file, 'utf8'));
    await db.exec("update auth.users set email=id::text||'@example.test',email_confirmed_at=now()");
    const hash = Buffer.alloc(32, 18),
      details = { name: 'Dr. Fictional New', gender: 'Female', experience: 6 };
    const created = await db.query<{ i: { id: string } }>(
      'select public.phase2b_invite($1,$2,$3,$4,$5,$6) i',
      [users.adminA, id(2, 1), id(7, 1), details.name, users.outsider + '@example.test', hash],
    );
    const invitation = created.rows[0].i.id;
    await db.query('select public.phase2b_invitation_delivery($1,$2,true)', [
      users.adminA,
      invitation,
    ]);
    const call = (
      action: string,
      user: string | null = users.outsider,
      fields: unknown = details,
      aal = 'aal1',
      proof = hash,
      origin = 'http://localhost:3100',
    ) =>
      db.query<{ r: Record<string, unknown> }>(
        'select public.phase2b_onboarding($1,$2,$3,$4,$5,$6,$7) r',
        [action, invitation, proof, user, JSON.stringify(fields), aal, origin],
      );
    const delivery = (
      action = 'claim',
      lease: string | null = null,
      message: string | null = null,
    ) =>
      db.query<{ r: { lease: string; payload: Record<string, string> } | null }>(
        'select public.phase2b_welcome_delivery($1,$2,$3,$4) r',
        [invitation, action, lease, message],
      );
    const count = async (table: string, column: string, value: string) =>
      Number(
        (
          await db.query<{ n: number }>(`select count(*) n from ${table} where ${column}=$1`, [
            value,
          ])
        ).rows[0].n,
      );
    const rejected = async (fn: () => Promise<unknown>) => {
      await db.exec('savepoint denied');
      try {
        await assert.rejects(fn());
      } finally {
        await db.exec('rollback to savepoint denied;release savepoint denied');
      }
    };
    const scenario = async (name: string, fn: () => Promise<void>) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await fn();
        } finally {
          await db.exec('rollback');
        }
      });
    const completed = async (aal = 'aal1') => {
      await call('stage');
      return (await call('complete', users.outsider, null, aal)).rows[0].r;
    };
    await scenario(
      'post-deployment assertions validate the local candidate ACL and schema',
      async () => {
        await db.exec(
          await readFile('supabase/proposals/single-email-onboarding/post-deployment.sql', 'utf8'),
        );
      },
    );
    await scenario(
      'prepare finds only the exact invited Auth identity and never grants a role',
      async () => {
        const prepared = (await call('prepare', null)).rows[0].r;
        assert.equal(prepared.existingUserId, users.outsider);
        assert.equal(prepared.recoverable, false);
        assert.equal(await count('public.role_assignments', 'user_id', users.outsider), 0);
        assert.equal(
          await count('clinic_private.doctor_onboarding', 'invitation_id', invitation),
          0,
        );
        await db.query('update public.doctor_invitations set email=$2 where id=$1', [
          invitation,
          'brand-new@example.test',
        ]);
        assert.equal((await call('prepare', null)).rows[0].r.existingUserId, null);
      },
    );
    await scenario(
      'registration stages profile without Doctor, branch, notification or welcome activation',
      async () => {
        await call('stage');
        await call('stage');
        assert.equal(
          await count('clinic_private.doctor_onboarding', 'invitation_id', invitation),
          1,
        );
        assert.equal(await count('public.doctors', 'user_id', users.outsider), 0);
        assert.equal(await count('public.role_assignments', 'user_id', users.outsider), 0);
        assert.equal(await count('public.branch_memberships', 'user_id', users.outsider), 0);
        await rejected(() => delivery());
        const p = await db.query<{ p: { profileReady: boolean; accepted: boolean } }>(
          'select public.phase2b_invitation_preview($1,$2,$3) p',
          [invitation, hash, users.outsider],
        );
        assert.equal(p.rows[0].p.profileReady, true);
        assert.equal(p.rows[0].p.accepted, false);
      },
    );
    await scenario(
      'unknown authority, blank/coerced/invalid experience and malformed fields denied',
      async () => {
        for (const fields of [
          { ...details, role: 'admin' },
          { ...details, branchId: id(2, 2) },
          { ...details, experience: '' },
          { ...details, experience: 81 },
          { ...details, experience: -1 },
          { ...details, experience: 1.5 },
          { ...details, name: null },
          null,
        ])
          await rejected(() => call('stage', users.outsider, fields));
        await call('stage', users.outsider, { name: details.name, gender: details.gender });
      },
    );
    await scenario('unverified, disabled, banned and mismatched identities denied', async () => {
      await rejected(() => call('stage', users.patient));
      await db.query('update auth.users set email_confirmed_at=null where id=$1', [users.outsider]);
      await rejected(() => call('stage'));
      await db.query(
        "update auth.users set email_confirmed_at=now(),banned_until=now()+interval '1 day' where id=$1",
        [users.outsider],
      );
      await rejected(() => call('stage'));
      await db.query('update auth.users set banned_until=null where id=$1', [users.outsider]);
      await db.query('update public.profiles set active=false where id=$1', [users.outsider]);
      await rejected(() => call('stage'));
    });
    await scenario('revoked, expired, invalid and null proofs denied', async () => {
      await rejected(() => call('prepare', null, null, 'aal1', Buffer.alloc(32, 19)));
      await rejected(() =>
        db.query('select public.phase2b_onboarding($1,$2,null)', ['prepare', invitation]),
      );
      await db.query("update public.doctor_invitations set status='revoked' where id=$1", [
        invitation,
      ]);
      await rejected(() => call('stage'));
      await db.query(
        "update public.doctor_invitations set status='sent',created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
        [invitation],
      );
      await rejected(() => call('stage'));
    });
    await scenario(
      'inviter revocation and inactive branches block staged finalization',
      async () => {
        await call('stage');
        await db.query(
          'update public.branch_memberships set active=false where user_id=$1 and branch_id=$2',
          [users.adminA, id(2, 1)],
        );
        await rejected(() => call('complete'));
        await db.query(
          'update public.branch_memberships set active=true where user_id=$1 and branch_id=$2',
          [users.adminA, id(2, 1)],
        );
        await db.query('update public.branches set active=false where id=$1', [id(2, 1)]);
        await rejected(() => call('complete'));
        assert.equal(await count('public.doctors', 'user_id', users.outsider), 0);
      },
    );
    await scenario(
      'unsaved registration and invalid server origin cannot grant access',
      async () => {
        await rejected(() => call('complete'));
        await call('stage');
        await rejected(() =>
          call('complete', users.outsider, null, 'aal1', hash, 'javascript:invalid'),
        );
        assert.equal(await count('public.doctors', 'user_id', users.outsider), 0);
      },
    );
    await scenario(
      'allowed Skip completes exactly once with one Doctor, role, notification and event',
      async () => {
        const first = await completed(),
          second = (await call('complete')).rows[0].r;
        assert.equal(first.doctorId, second.doctorId);
        assert.equal(await count('public.doctors', 'user_id', users.outsider), 1);
        assert.equal(await count('public.role_assignments', 'user_id', users.outsider), 1);
        assert.equal(await count('public.notifications', 'doctor_id', String(first.doctorId)), 1);
        const row = (
          await db.query<{ fields: unknown; welcome_status: string; completed_at: string }>(
            'select fields,welcome_status,completed_at from clinic_private.doctor_onboarding where invitation_id=$1',
            [invitation],
          )
        ).rows[0];
        assert.deepEqual(row.fields, details);
        assert.equal(row.welcome_status, 'pending');
        assert.ok(row.completed_at);
        await rejected(() => call('stage', users.patient));
        await rejected(() => call('prepare', null));
      },
    );
    await scenario('enrolled TOTP cannot Skip at AAL1; AAL2 completes', async () => {
      await call('stage');
      await db.query("insert into auth.mfa_factors values($1,'verified')", [users.outsider]);
      await rejected(() => call('complete'));
      assert.equal(await count('public.role_assignments', 'user_id', users.outsider), 0);
      assert.equal(
        (await call('complete', users.outsider, null, 'aal2')).rows[0].r.completed,
        true,
      );
      await rejected(() => call('close'));
      await call('close', users.outsider, null, 'aal2');
    });
    await scenario('pending unverified factor does not become enabled through Skip', async () => {
      await db.query("insert into auth.mfa_factors values($1,'unverified')", [users.outsider]);
      await completed();
      assert.equal(
        Number(
          (
            await db.query<{ n: number }>(
              "select count(*) n from auth.mfa_factors where user_id=$1 and status='verified'",
              [users.outsider],
            )
          ).rows[0].n,
        ),
        0,
      );
    });
    await scenario('notifications reach only authorized organization/branch Admins', async () => {
      const result = await completed();
      const recipients = (
        await db.query<{ user_id: string }>(
          'select user_id from public.notification_recipients where notification_id=(select notification_id from clinic_private.doctor_onboarding where invitation_id=$1)',
          [invitation],
        )
      ).rows
        .map((r) => r.user_id)
        .sort();
      assert.deepEqual(recipients, [users.adminA, users.adminAll].sort());
      for (const user of [users.patient, users.doctor, users.otherOrgAdmin, users.outsider])
        assert.equal(
          await asUser(db, user, () =>
            count('public.notifications', 'doctor_id', String(result.doctorId)),
          ),
          0,
        );
      assert.equal(
        await asUser(db, users.adminA, () =>
          count('public.notifications', 'doctor_id', String(result.doctorId)),
        ),
        1,
      );
    });
    await scenario(
      'notification access follows revoked Admin branch permissions; read state remains supported',
      async () => {
        const result = await completed();
        await asUser(db, users.adminA, () =>
          db.query(
            'update public.notification_recipients set read_at=now() where notification_id=(select id from public.notifications where doctor_id=$1)',
            [result.doctorId],
          ),
        );
        await db.query(
          'update public.branch_memberships set active=false where user_id=$1 and branch_id=$2',
          [users.adminA, id(2, 1)],
        );
        await db.query('insert into public.branch_memberships values($1,$2,$3,true)', [
          id(1, 1),
          id(2, 2),
          users.adminA,
        ]);
        await db.query(
          'insert into public.doctor_branch_assignments(organization_id,doctor_id,branch_id) values($1,$2,$3)',
          [id(1, 1), result.doctorId, id(2, 2)],
        );
        assert.equal(
          await asUser(db, users.adminA, () =>
            count('public.notifications', 'doctor_id', String(result.doctorId)),
          ),
          0,
        );
        assert.equal(
          await asUser(db, users.adminAll, () =>
            count('public.notifications', 'doctor_id', String(result.doctorId)),
          ),
          1,
        );
      },
    );
    await scenario(
      'delivery uses one leased immutable event; another claim is denied while leased',
      async () => {
        await completed();
        const first = (await delivery()).rows[0].r!;
        assert.equal(first.payload.name, details.name);
        assert.equal(first.payload.dashboardUrl, 'http://localhost:3100/doctor');
        assert.equal((await delivery()).rows[0].r, null);
        await rejected(() => delivery('sent', randomUUID(), 'fictional-receipt'));
        await delivery('sent', first.lease, 'fictional-receipt');
        assert.equal((await delivery()).rows[0].r, null);
      },
    );
    await scenario(
      'temporary/ambiguous delivery failure preserves completion and safe stable retry',
      async () => {
        const doctor = (await completed()).doctorId;
        const first = (await delivery()).rows[0].r!;
        await delivery('failed', first.lease);
        const next = (await delivery()).rows[0].r!;
        assert.notEqual(next.lease, first.lease);
        assert.deepEqual(next.payload, first.payload);
        await db.query(
          "update clinic_private.doctor_onboarding set lease_until=now()-interval '1 minute' where invitation_id=$1",
          [invitation],
        );
        assert.ok((await delivery()).rows[0].r);
        assert.equal(await count('public.doctors', 'id', String(doctor)), 1);
      },
    );
    await scenario(
      'disabled/revoked accounts and changed Auth email suspend queued welcome delivery',
      async () => {
        await completed();
        for (const sql of [
          'update public.profiles set active=false where id=$1',
          "update auth.users set email='changed@example.test' where id=$1",
          "delete from public.role_assignments where user_id=$1 and role='doctor'",
          'update public.branch_memberships set active=false where user_id=$1',
        ]) {
          await db.exec('savepoint delivery_account');
          try {
            await db.query(sql, [users.outsider]);
            assert.equal((await delivery()).rows[0].r, null);
            assert.equal(
              (
                await db.query<{ welcome_status: string }>(
                  'select welcome_status from clinic_private.doctor_onboarding where invitation_id=$1',
                  [invitation],
                )
              ).rows[0].welcome_status,
              'review',
            );
          } finally {
            await db.exec(
              'rollback to savepoint delivery_account;release savepoint delivery_account',
            );
          }
        }
      },
    );
    await scenario(
      'ambiguous sends past provider idempotency retention stop for review',
      async () => {
        await completed();
        await delivery();
        await db.query(
          "update clinic_private.doctor_onboarding set first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 hour' where invitation_id=$1",
          [invitation],
        );
        assert.equal((await delivery()).rows[0].r, null);
        assert.equal(
          (
            await db.query<{ welcome_status: string }>(
              'select welcome_status from clinic_private.doctor_onboarding where invitation_id=$1',
              [invitation],
            )
          ).rows[0].welcome_status,
          'review',
        );
      },
    );
    await scenario(
      'close invalidates the used bearer; lost-response recovery is verified identity-only',
      async () => {
        await completed();
        await call('close');
        await rejected(() => call('prepare', null));
        await rejected(() => call('stage'));
        assert.equal((await call('receipt')).rows[0].r.closed, true);
        await rejected(() => call('receipt', users.patient));
        await rejected(() => call('receipt', null));
      },
    );
    await scenario(
      'historical accepted accounts resume without retroactive emails or notifications',
      async () => {
        await db.query('select public.phase2b_accept($1,$2,$3)', [
          users.outsider,
          invitation,
          hash,
        ]);
        assert.equal((await call('complete')).rows[0].r.legacy, true);
        assert.equal((await delivery()).rows[0].r, null);
        assert.equal(
          await count('clinic_private.doctor_onboarding', 'invitation_id', invitation),
          0,
        );
      },
    );
    await scenario(
      'browser roles cannot execute privileged commands or read the private outbox',
      async () => {
        for (const [user, role] of [
          [users.patient, 'authenticated'],
          [null, 'anon'],
        ] as const) {
          await assert.rejects(asUser(db, user, () => call('stage'), role));
          await assert.rejects(asUser(db, user, () => delivery(), role));
          await assert.rejects(
            asUser(
              db,
              user,
              () => db.query('select * from clinic_private.doctor_onboarding'),
              role,
            ),
          );
          await assert.rejects(
            asUser(
              db,
              user,
              () =>
                db.query('select public.phase2b_accept($1,$2,$3)', [
                  users.outsider,
                  invitation,
                  hash,
                ]),
              role,
            ),
          );
        }
        const checks = await db.query<{ r: boolean }>(
          `select has_function_privilege('service_role','public.phase2b_onboarding(text,uuid,bytea,uuid,jsonb,text,text)','EXECUTE') and not has_table_privilege('service_role','clinic_private.doctor_onboarding','SELECT') r`,
        );
        assert.equal(checks.rows[0].r, true);
      },
    );
  } finally {
    await db.close();
  }
});
