import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
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
let tables: string[];
before(async () => {
  db = await createDatabase();
  tables = (
    await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='public' order by tablename",
    )
  ).rows.map((r) => r.tablename);
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

const denied = (run: () => Promise<unknown>, code = '42501') =>
  assert.rejects(run, (e: unknown) => {
    assert.equal((e as { code?: string }).code, code);
    return true;
  });
async function count(table: string, user: string | null, role = 'authenticated', where = '') {
  return asUser(
    db,
    user,
    async () =>
      Number(
        (await db.query<{ n: number }>(`select count(*) as n from public.${table} ${where}`))
          .rows[0].n,
      ),
    role,
  );
}
async function prepared(signed = false) {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await transition(db, a, 'in_consultation', users.doctor);
  const e = await sign(db, a, signed);
  return { a, e };
}
async function grant(user = users.otherDoctor, writing = false) {
  return asUser(
    db,
    users.adminA,
    async () =>
      (
        await db.query<{ id: string }>(
          'select public.grant_clinical_access($1,$2,$3,$4,$5) as id',
          [id(5, 1), id(2, 1), user, 'Fictional care-team review', writing],
        )
      ).rows[0].id,
  );
}

test('all tables, including private invitation hashes, have enabled/forced RLS', async () => {
  const rows = (
    await db.query<{
      rls: boolean;
      forced: boolean;
    }>(`select relrowsecurity as rls,relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','clinic_private') and relkind='r'`)
  ).rows;
  assert.equal(rows.length, 35);
  assert.ok(rows.every((r) => r.rls && r.forced));
});
test('authenticated/anon roles have no superuser, bypass-RLS or privileged role memberships', async () => {
  const rows = (
    await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "select rolsuper,rolbypassrls from pg_roles where rolname in ('anon','authenticated')",
    )
  ).rows;
  assert.ok(rows.every((r) => !r.rolsuper && !r.rolbypassrls));
  assert.equal(
    (
      await db.query(
        "select * from pg_auth_members where member in (select oid from pg_roles where rolname in ('anon','authenticated'))",
      )
    ).rows.length,
    0,
  );
});
test('anon has no table SELECT, DML, TRUNCATE or RPC privilege', async () => {
  for (const table of tables) {
    await denied(() => count(table, null, 'anon'));
    await denied(() => asUser(db, null, () => db.exec(`truncate public.${table}`), 'anon'));
  }
  await denied(() =>
    asUser(
      db,
      null,
      () =>
        db.query('select public.book_appointment($1,$2,$3)', [
          id(6, 1),
          id(5, 1),
          'Fictional visit',
        ]),
      'anon',
    ),
  );
});
test('authenticated without a user ID cannot read rows or call write RPCs', async () => {
  for (const table of tables) assert.equal(await count(table, null), 0, table);
  await denied(() => book(db, 1, 1, ''));
});
test('unprovisioned identity and forged role metadata cannot access tenant records', async () => {
  await db.exec(
    `select set_config('request.jwt.claims','{"user_metadata":{"role":"admin"},"app_metadata":{"role":"admin"}}',false)`,
  );
  for (const table of tables.filter((t) => t !== 'profiles'))
    assert.equal(await count(table, users.outsider), 0, table);
  assert.equal(await count('profiles', users.outsider), 1);
  await denied(() => book(db, 1, 1, users.outsider));
});
test('organization metadata and branch catalogs are isolated', async () => {
  assert.equal(await count('organizations', users.patient), 1);
  assert.equal(await count('branches', users.patient), 1);
  assert.equal(await count('branches', users.adminAll), 2);
  assert.equal(await count('patients', users.otherOrgAdmin), 1);
  assert.equal(await count('patients', users.adminA), 2);
});
test('patients see only own demographics/history/documents; unassigned doctor/staff see none', async () => {
  for (const table of ['patients', 'patient_medical_history', 'medical_documents']) {
    assert.equal(await count(table, users.patient), 1, table);
    assert.equal(await count(table, users.doctor), 0, table);
    assert.equal(await count(table, users.otherDoctor), 0, table);
    assert.equal(await count(table, users.staff), 0, table);
  }
});
test('all ordinary users, including Admin, are denied direct authority/data DML and TRUNCATE', async () => {
  for (const table of tables) {
    await denied(() =>
      asUser(db, users.adminA, () => db.exec(`insert into public.${table} default values`)),
    );
    await denied(() => asUser(db, users.adminA, () => db.exec(`delete from public.${table}`)));
    await denied(() => asUser(db, users.adminA, () => db.exec(`truncate public.${table}`)));
  }
  await denied(() =>
    asUser(db, users.patient, () =>
      db.query("insert into public.role_assignments values($1,$2,'admin')", [
        id(1, 1),
        users.patient,
      ]),
    ),
  );
  await denied(() =>
    asUser(db, users.patient, () => db.exec('update public.profiles set active=true')),
  );
  await denied(() =>
    asUser(db, users.patient, () => db.exec('update public.branch_memberships set active=true')),
  );
  await denied(() =>
    asUser(db, users.patient, () => db.exec("update public.appointments set status='completed'")),
  );
});
test('invitation metadata is branch-admin only; invitation hashes are never client-readable', async () => {
  assert.equal(await count('doctor_invitations', users.adminA), 1);
  assert.equal(await count('doctor_invitations', users.doctor), 0);
  assert.equal(await count('doctor_invitations', users.patient), 0);
  await denied(() =>
    asUser(db, users.adminAll, () => db.query('select * from clinic_private.invitation_secrets')),
  );
});
test('booking creates pending hold/fee/audit/history and does not grant medical access', async () => {
  const a = await book(db);
  assert.equal(await count('appointments', users.patient), 1);
  assert.equal(await count('appointments', users.doctor), 1);
  assert.equal(await count('patient_medical_history', users.doctor), 0);
  assert.equal(await count('patient_assignments', users.doctor), 0);
  assert.equal(
    (await db.query<{ status: string }>('select status from public.appointments where id=$1', [a]))
      .rows[0].status,
    'pending',
  );
  assert.equal(
    (
      await db.query<{ amount_paisa: number }>(
        'select amount_paisa from public.consultation_charges where appointment_id=$1',
        [a],
      )
    ).rows[0].amount_paisa,
    150000,
  );
  assert.equal(await count('appointment_status_history', users.patient), 1);
  assert.equal(await count('audit_logs', users.adminA), 1);
});
test('patient cannot book another patient, another branch or another organization', async () => {
  await denied(() => book(db, 1, 2));
  await denied(() => book(db, 6, 3));
  await denied(() => book(db, 10, 4));
  await denied(() =>
    asUser(db, users.patient, () =>
      db.query("select public.book_appointment($1,$2,$3,'physical','walk_in')", [
        id(6, 1),
        id(5, 1),
        'Fictional visit',
      ]),
    ),
  );
});
test('same slot and overlapping cross-branch doctor reservations fail atomically', async () => {
  await book(db);
  await denied(() => book(db, 1, 2, users.otherPatient), '23P01');
  await denied(() => book(db, 6, 3, users.branchBPatient), '23P01');
  assert.equal(
    (await db.query<{ n: number }>('select count(*) as n from public.appointments')).rows[0].n,
    1,
  );
});
test('patient cannot double-book another doctor at the same time; adjacent slots are allowed', async () => {
  await book(db);
  await denied(() => book(db, 8), '23P01');
  await book(db, 2, 2, users.otherPatient);
  assert.equal(await count('appointments', users.adminA), 2);
});
for (const slot of [5, 11, 12, 13])
  test(`slot ${slot} rejects break/past/off-grid/out-of-hours booking`, async () => {
    await denied(() => book(db, slot), '23514');
    assert.equal(await count('appointments', users.patient), 0);
  });
test('closed slot, inactive branch and inactive assignment deny booking', async () => {
  await db.exec(`update public.appointment_slots set open=false where id='${id(6, 1)}'`);
  await denied(() => book(db), '23514');
  await db.exec(
    `update public.appointment_slots set open=true; update public.branches set active=false where id='${id(2, 1)}'`,
  );
  await denied(() => book(db), '23514');
  await db.exec(
    `update public.branches set active=true; update public.doctor_branch_assignments set active=false`,
  );
  await denied(() => book(db), '23514');
});
test('patient/unrelated doctor/wrong-branch Admin cannot approve; assigned Doctor can', async () => {
  const a = await book(db);
  await denied(() => transition(db, a, 'confirmed', users.patient));
  await denied(() => transition(db, a, 'confirmed', users.otherDoctor));
  await denied(() => transition(db, a, 'confirmed', users.otherOrgAdmin));
  await transition(db, a, 'confirmed', users.doctor);
  assert.equal(await count('patient_medical_history', users.doctor), 1);
  assert.equal(await count('medical_documents', users.doctor), 1);
  assert.equal(await count('patient_medical_history', users.otherDoctor), 0);
});
test('branch A Admin cannot approve branch B, but multi-branch Admin can', async () => {
  const a = await book(db, 9, 3, users.branchBPatient);
  await denied(() => transition(db, a, 'confirmed', users.adminA));
  await transition(db, a, 'confirmed', users.adminAll);
});
test('reschedule holds original AND proposal; approval moves atomically and releases old slot', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await asUser(db, users.patient, () =>
    db.query('select public.request_reschedule($1,$2,$3)', [a, id(6, 2), 'Fictional new time']),
  );
  await denied(() => book(db, 1, 2, users.otherPatient), '23P01');
  await denied(() => book(db, 2, 2, users.otherPatient), '23P01');
  await transition(db, a, 'confirmed');
  await book(db, 1, 2, users.otherPatient);
  assert.equal(
    (
      await db.query<{ current_slot_id: string }>(
        'select current_slot_id from public.appointments where id=$1',
        [a],
      )
    ).rows[0].current_slot_id,
    id(6, 2),
  );
});
test('invalid reschedule rolls back without losing either original or previous proposed hold', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await asUser(db, users.patient, () =>
    db.query('select public.request_reschedule($1,$2,$3)', [a, id(6, 2), 'Fictional new time']),
  );
  await book(db, 3, 2, users.otherPatient);
  await denied(
    () =>
      asUser(db, users.patient, () =>
        db.query('select public.request_reschedule($1,$2,$3)', [
          a,
          id(6, 3),
          'Conflicting request',
        ]),
      ),
    '23P01',
  );
  const held = (
    await db.query<{ slot_id: string }>(
      'select slot_id from public.appointment_reservations where appointment_id=$1 and active order by kind',
      [a],
    )
  ).rows;
  assert.deepEqual(
    held.map((r) => r.slot_id),
    [id(6, 1), id(6, 2)],
  );
});
test('patient cancellation request retains hold; manager cancellation releases capacity and care access', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await transition(db, a, 'cancellation_requested', users.patient);
  await denied(() => book(db, 1, 2, users.otherPatient), '23P01');
  await denied(() => transition(db, a, 'cancelled', users.patient));
  await transition(db, a, 'cancelled');
  await book(db, 1, 2, users.otherPatient);
  assert.equal(await count('patient_medical_history', users.doctor), 0);
});
test('complete signed consultation publishes notes/vitals/Rx to owning Patient only', async () => {
  const { a, e } = await prepared(true);
  for (const t of [
    'clinical_encounters',
    'encounter_vitals',
    'prescriptions',
    'prescription_items',
  ]) {
    assert.equal(await count(t, users.patient), 1, t);
    assert.equal(await count(t, users.otherPatient), 0, t);
    assert.equal(await count(t, users.otherDoctor), 0, t);
    assert.equal(await count(t, users.otherOrgAdmin), 0, t);
  }
  assert.equal(
    (await db.query<{ status: string }>('select status from public.appointments where id=$1', [a]))
      .rows[0].status,
    'completed',
  );
  assert.equal(
    (
      await db.query<{ status: string }>(
        'select status from public.clinical_encounters where id=$1',
        [e],
      )
    ).rows[0].status,
    'signed',
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        'select count(*) as n from public.appointment_reservations where active',
      )
    ).rows[0].n,
    0,
  );
});
test('draft notes/vitals are visible to assigned care team/Admin but hidden from Patient', async () => {
  await prepared(false);
  for (const t of ['clinical_encounters', 'encounter_vitals']) {
    assert.equal(await count(t, users.doctor), 1);
    assert.equal(await count(t, users.adminA), 1);
    assert.equal(await count(t, users.patient), 0);
  }
  assert.equal(await count('prescriptions', users.patient), 0);
});
test('signing requires active consultation, assigned Doctor, diagnosis/plan and complete medications', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await denied(() => sign(db, a), '23514');
  await denied(() => transition(db, a, 'completed'), '23514');
  await transition(db, a, 'in_consultation', users.doctor);
  for (const u of [users.patient, users.adminA, users.otherDoctor, users.staff])
    await denied(() =>
      asUser(db, u, () =>
        db.query('select public.save_encounter($1,$2,$3,true)', [
          a,
          JSON.stringify(notes),
          JSON.stringify(medication),
        ]),
      ),
    );
  await denied(
    () =>
      asUser(db, users.doctor, () =>
        db.query("select public.save_encounter($1,$2,'[]',true)", [
          a,
          JSON.stringify({ ...notes, diagnosis: '' }),
        ]),
      ),
    '23514',
  );
  await denied(
    () =>
      asUser(db, users.doctor, () =>
        db.query('select public.save_encounter($1,$2,$3,true)', [
          a,
          JSON.stringify(notes),
          '[{"medication":"incomplete"}]',
        ]),
      ),
    '23514',
  );
  assert.equal(await count('clinical_encounters', users.doctor), 0);
});
test('signed encounter, vitals, prescription, audit and history are immutable even under ordinary owner DML', async () => {
  await prepared(true);
  for (const sql of [
    "update public.clinical_encounters set diagnosis='tampered'",
    "update public.encounter_vitals set pulse='0'",
    'delete from public.prescriptions',
    'delete from public.prescription_items',
    'delete from public.audit_logs',
    'delete from public.appointment_status_history',
  ]) {
    await db.exec('savepoint immutable_check');
    await denied(() => db.exec(sql), '23514');
    await db.exec('rollback to savepoint immutable_check; release savepoint immutable_check');
  }
});
test('explicit read grant enables additional doctor/staff read, does not permit signing or grant creation', async () => {
  const { a } = await prepared(true);
  await grant();
  await grant(users.staff);
  assert.equal(await count('clinical_encounters', users.otherDoctor), 1);
  assert.equal(await count('clinical_encounters', users.staff), 1);
  const writable = await asUser(db, users.staff, () =>
    db.query<{ v: boolean }>('select clinic_private.care_access($1,$2,$3,true) as v', [
      id(1, 1),
      id(5, 1),
      id(2, 1),
    ]),
  );
  assert.equal(writable.rows[0].v, false);
  await denied(() =>
    asUser(db, users.staff, () =>
      db.query('select public.save_encounter($1,$2)', [a, JSON.stringify(notes)]),
    ),
  );
  await denied(() =>
    asUser(db, users.otherDoctor, () =>
      db.query('select public.grant_clinical_access($1,$2,$3,$4)', [
        id(5, 1),
        id(2, 1),
        users.staff,
        'Fictional grant',
      ]),
    ),
  );
});
test('write grant requires explicit flag, pre-existing clinician role and branch membership', async () => {
  await prepared(true);
  await grant(users.staff, true);
  const r = await asUser(db, users.staff, () =>
    db.query<{ v: boolean }>('select clinic_private.care_access($1,$2,$3,true) as v', [
      id(1, 1),
      id(5, 1),
      id(2, 1),
    ]),
  );
  assert.equal(r.rows[0].v, true);
  await denied(() => grant(users.patient), '23514');
  await denied(() => grant(users.branchBDoctor), '23514');
  await denied(() => grant(users.otherOrgDoctor), '23514');
});
test('revoked/expired grants and branch or organization revocation immediately remove access', async () => {
  await prepared(true);
  const g = await grant();
  await asUser(db, users.adminA, () => db.query('select public.revoke_clinical_access($1)', [g]));
  assert.equal(await count('clinical_encounters', users.otherDoctor), 0);
  await grant();
  await db.exec(
    `update public.clinical_access_grants set created_at=now()-interval '2 days',expires_at=now()-interval '1 day'`,
  );
  assert.equal(await count('clinical_encounters', users.otherDoctor), 0);
  await grant();
  await db.exec(
    `update public.branch_memberships set active=false where user_id='${users.otherDoctor}'`,
  );
  assert.equal(await count('clinical_encounters', users.otherDoctor), 0);
  await db.exec(
    `update public.organization_memberships set active=false where user_id='${users.doctor}'`,
  );
  assert.equal(await count('clinical_encounters', users.doctor), 0);
});
test('Admin oversight remains branch limited; org admins from another tenant cannot see notes/documents/audit', async () => {
  const a = await book(db, 9, 3, users.branchBPatient);
  await transition(db, a, 'confirmed', users.adminAll);
  await db.query(
    `insert into public.clinical_encounters(organization_id,appointment_id,patient_id,doctor_id,branch_id,author_id,diagnosis,plan,status,signed_at)
    values($1,$2,$3,$4,$5,$6,'Fictional note','Fictional plan','signed',now())`,
    [id(1, 1), a, id(5, 3), id(4, 3), id(2, 2), users.branchBDoctor],
  );
  assert.equal(await count('clinical_encounters', users.adminA), 0);
  assert.equal(await count('clinical_encounters', users.adminAll), 1);
  assert.equal(await count('clinical_encounters', users.otherOrgAdmin), 0);
});
test('notifications are recipient-only; read_at can change but recipient identity/content cannot', async () => {
  await book(db);
  assert.equal(await count('notifications', users.patient), 1);
  assert.equal(await count('notifications', users.otherPatient), 0);
  await asUser(db, users.patient, () =>
    db.exec('update public.notification_recipients set read_at=now()'),
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        'select count(*) as n from public.notification_recipients where read_at is not null',
      )
    ).rows[0].n,
    1,
  );
  await denied(() =>
    asUser(db, users.patient, () =>
      db.exec(`update public.notification_recipients set user_id='${users.adminA}'`),
    ),
  );
  await denied(() =>
    asUser(db, users.patient, () => db.exec("update public.notifications set message='tampered'")),
  );
  assert.equal(await count('audit_logs', users.patient), 0);
});
test('Doctor leave blocks slots, flags affected requests and keeps unresolved reservations', async () => {
  const a = await book(db);
  await asUser(db, users.doctor, () =>
    db.query('select public.add_doctor_leave($1,$2,$3,$4)', [
      id(4, 1),
      '2100-01-04T04:00Z',
      '2100-01-04T05:00Z',
      'Fictional leave',
    ]),
  );
  assert.equal(
    (await db.query<{ status: string }>('select status from public.appointments where id=$1', [a]))
      .rows[0].status,
    'doctor_unavailable',
  );
  await denied(() => book(db, 2, 2, users.otherPatient), '23514');
  assert.equal(await count('doctor_leave', users.patient), 0);
  assert.equal(
    (
      await db.query<{ n: number }>(
        'select count(*) as n from public.appointment_reservations where active',
      )
    ).rows[0].n,
    1,
  );
});
test('branch-only Admin cannot impose doctor-wide leave; active visits block leave atomically', async () => {
  await denied(() =>
    asUser(db, users.adminA, () =>
      db.query('select public.add_doctor_leave($1,$2,$3,$4)', [
        id(4, 1),
        '2100-01-04T04:00Z',
        '2100-01-04T05:00Z',
        'Fictional leave',
      ]),
    ),
  );
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await transition(db, a, 'in_consultation', users.doctor);
  await denied(
    () =>
      asUser(db, users.doctor, () =>
        db.query('select public.add_doctor_leave($1,$2,$3,$4)', [
          id(4, 1),
          '2100-01-04T04:00Z',
          '2100-01-04T05:00Z',
          'Fictional leave',
        ]),
      ),
    '23514',
  );
  assert.equal(
    (await db.query<{ n: number }>('select count(*) as n from public.doctor_leave')).rows[0].n,
    0,
  );
});
test('internal lock, slot-check and event functions are not directly executable by clients', async () => {
  for (const q of [
    `select clinic_private.lock_doctor('${id(4, 1)}')`,
    `select clinic_private.assert_slot('${id(6, 1)}')`,
    `select clinic_private.event('${id(9, 1)}','forged')`,
  ])
    await denied(() => asUser(db, users.patient, () => db.exec(q)));
  const exposed = (
    await db.query<{ n: number }>(
      "select count(*) as n from pg_proc where pronamespace='public'::regnamespace and prosecdef",
    )
  ).rows[0].n;
  assert.equal(exposed, 0);
});

async function ownerReject(sql: string, params: unknown[] = [], code = '23503') {
  await db.exec('savepoint constraint_check');
  try {
    await denied(() => db.query(sql, params), code);
  } finally {
    await db.exec('rollback to savepoint constraint_check; release savepoint constraint_check');
  }
}
test('composite foreign keys reject cross-tenant patient, doctor, branch and specialization linkage', async () => {
  await ownerReject('insert into public.patient_branches values($1,$2,$3)', [
    id(1, 1),
    id(5, 4),
    id(2, 1),
  ]);
  await ownerReject(
    'insert into public.doctor_branch_assignments(organization_id,doctor_id,branch_id) values($1,$2,$3)',
    [id(1, 1), id(4, 1), id(2, 3)],
  );
  await ownerReject('update public.doctors set specialization_id=$1 where id=$2', [
    id(7, 2),
    id(4, 1),
  ]);
});
test('encounter/document links cannot be swapped to another patient or branch, even by owner', async () => {
  const { a, e } = await prepared(false);
  await ownerReject('update public.clinical_encounters set patient_id=$1 where id=$2', [
    id(5, 2),
    e,
  ]);
  await ownerReject('update public.clinical_encounters set author_id=$1 where id=$2', [
    users.otherDoctor,
    e,
  ]);
  await ownerReject(
    "insert into public.medical_documents(organization_id,patient_id,branch_id,encounter_id,author_id,kind,name,mime_type,size_bytes) values($1,$2,$3,$4,$5,'report','Fictional.pdf','application/pdf',1024)",
    [id(1, 1), id(5, 2), id(2, 1), e, users.adminA],
  );
  await ownerReject('update public.appointments set clinician_user_id=$1 where id=$2', [
    users.otherDoctor,
    a,
  ]);
});
test('reservation interval cannot be forged to evade slot overlap constraint', async () => {
  const a = await book(db);
  await ownerReject(
    "update public.appointment_reservations set starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' where appointment_id=$1",
    [a],
    '23514',
  );
});
test('break bounds, file MIME/size and fee/waiver rules reject malformed data', async () => {
  const schedule = (
    await db.query<{ id: string }>('select id from public.doctor_schedules limit 1')
  ).rows[0].id;
  await ownerReject(
    "insert into public.schedule_breaks(organization_id,schedule_id,starts_at,ends_at) values($1,$2,'08:00','09:30')",
    [id(1, 1), schedule],
    '23514',
  );
  const a = await book(db);
  await ownerReject(
    'update public.consultation_charges set amount_paisa=-1 where appointment_id=$1',
    [a],
    '23514',
  );
  await ownerReject(
    "update public.consultation_charges set payment_status='waived' where appointment_id=$1",
    [a],
    '23514',
  );
  await ownerReject(
    "update public.medical_documents set mime_type='application/x-msdownload'",
    [],
    '23514',
  );
  await ownerReject('update public.medical_documents set size_bytes=10485761', [], '23514');
  await ownerReject(
    "update public.medical_documents set storage_object_key='https://untrusted.example.test/file'",
    [],
    '23514',
  );
});
test('free appointments are waived; charges cannot be changed by Patient/Doctor/Admin clients', async () => {
  const a = await book(db, 9, 3, users.branchBPatient);
  const r = (
    await db.query<{ amount_paisa: number; payment_status: string }>(
      'select amount_paisa,payment_status from public.consultation_charges where appointment_id=$1',
      [a],
    )
  ).rows[0];
  assert.deepEqual(r, { amount_paisa: 0, payment_status: 'waived' });
  await denied(() =>
    asUser(db, users.adminAll, () =>
      db.exec("update public.consultation_charges set payment_status='paid'"),
    ),
  );
});
test('no-show releases its reservation; Patient cannot declare a no-show', async () => {
  const a = await book(db);
  await transition(db, a, 'confirmed');
  await denied(() => transition(db, a, 'no_show', users.patient));
  await transition(db, a, 'no_show', users.doctor);
  await book(db, 1, 2, users.otherPatient);
  assert.equal(await count('patient_medical_history', users.doctor), 0);
});
test('draft prescription contents persist without becoming visible to Patient', async () => {
  const { a } = await prepared(false);
  assert.equal(await count('prescription_items', users.doctor), 1);
  assert.equal(await count('prescription_items', users.patient), 0);
  assert.equal(
    (await db.query<{ issued_at: string | null }>('select issued_at from public.prescriptions'))
      .rows[0].issued_at,
    null,
  );
  await sign(db, a, true);
  assert.equal(await count('prescription_items', users.patient), 1);
});
test('disabling profile, Doctor registry or branch membership denies clinical access and writes immediately', async () => {
  const { a } = await prepared(false);
  await db.exec(`update public.profiles set active=false where id='${users.doctor}'`);
  assert.equal(await count('clinical_encounters', users.doctor), 0);
  await denied(() => sign(db, a));
  await db.exec(
    `update public.profiles set active=true; update public.doctors set active=false where id='${id(4, 1)}'`,
  );
  assert.equal(await count('clinical_encounters', users.doctor), 0);
  await denied(() => sign(db, a));
  await db.exec(
    `update public.doctors set active=true; update public.branch_memberships set active=false where user_id='${users.doctor}'`,
  );
  assert.equal(await count('clinical_encounters', users.doctor), 0);
  await denied(() => sign(db, a));
});
test('grant does not bypass branch scope or expiry validation', async () => {
  await denied(() =>
    asUser(db, users.adminA, () =>
      db.query('select public.grant_clinical_access($1,$2,$3,$4)', [
        id(5, 3),
        id(2, 2),
        users.branchBDoctor,
        'Fictional grant',
      ]),
    ),
  );
  await denied(
    () =>
      asUser(db, users.adminA, () =>
        db.query("select public.grant_clinical_access($1,$2,$3,$4,false,now()-interval '1 day')", [
          id(5, 1),
          id(2, 1),
          users.otherDoctor,
          'Fictional grant',
        ]),
      ),
    '23514',
  );
  const grantId = await grant();
  await denied(() =>
    asUser(db, users.otherDoctor, () =>
      db.query('select public.revoke_clinical_access($1)', [grantId]),
    ),
  );
});
test('privileged helper ACLs, empty search paths and notification column grants remain hardened', async () => {
  const defs = (
    await db.query<{
      proconfig: string[];
      anon: boolean;
    }>(`select proconfig,has_function_privilege('anon',p.oid,'execute') as anon
    from pg_proc p where pronamespace='clinic_private'::regnamespace and prosecdef`)
  ).rows;
  assert.ok(defs.length > 10);
  assert.ok(defs.every((r) => r.proconfig.includes('search_path=""') && !r.anon));
  const r = (
    await db.query<{ content: boolean; read: boolean; truncate: boolean }>(`select
    has_column_privilege('authenticated','public.notification_recipients','user_id','update') as content,
    has_column_privilege('authenticated','public.notification_recipients','read_at','update') as read,
    has_table_privilege('authenticated','public.clinical_encounters','truncate') as truncate`)
  ).rows[0];
  assert.deepEqual(r, { content: false, read: true, truncate: false });
});
test('service-role bypass does not grant direct workflow/clinical mutation or RPC execution', async () => {
  for (const table of [
    'appointments',
    'appointment_reservations',
    'clinical_encounters',
    'prescriptions',
    'patient_medical_history',
    'audit_logs',
  ]) {
    const r = (
      await db.query<{ v: boolean }>(
        "select has_table_privilege('service_role',$1,'SELECT,INSERT,UPDATE,DELETE') as v",
        [`public.${table}`],
      )
    ).rows[0];
    assert.equal(r.v, false, table);
  }
});
test('patient branch revocation removes appointment, note and document access without deleting records', async () => {
  await prepared(true);
  await db.exec(
    `update public.branch_memberships set active=false where user_id='${users.patient}'`,
  );
  for (const table of [
    'patients',
    'appointments',
    'clinical_encounters',
    'prescriptions',
    'medical_documents',
  ])
    assert.equal(await count(table, users.patient), 0, table);
  assert.equal(
    (await db.query<{ n: number }>('select count(*) as n from public.clinical_encounters')).rows[0]
      .n,
    1,
  );
});
test('safe availability projection omits breaks, invalid/held slots and out-of-scope branches without revealing patient data', async () => {
  const available = () =>
    asUser(db, users.patient, () =>
      db.query<{ id: string }>('select * from public.available_appointment_slots($1,$2,$3)', [
        id(2, 1),
        id(4, 1),
        '2100-01-04',
      ]),
    );
  assert.deepEqual(
    (await available()).rows.map((r) => r.id),
    [1, 2, 3, 4].map((n) => id(6, n)),
  );
  await book(db);
  assert.deepEqual(
    (await available()).rows.map((r) => r.id),
    [2, 3, 4].map((n) => id(6, n)),
  );
  const other = await asUser(db, users.patient, () =>
    db.query('select * from public.available_appointment_slots($1,$2,$3)', [
      id(2, 2),
      id(4, 1),
      '2100-01-04',
    ]),
  );
  assert.equal(other.rows.length, 0);
});
