// Game engine: plays one chapter from its case file, the same way every time.
// Pure and deterministic: the same config and the same taps give the same state and the same
// score on the phone and on the server. No clock, no unseeded randomness, no input or output.
//
// Rules that fill gaps the contract leaves open:
// - Times are ms since game start. A time passed in may never be earlier than elapsedMs.
// - An event is due at atMs (a variant may override it), or else delayMs after the first time
//   its afterActionId was taken. Due events are handled in order of due time, ties in file
//   order. Events due at time t come before an action taken at t; an event that an action makes
//   due at once (delayMs 0) comes straight after that action.
// - An event whose "when" condition fails at its due time is dropped and never fires.
// - In a condition, a flag with no "equals" must be true and a counter with no "atLeast" must be
//   1 or more. A flag never set is false; a counter never added to is 0.
// - A rhythm action needs a payload { bpm, count }. Its addCounter effects add delta once per
//   tap (delta x count); its other effects apply once. Its t is the time the set is handed in.
// - All effects of one action or event apply in order, even after an endGame effect.
// - didBefore is done when the action was taken and the other action was not taken before it
//   (or never). didWithin uses the first time the action was taken; earlier than the window
//   start counts as done.
// - Time points are whole numbers (rounded down), so the total is a whole number. They are given
//   only when every applicable critical item is done or late; a variant's time overrides
//   rubric.time targetMs and zeroAtMs.
// - A rubric item with appliesWhen is checked against the final state; if it fails the item is
//   'na' and left out, and the item part (100 - time.maxPoints) is scaled over the applicable
//   points, rounded down. No applicable item at all counts as full marks for the item part.
import type {
  Action,
  CaseFile,
  Condition,
  Effect,
  GameCard,
  GameConfig,
  GameView,
  Mode,
  PlayerAction,
  RubricCheck,
  ScoreReport,
  TimelineEvent,
  TranscriptEntry,
  Variant,
} from '../shared/contract';
import { shuffle } from './rng';

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

type Dict<T> = Record<string, T>;

interface TakenAction {
  readonly actionId: string;
  readonly t: number;
  readonly payload?: { readonly bpm: number; readonly count: number };
}

interface State {
  caseFile: CaseFile;
  variant: Variant;
  mode: Mode;
  seed: number;
  cardOrder: readonly string[]; // every action id, shuffled once by the seed
  phaseId: string;
  casualty: string;
  flags: Dict<boolean>;
  counters: Dict<number>;
  elapsedMs: number;
  ended: boolean;
  outcome: string | undefined;
  endedAtMs: number | undefined;
  taken: TakenAction[]; // every action taken, in order
  firstTakenAt: Dict<number>; // action id -> first time taken
  firedAt: Dict<number>; // event id -> time it fired
  droppedAt: Dict<number>; // event id -> due time at which its condition failed
  transcript: TranscriptEntry[];
  revealedFactIds: string[];
}

// Opaque outside the engine: read it through view() and score().
export type GameState = Readonly<State>;

// Sanity limits for one rhythm set. They only reject impossible input, not poor technique.
const MAX_BPM = 1000;
const MAX_COUNT = 1000;

// ---------- Public API ----------

export function createGame(cfg: GameConfig): GameState {
  return newState(cfg);
}

export function applyAction(state: GameState, action: PlayerAction): GameState {
  const s = clone(state);
  applyInPlace(s, action);
  return s;
}

export function advanceTo(state: GameState, t: number): GameState {
  checkTime(t, 'time');
  if (state.ended) return state;
  if (t < state.elapsedMs) throw new EngineError(`time goes backwards: ${t} ms is before ${state.elapsedMs} ms`);
  const s = clone(state);
  advance(s, t);
  return s;
}

export function endGame(state: GameState, t: number): GameState {
  checkTime(t, 'end time');
  if (state.ended) return state;
  const s = clone(state);
  endInPlace(s, t);
  return s;
}

export function view(state: GameState): GameView {
  const c = state.caseFile;
  const cards: GameCard[] = [];
  if (!state.ended) {
    for (const id of state.cardOrder) {
      const a = c.actions.find((x) => x.id === id);
      if (!a || !isCard(state, a)) continue;
      const card: GameCard = { id: a.id, label: a.label, kind: a.kind };
      if (a.targetCharacterId !== undefined) card.targetCharacterId = a.targetCharacterId;
      if (state.mode === 'guided' && a.hint !== undefined) card.hint = a.hint;
      cards.push(card);
    }
  }
  // Every counter the case adds to, 0 until added to (a plain object for the UI).
  const counters: Record<string, number> = {};
  for (const name of counterNames(c)) counters[name] = counterOf(state, name);
  for (const name of Object.keys(state.counters)) counters[name] = counterOf(state, name);
  const v: GameView = {
    caseId: c.id,
    phaseId: state.phaseId,
    casualty: state.casualty,
    elapsedMs: state.elapsedMs,
    ended: state.ended,
    cards,
    transcript: state.transcript.map((e) => ({ t: e.t, characterId: e.characterId, lineId: e.lineId })),
    revealedFactIds: state.revealedFactIds.slice(),
    counters,
  };
  if (state.outcome !== undefined) v.outcome = state.outcome;
  return v;
}

export function score(state: GameState): ScoreReport {
  const c = state.caseFile;
  const items = c.rubric.items.map((item) => {
    const applies = item.appliesWhen === undefined || holds(state, item.appliesWhen);
    const status: ScoreReport['items'][number]['status'] = applies ? checkStatus(state, item.check) : 'na';
    const earned = status === 'done' ? item.points : status === 'late' ? Math.floor(item.points / 2) : 0;
    return {
      id: item.id,
      description: item.description,
      status,
      points: item.points,
      earned,
      critical: item.critical,
      teachingPoint: item.teachingPoint,
      ref: { ...item.ref },
    };
  });
  // Each harm deducts once, however often its action was taken.
  const harms = (c.rubric.harms ?? [])
    .filter((h) => Object.hasOwn(state.firstTakenAt, h.actionId))
    .map((h) => ({
      id: h.id,
      description: h.description,
      deduction: h.deduction,
      teachingPoint: h.teachingPoint,
      ref: { ...h.ref },
    }));
  const durationMs = state.ended && state.endedAtMs !== undefined ? state.endedAtMs : state.elapsedMs;
  const applicable = items.filter((i) => i.status !== 'na');
  // A student who stops before doing the critical steps earns no time points for being quick.
  const criticalOk = applicable.every((i) => !i.critical || i.status === 'done' || i.status === 'late');
  const time = {
    maxPoints: c.rubric.time.maxPoints,
    targetMs: state.variant.time?.targetMs ?? c.rubric.time.targetMs,
    zeroAtMs: state.variant.time?.zeroAtMs ?? c.rubric.time.zeroAtMs,
  };
  const timePoints = criticalOk ? timePointsFor(time, durationMs) : 0;
  const itemMax = Math.max(0, 100 - c.rubric.time.maxPoints);
  const earnedApplicable = applicable.reduce((sum, i) => sum + i.earned, 0);
  const pointsApplicable = applicable.reduce((sum, i) => sum + i.points, 0);
  // Integer arithmetic before the one division, so an unscaled case keeps its exact sum.
  const itemPart = pointsApplicable > 0 ? Math.floor((earnedApplicable * itemMax) / pointsApplicable) : itemMax;
  const deductions = harms.reduce((sum, h) => sum + h.deduction, 0);
  const total = Math.min(100, Math.max(0, itemPart - deductions + timePoints));
  return { caseId: c.id, total, items, harms, timePoints, durationMs };
}

export function replay(
  cfg: GameConfig,
  actions: readonly PlayerAction[],
  endT: number,
): { state: GameState; report: ScoreReport } {
  if (!Array.isArray(actions)) throw new EngineError('actions must be a list');
  const s = newState(cfg);
  for (const a of actions) applyInPlace(s, a);
  endInPlace(s, endT);
  return { state: s, report: score(s) };
}

// ---------- State ----------

function newState(cfg: GameConfig): State {
  const c = cfg?.caseFile;
  if (!c || !Array.isArray(c.actions) || !Array.isArray(c.variants)) {
    throw new EngineError('createGame needs a parsed case file');
  }
  if (!Number.isInteger(cfg.seed) || cfg.seed < 0 || cfg.seed > 0xffffffff) {
    throw new EngineError(`seed must be a whole number from 0 to 4294967295, got ${String(cfg.seed)}`);
  }
  if (cfg.mode !== 'guided' && cfg.mode !== 'realtime') throw new EngineError(`unknown mode ${String(cfg.mode)}`);
  const variant = c.variants.find((v) => v.id === cfg.variantId);
  if (!variant) throw new EngineError(`unknown variant ${String(cfg.variantId)} in case ${c.id}`);

  const flags = dict(c.initialFlags);
  for (const [k, v] of Object.entries(variant.flags ?? {})) flags[k] = v;
  const s: State = {
    caseFile: c,
    variant,
    mode: cfg.mode,
    seed: cfg.seed,
    cardOrder: shuffle(
      c.actions.map((a) => a.id),
      cfg.seed,
    ),
    phaseId: c.startPhaseId,
    casualty: c.startCasualty,
    flags,
    counters: dict<number>(),
    elapsedMs: 0,
    ended: false,
    outcome: undefined,
    endedAtMs: undefined,
    taken: [],
    firstTakenAt: dict<number>(),
    firedAt: dict<number>(),
    droppedAt: dict<number>(),
    transcript: [],
    revealedFactIds: [],
  };
  for (const lineId of c.openingLineIds ?? []) {
    const id = swapLine(s, lineId);
    const line = c.lines.find((l) => l.id === id);
    if (!line) throw new EngineError(`opening line ${id} is not in case ${c.id}`);
    s.transcript.push({ t: 0, characterId: line.characterId, lineId: id });
  }
  advance(s, 0);
  return s;
}

function clone(s: GameState): State {
  return {
    caseFile: s.caseFile,
    variant: s.variant,
    mode: s.mode,
    seed: s.seed,
    cardOrder: s.cardOrder,
    phaseId: s.phaseId,
    casualty: s.casualty,
    flags: dict(s.flags),
    counters: dict(s.counters),
    elapsedMs: s.elapsedMs,
    ended: s.ended,
    outcome: s.outcome,
    endedAtMs: s.endedAtMs,
    taken: s.taken.slice(),
    firstTakenAt: dict(s.firstTakenAt),
    firedAt: dict(s.firedAt),
    droppedAt: dict(s.droppedAt),
    transcript: s.transcript.slice(),
    revealedFactIds: s.revealedFactIds.slice(),
  };
}

// Null-prototype maps, so ids such as "constructor" behave like any other key.
function dict<T>(src?: Readonly<Record<string, T>>): Dict<T> {
  const d: Dict<T> = Object.create(null);
  if (src) for (const k of Object.keys(src)) d[k] = src[k] as T;
  return d;
}

function flagOf(s: GameState, flag: string): boolean {
  return Object.hasOwn(s.flags, flag) ? s.flags[flag] === true : false;
}

function counterOf(s: GameState, counter: string): number {
  return Object.hasOwn(s.counters, counter) ? (s.counters[counter] as number) : 0;
}

// Every counter an action or event of the case adds to, in file order.
function counterNames(c: CaseFile): string[] {
  const out: string[] = [];
  const add = (effects: readonly Effect[] | undefined) => {
    for (const e of effects ?? []) if (e.type === 'addCounter' && !out.includes(e.counter)) out.push(e.counter);
  };
  for (const a of c.actions) add(a.effects);
  for (const ev of c.timeline ?? []) add(ev.effects);
  return out;
}

function swapLine(s: GameState, lineId: string): string {
  const swaps = s.variant.lineSwaps ?? {};
  return Object.hasOwn(swaps, lineId) ? (swaps[lineId] as string) : lineId;
}

function holds(s: GameState, cond: Condition | undefined): boolean {
  if (!cond) return true;
  if (cond.flag !== undefined && flagOf(s, cond.flag) !== (cond.equals ?? true)) return false;
  if (cond.counter !== undefined && counterOf(s, cond.counter) < (cond.atLeast ?? 1)) return false;
  if (cond.phaseId !== undefined && s.phaseId !== cond.phaseId) return false;
  return true;
}

function isCard(s: GameState, a: Action): boolean {
  return (
    !s.ended &&
    a.phases.includes(s.phaseId) &&
    holds(s, a.requires) &&
    (a.repeatable === true || !Object.hasOwn(s.firstTakenAt, a.id))
  );
}

function checkTime(t: unknown, what: string): asserts t is number {
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
    throw new EngineError(`${what} must be a number of ms, 0 or more, got ${String(t)}`);
  }
}

function checkPayload(p: PlayerAction['payload'], actionId: string): { bpm: number; count: number } {
  const bpm = p?.bpm;
  const count = p?.count;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0 || bpm > MAX_BPM) {
    throw new EngineError(`${actionId} needs a payload bpm above 0 and at most ${MAX_BPM}, got ${String(bpm)}`);
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new EngineError(`${actionId} needs a payload count from 1 to ${MAX_COUNT}, got ${String(count)}`);
  }
  return { bpm, count };
}

// ---------- Moving the game on ----------

function applyInPlace(s: State, action: PlayerAction): void {
  if (action === null || typeof action !== 'object' || typeof action.actionId !== 'string') {
    throw new EngineError('an action needs an actionId');
  }
  const { actionId, t } = action;
  checkTime(t, `time of ${actionId}`);
  if (s.ended) throw new EngineError(`the game has ended, so ${actionId} at ${t} ms is not allowed`);
  if (t < s.elapsedMs) throw new EngineError(`time goes backwards: ${actionId} at ${t} ms is before ${s.elapsedMs} ms`);
  if (t > s.caseFile.maxDurationMs) {
    throw new EngineError(`${actionId} at ${t} ms is after the game limit of ${s.caseFile.maxDurationMs} ms`);
  }
  advance(s, t);
  if (s.ended) throw new EngineError(`the game ended at ${String(s.endedAtMs)} ms, before ${actionId} at ${t} ms`);
  const a = s.caseFile.actions.find((x) => x.id === actionId);
  if (!a) throw new EngineError(`unknown action ${actionId}`);
  if (!isCard(s, a)) throw new EngineError(`${actionId} is not a card at ${t} ms (phase ${s.phaseId})`);

  let taps = 1;
  if (a.kind === 'rhythm') {
    const payload = checkPayload(action.payload, actionId);
    taps = payload.count;
    s.taken.push({ actionId, t, payload });
  } else {
    s.taken.push({ actionId, t });
  }
  if (!Object.hasOwn(s.firstTakenAt, actionId)) s.firstTakenAt[actionId] = t;
  applyEffects(s, a.effects, t, taps);
  advance(s, t); // events this action made due at once
}

function endInPlace(s: State, t: number): void {
  checkTime(t, 'end time');
  if (s.ended) return;
  if (t < s.elapsedMs) throw new EngineError(`time goes backwards: end at ${t} ms is before ${s.elapsedMs} ms`);
  advance(s, t);
  if (!s.ended) finish(s, t, 'stopped');
}

// Fires every due event up to t (never past maxDurationMs), then moves the clock to t.
function advance(s: State, t: number): void {
  const max = s.caseFile.maxDurationMs;
  const limit = Math.min(t, max);
  while (!s.ended) {
    const next = nextDue(s, limit);
    if (!next) break;
    if (next.due > s.elapsedMs) s.elapsedMs = next.due;
    if (holds(s, next.ev.when)) {
      s.firedAt[next.ev.id] = next.due;
      applyEffects(s, next.ev.effects, next.due, 1);
    } else {
      s.droppedAt[next.ev.id] = next.due;
    }
  }
  if (s.ended) return;
  if (t >= max) finish(s, max, 'timeout');
  else if (t > s.elapsedMs) s.elapsedMs = t;
}

function dueTime(s: GameState, ev: TimelineEvent): number | undefined {
  const overrides = s.variant.timelineAtMs ?? {};
  const atMs = Object.hasOwn(overrides, ev.id) ? overrides[ev.id] : ev.atMs;
  if (atMs !== undefined) return Math.max(0, atMs);
  if (ev.afterActionId !== undefined && Object.hasOwn(s.firstTakenAt, ev.afterActionId)) {
    return (s.firstTakenAt[ev.afterActionId] as number) + (ev.delayMs ?? 0);
  }
  return undefined;
}

// The pending event with the earliest due time at or before limit; ties go to file order.
function nextDue(s: GameState, limit: number): { ev: TimelineEvent; due: number } | undefined {
  let best: { ev: TimelineEvent; due: number } | undefined;
  for (const ev of s.caseFile.timeline ?? []) {
    if (Object.hasOwn(s.firedAt, ev.id) || Object.hasOwn(s.droppedAt, ev.id)) continue;
    const due = dueTime(s, ev);
    if (due === undefined || due > limit) continue;
    if (best === undefined || due < best.due) best = { ev, due };
  }
  return best;
}

function applyEffects(s: State, effects: readonly Effect[] | undefined, t: number, taps: number): void {
  for (const e of effects ?? []) {
    switch (e.type) {
      case 'setFlag':
        s.flags[e.flag] = e.value;
        break;
      case 'addCounter':
        s.counters[e.counter] = counterOf(s, e.counter) + e.delta * taps;
        break;
      case 'gotoPhase':
        s.phaseId = e.phaseId;
        break;
      case 'revealFact':
        if (!s.revealedFactIds.includes(e.factId)) s.revealedFactIds.push(e.factId);
        break;
      case 'say':
        s.transcript.push({ t, characterId: e.characterId, lineId: swapLine(s, e.lineId) });
        break;
      case 'setCasualty':
        s.casualty = e.status;
        break;
      case 'endGame':
        if (!s.ended) finish(s, t, e.outcome);
        break;
      default:
        throw new EngineError(`unknown effect type ${String((e as { type?: unknown }).type)}`);
    }
  }
}

function finish(s: State, t: number, outcome: string): void {
  s.ended = true;
  s.outcome = outcome;
  s.endedAtMs = t;
  s.elapsedMs = t;
}

// ---------- Scoring ----------

function firstIndex(s: GameState, actionId: string): number {
  return s.taken.findIndex((x) => x.actionId === actionId);
}

function checkStatus(s: GameState, k: RubricCheck): 'done' | 'late' | 'missed' {
  switch (k.kind) {
    case 'did':
      return Object.hasOwn(s.firstTakenAt, k.actionId) ? 'done' : 'missed';
    case 'didBefore': {
      const a = firstIndex(s, k.actionId);
      if (a < 0) return 'missed';
      const b = firstIndex(s, k.beforeActionId);
      return b < 0 || a < b ? 'done' : 'missed';
    }
    case 'didWithin': {
      let start = 0;
      if (k.fromEventId !== undefined) {
        if (!Object.hasOwn(s.firedAt, k.fromEventId)) return 'missed';
        start = s.firedAt[k.fromEventId] as number;
      }
      if (!Object.hasOwn(s.firstTakenAt, k.actionId)) return 'missed';
      return (s.firstTakenAt[k.actionId] as number) <= start + k.withinMs ? 'done' : 'late';
    }
    case 'countAtLeast':
      return counterOf(s, k.counter) >= k.min ? 'done' : 'missed';
    case 'rateInRange': {
      const sets = s.taken.filter((x) => x.actionId === k.actionId && x.payload !== undefined);
      if (sets.length === 0) return 'missed';
      const inRange = sets.filter((x) => {
        const bpm = (x.payload as { bpm: number }).bpm;
        return bpm >= k.minBpm && bpm <= k.maxBpm;
      }).length;
      return inRange + 1e-9 >= k.minShare * sets.length ? 'done' : 'missed';
    }
    default:
      throw new EngineError(`unknown rubric check ${String((k as { kind?: unknown }).kind)}`);
  }
}

function timePointsFor(time: { maxPoints: number; targetMs: number; zeroAtMs: number }, durationMs: number): number {
  if (time.maxPoints <= 0) return 0;
  if (durationMs <= time.targetMs) return time.maxPoints;
  if (durationMs >= time.zeroAtMs) return 0;
  return Math.floor((time.maxPoints * (time.zeroAtMs - durationMs)) / (time.zeroAtMs - time.targetMs));
}
