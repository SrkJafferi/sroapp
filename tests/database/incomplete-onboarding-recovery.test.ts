import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDatabase, users, id } from './harness';

const fields = { name: 'Dr. Fictional Recovered', gender: 'Female', experience: 4 };
const authName = 'Dr. Fictional Recovery';
const email = 'fictional.recovery@example.test';
const userId = id(3, 14);
const org = id(1, 1);
const branch = id(2, 1);
const specialization = id(7, 1);

test('incomplete onboarding recovery is proven-only and leaves every other action intact', async (t) => {
  const db = await createDatabase(true, (db) =>
    db.exec(`
    alter table auth.users add email text,
      add email_confirmed_at timestamptz, add banned_until timestamptz,
      add deleted_at timestamptz, add last_sign_in_at timestamptz,
      add confirmation_sent_at timestamptz,
      add created_at timestamptz not null default now(),
      add raw_user_meta_data jsonb not null default '{}';
    create table auth.identities (user_id uuid not null, provider text not null, primary key (user_id, provider));
    create table auth.mfa_factors (user_id uuid, status text);`),
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

    const scenario = async (name: string, fn: () => Promise<void>) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await fn();
        } finally {
          await db.exec('rollback');
        }
      });
    const count = async (sql: string, values: unknown[] = []) =>
      Number((await db.query<{ n: number }>(sql, values)).rows[0].n);
    const rejected = async (fn: () => Promise<unknown>) => {
      await db.exec('savepoint denied');
      try {
        await assert.rejects(fn());
      } finally {
        await db.exec('rollback to savepoint denied;release savepoint denied');
      }
    };
    type Fixture = {
      current: string;
      historical: string | null;
      proof: Buffer;
    };
    const fixture = async (
      opts: {
        historical?: boolean;
        historicalOrg?: string;
        historicalName?: string;
        historicalStatus?: string;
        historicalSent?: boolean;
        currentStatus?: string;
      } = {},
    ): Promise<Fixture> => {
      const current = randomUUID();
      const historical = randomUUID();
      const proof = randomBytes(32);
      await db.query(
        `insert into auth.users(id,email,created_at,confirmation_sent_at,raw_user_meta_data)
         values($1,$2,now()-interval '2 hours',now()-interval '2 hours',$3::jsonb)`,
        [userId, email, JSON.stringify({ demo_only: 'true', name: authName })],
      );
      await db.query('insert into auth.identities values($1,$2)', [userId, 'email']);
      let historicalId: string | null = null;
      if (opts.historical !== false) {
        historicalId = historical;
        const historicalOrg = opts.historicalOrg ?? org;
        await db.query(
          `insert into public.doctor_invitations
           (id,organization_id,branch_id,specialization_id,name,email,status,invited_by,expires_at,created_at,sent_at)
           values($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '21 hours',now()-interval '3 hours',$9)`,
          [
            historical,
            historicalOrg,
            historicalOrg === org ? branch : id(2, 3),
            historicalOrg === org ? specialization : id(7, 2),
            opts.historicalName ?? authName,
            email,
            opts.historicalStatus ?? 'revoked',
            historicalOrg === org ? users.adminA : users.otherOrgAdmin,
            opts.historicalSent === false ? null : new Date(Date.now() - 3 * 3600_000).toISOString(),
          ],
        );
        await db.query(
          'insert into clinic_private.invitation_secrets(invitation_id,token_hash) values($1,$2)',
          [historical, randomBytes(32)],
        );
      }
      await db.query(
        `insert into public.doctor_invitations
         (id,organization_id,branch_id,specialization_id,name,email,status,invited_by,expires_at,sent_at)
         values($1,$2,$3,$4,'Dr. Fictional Current',$5,$6,$7,now()+interval '24 hours',now())`,
        [current, org, branch, specialization, email, opts.currentStatus ?? 'sent', users.adminA],
      );
      await db.query(
        'insert into clinic_private.invitation_secrets(invitation_id,token_hash) values($1,$2)',
        [current, proof],
      );
      return { current, historical: historicalId, proof };
    };
    const prepare = (created: Fixture, proof = created.proof) =>
      db.query<{ r: { existingUserId: string | null; recoverable: boolean } }>(
        'select public.phase2b_onboarding($1,$2,$3) r',
        ['prepare', created.current, proof],
      );
    const provenance = async (
      created: Fixture,
      sql: string,
      values: unknown[],
      expected = false,
    ) => {
      await db.exec('savepoint provenance_variant');
      try {
        await db.query(sql, values);
        const result = (await prepare(created)).rows[0].r;
        assert.equal(result.recoverable, expected);
        assert.equal(result.existingUserId, userId);
      } finally {
        await db.exec(
          'rollback to savepoint provenance_variant;release savepoint provenance_variant',
        );
      }
    };

    await scenario('post-deployment ACL assertions validate the replacement', async () => {
      await db.exec(
        await readFile(
          'supabase/proposals/incomplete-onboarding-recovery/post-deployment.sql',
          'utf8',
        ),
      );
    });

    await scenario('eligible legacy identity is reported recoverable with no mutation', async () => {
      const created = await fixture();
      const before = await count('select count(*) n from public.audit_logs');
      const result = (await prepare(created)).rows[0].r;
      assert.equal(result.existingUserId, userId);
      assert.equal(result.recoverable, true);
      assert.equal(await count('select count(*) n from public.profiles where id=$1', [userId]), 0);
      assert.equal(await count('select count(*) n from public.doctors where user_id=$1', [userId]), 0);
      assert.equal(
        await count('select count(*) n from public.role_assignments where user_id=$1', [userId]),
        0,
      );
      assert.equal(
        await count('select count(*) n from clinic_private.doctor_onboarding where user_id=$1', [
          userId,
        ]),
        0,
      );
      assert.equal(await count('select count(*) n from public.audit_logs'), before);
      assert.equal(
        (
          await db.query<{ status: string }>(
            'select status from public.doctor_invitations where id=$1',
            [created.current],
          )
        ).rows[0].status,
        'sent',
      );
      assert.equal(
        await count(
          'select count(*) n from clinic_private.invitation_secrets where invitation_id=$1 and consumed_at is null',
          [created.current],
        ),
        1,
      );
    });

    await scenario('verified, signed-in, unmarked and banned identities deny', async () => {
      const created = await fixture();
      for (const [sql, values] of [
        ['update auth.users set email_confirmed_at=now() where id=$1', [userId]],
        ['update auth.users set last_sign_in_at=now() where id=$1', [userId]],
        ['update auth.users set confirmation_sent_at=null where id=$1', [userId]],
        ["update auth.users set banned_until=now()+interval '1 day' where id=$1", [userId]],
        ["update auth.users set raw_user_meta_data='{}'::jsonb where id=$1", [userId]],
        [
          "update auth.users set raw_user_meta_data=jsonb_build_object('demo_only','false','name',$2::text) where id=$1",
          [userId, authName],
        ],
        [
          "update auth.users set raw_user_meta_data=jsonb_build_object('demo_only','true','name',' ') where id=$1",
          [userId],
        ],
      ] as [string, unknown[]][])
        await provenance(created, sql, values);
      await db.exec('savepoint deleted_identity');
      try {
        await db.query('update auth.users set deleted_at=now() where id=$1', [userId]);
        const result = (await prepare(created)).rows[0].r;
        assert.equal(result.existingUserId, null);
        assert.equal(result.recoverable, false);
      } finally {
        await db.exec('rollback to savepoint deleted_identity;release savepoint deleted_identity');
      }
    });

    await scenario('identity must be the sole unconfirmed email identity', async () => {
      const created = await fixture();
      await provenance(created, 'delete from auth.identities where user_id=$1', [userId]);
      await provenance(created, "insert into auth.identities values($1,'google')", [userId]);
      await provenance(
        created,
        `insert into auth.users(id,email,created_at,confirmation_sent_at,raw_user_meta_data)
         values($1,$2,now(),now(),$3::jsonb)`,
        [id(3, 15), email, JSON.stringify({ demo_only: 'true', name: authName })],
      );
    });

    await scenario('any clinic access or verified MFA denies recovery', async () => {
      const created = await fixture();
      await provenance(created, 'insert into public.profiles(id,name,email) values($1,$2,$3)', [
        userId,
        authName,
        email,
      ]);
      for (const grants of [
        `insert into public.organization_memberships(organization_id,user_id) values('${org}','${userId}');
         insert into public.role_assignments(organization_id,user_id,role) values('${org}','${userId}','doctor')`,
        `insert into public.organization_memberships(organization_id,user_id) values('${org}','${userId}');
         insert into public.branch_memberships(organization_id,branch_id,user_id) values('${org}','${branch}','${userId}')`,
        `insert into public.organization_memberships(organization_id,user_id) values('${org}','${userId}');
         insert into public.doctors(organization_id,user_id,specialization_id,name) values('${org}','${userId}','${specialization}','${authName}')`,
      ]) {
        await db.exec('savepoint access_grant');
        try {
          await db.query('insert into public.profiles(id,name,email) values($1,$2,$3)', [
            userId,
            authName,
            email,
          ]);
          await db.exec(grants);
          assert.equal((await prepare(created)).rows[0].r.recoverable, false);
        } finally {
          await db.exec('rollback to savepoint access_grant;release savepoint access_grant');
        }
      }
      await provenance(created, "insert into auth.mfa_factors values($1,'verified')", [userId]);
      await provenance(created, "insert into auth.mfa_factors values($1,'unverified')", [userId], true);
    });

    await scenario('historical invitation must prove delivery, window, name and organization', async () => {
      const created = await fixture();
      assert.ok(created.historical);
      const historical = created.historical;
      for (const [sql, values] of [
        ['update public.doctor_invitations set sent_at=null where id=$1', [historical]],
        [
          'update public.doctor_invitations set name=$2 where id=$1',
          [historical, 'Dr. Fictional Other'],
        ],
        [
          "update public.doctor_invitations set status='accepted',accepted_user_id=$2 where id=$1",
          [historical, users.adminA],
        ],
        ['delete from clinic_private.invitation_secrets where invitation_id=$1', [historical]],
        [
          "update clinic_private.invitation_secrets set consumed_at=now()-interval '3 hours' where invitation_id=$1",
          [historical],
        ],
        ["update auth.users set created_at=now()-interval '4 hours' where id=$1", [userId]],
        ["update auth.users set created_at=now()+interval '22 hours' where id=$1", [userId]],
      ] as [string, unknown[]][])
        await provenance(created, sql, values);
      await provenance(
        created,
        "update clinic_private.invitation_secrets set consumed_at=now()-interval '1 hour' where invitation_id=$1",
        [historical],
        true,
      );
    });
    for (const [label, opts] of [
      ['no historical invitation denies recovery', { historical: false }],
      ['historical invitation in another organization denies recovery', { historicalOrg: id(1, 2) }],
      ['historical invitation with another name denies recovery', { historicalName: 'Dr. Fictional Other' }],
      ['historical invitation never delivered denies recovery', { historicalSent: false }],
    ] as [string, Parameters<typeof fixture>[0]][])
      await scenario(label, async () => {
        const created = await fixture(opts);
        const result = (await prepare(created)).rows[0].r;
        assert.equal(result.existingUserId, userId);
        assert.equal(result.recoverable, false);
      });

    await scenario('current invitation proof, status and expiry remain authoritative', async () => {
      const created = await fixture();
      await rejected(() => prepare(created, randomBytes(32)));
      await db.exec('savepoint proof_variants');
      try {
        await db.query(
          "update clinic_private.invitation_secrets set token_hash=$2 where invitation_id=$1",
          [created.current, randomBytes(32)],
        );
        await rejected(() => prepare(created));
        const rotated = (
          await db.query<{ token_hash: Uint8Array }>(
            'select token_hash from clinic_private.invitation_secrets where invitation_id=$1',
            [created.current],
          )
        ).rows[0].token_hash;
        assert.equal((await prepare(created, Buffer.from(rotated))).rows[0].r.recoverable, true);
      } finally {
        await db.exec('rollback to savepoint proof_variants;release savepoint proof_variants');
      }
      for (const [sql, values] of [
        ["update public.doctor_invitations set status='revoked' where id=$1", [created.current]],
        ["update public.doctor_invitations set status='draft' where id=$1", [created.current]],
        [
          "update public.doctor_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
          [created.current],
        ],
        ['delete from clinic_private.invitation_secrets where invitation_id=$1', [created.current]],
      ] as [string, unknown[]][]) {
        await db.exec('savepoint current_invitation');
        try {
          await db.query(sql, values);
          await rejected(() => prepare(created));
        } finally {
          await db.exec('rollback to savepoint current_invitation;release savepoint current_invitation');
        }
      }
      await rejected(() =>
        db.query('select public.phase2b_onboarding($1,$2,null)', ['prepare', created.current]),
      );
    });

    await scenario('a proven recovered identity can stage and complete exactly once', async () => {
      const created = await fixture();
      assert.equal((await prepare(created)).rows[0].r.recoverable, true);
      // Server route performs this GoTrue admin confirmation only after re-proving eligibility.
      await db.query('update auth.users set email_confirmed_at=now() where id=$1', [userId]);
      await db.query('select public.phase2b_onboarding($1,$2,$3,$4,$5)', [
        'stage',
        created.current,
        created.proof,
        userId,
        JSON.stringify(fields),
      ]);
      const first = (
        await db.query<{ r: { doctorId: string; completed: boolean } }>(
          'select public.phase2b_onboarding($1,$2,$3,$4,$5,$6,$7) r',
          [
            'complete',
            created.current,
            created.proof,
            userId,
            null,
            'aal1',
            'http://localhost:3100',
          ],
        )
      ).rows[0].r;
      const second = (
        await db.query<{ r: { doctorId: string } }>(
          'select public.phase2b_onboarding($1,$2,$3,$4,$5,$6,$7) r',
          [
            'complete',
            created.current,
            created.proof,
            userId,
            null,
            'aal1',
            'http://localhost:3100',
          ],
        )
      ).rows[0].r;
      assert.equal(second.doctorId, first.doctorId);
      assert.equal(await count('select count(*) n from public.doctors where user_id=$1', [userId]), 1);
      assert.equal(await count('select count(*) n from public.role_assignments where user_id=$1', [userId]), 1);
      assert.equal(await count('select count(*) n from public.profiles where id=$1', [userId]), 1);
      assert.equal(
        await count('select count(*) n from clinic_private.doctor_onboarding where invitation_id=$1', [
          created.current,
        ]),
        1,
      );
      assert.equal(
        await count('select count(*) n from public.notifications where doctor_id=$1', [
          first.doctorId,
        ]),
        1,
      );
      assert.equal(
        (
          await db.query<{ welcome_status: string }>(
            'select welcome_status from clinic_private.doctor_onboarding where invitation_id=$1',
            [created.current],
          )
        ).rows[0].welcome_status,
        'pending',
      );
      await rejected(() => prepare(created));
    });
  } finally {
    await db.close();
  }
});
