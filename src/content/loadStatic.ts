// Every case file as a static import, for the online demo's API bundle (one file, no disk
// reads). Same checks as loadNode.ts, and the full files: final-only variants stay in (only the
// phone app's bundle has them cut out, by vite.config.ts). tests/content/loadStatic.test.ts
// checks that this list matches the .json files in this folder, so no chapter is left out.
import type { CaseFile } from '../shared/contract';
import { validateCase } from '../shared/validateCase';
import ch1 from './ch1-safe-scene-minibus.json';
import ch2 from './ch2-cpr-school-gate.json';
import ch3 from './ch3-choking-lunch.json';
import ch4 from './ch4-bleeding-road.json';
import ch5 from './ch5-burns-home.json';
import ch6 from './ch6-seizure-class.json';

export const STATIC_CASE_FILES: Readonly<Record<string, unknown>> = {
  'ch1-safe-scene-minibus.json': ch1,
  'ch2-cpr-school-gate.json': ch2,
  'ch3-choking-lunch.json': ch3,
  'ch4-bleeding-road.json': ch4,
  'ch5-burns-home.json': ch5,
  'ch6-seizure-class.json': ch6,
};

export function loadStaticCases(): CaseFile[] {
  const out: CaseFile[] = [];
  for (const [file, raw] of Object.entries(STATIC_CASE_FILES)) {
    const check = validateCase(raw);
    if (!check.ok) throw new Error(`${file} is invalid:\n${check.errors.join('\n')}`);
    out.push(check.caseFile);
  }
  return out.sort((a, b) => a.chapter - b.chapter);
}
