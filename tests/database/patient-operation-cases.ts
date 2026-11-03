import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import type { TestContext } from 'node:test';
import { asUser } from './harness';
export async function patientOperationCases(
  t: TestContext,
  db: PGlite,
  p: string,
  admin: string,
  doctor: string,
) {
  await db.exec(
    await readFile(
      'supabase/proposals/patient-account-coordination/20261030065902_clinic_patient_account_coordination.sql',
      'utf8',
    ),
  );
  await db.exec(await readFile('scripts/patient-account-coordination-postchecks.sql', 'utf8'));
  const row = (
    await db.query<{ organization_id: string; home_branch_id: string }>(
      'select * from public.patients where id=$1',
      [p],
    )
  ).rows[0];
  const scenario = (name: string, fn: () => Promise<void>) =>
    t.test(name, async () => {
      await db.exec('begin');
      try {
        await fn();
      } finally {
        await db.exec('rollback');
      }
    });
  const rejected = async (fn: () => Promise<unknown>) => {
    await db.exec('savepoint denied');
    try {
      await assert.rejects(fn());
    } finally {
      await db.exec('rollback to savepoint denied;release savepoint denied');
    }
  };
  function capability(actor = admin, purpose = 'provision', sid?: string) {
    return {
      actor,
      purpose,
      sid,
      op: randomUUID(),
      worker: randomUUID(),
      proof: 'a'.repeat(43),
      request: randomUUID(),
      fence: '',
    };
  }
  type Cap = ReturnType<typeof capability>;
  const rpc = async (c: Cap, action: string, data: Record<string, unknown> = {}) =>
    (
      await db.query<{ r: Record<string, unknown> }>(
        'select public.patient_account_operation($1,$2,$3,$4,$5,$6,$7) r',
        [
          action,
          c.actor,
          p,
          c.op,
          c.worker,
          c.proof,
          JSON.stringify({
            purpose: c.purpose,
            sessionId: c.sid,
            requestId: c.request,
            fence: c.fence,
            ...data,
          }),
        ],
      )
    ).rows[0].r;
  const command = async (c: Cap, action: string, data: Record<string, unknown> = {}) =>
    (
      await db.query<{ r: Record<string, unknown> }>(
        'select public.patient_account_command($1,$2,$3,$4) r',
        [
          action,
          c.actor,
          p,
          JSON.stringify({
            operationId: c.op,
            workerId: c.worker,
            proof: c.proof,
            fence: c.fence,
            ...data,
          }),
        ],
      )
    ).rows[0].r;
  const claim = async (c: Cap) => {
    const r = await rpc(c, 'claim');
    c.fence = String(r.fence);
    return c;
  };
  const prepare = async () => {
    const c = await claim(capability());
    const a = await command(c, 'begin');
    await rpc(c, 'start');
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,clock_timestamp(),$3)',
      [a.userId, a.internalEmail, 'SYNTHETIC-INITIAL-HASH'],
    );
    await rpc(c, 'confirm');
    await command(c, 'commit', { handoverHash: 'b'.repeat(64) });
    return { c, a };
  };
  await scenario(
    'new RPC, core and legacy are private; operation table has forced RLS',
    async () => {
      for (const role of ['anon', 'authenticated'])
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege($1,'public.patient_account_operation(text,uuid,uuid,uuid,uuid,text,jsonb)','execute') allowed",
              [role],
            )
          ).rows[0].allowed,
          false,
        );
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege('service_role','clinic_private.patient_account_command_v1(text,uuid,uuid,jsonb)','execute') allowed",
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (
          await db.query<{ forced: boolean }>(
            "select relrowsecurity and relforcerowsecurity as forced from pg_class where oid='clinic_private.patient_operations'::regclass",
          )
        ).rows[0].forced,
        true,
      );
    },
  );
  await scenario(
    'uncoordinated begin and copied/wrong worker capabilities cannot write',
    async () => {
      await rejected(() =>
        db.query("select public.patient_account_command('begin',$1,$2,$3)", [
          admin,
          p,
          JSON.stringify({ operationId: randomUUID() }),
        ]),
      );
      const c = await claim(capability());
      await rejected(() => command({ ...c, worker: randomUUID() }, 'begin'));
      await rejected(() => command({ ...c, proof: 'z'.repeat(43) }, 'begin'));
      await command(c, 'begin');
      await rpc(c, 'start');
      await rejected(() => rpc(c, 'start'));
      await rejected(() => claim(capability()));
    },
  );
  await scenario(
    'ambiguous provider operation never expires into a replacement writer',
    async () => {
      const c = await claim(capability());
      await command(c, 'begin');
      await rpc(c, 'start');
      await db.query(
        "update clinic_private.patient_operations set started_at=clock_timestamp()-interval '2 days',start_before=clock_timestamp()-interval '2 days' where operation_id=$1",
        [c.op],
      );
      await rpc(c, 'quarantine');
      await rejected(() => rpc(c, 'confirm'));
      await rejected(() => claim(capability()));
    },
  );
  await scenario(
    'expired unstarted claim cannot start a provider or be silently replaced',
    async () => {
      const c = await claim(capability());
      await command(c, 'begin');
      await db.query(
        "update clinic_private.patient_operations set start_before=clock_timestamp()-interval '1 second' where operation_id=$1",
        [c.op],
      );
      await rejected(() => rpc(c, 'start'));
      await rejected(() => claim(capability()));
    },
  );
  await scenario(
    'full coordinated provision, proof expiry, handover replay and activation',
    async () => {
      const { c, a } = await prepare();
      await rejected(() => command(c, 'commit', { handoverHash: 'b'.repeat(64) }));
      await db.query(
        "update clinic_private.patient_accounts set handover_expires_at=clock_timestamp()-interval '1 second' where patient_id=$1",
        [p],
      );
      await rejected(() => command(c, 'handover', { handoverHash: 'b'.repeat(64) }));
      await db.query(
        "update clinic_private.patient_accounts set handover_expires_at=clock_timestamp()+interval '1 minute' where patient_id=$1",
        [p],
      );
      await command(c, 'handover', { handoverHash: 'b'.repeat(64) });
      await rejected(() => command(c, 'handover', { handoverHash: 'b'.repeat(64) }));
      const sid = randomUUID();
      await db.query(
        'insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',
        [sid, a.userId],
      );
      const changing = await claim(capability(String(a.userId), 'activate', sid));
      await rpc(changing, 'start');
      await rejected(() => rpc(changing, 'confirm'));
      await db.query('update auth.users set encrypted_password=$1 where id=$2', [
        'SYNTHETIC-NEW-HASH',
        a.userId,
      ]);
      await rpc(changing, 'confirm');
      await rejected(() => command(changing, 'change-complete', { sessionId: randomUUID() }));
      await command(changing, 'change-complete', { sessionId: sid });
      assert.equal(
        (
          await db.query<{ state: string }>(
            'select state from clinic_private.patient_accounts where patient_id=$1',
            [p],
          )
        ).rows[0].state,
        'active',
      );
      await rejected(() => rpc(changing, 'start'));
      await rejected(() => command(changing, 'change-complete', { sessionId: sid }));
    },
  );
  await scenario(
    'Doctor reset denied and revoked initial Doctor cannot start but can quarantine',
    async () => {
      await db.query(
        'insert into clinic_private.patient_intakes(organization_id,patient_id,branch_id,created_by,request_id,fields_hash) values($1,$2,$3,$4,$5,$6)',
        [row.organization_id, p, row.home_branch_id, doctor, randomUUID(), Buffer.alloc(32)],
      );
      await rejected(() => claim(capability(doctor, 'reset')));
      const c = await claim(capability(doctor));
      await command(c, 'begin');
      await db.query('update public.branch_memberships set active=false where user_id=$1', [
        doctor,
      ]);
      await rejected(() => rpc(c, 'start'));
      await rpc(c, 'quarantine');
    },
  );
  await scenario(
    'unfinished reset fences an active Patient even while prior JWT/session is valid',
    async () => {
      const { c, a } = await prepare();
      await command(c, 'handover', { handoverHash: 'b'.repeat(64) });
      const sid = randomUUID();
      await db.query(
        'insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',
        [sid, a.userId],
      );
      const change = await claim(capability(String(a.userId), 'activate', sid));
      await rpc(change, 'start');
      await db.query('update auth.users set encrypted_password=$1 where id=$2', [
        'SYNTHETIC-NEW-HASH',
        a.userId,
      ]);
      await rpc(change, 'confirm');
      await command(change, 'change-complete', { sessionId: sid });
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: a.userId,
          session_id: sid,
          iat: Math.floor(Date.now() / 1000) + 10,
          aal: 'aal1',
        }),
      ]);
      const visible = () =>
        asUser(db, String(a.userId), () =>
          db.query('select id from public.patients where id=$1', [p]),
        );
      assert.equal((await visible()).rows.length, 1);
      // Claim alone must close the old session before any provider password call.
      const reset = capability(admin, 'reset');
      const r = await rpc(reset, 'claim', { identityCheck: 'in_person_verified' });
      reset.fence = String(r.fence);
      assert.equal((await visible()).rows.length, 0);
      await rpc(reset, 'quarantine');
      assert.equal((await visible()).rows.length, 0);
    },
  );
  await scenario(
    'staff revocation after provider confirmation blocks the stale domain commit',
    async () => {
      const c = await claim(capability());
      const a = await command(c, 'begin');
      await rpc(c, 'start');
      await db.query(
        'insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,clock_timestamp(),$3)',
        [a.userId, a.internalEmail, 'SYNTHETIC-HASH'],
      );
      await rpc(c, 'confirm');
      await db.query('update public.organization_memberships set active=false where user_id=$1', [
        admin,
      ]);
      await rejected(() => command(c, 'commit', { handoverHash: 'b'.repeat(64) }));
      await rpc(c, 'quarantine');
      assert.equal(
        (
          await db.query<{ user_id: string | null }>(
            'select user_id from public.patients where id=$1',
            [p],
          )
        ).rows[0].user_id,
        null,
      );
    },
  );
}
