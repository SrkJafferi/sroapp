import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, users, id, asUser } from './harness';

test('invitation management authorization, rotation and completion boundaries', async (t) => {
  const db = await createDatabase(true, (db) =>
    db.exec(
      `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz; create table auth.mfa_factors(user_id uuid,status text);`,
    ),
  );
  try {
    for (const f of [
      'phase2b/20261026111934_clinic_auth_onboarding.sql',
      'doctor-onboarding/20261027210515_clinic_doctor_onboarding_preview.sql',
      'single-email-onboarding/20261028103401_clinic_single_email_onboarding.sql',
      'invitation-management/20261028120915_clinic_invitation_management.sql',
    ])
      await db.exec(await readFile('supabase/proposals/' + f, 'utf8'));
    await db.exec("update auth.users set email=id::text||'@example.test',email_confirmed_at=now()");
    const old = Buffer.alloc(32, 12),
      fresh = Buffer.alloc(32, 13),
      request = randomUUID();
    const created = await db.query<{ i: { id: string } }>(
      'select public.phase2b_invite($1,$2,$3,$4,$5,$6) i',
      [users.adminA, id(2, 1), id(7, 1), 'Dr. Fictional', users.outsider + '@example.test', old],
    );
    const invitation = created.rows[0].i.id;
    await db.query('select public.phase2b_invitation_delivery($1,$2,true)', [
      users.adminA,
      invitation,
    ]);
    const manage = (
      action: string,
      actor = users.adminA,
      req: string | null = request,
      hash: Buffer | null = fresh,
    ) =>
      db.query('select public.manage_doctor_invitation($1,$2,$3,$4,$5,$6)', [
        actor,
        invitation,
        action,
        req,
        hash,
        action === 'sent' ? 'fictional-receipt' : null,
      ]);
    const preview = (hash: Buffer) =>
      db.query('select public.phase2b_invitation_preview($1,$2,$3)', [
        invitation,
        hash,
        users.outsider,
      ]);
    const denied = async (fn: () => Promise<unknown>) => {
      await db.exec('savepoint bad');
      try {
        await assert.rejects(fn());
      } finally {
        await db.exec('rollback to savepoint bad;release savepoint bad');
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
    await scenario(
      'rotation invalidates original and fresh proof remains unusable until provider ack',
      async () => {
        await manage('rotate');
        await denied(() => preview(old));
        await denied(() => preview(fresh));
        await manage('sent');
        await preview(fresh);
        await denied(() => preview(old));
      },
    );
    await scenario('repeat rotation, competing request and stale ack are rejected', async () => {
      await manage('rotate');
      await denied(() => manage('rotate'));
      await denied(() => manage('rotate', users.adminA, randomUUID()));
      await denied(() => manage('sent', users.adminA, randomUUID()));
      await denied(() => manage('sent', users.adminA, null));
      await denied(() =>
        db.query('select public.phase2b_invitation_delivery($1,$2,true)', [
          users.adminA,
          invitation,
        ]),
      );
    });
    await scenario(
      'Doctor Patient foreign Admin and other-branch Admin cannot manage',
      async () => {
        for (const u of [users.doctor, users.patient, users.otherOrgAdmin])
          await denied(() => manage('revoke', u));
        await denied(() =>
          db.query('select clinic_private.phase2b_admin($1,$2)', [users.adminA, id(2, 2)]),
        );
      },
    );
    await scenario('ordinary authenticated callers cannot invoke service command', async () => {
      await denied(() => asUser(db, users.adminA, () => manage('revoke')));
      await db.exec('set local role anon');
      await denied(() => manage('revoke'));
      await db.exec('reset role');
    });
    await scenario('revoke consumes proof and rejects already-open final completion', async () => {
      await db.query('select public.phase2b_onboarding($1,$2,$3,$4,$5,$6,$7)', [
        'stage',
        invitation,
        old,
        users.outsider,
        JSON.stringify({ name: 'Dr. Fictional', gender: 'Female' }),
        'aal1',
        'http://localhost:3100',
      ]);
      await manage('revoke');
      await denied(() => preview(old));
      await denied(() =>
        db.query('select public.phase2b_onboarding($1,$2,$3,$4,null,$5,$6)', [
          'complete',
          invitation,
          old,
          users.outsider,
          'aal1',
          'http://localhost:3100',
        ]),
      );
      await denied(() => manage('sent'));
    });
    await scenario('acceptance winning race blocks resend and revoke', async () => {
      await db.query('select public.phase2b_accept($1,$2,$3)', [users.outsider, invitation, old]);
      await denied(() => manage('rotate'));
      await denied(() => manage('revoke'));
    });
    await scenario(
      'failed delivery invalidates replacement and permits fresh controlled retry',
      async () => {
        await manage('rotate');
        await manage('failed');
        await denied(() => preview(fresh));
        await denied(() => manage('rotate'));
        await db.exec(
          "update clinic_private.invitation_dispatch set attempted_at=now()-interval '3 minutes'",
        );
        await manage('rotate', users.adminA, randomUUID(), Buffer.alloc(32, 14));
      },
    );
    await scenario('expired links fail and resend obtains fresh 24-hour expiry', async () => {
      await db.exec(
        "update public.doctor_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id='" +
          invitation +
          "'",
      );
      await denied(() => preview(old));
      await manage('rotate');
      await manage('sent');
      await preview(fresh);
      const r = await db.query<{ ok: boolean }>(
        "select expires_at>now()+interval '23 hours' and sent_at is not null ok from public.doctor_invitations where id=$1",
        [invitation],
      );
      assert.equal(r.rows[0].ok, true);
    });
    await scenario('private dispatch table grants and security definer search path', async () => {
      const r = await db.query<{ ok: boolean }>(
        "select not has_table_privilege('service_role','clinic_private.invitation_dispatch','SELECT') and not has_function_privilege('authenticated','public.manage_doctor_invitation(uuid,uuid,text,uuid,bytea,text)','EXECUTE') ok",
      );
      assert.equal(r.rows[0].ok, true);
    });
    await scenario(
      'fresh proof preserves full single-email completion, welcome and notification',
      async () => {
        await db.query('select public.phase2b_onboarding($1,$2,$3,$4,$5,$6,$7)', [
          'stage',
          invitation,
          old,
          users.outsider,
          JSON.stringify({ name: 'Dr. Fictional', gender: 'Female' }),
          'aal1',
          'http://localhost:3100',
        ]);
        await manage('rotate');
        await manage('sent');
        await denied(() =>
          db.query('select public.phase2b_onboarding($1,$2,$3,$4,null,$5,$6)', [
            'complete',
            invitation,
            old,
            users.outsider,
            'aal1',
            'http://localhost:3100',
          ]),
        );
        for (let n = 0; n < 2; n++)
          await db.query('select public.phase2b_onboarding($1,$2,$3,$4,null,$5,$6)', [
            'complete',
            invitation,
            fresh,
            users.outsider,
            'aal1',
            'http://localhost:3100',
          ]);
        const r = await db.query<{ n: number }>(
          'select count(*)::int n from clinic_private.doctor_onboarding where invitation_id=$1 and completed_at is not null and notification_id is not null and welcome_payload is not null',
          [invitation],
        );
        assert.equal(r.rows[0].n, 1);
        await denied(() => manage('revoke'));
      },
    );
    await scenario('current branch authority rechecked after revocation', async () => {
      await db.query(
        'update public.branch_memberships set active=false where user_id=$1 and branch_id=$2',
        [users.adminA, id(2, 1)],
      );
      await denied(() => manage('revoke'));
    });
  } finally {
    await db.close();
  }
});
