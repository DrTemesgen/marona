import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR, caseFileNames } from '../../src/content/loadNode';
import { replay, view } from '../../src/engine/engine';
import { validateCase } from '../../src/shared/validateCase';
import { smokePlay } from '../../tools/testPlayer';

// Plays every case file in src/content with the smoke player. Other chapters arrive while the
// engine is built, so a file that is not valid yet is skipped by name instead of failing here
// (tests/content checks validity on its own).
describe('smoke play over every case file', () => {
  const files = caseFileNames();

  it('finds at least chapter 2', () => {
    expect(files).toContain('ch2-cpr-school-gate.json');
  });

  for (const f of files) {
    let problem: string | undefined;
    let caseFile;
    try {
      const check = validateCase(JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8')));
      if (check.ok) caseFile = check.caseFile;
      else problem = `fails validateCase: ${check.errors[0]}`;
    } catch (e) {
      problem = `not valid JSON: ${(e as Error).message}`;
    }
    if (!caseFile) {
      it.skip(`${f} skipped (${problem})`, () => {});
      continue;
    }
    const c = caseFile;

    it(`${f}: plays to the end in every variant and mode, and replays the same`, () => {
      for (const v of c.variants) {
        for (const mode of ['guided', 'realtime'] as const) {
          for (const seed of [1, 99]) {
            const r = smokePlay(c, seed, { variantId: v.id, mode });
            const end = view(r.state);
            expect(end.ended, `${v.id} ${mode}`).toBe(true);
            expect(r.report.total).toBeGreaterThanOrEqual(0);
            expect(r.report.total).toBeLessThanOrEqual(100);
            expect(Number.isInteger(r.report.total)).toBe(true);
            expect(r.report.durationMs).toBeLessThanOrEqual(c.maxDurationMs);
            for (const i of r.report.items) expect(i.earned).toBeLessThanOrEqual(i.points);
            expect(r.cardsPlayed.length).toBeGreaterThan(0);
            const again = replay(r.cfg, r.actions, r.endT);
            expect(again.report).toEqual(r.report);
            expect(view(again.state)).toEqual(end);
          }
        }
      }
    });
  }
});
