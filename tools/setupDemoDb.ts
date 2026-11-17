// Prepares the online demo's database on Turso: creates the tables when they are missing and
// puts in one demo school and class with the codes from the environment (it updates the codes
// when they change, so new codes need only new settings and a redeploy). Vercel runs it after
// each build (npm run build:vercel); safe to run again. It prints no code, URL or token.
// Needs, from Vercel's environment settings (never from git):
//   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN  set by the Turso integration;
//   DEMO_CLASS_CODE, DEMO_TEACHER_CODE    long random codes, given only to the demo's owner.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client/web';
import { SCHEMA } from '../server/db';
import { libsqlSql, type Sql } from '../server/sql';

export const DEMO_SCHOOL = 'Demo School';
export const DEMO_CLASS = 'Demo class';
export const DEMO_SIZE_CAP = 40;
export const MIN_CLASS_CODE_CHARS = 8; // letters and digits; about 40 bits from a 31-sign alphabet
export const MIN_TEACHER_CODE_CHARS = 16; // about 79 bits

const CODE = /^[A-Za-z0-9-]{3,32}$/; // the server's own code format (server/schemas.ts)
const signs = (code: string) => code.replace(/-/g, '').length;

// Empty when the two codes are fit for a public demo; otherwise the reasons (never the codes).
export function checkDemoCodes(classCode: string | undefined, teacherCode: string | undefined): string[] {
  const errors: string[] = [];
  if (!classCode || !CODE.test(classCode)) errors.push('DEMO_CLASS_CODE is missing or not letters, digits and hyphens (up to 32)');
  else if (signs(classCode) < MIN_CLASS_CODE_CHARS) errors.push(`DEMO_CLASS_CODE needs at least ${MIN_CLASS_CODE_CHARS} letters and digits`);
  if (!teacherCode || !CODE.test(teacherCode)) errors.push('DEMO_TEACHER_CODE is missing or not letters, digits and hyphens (up to 32)');
  else if (signs(teacherCode) < MIN_TEACHER_CODE_CHARS) errors.push(`DEMO_TEACHER_CODE needs at least ${MIN_TEACHER_CODE_CHARS} letters and digits`);
  if (classCode && teacherCode && classCode.toUpperCase() === teacherCode.toUpperCase()) errors.push('the two codes must differ');
  for (const [name, code] of [['DEMO_CLASS_CODE', classCode], ['DEMO_TEACHER_CODE', teacherCode]] as const)
    if (code && /^(TEST|TEACH)-/i.test(code)) errors.push(`${name} looks like a seeded test code`);
  return errors;
}

export async function setupDemoDb(db: Sql, classCode: string, teacherCode: string): Promise<'created' | 'updated'> {
  const errors = checkDemoCodes(classCode, teacherCode);
  if (errors.length) throw new Error(errors.join('; '));
  await db.exec(SCHEMA);
  await db.run('INSERT INTO schools (name) VALUES (?) ON CONFLICT DO NOTHING', [DEMO_SCHOOL]);
  const school = await db.get<{ id: number }>('SELECT id FROM schools WHERE name = ?', [DEMO_SCHOOL]);
  if (!school) throw new Error('the demo school was not created');
  const cls = await db.get<{ id: number }>('SELECT id FROM classes WHERE school_id = ? AND name = ? ORDER BY id LIMIT 1', [
    school.id,
    DEMO_CLASS,
  ]);
  if (cls) {
    await db.run('UPDATE classes SET class_code = ?, teacher_code = ?, size_cap = ? WHERE id = ?', [
      classCode,
      teacherCode,
      DEMO_SIZE_CAP,
      cls.id,
    ]);
    return 'updated';
  }
  await db.run('INSERT INTO classes (school_id, name, class_code, teacher_code, size_cap) VALUES (?, ?, ?, ?, ?)', [
    school.id,
    DEMO_CLASS,
    classCode,
    teacherCode,
    DEMO_SIZE_CAP,
  ]);
  return 'created';
}

export function redactUrls(text: string): string {
  return text.replace(/\b(?:libsql|https?|wss?):\/\/[^\s'"]+/gi, '[database address]');
}

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set (connect the Turso database to this Vercel project)');
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const what = await setupDemoDb(libsqlSql(client), process.env.DEMO_CLASS_CODE ?? '', process.env.DEMO_TEACHER_CODE ?? '');
    const n = await client.execute('SELECT COUNT(*) AS n FROM players WHERE removed = 0');
    console.log(`setup-demo-db: tables ready; demo class ${what}; ${String(n.rows[0]?.n ?? 0)} player(s)`);
  } finally {
    client.close();
  }
}

const invokedAs = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (process.platform === 'win32' ? invokedAs.toLowerCase() === self.toLowerCase() : invokedAs === self) {
  main().catch((e: unknown) => {
    // The message never holds a code or the token (see checkDemoCodes); libSQL errors are cut
    // short and any address in them is replaced, so the build log does not show the database URL.
    console.error(`setup-demo-db: ${e instanceof Error ? redactUrls(e.message.split('\n')[0]).slice(0, 300) : 'failed'}`);
    process.exitCode = 1;
  });
}
