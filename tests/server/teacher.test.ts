import { describe, expect, it } from 'vitest';
import { MINUTE, NICKS, T0, runBody, setup } from './helpers';

async function classScenario() {
  const s = setup();
  const p1 = await s.join(NICKS[0], 'TEST-A1');
  const p2 = await s.join(NICKS[1], 'TEST-A1');
  const other = await s.join(NICKS[2], 'TEST-B1');
  for (const score of [40, 70]) {
    s.replay.scores.push(score);
    await s.call('POST', '/api/runs', { token: p1.token, body: runBody() });
  }
  // One final run for p1 (counts as an attempt, not as a practice best).
  s.db
    .prepare('INSERT INTO finals (id, name, opens_at, closes_at, case_ids_json, variant_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 'City final', T0, T0 + 60 * MINUTE, JSON.stringify(['test-case']), 'final-x');
  await s.call('POST', '/api/final/start', { token: p1.token, body: { finalId: 1, caseId: 'test-case' } });
  s.replay.scores.push(95);
  const sub = await s.call('POST', '/api/final/submit', {
    token: p1.token,
    body: { finalId: 1, caseId: 'test-case', actions: [{ actionId: 'call', t: 1000 }], endT: 30_000 },
  });
  expect(sub.json).toEqual({ received: true });
  return { ...s, p1, p2, other };
}

describe('teacher view', () => {
  it('lists the class players with attempts (practice + final) and best practice score', async () => {
    const { call, p1, p2 } = await classScenario();
    const r = await call('GET', '/api/teacher/class', { teacher: 'TEACH-A1' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      className: 'Class A1',
      players: [
        { playerId: p1.playerId, nickname: NICKS[0], attempts: 3, best: 70 },
        { playerId: p2.playerId, nickname: NICKS[1], attempts: 0, best: null },
      ],
    });
  });

  it('needs a known teacher code', async () => {
    const { call } = await classScenario();
    expect((await call('GET', '/api/teacher/class')).status).toBe(401);
    expect((await call('GET', '/api/teacher/class', { teacher: 'TEACH-Z9' })).status).toBe(401);
    // A class code is not a teacher code.
    expect((await call('GET', '/api/teacher/class', { teacher: 'TEST-A1' })).status).toBe(401);
  });

  it('DELETE marks the player removed: gone from the list and the boards, token refused', async () => {
    const { call, p1, p2 } = await classScenario();
    const r = await call('DELETE', `/api/teacher/player/${p1.playerId}`, { teacher: 'TEACH-A1' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ removed: true });
    const list = await call('GET', '/api/teacher/class', { teacher: 'TEACH-A1' });
    expect(list.json.players.map((p: { nickname: string }) => p.nickname)).toEqual([NICKS[1]]);
    const board = await call('GET', '/api/boards?scope=class', { token: p2.token });
    expect(board.json.entries).toEqual([]);
    expect((await call('GET', '/api/boards?scope=class', { token: p1.token })).status).toBe(401);
    // Removing twice finds nothing to remove.
    expect((await call('DELETE', `/api/teacher/player/${p1.playerId}`, { teacher: 'TEACH-A1' })).status).toBe(404);
  });

  it('cannot remove a player of another class', async () => {
    const { call, other, db } = await classScenario();
    const r = await call('DELETE', `/api/teacher/player/${other.playerId}`, { teacher: 'TEACH-A1' });
    expect(r.status).toBe(404);
    expect(db.prepare('SELECT removed FROM players WHERE id = ?').get(other.playerId)).toEqual({ removed: 0 });
  });

  it('refuses a player id that is not a number', async () => {
    const { call } = await classScenario();
    expect((await call('DELETE', '/api/teacher/player/abc', { teacher: 'TEACH-A1' })).status).toBe(400);
    expect((await call('DELETE', '/api/teacher/player/1;DROP', { teacher: 'TEACH-A1' })).status).toBe(400);
  });
});
