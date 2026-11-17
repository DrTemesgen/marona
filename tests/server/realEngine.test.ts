// Replays real ch2 runs through the real engine (src/engine/engine.ts) inside the server.
// A simple bot plays through the engine's own view, so the log is one a player could make.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, createGame, replay, view } from '../../src/engine/engine';
import { CONTENT_DIR } from '../../src/content/loadNode';
import type { CaseFile, GameConfig, PlayerAction } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';
import { MINUTE, NICKS, T0, setup } from './helpers';

const CH2 = 'ch2-cpr-school-gate';

function loadCh2(): CaseFile {
  const check = validateCase(JSON.parse(readFileSync(join(CONTENT_DIR, `${CH2}.json`), 'utf8')));
  if (!check.ok) throw new Error(check.errors.join('\n'));
  return check.caseFile;
}

// Takes each new card once, in the order the engine shows them, and does CPR when nothing is new.
function botRun(cfg: GameConfig): { actions: PlayerAction[]; endT: number } {
  let state = createGame(cfg);
  const actions: PlayerAction[] = [];
  const taken = new Set<string>();
  let t = 0;
  while (t + 3000 <= cfg.caseFile.maxDurationMs) {
    t += 3000;
    state = advanceTo(state, t);
    const v = view(state);
    if (v.ended) break;
    const card = v.cards.find((c) => c.kind !== 'rhythm' && !taken.has(c.id)) ?? v.cards.find((c) => c.kind === 'rhythm');
    if (!card) continue;
    const a: PlayerAction =
      card.kind === 'rhythm' ? { actionId: card.id, t, payload: { bpm: 110, count: 5 } } : { actionId: card.id, t };
    state = applyAction(state, a);
    actions.push(a);
    taken.add(card.id);
  }
  return { actions, endT: t };
}

describe('real engine: a ch2 run replayed by the server', () => {
  it('practice: the server score equals the engine score; a forged client score is only flagged', async () => {
    const ch2 = loadCh2();
    const variantId = ch2.variants.find((v) => !v.finalOnly)!.id;
    const cfg: GameConfig = { caseFile: ch2, seed: 424242, mode: 'realtime', variantId };
    const { actions, endT } = botRun(cfg);
    expect(actions.length).toBeGreaterThan(5);
    const expected = replay(cfg, actions, endT).report.total;

    const s = setup({ cases: [ch2], replay });
    const { token } = await s.join(NICKS[0]);
    const body = { caseId: CH2, mode: 'realtime', seed: 424242, variantId, actions, endT, clientScore: expected };
    expect((await s.call('POST', '/api/runs', { token, body })).json).toEqual({ serverScore: expected, accepted: true });
    const forged = await s.call('POST', '/api/runs', { token, body: { ...body, clientScore: expected === 100 ? 0 : 100 } });
    expect(forged.json).toEqual({ serverScore: expected, accepted: true });
    expect(s.db.prepare('SELECT server_score, score_mismatch FROM runs ORDER BY id').all()).toEqual([
      { server_score: expected, score_mismatch: 0 },
      { server_score: expected, score_mismatch: 1 },
    ]);

    // A card the engine does not offer at that moment: the real engine throws, the server refuses.
    const bad = { ...body, actions: [{ actionId: 'swap_rescuer', t: 1000 }] };
    expect((await s.call('POST', '/api/runs', { token, body: bad })).json).toEqual({
      serverScore: 0,
      accepted: false,
      reason: 'invalid game log',
    });
  });

  it('final: played with the server seed and the finalOnly variant, ranked after the window', async () => {
    const ch2 = loadCh2();
    const finalVariant = ch2.variants.find((v) => v.finalOnly);
    expect(finalVariant).toBeDefined();
    const s = setup({ cases: [ch2], replay, randomSeed: () => 987654321 });
    s.db
      .prepare('INSERT INTO finals (id, name, opens_at, closes_at, case_ids_json, variant_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(1, 'Practice final', T0, T0 + 60 * MINUTE, JSON.stringify([CH2]), finalVariant!.id);
    const { token } = await s.join(NICKS[0]);
    const start = await s.call('POST', '/api/final/start', { token, body: { finalId: 1, caseId: CH2 } });
    expect(start.json).toEqual({ seed: 987654321, variantId: finalVariant!.id, variant: finalVariant, serverStartMs: T0, elapsedMs: 0 });

    const cfg: GameConfig = { caseFile: ch2, seed: 987654321, mode: 'realtime', variantId: finalVariant!.id };
    const { actions, endT } = botRun(cfg);
    const expected = replay(cfg, actions, endT).report.total;
    s.clock.advance(endT + 2000);
    const sub = await s.call('POST', '/api/final/submit', { token, body: { finalId: 1, caseId: CH2, actions, endT } });
    expect(sub.json).toEqual({ received: true });

    s.clock.set(T0 + 60 * MINUTE);
    const results = await s.call('GET', '/api/final/results?finalId=1');
    expect(results.json.city).toEqual([{ rank: 1, nickname: NICKS[0], score: expected, durationMs: endT + 2000 }]);
  });
});
