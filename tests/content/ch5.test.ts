import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../../src/content/loadNode';
import type { CaseFile, PlayerAction } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';

// Chapter 5, "Hot water at home": cool the burn 10-20 minutes, cover it, get help, no home remedies.
const FILE = 'ch5-burns-home.json';
const RAW = readFileSync(join(CONTENT_DIR, FILE), 'utf8');
const CHECK = validateCase(JSON.parse(RAW));
const CASE = (CHECK.ok ? CHECK.caseFile : JSON.parse(RAW)) as CaseFile;

const ENGINE_FILE = fileURLToPath(new URL('../../src/engine/engine.ts', import.meta.url));
// The engine is another module; the engine runs below are skipped if it is missing.
const engine = existsSync(ENGINE_FILE) ? await import('../../src/engine/engine') : undefined;

const SPEC = {
  id: 'ch5-burns-home',
  chapter: 5,
  title: 'Hot water at home',
  scene: 'home-kitchen',
  statuses: ['burn', 'cooling', 'recovered'],
  pages: ['288', 'to confirm'],
  // The relative's advice; the final variant swaps butter for toothpaste.
  wrongAdvice: ['Put butter on it, it always works.', 'Put toothpaste on it, it always works.'],
  myths: ['butter', 'toothpaste', 'egg', 'ice', 'oil', 'blisters'],
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
const CLINICAL_LINES = ['calltaker_advice', 'aunt_butter', 'aunt_toothpaste', 'brother_watch'];

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
const addsTo = (c: CaseFile, actionId: string, counter: string) =>
  c.actions.find((a) => a.id === actionId)?.effects.some((e) => e.type === 'addCounter' && e.counter === counter && e.delta === 1) ??
  false;

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
      ...wrong.filter((l) => l.characterId !== 'aunt').map((l) => `${l.id} is not the relative's line`),
    ];
  },
  coolingCounter: (c) => {
    const out: string[] = [];
    const keep = c.actions.find((a) => a.id === 'keep_cooling');
    if (!keep?.repeatable) out.push('keep_cooling must be repeatable');
    if (!addsTo(c, 'keep_cooling', 'cooling_minutes')) out.push('keep_cooling must add 1 minute to cooling_minutes');
    for (const min of [10, 20]) {
      const has = c.rubric.items.some((r) => r.check.kind === 'countAtLeast' && r.check.counter === 'cooling_minutes' && r.check.min === min);
      if (!has) out.push(`no rubric item for ${min} minutes of cooling`);
    }
    return out;
  },
  medicalHelp: (c) => {
    const out: string[] = [];
    if (!c.rubric.items.some((r) => r.check.kind === 'countAtLeast' && r.check.counter === 'medical_help'))
      out.push('no rubric item for medical help');
    for (const id of ['call_907', 'go_health_centre']) if (!addsTo(c, id, 'medical_help')) out.push(`${id} does not count as medical help`);
    return out;
  },
  // Cool the burn, not the child: a card to keep him warm while cooling, and an item that scores it.
  keepWarm: (c) => {
    const out: string[] = [];
    const card = c.actions.find((a) => a.id === 'keep_warm');
    if (!card?.phases.includes('cooling')) out.push('no keep_warm card while cooling');
    if (!/^Keep him warm with a dry cloth around the rest of his body\./.test(card?.hint ?? '')) out.push('keep_warm hint differs');
    const item = c.rubric.items.find((r) => r.check.kind === 'did' && r.check.actionId === 'keep_warm');
    if (!item) out.push('no rubric item for keeping him warm');
    else if (!/not the child/i.test(item.teachingPoint)) out.push('keep-warm teaching point does not say "not the child"');
    return out;
  },
  myths: (c) =>
    SPEC.myths
      .filter((m) => !c.rubric.harms.some((h) => c.actions.find((a) => a.id === h.actionId)?.label.toLowerCase().includes(m)))
      .map((m) => `no harm card for ${m}`),
};

describe('ch5 case file', () => {
  it('the file is plain ASCII', () => {
    expect(/^[\x00-\x7f]*$/.test(RAW)).toBe(true);
  });
  for (const [name, rule] of Object.entries(RULES)) {
    it(`rule ${name} holds`, () => {
      expect(rule(CASE)).toEqual([]);
    });
  }
});

describe('ch5 rules see planted defects', () => {
  const plant = (fn: (c: CaseFile) => void): CaseFile => {
    const bad = structuredClone(CASE);
    fn(bad);
    return bad;
  };
  const line = (c: CaseFile, id: string) => c.lines.find((l) => l.id === id)!;
  const action = (c: CaseFile, id: string) => c.actions.find((a) => a.id === id)!;
  const cases: [string, (c: CaseFile) => void][] = [
    ['schema', (c) => (c.rubric.items[0].check = { kind: 'countAtLeast', counter: 'never_added', min: 1 })],
    ['points', (c) => (c.rubric.time.maxPoints = 15)],
    ['itemRefs', (c) => (c.rubric.harms[0].ref.sourceId = 'blog')],
    ['lineRefs', (c) => delete line(c, 'aunt_butter').ref],
    ['variants', (c) => (c.variants = c.variants.filter((v) => !v.finalOnly))],
    ['frame', (c) => (c.scene = 'kitchen')],
    ['cards', (c) => (action(c, 'cover').label = 'Cover the burn loosely with clean food wrap')],
    ['statuses', (c) => (action(c, 'cover').effects = action(c, 'cover').effects.filter((e) => e.type !== 'setCasualty'))],
    ['prose', (c) => (line(c, 'aunt_go').text = 'Write to me at aunt@example.org.')],
    ['wrongAdvice', (c) => (line(c, 'aunt_butter').text = 'Put butter on it.')],
    ['coolingCounter', (c) => (action(c, 'keep_cooling').repeatable = false)],
    ['coolingCounter', (c) => (c.rubric.items = c.rubric.items.filter((r) => r.id !== 'cool_20'))],
    ['medicalHelp', (c) => (action(c, 'go_health_centre').effects = [{ type: 'endGame', outcome: 'health_centre' }])],
    ['myths', (c) => (c.rubric.harms = c.rubric.harms.filter((h) => h.id !== 'h_ice'))],
    ['keepWarm', (c) => (c.rubric.items = c.rubric.items.filter((r) => r.id !== 'kept_warm'))],
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
  return engine!.replay({ caseFile: CASE, seed: 5150, mode: 'realtime', variantId }, actions, endT ?? last);
}
// The same taps without ending the game, to look at the cards still on screen.
function play(variantId: string, steps: Step[]) {
  let s = engine!.createGame({ caseFile: CASE, seed: 5150, mode: 'realtime', variantId });
  for (const [t, actionId] of [...steps].sort((a, b) => a[0] - b[0])) s = engine!.applyAction(s, { t, actionId });
  return s;
}
// n taps of "keep cooling", one second apart from `from`.
const cooling = (from: number, n: number): Step[] => Array.from({ length: n }, (_, i) => [from + i * 1000, 'keep_cooling']);

// Safe kitchen, cool at once, watch off, 20 minutes, kind word to the aunt, cover, 907, health centre.
const PERFECT: Step[] = [
  [1500, 'make_safe'],
  [3000, 'cool_start'], // minute 1
  [4500, 'remove_watch'],
  [5200, 'keep_warm'], // cool the burn, not the child
  ...cooling(6000, 19), // minutes 2-20
  [25000, 'tell_aunt'],
  [26000, 'cover'],
  [27000, 'call_907'],
  [28000, 'go_health_centre'],
];
// Follows the home remedies, cools late and only for 5 minutes, pops the blisters.
const HARMFUL: Step[] = [
  [13000, 'harm_butter'],
  [15000, 'harm_toothpaste'],
  [17000, 'harm_egg'],
  [19000, 'harm_oil'],
  [21000, 'harm_ice'],
  [40000, 'cool_start'],
  ...cooling(41000, 4),
  [56000, 'harm_blisters'], // the blisters show 15 s after cooling starts
  [57000, 'cover'],
  [60000, 'go_health_centre'],
];
// The perfect run with every harm added.
const PERFECT_WITH_HARMS: Step[] = [
  ...PERFECT,
  [6500, 'harm_butter'],
  [7500, 'harm_toothpaste'],
  [8500, 'harm_egg'],
  [9500, 'harm_ice'],
  [10500, 'harm_oil'],
  [18500, 'harm_blisters'],
];

describe.skipIf(!engine)('ch5 engine runs', () => {
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
  it('10 taps earn the 10-minute item but not the 20-minute one', () => {
    const { report } = run('practice-a', [[3000, 'cool_start'], ...cooling(4000, 9), [14000, 'cover']]);
    const status = Object.fromEntries(report.items.map((i) => [i.id, i.status]));
    expect([status.cool_10, status.cool_20]).toEqual(['done', 'missed']);
  });
  it('covering after 5 minutes ends the cooling and misses both cooling items', () => {
    const steps: Step[] = [[3000, 'cool_start'], ...cooling(4000, 4)];
    const cardsOf = (s: Step[]) => engine!.view(play('practice-a', s)).cards.map((card) => card.id);
    expect(cardsOf(steps)).toContain('keep_cooling');
    expect(cardsOf([...steps, [9000, 'cover']])).not.toContain('keep_cooling');
    const { report } = run('practice-a', [...steps, [9000, 'cover']]);
    const status = Object.fromEntries(report.items.map((i) => [i.id, i.status]));
    expect([status.cool_10, status.cool_20]).toEqual(['missed', 'missed']);
  });
  it('the final variant swaps the butter advice for toothpaste', () => {
    const lines = (variantId: string) => engine!.view(run(variantId, [], 13000).state).transcript.map((e) => e.lineId);
    expect(lines('practice-a')).toContain('aunt_butter');
    expect(lines('final-a')).toContain('aunt_toothpaste');
    expect(lines('final-a')).not.toContain('aunt_butter');
  });
});
if (!engine) it.skip('ch5 engine runs: skipped, src/engine/engine.ts not found', () => {});
