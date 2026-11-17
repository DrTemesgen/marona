import { describe, expect, it } from 'vitest';
import {
  EngineError,
  advanceTo,
  applyAction,
  createGame,
  endGame,
  replay,
  score,
  view,
  type GameState,
} from '../../src/engine/engine';
import { shuffle } from '../../src/engine/rng';
import { CaseFile, type GameConfig, type PlayerAction } from '../../src/shared/contract';

// ---------- Fixture: a tiny case file, changed per test ----------

const REF = { sourceId: 's', page: 'to confirm', review: 'pending' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

function base(): Raw {
  return {
    id: 'fx',
    chapter: 1,
    title: 'Fixture',
    shortTitle: 'Fx',
    version: '0',
    scene: 'blank',
    intro: 'x',
    sources: [{ id: 's', title: 's', url: 'https://example.org/' }],
    characters: [
      { id: 'c', name: 'C', role: 'casualty', description: 'x' },
      { id: 'b', name: 'B', role: 'bystander', description: 'x' },
    ],
    facts: [{ id: 'f1', text: 'fact one' }],
    phases: [
      { id: 'p1', title: 'P1' },
      { id: 'p2', title: 'P2' },
    ],
    startPhaseId: 'p1',
    startCasualty: 'standing',
    actions: [{ id: 'a1', label: 'A1', kind: 'action', phases: ['p1'] }],
    timeline: [],
    lines: [
      { id: 'l1', characterId: 'c', text: 'one' },
      { id: 'l2', characterId: 'c', text: 'two' },
      { id: 'l3', characterId: 'b', text: 'three' },
    ],
    rubric: {
      items: [item('r_a1', { kind: 'did', actionId: 'a1' }, 90)],
      harms: [],
      time: { maxPoints: 10, targetMs: 30000, zeroAtMs: 50000 },
    },
    maxDurationMs: 60000,
    variants: [{ id: 'v1', label: 'V1' }],
    disclaimer: 'x',
  };
}

function item(id: string, check: Raw, points: number): Raw {
  return { id, description: id, check, points, critical: false, teachingPoint: 't', ref: REF };
}

function build(mut: (raw: Raw) => void = () => {}): CaseFile {
  const raw = base();
  mut(raw);
  return CaseFile.parse(raw);
}

function start(c: CaseFile, cfg: Partial<GameConfig> = {}): GameState {
  return createGame({ caseFile: c, seed: 1, mode: 'guided', variantId: 'v1', ...cfg });
}

function act(s: GameState, actionId: string, t: number, payload?: PlayerAction['payload']): GameState {
  return applyAction(s, payload ? { actionId, t, payload } : { actionId, t });
}

const cardIds = (s: GameState) => view(s).cards.map((c) => c.id);
const statusOf = (s: GameState, id: string) => score(s).items.find((i) => i.id === id);

function expectEngineError(fn: () => unknown, pattern?: RegExp): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(EngineError);
  if (pattern) expect((err as Error).message).toMatch(pattern);
}

// ---------- createGame ----------

describe('createGame', () => {
  it('throws EngineError on an unknown variant', () => {
    expectEngineError(() => start(build(), { variantId: 'nope' }), /unknown variant/);
  });

  it('throws EngineError on a bad seed or mode', () => {
    expectEngineError(() => start(build(), { seed: -1 }), /seed/);
    expectEngineError(() => start(build(), { seed: 1.5 }), /seed/);
    expectEngineError(() => start(build(), { seed: 2 ** 32 }), /seed/);
    expectEngineError(() => start(build(), { mode: 'fast' as never }), /mode/);
  });

  it('starts in the start phase with the start casualty and the opening lines at t=0', () => {
    const c = build((r) => {
      r.openingLineIds = ['l1', 'l3'];
    });
    const v = view(start(c));
    expect(v.phaseId).toBe('p1');
    expect(v.casualty).toBe('standing');
    expect(v.elapsedMs).toBe(0);
    expect(v.ended).toBe(false);
    expect(v.transcript).toEqual([
      { t: 0, characterId: 'c', lineId: 'l1' },
      { t: 0, characterId: 'b', lineId: 'l3' },
    ]);
  });

  it('applies the variant: flags, timelineAtMs and lineSwaps', () => {
    const c = build((r) => {
      r.initialFlags = { gate: false };
      r.openingLineIds = ['l1'];
      r.actions.push({ id: 'a2', label: 'A2', kind: 'action', phases: ['p1'], requires: { flag: 'gate' } });
      r.timeline = [{ id: 'e1', atMs: 20000, effects: [{ type: 'say', characterId: 'c', lineId: 'l1' }] }];
      r.variants.push({
        id: 'v2',
        label: 'V2',
        flags: { gate: true },
        timelineAtMs: { e1: 5000 },
        lineSwaps: { l1: 'l2' },
      });
    });
    const s1 = start(c);
    expect(cardIds(s1)).not.toContain('a2');
    expect(view(advanceTo(s1, 6000)).transcript).toHaveLength(1);

    const s2 = start(c, { variantId: 'v2' });
    expect(cardIds(s2)).toContain('a2');
    const v2 = view(advanceTo(s2, 6000));
    expect(v2.transcript).toEqual([
      { t: 0, characterId: 'c', lineId: 'l2' },
      { t: 5000, characterId: 'c', lineId: 'l2' },
    ]);
  });
});

// ---------- Cards ----------

describe('cards', () => {
  const c = build((r) => {
    r.initialFlags = { gate: false };
    r.actions = [
      { id: 'a1', label: 'A1', kind: 'action', phases: ['p1'], effects: [{ type: 'setFlag', flag: 'gate', value: true }] },
      { id: 'a2', label: 'A2', kind: 'question', phases: ['p1'], requires: { flag: 'gate', equals: true } },
      { id: 'a3', label: 'A3', kind: 'action', phases: ['p1', 'p2'], repeatable: true, hint: 'H3' },
      { id: 'a4', label: 'A4', kind: 'call', phases: ['p2'], targetCharacterId: 'b' },
      { id: 'a5', label: 'A5', kind: 'action', phases: ['p1'] },
      { id: 'a6', label: 'A6', kind: 'action', phases: ['p1'] },
      { id: 'a7', label: 'A7', kind: 'action', phases: ['p1'] },
      { id: 'a8', label: 'A8', kind: 'action', phases: ['p1'] },
    ];
    r.timeline = [{ id: 'move', atMs: 10000, effects: [{ type: 'gotoPhase', phaseId: 'p2' }] }];
  });

  it('shows only cards of the current phase whose requires condition holds', () => {
    const s = start(c);
    expect(cardIds(s).sort()).toEqual(['a1', 'a3', 'a5', 'a6', 'a7', 'a8']);
    const after = act(s, 'a1', 1000);
    expect(cardIds(after)).toContain('a2');
    const p2 = advanceTo(after, 10000);
    expect(cardIds(p2).sort()).toEqual(['a3', 'a4']);
  });

  it('hides a non-repeatable card once taken and keeps a repeatable one', () => {
    let s = act(start(c), 'a5', 1000);
    expect(cardIds(s)).not.toContain('a5');
    s = act(s, 'a3', 2000);
    s = act(s, 'a3', 3000);
    expect(cardIds(s)).toContain('a3');
  });

  it('orders cards by a seeded shuffle that stays stable within a game', () => {
    const all = c.actions.map((a) => a.id);
    const s = start(c, { seed: 77 });
    const visible = new Set(cardIds(s));
    expect(cardIds(s)).toEqual(shuffle(all, 77).filter((id) => visible.has(id)));
    expect(cardIds(start(c, { seed: 77 }))).toEqual(cardIds(s));
    // Taking a card leaves the order of the others unchanged.
    const before = cardIds(s).filter((id) => id !== 'a6');
    expect(cardIds(act(s, 'a6', 500))).toEqual(before);
    const orders = new Set(Array.from({ length: 8 }, (_, seed) => cardIds(start(c, { seed })).join(',')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('shows hints in guided mode only, and keeps the target character', () => {
    const guided = view(start(c, { mode: 'guided' })).cards.find((x) => x.id === 'a3');
    const real = view(start(c, { mode: 'realtime' })).cards.find((x) => x.id === 'a3');
    expect(guided?.hint).toBe('H3');
    expect(real).toBeDefined();
    expect(real && 'hint' in real).toBe(false);
    const p2 = view(advanceTo(start(c), 10000)).cards.find((x) => x.id === 'a4');
    expect(p2?.targetCharacterId).toBe('b');
  });

  it('shows no cards after the game has ended', () => {
    const s = endGame(start(c), 2000);
    expect(view(s).cards).toEqual([]);
  });
});

// ---------- Timeline ----------

describe('timeline', () => {
  it('fires events in order of due time, not file order', () => {
    const c = build((r) => {
      r.timeline = [
        { id: 'late', atMs: 20000, effects: [{ type: 'say', characterId: 'c', lineId: 'l2' }] },
        { id: 'early', atMs: 10000, effects: [{ type: 'say', characterId: 'c', lineId: 'l1' }] },
      ];
    });
    const v = view(advanceTo(start(c), 25000));
    expect(v.transcript.map((e) => [e.lineId, e.t])).toEqual([
      ['l1', 10000],
      ['l2', 20000],
    ]);
    expect(v.elapsedMs).toBe(25000);
  });

  it('breaks ties in file order, each event seeing the effects of the ones before it', () => {
    const c = build((r) => {
      r.timeline = [
        { id: 'needsY', atMs: 10000, when: { flag: 'y' }, effects: [{ type: 'say', characterId: 'c', lineId: 'l1' }] },
        { id: 'setsX', atMs: 10000, effects: [{ type: 'setFlag', flag: 'x', value: true }] },
        { id: 'needsX', atMs: 10000, when: { flag: 'x' }, effects: [{ type: 'say', characterId: 'c', lineId: 'l2' }] },
        { id: 'setsY', atMs: 10000, effects: [{ type: 'setFlag', flag: 'y', value: true }] },
      ];
    });
    const v = view(advanceTo(start(c), 10000));
    expect(v.transcript.map((e) => e.lineId)).toEqual(['l2']);
  });

  it('fires an afterActionId event delayMs after the first time the action is taken, once only', () => {
    const c = build((r) => {
      r.actions = [{ id: 'a1', label: 'A1', kind: 'action', phases: ['p1'], repeatable: true }];
      r.timeline = [
        { id: 'after', afterActionId: 'a1', delayMs: 5000, effects: [{ type: 'addCounter', counter: 'n', delta: 1 }, { type: 'say', characterId: 'b', lineId: 'l3' }] },
      ];
    });
    let s = act(start(c), 'a1', 3000);
    s = advanceTo(s, 7999);
    expect(view(s).transcript).toEqual([]);
    s = act(s, 'a1', 7999);
    s = advanceTo(s, 8000);
    expect(view(s).transcript).toEqual([{ t: 8000, characterId: 'b', lineId: 'l3' }]);
    s = act(s, 'a1', 9000);
    s = advanceTo(s, 30000);
    expect(view(s).transcript).toHaveLength(1);
  });

  it('never fires an event whose condition fails when it is due, even if it holds later', () => {
    const c = build((r) => {
      r.actions = [{ id: 'a1', label: 'A1', kind: 'action', phases: ['p1'], effects: [{ type: 'setFlag', flag: 'gate', value: true }] }];
      r.initialFlags = { gate: false };
      r.timeline = [{ id: 'gated', atMs: 10000, when: { flag: 'gate', equals: true }, effects: [{ type: 'revealFact', factId: 'f1' }] }];
    });
    const late = advanceTo(act(start(c), 'a1', 12000), 40000);
    expect(view(late).revealedFactIds).toEqual([]);
    const early = advanceTo(act(start(c), 'a1', 9000), 40000);
    expect(view(early).revealedFactIds).toEqual(['f1']);
  });

  it('handles events due at t before an action at t, and zero-delay follow-ups straight after it', () => {
    const c = build((r) => {
      r.actions = [
        { id: 'a1', label: 'A1', kind: 'action', phases: ['p1'], effects: [{ type: 'say', characterId: 'c', lineId: 'l1' }] },
        { id: 'a2', label: 'A2', kind: 'action', phases: ['p1'] },
      ];
      r.timeline = [
        { id: 'move', atMs: 10000, effects: [{ type: 'gotoPhase', phaseId: 'p2' }] },
        { id: 'now', afterActionId: 'a1', delayMs: 0, effects: [{ type: 'say', characterId: 'b', lineId: 'l3' }] },
      ];
    });
    expectEngineError(() => act(start(c), 'a2', 10000), /not a card/);
    const s = act(start(c), 'a1', 4000);
    expect(view(s).transcript).toEqual([
      { t: 4000, characterId: 'c', lineId: 'l1' },
      { t: 4000, characterId: 'b', lineId: 'l3' },
    ]);
  });

  it('ends the game with outcome timeout at maxDurationMs, after events due exactly then', () => {
    const c = build((r) => {
      r.timeline = [
        { id: 'atMax', atMs: 60000, effects: [{ type: 'say', characterId: 'c', lineId: 'l1' }] },
        { id: 'pastMax', atMs: 60001, effects: [{ type: 'say', characterId: 'c', lineId: 'l2' }] },
      ];
    });
    const s = advanceTo(start(c), 999999);
    const v = view(s);
    expect(v.ended).toBe(true);
    expect(v.outcome).toBe('timeout');
    expect(v.elapsedMs).toBe(60000);
    expect(v.transcript.map((e) => e.lineId)).toEqual(['l1']);
    expect(score(s).durationMs).toBe(60000);
    // Exactly at the limit the game is over, so no action fits there.
    expect(view(advanceTo(start(c), 60000))).toMatchObject({ ended: true, outcome: 'timeout' });
    expect(view(advanceTo(start(c), 59999)).ended).toBe(false);
    expectEngineError(() => act(start(c), 'a1', 60000), /ended/);
  });

  it('freezes the clock when an event ends the game, and fires nothing after it', () => {
    const c = build((r) => {
      r.timeline = [
        { id: 'end', atMs: 10000, effects: [{ type: 'endGame', outcome: 'handover' }, { type: 'say', characterId: 'c', lineId: 'l1' }] },
        { id: 'after', atMs: 12000, effects: [{ type: 'say', characterId: 'c', lineId: 'l2' }] },
      ];
    });
    const s = advanceTo(start(c), 30000);
    const v = view(s);
    expect(v.ended).toBe(true);
    expect(v.outcome).toBe('handover');
    expect(v.elapsedMs).toBe(10000);
    expect(v.transcript.map((e) => e.lineId)).toEqual(['l1']);
    expect(advanceTo(s, 50000)).toBe(s);
    expect(score(s).durationMs).toBe(10000);
  });

  it('fires events due at time 0 when the game is created', () => {
    const c = build((r) => {
      r.timeline = [{ id: 'zero', atMs: 0, effects: [{ type: 'setCasualty', status: 'down' }] }];
    });
    expect(view(start(c)).casualty).toBe('down');
  });
});

// ---------- Invalid actions ----------

describe('applyAction rejects invalid actions', () => {
  const c = build((r) => {
    r.initialFlags = { gate: false };
    r.actions = [
      { id: 'a1', label: 'A1', kind: 'action', phases: ['p1'] },
      { id: 'a2', label: 'A2', kind: 'action', phases: ['p1'], requires: { flag: 'gate' } },
      { id: 'a4', label: 'A4', kind: 'action', phases: ['p2'] },
      { id: 'r1', label: 'R1', kind: 'rhythm', phases: ['p1'], repeatable: true, effects: [{ type: 'addCounter', counter: 'taps', delta: 1 }] },
    ];
    r.timeline = [{ id: 'end', atMs: 40000, effects: [{ type: 'endGame', outcome: 'done' }] }];
  });

  it('throws on an unknown action, a card of another phase, a taken card or a failed requires', () => {
    const s = start(c);
    expectEngineError(() => act(s, 'zzz', 1000), /unknown action/);
    expectEngineError(() => act(s, 'a4', 1000), /not a card/);
    expectEngineError(() => act(s, 'a2', 1000), /not a card/);
    expectEngineError(() => act(act(s, 'a1', 1000), 'a1', 2000), /not a card/);
  });

  it('throws when time goes backwards, past maxDurationMs, or is not a number', () => {
    const s = act(start(c), 'a1', 5000);
    expectEngineError(() => act(s, 'r1', 4999, { bpm: 110, count: 10 }), /backwards/);
    expectEngineError(() => advanceTo(s, 4000), /backwards/);
    expectEngineError(() => endGame(s, 4000), /backwards/);
    expectEngineError(() => act(start(c), 'a1', 60001), /limit/);
    expectEngineError(() => act(start(c), 'a1', Number.NaN));
    expectEngineError(() => act(start(c), 'a1', -1));
  });

  it('throws after the game has ended, including when it ends on the way to t', () => {
    expectEngineError(() => act(endGame(start(c), 1000), 'a1', 2000), /ended/);
    expectEngineError(() => act(start(c), 'a1', 45000), /ended/);
  });

  it('throws on a rhythm action without a valid payload', () => {
    const s = start(c);
    expectEngineError(() => act(s, 'r1', 1000), /payload/);
    expectEngineError(() => act(s, 'r1', 1000, { bpm: 0, count: 10 }), /bpm/);
    expectEngineError(() => act(s, 'r1', 1000, { bpm: Number.POSITIVE_INFINITY, count: 10 }), /bpm/);
    expectEngineError(() => act(s, 'r1', 1000, { bpm: 110, count: 2.5 }), /count/);
    expectEngineError(() => act(s, 'r1', 1000, { bpm: 110, count: 0 }), /count/);
  });

  it('never changes the state it is given', () => {
    const s = act(start(c), 'a1', 1000);
    const snapshot = JSON.stringify(s);
    act(s, 'r1', 2000, { bpm: 110, count: 10 });
    advanceTo(s, 50000);
    endGame(s, 3000);
    try {
      act(s, 'a1', 2000);
    } catch {
      // expected
    }
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

// ---------- endGame ----------

describe('endGame', () => {
  it('ends with outcome stopped at t', () => {
    const s = endGame(start(build()), 12345);
    expect(view(s).outcome).toBe('stopped');
    expect(score(s).durationMs).toBe(12345);
  });

  it('keeps the outcome an endGame effect set, and does nothing on an ended game', () => {
    const c = build((r) => {
      r.timeline = [{ id: 'end', atMs: 10000, effects: [{ type: 'endGame', outcome: 'handover' }] }];
    });
    const s = endGame(start(c), 20000);
    expect(view(s).outcome).toBe('handover');
    expect(score(s).durationMs).toBe(10000);
    expect(endGame(s, 30000)).toBe(s);
  });

  it('ends with timeout when t is past maxDurationMs', () => {
    const s = endGame(start(build()), 70000);
    expect(view(s).outcome).toBe('timeout');
    expect(score(s).durationMs).toBe(60000);
  });
});

// ---------- Scoring ----------

describe('score', () => {
  it('scores did and didBefore as done or missed', () => {
    const c = build((r) => {
      r.actions = [
        { id: 'a1', label: 'A1', kind: 'action', phases: ['p1'] },
        { id: 'b1', label: 'B1', kind: 'action', phases: ['p1'] },
      ];
      r.rubric.items = [
        item('did_a1', { kind: 'did', actionId: 'a1' }, 45),
        item('b1_first', { kind: 'didBefore', actionId: 'b1', beforeActionId: 'a1' }, 45),
      ];
    });
    const good = act(act(start(c), 'b1', 1000), 'a1', 1000);
    expect(statusOf(good, 'did_a1')?.status).toBe('done');
    expect(statusOf(good, 'b1_first')?.status).toBe('done');
    const wrongOrder = act(act(start(c), 'a1', 1000), 'b1', 1000);
    expect(statusOf(wrongOrder, 'b1_first')?.status).toBe('missed');
    const onlyB = act(start(c), 'b1', 1000);
    expect(statusOf(onlyB, 'b1_first')?.status).toBe('done');
    expect(statusOf(onlyB, 'did_a1')).toMatchObject({ status: 'missed', earned: 0 });
    expect(statusOf(start(c), 'b1_first')?.status).toBe('missed');
  });

  describe('didWithin', () => {
    const c = build((r) => {
      r.actions = [
        { id: 'a1', label: 'A1', kind: 'action', phases: ['p1', 'p2'] },
        { id: 'x', label: 'X', kind: 'action', phases: ['p1', 'p2'] },
      ];
      r.timeline = [
        { id: 'ev', atMs: 10000, effects: [{ type: 'gotoPhase', phaseId: 'p2' }] },
        { id: 'never', atMs: 10000, when: { flag: 'nope' }, effects: [{ type: 'revealFact', factId: 'f1' }] },
      ];
      r.initialFlags = { nope: false };
      r.rubric.items = [
        item('from_start', { kind: 'didWithin', actionId: 'a1', withinMs: 5000 }, 11),
        item('from_ev', { kind: 'didWithin', actionId: 'x', withinMs: 5000, fromEventId: 'ev' }, 11),
        item('from_never', { kind: 'didWithin', actionId: 'x', withinMs: 50000, fromEventId: 'never' }, 11),
      ];
      r.variants.push({ id: 'v2', label: 'V2', timelineAtMs: { ev: 20000 } });
    });

    it('is done inside the window, late after it (half points rounded down), missed if never', () => {
      expect(statusOf(act(start(c), 'a1', 5000), 'from_start')).toMatchObject({ status: 'done', earned: 11 });
      expect(statusOf(act(start(c), 'a1', 5001), 'from_start')).toMatchObject({ status: 'late', earned: 5 });
      expect(statusOf(start(c), 'from_start')).toMatchObject({ status: 'missed', earned: 0 });
    });

    it('starts the window when fromEventId fired, and misses if that event never fired', () => {
      expect(statusOf(act(start(c), 'x', 15000), 'from_ev')).toMatchObject({ status: 'done', earned: 11 });
      expect(statusOf(act(start(c), 'x', 15001), 'from_ev')).toMatchObject({ status: 'late', earned: 5 });
      // The variant moves the event to 20000, and the window with it.
      expect(statusOf(act(start(c, { variantId: 'v2' }), 'x', 24000), 'from_ev')?.status).toBe('done');
      // Not fired yet when the action was taken and the game stopped: missed.
      expect(statusOf(endGame(act(start(c, { variantId: 'v2' }), 'x', 9000), 9500), 'from_ev')?.status).toBe('missed');
      expect(statusOf(act(start(c), 'x', 12000), 'from_never')?.status).toBe('missed');
    });
  });

  it('scores countAtLeast, counting each tap of a rhythm set', () => {
    const c = build((r) => {
      r.actions = [{ id: 'r1', label: 'R1', kind: 'rhythm', phases: ['p1'], repeatable: true, effects: [{ type: 'addCounter', counter: 'taps', delta: 1 }] }];
      r.rubric.items = [item('taps60', { kind: 'countAtLeast', counter: 'taps', min: 60 }, 90)];
    });
    const one = act(start(c), 'r1', 20000, { bpm: 110, count: 30 });
    expect(statusOf(one, 'taps60')?.status).toBe('missed');
    expect(statusOf(act(one, 'r1', 40000, { bpm: 110, count: 30 }), 'taps60')?.status).toBe('done');
  });

  it('scores rateInRange on the share of sets in range, bounds included', () => {
    const c = build((r) => {
      r.actions = [{ id: 'r1', label: 'R1', kind: 'rhythm', phases: ['p1'], repeatable: true }];
      r.rubric.items = [item('rate', { kind: 'rateInRange', actionId: 'r1', minBpm: 100, maxBpm: 120, minShare: 0.7 }, 90)];
    });
    const play = (bpms: number[]) =>
      bpms.reduce((s, bpm, i) => act(s, 'r1', 1000 * (i + 1), { bpm, count: 10 }), start(c));
    expect(statusOf(play([100, 120, 110, 110, 110, 110, 110, 130, 90, 99.9]), 'rate')?.status).toBe('done'); // 7 of 10
    expect(statusOf(play([100, 120, 110, 110, 110, 110, 120.1, 130, 90, 99.9]), 'rate')?.status).toBe('missed'); // 6 of 10
    expect(statusOf(start(c), 'rate')?.status).toBe('missed');
  });

  it('deducts each harm once, however often its action is taken', () => {
    const c = build((r) => {
      r.actions.push({ id: 'bad', label: 'Bad', kind: 'action', phases: ['p1'], repeatable: true });
      r.rubric.harms = [{ id: 'h', description: 'h', actionId: 'bad', deduction: 30, teachingPoint: 't', ref: REF }];
    });
    const s = endGame(act(act(act(start(c), 'a1', 1000), 'bad', 2000), 'bad', 3000), 4000);
    const rep = score(s);
    expect(rep.harms.map((h) => h.id)).toEqual(['h']);
    expect(rep.total).toBe(90 - 30 + 10);
    expect(score(endGame(act(start(c), 'a1', 1000), 4000)).harms).toEqual([]);
  });

  it('gives full time points up to targetMs, then linear (rounded down) to 0 at zeroAtMs', () => {
    const c = build();
    const tp = (t: number) => score(endGame(start(c), t)).timePoints;
    expect(tp(1000)).toBe(10);
    expect(tp(30000)).toBe(10);
    expect(tp(31000)).toBe(9);
    expect(tp(40000)).toBe(5);
    expect(tp(49999)).toBe(0);
    expect(tp(50000)).toBe(0);
    expect(tp(59000)).toBe(0);
  });

  it('clamps the total to 0 and to 100', () => {
    const harsh = build((r) => {
      r.actions.push({ id: 'bad', label: 'Bad', kind: 'action', phases: ['p1'] });
      r.rubric.harms = [{ id: 'h', description: 'h', actionId: 'bad', deduction: 100, teachingPoint: 't', ref: REF }];
    });
    expect(score(endGame(act(start(harsh), 'bad', 1000), 2000)).total).toBe(0);
    const generous = build((r) => {
      r.rubric.items = [item('r_a1', { kind: 'did', actionId: 'a1' }, 100)];
    });
    expect(score(endGame(act(start(generous), 'a1', 1000), 2000)).total).toBe(100);
  });

  it('reports every rubric item with its points, ref and teaching point', () => {
    const rep = score(endGame(act(start(build()), 'a1', 1000), 2000));
    expect(rep.caseId).toBe('fx');
    expect(rep.items).toEqual([
      {
        id: 'r_a1',
        description: 'r_a1',
        status: 'done',
        points: 90,
        earned: 90,
        critical: false,
        teachingPoint: 't',
        ref: REF,
      },
    ]);
    expect(rep.total).toBe(100);
    expect(rep.durationMs).toBe(2000);
  });
});

// ---------- Determinism ----------

describe('replay', () => {
  const c = build((r) => {
    r.actions = [
      { id: 'a1', label: 'A1', kind: 'action', phases: ['p1'], effects: [{ type: 'say', characterId: 'c', lineId: 'l1' }] },
      { id: 'r1', label: 'R1', kind: 'rhythm', phases: ['p1', 'p2'], repeatable: true, effects: [{ type: 'addCounter', counter: 'taps', delta: 1 }] },
    ];
    r.timeline = [{ id: 'move', atMs: 10000, effects: [{ type: 'gotoPhase', phaseId: 'p2' }] }];
  });
  const cfg: GameConfig = { caseFile: c, seed: 2026, mode: 'realtime', variantId: 'v1' };
  const actions: PlayerAction[] = [
    { actionId: 'a1', t: 1000 },
    { actionId: 'r1', t: 9000, payload: { bpm: 112, count: 30 } },
    { actionId: 'r1', t: 26000, payload: { bpm: 118, count: 30 } },
  ];

  it('gives deep-equal results when run twice', () => {
    const one = replay(cfg, actions, 35000);
    const two = replay(cfg, actions, 35000);
    expect(two.report).toEqual(one.report);
    expect(view(two.state)).toEqual(view(one.state));
    expect(JSON.stringify(two.state)).toBe(JSON.stringify(one.state));
  });

  it('matches playing the same actions one by one', () => {
    let s = createGame(cfg);
    for (const a of actions) s = applyAction(s, a);
    s = endGame(s, 35000);
    const r = replay(cfg, actions, 35000);
    expect(score(s)).toEqual(r.report);
    expect(view(s)).toEqual(view(r.state));
  });

  it('throws EngineError on an invalid run', () => {
    expectEngineError(() => replay(cfg, [{ actionId: 'a1', t: 11000 }], 20000), /not a card/);
    expectEngineError(() => replay(cfg, actions, 20000), /backwards/);
  });
});

// ---------- Integration step 1: appliesWhen, the critical gate on time points, counters, variant time ----------

describe('score: appliesWhen and scaling', () => {
  // a1 and a2 are plain cards; flag_on sets flag x; bump adds 1 to counter k.
  const scaled = (items: Raw[], variants?: Raw[]) =>
    build((r) => {
      r.actions = [
        { id: 'a1', label: 'A1', kind: 'action', phases: ['p1'] },
        { id: 'a2', label: 'A2', kind: 'action', phases: ['p1'] },
        { id: 'flag_on', label: 'F', kind: 'action', phases: ['p1'], effects: [{ type: 'setFlag', flag: 'x', value: true }] },
        { id: 'bump', label: 'B', kind: 'action', phases: ['p1'], effects: [{ type: 'addCounter', counter: 'k', delta: 1 }] },
      ];
      r.rubric.items = items;
      if (variants) r.variants = variants;
    });
  const when = (it: Raw, cond: Raw) => ({ ...it, appliesWhen: cond });

  it('an item whose appliesWhen fails is na and the rest is scaled to the item part', () => {
    const c = scaled([item('r1', { kind: 'did', actionId: 'a1' }, 45), when(item('r2', { kind: 'did', actionId: 'a2' }, 45), { flag: 'x' })]);
    const only = score(endGame(act(start(c), 'a1', 1000), 2000));
    expect(only.items.map((i) => [i.id, i.status, i.earned])).toEqual([
      ['r1', 'done', 45],
      ['r2', 'na', 0],
    ]);
    expect(only.total).toBe(90 + 10);
    // Once flag x is true at the end, r2 applies and is missed.
    const s = endGame(act(act(start(c), 'a1', 1000), 'flag_on', 1500), 2000);
    expect(statusOf(s, 'r2')?.status).toBe('missed');
    expect(score(s).total).toBe(45 + 10);
  });

  it('rounds the scaled item part down', () => {
    const c = scaled([
      item('r1', { kind: 'did', actionId: 'a1' }, 10),
      item('r2', { kind: 'did', actionId: 'a2' }, 25),
      when(item('r3', { kind: 'did', actionId: 'bump' }, 55), { flag: 'x', equals: true }),
    ]);
    const rep = score(endGame(act(start(c), 'a1', 1000), 2000));
    expect(rep.items.find((i) => i.id === 'r3')?.status).toBe('na');
    expect(rep.total).toBe(Math.floor((10 * 90) / 35) + 10); // 25 + 10
  });

  it('when no item applies, the item part counts as full marks', () => {
    const c = scaled([when(item('r1', { kind: 'did', actionId: 'a1' }, 90), { counter: 'k' })]);
    const rep = score(endGame(start(c), 2000));
    expect(rep.items[0].status).toBe('na');
    expect(rep.total).toBe(100);
  });

  it('appliesWhen reads counters (no atLeast means 1 or more) and the phase at the end', () => {
    const c = scaled([
      item('r1', { kind: 'did', actionId: 'a1' }, 30),
      when(item('r2', { kind: 'did', actionId: 'a2' }, 30), { counter: 'k' }),
      when(item('r3', { kind: 'did', actionId: 'a2' }, 30), { phaseId: 'p2' }),
    ]);
    const s = endGame(act(act(start(c), 'a1', 1000), 'bump', 1200), 2000);
    expect(score(s).items.map((i) => i.status)).toEqual(['done', 'missed', 'na']);
  });

  it('time points need every applicable critical item done or late', () => {
    const crit = (it: Raw) => ({ ...it, critical: true });
    const c = scaled([
      crit(item('r1', { kind: 'didWithin', actionId: 'a1', withinMs: 1000 }, 45)),
      when(crit(item('r2', { kind: 'did', actionId: 'a2' }, 45)), { flag: 'x' }),
    ]);
    // Quitting at 5 s without the critical step: no time points (before this step it was 10).
    expect(score(endGame(start(c), 5000)).timePoints).toBe(0);
    expect(score(endGame(act(start(c), 'a1', 500), 5000)).timePoints).toBe(10);
    // late still counts, and a critical item that is na does not block.
    const late = score(endGame(act(start(c), 'a1', 3000), 5000));
    expect([late.items[0].status, late.timePoints]).toEqual(['late', 10]);
    // An applicable critical item that is missed blocks the time points.
    const blocked = score(endGame(act(act(start(c), 'a1', 500), 'flag_on', 700), 5000));
    expect([blocked.items[1].status, blocked.timePoints]).toEqual(['missed', 0]);
  });

  it('a variant time override replaces targetMs and zeroAtMs', () => {
    const c = scaled([item('r1', { kind: 'did', actionId: 'a1' }, 90)], [
      { id: 'v1', label: 'V1' },
      { id: 'v2', label: 'V2', time: { targetMs: 1000, zeroAtMs: 2000 } },
    ]);
    const tp = (variantId: string, t: number) => score(endGame(start(c, { variantId }), t)).timePoints;
    expect([tp('v1', 1500), tp('v2', 1000), tp('v2', 1500), tp('v2', 1999), tp('v2', 2000)]).toEqual([10, 10, 5, 0, 0]);
  });
});

describe('view: counters', () => {
  it('lists every counter of the case from 0, adds delta x count for a rhythm set, and is a plain object', () => {
    const c = build((r) => {
      r.actions = [
        { id: 'a1', label: 'A1', kind: 'action', phases: ['p1'], repeatable: true, effects: [{ type: 'addCounter', counter: 'minutes', delta: 1 }] },
        { id: 'push', label: 'Push', kind: 'rhythm', phases: ['p1'], repeatable: true, effects: [{ type: 'addCounter', counter: 'compressions', delta: 1 }] },
      ];
    });
    let s = start(c);
    expect(view(s).counters).toEqual({ minutes: 0, compressions: 0 });
    s = act(s, 'push', 5000, { bpm: 110, count: 10 });
    s = act(s, 'a1', 6000);
    s = act(s, 'a1', 7000);
    const v = view(s);
    expect(v.counters).toEqual({ minutes: 2, compressions: 10 });
    expect(Object.getPrototypeOf(v.counters)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(v)).counters).toEqual({ minutes: 2, compressions: 10 });
  });
});
