import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../../src/content/loadNode';
import type { CaseFile, PlayerAction } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';

// Chapter 3, "Lunch break": choking (IFRC 2025, page 240).
const FILE = 'ch3-choking-lunch.json';
const RAW = readFileSync(join(CONTENT_DIR, FILE), 'utf8');
const CHECK = validateCase(JSON.parse(RAW));
const CASE = (CHECK.ok ? CHECK.caseFile : JSON.parse(RAW)) as CaseFile;

const ENGINE_FILE = fileURLToPath(new URL('../../src/engine/engine.ts', import.meta.url));
// The engine is written by another module; these runs are skipped if it is missing.
const engine = existsSync(ENGINE_FILE) ? await import('../../src/engine/engine') : undefined;

const STATUSES = ['choking', 'back_blows', 'abdominal_thrusts', 'collapsed', 'cpr', 'recovered'];
const DISCLAIMER =
  'A practice game. It does not replace hands-on first aid training. In an emergency in Addis Ababa, call 907.';
const INSTRUCTION =
  /(^|[.!?]\s+|\(\s*)(call|keep|give|put|stay|lift|cover|lean|push|pull|press|hit|move|wave|lie|tell|check|do not|don't|watch out|get back)\b/i;
// Lines that carry first aid content, whatever their wording, and the page they come from.
const CLINICAL_LINES: Record<string, string> = {
  girl_coughs_harder: '240',
  girl_early_blow: '240',
  student_water: '240',
  girl_water: '240',
  student_fingers: '240',
  girl_fingers: '240',
  girl_cannot_breathe: '240',
  girl_leaned: '240',
  girl_back_blow: '240',
  girl_thrust: '240',
  friend_calling: '240',
  friend_dont_leave: '240',
  teacher_check: '240',
  girl_collapses: '240',
  girl_cpr: 'to confirm',
  crew_takes_over: 'to confirm',
};

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) strings(v, out);
  return out;
}

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

describe('ch3 case file', () => {
  it('passes the schema and the cross-reference rules', () => {
    expect(CHECK.ok ? [] : CHECK.errors).toEqual([]);
  });

  it('rubric points plus time points equal 100, with 10 time points', () => {
    const sum = CASE.rubric.items.reduce((s, r) => s + r.points, 0);
    expect(sum + CASE.rubric.time.maxPoints).toBe(100);
    expect(CASE.rubric.time.maxPoints).toBe(10);
  });

  it('every rubric item and harm is a choking point with a ref to page 240, pending review', () => {
    // The CPR items (integration step 2) apply only after she collapses; their page is still to confirm.
    for (const r of [...CASE.rubric.items, ...CASE.rubric.harms]) {
      const page = r.id.startsWith('cpr_') ? 'to confirm' : '240';
      expect(r.ref, r.id).toEqual({ sourceId: 'ifrc2025', page, review: 'pending' });
    }
  });
  it('CPR items apply only in the arrest phase, after-care items only once she has recovered', () => {
    const byId = new Map(CASE.rubric.items.map((r) => [r.id, r]));
    expect(byId.get('cpr_started')?.check).toEqual({
      kind: 'didWithin', actionId: 'start_compressions', withinMs: 60000, fromEventId: 'collapse',
    });
    expect(byId.get('cpr_rate')?.check).toMatchObject({ kind: 'rateInRange', minBpm: 100, maxBpm: 120 });
    for (const id of ['cpr_started', 'cpr_rate']) expect(byId.get(id)?.appliesWhen, id).toEqual({ phaseId: 'arrest' });
    for (const id of ['comforted', 'health_check']) expect(byId.get(id)?.appliesWhen, id).toEqual({ phaseId: 'recovered' });
  });

  it('every line with an instruction has a ref', () => {
    const roles = new Map(CASE.characters.map((c) => [c.id, c.role]));
    const missing = CASE.lines
      .filter(
        (l) =>
          l.wrongAdvice ||
          l.id in CLINICAL_LINES ||
          roles.get(l.characterId) === 'calltaker' ||
          roles.get(l.characterId) === 'adult' ||
          INSTRUCTION.test(l.text),
      )
      .filter((l) => !l.ref || l.ref.sourceId !== 'ifrc2025' || l.ref.review !== 'pending')
      .map((l) => l.id);
    expect(missing).toEqual([]);
    for (const [id, page] of Object.entries(CLINICAL_LINES)) {
      expect(CASE.lines.find((l) => l.id === id)?.ref?.page, id).toBe(page);
    }
  });

  it('has the two planned wrong-advice lines', () => {
    expect(CASE.lines.filter((l) => l.wrongAdvice).map((l) => l.text)).toEqual([
      'Give her some water!',
      'Put your fingers in her mouth and pull it out!',
    ]);
  });

  it('has at least one practice and one finalOnly variant', () => {
    expect(CASE.variants.some((v) => !v.finalOnly)).toBe(true);
    expect(CASE.variants.some((v) => v.finalOnly)).toBe(true);
  });

  it('back blows and thrusts are repeatable cards that each add 1 to a counter', () => {
    const counterOf = (id: string) => {
      const a = CASE.actions.find((x) => x.id === id);
      expect(a?.repeatable, id).toBe(true);
      return a?.effects.find((e) => e.type === 'addCounter');
    };
    expect(counterOf('back_blow')).toEqual({ type: 'addCounter', counter: 'backBlows', delta: 1 });
    expect(counterOf('abdominal_thrust')).toEqual({ type: 'addCounter', counter: 'thrusts', delta: 1 });
    expect(counterOf('start_compressions')).toEqual({ type: 'addCounter', counter: 'compressions', delta: 1 });
    expect(CASE.actions.find((a) => a.id === 'start_compressions')?.kind).toBe('rhythm');
  });

  it('every card has a Guided hint and a label short enough for a phone button', () => {
    for (const a of CASE.actions) {
      expect(a.hint?.trim().length ?? 0, `${a.id} hint`).toBeGreaterThan(10);
      expect(a.label.length, `${a.id} label`).toBeLessThanOrEqual(30);
    }
  });

  it('uses only the agreed casualty statuses', () => {
    const used = new Set([CASE.startCasualty]);
    for (const e of [...CASE.actions.flatMap((a) => a.effects), ...CASE.timeline.flatMap((t) => t.effects)])
      if (e.type === 'setCasualty') used.add(e.status);
    expect([...used].filter((s) => !STATUSES.includes(s))).toEqual([]);
  });

  it('has the agreed scene, source, disclaimer and length', () => {
    expect(CASE.scene).toBe('lunch-break');
    expect(CASE.sources).toEqual([
      {
        id: 'ifrc2025',
        title: 'IFRC International First Aid, Resuscitation and Education Guidelines 2025',
        url: 'https://www.ifrc.org/document/ifrc-international-first-aid-resuscitation-and-education-guidelines-2025',
      },
    ]);
    expect(CASE.disclaimer).toBe(DISCLAIMER);
    expect(CASE.maxDurationMs).toBeGreaterThanOrEqual(240000);
    expect(CASE.maxDurationMs).toBeLessThanOrEqual(300000);
  });

  it('is plain ASCII with no phone numbers but 907 and no e-mail addresses', () => {
    expect([...RAW].filter((ch) => ch.charCodeAt(0) > 127)).toEqual([]);
    const text = strings(JSON.parse(RAW));
    expect(text.filter((s) => /\S+@\S+\.\S+/.test(s))).toEqual([]);
    const numbers = prose(CASE).flatMap((s) => s.match(/\d{3,}/g) ?? []);
    expect(numbers.filter((n) => !['907', '100', '120'].includes(n))).toEqual([]);
  });
});

type Step = [t: number, actionId: string, payload?: { bpm: number; count: number }];
function play(variantId: string, steps: Step[], endT: number) {
  const actions: PlayerAction[] = steps.map(([t, actionId, payload]) =>
    payload ? { actionId, t, payload } : { actionId, t },
  );
  return engine!.replay({ caseFile: CASE, seed: 20261117, mode: 'realtime', variantId }, actions, endT);
}
const lineIds = (state: Parameters<NonNullable<typeof engine>['view']>[0]) =>
  engine!.view(state).transcript.map((e) => e.lineId);

const OPENING: Step[] = [
  [1000, 'ask_choking'],
  [2500, 'encourage_cough'],
  // she cannot cough, speak or breathe from 12 s
  [12500, 'lean_forward'],
  [13000, 'ask_friend_call'],
];
const PERFECT_BLOWS: Step[] = [
  ...OPENING,
  [13500, 'back_blow'],
  [14000, 'back_blow'],
  [14400, 'back_blow'], // the poll 1 s after the first blow sees 3 blows
  [16000, 'comfort'],
  [18000, 'get_checked'],
];
const PERFECT_THRUSTS: Step[] = [
  ...OPENING,
  [13500, 'back_blow'],
  [14000, 'back_blow'],
  [14500, 'back_blow'],
  [15000, 'back_blow'],
  [15500, 'back_blow'],
  [16500, 'abdominal_thrust'],
  [17000, 'abdominal_thrust'], // the poll 1 s after the first thrust sees 2 thrusts
  [19000, 'comfort'],
  [21000, 'get_checked'],
];
const PERFECT: Record<string, Step[]> = {
  'practice-a': PERFECT_BLOWS,
  'practice-b': PERFECT_THRUSTS,
  'final-a': PERFECT_THRUSTS,
};
const ALL_HARMS: Step[] = [
  [1000, 'ask_choking'],
  [2000, 'back_blow_early'],
  [2500, 'encourage_cough'],
  [3000, 'give_water'],
  [4000, 'fingers_in_mouth'],
  [5000, 'leave_for_teacher'],
  [13000, 'ask_friend_call'],
  [14000, 'lean_forward'],
  // no back blows or thrusts: she stops responding at 80 s
  [81000, 'wait_wake'],
  [82000, 'start_compressions', { bpm: 110, count: 30 }],
];

describe.skipIf(!engine)('ch3 played by the engine', () => {
  it('has a perfect run scripted for every variant', () => {
    expect(Object.keys(PERFECT).sort()).toEqual(CASE.variants.map((v) => v.id).sort());
  });

  for (const v of CASE.variants) {
    it(`a perfect run scores at least 85 (${v.id})`, () => {
      const { state, report } = play(v.id, PERFECT[v.id] ?? [], 60000);
      expect(report.harms).toEqual([]);
      expect(report.total).toBeGreaterThanOrEqual(85);
      expect(engine!.view(state).outcome).toBe('recovered');
      expect(lineIds(state)).toContain('girl_cleared');
    });
  }

  it('a perfect run marks the CPR items "na"; a run that reaches the arrest marks the after-care items "na"', () => {
    // In practice-a the back blows work, so the "5 blows before thrusts" item does not apply.
    const ok = play('practice-a', PERFECT['practice-a'], 60000).report;
    expect(ok.items.filter((i) => i.status === 'na').map((i) => i.id).sort()).toEqual(['blows_before_thrusts', 'cpr_rate', 'cpr_started']);
    const arrest = play('practice-a', ALL_HARMS, 120000).report;
    expect(arrest.items.filter((i) => i.status === 'na').map((i) => i.id).sort()).toEqual(['blows_before_thrusts', 'comforted', 'health_check']);
    expect(arrest.items.find((i) => i.id === 'cpr_started')?.status).toBe('done');
  });
  for (const v of CASE.variants) {
    it(`a run with every harm scores at most 35 (${v.id})`, () => {
      const { state, report } = play(v.id, ALL_HARMS, 120000);
      expect(report.harms.map((h) => h.id).sort()).toEqual(CASE.rubric.harms.map((h) => h.id).sort());
      expect(report.total).toBeLessThanOrEqual(35);
      expect(engine!.view(state).phaseId).toBe('arrest');
    });
  }

  it('practice-a clears after back blows, before the thrust card is ever shown', () => {
    const blows = play('practice-a', PERFECT_BLOWS.slice(0, 7), 16000);
    expect(engine!.view(blows.state).phaseId).toBe('recovered');
    expect(() => play('practice-a', [...OPENING, [13500, 'abdominal_thrust']], 20000)).toThrow(/abdominal_thrust/);
  });

  // IFRC 2025: up to 5 back blows, then up to 5 abdominal thrusts, and repeat.
  it('the abdominal thrust card is shown only after 5 back blows, in every variant', () => {
    expect(CASE.actions.find((a) => a.id === 'abdominal_thrust')?.requires).toEqual({ counter: 'backBlows', atLeast: 5 });
    for (const variantId of ['practice-b', 'final-a']) {
      const cfg = { caseFile: CASE, seed: 7, mode: 'realtime' as const, variantId };
      let s = engine!.createGame(cfg);
      for (const [t, actionId] of PERFECT_THRUSTS.slice(0, 8)) s = engine!.applyAction(s, { actionId, t }); // 4 blows
      const cards = () => engine!.view(s).cards.map((c) => c.id);
      expect(cards(), variantId).not.toContain('abdominal_thrust');
      expect(() => engine!.applyAction(s, { actionId: 'abdominal_thrust', t: 15200 }), variantId).toThrow(/abdominal_thrust/);
      s = engine!.applyAction(s, { actionId: 'back_blow', t: 15500 }); // the 5th
      expect(cards(), variantId).toContain('abdominal_thrust');
    }
  });

  it('where back blows fail, nothing clears the blockage before 5 back blows', () => {
    for (const variantId of ['practice-b', 'final-a']) {
      expect(CASE.variants.find((v) => v.id === variantId)?.flags.blowsWork, variantId).toBe(false);
      const four = play(variantId, PERFECT_THRUSTS.slice(0, 8), 39000); // she collapses at 40 s in the final
      expect(engine!.view(four.state).phaseId, variantId).toBe('severe');
      expect(lineIds(four.state), variantId).not.toContain('girl_cleared');
    }
  });

  it('the blows_before_thrusts item needs 5 back blows when the back blows fail', () => {
    const status = (steps: Step[]) =>
      play('practice-b', steps, 30000).report.items.find((i) => i.id === 'blows_before_thrusts')?.status;
    expect(status(PERFECT_THRUSTS.slice(0, 8))).toBe('missed'); // 4 blows
    expect(status(PERFECT_THRUSTS.slice(0, 9))).toBe('done'); // 5 blows
    expect(play('practice-b', PERFECT_THRUSTS, 60000).report.items.find((i) => i.id === 'blows_before_thrusts')?.status).toBe('done');
  });

  it('practice-b does not clear with back blows; it needs thrusts', () => {
    const blows = PERFECT_THRUSTS.slice(0, 9); // opening and 5 back blows
    const s = play('practice-b', blows, 40000);
    expect(engine!.view(s.state).phaseId).toBe('severe');
    expect(lineIds(s.state)).toContain('friend_still_stuck');
    const done = play('practice-b', PERFECT_THRUSTS.slice(0, 11), 19000);
    expect(engine!.view(done.state).phaseId).toBe('recovered');
  });

  it('final-a: if nothing works in time she stops responding, and CPR is a rhythm card', () => {
    const slow: Step[] = [
      [1000, 'ask_choking'],
      [13000, 'ask_friend_call'],
      [20000, 'back_blow'],
      [21000, 'back_blow'],
    ];
    const cfg = { caseFile: CASE, seed: 5, mode: 'realtime' as const, variantId: 'final-a' };
    let s = engine!.createGame(cfg);
    for (const [t, actionId] of slow) s = engine!.applyAction(s, { actionId, t });
    s = engine!.advanceTo(s, 39000);
    expect(engine!.view(s).phaseId).toBe('severe');
    s = engine!.advanceTo(s, 40000);
    const v = engine!.view(s);
    expect(v.phaseId).toBe('arrest');
    expect(v.casualty).toBe('collapsed');
    expect(v.cards.find((c) => c.id === 'start_compressions')?.kind).toBe('rhythm');
    s = engine!.applyAction(s, { actionId: 'start_compressions', t: 42000, payload: { bpm: 110, count: 30 } });
    expect(engine!.view(s).casualty).toBe('cpr');
    s = engine!.applyAction(s, { actionId: 'start_compressions', t: 62000, payload: { bpm: 112, count: 30 } });
    s = engine!.advanceTo(s, 103000); // the crew comes 90 s after the friend calls
    expect(engine!.view(s).outcome).toBe('crew_took_over');
  });

  it('in practice she stops responding later than in the final', () => {
    const steps: Step[] = [[1000, 'ask_choking']];
    expect(engine!.view(play('practice-a', steps, 79000).state).phaseId).toBe('severe');
    expect(engine!.view(play('practice-a', steps, 80000).state).phaseId).toBe('arrest');
    expect(engine!.view(play('final-a', steps, 40000).state).phaseId).toBe('arrest');
  });

  it('back blows given late earn half the points', () => {
    const late: Step[] = [...OPENING, [23000, 'back_blow'], [23500, 'back_blow'], [24000, 'back_blow']];
    const { report } = play('practice-a', late, 30000);
    expect(report.items.find((i) => i.id === 'blows_quickly')?.status).toBe('late');
  });
});
