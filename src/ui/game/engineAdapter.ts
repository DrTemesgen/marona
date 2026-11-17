// The phone plays every chapter with the real engine (src/engine/engine.ts), the same code the
// server replays. The tiny fake engine is used only when no case file is bundled at all (it then
// plays the built-in fake case).
import type { GameConfig, GameView, PlayerAction, ScoreReport } from '../../shared/contract';
import { cases } from '../../content/loadVite';
import * as realEngine from '../../engine/engine';
import * as fakeEngine from './fakeEngine';

// Opaque here: only the engine looks inside a game state.
declare const opaque: unique symbol;
export type GameState = { readonly [opaque]: true };

interface Engine {
  createGame(cfg: GameConfig): GameState;
  applyAction(state: GameState, action: PlayerAction): GameState;
  advanceTo(state: GameState, t: number): GameState;
  endGame(state: GameState, t: number): GameState;
  view(state: GameState): GameView;
  score(state: GameState): ScoreReport;
}

export const usingRealEngine = cases.length > 0;

const engine = (usingRealEngine ? realEngine : fakeEngine) as unknown as Engine;

export const createGame = (cfg: GameConfig): GameState => engine.createGame(cfg);
export const applyAction = (state: GameState, action: PlayerAction): GameState => engine.applyAction(state, action);
export const advanceTo = (state: GameState, t: number): GameState => engine.advanceTo(state, t);
export const endGame = (state: GameState, t: number): GameState => engine.endGame(state, t);
export const view = (state: GameState): GameView => engine.view(state);
export const score = (state: GameState): ScoreReport => engine.score(state);
