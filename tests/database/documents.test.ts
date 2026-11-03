import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, users, id, asUser, book, transition } from './harness';
type Ticket = { id: string; documentId: string; objectKey: string; state: string };
const branch = id(2, 1),
  patient = id(5, 1);
test('private document candidate migration and authorization', async (t) => {
  const db = await createDatabase(true, async (db) =>
    db.exec(
      `alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon,service_role;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`,
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
        'supabase/proposals/documents/20261026184729_clinic_medical_document_storage.sql',
        'utf8',
      ),
    );
    await t.test('post-deployment checks match the exact proposed schema', async () => {
      await db.exec(await readFile('scripts/document-post-deployment-checks.sql', 'utf8'));
    });
    await db.exec('begin');
    const appointment = await book(db);
    await transition(db, appointment, 'confirmed');
    const prepare = (user = users.doctor, p = patient, b = branch, request = randomUUID()) =>
      asUser(db, user, async () => {
        const r = await db.query<{ ticket: Ticket }>(
          `select public.begin_medical_document_upload($1,$2,$3,'report','Fictional report.pdf','application/pdf',100) ticket`,
          [p, b, request],
        );
        return r.rows[0].ticket;
      });
    const store = (ticket: Ticket, user = users.doctor) =>
      asUser(db, user, async () => {
        const r = await db.query<{ id: string; version: string }>(
          `insert into storage.objects(bucket_id,name,owner_id,metadata) values('clinic-medical-documents',$1,$2,'{"size":100,"mimetype":"application/pdf"}') returning id,version`,
          [ticket.objectKey, user],
        );
        return r.rows[0];
      });
    const finish = (ticket: Ticket, user = users.doctor) =>
      asUser(db, user, () =>
        db.query<{ id: string }>('select public.complete_medical_document_upload($1) id', [
          ticket.id,
        ]),
      );
    const attest = async (
      ticket: Ticket,
      object: { id: string; version: string },
      user = users.doctor,
    ) => {
      await db.exec('savepoint attestor;set role service_role');
      try {
        return await db.query('select public.attest_medical_document_upload($1,$2,$3,$4,$5)', [
          ticket.id,
          user,
          object.id,
          object.version,
          'ab'.repeat(32),
        ]);
      } catch (e) {
        await db.exec('rollback to savepoint attestor');
        throw e;
      } finally {
        await db.exec('reset role;release savepoint attestor');
      }
    };
    const isolated = async (run: () => Promise<void>) => {
      await db.exec('savepoint case_scope');
      try {
        await run();
      } finally {
        await db.exec('rollback to savepoint case_scope;release savepoint case_scope');
      }
    };
    const denied = (run: Promise<unknown>, code = '42501') =>
      assert.rejects(run, (e) => (e as { code: string }).code === code);
    let completed!: Ticket;
    await t.test(
      'Doctor intent, trusted attestation and user registration are idempotent',
      async () => {
        completed = await prepare();
        const object = await store(completed);
        await denied(finish(completed), '23514');
        await attest(completed, object);
        const row = await finish(completed);
        assert.equal(row.rows[0].id, completed.documentId);
        const retry = await finish(completed);
        assert.equal(retry.rows[0].id, completed.documentId);
        assert.equal(
          (
            await db.query<{ n: number }>(
              'select count(*)::int n from public.medical_documents where id=$1',
              [completed.documentId],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    for (const [name, user] of Object.entries({
      Patient: users.patient,
      Admin: users.adminA,
      Staff: users.staff,
      UnassignedDoctor: users.otherDoctor,
      OtherPatient: users.otherPatient,
      ForeignDoctor: users.otherOrgDoctor,
    }))
      await t.test(`${name} cannot start an upload for this patient`, () =>
        isolated(async () => {
          await denied(prepare(user));
        }),
      );
    await t.test('Doctor cannot upload across branch or organization', () =>
      isolated(async () => {
        await denied(prepare(users.doctor, id(5, 3), id(2, 2)));
        await denied(prepare(users.doctor, id(5, 4), id(2, 3)));
      }),
    );
    await t.test('pending appointment alone does not authorize clinical upload', () =>
      isolated(async () => {
        const pending = await book(db, 2, 2, users.otherPatient);
        assert.ok(pending);
        await denied(prepare(users.doctor, id(5, 2)));
      }),
    );
    await t.test('anonymous calls and direct metadata writes are denied', () =>
      isolated(async () => {
        await denied(
          asUser(
            db,
            null,
            () => db.query('select public.complete_medical_document_upload($1)', [completed.id]),
            'anon',
          ),
        );
        await denied(
          asUser(db, users.doctor, () =>
            db.query(
              `insert into public.medical_documents(organization_id,patient_id,branch_id,author_id,kind,name,mime_type,size_bytes) values($1,$2,$3,$4,'report','bypass.pdf','application/pdf',10)`,
              [id(1, 1), patient, branch, users.doctor],
            ),
          ),
        );
      }),
    );
    await t.test('Patients and unassigned Doctors cannot read pending blobs', () =>
      isolated(async () => {
        const ticket = await prepare();
        const object = await store(ticket);
        for (const user of [users.patient, users.otherPatient, users.otherDoctor])
          assert.equal(
            (
              await asUser(db, user, () =>
                db.query('select id from storage.objects where id=$1', [object.id]),
              )
            ).rows.length,
            0,
          );
        assert.equal(
          (
            await asUser(db, users.doctor, () =>
              db.query('select id from storage.objects where id=$1', [object.id]),
            )
          ).rows.length,
          1,
        );
      }),
    );
    await t.test(
      'own Patient and treating Doctor read finalized Storage rows; others and anonymous cannot',
      () =>
        isolated(async () => {
          for (const user of [users.patient, users.doctor, users.adminA])
            assert.equal(
              (
                await asUser(db, user, () =>
                  db.query('select id from storage.objects where name=$1', [completed.objectKey]),
                )
              ).rows.length,
              1,
            );
          for (const user of [
            users.otherPatient,
            users.otherDoctor,
            users.otherOrgDoctor,
            users.branchBDoctor,
          ])
            assert.equal(
              (
                await asUser(db, user, () =>
                  db.query('select id from storage.objects where name=$1', [completed.objectKey]),
                )
              ).rows.length,
              0,
            );
          assert.equal(
            (await asUser(db, null, () => db.query('select id from storage.objects'), 'anon')).rows
              .length,
            0,
          );
        }),
    );
    await t.test('client cannot self-attest stored content', () =>
      isolated(async () => {
        for (const user of [users.doctor, users.adminA, users.patient])
          await denied(
            asUser(db, user, () =>
              db.query('select public.attest_medical_document_upload($1,$2,$3,$4,$5)', [
                completed.id,
                users.doctor,
                randomUUID(),
                'version',
                'ab'.repeat(32),
              ]),
            ),
          );
      }),
    );
    await t.test('attestation rejects wrong object/version and size', () =>
      isolated(async () => {
        const ticket = await prepare();
        const object = await store(ticket);
        await denied(attest(ticket, { ...object, version: 'replaced' }), '23514');
        await db.query(
          `update storage.objects set metadata='{"size":101,"mimetype":"application/pdf"}' where id=$1`,
          [object.id],
        );
        await denied(attest(ticket, object), '23514');
      }),
    );
    await t.test('missing bytes cannot be validated or registered', () =>
      isolated(async () => {
        const ticket = await prepare();
        await denied(attest(ticket, { id: randomUUID(), version: 'missing' }), 'P0002');
        await denied(finish(ticket), '23514');
      }),
    );
    await t.test('completed and validated blobs cannot be replaced or deleted', () =>
      isolated(async () => {
        const ticket = await prepare();
        const object = await store(ticket);
        await attest(ticket, object);
        for (const key of [ticket.objectKey, completed.objectKey]) {
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query(
                  `update storage.objects set version='replacement' where name=$1 returning id`,
                  [key],
                ),
              )
            ).rows.length,
            0,
          );
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query('delete from storage.objects where name=$1 returning id', [key]),
              )
            ).rows.length,
            0,
          );
        }
        await denied(
          asUser(db, users.doctor, () =>
            db.query('select public.abandon_medical_document_upload($1)', [ticket.id]),
          ),
          '23514',
        );
      }),
    );
    await t.test(
      'only abandoned own unregistered objects can be cleaned up; path cannot be reused',
      () =>
        isolated(async () => {
          const ticket = await prepare();
          await store(ticket);
          await asUser(db, users.doctor, () =>
            db.query('select public.abandon_medical_document_upload($1)', [ticket.id]),
          );
          assert.equal(
            (
              await asUser(db, users.otherDoctor, () =>
                db.query('delete from storage.objects where name=$1 returning id', [
                  ticket.objectKey,
                ]),
              )
            ).rows.length,
            0,
          );
          assert.equal(
            (
              await asUser(db, users.doctor, () =>
                db.query('delete from storage.objects where name=$1 returning id', [
                  ticket.objectKey,
                ]),
              )
            ).rows.length,
            1,
          );
          await denied(store(ticket));
        }),
    );
    await t.test('idempotency key cannot create duplicates or switch patient metadata', () =>
      isolated(async () => {
        const request = randomUUID();
        const first = await prepare(users.doctor, patient, branch, request);
        const second = await prepare(users.doctor, patient, branch, request);
        assert.equal(first.id, second.id);
        await denied(
          asUser(db, users.doctor, () =>
            db.query(
              `select public.begin_medical_document_upload($1,$2,$3,'handwritten','Fictional report.pdf','application/pdf',100)`,
              [patient, branch, request],
            ),
          ),
          '23505',
        );
      }),
    );
    await t.test('expired intents cannot accept bytes', () =>
      isolated(async () => {
        const ticket = await prepare();
        await db.query(
          `update clinic_private.document_uploads set expires_at=now()-interval '1 second' where id=$1`,
          [ticket.id],
        );
        await denied(store(ticket));
      }),
    );
    await t.test('revoked clinical authority blocks completion and pending reads', () =>
      isolated(async () => {
        const ticket = await prepare();
        const object = await store(ticket);
        await attest(ticket, object);
        await db.query(
          'update public.patient_assignments set active=false where appointment_id=$1',
          [appointment],
        );
        await denied(finish(ticket));
        assert.equal(
          (
            await asUser(db, users.doctor, () =>
              db.query('select id from storage.objects where id=$1', [object.id]),
            )
          ).rows.length,
          0,
        );
      }),
    );
    await t.test('expired and read-only clinical grants cannot authorize uploads', () =>
      isolated(async () => {
        await db.query(
          `insert into public.clinical_access_grants(organization_id,patient_id,branch_id,user_id,granted_by,can_write,reason,expires_at) values($1,$2,$3,$4,$5,false,'Fictional read-only access',now()+interval '1 hour')`,
          [id(1, 1), patient, branch, users.otherDoctor, users.adminA],
        );
        await denied(prepare(users.otherDoctor));
        await db.query(
          `update public.clinical_access_grants set can_write=true,created_at=now()-interval '2 hours',expires_at=now()-interval '1 second' where user_id=$1`,
          [users.otherDoctor],
        );
        await denied(prepare(users.otherDoctor));
      }),
    );
    await t.test('future broad Storage policies cannot bypass this bucket guards', () =>
      isolated(async () => {
        await db.exec(
          `create policy fictional_broad_read on storage.objects for select to authenticated,anon using(true);create policy fictional_broad_insert on storage.objects for insert to authenticated with check(true);create policy fictional_broad_update on storage.objects for update to authenticated using(true) with check(true);create policy fictional_broad_delete on storage.objects for delete to authenticated using(true);`,
        );
        assert.equal(
          (await asUser(db, users.otherPatient, () => db.query('select id from storage.objects')))
            .rows.length,
          0,
        );
        assert.equal(
          (await asUser(db, null, () => db.query('select id from storage.objects'), 'anon')).rows
            .length,
          0,
        );
        assert.equal(
          (
            await asUser(db, users.doctor, () =>
              db.query(`update storage.objects set version='replacement' returning id`),
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await asUser(db, users.doctor, () =>
              db.query('delete from storage.objects returning id'),
            )
          ).rows.length,
          0,
        );
        await denied(store({ ...completed, objectKey: 'forged/path.pdf' }));
      }),
    );
    await t.test(
      'private intent table is not directly readable and public RPC privilege split is least privilege',
      () =>
        isolated(async () => {
          await denied(
            asUser(db, users.doctor, () =>
              db.query('select * from clinic_private.document_uploads'),
            ),
          );
          const permissions = await db.query<{
            proname: string;
            prosecdef: boolean;
            auth: boolean;
            anon: boolean;
            service: boolean;
          }>(
            `select proname,prosecdef,has_function_privilege('authenticated',oid,'execute') auth,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where pronamespace='public'::regnamespace and proname in ('begin_medical_document_upload','complete_medical_document_upload','abandon_medical_document_upload','attest_medical_document_upload')`,
          );
          assert.equal(permissions.rows.length, 4);
          for (const p of permissions.rows) {
            assert.equal(p.prosecdef, false);
            assert.equal(p.anon, false);
            assert.equal(p.auth, p.proname !== 'attest_medical_document_upload');
            assert.equal(p.service, p.proname === 'attest_medical_document_upload');
          }
          const bucket = await db.query<{ public: boolean; file_size_limit: number }>(
            'select public,file_size_limit from storage.buckets',
          );
          assert.equal(bucket.rows[0].public, false);
          assert.equal(Number(bucket.rows[0].file_size_limit), 10485760);
        }),
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
