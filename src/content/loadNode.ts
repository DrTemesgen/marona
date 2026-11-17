// Loads every case file in this folder from disk (server, tests, tools). The UI uses loadVite.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseFile } from '../shared/contract';
import { validateCase } from '../shared/validateCase';

export const CONTENT_DIR = dirname(fileURLToPath(import.meta.url));

export function caseFileNames(dir = CONTENT_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export function loadCasesFromDisk(dir = CONTENT_DIR): CaseFile[] {
  const out: CaseFile[] = [];
  for (const f of caseFileNames(dir)) {
    const check = validateCase(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!check.ok) throw new Error(`${f} is invalid:\n${check.errors.join('\n')}`);
    out.push(check.caseFile);
  }
  return out.sort((a, b) => a.chapter - b.chapter);
}
