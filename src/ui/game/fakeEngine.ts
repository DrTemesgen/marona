// A tiny stand-in engine with the same signatures as src/engine/engine.ts.
import type {
  Condition, Effect, GameCard, GameConfig, GameView, PlayerAction, ScoreReport, TranscriptEntry,
} from '../../shared/contract';

interface Taken { actionId: string; t: number; payload?: { bpm?: number; count?: number } }

export interface GameState {
  cfg: GameConfig;
  t: number;
  taken: Taken[];
  transcript: TranscriptEntry[];
  phaseId: string;
  casualty: string;
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  fired: string[];
  ended: boolean;
  outcome?: string;
  endT: number;
}

function holds(c: Condition | undefined, s: GameState): boolean {
  if (!c) return true;
  if (c.flag !== undefined && (s.flags[c.flag] ?? false) !== (c.equals ?? true)) return false;
  if (c.counter !== undefined && (s.counters[c.counter] ?? 0) < (c.atLeast ?? 0)) return false;
  if (c.phaseId !== undefined && s.phaseId !== c.phaseId) return false;
  return true;
}

function applyEffects(s: GameState, effects: Effect[], t: number): GameState {
  const n: GameState = { ...s, flags: { ...s.flags }, counters: { ...s.counters }, transcript: [...s.transcript] };
  for (const e of effects) {
    if (e.type === 'setFlag') n.flags[e.flag] = e.value;
    else if (e.type === 'addCounter') n.counters[e.counter] = (n.counters[e.counter] ?? 0) + e.delta;
    else if (e.type === 'gotoPhase') n.phaseId = e.phaseId;
    else if (e.type === 'say') n.transcript.push({ t, characterId: e.characterId, lineId: e.lineId });
    else if (e.type === 'setCasualty') n.casualty = e.status;
    else if (e.type === 'endGame') { n.ended = true; n.outcome = e.outcome; n.endT = t; }
  }
  return n;
}

export function createGame(cfg: GameConfig): GameState {
  const c = cfg.caseFile;
  let s: GameState = {
    cfg, t: 0, taken: [], transcript: [], phaseId: c.startPhaseId, casualty: c.startCasualty,
    flags: { ...c.initialFlags }, counters: {}, fired: [], ended: false, endT: 0,
  };
  for (const id of c.openingLineIds) {
    const line = c.lines.find((l) => l.id === id);
    if (line) s = applyEffects(s, [{ type: 'say', characterId: line.characterId, lineId: id }], 0);
  }
  return s;
}

export function advanceTo(state: GameState, t: number): GameState {
  if (state.ended) return state;
  let s: GameState = { ...state, t: Math.max(state.t, t) };
  for (const ev of s.cfg.caseFile.timeline) {
    if (s.fired.includes(ev.id)) continue;
    let at: number | undefined;
    if (ev.atMs !== undefined) {
      at = s.cfg.caseFile.variants.find((v) => v.id === s.cfg.variantId)?.timelineAtMs[ev.id] ?? ev.atMs;
    } else if (ev.afterActionId) {
      const first = s.taken.find((a) => a.actionId === ev.afterActionId);
      if (first) at = first.t + (ev.delayMs ?? 0);
    }
    if (at !== undefined && at <= t && holds(ev.when, s)) {
      s = applyEffects({ ...s, fired: [...s.fired, ev.id] }, ev.effects, at);
    }
  }
  if (!s.ended && t >= s.cfg.caseFile.maxDurationMs) s = { ...s, ended: true, outcome: 'timeout', endT: t };
  return s;
}

export function applyAction(state: GameState, action: PlayerAction): GameState {
  if (state.ended) throw new Error('The game has ended');
  const act = state.cfg.caseFile.actions.find((a) => a.id === action.actionId);
  if (!act) throw new Error(`Unknown action ${action.actionId}`);
  let s = advanceTo(state, action.t);
  if (s.ended) throw new Error('The game has ended');
  if (!act.phases.includes(s.phaseId) || !holds(act.requires, s)) throw new Error('Action not available');
  if (!act.repeatable && s.taken.some((a) => a.actionId === act.id)) throw new Error('Already done');
  s = { ...s, taken: [...s.taken, { actionId: act.id, t: action.t, payload: action.payload }] };
  s = applyEffects(s, act.effects, action.t);
  return advanceTo(s, action.t);
}

export function endGame(state: GameState, t: number): GameState {
  if (state.ended) return state;
  const s = advanceTo(state, t);
  return s.ended ? s : { ...s, ended: true, outcome: 'stopped', endT: t };
}

function shuffled<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let x = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function view(s: GameState): GameView {
  const c = s.cfg.caseFile;
  const cards: GameCard[] = c.actions
    .filter((a) => a.phases.includes(s.phaseId) && holds(a.requires, s) && (a.repeatable || !s.taken.some((t) => t.actionId === a.id)))
    .map((a) => ({
      id: a.id, label: a.label, kind: a.kind, targetCharacterId: a.targetCharacterId,
      hint: s.cfg.mode === 'guided' ? a.hint : undefined,
    }));
  return {
    caseId: c.id, phaseId: s.phaseId, casualty: s.casualty, elapsedMs: s.t, ended: s.ended,
    outcome: s.outcome, cards: shuffled(cards, s.cfg.seed), transcript: s.transcript, revealedFactIds: [],
    counters: { ...s.counters },
  };
}

export function score(s: GameState): ScoreReport {
  const r = s.cfg.caseFile.rubric;
  const dur = s.ended ? s.endT : s.t;
  const first = (id: string) => s.taken.find((a) => a.actionId === id);
  const items: ScoreReport['items'] = r.items.map((it) => {
    const ck = it.check;
    let status: 'done' | 'late' | 'missed' = 'missed';
    if (ck.kind === 'did') {
      status = first(ck.actionId) ? 'done' : 'missed';
    } else if (ck.kind === 'didBefore') {
      const a = first(ck.actionId);
      const b = first(ck.beforeActionId);
      status = a && (!b || a.t <= b.t) ? 'done' : 'missed';
    } else if (ck.kind === 'didWithin') {
      const a = first(ck.actionId);
      status = !a ? 'missed' : a.t <= ck.withinMs ? 'done' : 'late';
    } else if (ck.kind === 'countAtLeast') {
      status = (s.counters[ck.counter] ?? 0) >= ck.min ? 'done' : 'missed';
    } else {
      const taps = s.taken.filter((a) => a.actionId === ck.actionId && a.payload?.bpm !== undefined);
      const ok = taps.filter((a) => (a.payload?.bpm ?? 0) >= ck.minBpm && (a.payload?.bpm ?? 0) <= ck.maxBpm);
      status = taps.length > 0 && ok.length / taps.length >= ck.minShare ? 'done' : 'missed';
    }
    const earned = status === 'done' ? it.points : status === 'late' ? Math.floor(it.points / 2) : 0;
    return {
      id: it.id, description: it.description, status, points: it.points, earned,
      critical: it.critical, teachingPoint: it.teachingPoint, ref: it.ref,
    };
  });
  const harms = r.harms
    .filter((h) => s.taken.some((a) => a.actionId === h.actionId))
    .map((h) => ({ id: h.id, description: h.description, deduction: h.deduction, teachingPoint: h.teachingPoint, ref: h.ref }));
  const { maxPoints, targetMs, zeroAtMs } = r.time;
  const anyDone = items.some((i) => i.earned > 0);
  const timePoints = !anyDone ? 0
    : dur <= targetMs ? maxPoints
    : dur >= zeroAtMs ? 0
    : Math.round((maxPoints * (zeroAtMs - dur)) / (zeroAtMs - targetMs));
  const raw = items.reduce((a, i) => a + i.earned, 0) + timePoints - harms.reduce((a, h) => a + h.deduction, 0);
  return { caseId: s.cfg.caseFile.id, total: Math.max(0, Math.min(100, raw)), items, harms, timePoints, durationMs: dur };
}
