// Local-only bundle. Never applies remote migrations.
import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = 'supabase/proposals/department-edit',
  bundle = 'artifacts/department-edit-deployment';
const candidate = '20261027170222_clinic_department_edit.sql',
  ref = 'jyigxpjvygvtvcypujel';
const json = async (f) => JSON.parse(await readFile(f, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
try {
  assert.notEqual(
    (await json(`${root}/manifest.json`)).remoteApplied,
    true,
    'Already deployed. Preserve evidence.',
  );
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const source = await readFile(
  'supabase/proposals/phase2c/20261026123202_clinic_workspace_commands.sql',
  'utf8',
);
let fn = source.slice(
  source.indexOf('create function clinic_private.manage_clinic'),
  source.indexOf('create function clinic_private.save_patient_history'),
);
assert.ok(fn.trim().endsWith('end $$;'));
fn = fn
  .replace('create function', 'create or replace function')
  .replace("'department','doctor'", "'department','department_update','doctor'");
const marker = "  elsif p_action='doctor' then\n    if d.organization_id<>o";
assert.ok(fn.includes(marker));
fn = fn.replace(
  marker,
  `  elsif p_action='department_update' then
    target:=(p_data->>'id')::uuid;
    if p_data->>'name' is null or length(btrim(p_data->>'name')) not between 2 and 100 or length(coalesce(p_data->>'description',''))>2000 then
      raise exception 'Invalid department fields' using errcode='22023'; end if;
    update public.specializations set name=btrim(p_data->>'name'),description=btrim(coalesce(p_data->>'description',''))
      where organization_id=o and id=target;
    if not found then raise exception 'Department scope denied' using errcode='42501'; end if;
  elsif p_action='doctor' then
    if d.organization_id<>o`,
);
const sql = `-- Separate approval required. One existing private function; no new tables/grants/policies.
begin;
do $$ begin
 if current_setting('server_version_num')::int/10000<>17 or
    (select md5(prosrc) from pg_proc where oid='clinic_private.manage_clinic(uuid,text,jsonb)'::regprocedure) is distinct from '7bf548852330446e483a1385501c8ebc' then
   raise exception 'Reviewed PostgreSQL 17 clinic command baseline required'; end if;
end $$;
${fn}
notify pgrst, 'reload schema';
commit;
`;
await mkdir(root, { recursive: true });
await mkdir(`${bundle}/supabase/migrations`, { recursive: true });
const base = await json('supabase/migration-manifest.json');
assert.equal(base.projectRef, ref);
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
  'doctor-profile',
]) {
  const m = await json(`supabase/proposals/${folder}/manifest.json`);
  assert.equal(m.projectRef, ref);
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
await writeFile(`${root}/${candidate}`, sql);
await writeFile(`${bundle}/supabase/migrations/${candidate}`, sql);
assert.deepEqual(
  (await readdir(`${bundle}/supabase/migrations`)).sort(),
  [...files.map((f) => f.file), candidate].sort(),
);
await copyFile(
  'artifacts/doctor-profile-deployment/supabase/config.toml',
  `${bundle}/supabase/config.toml`,
);
const manifest = {
  projectRef: ref,
  candidate,
  sha256: sha(sql),
  remoteApplyApproved: false,
  remoteApplied: false,
  dependsOnVersions: files.map((f) => f.file.split('_')[0]),
  changedFunctions: ['clinic_private.manage_clinic(uuid,text,jsonb)'],
  newTables: [],
  newGrants: [],
  rlsChanges: 0,
  seeds: [],
  roles: [],
};
for (const d of [root, bundle])
  await writeFile(`${d}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ verifiedPreviousFiles: files.length, ...manifest }));
