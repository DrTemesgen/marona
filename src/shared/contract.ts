// Shared contract for the first aid game prototype (17 Nov 2026).
// Every module builds against this file. Change it only in the integration step, and only to
// fix a real defect; say so in the report.
// Integration step 1 (17 Nov 2026): RubricItem.appliesWhen and item status 'na' (scaled total),
// time points only when every applicable critical item is done or late, Fact.ref,
// GameView.counters, Variant.time, and /api/final/start returns the full variant.
// Review fixes (17 Nov 2026): Line.correctionHarmId; /api/final/start returns elapsedMs; a final
// submit scores 0 only when endT is longer than the server time (see the final routes below).
import { z } from 'zod';

// ---------- Case file (one per chapter, JSON in src/content/) ----------

export const Mode = z.enum(['guided', 'realtime']);
export type Mode = z.infer<typeof Mode>;

export const SourceRef = z.object({
  id: z.string(), // for example "ifrc2025"
  title: z.string(),
  url: z.string().url(),
});

// Where a clinical line or rubric item comes from.
export const Ref = z.object({
  sourceId: z.string(),
  page: z.string(), // "240", or "to confirm"
  review: z.enum(['pending', 'reviewed']),
});
export type Ref = z.infer<typeof Ref>;

export const Effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setFlag'), flag: z.string(), value: z.boolean() }),
  // A rhythm action adds delta x payload.count (once per tap); any other action or event adds delta.
  z.object({ type: z.literal('addCounter'), counter: z.string(), delta: z.number().int() }),
  z.object({ type: z.literal('gotoPhase'), phaseId: z.string() }),
  z.object({ type: z.literal('revealFact'), factId: z.string() }),
  z.object({ type: z.literal('say'), characterId: z.string(), lineId: z.string() }),
  // Art state of the casualty, for example "chest_pain", "collapsed", "cpr", "recovered",
  // "lying_awake" (on the back, eyes open, a jacket over him), "handover".
  z.object({ type: z.literal('setCasualty'), status: z.string() }),
  z.object({ type: z.literal('endGame'), outcome: z.string() }),
]);
export type Effect = z.infer<typeof Effect>;

// All given fields must hold. A flag with no "equals" means it must be true (a flag never set is
// false). A counter with no "atLeast" means at least 1 (a counter never added to is 0).
export const Condition = z
  .object({
    flag: z.string().optional(),
    equals: z.boolean().optional(),
    counter: z.string().optional(),
    atLeast: z.number().int().optional(),
    phaseId: z.string().optional(),
  })
  .strict();
export type Condition = z.infer<typeof Condition>;

export const CardKind = z.enum(['action', 'question', 'call', 'rhythm']);
export type CardKind = z.infer<typeof CardKind>;

export const Action = z.object({
  id: z.string(),
  label: z.string(), // card text, plain words
  // "rhythm" opens the tap-rhythm game; each rhythm action's payload carries bpm and count.
  // A rhythm action's t is the time the set is handed in; the UI hands in a set every 10 taps
  // (and the rest when the player stops). Its addCounter effects add delta x payload.count; its
  // other effects apply once per set.
  kind: CardKind,
  targetCharacterId: z.string().optional(),
  phases: z.array(z.string()).min(1), // phases in which the card is shown
  repeatable: z.boolean().default(false),
  requires: Condition.optional(), // card shown only while this holds
  effects: z.array(Effect).default([]),
  hint: z.string().optional(), // shown in Guided mode only
});
export type Action = z.infer<typeof Action>;

export const TimelineEvent = z.object({
  id: z.string(),
  atMs: z.number().int().nonnegative().optional(), // fires at this game time...
  afterActionId: z.string().optional(), // ...or delayMs after this action is first taken
  delayMs: z.number().int().nonnegative().optional(),
  when: Condition.optional(), // and only if this holds at that moment
  effects: z.array(Effect).min(1),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Emotion = z.enum(['calm', 'worried', 'panicked', 'pain', 'neutral']);
export type Emotion = z.infer<typeof Emotion>;

export const Line = z.object({
  id: z.string(),
  characterId: z.string(),
  text: z.string(),
  emotion: Emotion.default('neutral'),
  // The bystander's planned wrong advice. The reply filter lets it pass by id only.
  wrongAdvice: z.boolean().default(false),
  // For a wrongAdvice line: the harm whose teachingPoint the debrief shows as the correction.
  correctionHarmId: z.string().optional(),
  ref: Ref.optional(), // required when the line carries a clinical instruction
});
export type Line = z.infer<typeof Line>;

export const RubricCheck = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('did'), actionId: z.string() }),
  z.object({ kind: z.literal('didBefore'), actionId: z.string(), beforeActionId: z.string() }),
  // Within withinMs of game start, or of a timeline event when fromEventId is given.
  z.object({
    kind: z.literal('didWithin'),
    actionId: z.string(),
    withinMs: z.number().int().positive(),
    fromEventId: z.string().optional(),
  }),
  z.object({ kind: z.literal('countAtLeast'), counter: z.string(), min: z.number().int().positive() }),
  // Share of this action's rhythm payloads whose bpm lies in range.
  z.object({
    kind: z.literal('rateInRange'),
    actionId: z.string(),
    minBpm: z.number(),
    maxBpm: z.number(),
    minShare: z.number().min(0).max(1),
  }),
]);
export type RubricCheck = z.infer<typeof RubricCheck>;

export const RubricItem = z.object({
  id: z.string(),
  description: z.string(),
  check: RubricCheck,
  points: z.number().int().positive(),
  // "late" (half points, rounded down) applies only to didWithin items done after the window.
  // Time points are given only when every applicable critical item is done or late.
  critical: z.boolean(),
  teachingPoint: z.string(),
  ref: Ref,
  // Evaluated on the final state. An item whose condition fails gets status 'na' and is left
  // out: the item part of the total is scaled over the applicable points (see ScoreReport).
  appliesWhen: Condition.optional(),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const Harm = z.object({
  id: z.string(),
  description: z.string(),
  actionId: z.string(),
  deduction: z.number().int().positive(),
  teachingPoint: z.string(),
  ref: Ref,
});
export type Harm = z.infer<typeof Harm>;

export const Variant = z.object({
  id: z.string(),
  label: z.string(),
  finalOnly: z.boolean().default(false), // never shown in practice
  flags: z.record(z.string(), z.boolean()).default({}), // initial flags, for example { aedArrives: false }
  timelineAtMs: z.record(z.string(), z.number().int()).default({}), // override atMs by event id
  lineSwaps: z.record(z.string(), z.string()).default({}), // lineId -> replacement lineId
  // Used instead of rubric.time.targetMs and zeroAtMs for this variant (maxPoints stays).
  time: z
    .object({ targetMs: z.number().int().positive(), zeroAtMs: z.number().int().positive() })
    .strict()
    .optional(),
});
export type Variant = z.infer<typeof Variant>;

export const Character = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['casualty', 'bystander', 'calltaker', 'adult', 'friend']),
  description: z.string(),
});

export const CaseFile = z.object({
  id: z.string(), // for example "ch2-cpr-school-gate"
  chapter: z.number().int().min(1).max(6),
  title: z.string(),
  shortTitle: z.string(),
  version: z.string(),
  scene: z.string(), // art scene id, for example "school-gate"
  intro: z.string(),
  sources: z.array(SourceRef).min(1),
  characters: z.array(Character).min(1),
  facts: z.array(z.object({ id: z.string(), text: z.string(), ref: Ref.optional() })), // ref: when the fact teaches first aid
  phases: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
  startPhaseId: z.string(),
  startCasualty: z.string(),
  initialFlags: z.record(z.string(), z.boolean()).default({}),
  actions: z.array(Action).min(1),
  timeline: z.array(TimelineEvent).default([]),
  lines: z.array(Line),
  openingLineIds: z.array(z.string()).default([]),
  rubric: z.object({
    items: z.array(RubricItem).min(1),
    harms: z.array(Harm).default([]),
    time: z.object({
      maxPoints: z.number().int().nonnegative(),
      targetMs: z.number().int().positive(), // full time points at or under this duration
      zeroAtMs: z.number().int().positive(), // no time points at or over this duration
    }),
  }),
  maxDurationMs: z.number().int().positive(), // the game ends here if nothing ended it earlier
  variants: z.array(Variant).min(1),
  disclaimer: z.string(),
});
export type CaseFile = z.infer<typeof CaseFile>;
// Rule (checked by tests): sum(rubric.items.points) + rubric.time.maxPoints === 100, and every id
// a case refers to (actions, lines, characters, phases, facts, events, counters, flags, sources)
// exists, and rubric.time and every Variant.time have targetMs < zeroAtMs.

// ---------- Engine (src/engine/engine.ts: pure, deterministic) ----------

export interface PlayerAction {
  actionId: string;
  t: number; // ms since game start; non-decreasing
  payload?: { bpm?: number; count?: number };
}

export interface GameConfig {
  caseFile: CaseFile;
  seed: number; // 32-bit unsigned integer
  mode: Mode;
  variantId: string;
}

export interface TranscriptEntry {
  t: number;
  characterId: string;
  lineId: string; // text comes from the character layer
}

export interface GameCard {
  id: string;
  label: string;
  kind: CardKind;
  targetCharacterId?: string;
  hint?: string; // Guided mode only
}

export interface GameView {
  caseId: string;
  phaseId: string;
  casualty: string;
  elapsedMs: number;
  ended: boolean;
  outcome?: string;
  cards: GameCard[]; // order shuffled by the seed, stable within a game
  transcript: TranscriptEntry[];
  revealedFactIds: string[];
  // Every counter the case adds to, 0 until added to, for example { cooling_minutes: 7 }.
  counters: Record<string, number>;
}

// total = floor(earnedApplicable * (100 - time.maxPoints) / pointsApplicable) + timePoints
//         - deductions, clamped to 0-100. Items with status 'na' are left out of both sums; when
//         no item applies, the item part counts as full marks.
// timePoints = time.maxPoints at or under targetMs, 0 at or over zeroAtMs, linear between and
//         rounded down (Variant.time overrides targetMs and zeroAtMs), and 0 unless every
//         applicable critical item is done or late.
export interface ScoreReport {
  caseId: string;
  total: number; // 0-100, never negative
  items: {
    id: string;
    description: string;
    status: 'done' | 'late' | 'missed' | 'na'; // 'na': appliesWhen failed; points still shown, earned 0
    points: number;
    earned: number;
    critical: boolean;
    teachingPoint: string;
    ref: Ref;
  }[];
  harms: { id: string; description: string; deduction: number; teachingPoint: string; ref: Ref }[];
  timePoints: number;
  durationMs: number;
}

// src/engine/engine.ts must export exactly these functions (GameState is opaque elsewhere):
//   createGame(cfg: GameConfig): GameState
//   applyAction(state: GameState, action: PlayerAction): GameState  // throws EngineError if invalid
//   advanceTo(state: GameState, t: number): GameState               // fires timeline events up to t
//   endGame(state: GameState, t: number): GameState
//   view(state: GameState): GameView
//   score(state: GameState): ScoreReport
//   replay(cfg: GameConfig, actions: PlayerAction[], endT: number): { state: GameState; report: ScoreReport }
// Same inputs give the same output. No Date, no Math.random and no I/O inside src/engine.

// ---------- Characters (src/characters/) ----------

export interface CharacterTrigger {
  characterId: string;
  lineId: string;
  t: number;
}

export interface CharacterReply {
  characterId: string;
  lineId: string;
  text: string;
  emotion: Emotion;
}

export interface CharacterProvider {
  name: 'scripted' | 'standin' | 'claude';
  reply(caseFile: CaseFile, trigger: CharacterTrigger): Promise<CharacterReply>;
}

export type FilterResult = { ok: true } | { ok: false; reason: string };
// src/characters/filter.ts exports filterReply(reply: CharacterReply, caseFile: CaseFile): FilterResult.
// The UI shows a reply only when filterReply says ok; otherwise it shows the scripted line for
// the same lineId.

// ---------- Server API (JSON over HTTP on 127.0.0.1:8787, prefix /api) ----------

export interface BoardEntry {
  rank: number;
  nickname: string;
  score: number;
  durationMs: number;
}

// GET    /api/health -> { ok: true }
// GET    /api/nicknames -> { options: string[] }   six word-pair nicknames, for example "Brave Falcon 27"
// POST   /api/join { classCode, nickname } -> { token, playerId, nickname, className, schoolName }
// POST   /api/runs { caseId, mode, seed, variantId, actions, endT, clientScore }   header x-player-token
//          -> { serverScore, accepted, reason? }   practice runs; the server replays and keeps its own score
// GET    /api/boards?scope=class|school   header x-player-token -> { scope, entries: BoardEntry[] }
// GET    /api/final/current   header x-player-token
//          -> { finalId, opensAt, closesAt, open, caseIds } or { finalId: null }
// POST   /api/final/start { finalId, caseId }   header x-player-token
//          -> { seed, variantId, variant, serverStartMs, elapsedMs }   variant is the full Variant object
//          (the case's first finalOnly variant), because the phone app no longer carries finalOnly
//          variants. Asking again returns the same start with elapsedMs = now - serverStartMs (0 on the
//          first start): after a reload the app starts a fresh game at that clock time (the actions
//          before the reload are lost) and still submits as soon as the game ends.
// POST   /api/final/submit { finalId, caseId, actions, endT }   header x-player-token -> { received: true }
//          serverElapsed = now - serverStartMs. Scored 0 (still the one submission) only when
//          endT > serverElapsed + 5 s (a claimed game longer than the server saw). When
//          endT < serverElapsed - 30 s (a slow retry, a 429 wait or a reload) the replay score is
//          kept minus that report's timePoints. Ties use the server time. Submit as soon as the game ends.
// GET    /api/final/results?finalId=   -> 403 { error: 'window open' } until closesAt passes;
//          then { city: BoardEntry[], bySchool: Record<string, BoardEntry[]> }
// GET    /api/teacher/class   header x-teacher-code -> { className, players: { playerId, nickname, attempts, best }[] }
// DELETE /api/teacher/player/:playerId   header x-teacher-code -> { removed: true }
// Practice boards rank realtime runs only; guided runs are stored and count as attempts.
// Rate limits: routes with x-player-token per player (300 a minute); the rest per IP (600 a
// minute, and 60 joins a minute), because a whole school may share one IP.
// Plausibility (practice and final): at most 3000 actions; rhythm bpm a finite number 1-400 and
// count a whole number 1-60; a rhythm set at least count * 60000 / bpm * 0.5 ms after the action
// before it (x 0.25 in guided mode); 150 ms between other actions (75 ms in guided mode, whose
// clock runs at half speed).
// No real names, phone numbers or e-mail addresses are accepted or stored anywhere.
