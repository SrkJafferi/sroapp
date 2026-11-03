import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, asUser, users, id } from './harness';

const pilot = 'supabase/proposals/patient-walkin-pilot/20261101090000_clinic_patient_walkin_pilot.sql';
const org = '88645fbe-34da-48aa-a509-c24441b7cf72';
const branch = id(2, 1);
const fields = {
  name: 'Pilot Test Patient',
  ageYears: 32,
  gender: 'Female',
  email: '',
  phone: '',
  bloodGroup: '',
  address: '',
};

async function fresh() {
  const db = await createDatabase(false, (db) =>
    db.exec(`
      alter table auth.users add email text, add email_confirmed_at timestamptz, add banned_until timestamptz,
        add deleted_at timestamptz, add encrypted_password text, add last_sign_in_at timestamptz;
      create table auth.identities(user_id uuid,provider text,primary key(user_id,provider));
      create table auth.mfa_factors(user_id uuid,status text);
      create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated,anon,service_role;
      grant select,insert,update,delete on storage.objects to authenticated; grant select on storage.objects to anon;
    `),
  );
  const replay = async (file: string) => db.exec(await readFile('supabase/proposals/' + file, 'utf8'));
  await replay('phase2b/20261026111934_clinic_auth_onboarding.sql');
  await replay('phase2c/20261026123202_clinic_workspace_commands.sql');
  await replay('profiles/20261026192535_clinic_profiles_avatars.sql');
  const fixture = (await readFile('supabase/fixtures/fictional.sql', 'utf8'))
    .replaceAll(id(1, 1), org)
    .replaceAll(id(5, 1), '398cf267-bc60-41a4-91e6-478dcd86a069')
    .replaceAll('Fictional Patient A', 'Amina Noor');
  await db.exec(fixture);
  await db.exec('delete from public.medical_documents; delete from public.patient_medical_history;');
  await db.exec(`delete from public.patient_branches where patient_id<>'398cf267-bc60-41a4-91e6-478dcd86a069'; delete from public.patients where id<>'398cf267-bc60-41a4-91e6-478dcd86a069';`);
  await db.exec(`update auth.users set email=id::text||'@example.test',email_confirmed_at=now(),encrypted_password='fictional-hash';`);
  await replay('patient-ids/20261026195847_clinic_patient_numbers.sql');
  await replay('patient-age/20261026224947_clinic_patient_age.sql');
  await replay('walk-in/20261027093051_clinic_walk_in_registration.sql');
  await replay('patient-walkin-pilot/20261101090000_clinic_patient_walkin_pilot.sql');
  return db;
}
const run = async (db: Awaited<ReturnType<typeof fresh>>, text: string, values: unknown[] = []) =>
  (await db.query<{ r?: unknown }>(text, values)).rows[0]?.r;

test('single-use pilot exact binding and lifecycle', async (t) => {
  const db = await fresh();
  try {
    await assert.rejects(() =>
      db.query('select public.patient_pilot_setup($1,$2,$3,$4,$5)', [
        'phase4b-wrong-role', org, branch, users.staff, JSON.stringify(fields),
      ]),
    );
    await assert.rejects(() =>
      db.query('select public.patient_pilot_setup($1,$2,$3,$4,$5)', [
        'phase4b-wrong-branch', org, id(2, 3), users.doctor, JSON.stringify(fields),
      ]),
    );
    const setup = await run(db, `select public.patient_pilot_setup($1,$2,$3,$4,$5) r`, [
      'phase4b-walkin-pilot',
      org,
      branch,
      users.doctor,
      JSON.stringify(fields),
    ]);
    assert.ok(setup && setup.registrationRequestId && setup.pilotId, 'setup returns a server request');
    await assert.rejects(() =>
      db.query(`select public.patient_pilot_setup($1,$2,$3,$4,$5)`, [
        'phase4b-walkin-pilot-2', org, branch, users.doctor, JSON.stringify(fields),
      ]),
    );
    const status = await run(db, 'select public.patient_pilot_status($1) r', [users.doctor]);
    assert.equal(status.registrationRequestId, setup.registrationRequestId);
    assert.equal(await run(db, 'select public.patient_pilot_status($1) r', [users.otherDoctor]), null);
    const otherRequest = await run(db, 'select public.patient_pilot_begin($1,$2,$3,$4) r', [
      users.doctor,
      '11111111-1111-4111-8111-111111111111',
      branch,
      JSON.stringify(fields),
    ]);
    assert.equal(otherRequest.pilot, false);
    await assert.rejects(() =>
      db.query('select public.patient_pilot_begin($1,$2,$3,$4)', [
        users.otherDoctor,
        setup.registrationRequestId,
        branch,
        JSON.stringify(fields),
      ]),
    );
    await assert.rejects(() =>
      db.query('select public.patient_pilot_begin($1,$2,$3,$4)', [
        users.doctor,
        setup.registrationRequestId,
        id(2, 2),
        JSON.stringify(fields),
      ]),
    );
    await assert.rejects(() =>
      db.query('select public.patient_pilot_begin($1,$2,$3,$4)', [
        users.doctor,
        setup.registrationRequestId,
        branch,
        JSON.stringify({ ...fields, ageYears: 33 }),
      ]),
    );
    const begin = await run(db, 'select public.patient_pilot_begin($1,$2,$3,$4) r', [
      users.doctor,
      setup.registrationRequestId,
      branch,
      JSON.stringify(fields),
    ]);
    assert.equal(begin.pilot, true);
    assert.equal(
      (await run(db, 'select public.patient_pilot_begin($1,$2,$3,$4) r', [
        users.doctor,
        setup.registrationRequestId,
        branch,
        JSON.stringify(fields),
      ])).pilot,
      true,
    );
    let registered: { id: string; patientCode: string };
    await db.exec('begin');
    try {
      registered = await asUser(db, users.doctor, async () => {
        const result = await db.query<{ r: { id: string; patientCode: string } }>(
          'select public.register_walk_in_patient($1,$2,$3) r',
          [branch, setup.registrationRequestId, JSON.stringify(fields)],
        );
        return result.rows[0].r;
      });
      await db.exec('commit');
    } catch (error) {
      await db.exec('rollback');
      throw error;
    }
    const patient = { id: registered.id, patient_code: registered.patientCode };
    const bound = await run(db, 'select public.patient_pilot_bind($1,$2,$3,$4) r', [
      setup.pilotId, users.doctor, patient.id, patient.patient_code,
    ]);
    assert.equal(bound.state, 'registered');
    const otherPatient = (
      await db.query<{ id: string; patient_code: string }>(
        `insert into public.patients(organization_id,home_branch_id,name,age_years,age_recorded_on,gender)
         values($1,$2,'Pilot Duplicate Patient',30,current_date,'Female') returning id,patient_code`,
        [org, branch],
      )
    ).rows[0];
    await assert.rejects(() =>
      db.query('select public.patient_pilot_bind($1,$2,$3,$4)', [
        setup.pilotId, users.doctor, otherPatient.id, otherPatient.patient_code,
      ]),
    );
    await assert.rejects(() =>
      db.query('select public.patient_pilot_authorize_provision($1,$2)', [users.otherDoctor, patient.id]),
    );
    const authorized = await run(db, 'select public.patient_pilot_authorize_provision($1,$2) r', [
      users.doctor, patient.id,
    ]);
    assert.equal(authorized.state, 'provisioning');
    await assert.rejects(() =>
      db.query('select public.patient_pilot_authorize_provision($1,$2)', [users.doctor, patient.id]),
    );
    await db.query('select public.patient_pilot_mark_provisioned($1,$2)', [setup.pilotId, patient.id]);
    await assert.rejects(() =>
      db.query('select public.patient_pilot_authorize_handover($1,$2)', [users.otherDoctor, patient.id]),
    );
    const handover = await run(db, 'select public.patient_pilot_authorize_handover($1,$2) r', [
      users.doctor, patient.id,
    ]);
    assert.equal(handover.state, 'handover');
    assert.equal(await run(db, 'select public.patient_pilot_complete($1) r', [patient.id]), true);
    assert.equal(await run(db, 'select public.patient_pilot_complete($1) r', [patient.id]), false);
    await assert.rejects(() =>
      db.query('select public.patient_pilot_authorize_provision($1,$2)', [users.doctor, patient.id]),
    );
    const acl = await run(db, `select jsonb_build_object(
      'rls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='clinic_private.patient_pilot_authorizations'::regclass),
      'authedSelect',has_table_privilege('authenticated','clinic_private.patient_pilot_authorizations','select'),
      'authedSetup',has_function_privilege('authenticated','public.patient_pilot_setup(text,uuid,uuid,uuid,jsonb)','execute'),
      'serviceSetup',has_function_privilege('service_role','public.patient_pilot_setup(text,uuid,uuid,uuid,jsonb)','execute'),
      'anonBegin',has_function_privilege('anon','public.patient_pilot_begin(uuid,uuid,uuid,jsonb)','execute')
    ) r`);
    assert.deepEqual(acl, { rls: true, authedSelect: false, authedSetup: false, serviceSetup: true, anonBegin: false });
  } finally {
    await db.close();
  }
});

test('pilot quarantine and expiry fail closed', async (t) => {
  const db = await fresh();
  try {
    const setup = await run(db, 'select public.patient_pilot_setup($1,$2,$3,$4,$5) r', [
      'phase4b-quarantine', org, branch, users.doctor, JSON.stringify(fields),
    ]);
    await run(db, 'select public.patient_pilot_begin($1,$2,$3,$4) r', [
      users.doctor, setup.registrationRequestId, branch, JSON.stringify(fields),
    ]);
    const patient = (
      await db.query<{ id: string; patient_code: string }>(
        `insert into public.patients(organization_id,home_branch_id,name,age_years,age_recorded_on,gender)
         values($1,$2,'Pilot Quarantine Patient',32,current_date,'Female') returning id,patient_code`,
        [org, branch],
      )
    ).rows[0];
    await run(db, 'select public.patient_pilot_bind($1,$2,$3,$4) r', [
      setup.pilotId, users.doctor, patient.id, patient.patient_code,
    ]);
    await run(db, 'select public.patient_pilot_authorize_provision($1,$2) r', [users.doctor, patient.id]);
    await db.query('select public.patient_pilot_quarantine($1,$2)', [setup.pilotId, 'Synthetic ambiguous provider']);
    await assert.rejects(() =>
      db.query('select public.patient_pilot_authorize_provision($1,$2)', [users.doctor, patient.id]),
    );
    const expired = await fresh();
    try {
      const expiredSetup = await run(expired, 'select public.patient_pilot_setup($1,$2,$3,$4,$5) r', [
        'phase4b-expiry', org, branch, users.doctor, JSON.stringify(fields),
      ]);
      await expired.query("update clinic_private.patient_pilot_authorizations set created_at=clock_timestamp()-interval '2 days', expires_at=clock_timestamp()-interval '1 day' where pilot_id=$1", [expiredSetup.pilotId]);
      await assert.rejects(() =>
        expired.query('select public.patient_pilot_begin($1,$2,$3,$4)', [
          users.doctor, expiredSetup.registrationRequestId, branch, JSON.stringify(fields),
        ]),
      );
    } finally {
      await expired.close();
    }
  } finally {
    await db.close();
  }
});
