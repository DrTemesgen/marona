// Privacy scan of the game database. Exit code 1 on any finding, 2 when it cannot scan.
// Usage: npx tsx tools/privacyScan.ts [path-to-db]   (default data/game.db, opened read-only)
// Checks: the players table has exactly the allowed columns; token_hash holds only SHA-256 hex;
// every nickname fits the word-pair pattern; no text value anywhere (players, runs, final_runs
// and every other table) holds an e-mail address or a phone number. Findings are masked so the
// scan itself does not copy personal data into a log.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYER_COLUMNS } from '../server/db';
import { isValidNickname } from '../server/nicknames';

export type FindingKind = 'columns' | 'token' | 'nickname' | 'email' | 'phone';

export interface Finding {
  kind: FindingKind;
  table: string;
  column: string;
  rowId: number | null;
  sample: string; // masked
}

export const PATTERNS: { kind: 'email' | 'phone'; re: RegExp }[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
  // Any international number, +251 (Ethiopia) included: a plus sign and 8 to 15 digits.
  { kind: 'phone', re: /\+\s?\d(?:[\s().-]?\d){7,14}/ },
  // 251 and 9 digits without the plus sign.
  { kind: 'phone', re: /(?<![A-Za-z0-9])251(?:[\s.-]?\d){9}(?![A-Za-z0-9])/ },
  // Local mobile numbers: 09 or 07 followed by 8 digits.
  { kind: 'phone', re: /(?<![A-Za-z0-9])0[79](?:[\s.-]?\d){8}(?![A-Za-z0-9])/ },
];

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function mask(s: string): string {
  return s.length <= 2 ? '**' : `${s.slice(0, 2)}${'*'.repeat(Math.min(12, s.length - 2))}`;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function privacyScan(db: DatabaseSync): Finding[] {
  const findings: Finding[] = [];

  const columns = (db.prepare("SELECT name FROM pragma_table_info('players')").all() as { name: string }[]).map(
    (r) => r.name,
  );
  const allowed = new Set<string>(PLAYER_COLUMNS);
  if (columns.length === 0) {
    findings.push({ kind: 'columns', table: 'players', column: '', rowId: null, sample: 'players table is missing' });
  } else {
    for (const c of columns)
      if (!allowed.has(c))
        findings.push({ kind: 'columns', table: 'players', column: c, rowId: null, sample: 'column not allowed' });
    for (const c of allowed)
      if (!columns.includes(c))
        findings.push({ kind: 'columns', table: 'players', column: c, rowId: null, sample: 'column missing' });
  }

  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

  for (const table of tables) {
    const rows = db.prepare(`SELECT rowid AS "__rowid", * FROM ${quoteIdent(table)}`).iterate() as Iterable<
      Record<string, unknown>
    >;
    for (const row of rows) {
      const rowId = typeof row.__rowid === 'number' ? row.__rowid : null;
      for (const [column, value] of Object.entries(row)) {
        if (column === '__rowid') continue;
        if (table === 'players' && column === 'nickname' && !isValidNickname(value))
          findings.push({ kind: 'nickname', table, column, rowId, sample: mask(String(value)) });
        if (table === 'players' && column === 'token_hash' && !(typeof value === 'string' && SHA256_HEX.test(value)))
          findings.push({ kind: 'token', table, column, rowId, sample: 'not a SHA-256 hex digest' });
        if (typeof value !== 'string') continue;
        for (const p of PATTERNS) {
          const m = p.re.exec(value);
          if (m) {
            findings.push({ kind: p.kind, table, column, rowId, sample: mask(m[0]) });
            break;
          }
        }
      }
    }
  }
  return findings;
}

function main(argv: string[]): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dbPath = argv[0] ? resolve(argv[0]) : join(root, 'data', 'game.db');
  if (!existsSync(dbPath)) {
    console.error(`privacy scan: no database at ${dbPath}`);
    process.exitCode = 2;
    return;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let findings: Finding[];
  try {
    findings = privacyScan(db);
  } finally {
    db.close();
  }
  if (findings.length === 0) {
    console.log(`privacy scan: clean (${dbPath})`);
    return;
  }
  for (const f of findings)
    console.log(`privacy scan: ${f.kind} in ${f.table}${f.column ? `.${f.column}` : ''}` +
      `${f.rowId !== null ? ` row ${f.rowId}` : ''}: ${f.sample}`);
  console.log(`privacy scan: ${findings.length} finding(s)`);
  process.exitCode = 1;
}

const invokedAs = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (process.platform === 'win32' ? invokedAs.toLowerCase() === self.toLowerCase() : invokedAs === self) {
  main(process.argv.slice(2));
}
