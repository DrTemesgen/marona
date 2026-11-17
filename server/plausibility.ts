// Cheap checks on a game log before the server replays it. They reject logs no person could
// have produced with a phone; the replay then decides the score. A slow or fast tapper is a
// wrong rate (the rubric marks it down), not a cheat, so the rate limits here are wide.
import type { CaseFile, Mode, PlayerAction } from '../src/shared/contract';

export const MAX_LOG_ACTIONS = 3000; // per run
export const MIN_GAP_MS: Record<Mode, number> = { realtime: 150, guided: 75 }; // between two non-rhythm actions
export const MIN_BPM = 1;
export const MAX_BPM = 400;
export const MIN_COUNT = 1;
export const MAX_COUNT = 60; // the UI hands in a set every 10 taps
// A rhythm set of `count` taps at `bpm` needs count * 60000 / bpm ms of game time; at least this
// share of it must have passed since the action before. The Guided clock runs at half speed,
// so a real set takes half as much game time there.
export const RHYTHM_FIT: Record<Mode, number> = { realtime: 0.5, guided: 0.25 };

// 'invalid': the log does not fit the case at all. 'implausible': timing a person cannot produce.
export type LogCheck = { ok: true } | { ok: false; kind: 'invalid' | 'implausible'; detail: string };

export function checkLog(
  caseFile: CaseFile,
  actions: PlayerAction[],
  endT: number,
  mode: Mode = 'realtime',
): LogCheck {
  const bad = (kind: 'invalid' | 'implausible', detail: string): LogCheck => ({ ok: false, kind, detail });
  if (!Number.isFinite(endT) || endT < 0) return bad('invalid', 'endT is not a valid time');
  if (endT > caseFile.maxDurationMs) return bad('implausible', 'endT is beyond the case maxDurationMs');
  if (actions.length > MAX_LOG_ACTIONS) return bad('implausible', `more than ${MAX_LOG_ACTIONS} actions`);
  const minGap = MIN_GAP_MS[mode] ?? MIN_GAP_MS.realtime;
  const fit = RHYTHM_FIT[mode] ?? RHYTHM_FIT.realtime;

  const kinds = new Map(caseFile.actions.map((a) => [a.id, a.kind]));
  let prevT = 0; // game start counts as the action before the first one
  let lastPlainT: number | undefined;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const kind = kinds.get(a.actionId);
    if (!kind) return bad('invalid', `action ${i} is not in the case`);
    if (!Number.isFinite(a.t) || a.t < prevT) return bad('implausible', `action ${i}: time goes backwards`);
    if (a.t > endT) return bad('implausible', `action ${i}: after the end of the game`);
    if (kind === 'rhythm') {
      const bpm = a.payload?.bpm;
      const count = a.payload?.count;
      if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM)
        return bad('implausible', `action ${i}: rhythm rate out of range`);
      if (typeof count !== 'number' || !Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT)
        return bad('implausible', `action ${i}: rhythm tap count out of range`);
      const needMs = ((count * 60_000) / bpm) * fit;
      if (a.t - prevT < needMs) return bad('implausible', `action ${i}: rhythm set faster than the clock allows`);
    } else {
      if (lastPlainT !== undefined && a.t - lastPlainT < minGap)
        return bad('implausible', `action ${i}: less than ${minGap} ms after the previous action`);
      lastPlainT = a.t;
    }
    prevT = a.t;
  }
  return { ok: true };
}
