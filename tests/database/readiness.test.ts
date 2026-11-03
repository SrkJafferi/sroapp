import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import {
  asUser,
  book,
  createDatabase,
  id,
  medication,
  notes,
  sign,
  transition,
  users,
} from './harness';

let db: PGlite;
before(async () => {
  db = await createDatabase();
});
after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});
async function denied(run: () => Promise<unknown>, code = '42501') {
  await assert.rejects(run, (e: unknown) => (e as { code?: string }).code === code);
}
// A deterministic local fault-injection boundary, NOT a real two-backend race.
// Models an authority change while an RPC is waiting for the shared Doctor lock.
async function atDoctorLock(sql: string) {
  const source = (
    await db.query<{ source: string }>(
      "select pg_get_functiondef('clinic_private.lock_doctor(uuid)'::regprocedure) as source",
    )
  ).rows[0].source;
  const marker =
    'perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,0));';
  assert.ok(source.includes(marker));
  await db.exec(source.replace(marker, `${marker}\n${sql}`));
}
test('Doctor cannot manufacture an initial care assignment by booking an unrelated existing patient', async () => {
  await denied(() => book(db, 1, 1, users.doctor));
});
test('temporary read grant cannot be laundered into a permanent self-approved care assignment', async () => {
  const a = await book(db, 2);
  await transition(db, a, 'confirmed');
  await asUser(db, users.adminA, () =>
    db.query('select public.grant_clinical_access($1,$2,$3,$4)', [
      id(5, 1),
      id(2, 1),
      users.otherDoctor,
      'Fictional temporary review',
    ]),
  );
  await denied(() => book(db, 8, 1, users.otherDoctor));
});
test('Doctor can still book a follow-up for an already approved primary care assignment', async () => {
  const a = await book(db, 2);
  await transition(db, a, 'confirmed');
  const followup = await book(db, 1, 1, users.doctor);
  assert.ok(followup);
});
test('revoked primary assignment cannot be restored by its Doctor through cancellation/reconfirmation', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await db.query('update public.patient_assignments set active=false where appointment_id=$1', [a]);
  await denied(() => transition(db, a, 'cancellation_requested', users.doctor));
});
test('revoked primary assignment prevents clinical signing of its still-open encounter', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await transition(db, a, 'in_consultation', users.doctor);
  await db.query('update public.patient_assignments set active=false where appointment_id=$1', [a]);
  await denied(() =>
    asUser(db, users.doctor, () =>
      db.query('select public.save_encounter($1,$2,$3,true)', [
        a,
        JSON.stringify(notes),
        JSON.stringify(medication),
      ]),
    ),
  );
});
for (const action of ['booking', 'approval', 'rescheduling', 'signing', 'leave']) {
  test(`authorization is rechecked after the Doctor lock for ${action}`, async () => {
    let a = '';
    if (action !== 'booking') a = await book(db);
    if (action === 'rescheduling' || action === 'signing') await transition(db, a, 'confirmed');
    if (action === 'signing') await transition(db, a, 'in_consultation', users.doctor);
    const caller =
      action === 'signing' ? users.doctor : action === 'leave' ? users.adminAll : users.adminA;
    await atDoctorLock(
      `delete from public.role_assignments where user_id='${caller}' and role='${action === 'signing' ? 'doctor' : 'admin'}';`,
    );
    if (action === 'booking') await denied(() => book(db, 1, 2, caller));
    if (action === 'approval') await denied(() => transition(db, a, 'confirmed', caller));
    if (action === 'rescheduling')
      await denied(() =>
        asUser(db, caller, () =>
          db.query('select public.request_reschedule($1,$2,$3)', [a, id(6, 2), 'Fictional change']),
        ),
      );
    if (action === 'signing') await denied(() => sign(db, a));
    if (action === 'leave')
      await denied(() =>
        asUser(db, caller, () =>
          db.query('select public.add_doctor_leave($1,$2,$3,$4)', [
            id(4, 1),
            '2100-01-04T04:00Z',
            '2100-01-04T05:00Z',
            'Fictional leave',
          ]),
        ),
      );
  });
}
test('NULL proposed-slot reason is rejected atomically', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await denied(
    () =>
      asUser(db, users.patient, () =>
        db.query('select public.request_reschedule($1,$2,null)', [a, id(6, 2)]),
      ),
    '23514',
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*) as n from public.appointment_reservations where kind='proposed'",
      )
    ).rows[0].n,
    0,
  );
});
test('calendar edits cannot invalidate an existing future reservation through service-role CRUD', async () => {
  await book(db);
  const schedule = (
    await db.query<{ id: string }>(
      `select id from public.doctor_schedules where doctor_id=$1 and branch_id=$2
    and weekday=extract(dow from date '2100-01-04')`,
      [id(4, 1), id(2, 1)],
    )
  ).rows[0].id;
  await db.exec('savepoint service_edit');
  try {
    await db.exec('set role service_role');
    await denied(
      () =>
        db.query(
          "insert into public.schedule_breaks(organization_id,schedule_id,starts_at,ends_at) values($1,$2,'09:00','09:30')",
          [id(1, 1), schedule],
        ),
      '23514',
    );
  } finally {
    await db.exec('rollback to savepoint service_edit; reset role; release savepoint service_edit');
  }
});
test('migration defaults cannot bind public shadow functions with privileged execution', async () => {
  const isolated = await createDatabase(false, async (pg) =>
    pg.exec(`
    create function public.gen_random_uuid() returns uuid language plpgsql as $$ begin
      perform pg_catalog.set_config('audit.shadow_role',current_user,true);
      return pg_catalog.gen_random_uuid();
    end $$;
  `),
  );
  try {
    const r = await isolated.query<{
      n: number;
    }>(`select count(*) as n from pg_depend d join pg_attrdef a on a.oid=d.objid
      where d.refobjid='public.gen_random_uuid()'::regprocedure and d.classid='pg_attrdef'::regclass`);
    assert.equal(r.rows[0].n, 0);
  } finally {
    await isolated.close();
  }
});
test('Supabase-like permissive default grants are removed from all exposed clinic objects', async () => {
  const isolated = await createDatabase(false, async (pg) =>
    pg.exec(`
    alter default privileges grant all on tables to anon,authenticated,service_role;
    alter default privileges grant execute on functions to anon,authenticated,service_role;
  `),
  );
  try {
    const rows = (
      await isolated.query<{ bad: boolean }>(`select
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',c.oid,'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER') as bad
      from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'`)
    ).rows;
    assert.ok(rows.length === 34 && rows.every((r) => !r.bad));
    const rpc = (
      await isolated.query<{ bad: boolean }>(`select has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE') as bad from pg_proc p where pronamespace='public'::regnamespace`)
    ).rows;
    assert.equal(rpc.length, 8);
    assert.ok(rpc.every((r) => !r.bad));
  } finally {
    await isolated.close();
  }
});

async function ownerDenied(sql: string, params: unknown[] = []) {
  await db.exec('savepoint owner_negative');
  try {
    await denied(() => db.query(sql, params), '23514');
  } finally {
    await db.exec('rollback to savepoint owner_negative; release savepoint owner_negative');
  }
}

test('migration rejects a non-BYPASSRLS owner before creating clinic objects', async () => {
  await assert.rejects(
    () =>
      createDatabase(false, async (pg) =>
        pg.exec('create role audit_migration_owner nologin; set role audit_migration_owner'),
      ),
    /Clinic migration owner must bypass FORCE RLS/,
  );
});

test('held reservations prevent schedule removal, duration changes and branch deactivation of a Doctor assignment', async () => {
  await book(db);
  await ownerDenied(
    'update public.doctor_branch_assignments set active=false where doctor_id=$1 and branch_id=$2',
    [id(4, 1), id(2, 1)],
  );
  await ownerDenied(
    'update public.doctor_branch_assignments set slot_minutes=15 where doctor_id=$1 and branch_id=$2',
    [id(4, 1), id(2, 1)],
  );
  await ownerDenied(
    "update public.doctor_schedules set ends_at='16:00' where doctor_id=$1 and branch_id=$2",
    [id(4, 1), id(2, 1)],
  );
  await ownerDenied('delete from public.doctor_schedules where doctor_id=$1 and branch_id=$2', [
    id(4, 1),
    id(2, 1),
  ]);
});

test('calendar guards allow fee-only edits, unchanged schedules and non-conflicting break maintenance', async () => {
  await book(db);
  await db.exec('set role service_role');
  await db.query(
    'update public.doctor_branch_assignments set fee_paisa=200000 where doctor_id=$1 and branch_id=$2',
    [id(4, 1), id(2, 1)],
  );
  await db.query(
    'update public.doctor_schedules set ends_at=ends_at where doctor_id=$1 and branch_id=$2',
    [id(4, 1), id(2, 1)],
  );
  const schedule = (
    await db.query<{ id: string }>(
      `select id from public.doctor_schedules where doctor_id=$1 and branch_id=$2
    and weekday=extract(dow from date '2100-01-04')`,
      [id(4, 1), id(2, 1)],
    )
  ).rows[0].id;
  const br = (
    await db.query<{ id: string }>(
      "insert into public.schedule_breaks(organization_id,schedule_id,starts_at,ends_at) values($1,$2,'15:00','15:30') returning id",
      [id(1, 1), schedule],
    )
  ).rows[0].id;
  await db.query('delete from public.schedule_breaks where id=$1', [br]);
  await db.exec('reset role');
  assert.equal(
    (
      await db.query<{ amount_paisa: number }>(
        'select amount_paisa from public.consultation_charges',
      )
    ).rows[0].amount_paisa,
    150000,
  );
});

test('branch timezones must be valid and cannot reinterpret existing future holds', async () => {
  await ownerDenied("update public.branches set timezone='Invalid/Fictional' where id=$1", [
    id(2, 1),
  ]);
  await book(db);
  await ownerDenied("update public.branches set timezone='UTC' where id=$1", [id(2, 1)]);
  await db.query("update public.branches set timezone='UTC' where id=$1", [id(2, 3)]);
  assert.equal(
    (
      await db.query<{ timezone: string }>('select timezone from public.branches where id=$1', [
        id(2, 1),
      ])
    ).rows[0].timezone,
    'Asia/Karachi',
  );
});

test('late prescription constraint failure rolls back notes, Rx, completion, notifications and audit atomically', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await transition(db, a, 'in_consultation', users.doctor);
  await sign(db, a, false);
  const before = (
    await db.query(
      `select
    (select row_to_json(e) from public.clinical_encounters e where appointment_id=$1) as encounter,
    (select json_agg(i order by i.id) from public.prescription_items i) as items,
    (select count(*) from public.audit_logs) as audits,
    (select count(*) from public.notifications) as notifications`,
      [a],
    )
  ).rows;
  // Payload passes shape validation; the second item fails its database length constraint.
  const items = [medication[0], { ...medication[0], medication: 'x'.repeat(501) }];
  await denied(() => sign(db, a, true, items), '23514');
  assert.deepEqual(
    (
      await db.query(
        `select
    (select row_to_json(e) from public.clinical_encounters e where appointment_id=$1) as encounter,
    (select json_agg(i order by i.id) from public.prescription_items i) as items,
    (select count(*) from public.audit_logs) as audits,
    (select count(*) from public.notifications) as notifications`,
        [a],
      )
    ).rows,
    before,
  );
  assert.equal(
    (await db.query<{ status: string }>('select status from public.appointments where id=$1', [a]))
      .rows[0].status,
    'in_consultation',
  );
});

test('signed prescription cannot gain items or accept reparented draft content', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await transition(db, a, 'in_consultation', users.doctor);
  const signed = await sign(db, a);
  await ownerDenied(
    `insert into public.prescription_items(organization_id,prescription_id,line_number,medication,strength,dosage,frequency,duration,instructions)
    select organization_id,id,2,'Fictional','Fictional','Fictional','Fictional','Fictional','Fictional' from public.prescriptions where encounter_id=$1`,
    [signed],
  );
  const b = await book(db, 2);
  await transition(db, b, 'confirmed');
  await transition(db, b, 'in_consultation', users.doctor);
  const draft = await sign(db, b, false);
  await ownerDenied('update public.prescriptions set encounter_id=$1 where encounter_id=$2', [
    signed,
    draft,
  ]);
  await ownerDenied(
    `update public.prescription_items set prescription_id=(select id from public.prescriptions where encounter_id=$1)
    where prescription_id=(select id from public.prescriptions where encounter_id=$2)`,
    [signed, draft],
  );
});

test('every client column ACL and internal trigger ACL is narrow; all definer owners bypass FORCE RLS', async () => {
  const columns = (
    await db.query<{
      table_name: string;
      column_name: string;
    }>(`select c.relname as table_name,a.attname as column_name
    from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where c.relnamespace='public'::regnamespace and c.relkind='r'
      and has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')`)
  ).rows;
  assert.deepEqual(columns, [{ table_name: 'notification_recipients', column_name: 'read_at' }]);
  const triggers = (
    await db.query<{
      allowed: boolean;
    }>(`select has_function_privilege('authenticated',p.oid,'EXECUTE')
    or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') as allowed
    from pg_proc p where pronamespace='clinic_private'::regnamespace and prorettype='trigger'::regtype`)
  ).rows;
  assert.ok(triggers.length >= 8 && triggers.every((r) => !r.allowed));
  const unsafe = (
    await db.query<{
      n: number;
    }>(`select count(*) as n from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.pronamespace='clinic_private'::regnamespace and p.prosecdef and not(r.rolsuper or r.rolbypassrls)`)
  ).rows[0].n;
  assert.equal(unsafe, 0);
});

test('migration manifest pins exactly the three local files, their order and SHA-256 contents', async () => {
  const manifest = JSON.parse(await readFile('supabase/migration-manifest.json', 'utf8')) as {
    projectRef: string;
    remoteApplyApproved: boolean;
    candidateMigrations: { file: string; sha256: string }[];
  };
  assert.equal(manifest.projectRef, 'jyigxpjvygvtvcypujel');
  assert.equal(manifest.remoteApplyApproved, false);
  const files = (await readdir('supabase/migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  assert.equal(files.length, 3);
  assert.deepEqual(
    manifest.candidateMigrations.map((m) => m.file),
    files,
  );
  for (const migration of manifest.candidateMigrations) {
    const hash = createHash('sha256')
      .update(await readFile(`supabase/migrations/${migration.file}`))
      .digest('hex');
    assert.equal(migration.sha256, hash, migration.file);
  }
});
