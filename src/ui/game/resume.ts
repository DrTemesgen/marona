// Starting a game part-way through: a final resumed after a reload. The server says how long ago
// the final started (elapsedMs); the phone starts a fresh game at that clock time. The actions
// before the reload are lost, and timeline events up to that time have fired.
import type { GameConfig } from '../../shared/contract';

interface StartEngine<S> {
  createGame(cfg: GameConfig): S;
  advanceTo(state: S, t: number): S;
}

export function startGameAt<S>(engine: StartEngine<S>, cfg: GameConfig, startAtMs = 0): S {
  const state = engine.createGame(cfg);
  const t = Math.max(0, Math.round(startAtMs));
  return t > 0 ? engine.advanceTo(state, t) : state;
}

// The performance.now() value that counts as game time 0, so the clock reads startAtMs now.
export function clockOrigin(nowMs: number, startAtMs: number, scale: number): number {
  return nowMs - Math.max(0, startAtMs) / scale;
}
