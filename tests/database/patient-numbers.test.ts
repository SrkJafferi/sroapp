import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createDatabase,id,users,asUser} from './harness';
const org='88645fbe-34da-48aa-a509-c24441b7cf72',patient='398cf267-bc60-41a4-91e6-478dcd86a069',branch=id(2,1);
test('permanent patient number candidate',async t=>{
 const db=await createDatabase(false,db=>db.exec(`alter table auth.users add email text,add email_confirmed_at timestamptz,add banned_until timestamptz,add deleted_at timestamptz;create table auth.mfa_factors(user_id uuid,status text);`));
 try {
  for(const file of ['supabase/proposals/phase2b/20261026111934_clinic_auth_onboarding.sql','supabase/proposals/phase2c/20261026123202_clinic_workspace_commands.sql'])await db.exec(await readFile(file,'utf8'));
  let fixture=await readFile('supabase/fixtures/fictional.sql','utf8');fixture=fixture.replaceAll(id(1,1),org).replaceAll(id(5,1),patient).replaceAll('Fictional Patient A','Amina Noor');await db.exec(fixture);
  await db.query('delete from public.medical_documents where patient_id<>$1',[patient]);await db.query('delete from public.patient_medical_history where patient_id<>$1',[patient]);await db.query('delete from public.patient_branches where patient_id<>$1',[patient]);await db.query('delete from public.patients where id<>$1',[patient]);
  await db.exec(`update auth.users set email=id::text||'@example.test',email_confirmed_at=now();insert into clinic_private.auth_setup(organization_id,registration_branch_id,bootstrap_user_id) values('${org}','${branch}','${users.adminA}');`);
  const before=await db.query('select id,organization_id,user_id,home_branch_id,name from public.patients');
  await db.exec(await readFile('supabase/proposals/patient-ids/20261026195847_clinic_patient_numbers.sql','utf8'));
  await db.exec('begin');
  const isolated=async(fn:()=>Promise<void>)=>{await db.exec('savepoint test_scope');try{await fn();}finally{await db.exec('rollback to savepoint test_scope;release savepoint test_scope');}};
  const attempt=async<T>(fn:()=>Promise<T>)=>{await db.exec('savepoint attempt_scope');try{return await fn();}catch(e){await db.exec('rollback to savepoint attempt_scope');throw e;}finally{await db.exec('release savepoint attempt_scope');}};
  const register=async(u=users.otherPatient,name='Fictional Registered Patient')=>attempt(async()=>{
   await db.exec('set role service_role');try{return await db.query<{id:string}>('select public.phase2b_patient($1,$2) id',[u,JSON.stringify({name,phone:'000',dateOfBirth:'1990-01-01',gender:'Other',address:'Fictional address'})]);}finally{await db.exec('reset role');}
  });
  const code=async(pid=patient)=>(await db.query<{patient_code:string;patient_number:number}>('select patient_code,patient_number from public.patients where id=$1',[pid])).rows[0];
  const counter=async()=>Number((await db.query<{n:number}>('select last_number n from clinic_private.patient_number_counter')).rows[0].n);
  const insert=(b=branch,o=org)=>db.query<{id:string}>(`insert into public.patients(organization_id,home_branch_id,name,date_of_birth,gender) values($1,$2,'Fictional New Patient','1990-01-01','Other') returning id`,[o,b]);
  await t.test('backfill is exactly SRO0001 and preserves UUIDs and relationships',async()=>{assert.deepEqual((await db.query('select id,organization_id,user_id,home_branch_id,name from public.patients')).rows,before.rows);assert.equal((await code()).patient_code,'SRO0001');assert.equal(await counter(),1);});
  await t.test('normal verified registration allocates SRO0002 and all onboarding rows atomically',()=>isolated(async()=>{const pid=(await register()).rows[0].id;assert.equal((await code(pid)).patient_code,'SRO0002');assert.equal(await counter(),2);assert.equal((await db.query('select 1 from public.patient_branches where patient_id=$1',[pid])).rows.length,1);}));
  await t.test('existing registration/profile upserts preserve number and do not consume IDs',()=>isolated(async()=>{await register(users.patient,'Amina Noor Updated');assert.equal((await code()).patient_code,'SRO0001');assert.equal(await counter(),1);const pid=(await register()).rows[0].id;await register(users.otherPatient,'Fictional Updated Again');assert.equal((await code(pid)).patient_code,'SRO0002');assert.equal(await counter(),2);}));
  await t.test('failed registration rolls back counter and every provisioning side effect',()=>isolated(async()=>{
   await db.exec(`create function clinic_private.test_fail_patient_branch() returns trigger language plpgsql as $$ begin raise exception 'Fictional downstream failure'; end $$; create trigger test_fail_patient_branch before insert on public.patient_branches for each row execute function clinic_private.test_fail_patient_branch();`);
   const prior=(await db.query('select * from public.profiles where id=$1',[users.otherPatient])).rows;
   await assert.rejects(register());assert.equal(await counter(),1);assert.equal((await db.query('select * from public.patients')).rows.length,1);assert.deepEqual((await db.query('select * from public.profiles where id=$1',[users.otherPatient])).rows,prior);
   await db.exec('drop trigger test_fail_patient_branch on public.patient_branches');const pid=(await register()).rows[0].id;assert.equal((await code(pid)).patient_code,'SRO0002');
  }));
  await t.test('multi-row inserts have unique consecutive numbers, shared across branches and organizations',()=>isolated(async()=>{
   await db.query(`insert into public.patients(organization_id,home_branch_id,name,date_of_birth,gender) values($1,$2,'Fictional Branch Two','1990-01-01','Other'),($3,$4,'Fictional Other Organization','1990-01-01','Other')`,[org,id(2,2),id(1,2),id(2,3)]);
   assert.deepEqual((await db.query<{c:string}>('select patient_code c from public.patients order by patient_number')).rows.map(r=>r.c),['SRO0001','SRO0002','SRO0003']);
  }));
  await t.test('rollback and savepoint rollback restore uncommitted allocations',()=>isolated(async()=>{await db.exec('savepoint abandoned');await insert();await db.exec('rollback to savepoint abandoned;release savepoint abandoned');assert.equal(await counter(),1);const pid=(await insert()).rows[0].id;assert.equal((await code(pid)).patient_code,'SRO0002');}));
  await t.test('deleting the highest assigned number never reuses it',()=>isolated(async()=>{const pid=(await insert()).rows[0].id;await db.query('delete from public.patients where id=$1',[pid]);const next=(await insert()).rows[0].id;assert.equal((await code(next)).patient_code,'SRO0003');}));
  await t.test('9999 grows to 10000 and bigint display never truncates or rounds',()=>isolated(async()=>{await db.exec('update clinic_private.patient_number_counter set last_number=9998');assert.equal((await code((await insert()).rows[0].id)).patient_code,'SRO9999');assert.equal((await code((await insert()).rows[0].id)).patient_code,'SRO10000');await db.exec('update clinic_private.patient_number_counter set last_number=9007199254740992');assert.equal((await code((await insert()).rows[0].id)).patient_code,'SRO9007199254740993');}));
  await t.test('allowed profile field updates preserve the identifier and consume no number',()=>isolated(async()=>{
   await db.query("update public.patients set name='Amina Noor Updated',phone='000',address='Fictional new address' where id=$1",[patient]);
   assert.equal((await code()).patient_code,'SRO0001');assert.equal(await counter(),1);
  }));
  await t.test('manual supplied numbers, reassignments and generated code overrides are denied',async()=>{
   await assert.rejects(attempt(()=>db.query(`insert into public.patients(organization_id,home_branch_id,name,date_of_birth,gender,patient_number) values($1,$2,'Fictional Forged','1990-01-01','Other',99)`,[org,branch])));
   await assert.rejects(attempt(()=>db.query('update public.patients set patient_number=99 where id=$1',[patient])));
   await assert.rejects(attempt(()=>db.query("update public.patients set patient_code='SRO0099' where id=$1",[patient])));
   assert.equal(await counter(),1);
  });
  await t.test('ordinary Patient, Doctor, Admin and anonymous requests cannot alter numbers or counters',async()=>{
   for(const u of [users.patient,users.doctor,users.adminA]){
    await assert.rejects(asUser(db,u,()=>db.exec('update public.patients set patient_number=9')));
    await assert.rejects(asUser(db,u,()=>db.exec('select * from clinic_private.patient_number_counter')));
    await assert.rejects(asUser(db,u,()=>db.exec("update clinic_private.patient_number_counter set last_number=9")));
   }
   await assert.rejects(asUser(db,null,()=>db.exec('select * from public.patients'),'anon'));
  });
  await t.test('SRO search remains RLS-scoped; no public lookup RPC is added',async()=>{
   const own=await asUser(db,users.patient,()=>db.query("select id from public.patients where patient_code='SRO0001'"));assert.equal(own.rows.length,1);
   const other=await asUser(db,users.otherPatient,()=>db.query("select id from public.patients where patient_code='SRO0001'"));assert.equal(other.rows.length,0);
   const doctor=await asUser(db,users.otherDoctor,()=>db.query("select id from public.patients where patient_code='SRO0001'"));assert.equal(doctor.rows.length,0);
  });
  await t.test('known-key ignored inserts do not consume a number',()=>isolated(async()=>{
   await db.query(`insert into public.patients(id,organization_id,home_branch_id,name,date_of_birth,gender) values($1,$2,$3,'Fictional Ignored','1990-01-01','Other') on conflict(id) do nothing`,[patient,org,branch]);assert.equal(await counter(),1);
  }));
  await t.test('counter/trigger grants deny service and authenticated direct allocation',async()=>{
   const rows=await db.query<{ok:boolean}>(`select not has_function_privilege(role,'clinic_private.patient_number_guard()','execute') and not has_table_privilege(role,'clinic_private.patient_number_counter','select,insert,update,delete') ok from (values('anon'),('authenticated'),('service_role')) v(role)`);assert.ok(rows.rows.every(r=>r.ok));
  });
  await db.exec('rollback');
 }finally{await db.close();}
});
