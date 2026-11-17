import { describe, expect, it } from 'vitest';
import { validateCase } from '../../src/shared/validateCase';

// Integration step 1: the validator checks appliesWhen, fact refs and variant time overrides.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const REF = { sourceId: 's', page: 'to confirm', review: 'pending' };
function base(): Raw {
  return {
    id: 'v',
    chapter: 1,
    title: 'V',
    shortTitle: 'V',
    version: '0',
    scene: 'blank',
    intro: 'x',
    sources: [{ id: 's', title: 's', url: 'https://example.org/' }],
    characters: [{ id: 'c', name: 'C', role: 'casualty', description: 'x' }],
    facts: [{ id: 'f', text: 'fact', ref: { ...REF } }],
    phases: [{ id: 'p', title: 'P' }],
    startPhaseId: 'p',
    startCasualty: 'standing',
    initialFlags: { seen: false },
    actions: [{ id: 'a', label: 'A', kind: 'action', phases: ['p'], effects: [{ type: 'addCounter', counter: 'k', delta: 1 }] }],
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
          ref: { ...REF },
          appliesWhen: { flag: 'seen', counter: 'k', phaseId: 'p' },
        },
      ],
      time: { maxPoints: 10, targetMs: 1000, zeroAtMs: 2000 },
    },
    maxDurationMs: 10000,
    variants: [{ id: 'v1', label: 'V1', time: { targetMs: 500, zeroAtMs: 900 } }],
    disclaimer: 'x',
  };
}
const errors = (mut: (r: Raw) => void): string[] => {
  const r = base();
  mut(r);
  const c = validateCase(r);
  return c.ok ? [] : c.errors;
};

describe('validateCase: integration step 1 fields', () => {
  it('accepts the clean base', () => {
    expect(errors(() => {})).toEqual([]);
  });
  it('rejects an appliesWhen flag, counter or phase that does not exist', () => {
    expect(errors((r) => (r.rubric.items[0].appliesWhen.flag = 'nope')).join()).toMatch(/appliesWhen flag nope/);
    expect(errors((r) => (r.rubric.items[0].appliesWhen.counter = 'nope')).join()).toMatch(/appliesWhen counter nope/);
    expect(errors((r) => (r.rubric.items[0].appliesWhen.phaseId = 'nope')).join()).toMatch(/unknown phase nope/);
  });
  it('rejects an appliesWhen with an unknown field (strict condition)', () => {
    expect(errors((r) => (r.rubric.items[0].appliesWhen.whenever = true)).length).toBeGreaterThan(0);
  });
  it('rejects a fact ref to an unknown source', () => {
    expect(errors((r) => (r.facts[0].ref.sourceId = 'nope')).join()).toMatch(/fact f: unknown source nope/);
  });
  it('rejects a variant time with targetMs not below zeroAtMs', () => {
    expect(errors((r) => (r.variants[0].time = { targetMs: 900, zeroAtMs: 900 })).join()).toMatch(/variant v1: time/);
  });
});

describe('validateCase: integration step 2 (say speaker)', () => {
  const withLine = (r: Raw, sayAs: string) => {
    r.characters.push({ id: 'b', name: 'B', role: 'bystander', description: 'x' });
    r.lines.push({ id: 'l', characterId: 'c', text: 'Hello.' });
    r.actions[0].effects.push({ type: 'say', characterId: sayAs, lineId: 'l' });
  };
  it('accepts a say effect that names the line\'s own speaker', () => {
    expect(errors((r) => withLine(r, 'c'))).toEqual([]);
  });
  it('rejects a say effect that names another character', () => {
    expect(errors((r) => withLine(r, 'b')).join()).toMatch(/say l names b, but the line belongs to c/);
  });
});

describe('validateCase: review fixes (correctionHarmId)', () => {
  const withAdvice = (r: Raw, harmId: string) => {
    r.rubric.harms = [{ id: 'h', description: 'h', actionId: 'a', deduction: 5, teachingPoint: 'Do this instead.', ref: { ...REF } }];
    r.lines.push({ id: 'w', characterId: 'c', text: 'Bad idea.', wrongAdvice: true, correctionHarmId: harmId });
  };
  it('accepts a correctionHarmId that names a harm', () => {
    expect(errors((r) => withAdvice(r, 'h'))).toEqual([]);
  });
  it('rejects a correctionHarmId that names no harm', () => {
    expect(errors((r) => withAdvice(r, 'nope')).join()).toMatch(/line w: correctionHarmId names unknown harm nope/);
  });
});
