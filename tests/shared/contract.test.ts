import { describe, expect, it } from 'vitest';
import { CaseFile } from '../../src/shared/contract';

// Smoke test: the contract compiles and rejects a broken case file.
const minimal = {
  id: 'smoke',
  chapter: 1,
  title: 'Smoke test',
  shortTitle: 'Smoke',
  version: '0.0.1',
  scene: 'blank',
  intro: 'A test.',
  sources: [{ id: 'ifrc2025', title: 'IFRC 2025', url: 'https://www.ifrc.org/' }],
  characters: [{ id: 'c', name: 'Casualty', role: 'casualty', description: 'A person.' }],
  facts: [],
  phases: [{ id: 'p1', title: 'Start' }],
  startPhaseId: 'p1',
  startCasualty: 'standing',
  actions: [{ id: 'a1', label: 'Check danger', kind: 'action', phases: ['p1'] }],
  lines: [],
  rubric: {
    items: [
      {
        id: 'r1',
        description: 'Checked danger',
        check: { kind: 'did', actionId: 'a1' },
        points: 90,
        critical: true,
        teachingPoint: 'Check for danger first.',
        ref: { sourceId: 'ifrc2025', page: 'to confirm', review: 'pending' },
      },
    ],
    time: { maxPoints: 10, targetMs: 30000, zeroAtMs: 120000 },
  },
  maxDurationMs: 300000,
  variants: [{ id: 'v1', label: 'Default' }],
  disclaimer: 'Practice only.',
};

describe('contract', () => {
  it('accepts a minimal case file', () => {
    expect(CaseFile.safeParse(minimal).success).toBe(true);
  });
  it('rejects a case file without actions', () => {
    expect(CaseFile.safeParse({ ...minimal, actions: [] }).success).toBe(false);
  });
});
