// Seeds a pilot database: two test schools with two classes each, and one "Practice final" that
// opens now and closes in 60 minutes over the CPR chapter (its finalOnly variant if it has one).
// Usage: npx tsx tools/seedPilot.ts [path-to-db] [--reopen] [--test-final=SECONDS]
//   default path: data/game.db. --reopen moves an existing practice final's window to now.
//   --test-final=90 adds a short "Test final" (end-to-end tests) that closes 90 s from now. It
//   opens a moment before any final that is open now, so /api/final/current shows it first.
// Safe to run twice: existing schools, classes and the final are kept, never duplicated.
// The codes are test codes and easy to guess; a real season needs random codes.
import { mkdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db';
import { loadCasesFromDisk } from '../src/content/loadNode';
import type { CaseFile } from '../src/shared/contract';

export const PILOT_CASE_ID = 'ch2-cpr-school-gate';
export const PRACTICE_FINAL_NAME = 'Practice final';
export const FINAL_LENGTH_MS = 60 * 60 * 1000;
export const SIZE_CAP = 40;
export const TEST_FINAL_NAME = 'Test final';

const PILOT = [
  { school: 'Test School A', letter: 'A' },
  { school: 'Test School B', letter: 'B' },
];

export interface SeedSummary {
  classes: { school: string; className: string; classCode: string; teacherCode: string; sizeCap: number }[];
  final: { id: number; name: string; opensAt: number; closesAt: number; caseIds: string[]; variantId: string } | null;
  testFinal?: { id: number; opensAt: number; closesAt: number };
  notes: string[];
}

export function seedPilot(
  db: DatabaseSync,
  cases: CaseFile[],
  now: number,
  opts: { reopen?: boolean; testFinalSeconds?: number } = {},
): SeedSummary {
  const notes: string[] = [];
  const insSchool = db.prepare('INSERT INTO schools (name) VALUES (?) ON CONFLICT DO NOTHING');
  const getSchool = db.prepare('SELECT id FROM schools WHERE name = ?');
  const insClass = db.prepare(
    `INSERT INTO classes (school_id, name, class_code, teacher_code, size_cap)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  const getClass = db.prepare(
    `SELECT s.name AS school, c.name AS className, c.class_code AS classCode,
       c.teacher_code AS teacherCode, c.size_cap AS sizeCap
     FROM classes c JOIN schools s ON s.id = c.school_id WHERE c.class_code = ?`,
  );
  const getFinal = db.prepare('SELECT * FROM finals WHERE name = ? ORDER BY id ASC LIMIT 1');

  const classes: SeedSummary['classes'] = [];
  db.exec('BEGIN');
  try {
    for (const p of PILOT) {
      insSchool.run(p.school);
      const school = getSchool.get(p.school) as { id: number };
      for (const n of [1, 2]) {
        const tag = `${p.letter}${n}`;
        insClass.run(school.id, `Class ${tag}`, `TEST-${tag}`, `TEACH-${tag}`, SIZE_CAP);
        const row = getClass.get(`TEST-${tag}`) as SeedSummary['classes'][number] | undefined;
        if (!row || row.teacherCode !== `TEACH-${tag}`) throw new Error(`class code TEST-${tag} is taken by another class`);
        classes.push(row);
      }
    }

    let finalRow = getFinal.get(PRACTICE_FINAL_NAME) as
      | { id: number; name: string; opens_at: number; closes_at: number; case_ids_json: string; variant_id: string | null }
      | undefined;
    if (finalRow && opts.reopen) {
      db.prepare('UPDATE finals SET opens_at = ?, closes_at = ? WHERE id = ?').run(now, now + FINAL_LENGTH_MS, finalRow.id);
      finalRow = { ...finalRow, opens_at: now, closes_at: now + FINAL_LENGTH_MS };
      notes.push('practice final window moved to now');
    }
    if (!finalRow) {
      const cpr = cases.find((c) => c.id === PILOT_CASE_ID);
      if (!cpr) {
        notes.push(`case ${PILOT_CASE_ID} is not loaded, so no final was created; run again once it exists`);
      } else {
        // variant_id stays NULL: the server plays each case's first finalOnly variant.
        if (!cpr.variants.some((v) => v.finalOnly))
          notes.push(`case ${PILOT_CASE_ID} has no finalOnly variant; the server cannot start this final`);
        db.prepare(
          'INSERT INTO finals (name, opens_at, closes_at, case_ids_json, variant_id) VALUES (?, ?, ?, ?, NULL)',
        ).run(PRACTICE_FINAL_NAME, now, now + FINAL_LENGTH_MS, JSON.stringify([PILOT_CASE_ID]));
        finalRow = getFinal.get(PRACTICE_FINAL_NAME) as typeof finalRow;
      }
    }
    let testFinal: SeedSummary['testFinal'];
    if (opts.testFinalSeconds !== undefined) {
      const secs = opts.testFinalSeconds;
      if (!Number.isInteger(secs) || secs < 10 || secs > 3600) throw new Error('--test-final needs 10 to 3600 seconds');
      const open = db.prepare('SELECT MIN(opens_at) AS first FROM finals WHERE opens_at <= ? AND closes_at > ?').get(now, now) as
        | { first: number | null }
        | undefined;
      const opensAt = Math.min(now, open?.first ?? now) - 1000;
      const closesAt = now + secs * 1000;
      const r = db
        .prepare('INSERT INTO finals (name, opens_at, closes_at, case_ids_json, variant_id) VALUES (?, ?, ?, ?, NULL)')
        .run(TEST_FINAL_NAME, opensAt, closesAt, JSON.stringify([PILOT_CASE_ID]));
      testFinal = { id: Number(r.lastInsertRowid), opensAt, closesAt };
    }
    db.exec('COMMIT');
    return {
      testFinal,
      classes,
      final: finalRow
        ? {
            id: finalRow.id,
            name: finalRow.name,
            opensAt: finalRow.opens_at,
            closesAt: finalRow.closes_at,
            caseIds: JSON.parse(finalRow.case_ids_json) as string[],
            // The variant the server plays for the pilot case (stored id, else its first finalOnly).
            variantId:
              (finalRow.variant_id &&
              cases.find((c) => c.id === PILOT_CASE_ID)?.variants.some((v) => v.finalOnly && v.id === finalRow.variant_id)
                ? finalRow.variant_id
                : cases.find((c) => c.id === PILOT_CASE_ID)?.variants.find((v) => v.finalOnly)?.id) ?? '',
          }
        : null,
      notes,
    };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function main(argv: string[]): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pathArg = argv.find((a) => !a.startsWith('--'));
  const dbPath = pathArg ? resolve(pathArg) : join(root, 'data', 'game.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  let cases: CaseFile[] = [];
  try {
    cases = loadCasesFromDisk();
  } catch (e) {
    console.warn(`seed: could not load the case files (${e instanceof Error ? e.message.split('\n')[0] : 'error'})`);
  }
  const db = openDb(dbPath);
  db.exec('PRAGMA busy_timeout = 5000;'); // the server may be running and writing too
  try {
    const tf = argv.find((a) => a.startsWith('--test-final='));
    const s = seedPilot(db, cases, Date.now(), {
      reopen: argv.includes('--reopen'),
      testFinalSeconds: tf ? Number(tf.slice('--test-final='.length)) : undefined,
    });
    console.log(`seed: database ${dbPath}`);
    console.log('school          class     class code  teacher code  size cap');
    for (const c of s.classes)
      console.log(
        `${c.school.padEnd(16)}${c.className.padEnd(10)}${c.classCode.padEnd(12)}${c.teacherCode.padEnd(14)}${c.sizeCap}`,
      );
    if (s.final)
      console.log(
        `final ${s.final.id} "${s.final.name}": ${new Date(s.final.opensAt).toISOString()} to ` +
          `${new Date(s.final.closesAt).toISOString()}, cases ${s.final.caseIds.join(', ')}, variant ${s.final.variantId}`,
      );
    if (s.testFinal)
      console.log(`test final ${s.testFinal.id}: closes ${new Date(s.testFinal.closesAt).toISOString()}`);
    for (const n of s.notes) console.log(`note: ${n}`);
  } finally {
    db.close();
  }
}

const invokedAs = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (process.platform === 'win32' ? invokedAs.toLowerCase() === self.toLowerCase() : invokedAs === self) {
  main(process.argv.slice(2));
}
