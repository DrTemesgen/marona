import { describe, expect, it } from 'vitest';
import { MINUTE, NICKS, T0, makeCase, setup } from './helpers';

const OPEN = T0 + 60 * MINUTE;
const CLOSE = T0 + 120 * MINUTE;
const MAX1 = 300_000; // test-case maxDurationMs
const MAX2 = 200_000; // case-two maxDurationMs
const LOG = [
  { actionId: 'check', t: 1000 },
  { actionId: 'call', t: 2000 },
];

function finalSetup() {
  let nextSeed = 1000;
  const s = setup({ cases: [makeCase('test-case', MAX1), makeCase('case-two', MAX2)], randomSeed: () => ++nextSeed });
  s.db
    .prepare('INSERT INTO finals (id, name, opens_at, closes_at, case_ids_json, variant_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 'City final', OPEN, CLOSE, JSON.stringify(['test-case', 'case-two']), 'final-x');
  // The server start time of each start, so a submit can claim the game time the server saw.
  const started = new Map<string, number>();
  const start = async (token: string, caseId: string) => {
    const r = await s.call('POST', '/api/final/start', { token, body: { finalId: 1, caseId } });
    if (r.status === 200) started.set(`${token}|${caseId}`, r.json.serverStartMs);
    return r;
  };
  // endT: the server-seen game time by default (capped at the case limit), or a given claim.
  const submit = (token: string, caseId: string, score?: number, actions: unknown[] = LOG, endT?: number) => {
    if (score !== undefined) s.replay.scores.push(score);
    const max = caseId === 'case-two' ? MAX2 : MAX1;
    const startMs = started.get(`${token}|${caseId}`);
    const claim = endT ?? (startMs === undefined ? 60_000 : Math.min(max, Math.max(2000, s.clock.now() - startMs)));
    return s.call('POST', '/api/final/submit', { token, body: { finalId: 1, caseId, actions, endT: claim } });
  };
  return { ...s, start, submit };
}

describe('GET /api/final/current', () => {
  it('gives the next final before the window, the open one inside it, then { finalId: null }', async () => {
    const { call, join, clock } = finalSetup();
    const { token } = await join(NICKS[0]);
    const before = await call('GET', '/api/final/current', { token });
    expect(before.json).toEqual({
      finalId: 1,
      opensAt: OPEN,
      closesAt: CLOSE,
      open: false,
      caseIds: ['test-case', 'case-two'],
    });
    clock.set(OPEN);
    expect((await call('GET', '/api/final/current', { token })).json.open).toBe(true);
    clock.set(CLOSE);
    expect((await call('GET', '/api/final/current', { token })).json).toEqual({ finalId: null });
    expect((await call('GET', '/api/final/current')).status).toBe(401);
  });
});

describe('POST /api/final/start', () => {
  it('is refused outside the window', async () => {
    const { join, clock, start, db } = finalSetup();
    const { token } = await join(NICKS[0]);
    const early = await start(token, 'test-case');
    expect(early.status).toBe(403);
    expect(early.json).toEqual({ error: 'final not open' });
    clock.set(CLOSE);
    expect((await start(token, 'test-case')).status).toBe(403);
    expect((db.prepare('SELECT COUNT(*) AS n FROM final_starts').get() as { n: number }).n).toBe(0);
  });

  it('issues the server seed and the final variant, and records the server start time', async () => {
    const { join, clock, start } = finalSetup();
    const { token } = await join(NICKS[0]);
    clock.set(OPEN + 5000);
    const r = await start(token, 'test-case');
    expect(r.status).toBe(200);
    // Integration step 1: the full variant comes too; the phone app no longer carries it.
    const variant = makeCase().variants.find((v) => v.id === 'final-x');
    expect(r.json).toEqual({ seed: 1001, variantId: 'final-x', variant, serverStartMs: OPEN + 5000, elapsedMs: 0 });
  });

  it('uses each case\'s first finalOnly variant when finals.variant_id is NULL', async () => {
    const s = setup({ cases: [makeCase('test-case', MAX1)], randomSeed: () => 7 });
    s.db
      .prepare('INSERT INTO finals (id, name, opens_at, closes_at, case_ids_json, variant_id) VALUES (?, ?, ?, ?, ?, NULL)')
      .run(1, 'City final', OPEN, CLOSE, JSON.stringify(['test-case']));
    const { token } = await s.join(NICKS[0]);
    s.clock.set(OPEN);
    const r = await s.call('POST', '/api/final/start', { token, body: { finalId: 1, caseId: 'test-case' } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ variantId: 'final-x', variant: { id: 'final-x', finalOnly: true } });
    const again = await s.call('POST', '/api/final/start', { token, body: { finalId: 1, caseId: 'test-case' } });
    expect(again.json).toEqual(r.json);
  });

  it('allows one start per player and case: asking again returns the same start', async () => {
    const { join, clock, start, db } = finalSetup();
    const { token } = await join(NICKS[0]);
    clock.set(OPEN);
    const first = await start(token, 'test-case');
    clock.advance(30_000);
    const again = await start(token, 'test-case');
    // the same start, and how long ago it was, so a reloaded phone resumes the clock there
    expect(again.json).toEqual({ ...first.json, elapsedMs: 30_000 });
    expect(first.json.elapsedMs).toBe(0);
    expect((await start(token, 'case-two')).json.seed).toBe(1002);
    expect((db.prepare('SELECT COUNT(*) AS n FROM final_starts').get() as { n: number }).n).toBe(2);
  });

  it('refuses a case that is not in the final and an unknown final', async () => {
    const { join, clock, start, call } = finalSetup();
    const { token } = await join(NICKS[0]);
    clock.set(OPEN);
    expect((await start(token, 'other-case')).status).toBe(400);
    const r = await call('POST', '/api/final/start', { token, body: { finalId: 99, caseId: 'test-case' } });
    expect(r.status).toBe(404);
  });
});

describe('POST /api/final/submit', () => {
  it('is refused without a start', async () => {
    const { join, clock, submit, db } = finalSetup();
    const { token } = await join(NICKS[0]);
    clock.set(OPEN);
    const r = await submit(token, 'test-case', 90);
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'not started' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM final_runs').get() as { n: number }).n).toBe(0);
  });

  it('answers only { received: true }, replays with the stored seed and variant, keeps the server time', async () => {
    const { join, clock, start, submit, db, replay } = finalSetup();
    const { token, playerId } = await join(NICKS[0]);
    clock.set(OPEN);
    await start(token, 'test-case');
    clock.advance(95_000);
    const r = await submit(token, 'test-case', 87);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ received: true });
    expect(replay.calls[0].cfg).toMatchObject({ seed: 1001, variantId: 'final-x', mode: 'realtime' });
    const row = db.prepare('SELECT * FROM final_runs').get() as Record<string, unknown>;
    expect(row).toMatchObject({ player_id: playerId, case_id: 'test-case', server_score: 87, server_duration_ms: 95_000 });
    const second = await submit(token, 'test-case', 99);
    expect(second.status).toBe(409);
  });

  it('refuses a submit at or after start + maxDurationMs + 60 s; accepts one just before', async () => {
    const { join, clock, start, submit, db } = finalSetup();
    const a = await join(NICKS[0]);
    const b = await join(NICKS[1]);
    clock.set(OPEN);
    await start(a.token, 'test-case');
    await start(b.token, 'test-case');
    clock.advance(MAX1 + 60_000 - 1);
    expect((await submit(a.token, 'test-case', 70)).json).toEqual({ received: true });
    clock.advance(1);
    const late = await submit(b.token, 'test-case', 70);
    expect(late.status).toBe(403);
    expect(late.json).toEqual({ error: 'too late' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM final_runs').get() as { n: number }).n).toBe(1);
    // And a fresh start after the time is up is refused too.
    expect((await start(b.token, 'test-case')).status).toBe(409);
  });

  it('refuses a submit after the window closes', async () => {
    const { join, clock, start, submit } = finalSetup();
    const { token } = await join(NICKS[0]);
    clock.set(CLOSE - 10_000);
    await start(token, 'test-case');
    clock.set(CLOSE);
    const r = await submit(token, 'test-case', 70);
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: 'final closed' });
  });

  it('stores an implausible log as 0 points, without replay, and still answers { received: true }', async () => {
    const { join, clock, start, submit, db, replay } = finalSetup();
    const { token } = await join(NICKS[0]);
    clock.set(OPEN);
    await start(token, 'test-case');
    clock.advance(30_000);
    const tooFast = [
      { actionId: 'check', t: 1000 },
      { actionId: 'call', t: 1010 },
    ];
    expect((await submit(token, 'test-case', undefined, tooFast)).json).toEqual({ received: true });
    expect(replay.calls).toHaveLength(0);
    expect(db.prepare('SELECT server_score FROM final_runs').get()).toEqual({ server_score: 0 });
  });

  it('scores 0, without replay, only when endT is longer than the server time by more than 5 s', async () => {
    const { join, clock, start, submit, db, replay } = finalSetup();
    const a = await join(NICKS[0]);
    const b = await join(NICKS[1]);
    clock.set(OPEN);
    await start(a.token, 'test-case');
    await start(b.token, 'test-case');
    clock.advance(100_000);
    // a claims a 105.001 s game the server saw take 100 s; b claims 105 s, exactly 5 s over: allowed
    expect((await submit(a.token, 'test-case', undefined, LOG, 105_001)).json).toEqual({ received: true });
    expect(replay.calls).toHaveLength(0);
    replay.timePoints.push(15);
    expect((await submit(b.token, 'test-case', 88, LOG, 105_000)).json).toEqual({ received: true });
    expect(replay.calls).toHaveLength(1);
    const rows = db.prepare('SELECT player_id, server_score FROM final_runs ORDER BY player_id').all();
    expect(rows).toEqual([
      { player_id: a.playerId, server_score: 0 },
      { player_id: b.playerId, server_score: 88 },
    ]);
    // and the zero is the one submission: a second try is refused
    expect((await submit(a.token, 'test-case', 99, LOG, 100_000)).status).toBe(409);
  });

  it('keeps the replay score minus its time points when endT is more than 30 s shorter than the server time', async () => {
    const { join, clock, start, submit, db, replay } = finalSetup();
    const a = await join(NICKS[0]);
    const b = await join(NICKS[1]);
    const c = await join(NICKS[2]);
    clock.set(OPEN);
    await start(a.token, 'test-case');
    await start(b.token, 'test-case');
    await start(c.token, 'test-case');
    clock.advance(100_000);
    // a: a 69.999 s game handed in 100 s after the start (slow retry): 80 - 15 time points
    replay.timePoints.push(15, 15, 30);
    expect((await submit(a.token, 'test-case', 80, LOG, 69_999)).json).toEqual({ received: true });
    // b: exactly 30 s short: the full score
    expect((await submit(b.token, 'test-case', 80, LOG, 70_000)).json).toEqual({ received: true });
    // c: never below 0
    expect((await submit(c.token, 'test-case', 20, LOG, 10_000)).json).toEqual({ received: true });
    expect(replay.calls).toHaveLength(3);
    const rows = db
      .prepare('SELECT player_id, server_score, server_duration_ms FROM final_runs ORDER BY player_id')
      .all() as { player_id: string; server_score: number; server_duration_ms: number }[];
    const byPlayer = Object.fromEntries(rows.map((r) => [r.player_id, r]));
    expect(byPlayer[a.playerId]).toEqual({ player_id: a.playerId, server_score: 65, server_duration_ms: 100_000 });
    expect(byPlayer[b.playerId].server_score).toBe(80);
    expect(byPlayer[c.playerId].server_score).toBe(0);
  });

  it('stores a log the replay refuses as 0 points', async () => {
    const { join, clock, start, submit, db, replay } = finalSetup();
    const { token } = await join(NICKS[0]);
    clock.set(OPEN);
    await start(token, 'test-case');
    replay.throwNext = true;
    expect((await submit(token, 'test-case')).json).toEqual({ received: true });
    expect(db.prepare('SELECT server_score FROM final_runs').get()).toEqual({ server_score: 0 });
  });
});

describe('GET /api/final/results', () => {
  it('is 403 "window open" until closesAt, then ranks the city and each school', async () => {
    const { join, clock, start, submit, call } = finalSetup();
    const P1 = await join(NICKS[0], 'TEST-A1');
    const P2 = await join(NICKS[1], 'TEST-A1');
    const P3 = await join(NICKS[2], 'TEST-A1');
    const P4 = await join(NICKS[3], 'TEST-A2');
    const P5 = await join(NICKS[4], 'TEST-B1');
    const P6 = await join(NICKS[5], 'TEST-B1');
    const all = [P1, P2, P3, P4, P5, P6];

    clock.set(OPEN);
    for (const p of all) await start(p.token, 'test-case');
    clock.set(OPEN + 50_000);
    await submit(P3.token, 'test-case', 100);
    clock.set(OPEN + 90_000);
    await submit(P2.token, 'test-case', 90);
    clock.set(OPEN + 100_000);
    await submit(P1.token, 'test-case', 90);
    await submit(P4.token, 'test-case', 85);
    await submit(P5.token, 'test-case', 95);
    await submit(P6.token, 'test-case', 100);

    clock.set(OPEN + 200_000);
    for (const p of all) await start(p.token, 'case-two'); // P3 never submits case two
    clock.set(OPEN + 290_000);
    await submit(P4.token, 'case-two', 85);
    clock.set(OPEN + 300_000);
    await submit(P1.token, 'case-two', 80);
    await submit(P2.token, 'case-two', 80);
    await submit(P5.token, 'case-two', 95);
    await submit(P6.token, 'case-two', 100);
    const del = await call('DELETE', `/api/teacher/player/${P6.playerId}`, { teacher: 'TEACH-B1' });
    expect(del.status).toBe(200);

    clock.set(CLOSE - 1);
    const early = await call('GET', '/api/final/results?finalId=1');
    expect(early.status).toBe(403);
    expect(early.json).toEqual({ error: 'window open' });

    clock.set(CLOSE);
    const r = await call('GET', '/api/final/results?finalId=1');
    expect(r.status).toBe(200);
    // P2 and P4 tie on 170 points and 190 s; P4's last submission came first.
    // P3 missed case two: 0 points for it and the longest allowed time (200 s + 60 s).
    expect(r.json.city).toEqual([
      { rank: 1, nickname: NICKS[4], score: 190, durationMs: 200_000 },
      { rank: 2, nickname: NICKS[3], score: 170, durationMs: 190_000 },
      { rank: 3, nickname: NICKS[1], score: 170, durationMs: 190_000 },
      { rank: 4, nickname: NICKS[0], score: 170, durationMs: 200_000 },
      { rank: 5, nickname: NICKS[2], score: 100, durationMs: 50_000 + MAX2 + 60_000 },
    ]);
    expect(Object.keys(r.json.bySchool).sort()).toEqual(['Test School A', 'Test School B']);
    expect(r.json.bySchool['Test School A'].map((e: { rank: number; nickname: string }) => [e.rank, e.nickname])).toEqual([
      [1, NICKS[3]],
      [2, NICKS[1]],
      [3, NICKS[0]],
      [4, NICKS[2]],
    ]);
    expect(r.json.bySchool['Test School B']).toEqual([{ rank: 1, nickname: NICKS[4], score: 190, durationMs: 200_000 }]);
  });

  it('refuses a bad or unknown finalId', async () => {
    const { call, clock } = finalSetup();
    clock.set(CLOSE);
    expect((await call('GET', '/api/final/results')).status).toBe(400);
    expect((await call('GET', '/api/final/results?finalId=abc')).status).toBe(400);
    expect((await call('GET', '/api/final/results?finalId=7')).status).toBe(404);
  });
});
