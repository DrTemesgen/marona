import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../../src/content/loadNode';
import { advanceTo, applyAction, createGame, replay, score, view, type GameState } from '../../src/engine/engine';
import type { CaseFile, GameConfig } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';
import {
  CH2_COLLAPSE_MS,
  CH2_HELP_DELAY_MS,
  buildCh2Run,
  ch2CollapseAt,
  ch2Runs,
  type ScriptedRun,
} from '../../tools/testPlayer';

const FILE = 'ch2-cpr-school-gate.json';
const rawText = readFileSync(join(CONTENT_DIR, FILE), 'utf8');
const check = validateCase(JSON.parse(rawText));
if (!check.ok) throw new Error(`${FILE} is invalid:\n${check.errors.join('\n')}`);
const ch2: CaseFile = check.caseFile;

const cfg = (variantId: string, seed = 7, mode: GameConfig['mode'] = 'realtime'): GameConfig => ({
  caseFile: ch2,
  seed,
  mode,
  variantId,
});
const run = (r: ScriptedRun, seed = 7) => replay(cfg(r.variantId, seed), r.actions, r.endT);

describe('chapter 2 case file', () => {
  it('passes validateCase', () => {
    expect(check.ok).toBe(true);
    expect(ch2.id).toBe('ch2-cpr-school-gate');
    expect(ch2.chapter).toBe(2);
    expect(ch2.title).toBe('The teacher at the school gate');
    expect(ch2.scene).toBe('school-gate');
    expect(ch2.phases.map((p) => p.id)).toEqual(['chest_pain', 'arrest', 'handover']);
  });

  it('keeps the timing that the scripted runs assume', () => {
    expect(ch2.timeline.find((e) => e.id === 'collapse')?.atMs).toBe(CH2_COLLAPSE_MS);
    expect(ch2.timeline.find((e) => e.id === 'help_arrives')?.delayMs).toBe(CH2_HELP_DELAY_MS);
    expect(ch2.timeline.find((e) => e.id === 'help_arrives_late')?.delayMs).toBe(CH2_HELP_DELAY_MS);
    for (const v of ch2.variants.filter((x) => x.id !== 'practice-a')) {
      const at = ch2CollapseAt(ch2, v.id);
      expect(at).toBeGreaterThanOrEqual(45000);
      expect(at).toBeLessThanOrEqual(60000);
    }
  });

  it('has the three variants, the final one hidden from practice', () => {
    expect(ch2.variants.map((v) => [v.id, v.finalOnly])).toEqual([
      ['practice-a', false],
      ['practice-b', false],
      ['final-a', true],
    ]);
  });

  it('cites the guideline on every clinical line, rubric item and harm', () => {
    expect(ch2.sources.map((s) => s.id)).toEqual(['ifrc2025']);
    const instructions = new Set(['guard_swap', 'bystander_aed_none']);
    const clinical = ch2.lines.filter((l) => l.characterId === 'calltaker' || l.wrongAdvice || instructions.has(l.id));
    expect(clinical.length).toBe(9);
    for (const l of clinical) expect(l.ref, l.id).toMatchObject({ sourceId: 'ifrc2025', review: 'pending' });
    for (const r of [...ch2.rubric.items, ...ch2.rubric.harms]) {
      expect(r.ref, r.id).toMatchObject({ sourceId: 'ifrc2025', review: 'pending' });
    }
  });

  it('marks the bystander advice as wrong, and swaps keep the same speaker', () => {
    const line = (id: string) => ch2.lines.find((l) => l.id === id);
    expect(line('bystander_breathing')?.wrongAdvice).toBe(true);
    for (const v of ch2.variants) {
      for (const [from, to] of Object.entries(v.lineSwaps)) {
        expect(line(to)?.characterId, `${v.id}: ${from} -> ${to}`).toBe(line(from)?.characterId);
        expect(line(to)?.wrongAdvice).toBe(line(from)?.wrongAdvice);
      }
    }
  });

  it('gives no points for aspirin, and no AED ever arrives', () => {
    const aspirin = new Set(['ask_aspirin', 'tell_907_aspirin']);
    for (const r of ch2.rubric.items) {
      const k = r.check;
      expect('actionId' in k && aspirin.has(k.actionId), r.id).toBe(false);
    }
    for (const h of ch2.rubric.harms) expect(aspirin.has(h.actionId)).toBe(false);
    expect(ch2.timeline.map((e) => e.id).filter((id) => /aed/i.test(id))).toEqual(['aed_none']);
    for (const v of ch2.variants) expect(Object.keys(v.flags).filter((f) => /aed/i.test(f))).toEqual([]);
  });

  it('uses plain ASCII, the exact disclaimer, no emblem names and no phone number but 907', () => {
    expect(/^[\x20-\x7e\r\n]*$/.test(rawText)).toBe(true);
    expect(ch2.disclaimer).toBe(
      'A practice game. It does not replace hands-on first aid training. In an emergency in Addis Ababa, call 907.',
    );
    expect(rawText).not.toMatch(/red\s+(cross|crescent|crystal)/i);
    // Every text a player can read: no phone-number-like run of digits, and no e-mail address.
    const texts: string[] = [];
    const walk = (x: unknown): void => {
      if (typeof x === 'string') texts.push(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    walk(JSON.parse(rawText));
    const all = texts.join('\n');
    expect(all.match(/\+?\d[\d\s-]{4,}\d/g) ?? []).toEqual([]);
    expect(all).not.toMatch(/@/);
    expect(all).toMatch(/907/);
  });
});

describe('chapter 2 play', () => {
  it('collapses at 75 s in practice-a: arrest phase, collapsed, and the wrong advice', () => {
    let s = createGame(cfg('practice-a'));
    s = advanceTo(s, 74999);
    expect(view(s).phaseId).toBe('chest_pain');
    s = advanceTo(s, 75000);
    const v = view(s);
    expect(v.phaseId).toBe('arrest');
    expect(v.casualty).toBe('collapsed');
    expect(v.transcript.at(-1)).toEqual({ t: 75000, characterId: 'bystander', lineId: 'bystander_breathing' });
  });

  it('collapses earlier with other wording in practice-b and final-a', () => {
    const b = view(advanceTo(createGame(cfg('practice-b')), 50000));
    expect(b.phaseId).toBe('arrest');
    expect(b.transcript.at(-1)?.lineId).toBe('bystander_breathing_b');
    const f = view(advanceTo(createGame(cfg('final-a')), 55000));
    expect(f.phaseId).toBe('arrest');
    expect(f.transcript.at(-1)?.lineId).toBe('bystander_breathing_c');
  });

  it('brings the guard after the friend goes, or at 150 s if nobody was sent', () => {
    const sent = advanceTo(applyAction(createGame(cfg('practice-a')), { actionId: 'send_friend_adult', t: 10000 }), 200000);
    const lines = (s: GameState) => view(s).transcript.filter((e) => e.characterId === 'guard').map((e) => [e.lineId, e.t]);
    expect(lines(sent)).toEqual([['guard_comes_line', 55000]]);
    const alone = advanceTo(createGame(cfg('practice-a')), 200000);
    expect(lines(alone)).toEqual([['guard_hears_line', 150000]]);
  });

  it('shows the aspirin call card only after asking and calling 907', () => {
    let s = createGame(cfg('practice-a'));
    s = applyAction(s, { actionId: 'ask_aspirin', t: 2000 });
    expect(view(s).cards.map((c) => c.id)).not.toContain('tell_907_aspirin');
    expect(view(s).revealedFactIds).toContain('fact_aspirin');
    s = applyAction(s, { actionId: 'call_907', t: 4000 });
    expect(view(s).cards.map((c) => c.id)).toContain('tell_907_aspirin');
  });

  it('allows the swap only after 200 compressions, and counts every tap', () => {
    let s = advanceTo(createGame(cfg('practice-a')), 160000); // collapsed, guard here
    const ids = () => view(s).cards.map((c) => c.id);
    let t = 160000;
    for (let i = 0; i < 6; i++) {
      t += 16000;
      s = applyAction(s, { actionId: 'start_compressions', t, payload: { bpm: 110, count: 30 } });
    }
    expect(ids()).not.toContain('swap_rescuer'); // 180
    s = applyAction(s, { actionId: 'start_compressions', t: t + 16000, payload: { bpm: 110, count: 30 } });
    expect(ids()).toContain('swap_rescuer'); // 210
    expect(view(s).casualty).toBe('cpr');
  });

  it('ends with the crew 6 minutes after the call, or at the limit if nobody calls', () => {
    const called = advanceTo(applyAction(createGame(cfg('practice-a')), { actionId: 'call_907', t: 6000 }), 999999);
    expect(view(called)).toMatchObject({ ended: true, outcome: 'handover', phaseId: 'handover', casualty: 'handover', elapsedMs: 366000 });
    const never = advanceTo(createGame(cfg('practice-a')), 999999);
    expect(view(never)).toMatchObject({ ended: true, outcome: 'timeout', elapsedMs: ch2.maxDurationMs });
  });
});

describe('chapter 2 scripted runs land in their bands', () => {
  it('perfect >= 85', () => {
    const r = run(ch2Runs.perfect);
    expect(r.report.total).toBeGreaterThanOrEqual(85);
    expect(r.report.harms).toEqual([]);
    expect(r.report.items.every((i) => i.status === 'done')).toBe(true);
    expect(r.report.timePoints).toBe(10);
    expect(view(r.state).outcome).toBe('handover');
  });

  it('typical mistakes between 40 and 80, with late and missed items', () => {
    const r = run(ch2Runs.typicalMistakes);
    expect(r.report.total).toBeGreaterThanOrEqual(40);
    expect(r.report.total).toBeLessThanOrEqual(80);
    const st = Object.fromEntries(r.report.items.map((i) => [i.id, i.status]));
    expect(st).toMatchObject({ called_907_early: 'missed', compressions_started: 'late', rate_ok: 'missed', swapped: 'missed' });
  });

  it('harmful <= 35, with all three harms', () => {
    const r = run(ch2Runs.harmful);
    expect(r.report.total).toBeLessThanOrEqual(35);
    expect(r.report.harms.map((h) => h.id).sort()).toEqual(['harm_carry', 'harm_pulse', 'harm_water']);
  });

  it('keeps the same bands in every variant and for any seed or mode', () => {
    for (const v of ch2.variants) {
      const collapseAtMs = ch2CollapseAt(ch2, v.id);
      for (const seed of [0, 1, 4294967295]) {
        for (const mode of ['guided', 'realtime'] as const) {
          const total = (name: ScriptedRun['name']) => {
            const r = buildCh2Run(name, { variantId: v.id, collapseAtMs });
            return score(replay(cfg(v.id, seed, mode), r.actions, r.endT).state).total;
          };
          expect(total('perfect'), v.id).toBeGreaterThanOrEqual(85);
          expect(total('typicalMistakes'), v.id).toBeGreaterThanOrEqual(40);
          expect(total('typicalMistakes'), v.id).toBeLessThanOrEqual(80);
          expect(total('harmful'), v.id).toBeLessThanOrEqual(35);
        }
      }
    }
  });

  it('replays to deep-equal reports', () => {
    for (const r of Object.values(ch2Runs)) {
      expect(run(r).report).toEqual(run(r).report);
      expect(JSON.stringify(run(r).state)).toBe(JSON.stringify(run(r).state));
    }
  });
});
