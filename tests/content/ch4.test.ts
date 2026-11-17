import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../../src/content/loadNode';
import type { CaseFile, PlayerAction } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';

// Chapter 4, "Road crash near the school": road safety, firm pressure, keep him still and warm.
const FILE = 'ch4-bleeding-road.json';
const RAW = readFileSync(join(CONTENT_DIR, FILE), 'utf8');
const CHECK = validateCase(JSON.parse(RAW));
const CASE = (CHECK.ok ? CHECK.caseFile : JSON.parse(RAW)) as CaseFile;

const ENGINE_FILE = fileURLToPath(new URL('../../src/engine/engine.ts', import.meta.url));
// The engine is another module; the engine runs below are skipped if it is missing.
const engine = existsSync(ENGINE_FILE) ? await import('../../src/engine/engine') : undefined;

const SPEC = {
  id: 'ch4-bleeding-road',
  chapter: 4,
  title: 'Road crash near the school',
  scene: 'road-crash',
  statuses: ['bleeding', 'pressure', 'collapsed', 'recovered', 'handover'],
  pages: ['256', '307', 'to confirm'],
  wrongAdvice: ['Take the cloth off and see if it has stopped.', 'Lift him onto the bajaj and go.'],
};
const SOURCE = {
  id: 'ifrc2025',
  title: 'IFRC International First Aid, Resuscitation and Education Guidelines 2025',
  url: 'https://www.ifrc.org/document/ifrc-international-first-aid-resuscitation-and-education-guidelines-2025',
};
const DISCLAIMER =
  'A practice game. It does not replace hands-on first aid training. In an emergency in Addis Ababa, call 907.';
const MAX_LABEL = 24; // fits a phone button
// An instruction at the start of a sentence.
const INSTRUCTION =
  /(^|[.!?]\s+)(press|keep|cool|cover|call|put|take|lift|move|hold|pour|check|turn|roll|stay|do not|don't|never|use|wrap|tie|give|add|lay|leave|wait|make|remove|get|go|push|pop|rub|burst|tell|let|stop|run|pull|wave|lie|watch)\b/i;
// Lines that carry first aid content, whatever their wording.
const CLINICAL_LINES = [
  'calltaker_advice',
  'friend_tourniquet',
  'friend_lay_down',
  'friend_more_cloth',
  'friend_pouring',
  'friend_jacket',
  'friend_petrol',
  'crew_arrive',
  'driver_warn',
  'driver_road',
  'rider_press',
];

// The words a student sees (not ids, refs or the source entry).
function prose(c: CaseFile): string[] {
  return [
    c.title,
    c.shortTitle,
    c.intro,
    c.disclaimer,
    ...c.characters.flatMap((x) => [x.name, x.description]),
    ...c.facts.map((f) => f.text),
    ...c.phases.map((p) => p.title),
    ...c.actions.flatMap((a) => [a.label, a.hint ?? '']),
    ...c.lines.map((l) => l.text),
    ...c.rubric.items.flatMap((r) => [r.description, r.teachingPoint]),
    ...c.rubric.harms.flatMap((h) => [h.description, h.teachingPoint]),
    ...c.variants.map((v) => v.label),
  ];
}

const allEffects = (c: CaseFile) => [...c.actions.flatMap((a) => a.effects), ...c.timeline.flatMap((t) => t.effects)];
const spokenLineIds = (c: CaseFile) =>
  new Set([
    ...c.openingLineIds,
    ...allEffects(c).flatMap((e) => (e.type === 'say' ? [e.lineId] : [])),
    ...c.variants.flatMap((v) => Object.values(v.lineSwaps)),
  ]);

// Each rule returns its problems; an empty list means the rule holds.
type Rule = (c: CaseFile) => string[];
const RULES: Record<string, Rule> = {
  schema: (c) => {
    const v = validateCase(c);
    return v.ok ? [] : v.errors;
  },
  points: (c) => {
    const sum = c.rubric.items.reduce((s, r) => s + r.points, 0);
    const out: string[] = [];
    if (sum + c.rubric.time.maxPoints !== 100) out.push(`items ${sum} + time ${c.rubric.time.maxPoints} is not 100`);
    if (c.rubric.time.maxPoints !== 10) out.push(`time points ${c.rubric.time.maxPoints}, want 10`);
    return out;
  },
  itemRefs: (c) =>
    [...c.rubric.items, ...c.rubric.harms].flatMap((r) =>
      r.ref.sourceId === 'ifrc2025' && r.ref.review === 'pending' && SPEC.pages.includes(r.ref.page)
        ? []
        : [`${r.id}: ref ${JSON.stringify(r.ref)}`],
    ),
  lineRefs: (c) =>
    c.lines.flatMap((l) => {
      const needs = l.wrongAdvice || INSTRUCTION.test(l.text) || CLINICAL_LINES.includes(l.id);
      if (!needs) return [];
      if (!l.ref) return [`line ${l.id} carries an instruction but has no ref`];
      return l.ref.sourceId === 'ifrc2025' && l.ref.review === 'pending' && SPEC.pages.includes(l.ref.page)
        ? []
        : [`line ${l.id}: ref ${JSON.stringify(l.ref)}`];
    }),
  variants: (c) => {
    const out: string[] = [];
    if (!c.variants.some((v) => !v.finalOnly)) out.push('no practice variant');
    if (!c.variants.some((v) => v.finalOnly)) out.push('no finalOnly variant');
    return out;
  },
  frame: (c) => {
    const out: string[] = [];
    if (c.id !== SPEC.id) out.push(`id ${c.id}`);
    if (c.chapter !== SPEC.chapter) out.push(`chapter ${c.chapter}`);
    if (c.title !== SPEC.title) out.push(`title ${c.title}`);
    if (c.scene !== SPEC.scene) out.push(`scene ${c.scene}`);
    if (c.disclaimer !== DISCLAIMER) out.push('disclaimer differs');
    if (JSON.stringify(c.sources) !== JSON.stringify([SOURCE])) out.push('source entry differs');
    if (c.maxDurationMs < 240000 || c.maxDurationMs > 360000) out.push(`maxDurationMs ${c.maxDurationMs}`);
    return out;
  },
  cards: (c) =>
    c.actions.flatMap((a) => [
      ...(a.label.length > MAX_LABEL ? [`${a.id}: label longer than ${MAX_LABEL}`] : []),
      ...(a.hint && a.hint.trim() ? [] : [`${a.id}: no hint for Guided mode`]),
    ]),
  statuses: (c) => {
    const used = new Set([c.startCasualty, ...allEffects(c).flatMap((e) => (e.type === 'setCasualty' ? [e.status] : []))]);
    return [
      ...[...used].filter((s) => !SPEC.statuses.includes(s)).map((s) => `status ${s} is not drawn`),
      ...SPEC.statuses.filter((s) => !used.has(s)).map((s) => `status ${s} is never used`),
    ];
  },
  prose: (c) =>
    prose(c).flatMap((t) => [
      ...(/^[\x20-\x7e]*$/.test(t) ? [] : [`not plain ASCII: ${t}`]),
      ...(t.match(/\d{3,}/g) ?? []).filter((d) => d !== '907').map((d) => `number ${d} in: ${t}`),
      ...(/@|https?:|www\./i.test(t) ? [`address in: ${t}`] : []),
    ]),
  wrongAdvice: (c) => {
    const spoken = spokenLineIds(c);
    const wrong = c.lines.filter((l) => l.wrongAdvice);
    return [
      ...SPEC.wrongAdvice.filter((text) => !wrong.some((l) => l.text === text)).map((t) => `missing wrong advice: ${t}`),
      ...wrong.filter((l) => !SPEC.wrongAdvice.includes(l.text)).map((l) => `unplanned wrong advice ${l.id}`),
      ...wrong.filter((l) => !spoken.has(l.id)).map((l) => `wrong advice ${l.id} is never said`),
      ...wrong.filter((l) => c.characters.find((x) => x.id === l.characterId)?.role !== 'bystander').map((l) => `${l.id} not a bystander`),
    ];
  },
  tourniquetUnscored: (c) => {
    const card = c.actions.find((a) => a.id === 'tourniquet_info');
    if (!card) return ['no tourniquet information card'];
    const scoredCounters = new Set(c.rubric.items.flatMap((r) => (r.check.kind === 'countAtLeast' ? [r.check.counter] : [])));
    return [
      ...c.rubric.items
        .filter((r) => ('actionId' in r.check && r.check.actionId === card.id) || (r.check.kind === 'didBefore' && r.check.beforeActionId === card.id))
        .map((r) => `rubric ${r.id} scores the tourniquet card`),
      ...c.rubric.harms.filter((h) => h.actionId === card.id).map((h) => `harm ${h.id} is the tourniquet card`),
      ...card.effects.filter((e) => e.type === 'addCounter' && scoredCounters.has(e.counter)).map(() => 'tourniquet card adds to a scored counter'),
      ...(card.effects.some((e) => e.type === 'say' && c.lines.find((l) => l.id === e.lineId)?.ref?.page === '256')
        ? []
        : ['tourniquet card does not say a line from page 256']),
    ];
  },
  harmsCoverWrongAdvice: (c) =>
    ['lift_cloth', 'lift_bajaj'].filter((id) => !c.rubric.harms.some((h) => h.actionId === id)).map((id) => `no harm for ${id}`),
};

describe('ch4 case file', () => {
  it('the file is plain ASCII', () => {
    expect(/^[\x00-\x7f]*$/.test(RAW)).toBe(true);
  });
  for (const [name, rule] of Object.entries(RULES)) {
    it(`rule ${name} holds`, () => {
      expect(rule(CASE)).toEqual([]);
    });
  }
});

describe('ch4 information facts', () => {
  it('the shock signs fact carries a ref; the tourniquet information is a line with a ref to page 256', () => {
    expect(CASE.facts.find((f) => f.id === 'shock_signs')?.ref).toEqual({ sourceId: 'ifrc2025', page: 'to confirm', review: 'pending' });
    expect(CASE.lines.find((l) => l.id === 'friend_tourniquet')?.ref?.page).toBe('256');
  });
});

describe('ch4 rules see planted defects', () => {
  const plant = (fn: (c: CaseFile) => void): CaseFile => {
    const bad = structuredClone(CASE);
    fn(bad);
    return bad;
  };
  const line = (c: CaseFile, id: string) => c.lines.find((l) => l.id === id)!;
  const action = (c: CaseFile, id: string) => c.actions.find((a) => a.id === id)!;
  const cases: [string, (c: CaseFile) => void][] = [
    ['schema', (c) => (action(c, 'press_wound').phases = ['nowhere'])],
    ['points', (c) => (c.rubric.items[0].points += 5)],
    ['itemRefs', (c) => (c.rubric.items[1].ref.page = '')],
    ['lineRefs', (c) => delete line(c, 'calltaker_advice').ref],
    ['lineRefs', (c) => delete line(c, 'friend_tourniquet').ref],
    ['variants', (c) => c.variants.forEach((v) => (v.finalOnly = false))],
    ['frame', (c) => (c.disclaimer = 'A game.')],
    ['frame', (c) => (c.maxDurationMs = 600000)],
    ['cards', (c) => (action(c, 'keep_warm').label = 'Take off your own jacket and cover him')],
    ['cards', (c) => delete action(c, 'reassure').hint],
    ['statuses', (c) => (c.startCasualty = 'standing')],
    ['prose', (c) => (line(c, 'driver_called').text = 'Call me on 0900 000000.')],
    ['prose', (c) => (c.intro += ' ' + String.fromCharCode(0x2014) + ' hurry')],
    ['wrongAdvice', (c) => (line(c, 'driver_look').wrongAdvice = false)],
    [
      'tourniquetUnscored',
      (c) =>
        c.rubric.items.push({ ...structuredClone(c.rubric.items[0]), id: 'tq', check: { kind: 'did', actionId: 'tourniquet_info' } }),
    ],
    ['harmsCoverWrongAdvice', (c) => (c.rubric.harms = c.rubric.harms.filter((h) => h.actionId !== 'lift_bajaj'))],
  ];
  for (const [rule, fn] of cases) {
    it(`rule ${rule} fails on a planted defect`, () => {
      expect(RULES[rule](plant(fn)).length).toBeGreaterThan(0);
    });
  }
});

// ---------- Scripted runs through the engine ----------

type Step = [number, string];
function run(variantId: string, steps: Step[], endT?: number) {
  const actions: PlayerAction[] = steps.map(([t, actionId]) => ({ t, actionId })).sort((a, b) => a.t - b.t);
  const last = actions.length ? actions[actions.length - 1].t : 0;
  return engine!.replay({ caseFile: CASE, seed: 4242, mode: 'realtime', variantId }, actions, endT ?? last);
}

// Look, warn, call, protect the hand, press, keep still, add cloth, watch for shock, keep warm.
const PERFECT: Step[] = [
  [2000, 'check_danger'],
  [4000, 'warn_traffic'],
  [6000, 'call_907'], // the ambulance comes 90 s later
  [8000, 'cover_hand'],
  [10000, 'press_wound'], // blood soaks through 20 s later
  [12000, 'keep_still'],
  [14000, 'reassure'],
  [16000, 'tourniquet_info'],
  [31000, 'add_cloth'],
  [52000, 'check_shock'],
  [54000, 'keep_warm'],
  [97000, 'hand_over'],
];
// Follows the bajaj driver's advice, presses late, lifts the cloth, calls late.
const HARMFUL: Step[] = [
  [6000, 'lift_bajaj'],
  [9000, 'stand_in_road'],
  [50000, 'press_wound'],
  [86000, 'lift_cloth'], // the driver says "take the cloth off" at 85 s
  [91000, 'press_wound'],
  [100000, 'call_907'],
  [192000, 'hand_over'],
];
// The perfect run with every harm added (and the pressure put back after each one).
const PERFECT_WITH_HARMS: Step[] = [
  ...PERFECT,
  [5000, 'stand_in_road'],
  [11000, 'lift_bajaj'],
  [11500, 'press_wound'],
  [46000, 'lift_cloth'],
  [47000, 'press_wound'],
];

describe.skipIf(!engine)('ch4 engine runs', () => {
  for (const v of CASE.variants) {
    it(`a perfect run scores at least 85 in ${v.id}${v.finalOnly ? ' (final)' : ''}`, () => {
      const { report } = run(v.id, PERFECT);
      expect(report.items.filter((i) => i.status !== 'done').map((i) => i.id)).toEqual([]);
      expect(report.harms).toEqual([]);
      expect(report.total).toBeGreaterThanOrEqual(85);
    });
    it(`a run with all harms scores at most 35 in ${v.id}`, () => {
      const harmful = run(v.id, HARMFUL).report;
      expect(harmful.harms.map((h) => h.id).sort()).toEqual(CASE.rubric.harms.map((h) => h.id).sort());
      expect(harmful.total).toBeLessThanOrEqual(35);
      const careful = run(v.id, PERFECT_WITH_HARMS).report;
      expect(careful.harms.length).toBe(CASE.rubric.harms.length);
      expect(careful.total).toBeLessThanOrEqual(35);
    });
  }
  it('the tourniquet card earns no points', () => {
    const without = PERFECT.filter(([, id]) => id !== 'tourniquet_info');
    expect(run('practice-a', without).report.total).toBe(run('practice-a', PERFECT).report.total);
  });
  it('looking for danger only after pressing misses the safety item', () => {
    const { report } = run('practice-a', [[3000, 'press_wound'], [5000, 'check_danger']]);
    expect(report.items.find((i) => i.id === 'safety_first')!.status).toBe('missed');
  });
  it('lifting the cloth starts the bleeding again', () => {
    const { state } = run('practice-a', [[10000, 'press_wound'], [20000, 'lift_cloth']], 20000);
    expect(engine!.view(state).casualty).toBe('bleeding');
  });
  it('with no pressure he collapses at 90 s', () => {
    const { state } = run('practice-a', [[2000, 'check_danger']], 95000);
    expect(engine!.view(state).casualty).toBe('collapsed');
  });
});
if (!engine) it.skip('ch4 engine runs: skipped, src/engine/engine.ts not found', () => {});

describe('ch4 hints fit the scene', () => {
  it('the keep_still hint speaks of the motorbike crash, not a fall', () => {
    const hint = CASE.actions.find((a) => a.id === 'keep_still')?.hint ?? '';
    expect(hint).toMatch(/motorbike crash/);
    expect(hint).not.toMatch(/\bfall\b/i);
  });
});
