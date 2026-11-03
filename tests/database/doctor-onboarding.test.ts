import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, id, users, asUser } from './harness';
test('service-only invitation preview and verified one-time acceptance', async (t) => {
  const db = await createDatabase(true, (db) =>
    db.exec(
      'alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);',
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
      "update auth.users set email=id::text||'@example.test',email_confirmed_at=now();",
    );
    await db.exec(
      await readFile(
        'supabase/proposals/doctor-onboarding/20261027210515_clinic_doctor_onboarding_preview.sql',
        'utf8',
      ),
    );
    const hash = Buffer.alloc(32, 11),
      email = users.outsider + '@example.test';
    const created = await db.query<{ i: { id: string } }>(
      'select public.phase2b_invite($1,$2,$3,$4,$5,$6) i',
      [users.adminA, id(2, 1), id(7, 1), 'Fictional New Doctor', email, hash],
    );
    const invitation = created.rows[0].i.id;
    await db.query('select public.phase2b_invitation_delivery($1,$2,true)', [
      users.adminA,
      invitation,
    ]);
    const preview = () =>
      db.query<{
        p: { email: string; branchId: string; specializationId: string; accepted: boolean };
      }>('select public.phase2b_invitation_preview($1,$2,$3) p', [invitation, hash, null]);
    await t.test('valid token returns only the Admin-assigned invitation metadata', async () => {
      const r = (await preview()).rows[0].p;
      assert.equal(r.email, email);
      assert.equal(r.branchId, id(2, 1));
      assert.equal(r.specializationId, id(7, 1));
      assert.equal(r.accepted, false);
    });
    await t.test('invalid hash, expired and revoked invitations rejected', async () => {
      for (const sql of [
        "update public.doctor_invitations set status='revoked' where id=$1",
        "update public.doctor_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
      ]) {
        await db.exec('begin');
        try {
          await db.query(sql, [invitation]);
          await assert.rejects(preview());
        } finally {
          await db.exec('rollback');
        }
      }
      await assert.rejects(
        db.query('select public.phase2b_invitation_preview($1,$2)', [
          invitation,
          Buffer.alloc(32, 12),
        ]),
      );
    });
    await t.test(
      'anonymous and authenticated callers cannot execute preview or inspect secrets',
      async () => {
        await db.exec('begin');
        try {
          for (const [u, role] of [
            [null, 'anon'],
            [users.patient, 'authenticated'],
          ] as const)
            await assert.rejects(asUser(db, u, () => preview(), role));
        } finally {
          await db.exec('rollback');
        }
        const r = await db.query<{ ok: boolean }>(
          "select has_function_privilege('service_role','public.phase2b_invitation_preview(uuid,bytea,uuid)','EXECUTE') and not has_table_privilege('authenticated','clinic_private.invitation_secrets','SELECT') ok",
        );
        assert.equal(r.rows[0].ok, true);
      },
    );
    await t.test('unverified and mismatched identities cannot activate', async () => {
      await db.exec('begin');
      try {
        await db.query('update auth.users set email_confirmed_at=null where id=$1', [
          users.outsider,
        ]);
        await assert.rejects(
          db.query('select public.phase2b_accept($1,$2,$3)', [users.outsider, invitation, hash]),
        );
      } finally {
        await db.exec('rollback');
      }
      await assert.rejects(
        db.query('select public.phase2b_accept($1,$2,$3)', [users.patient, invitation, hash]),
      );
    });
    await t.test(
      'verified activation consumes token; only same verified identity may resume',
      async () => {
        await db.query('select public.phase2b_accept($1,$2,$3)', [
          users.outsider,
          invitation,
          hash,
        ]);
        await assert.rejects(preview());
        await assert.rejects(
          db.query('select public.phase2b_accept($1,$2,$3)', [users.outsider, invitation, hash]),
        );
        const resumed = await db.query<{ p: { accepted: boolean; doctorId: string } }>(
          'select public.phase2b_invitation_preview($1,$2,$3) p',
          [invitation, hash, users.outsider],
        );
        assert.equal(resumed.rows[0].p.accepted, true);
        assert.ok(resumed.rows[0].p.doctorId);
        await assert.rejects(
          db.query('select public.phase2b_invitation_preview($1,$2,$3)', [
            invitation,
            hash,
            users.patient,
          ]),
        );
        assert.equal(
          (await db.query('select id from public.doctors where user_id=$1', [users.outsider])).rows
            .length,
          1,
        );
      },
    );
  } finally {
    await db.close();
  }
});

