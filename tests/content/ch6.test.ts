import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../../src/content/loadNode';
import type { CaseFile, PlayerAction, Variant } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';

// Chapter 6, "A classmate falls in class": protect, time it, nothing in the mouth, on his side after.
const FILE = 'ch6-seizure-class.json';
const RAW = readFileSync(join(CONTENT_DIR, FILE), 'utf8');
const CHECK = validateCase(JSON.parse(RAW));
const CASE = (CHECK.ok ? CHECK.caseFile : JSON.parse(RAW)) as CaseFile;

const ENGINE_FILE = fileURLToPath(new URL('../../src/engine/engine.ts', import.meta.url));
// The engine is another module; the engine runs below are skipped if it is missing.
const engine = existsSync(ENGINE_FILE) ? await import('../../src/engine/engine') : undefined;

const SPEC = {
  id: 'ch6-seizure-class',
  chapter: 6,
  title: 'A classmate falls in class',
  scene: 'classroom',
  // 'collapsed' (integration step 1): lying still, eyes closed, before the recovery position.
  statuses: ['seizure', 'collapsed', 'recovery', 'recovered', 'handover'],
  pages: ['399-400', 'to confirm'],
  wrongAdvice: ['Hold his tongue so he does not swallow it.', 'Pour water on his face.'],
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
const CLINICAL_LINES = ['calltaker_dispatch', 'calltaker_wait', 'loud_tongue', 'loud_water', 'deskmate_jacket', 'deskmate_holddown'];

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
// When an event with atMs fires in a variant.
const atMsIn = (c: CaseFile, v: Variant, eventId: string): number | undefined =>
  v.timelineAtMs[eventId] ?? c.timeline.find((e) => e.id === eventId)?.atMs;

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
  // About 90 s in practice; over 5 minutes in a final variant, where the 907 call becomes due at 5 minutes.
  seizureTiming: (c) => {
    const out: string[] = [];
    for (const v of c.variants) {
      const stops = atMsIn(c, v, 'seizure_stops') ?? -1;
      const due = atMsIn(c, v, 'call_needed') ?? -1;
      if (!v.finalOnly && (stops < 60000 || stops > 120000)) out.push(`${v.id}: shaking stops at ${stops} ms`);
      if (stops > c.maxDurationMs - 30000) out.push(`${v.id}: no time left after the shaking stops`);
      if (v.finalOnly && stops > 300000 && due < 300000) out.push(`${v.id}: 907 is due before 5 minutes`);
    }
    if (!c.variants.some((v) => v.finalOnly && (atMsIn(c, v, 'seizure_stops') ?? 0) > 300000))
      out.push('no final variant where the seizure lasts over 5 minutes');
    const call = c.rubric.items.find((r) => r.check.kind === 'didWithin' && r.check.actionId === 'call_907');
    if (!call || call.check.kind !== 'didWithin' || call.check.fromEventId !== 'call_needed')
      out.push('the 907 item must time the call from the call_needed event');
    return out;
  },
  oneCallCard: (c) => {
    const early = c.actions.find((a) => a.id === 'call_907_early')?.requires;
    const now = c.actions.find((a) => a.id === 'call_907')?.requires;
    const ok =
      early?.flag === 'call_needed' && now?.flag === 'call_needed' && early.equals === false && now.equals === true;
    return ok ? [] : ['the two "Call 907" cards must never show at the same time'];
  },
  harmsCover: (c) =>
    ['harm_hold_down', 'harm_tongue', 'harm_water'].filter((id) => !c.rubric.harms.some((h) => h.actionId === id)).map((id) => `no harm for ${id}`),
};

describe('ch6 case file', () => {
  it('the file is plain ASCII', () => {
    expect(/^[\x00-\x7f]*$/.test(RAW)).toBe(true);
  });
  for (const [name, rule] of Object.entries(RULES)) {
    it(`rule ${name} holds`, () => {
      expect(rule(CASE)).toEqual([]);
    });
  }
});

describe('ch6 rules see planted defects', () => {
  const plant = (fn: (c: CaseFile) => void): CaseFile => {
    const bad = structuredClone(CASE);
    fn(bad);
    return bad;
  };
  const line = (c: CaseFile, id: string) => c.lines.find((l) => l.id === id)!;
  const action = (c: CaseFile, id: string) => c.actions.find((a) => a.id === id)!;
  const final = (c: CaseFile) => c.variants.find((v) => v.finalOnly)!;
  const cases: [string, (c: CaseFile) => void][] = [
    ['schema', (c) => (c.variants[0].timelineAtMs = { no_such_event: 1 })],
    ['points', (c) => (c.rubric.items[2].points = 5)],
    ['itemRefs', (c) => (c.rubric.items[0].ref.review = 'reviewed')],
    ['lineRefs', (c) => delete line(c, 'calltaker_wait').ref],
    ['variants', (c) => c.variants.forEach((v) => (v.finalOnly = true))],
    ['frame', (c) => (c.sources[0].url = 'https://example.org/')],
    ['cards', (c) => (action(c, 'ask_history').label = 'Has this happened to him before?')],
    ['statuses', (c) => (action(c, 'recovery_position').effects = [{ type: 'setCasualty', status: 'side' }])],
    ['prose', (c) => (line(c, 'teacher_arrive').text = 'My number is 0900 000000.')],
    ['wrongAdvice', (c) => (c.timeline = c.timeline.filter((e) => e.id !== 'water_advice'))],
    ['seizureTiming', (c) => (final(c).timelineAtMs.seizure_stops = 200000)],
    ['seizureTiming', (c) => (final(c).timelineAtMs.call_needed = 1000)],
    ['seizureTiming', (c) => (c.variants[0].timelineAtMs.seizure_stops = 30000)],
    ['oneCallCard', (c) => delete action(c, 'call_907_early').requires],
    ['harmsCover', (c) => (c.rubric.harms = c.rubric.harms.filter((h) => h.actionId !== 'harm_tongue'))],
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
  return engine!.replay({ caseFile: CASE, seed: 6006, mode: 'realtime', variantId }, actions, endT ?? last);
}
const timesOf = (v: Variant) => {
  const stops = atMsIn(CASE, v, 'seizure_stops')!;
  const call = Math.max(8000, atMsIn(CASE, v, 'call_needed')! + 2000);
  const teacher = atMsIn(CASE, v, 'teacher_arrives')!;
  const crewDelay = CASE.timeline.find((e) => e.id === 'crew_arrives')!.delayMs!;
  return { stops, call, teacher, helpAt: Math.min(call + crewDelay, teacher) };
};

// Note the time, clear the space, cushion the head, ask, call 907 when it is due; after the
// shaking: breathing, on his side, stay; tell the helper what happened.
const perfect = (v: Variant): Step[] => {
  const t = timesOf(v);
  return [
    [1500, 'note_time'],
    [3000, 'clear_space'],
    [4500, 'cushion_head'],
    [6000, 'ask_history'],
    [t.call, 'call_907'],
    [t.stops + 2000, 'check_breathing'],
    [t.stops + 4000, 'recovery_position'],
    [t.stops + 6000, 'stay_with'],
    [t.helpAt + 1000, 'hand_over'],
  ];
};
// Follows the shouted advice, holds him down, never calls, never puts him on his side.
const harmful = (v: Variant): Step[] => {
  const t = timesOf(v);
  return [
    [9000, 'harm_tongue'],
    [12000, 'harm_hold_down'],
    [31000, 'harm_water'],
    [t.stops + 10000, 'check_breathing'],
    [t.teacher + 2000, 'hand_over'],
  ];
};
const perfectWithHarms = (v: Variant): Step[] => [
  ...perfect(v),
  [9000, 'harm_tongue'],
  [10000, 'harm_hold_down'],
  [31000, 'harm_water'],
];

describe.skipIf(!engine)('ch6 engine runs', () => {
  for (const v of CASE.variants) {
    it(`a perfect run scores at least 85 in ${v.id}${v.finalOnly ? ' (final)' : ''}`, () => {
      const { report } = run(v.id, perfect(v));
      expect(report.items.filter((i) => i.status !== 'done').map((i) => i.id)).toEqual([]);
      expect(report.harms).toEqual([]);
      expect(report.total).toBeGreaterThanOrEqual(85);
    });
    it(`a run with all harms scores at most 35 in ${v.id}`, () => {
      const bad = run(v.id, harmful(v)).report;
      expect(bad.harms.map((h) => h.id).sort()).toEqual(CASE.rubric.harms.map((h) => h.id).sort());
      expect(bad.total).toBeLessThanOrEqual(35);
      const careful = run(v.id, perfectWithHarms(v)).report;
      expect(careful.harms.length).toBe(CASE.rubric.harms.length);
      expect(careful.total).toBeLessThanOrEqual(35);
    });
  }
  const finalV = CASE.variants.find((v) => v.finalOnly)!;
  const callStatus = (steps: Step[]) =>
    run(finalV.id, steps, 359000).report.items.find((i) => i.id === 'call_when_needed')!.status;
  it('in the final, an early call alone does not count; the call after 5 minutes does', () => {
    expect(callStatus([[20000, 'call_907_early']])).toBe('missed');
    expect(callStatus([[20000, 'call_907_early'], [302000, 'call_907']])).toBe('done');
    expect(callStatus([[340000, 'call_907']])).toBe('done');
    expect(callStatus([[346000, 'call_907']])).toBe('late');
  });
  it('the 907 item counts only once a call is due: na when the final ends before 5 minutes', () => {
    const item = CASE.rubric.items.find((i) => i.id === 'call_when_needed')!;
    expect(item.appliesWhen).toEqual({ flag: 'call_needed' });
    const early = run(finalV.id, [[1500, 'note_time']], 200000).report;
    expect(early.items.find((i) => i.id === 'call_when_needed')?.status).toBe('na');
    expect(early.timePoints).toBe(0); // and stopping early earns no time points
    expect(callStatus([[340000, 'call_907']])).toBe('done');
  });

  it('after the shaking stops he lies still (collapsed art) until the recovery position', () => {
    const t = timesOf(CASE.variants[0]);
    const { state } = run('practice-a', [], t.stops + 1000);
    expect(engine!.view(state).casualty).toBe('collapsed');
  });

  it('in the final, the 5-minute warning names the clock only if you noted the time', () => {
    const lines = (steps: Step[]) => engine!.view(run(finalV.id, steps, 301000).state).transcript.map((e) => e.lineId);
    expect(lines([[1500, 'note_time']])).toContain('deskmate_five');
    expect(lines([])).toContain('deskmate_five_untimed');
  });
  it('in practice the shaking stops at about 90 s', () => {
    const { state } = run('practice-a', [], 91000);
    expect(engine!.view(state).phaseId).toBe('after');
  });
});
if (!engine) it.skip('ch6 engine runs: skipped, src/engine/engine.ts not found', () => {});
