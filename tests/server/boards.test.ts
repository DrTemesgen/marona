import { describe, expect, it } from 'vitest';
import { NICKS, runBody, setup } from './helpers';

// Class A1: P1..P5 (P4 removed, P5 never plays). Class A2 (same school): P6. Class B1: P7.
async function scenario() {
  const s = setup();
  const p = [
    await s.join(NICKS[0], 'TEST-A1'),
    await s.join(NICKS[1], 'TEST-A1'),
    await s.join(NICKS[2], 'TEST-A1'),
    await s.join(NICKS[3], 'TEST-A1'),
    await s.join(NICKS[4], 'TEST-A1'),
    await s.join(NICKS[5], 'TEST-A2'),
    await s.join(NICKS[6], 'TEST-B1'),
  ];
  const run = async (i: number, score: number, endT: number) => {
    s.clock.advance(1000); // every run a little later than the one before
    s.replay.scores.push(score);
    const r = await s.call('POST', '/api/runs', { token: p[i].token, body: runBody({ endT, clientScore: score }) });
    expect(r.json).toEqual({ serverScore: score, accepted: true });
  };
  await run(0, 70, 90_000);
  await run(0, 80, 120_000);
  await run(0, 80, 110_000); // P1's best: 80 in 110 s (same score, shorter)
  await run(1, 80, 100_000); // P2: 80 in 100 s
  await run(2, 80, 100_000); // P3: same as P2 but a later run
  await run(2, 60, 50_000);
  await run(3, 99, 60_000); // P4: best of all, but removed below
  await run(5, 90, 50_000); // P6 in class A2
  await run(6, 100, 40_000); // P7 in the other school
  const del = await s.call('DELETE', `/api/teacher/player/${p[3].playerId}`, { teacher: 'TEACH-A1' });
  expect(del.status).toBe(200);
  return { ...s, p };
}

describe('GET /api/boards', () => {
  it('class board: best score per player; ties by shorter duration, then earlier run; removed players hidden', async () => {
    const { call, p } = await scenario();
    const r = await call('GET', '/api/boards?scope=class', { token: p[0].token });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      scope: 'class',
      entries: [
        { rank: 1, nickname: NICKS[1], score: 80, durationMs: 100_000 },
        { rank: 2, nickname: NICKS[2], score: 80, durationMs: 100_000 },
        { rank: 3, nickname: NICKS[0], score: 80, durationMs: 110_000 },
      ],
    });
  });

  it('school board: every class of the school, no other school', async () => {
    const { call, p } = await scenario();
    const r = await call('GET', '/api/boards?scope=school', { token: p[1].token });
    expect(r.json.scope).toBe('school');
    expect(r.json.entries.map((e: { rank: number; nickname: string }) => [e.rank, e.nickname])).toEqual([
      [1, NICKS[5]],
      [2, NICKS[1]],
      [3, NICKS[2]],
      [4, NICKS[0]],
    ]);
  });

  it('the other school sees only its own players', async () => {
    const { call, p } = await scenario();
    const r = await call('GET', '/api/boards?scope=school', { token: p[6].token });
    expect(r.json.entries).toEqual([{ rank: 1, nickname: NICKS[6], score: 100, durationMs: 40_000 }]);
  });

  it('ranks realtime runs only; a guided run is stored and counts as an attempt', async () => {
    const { call, p, replay, db } = await scenario();
    replay.scores.push(100);
    const guided = await call('POST', '/api/runs', { token: p[4].token, body: runBody({ mode: 'guided', clientScore: 100 }) });
    expect(guided.json).toEqual({ serverScore: 100, accepted: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE mode = 'guided'").get()).toEqual({ n: 1 });
    const board = await call('GET', '/api/boards?scope=class', { token: p[0].token });
    expect(board.json.entries.map((e: { nickname: string }) => e.nickname)).not.toContain(NICKS[4]);
    const teacher = await call('GET', '/api/teacher/class', { teacher: 'TEACH-A1' });
    const p5 = teacher.json.players.find((x: { nickname: string }) => x.nickname === NICKS[4]);
    expect(p5.attempts).toBe(1);
  });

  it('refuses a bad scope and a missing token', async () => {
    const { call, p } = await scenario();
    expect((await call('GET', '/api/boards?scope=city', { token: p[0].token })).status).toBe(400);
    expect((await call('GET', '/api/boards', { token: p[0].token })).status).toBe(400);
    expect((await call('GET', '/api/boards?scope=class')).status).toBe(401);
  });
});
