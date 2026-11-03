// Local proposal/bundle only. Remote apply is explicitly gated by the user.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const candidate = '20261027164031_clinic_doctor_verified_email.sql';
const root = 'supabase/proposals/doctor-profile',
  bundle = 'artifacts/doctor-profile-deployment';
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const source = await readFile(
  'supabase/proposals/staff-booking/20261027105809_clinic_staff_booking_profiles.sql',
  'utf8',
);
let fn = source.slice(
  source.indexOf('create or replace function clinic_private.read_profile'),
  source.indexOf('create or replace function clinic_private.save_profile'),
);
assert.ok(fn.trim().endsWith('end $$;'));
const old =
  "'canEdit',clinic_private.profile_allowed(o,k,t,true),'loginEmail',case when uid=auth.uid() then clinic_private.phase2b_verified_email(uid) else null end);";
assert.ok(fn.includes(old));
fn = fn.replace(
  old,
  `'canEdit',clinic_private.profile_allowed(o,k,t,true),
   'loginEmailVisible',coalesce(uid=auth.uid() or (k='doctor' and clinic_private.has_role(o,array['admin']::public.clinic_role[]) and clinic_private.profile_allowed(o,k,t,true)),false),
   'loginEmail',case when uid=auth.uid() then clinic_private.phase2b_verified_email(uid)
     when k='doctor' and clinic_private.has_role(o,array['admin']::public.clinic_role[]) and clinic_private.profile_allowed(o,k,t,true) then
       (select u.email from auth.users u where u.id=uid and u.email_confirmed_at is not null
         and (u.banned_until is null or u.banned_until<now()) and u.deleted_at is null
         and exists(select 1 from public.profiles p where p.id=uid and p.active))
     else null end);`,
);
const sql = `-- Additive proposal: no remote execution without explicit approval.
-- Only scoped Doctor managers gain the Doctor's verified Auth email in the existing response.
begin;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or
    (select md5(prosrc) from pg_proc where oid='clinic_private.read_profile(uuid,text,uuid)'::regprocedure) is distinct from 'dadc37f5883879f3fb0827e12bdaa671' then
   raise exception 'Reviewed PostgreSQL 17 profile function baseline required'; end if;
end $$;
${fn}
notify pgrst, 'reload schema';
commit;
`;
await mkdir(root, { recursive: true });
await mkdir(`${bundle}/supabase/migrations`, { recursive: true });
await writeFile(`${root}/${candidate}`, sql);
await writeFile(`${bundle}/supabase/migrations/${candidate}`, sql);
const base = await json('supabase/migration-manifest.json');
const files = base.candidateMigrations.map((m) => ({
  ...m,
  source: `supabase/migrations/${m.file}`,
}));
for (const folder of [
  'phase2b',
  'phase2c',
  'profiles',
  'patient-ids',
  'patient-age',
  'walk-in',
  'staff-booking',
  'patient-registration',
]) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, 'jyigxpjvygvtvcypujel');
  assert.equal(m.remoteApplied, true);
  files.push({
    file: m.candidate,
    sha256: m.sha256,
    source: `supabase/proposals/${folder}/${m.candidate}`,
  });
}
for (const f of files) {
  assert.equal(sha(await readFile(f.source)), f.sha256, f.file);
  await copyFile(f.source, `${bundle}/supabase/migrations/${f.file}`);
}
assert.deepEqual(
  (await readdir(`${bundle}/supabase/migrations`)).sort(),
  [...files.map((f) => f.file), candidate].sort(),
);
await copyFile(
  'artifacts/patient-registration-deployment/supabase/config.toml',
  `${bundle}/supabase/config.toml`,
);
const manifest = {
  projectRef: base.projectRef,
  candidate,
  sha256: sha(sql),
  remoteApplyApproved: false,
  remoteApplied: false,
  dependsOnVersions: files.map((f) => f.file.split('_')[0]),
  changedFunctions: ['clinic_private.read_profile(uuid,text,uuid)'],
  newTables: [],
  newGrants: [],
  rlsChanges: 0,
  seeds: [],
  roles: [],
};
for (const dir of [root, bundle])
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ verifiedPreviousFiles: files.length, ...manifest }));
