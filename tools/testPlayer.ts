// Test player: scripted chapter 2 runs, and a smoke player that plays any case file.
// The tests in tests/engine use it. Run it on its own to see every chapter's smoke score:
//   npx tsx tools/testPlayer.ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT_DIR, caseFileNames } from '../src/content/loadNode';
import { advanceTo, applyAction, createGame, endGame, score, view, type GameState } from '../src/engine/engine';
import type { CaseFile, GameCard, GameConfig, Mode, PlayerAction, ScoreReport } from '../src/shared/contract';
import { validateCase } from '../src/shared/validateCase';

export interface ScriptedRun {
  name: 'perfect' | 'typicalMistakes' | 'harmful';
  variantId: string;
  actions: PlayerAction[];
  endT: number;
}

// Time one rhythm set takes: count taps at bpm span (count - 1) beats.
export function setMs(bpm: number, count: number): number {
  return Math.round(((count - 1) * 60000) / bpm);
}

// Chapter 2 timing in practice-a. The values must match ch2-cpr-school-gate.json.
export const CH2_COLLAPSE_MS = 75000;
export const CH2_HELP_DELAY_MS = 360000;

// When the collapse happens in a given chapter 2 variant (read from the case file).
export function ch2CollapseAt(caseFile: CaseFile, variantId: string): number {
  const v = caseFile.variants.find((x) => x.id === variantId);
  const ev = caseFile.timeline.find((x) => x.id === 'collapse');
  const at = v?.timelineAtMs?.['collapse'] ?? ev?.atMs;
  if (at === undefined) throw new Error(`no collapse time for ${caseFile.id} / ${variantId}`);
  return at;
}

type Add = (t: number, actionId: string, payload?: { bpm: number; count: number }) => void;

function recorder(): { actions: PlayerAction[]; add: Add } {
  const actions: PlayerAction[] = [];
  const add: Add = (t, actionId, payload) => {
    actions.push(payload ? { actionId, t, payload: { ...payload } } : { actionId, t });
  };
  return { actions, add };
}

// Everything right: calls 907 early, checks, starts CPR fast at 106-115 a minute, swaps, and
// keeps going until the crew takes over.
function perfectRun(collapseAt: number, helpDelay: number): { actions: PlayerAction[]; endT: number } {
  const { actions, add } = recorder();
  const callAt = 6000;
  add(3000, 'check_danger');
  add(callAt, 'call_907');
  add(9000, 'ask_pain');
  add(12000, 'help_sit');
  add(15000, 'send_friend_adult');
  add(18000, 'ask_aspirin');
  add(21000, 'tell_907_aspirin');
  const helpAt = callAt + helpDelay;
  let t = collapseAt + 4000;
  add(t, 'check_response');
  t += 6000;
  add(t, 'check_breathing');
  t += 3000;
  add(t, 'tell_907_not_breathing');
  t += 3000;
  add(t, 'send_for_aed');
  const bpms = [110, 112, 108, 115, 110, 106, 113, 111, 109, 114, 110, 112, 107, 115, 110, 111, 109, 113, 110, 112];
  let n = 0;
  let total = 0;
  let swapped = false;
  t += setMs(bpms[0] as number, 30);
  while (t < helpAt - 500) {
    add(t, 'start_compressions', { bpm: bpms[n % bpms.length] as number, count: 30 });
    total += 30;
    n += 1;
    if (!swapped && total >= 210) {
      t += 2000;
      if (t >= helpAt) break;
      add(t, 'swap_rescuer');
      swapped = true;
    }
    t += setMs(bpms[n % bpms.length] as number, 30) + 500;
  }
  return { actions, endT: helpAt };
}

// Common mistakes: no call during the chest pain, believes the older student for about 50
// seconds, then calls late, starts CPR late, pushes too fast, never swaps.
function typicalRun(collapseAt: number, helpDelay: number): { actions: PlayerAction[]; endT: number } {
  const { actions, add } = recorder();
  add(4000, 'check_danger');
  add(8000, 'ask_pain');
  add(12000, 'help_sit');
  add(collapseAt + 5000, 'check_response');
  add(collapseAt + 50000, 'check_breathing');
  const callAt = collapseAt + 55000;
  add(callAt, 'call_907_now');
  const bpms = [128, 132, 116, 130, 135, 127, 112, 131, 129, 134, 118, 126];
  let t = callAt + 1000 + setMs(bpms[0] as number, 30);
  bpms.forEach((bpm, i) => {
    add(t, 'start_compressions', { bpm, count: 30 });
    if (i === 5) {
      t += 2000;
      add(t, 'send_for_aed');
    }
    t += setMs(bpms[i + 1] ?? bpm, 30) + 1500;
  });
  return { actions, endT: callAt + helpDelay };
}

// Harmful: calls 907, then gives water, checks a pulse for a long time and carries him to a car.
function harmfulRun(collapseAt: number, helpDelay: number): { actions: PlayerAction[]; endT: number } {
  const { actions, add } = recorder();
  const callAt = 9000;
  add(5000, 'help_sit');
  add(callAt, 'call_907');
  add(collapseAt + 5000, 'give_water');
  add(collapseAt + 11000, 'pulse_check_long');
  add(collapseAt + 20000, 'carry_to_car');
  return { actions, endT: callAt + helpDelay };
}

export function buildCh2Run(
  name: ScriptedRun['name'],
  opts: { variantId?: string; collapseAtMs?: number; helpDelayMs?: number } = {},
): ScriptedRun {
  const collapseAt = opts.collapseAtMs ?? CH2_COLLAPSE_MS;
  const helpDelay = opts.helpDelayMs ?? CH2_HELP_DELAY_MS;
  const build = name === 'perfect' ? perfectRun : name === 'typicalMistakes' ? typicalRun : harmfulRun;
  return { name, variantId: opts.variantId ?? 'practice-a', ...build(collapseAt, helpDelay) };
}

export const ch2Perfect: ScriptedRun = buildCh2Run('perfect');
export const ch2TypicalMistakes: ScriptedRun = buildCh2Run('typicalMistakes');
export const ch2Harmful: ScriptedRun = buildCh2Run('harmful');
export const ch2Runs = { perfect: ch2Perfect, typicalMistakes: ch2TypicalMistakes, harmful: ch2Harmful };

// ---------- Smoke player (any case file) ----------

export interface SmokeResult {
  cfg: GameConfig;
  actions: PlayerAction[];
  endT: number;
  state: GameState;
  report: ScoreReport;
  steps: number;
  cardsPlayed: string[]; // distinct card ids played, in first-played order
}

// The card played least so far; ties go to the card shown first.
function pickCard(cards: GameCard[], played: Map<string, number>): GameCard | undefined {
  let best: GameCard | undefined;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of cards) {
    const n = played.get(c.id) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

// Plays every available card in turn (the least played first; rhythm cards with a set of 30
// taps at 110 a minute), letting time pass when no card is shown, until the game ends.
export function smokePlay(
  caseFile: CaseFile,
  seed: number,
  opts: { variantId?: string; mode?: Mode; stepMs?: number } = {},
): SmokeResult {
  const variantId = opts.variantId ?? caseFile.variants.find((v) => !v.finalOnly)?.id ?? caseFile.variants[0]?.id;
  if (variantId === undefined) throw new Error(`smokePlay: ${caseFile.id} has no variant`);
  const cfg: GameConfig = { caseFile, seed, mode: opts.mode ?? 'guided', variantId };
  const stepMs = opts.stepMs ?? 2000;
  const max = caseFile.maxDurationMs;
  const maxSteps = Math.ceil(max / 1000) + 1000;
  const played = new Map<string, number>();
  const cardsPlayed: string[] = [];
  const actions: PlayerAction[] = [];
  let state = createGame(cfg);
  let t = 0;
  let steps = 0;
  while (!view(state).ended) {
    steps += 1;
    if (steps > maxSteps) throw new Error(`smokePlay: ${caseFile.id} did not end after ${maxSteps} steps`);
    const card = pickCard(view(state).cards, played);
    if (!card) {
      t = Math.min(max, t + 5000);
      state = advanceTo(state, t);
      continue;
    }
    const payload = card.kind === 'rhythm' ? { bpm: 110, count: 30 } : undefined;
    const next = t + (payload ? setMs(payload.bpm, payload.count) : stepMs);
    if (next > max) {
      state = advanceTo(state, max);
      break;
    }
    t = next;
    state = advanceTo(state, t);
    const now = view(state);
    if (now.ended || !now.cards.some((c) => c.id === card.id)) continue;
    const action: PlayerAction = payload ? { actionId: card.id, t, payload } : { actionId: card.id, t };
    state = applyAction(state, action);
    actions.push(action);
    if (!played.has(card.id)) cardsPlayed.push(card.id);
    played.set(card.id, (played.get(card.id) ?? 0) + 1);
  }
  const endT = view(state).elapsedMs;
  state = endGame(state, endT);
  return { cfg, actions, endT, state, report: score(state), steps, cardsPlayed };
}

// ---------- Command line ----------

function main(): void {
  for (const f of caseFileNames()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8'));
    } catch {
      console.log(`${f}: skipped, not valid JSON`);
      continue;
    }
    const check = validateCase(raw);
    if (!check.ok) {
      console.log(`${f}: skipped, fails validateCase (${check.errors.length} errors, first: ${check.errors[0]})`);
      continue;
    }
    const r = smokePlay(check.caseFile, 12345);
    console.log(
      `${f}: smoke ${r.report.total}/100, ${r.actions.length} actions, ${r.cardsPlayed.length} cards, ` +
        `ended ${view(r.state).outcome} at ${r.report.durationMs} ms`,
    );
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url.toLowerCase() === pathToFileURL(resolve(entry)).href.toLowerCase()) {
  main();
}
