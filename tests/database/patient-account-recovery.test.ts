import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, asUser, users, id } from './harness';

const org = '88645fbe-34da-48aa-a509-c24441b7cf72';
const branch = id(2, 1);
const legacyPatient = '398cf267-bc60-41a4-91e6-478dcd86a069';
const recoveryUser = id(3, 20);
const recoveryPatientId = id(5, 20);
const provisionOperation = '33333333-3333-4333-8333-333333333333';
const pilotId = '44444444-4444-4444-8444-444444444444';
const pilotRequest = '55555555-5555-4555-8555-555555555555';
const internalEmail = '0123456789abcdef0123456789abcdef@accounts.sro.invalid';
const oldSessionId = id(7, 20);
const attestation =
  'I confirm that Ayesha Noor (SRO0009) is an authorized fictional clinic test record under operator control. I have verified the exact existing Patient, Auth identity, clinic ownership, original pilot, and quarantined handover state. I authorize one controlled test credential recovery without claiming physical Patient identity verification.';
const patientName = 'Recovery Synthetic Patient';
const fields = {
  name: patientName,
  ageYears: 32,
  gender: 'Female',
  email: '',
  phone: '',
  bloodGroup: '',
  address: '',
};
const recoveryFile =
  'sro0009-recovery/20261101120000_clinic_sro0009_recovery.sql';
const proof = randomBytes(32).toString('base64url');
const nonce = randomBytes(32).toString('base64url');
const hoHash = createHash('sha256').update(nonce).digest('hex');

type Fixture = Awaited<ReturnType<typeof fresh>>;

async function fresh() {
  const db = await createDatabase(false, (db) =>
    db.exec(`
      alter table auth.users add email text, add email_confirmed_at timestamptz, add banned_until timestamptz,
        add deleted_at timestamptz, add encrypted_password text, add last_sign_in_at timestamptz,
        add confirmation_sent_at timestamptz, add created_at timestamptz not null default now(),
        add raw_user_meta_data jsonb not null default '{}';
      create table auth.identities(user_id uuid,provider text,primary key(user_id,provider));
      create table auth.mfa_factors(user_id uuid,status text);
      create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text default gen_random_uuid()::text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated,anon,service_role;
      grant select,insert,update,delete on storage.objects to authenticated; grant select on storage.objects to anon;
    `),
  );
  const replay = async (file: string) => db.exec(await readFile('supabase/proposals/' + file, 'utf8'));
  for (const file of [
    'phase2b/20261026111934_clinic_auth_onboarding.sql',
    'phase2c/20261026123202_clinic_workspace_commands.sql',
    'profiles/20261026192535_clinic_profiles_avatars.sql',
  ])
    await replay(file);
  const fixture = (await readFile('supabase/fixtures/fictional.sql', 'utf8'))
    .replaceAll(id(1, 1), org)
    .replaceAll(id(5, 1), legacyPatient)
    .replaceAll('Fictional Patient A', 'Amina Noor');
  await db.exec(fixture);
  await db.exec('delete from public.medical_documents; delete from public.patient_medical_history;');
  await db.exec(
    `delete from public.patient_branches where patient_id<>'${legacyPatient}';
     delete from public.patients where id<>'${legacyPatient}';`,
  );
  await db.exec(
    `update auth.users set email=id::text||'@example.test',email_confirmed_at=now(),
      encrypted_password='fictional-hash';`,
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
    'patient-account-coordination/20261030065902_clinic_patient_account_coordination.sql',
    'patient-walkin-pilot/20261101090000_clinic_patient_walkin_pilot.sql',
    recoveryFile,
  ])
    await replay(file);

  await db.exec('update clinic_private.patient_number_counter set last_number=8');
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,now(),$3)',
    [recoveryUser, internalEmail, 'old-temp-hash'],
  );
  await db.query(
    "insert into auth.sessions(id,user_id,created_at,not_after) values($1,$2,now()-interval '2 hours',now()+interval '30 days')",
    [oldSessionId, recoveryUser],
  );
  const patient = (
    await db.query<{ id: string; patient_code: string }>(
      `insert into public.patients(organization_id,home_branch_id,name,date_of_birth,gender,age_years,age_recorded_on)
       values($1,$2,$3,'1994-01-01','Female',32,current_date) returning id,patient_code`,
      [org, branch, patientName],
    )
  ).rows[0];
  assert.equal(patient.patient_code, 'SRO0009');
  await db.query(
    'insert into public.patient_branches(organization_id,patient_id,branch_id) values($1,$2,$3)',
    [org, patient.id, branch],
  );
  await db.query(
    `insert into clinic_private.patient_accounts(
       organization_id,patient_id,branch_id,user_id,internal_email,state,operation_id,operated_by,
       operation_at,handover_hash,handover_expires_at,temporary_expires_at,password_fingerprint,session_valid_after)
     values($1,$2,$3,$4,$5,'pending_handover',$6,$7,now()-interval '10 minutes',
       decode(repeat('ab',32),'hex'),now()-interval '1 minute',now()+interval '20 hours',
       decode(repeat('cd',32),'hex'),now()-interval '10 minutes')`,
    [org, patient.id, branch, recoveryUser, internalEmail, provisionOperation, users.doctor],
  );
  await db.query(
    `insert into public.profiles(id,name,email) values($1,'Recovery Synthetic Patient','')`,
    [recoveryUser],
  );
  await db.query(
    'insert into public.organization_memberships(organization_id,user_id) values($1,$2)',
    [org, recoveryUser],
  );
  await db.query(
    'insert into public.branch_memberships(organization_id,branch_id,user_id) values($1,$2,$3)',
    [org, branch, recoveryUser],
  );
  await db.query(
    `insert into public.role_assignments(organization_id,user_id,role) values($1,$2,'patient')`,
    [org, recoveryUser],
  );
  await db.query('update public.patients set user_id=$1 where id=$2', [recoveryUser, patient.id]);
  await db.query(
    `insert into clinic_private.patient_operations(
       operation_id,organization_id,patient_id,actor_id,worker_id,request_id,purpose,
       proof_hash,phase,started_at,finished_at,provider_uid)
     values($1,$2,$3,$4,$5,$6,'provision',decode(repeat('ef',32),'hex'),'completed',
       now()-interval '10 minutes',now()-interval '10 minutes',$7)`,
    [provisionOperation, org, patient.id, users.doctor, randomUUID(), randomUUID(), recoveryUser],
  );
  await db.query(
    `insert into clinic_private.patient_pilot_authorizations(
       pilot_id,pilot_key,organization_id,branch_id,doctor_user_id,expected_fields,
       expected_fields_hash,registration_request_id,state,patient_id,patient_code,expires_at,
       registered_at,provisioned_at,handover_at,last_error)
     values($1,'synthetic-sro0009',$2,$3,$4,$5,decode(repeat('cd',32),'hex'),$6,'quarantined',$7,$8,
       now()+interval '7 days',now()-interval '5 minutes',now()-interval '5 minutes',
       now()-interval '1 minute','Synthetic handover expiry')`,
    [
      pilotId,
      org,
      branch,
      users.doctor,
      JSON.stringify({
        name: patientName,
        ageYears: 32,
        gender: 'Female',
        email: '',
        phone: '',
        bloodGroup: '',
        address: '',
      }),
      pilotRequest,
      patient.id,
      patient.patient_code,
    ],
  );
  await db.query(
    `update clinic_private.patient_account_recovery_targets
     set organization_id=$1,branch_id=$2,patient_id=$3,patient_code=$4,patient_name=$5,
       user_id=$6,provision_operation_id=$7,provision_actor_id=$8,pilot_id=$9,
       pilot_request_id=$10,admin_user_id=$11,attestation_text=$12
     where singleton`,
    [
      org,
      branch,
      patient.id,
      patient.patient_code,
      patientName,
      recoveryUser,
      provisionOperation,
      users.doctor,
      pilotId,
      pilotRequest,
      users.adminA,
      attestation,
    ],
  );
  const legacyBranch = (
    await db.query<{ home_branch_id: string }>(
      'select home_branch_id from public.patients where id=$1',
      [legacyPatient],
    )
  ).rows[0].home_branch_id;
  await db.query(
    `insert into clinic_private.patient_accounts(
       organization_id,patient_id,branch_id,user_id,state,operation_id,operated_by,
       operation_at,password_changed_at,session_valid_after)
     values($1,$2,$3,$4,'active',$5,$6,now()-interval '2 days',now()-interval '2 days',
       now()-interval '2 days')`,
    [org, legacyPatient, legacyBranch, users.patient, randomUUID(), users.adminA],
  );
  return { db, patient };
}

// JSON/RPC results are intentionally untyped at this SQL boundary; each assertion checks shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async <T = any>(
  db: Fixture['db'],
  text: string,
  values: unknown[] = [],
): Promise<T> => (await db.query<{ r?: T }>(text, values)).rows[0]?.r as T;

async function rejected(fn: () => Promise<unknown>, pattern?: RegExp) {
  if (pattern) await assert.rejects(fn, pattern);
  else await assert.rejects(fn);
}

test('SRO0009 recovery is exact, one-time, fenced and preserves identity', async (t) => {
  const { db, patient } = await fresh();
  try {
    const authBefore = await run(db, 'select count(*)::int r from auth.users');
    const recoveryPatientBefore = await run(
      db,
      'select jsonb_build_object(\'id\',id,\'user\',user_id,\'code\',patient_code) r from public.patients where id=$1',
      [patient.id],
    );
    const unrelatedBefore = await run(
      db,
      'select jsonb_build_object(\'state\',state,\'user\',user_id,\'changed\',password_changed_at) r from clinic_private.patient_accounts where patient_id=$1',
      [legacyPatient],
    );
    const setup = () =>
      run(db, 'select public.patient_account_recovery_setup($1,$2) r', [
        users.adminA,
        attestation,
      ]);

    // Exact target/Admin/attestation and live state are required.
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_setup($1,$2)', [
        users.adminAll,
        attestation,
      ]),
    );
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_setup($1,$2)', [
        users.adminA,
        'Wrong attestation',
      ]),
    );
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_status($1)', [users.doctor]),
    );
    await db.query("update clinic_private.patient_pilot_authorizations set state='provisioned'");
    await rejected(setup);
    await db.query("update clinic_private.patient_pilot_authorizations set state='quarantined'");
    await db.query(
      "update clinic_private.patient_accounts set handover_expires_at=now()+interval '5 minutes' where patient_id=$1",
      [patient.id],
    );
    await rejected(setup);
    await db.query(
      "update clinic_private.patient_accounts set handover_expires_at=now()-interval '5 minutes' where patient_id=$1",
      [patient.id],
    );
    const prepared = await setup();
    assert.equal(prepared.state, 'prepared');
    await rejected(setup, /already prepared/i);
    const status = await run(db, 'select public.patient_account_recovery_status($1) r', [
      users.adminA,
    ]);
    assert.equal(status.state, 'prepared');
    assert.equal(status.reissueCount, 0);
    assert.equal(status.canReset, true);
    assert.equal(status.pilotState, 'quarantined');

    const operationId = randomUUID();
    const workerId = randomUUID();
    const requestId = randomUUID();
    const claim = () =>
      run(
        db,
        'select public.patient_account_recovery_claim($1,$2,$3,$4,$5) r',
        [users.adminA, operationId, workerId, proof, requestId],
      );
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_claim($1,$2,$3,$4,$5)', [
        users.doctor,
        operationId,
        workerId,
        proof,
        requestId,
      ]),
    );
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_claim($1,$2,$3,$4,$5)', [
        users.adminAll,
        operationId,
        workerId,
        proof,
        requestId,
      ]),
    );
    const claimed = await claim();
    assert.equal(claimed.state, 'claimed');
    assert.equal(claimed.operationId, operationId);
    const fence = claimed.fence as string;
    assert.match(fence, /^\d+$/);
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_claim($1,$2,$3,$4,$5)', [
        users.adminA,
        randomUUID(),
        randomUUID(),
        randomBytes(32).toString('base64url'),
        randomUUID(),
      ]),
    );
    await rejected(() =>
      db.query(
        `insert into clinic_private.patient_account_recoveries(
           recovery_key,organization_id,branch_id,patient_id,patient_code,user_id,pilot_id,
           admin_user_id,attestation,state)
         select recovery_key,organization_id,branch_id,patient_id,patient_code,user_id,pilot_id,
           admin_user_id,attestation,'prepared'
         from clinic_private.patient_account_recoveries`,
      ),
    );

    const command = (action: string, data: Record<string, unknown>) =>
      run(db, 'select public.patient_account_command($1,$2,$3,$4) r', [
        action,
        users.adminA,
        patient.id,
        JSON.stringify(data),
      ]);
    const operation = (action: string) =>
      run(db, 'select public.patient_account_operation($1,$2,$3,$4,$5,$6,$7) r', [
        action,
        users.adminA,
        patient.id,
        operationId,
        workerId,
        proof,
        JSON.stringify({ fence }),
      ]);
    const binding = { operationId, workerId, proof, fence };
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_reset($1,$2,$3,$4,$5)', [
        users.adminAll,
        operationId,
        workerId,
        proof,
        fence,
      ]),
    );
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_reset($1,$2,$3,$4,$5)', [
        users.adminA,
        operationId,
        workerId,
        randomBytes(32).toString('base64url'),
        fence,
      ]),
    );
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_reset($1,$2,$3,$4,$5)', [
        users.adminA,
        randomUUID(),
        workerId,
        proof,
        fence,
      ]),
    );
    const recoveryReset = await run(
      db,
      'select public.patient_account_recovery_reset($1,$2,$3,$4,$5) r',
      [users.adminA, operationId, workerId, proof, fence],
    );
    assert.equal(recoveryReset.patientId, patient.id);
    assert.equal(recoveryReset.userId, recoveryUser);
    const started = await operation('start');
    assert.equal(started.phase, 'started');
    await db.query("update auth.users set encrypted_password='new-temporary-hash' where id=$1", [
      recoveryUser,
    ]);
    const confirmed = await operation('confirm');
    assert.equal(confirmed.phase, 'confirmed');
    await command('commit', {
      operationId,
      workerId,
      proof,
      fence,
      handoverHash: hoHash,
    });
    const marked = await run(db, 'select public.patient_account_recovery_mark_handover($1,$2,$3) r', [
      users.adminA,
      operationId,
      proof,
    ]);
    assert.equal(marked.state, 'handover_pending');
    assert.ok(marked.handoverExpiresAt);

    const window = await run(db, 'select public.patient_account_handover_window($1,$2) r', [
      users.adminA,
      patient.id,
    ]);
    assert.equal(window.accountState, 'pending_handover');
    assert.equal(window.handoverExpired, false);
    assert.ok(window.handoverExpiresAt);
    assert.ok(window.serverNow);
    await rejected(() =>
      run(db, 'select public.patient_account_handover_window($1,$2)', [
        users.otherDoctor,
        patient.id,
      ]),
    );
    await rejected(() =>
      run(db, 'select public.patient_account_handover_window($1,$2)', [
        users.patient,
        patient.id,
      ]),
    );

    await rejected(() =>
      run(db, 'select public.patient_account_recovery_handover($1,$2,$3)', [
        users.adminA,
        operationId,
        randomBytes(32).toString('base64url'),
      ]),
    );
    await db.query(
      "update clinic_private.patient_accounts set handover_expires_at=now()-interval '1 minute' where patient_id=$1",
      [patient.id],
    );
    await rejected(
      () =>
        run(db, 'select public.patient_account_recovery_handover($1,$2,$3)', [
          users.adminA,
          operationId,
          nonce,
        ]),
      /Handover expired/,
    );
    await db.query(
      "update clinic_private.patient_accounts set handover_expires_at=now()+interval '5 minutes' where patient_id=$1",
      [patient.id],
    );
    await db.query(
      "update clinic_private.patient_account_recoveries set handover_expires_at=now()+interval '5 minutes' where patient_id=$1",
      [patient.id],
    );
    const handover = await run(db, 'select public.patient_account_recovery_handover($1,$2,$3) r', [
      users.adminA,
      operationId,
      nonce,
    ]);
    assert.equal(handover.state, 'handover_confirmed');
    const afterHandover = await run(
      db,
      'select jsonb_build_object(\'state\',state,\'hash\',handover_hash is not null,\'expiry\',handover_expires_at) r from clinic_private.patient_accounts where patient_id=$1',
      [patient.id],
    );
    assert.equal(afterHandover.state, 'change_required');
    assert.equal(afterHandover.hash, false);
    assert.equal(afterHandover.expiry, null);
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_handover($1,$2,$3)', [
        users.adminA,
        operationId,
        nonce,
      ]),
    );
    await rejected(() =>
      db.query(
        "select public.patient_account_command('handover',$1,$2,$3)",
        [
          users.adminA,
          patient.id,
          JSON.stringify({ operationId, handoverHash: hoHash }),
        ],
      ),
    );
    assert.equal(
      (
        await run(
          db,
          'select state r from clinic_private.patient_pilot_authorizations where pilot_id=$1',
          [pilotId],
        )
      ),
      'quarantined',
    );

    const sessionId = randomUUID();
    await db.query(
      'insert into auth.sessions(id,user_id,created_at,not_after) values($1,$2,now(),now()+interval \'30 days\')',
      [sessionId, recoveryUser],
    );
    await db.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: recoveryUser, session_id: sessionId }),
    ]);
    assert.equal(
      await run(db, 'select clinic_private.patient_account_session($1) r', [recoveryUser]),
      false,
    );
    await db.query(
      `update clinic_private.patient_accounts
       set state='active',password_changed_at=now(),allowed_session=$1,password_fingerprint=null,
         session_valid_after=now()-interval '1 minute'
       where patient_id=$2`,
      [sessionId, patient.id],
    );
    await db.query("update auth.users set encrypted_password='permanent-synthetic-hash' where id=$1", [
      recoveryUser,
    ]);
    await db.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: recoveryUser, session_id: oldSessionId }),
    ]);
    assert.equal(
      await run(db, 'select clinic_private.patient_account_session($1) r', [recoveryUser]),
      false,
    );
    await db.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: recoveryUser, session_id: sessionId }),
    ]);
    assert.equal(
      await run(db, 'select clinic_private.patient_account_session($1) r', [recoveryUser]),
      true,
    );
    assert.equal(
      await run(db, 'select public.patient_account_recovery_first_change($1,$2) r', [
        recoveryUser,
        patient.id,
      ]),
      true,
    );
    assert.equal(
      await run(db, 'select public.patient_account_recovery_first_change($1,$2) r', [
        recoveryUser,
        patient.id,
      ]),
      true,
    );
    const recoveryAfter = await run(
      db,
      'select jsonb_build_object(\'state\',state,\'reissues\',reissue_count,\'operation\',operation_id) r from clinic_private.patient_account_recoveries where patient_id=$1',
      [patient.id],
    );
    assert.equal(recoveryAfter.state, 'completed');
    assert.equal(recoveryAfter.reissues, 1);
    assert.equal(recoveryAfter.operation, operationId);

    const authAfter = await run(db, 'select count(*)::int r from auth.users');
    const recoveryPatientAfter = await run(
      db,
      'select jsonb_build_object(\'id\',id,\'user\',user_id,\'code\',patient_code) r from public.patients where id=$1',
      [patient.id],
    );
    const unrelatedAfter = await run(
      db,
      'select jsonb_build_object(\'state\',state,\'user\',user_id,\'changed\',password_changed_at) r from clinic_private.patient_accounts where patient_id=$1',
      [legacyPatient],
    );
    assert.deepEqual(recoveryPatientAfter, recoveryPatientBefore);
    assert.deepEqual(unrelatedAfter, unrelatedBefore);
    assert.equal(authAfter, authBefore);
    assert.equal(
      (
        await run(
          db,
          'select state r from clinic_private.patient_pilot_authorizations where pilot_id=$1',
          [pilotId],
        )
      ),
      'quarantined',
    );

    const acl = await run(
      db,
      `select jsonb_build_object(
        'targetRls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='clinic_private.patient_account_recovery_targets'::regclass),
        'recoveryRls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='clinic_private.patient_account_recoveries'::regclass),
        'authedTarget',has_table_privilege('authenticated','clinic_private.patient_account_recovery_targets','select'),
        'serviceRecovery',has_table_privilege('service_role','clinic_private.patient_account_recoveries','select'),
        'authedSetup',has_function_privilege('authenticated','public.patient_account_recovery_setup(uuid,text)','execute'),
        'anonClaim',has_function_privilege('anon','public.patient_account_recovery_claim(uuid,uuid,uuid,text,uuid)','execute'),
        'serviceClaim',has_function_privilege('service_role','public.patient_account_recovery_claim(uuid,uuid,uuid,text,uuid)','execute'),
        'authedWindow',has_function_privilege('authenticated','public.patient_account_handover_window(uuid,uuid)','execute'),
        'serviceWindow',has_function_privilege('service_role','public.patient_account_handover_window(uuid,uuid)','execute')
      ) r`,
    );
    assert.deepEqual(acl, {
      targetRls: true,
      recoveryRls: true,
      authedTarget: false,
      serviceRecovery: false,
      authedSetup: false,
      anonClaim: false,
      serviceClaim: true,
      authedWindow: false,
      serviceWindow: true,
    });
    await rejected(() =>
      asUser(db, users.adminA, () =>
        db.query('select * from clinic_private.patient_account_recoveries'),
      ),
    );
  } finally {
    await db.close();
  }
});

test('recovery failure is fenced and a second reissue is impossible', async (t) => {
  const { db, patient } = await fresh();
  try {
    await run(db, 'select public.patient_account_recovery_setup($1,$2) r', [
      users.adminA,
      attestation,
    ]);
    const operationId = randomUUID();
    const workerId = randomUUID();
    const fence = (
      await run(db, 'select public.patient_account_recovery_claim($1,$2,$3,$4,$5) r', [
        users.adminA,
        operationId,
        workerId,
        proof,
        randomUUID(),
      ])
    ).fence as string;
    await rejected(() =>
      run(db, 'select public.patient_account_operation($1,$2,$3,$4,$5,$6,$7)', [
        'start',
        users.adminA,
        patient.id,
        operationId,
        workerId,
        proof,
        JSON.stringify({ fence }),
      ]),
    );
    // A failed claim/start transition is quarantined in the durable operation and recovery rows.
    await run(db, 'select public.patient_account_recovery_quarantine($1,$2,$3) r', [
      users.adminA,
      operationId,
      'Synthetic provider failure',
    ]);
    const state = await run(
      db,
      'select jsonb_build_object(\'recovery\',state,\'error\',last_error) r from clinic_private.patient_account_recoveries where patient_id=$1',
      [patient.id],
    );
    assert.equal(state.recovery, 'quarantined');
    assert.match(state.error, /Synthetic provider failure/);
    await rejected(() =>
      run(db, 'select public.patient_account_recovery_claim($1,$2,$3,$4,$5)', [
        users.adminA,
        randomUUID(),
        randomUUID(),
        randomBytes(32).toString('base64url'),
        randomUUID(),
      ]),
    );
    const account = await run(
      db,
      'select jsonb_build_object(\'state\',state,\'user\',user_id) r from clinic_private.patient_accounts where patient_id=$1',
      [patient.id],
    );
    assert.deepEqual(account, { state: 'pending_handover', user: recoveryUser });
    assert.equal(
      (
        await run(
          db,
          'select state r from clinic_private.patient_pilot_authorizations where pilot_id=$1',
          [pilotId],
        )
      ),
      'quarantined',
    );
    assert.equal(await run(db, 'select count(*)::int r from auth.users'), 14);
  } finally {
    await db.close();
  }
});
