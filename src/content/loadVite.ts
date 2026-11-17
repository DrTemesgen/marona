// Loads every case file in this folder at build time (UI). The server and tests use loadNode.ts.
// Practice never sees a final: finalOnly variants are stripped here (and vite.config.ts already
// cuts them out of the bundled JSON). A final adds its variant from /api/final/start.
import type { CaseFile } from '../shared/contract';
import { validateCase } from '../shared/validateCase';

const modules = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const cases: CaseFile[] = Object.entries(modules)
  .map(([file, raw]) => {
    const check = validateCase(raw);
    if (!check.ok) throw new Error(`${file} is invalid:\n${check.errors.join('\n')}`);
    return { ...check.caseFile, variants: check.caseFile.variants.filter((v) => !v.finalOnly) };
  })
  .sort((a, b) => a.chapter - b.chapter);
