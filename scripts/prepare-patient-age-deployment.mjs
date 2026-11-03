// Builds a strictly isolated local bundle. Does not link or execute remote SQL.
import { readFile, writeFile, copyFile, mkdir, readdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = 'supabase/proposals/patient-age';
const candidate = '20261026224947_clinic_patient_age.sql';
const projectRef = 'jyigxpjvygvtvcypujel';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [core, phase2b, phase2c, profiles, patientIds] = await Promise.all(
  [
    'supabase/migration-manifest.json',
    'supabase/proposals/phase2b/manifest.json',
    'supabase/proposals/phase2c/manifest.json',
    'supabase/proposals/profiles/manifest.json',
    'supabase/proposals/patient-ids/manifest.json',
  ].map(readJson),
);
for (const manifest of [core, phase2b, phase2c, profiles, patientIds])
  assert.equal(manifest.projectRef, projectRef);
for (const manifest of [phase2b, phase2c, profiles, patientIds]) assert.equal(manifest.remoteApplied, true);
const baseline = [
  ...core.candidateMigrations.map((m) => ({
    ...m,
    source: `supabase/migrations/${m.file}`,
  })),
  ...[
    ['phase2b', phase2b],
    ['phase2c', phase2c],
    ['profiles', profiles],
    ['patient-ids', patientIds],
  ].map(([folder, manifest]) => ({
    file: manifest.candidate,
    sha256: manifest.sha256,
    source: `supabase/proposals/${folder}/${manifest.candidate}`,
  })),
];
assert.equal(baseline.length, 7);
assert.equal(new Set(baseline.map((f) => f.file.split('_')[0])).size, 7);
assert.equal(patientIds.remoteAppliedVersion, '20261026195847');
assert.ok(Number(candidate.split('_')[0]) > Number(patientIds.remoteAppliedVersion));

const candidateBytes = await readFile(`${root}/${candidate}`);
const source = candidateBytes.toString('utf8');
for (const required of [
  'add column age_years smallint',
  'add column age_recorded_on date',
  'alter column date_of_birth drop not null',
  "array['name','gender','ageYears','phone','email','address']",
  'date_of_birth=coalesce(patient_row.date_of_birth,excluded.date_of_birth)',
  "notify pgrst,'reload schema'",
])
  assert.ok(source.includes(required), `candidate is missing: ${required}`);
assert.ok(!source.includes('date_of_birth=excluded.date_of_birth'));
assert.ok(!source.includes('update public.patients set date_of_birth'));

const preflight = await readJson('artifacts/patient-age-deployment/preflight-report.json');
assert.equal(preflight.readOnly, true);
assert.equal(preflight.projectRef, projectRef);
const remote = preflight.result;
assert.equal(remote.patientCount, 1);
assert.equal(remote.patient.id, '398cf267-bc60-41a4-91e6-478dcd86a069');
assert.equal(remote.patient.organizationId, '88645fbe-34da-48aa-a509-c24441b7cf72');
assert.equal(remote.patient.name, 'Amina Noor');
assert.equal(remote.patient.patientCode, 'SRO0001');
assert.equal(remote.patient.dateOfBirth, '1994-04-12');
assert.equal(remote.dateOfBirthColumn.nullable, 'NO');
assert.equal(remote.ageColumnsPresent, false);
assert.equal(remote.medicalHistory.rows, 1);
assert.equal(remote.medicalHistory.bloodGroup, null);
assert.deepEqual(remote.migrations, [
  '20261026024332',
  '20261026024335',
  '20261026024338',
  '20261026111934',
  '20261026123202',
  '20261026192535',
  '20261026195847',
]);
const fingerprintCheck = await readJson(
  'artifacts/patient-age-deployment/baseline-fingerprint-check.json',
);
assert.equal(fingerprintCheck.matches, true);

const [year, month, day] = remote.patient.dateOfBirth.split('-').map(Number);
const now = new Date();
const ageToday =
  now.getUTCFullYear() -
  year -
  (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day) ? 1 : 0);

const manifest = {
  projectRef,
  remoteApplyApproved: false,
  remoteApplied: false,
  candidate,
  sha256: hash(candidateBytes),
  dependsOnVersions: baseline.map((f) => f.file.split('_')[0]),
  newColumns: ['public.patients.age_years', 'public.patients.age_recorded_on'],
  nullableChanged: ['public.patients.date_of_birth (NOT NULL -> nullable)'],
  newConstraints: [
    'patients_age_years_range',
    'patients_age_recorded_pair',
    'patients_age_recorded_on_range',
    'patients_age_known',
  ],
  replacedFunctions: [
    'clinic_private.read_profile(uuid,text,uuid)',
    'clinic_private.save_profile(uuid,text,uuid,jsonb,text,uuid)',
    'public.phase2b_patient(uuid,jsonb)',
  ],
  newPublicRpcs: 0,
  changedExistingPolicies: 0,
  changedExistingMigrations: 0,
  existingClinicalRecordsModified: false,
  existingBirthDatesModified: false,
  backfill: 'None. Amina Noor keeps 1994-04-12; age-only records store age_years plus age_recorded_on.',
  seedIncluded: false,
  rolesFileIncluded: false,
  medicalDocumentProposalIncluded: false,
  baselineFingerprintVerified: true,
  hostedBaseline: {
    patientCount: remote.patientCount,
    patientCode: remote.patient.patientCode,
    dateOfBirth: remote.patient.dateOfBirth,
    derivedAgeOn2026_10_26: ageToday,
    bloodGroup: remote.medicalHistory.bloodGroup,
    clinicalCounts: remote.clinicalCounts,
  },
  pendingUntilApproval: [
    'Patient registration through phase2b_patient remains blocked; the app now reports that activation awaits the approved patient-age database update.',
    'Patient profile age is read-only and calculated from the stored date of birth.',
    'Blood group is already persisted through the existing doctor-only medical-history workflow and needs no schema change.',
  ],
};
const files = [
  ...baseline,
  { file: candidate, sha256: manifest.sha256, source: `${root}/${candidate}` },
];
const directory = 'artifacts/patient-age-deployment/supabase/migrations';
await mkdir(directory, { recursive: true });
for (const file of files) {
  const bytes = await readFile(file.source);
  assert.equal(hash(bytes), file.sha256, file.file);
  await copyFile(file.source, path.join(directory, file.file));
}
assert.deepEqual((await readdir(directory)).sort(), files.map((f) => f.file).sort());
const config = await readFile('artifacts/patient-id-deployment/supabase/config.toml', 'utf8');
assert.match(config, /major_version\s*=\s*17\b/);
assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);
assert.match(config, /sql_paths\s*=\s*\[\]/);
await writeFile('artifacts/patient-age-deployment/supabase/config.toml', config);
const linked = await readFile('artifacts/patient-id-deployment/supabase/.temp/linked-project.json');
assert.equal(JSON.parse(linked).ref, projectRef);
await cp('artifacts/patient-id-deployment/supabase/.temp', 'artifacts/patient-age-deployment/supabase/.temp', {
  recursive: true,
});
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  'artifacts/patient-age-deployment/manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    verifiedFiles: files.length,
    candidate,
    sha256: manifest.sha256,
    derivedAgeOn2026_10_26: ageToday,
    remoteExecution: false,
  }),
);
