import { readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createDatabase } from '../tests/database/harness';

// Derived from the local migration catalog, never from a remote project or .env.
async function main() {
  const db = await createDatabase(false);
  try {
    const enums = (
      await db.query<{ name: string; value: string }>(`select t.typname as name,e.enumlabel as value
      from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' order by t.typname,e.enumsortorder`)
    ).rows;
    const enumNames = new Set(enums.map((r) => r.name));
    const tsType = (type: string): string => {
      if (type.endsWith('[]')) return `(${tsType(type.slice(0, -2))})[]`;
      if (type.startsWith('_')) return `(${tsType(type.slice(1))})[]`;
      if (enumNames.has(type)) return `Database['public']['Enums']['${type}']`;
      if (['bool', 'boolean'].includes(type)) return 'boolean';
      if (['int2', 'int4', 'int8', 'smallint', 'integer', 'bigint', 'numeric'].includes(type))
        return 'number';
      if (['json', 'jsonb'].includes(type)) return 'Json';
      if (type === 'void') return 'undefined';
      return 'string';
    };
    const columns = (
      await db.query<{
        table_name: string;
        column_name: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
        is_generated: string;
      }>(`
      select table_name,column_name,udt_name,is_nullable,column_default,is_generated from information_schema.columns
      where table_schema='public' order by table_name,ordinal_position`)
    ).rows;
    const relationships = (
      await db.query<{
        table_name: string;
        name: string;
        columns: string[];
        referenced_table: string;
        referenced_columns: string[];
        one_to_one: boolean;
      }>(`
      select c.relname as table_name,con.conname as name,
        array(select a.attname::text from unnest(con.conkey) with ordinality k(num,pos)
          join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num order by pos) as columns,
        f.relname as referenced_table,
        exists(select 1 from pg_index i where i.indrelid=c.oid and i.indisunique and i.indpred is null and i.indexprs is null
          and (select array_agg(k order by k) from unnest(i.indkey::smallint[]) k)
            =(select array_agg(k order by k) from unnest(con.conkey) k)) as one_to_one,
        array(select a.attname::text from unnest(con.confkey) with ordinality k(num,pos)
          join pg_attribute a on a.attrelid=f.oid and a.attnum=k.num order by pos) as referenced_columns
      from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_class f on f.oid=con.confrelid
      where con.contype='f' and c.relnamespace='public'::regnamespace and f.relnamespace='public'::regnamespace
      order by c.relname,con.conname`)
    ).rows;
    const functions = (
      await db.query<{
        name: string;
        names: string[];
        types: string[];
        defaults: number;
        return_type: string;
        returns_set: boolean;
      }>(`
      select proname as name,proargnames as names,
        array(select t.typname::text from unnest(proargtypes::oid[]) with ordinality a(oid,pos)
          join pg_type t on t.oid=a.oid order by pos) as types,
        pronargdefaults as defaults,proretset as returns_set,(select typname::text from pg_type where oid=prorettype) as return_type
      from pg_proc where pronamespace='public'::regnamespace order by proname`)
    ).rows;
    let text = `// Generated from the APPROVAL-PENDING local migrations. Not a remote schema snapshot.
// Regenerate: pnpm db:types. Do not hand-edit. No private schema or credential types exported.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = { public: { Tables: {`;
    for (const table of [...new Set(columns.map((r) => r.table_name))]) {
      const cols = columns.filter((r) => r.table_name === table);
      text += `'${table}': {`;
      for (const mode of ['Row', 'Insert', 'Update']) {
        text += `${mode}: {`;
        for (const c of cols) {
          const generated = c.is_generated !== 'NEVER';
          const optional =
            mode === 'Update' ||
            (mode === 'Insert' &&
              (generated || c.is_nullable === 'YES' || c.column_default !== null));
          const type =
            mode !== 'Row' && generated
              ? 'never'
              : tsType(c.udt_name) + (c.is_nullable === 'YES' ? ' | null' : '');
          text += `'${c.column_name}'${optional ? '?' : ''}: ${type};`;
        }
        text += '};';
      }
      text += 'Relationships: [';
      for (const r of relationships.filter((r) => r.table_name === table)) {
        text += `{foreignKeyName: '${r.name}'; columns: ${JSON.stringify(r.columns)}; isOneToOne: ${r.one_to_one}; referencedRelation: '${r.referenced_table}'; referencedColumns: ${JSON.stringify(r.referenced_columns)};},`;
      }
      text += ']};';
    }
    text += '}; Views: { [_ in never]: never }; Functions: {';
    for (const f of functions) {
      text += `'${f.name}': {Args: {`;
      f.names.forEach((name, i) => {
        text += `${name}${i >= f.names.length - f.defaults ? '?' : ''}: ${tsType(f.types[i])};`;
      });
      const returnType = columns.some((r) => r.table_name === f.return_type)
        ? `Database['public']['Tables']['${f.return_type}']['Row']`
        : tsType(f.return_type);
      text += `}; Returns: ${f.returns_set ? `(${returnType})[]` : returnType};};`;
    }
    text += '}; Enums: {';
    for (const name of enumNames)
      text += `'${name}': ${enums
        .filter((r) => r.name === name)
        .map((r) => `'${r.value}'`)
        .join(' | ')};`;
    text += '}; CompositeTypes: { [_ in never]: never } } };';
    const file = 'packages/types/src/database.ts';
    text = await format(text, { ...(await resolveConfig(file)), parser: 'typescript' });
    if (process.argv.includes('--check')) {
      if ((await readFile(file, 'utf8')) !== text)
        throw new Error('Database contracts drifted. Run pnpm db:types.');
      console.log('Database contracts match the local migration catalog.');
    } else {
      await writeFile(file, text);
      console.log(
        `Generated ${new Set(columns.map((r) => r.table_name)).size} table contracts and ${functions.length} RPC contracts locally.`,
      );
    }
  } finally {
    await db.close();
  }
}
main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
