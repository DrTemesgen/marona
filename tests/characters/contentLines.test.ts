import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CaseFile } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';
import { filterReply } from '../../src/characters/filter';
import { loadFixture } from './helpers';

// Every checked line must pass the filter as itself. A line that fails is either unsafe content
// or a pattern that is too wide; both need a person to look (the game would still show the line).
function failingLines(c: CaseFile): string[] {
  const out: string[] = [];
  for (const l of c.lines) {
    const r = filterReply({ characterId: l.characterId, lineId: l.id, text: l.text, emotion: l.emotion }, c);
    if (!r.ok) out.push(`${c.id} / ${l.id}: ${r.reason}`);
  }
  return out;
}

describe('checked lines pass the filter', () => {
  it('fixture lines', () => {
    expect(failingLines(loadFixture())).toEqual([]);
  });

  const contentDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'content');
  const files = readdirSync(contentDir).filter((f) => f.endsWith('.json')).sort();
  it('content folder is readable', () => {
    expect(Array.isArray(files)).toBe(true);
  });
  for (const f of files) {
    it(`${f} lines`, () => {
      const check = validateCase(JSON.parse(readFileSync(join(contentDir, f), 'utf8')));
      // An invalid case is reported by tests/content; here only valid cases are read.
      if (!check.ok) return;
      expect(failingLines(check.caseFile)).toEqual([]);
    });
    it(`${f} planned wrong advice is caught when it leaks into another line`, () => {
      const check = validateCase(JSON.parse(readFileSync(join(contentDir, f), 'utf8')));
      if (!check.ok) return;
      expect(leakedWrongAdvice(check.caseFile)).toEqual([]);
    });
  }
});

// Send each wrong-advice text under every other line of the case (the same speaker's and the
// call-taker's lines alike). It must be stopped by a safety rule, not only by the number rule.
function leakedWrongAdvice(c: CaseFile): string[] {
  const out: string[] = [];
  for (const w of c.lines.filter((l) => l.wrongAdvice)) {
    for (const other of c.lines.filter((l) => !l.wrongAdvice)) {
      const r = filterReply({ characterId: other.characterId, lineId: other.id, text: w.text, emotion: other.emotion }, c);
      if (r.ok || r.reason.startsWith('new-number')) out.push(`${c.id} / ${w.id} under ${other.id}: ${r.ok ? 'passed' : r.reason}`);
    }
  }
  return out;
}

describe('the fixture wrong advice is caught when it leaks', () => {
  it('under every other fixture line', () => {
    expect(leakedWrongAdvice(loadFixture())).toEqual([]);
  });
});
