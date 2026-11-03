import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFile, readdir } from 'node:fs/promises';

// Purely local WASM PostgreSQL: no connection string, .env loader, network or remote CLI.
export async function createDatabase(
  seed = true,
  beforeMigrations?: (db: PGlite) => Promise<unknown>,
) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;
  `);
  if (beforeMigrations) await beforeMigrations(db);
  const files = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    } catch (error) {
      await db.close();
      throw new Error(`Local migration ${file} failed: ${(error as Error).message}`);
    }
  }
  if (seed) await db.exec(await readFile('supabase/fixtures/fictional.sql', 'utf8'));
  return db;
}

export const id = (group: number, value: number) =>
  `${group}0000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const users = {
  adminA: id(3, 1),
  adminAll: id(3, 2),
  doctor: id(3, 3),
  otherDoctor: id(3, 4),
  staff: id(3, 5),
  patient: id(3, 6),
  otherPatient: id(3, 7),
  branchBPatient: id(3, 8),
  otherOrgAdmin: id(3, 9),
  outsider: id(3, 10),
  branchBDoctor: id(3, 11),
  otherOrgDoctor: id(3, 12),
  otherOrgPatient: id(3, 13),
};

export async function asUser<T>(
  db: PGlite,
  user: string | null,
  run: () => Promise<T>,
  role = 'authenticated',
) {
  // Transactions are managed by each test; SET ROLE accurately exercises RLS/grants.
  await db.exec('savepoint caller_scope');
  try {
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user ?? '']);
    await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`);
    return await run();
  } catch (error) {
    await db.exec('rollback to savepoint caller_scope');
    throw error;
  } finally {
    await db.exec('reset role; release savepoint caller_scope');
  }
}

export async function book(db: PGlite, slot = 1, patient = 1, user = users.patient) {
  return asUser(db, user, async () => {
    const r = await db.query<{ id: string }>('select public.book_appointment($1,$2,$3) as id', [
      id(6, slot),
      id(5, patient),
      'Fictional database test visit',
    ]);
    return r.rows[0].id;
  });
}
export async function transition(
  db: PGlite,
  appointment: string,
  status: string,
  user = users.adminA,
) {
  return asUser(db, user, () =>
    db.query('select public.transition_appointment($1,$2)', [appointment, status]),
  );
}
export const notes = {
  symptoms: 'Fictional symptoms',
  examination: 'Fictional examination',
  diagnosis: 'Fictional assessment',
  plan: 'Fictional plan',
  followUp: 'Fictional follow-up',
  vitals: { bloodPressure: '120/80', pulse: '72' },
};
export const medication = [
  {
    medication: 'Demo medicine',
    strength: 'Example strength',
    dosage: 'Example dosage',
    frequency: 'Example frequency',
    duration: 'Example duration',
    instructions: 'Not a real prescription',
  },
];
export async function sign(db: PGlite, appointment: string, signed = true, items = medication) {
  return asUser(db, users.doctor, async () => {
    const r = await db.query<{ id: string }>('select public.save_encounter($1,$2,$3,$4) as id', [
      appointment,
      JSON.stringify(notes),
      JSON.stringify(items),
      signed,
    ]);
    return r.rows[0].id;
  });
}
