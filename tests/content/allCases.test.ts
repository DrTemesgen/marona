import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR, caseFileNames } from '../../src/content/loadNode';
import { validateCase } from '../../src/shared/validateCase';

// Every case file in src/content must pass the schema and the cross-reference rules.
describe('case files', () => {
  it('content folder is readable', () => {
    expect(Array.isArray(caseFileNames())).toBe(true);
  });
  for (const f of caseFileNames()) {
    it(`${f} is valid`, () => {
      const check = validateCase(JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8')));
      expect(check.ok ? [] : check.errors).toEqual([]);
    });
  }
});

// In Guided mode a card with no hint stood out as the wrong one: every card has a hint, so a hint
// alone never marks a card as right or wrong.
describe('every card has a Guided hint', () => {
  for (const f of caseFileNames()) {
    it(`${f}: every card, harmful or not, has a hint`, () => {
      const c = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8')) as { actions: { id: string; hint?: string }[]; rubric: { harms: { actionId: string }[] } };
      const harmful = new Set(c.rubric.harms.map((h) => h.actionId));
      const missing = c.actions.filter((a) => !(a.hint ?? '').trim()).map((a) => (harmful.has(a.id) ? 'harmful ' : '') + a.id);
      expect(missing).toEqual([]);
    });
  }
});

describe('validator sees planted defects', () => {
  const base = JSON.parse(
    JSON.stringify({
      id: 'planted',
      chapter: 1,
      title: 'Planted',
      shortTitle: 'Planted',
      version: '0',
      scene: 'blank',
      intro: 'x',
      sources: [{ id: 's', title: 's', url: 'https://example.org/' }],
      characters: [{ id: 'c', name: 'C', role: 'casualty', description: 'x' }],
      facts: [],
      phases: [{ id: 'p', title: 'P' }],
      startPhaseId: 'p',
      startCasualty: 'standing',
      actions: [{ id: 'a', label: 'A', kind: 'action', phases: ['p'] }],
      lines: [],
      rubric: {
        items: [
          {
            id: 'r',
            description: 'r',
            check: { kind: 'did', actionId: 'a' },
            points: 90,
            critical: true,
            teachingPoint: 't',
            ref: { sourceId: 's', page: 'to confirm', review: 'pending' },
          },
        ],
        time: { maxPoints: 10, targetMs: 1000, zeroAtMs: 2000 },
      },
      maxDurationMs: 10000,
      variants: [{ id: 'v', label: 'V' }],
      disclaimer: 'x',
    }),
  );
  it('accepts the clean base', () => {
    expect(validateCase(base).ok).toBe(true);
  });
  it('rejects points that do not add to 100', () => {
    const bad = structuredClone(base);
    bad.rubric.items[0].points = 80;
    expect(validateCase(bad).ok).toBe(false);
  });
  it('rejects a rubric item pointing at a missing action', () => {
    const bad = structuredClone(base);
    bad.rubric.items[0].check.actionId = 'missing';
    expect(validateCase(bad).ok).toBe(false);
  });
});
