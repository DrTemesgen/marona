import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../../src/content/loadNode';
import type { CaseFile, PlayerAction } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';

// Chapter 1, "The minibus stop": a safe scene and the 907 call.
const FILE = 'ch1-safe-scene-minibus.json';
const RAW = readFileSync(join(CONTENT_DIR, FILE), 'utf8');
const CHECK = validateCase(JSON.parse(RAW));
const CASE = (CHECK.ok ? CHECK.caseFile : JSON.parse(RAW)) as CaseFile;

const ENGINE_FILE = fileURLToPath(new URL('../../src/engine/engine.ts', import.meta.url));
// The engine is written by another module; these runs are skipped if it is missing.
const engine = existsSync(ENGINE_FILE) ? await import('../../src/engine/engine') : undefined;

// He stays lying down to the end (integration step 1): 'lying_awake', never 'recovered'.
const STATUSES = ['collapsed', 'lying_awake', 'handover'];
const DISCLAIMER =
  'A practice game. It does not replace hands-on first aid training. In an emergency in Addis Ababa, call 907.';
// An instruction at the start of a sentence (or of a bracketed stage note).
const INSTRUCTION =
  /(^|[.!?]\s+|\(\s*)(call|keep|give|put|stay|lift|cover|lean|push|pull|press|hit|move|wave|lie|tell|check|do not|don't|watch out|get back)\b/i;
// Lines that carry first aid content, whatever their wording.
const CLINICAL_LINES = [
  'passerby_warns',
  'passerby_road',
  'passerby_minibus',
  'passerby_stay',
  'calltaker_answer',
  'calltaker_awake',
  'calltaker_advice',
  'crew_late',
];

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

describe('ch1 case file', () => {
  it('passes the schema and the cross-reference rules', () => {
    expect(CHECK.ok ? [] : CHECK.errors).toEqual([]);
  });

  it('rubric points plus time points equal 100, with 10 time points', () => {
    const sum = CASE.rubric.items.reduce((s, r) => s + r.points, 0);
    expect(sum + CASE.rubric.time.maxPoints).toBe(100);
    expect(CASE.rubric.time.maxPoints).toBe(10);
  });

  it('every rubric item and harm has a ref to the IFRC 2025 source, pending review', () => {
    for (const r of [...CASE.rubric.items, ...CASE.rubric.harms]) {
      expect(r.ref, r.id).toEqual({ sourceId: 'ifrc2025', page: 'to confirm', review: 'pending' });
    }
  });

  it('every line with an instruction has a ref', () => {
    const roles = new Map(CASE.characters.map((c) => [c.id, c.role]));
    const missing = CASE.lines
      .filter(
        (l) =>
          l.wrongAdvice ||
          CLINICAL_LINES.includes(l.id) ||
          roles.get(l.characterId) === 'calltaker' ||
          roles.get(l.characterId) === 'adult' ||
          INSTRUCTION.test(l.text),
      )
      .filter((l) => !l.ref || l.ref.sourceId !== 'ifrc2025' || l.ref.review !== 'pending')
      .map((l) => l.id);
    expect(missing).toEqual([]);
    for (const id of CLINICAL_LINES) expect(CASE.lines.some((l) => l.id === id), id).toBe(true);
  });

  it('has the planned wrong advice as a wrongAdvice line', () => {
    const wrong = CASE.lines.filter((l) => l.wrongAdvice);
    expect(wrong.map((l) => l.text)).toEqual(["Let's lift him into a minibus and take him to hospital ourselves."]);
  });

  it('has at least one practice and one finalOnly variant', () => {
    expect(CASE.variants.some((v) => !v.finalOnly)).toBe(true);
    expect(CASE.variants.some((v) => v.finalOnly)).toBe(true);
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
    expect(CASE.scene).toBe('minibus-stop');
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
    expect(numbers.filter((n) => n !== '907')).toEqual([]);
  });
});

type Step = [t: number, actionId: string];
function play(variantId: string, steps: Step[], endT: number) {
  const actions: PlayerAction[] = steps.map(([t, actionId]) => ({ actionId, t }));
  return engine!.replay({ caseFile: CASE, seed: 20261117, mode: 'realtime', variantId }, actions, endT);
}

const PERFECT: Step[] = [
  [1500, 'check_danger'],
  [3000, 'warn_traffic'],
  [5000, 'ask_response'],
  [7000, 'call_907'],
  [9000, 'say_where'],
  [11000, 'say_what'],
  [13000, 'say_how_many'],
  [15000, 'say_awake'],
  [17000, 'ask_what_now'],
  [19000, 'keep_still'],
  [21000, 'reassure'],
  [23000, 'keep_warm'],
  [84000, 'tell_crew'], // the crew arrives 75 s after the call, at 82 s
];
const HARMS_ONLY: Step[] = [
  [1000, 'run_into_road'],
  [3000, 'help_stand'],
  [5000, 'leave_him'],
  [7000, 'call_907'],
  [9000, 'hang_up'],
  [31000, 'lift_minibus'], // the passer-by suggests it at 30 s
];
const EVERYTHING_PLUS_HARMS: Step[] = [
  [1000, 'check_danger'],
  [2000, 'run_into_road'],
  [3000, 'warn_traffic'],
  [4000, 'help_stand'],
  [5000, 'ask_response'],
  [6000, 'leave_him'],
  [7000, 'call_907'],
  [9000, 'say_where'],
  [11000, 'say_what'],
  [13000, 'say_how_many'],
  [15000, 'say_awake'],
  [16000, 'hang_up'],
  [19000, 'keep_still'],
  [21000, 'reassure'],
  [23000, 'keep_warm'],
  [31000, 'lift_minibus'],
  [84000, 'tell_crew'],
];

describe.skipIf(!engine)('ch1 played by the engine', () => {
  for (const v of CASE.variants) {
    it(`a perfect run scores at least 85 (${v.id})`, () => {
      const { state, report } = play(v.id, PERFECT, 90000);
      expect(report.harms).toEqual([]);
      expect(report.total).toBeGreaterThanOrEqual(85);
      expect(engine!.view(state).outcome).toBe('handed_over');
      expect(engine!.view(state).casualty).toBe('handover');
    });
  }

  it('a run with every harm scores at most 35', () => {
    for (const steps of [HARMS_ONLY, EVERYTHING_PLUS_HARMS]) {
      const { report } = play('practice-a', steps, 200000);
      expect(report.harms.map((h) => h.id).sort()).toEqual(CASE.rubric.harms.map((h) => h.id).sort());
      expect(report.total).toBeLessThanOrEqual(35);
    }
  });

  it('each call question scores, and hanging up early loses the rest', () => {
    const { report } = play('practice-a', EVERYTHING_PLUS_HARMS, 90000);
    const status = Object.fromEntries(report.items.map((i) => [i.id, i.status]));
    for (const id of ['said_where', 'said_what', 'said_how_many', 'said_awake']) expect(status[id], id).toBe('done');
    expect(status.stayed_on_line).toBe('missed');
    expect(report.harms.map((h) => h.id)).toContain('harm_hang_up');
  });

  it('the awake-and-breathing card appears only after talking to him', () => {
    const cfg = { caseFile: CASE, seed: 1, mode: 'guided' as const, variantId: 'practice-a' };
    let s = engine!.createGame(cfg);
    s = engine!.applyAction(s, { actionId: 'call_907', t: 2000 });
    expect(engine!.view(s).cards.map((c) => c.id)).not.toContain('say_awake');
    s = engine!.applyAction(s, { actionId: 'ask_response', t: 3000 });
    expect(engine!.view(s).cards.map((c) => c.id)).toContain('say_awake');
    expect(engine!.view(s).cards.every((c) => typeof c.hint === 'string')).toBe(true);
  });

  it('without a landmark the crew comes late', () => {
    const steps: Step[] = [
      [1000, 'check_danger'],
      [3000, 'ask_response'],
      [4000, 'call_907'],
      [6000, 'hang_up'],
    ];
    const early = play('practice-a', steps, 100000);
    expect(engine!.view(early.state).phaseId).toBe('care');
    const late = play('practice-a', steps, 160000);
    const v = engine!.view(late.state);
    expect(v.phaseId).toBe('handover');
    expect(v.transcript.map((e) => e.lineId)).toContain('crew_late');
    expect(v.transcript.map((e) => e.lineId)).not.toContain('crew_arrive');
  });

  it('covered with a jacket he stays lying down, awake, until the crew comes', () => {
    const steps = PERFECT.filter(([, id]) => id !== 'tell_crew');
    const { state } = play('practice-a', steps, 60000);
    expect(engine!.view(state).casualty).toBe('lying_awake');
  });

  it('the minibus card appears only after the passer-by suggests it', () => {
    const cfg = { caseFile: CASE, seed: 7, mode: 'realtime' as const, variantId: 'practice-a' };
    let s = engine!.advanceTo(engine!.createGame(cfg), 29000);
    expect(engine!.view(s).cards.map((c) => c.id)).not.toContain('lift_minibus');
    s = engine!.advanceTo(s, 30000);
    expect(engine!.view(s).cards.map((c) => c.id)).toContain('lift_minibus');
    expect(engine!.view(s).transcript.map((e) => e.lineId)).toContain('passerby_minibus');
  });
});
