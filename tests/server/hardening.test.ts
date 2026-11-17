// The security fixes of 17 Nov 2026 (before the online demo): races once every database call is
// async, wrong teacher codes, the run cap, CORS for one origin, and the results cache.
// The race tests run on both engines: node:sqlite (PC) and libSQL (the demo's Turso database).
import { createClient } from '@libsql/client';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createApp, RESULTS_CACHE_MS, TEACHER_LOCK_MS, type AppDeps } from '../../server/app';
import { SCHEMA } from '../../server/db';
import { ADJECTIVES, NOUNS, NUMBERS, nicknameCandidates } from '../../server/nicknames';
import { libsqlSql, nodeSql, type Sql } from '../../server/sql';
import { MINUTE, NICKS, T0, fakeClock, fakeReplay, makeCase, runBody, setup } from './helpers';

const SEED = `
  INSERT INTO schools (id, name) VALUES (1, 'Test School A');
  INSERT INTO classes (id, school_id, name, class_code, teacher_code, size_cap) VALUES
    (1, 1, 'Class A1', 'TEST-A1', 'TEACH-A1', 3),
    (2, 1, 'Class A2', 'TEST-A2', 'TEACH-LONG-ABCD-2345-WXYZ', 40);
  INSERT INTO finals (id, name, opens_at, closes_at, case_ids_json, variant_id)
    VALUES (1, 'F', ${T0}, ${T0 + 60 * MINUTE}, '["test-case"]', NULL);
`;

async function engineApp(kind: 'node' | 'libsql', over: Partial<AppDeps> = {}) {
  let db: Sql;
  if (kind === 'node') {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    db = nodeSql(raw);
  } else {
    db = libsqlSql(createClient({ url: ':memory:' }));
  }
  await db.exec(SCHEMA);
  await db.exec(SEED);
  const clock = fakeClock(T0 + 1000);
  const replay = fakeReplay();
  const app = createApp({
    db,
    cases: [makeCase()],
    replay: replay.fn,
    now: clock.now,
    clientIp: () => '10.0.0.1',
    limits: { requestsPerMinute: 1e6, joinsPerMinute: 1e6, playerRequestsPerMinute: 1e6 },
    ...over,
  });
  const post = async (path: string, body: unknown, token?: string) => {
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-player-token': token } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { db, app, clock, replay, post };
}

describe.each(['node', 'libsql'] as const)('races on %s (requests at the same time)', (kind) => {
  it('ten joins into a class with 3 places: exactly 3 get in, the rest hear "class is full"', async () => {
    const { db, post } = await engineApp(kind);
    const nicks = [...NICKS, 'Bold Heron 12', 'Keen Kite 13'];
    const all = await Promise.all(nicks.map((n) => post('/api/join', { classCode: 'TEST-A1', nickname: n })));
    expect(all.filter((r) => r.status === 200)).toHaveLength(3);
    expect(all.filter((r) => r.status === 409).map((r) => r.json)).toEqual(Array(7).fill({ error: 'class is full' }));
    expect(await db.get('SELECT COUNT(*) AS n FROM players WHERE class_id = 1')).toEqual({ n: 3 });
  });

  it('five phones join with the same nickname at once: one gets it, the others hear "nickname taken"', async () => {
    const { db, post } = await engineApp(kind);
    const all = await Promise.all(Array.from({ length: 5 }, () => post('/api/join', { classCode: 'TEST-A2', nickname: NICKS[0] })));
    expect(all.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(all.filter((r) => r.status === 409).every((r) => r.json.error === 'nickname taken')).toBe(true);
    expect(await db.get('SELECT COUNT(*) AS n FROM players')).toEqual({ n: 1 });
  });

  it('a double tap on Start gives one start: both answers carry the same seed', async () => {
    let seed = 100;
    const { db, post } = await engineApp(kind, { randomSeed: () => ++seed });
    const { token } = (await post('/api/join', { classCode: 'TEST-A2', nickname: NICKS[0] })).json;
    const both = await Promise.all([1, 2, 3].map(() => post('/api/final/start', { finalId: 1, caseId: 'test-case' }, token)));
    expect(both.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(both.map((r) => r.json.seed)).size).toBe(1);
    expect(await db.get('SELECT COUNT(*) AS n FROM final_starts')).toEqual({ n: 1 });
  });

  it('two submits at once: one is kept, the other is refused with 409 (never a 500)', async () => {
    const { db, post, clock, replay } = await engineApp(kind);
    const { token } = (await post('/api/join', { classCode: 'TEST-A2', nickname: NICKS[0] })).json;
    await post('/api/final/start', { finalId: 1, caseId: 'test-case' }, token);
    clock.advance(30_000);
    replay.scores.push(80, 10);
    const body = { finalId: 1, caseId: 'test-case', actions: [{ actionId: 'call', t: 1000 }], endT: 29_000 };
    const both = await Promise.all([post('/api/final/submit', body, token), post('/api/final/submit', body, token)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)?.json).toEqual({ error: 'already submitted' });
    expect(await db.get('SELECT COUNT(*) AS n FROM final_runs')).toEqual({ n: 1 });
  });

  it('teacher remove reports a real change only (libSQL counts rowsAffected)', async () => {
    const { app, post } = await engineApp(kind);
    const p = (await post('/api/join', { classCode: 'TEST-A2', nickname: NICKS[0] })).json;
    const del = () =>
      app.request(`/api/teacher/player/${p.playerId}`, { method: 'DELETE', headers: { 'x-teacher-code': 'TEACH-LONG-ABCD-2345-WXYZ' } });
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
  });
});

describe.each(['node', 'libsql'] as const)('run cap under parallel runs on %s', (kind) => {
  it('six runs at once against a cap of 3: exactly 3 are stored, the rest hear "too many runs"', async () => {
    const { db, post } = await engineApp(kind, { limits: { requestsPerMinute: 1e6, joinsPerMinute: 1e6, playerRequestsPerMinute: 1e6, runsPerPlayer: 3 } });
    const { token } = (await post('/api/join', { classCode: 'TEST-A2', nickname: NICKS[0] })).json;
    const all = await Promise.all(Array.from({ length: 6 }, () => post('/api/runs', runBody(), token)));
    expect(all.filter((r) => r.json.accepted === true)).toHaveLength(3);
    expect(all.filter((r) => r.json.reason === 'too many runs')).toHaveLength(3);
    expect(await db.get('SELECT COUNT(*) AS n FROM runs')).toEqual({ n: 3 });
  });
});

describe('teacher codes', () => {
  it('after 20 wrong codes from one IP, that IP waits 10 minutes; a right code then works again', async () => {
    const { call, clock } = setup();
    for (let i = 0; i < 20; i++) expect((await call('GET', '/api/teacher/class', { teacher: `WRONG-${i}`, ip: '10.9.9.9' })).status).toBe(401);
    const locked = await call('GET', '/api/teacher/class', { teacher: 'TEACH-A1', ip: '10.9.9.9' });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(500);
    expect((await call('GET', '/api/teacher/class', { teacher: 'TEACH-A1', ip: '10.8.8.8' })).status).toBe(200);
    clock.advance(TEACHER_LOCK_MS);
    expect((await call('GET', '/api/teacher/class', { teacher: 'TEACH-A1', ip: '10.9.9.9' })).status).toBe(200);
  });

  it('right codes never count toward the stop', async () => {
    const { call } = setup();
    for (let i = 0; i < 40; i++) expect((await call('GET', '/api/teacher/class', { teacher: 'TEACH-A1', ip: '10.7.7.7' })).status).toBe(200);
  });

  it('with a minimum length (the online demo: 16), a short code is refused even when a class has it', async () => {
    const { db, app } = await engineApp('node', { minTeacherCodeLength: 16 });
    expect(await db.get("SELECT 1 AS x FROM classes WHERE teacher_code = 'TEACH-A1'")).toEqual({ x: 1 });
    const get = (code: string) => app.request('/api/teacher/class', { headers: { 'x-teacher-code': code } });
    expect((await get('TEACH-A1')).status).toBe(401);
    expect((await get('TEACH-LONG-ABCD-2345-WXYZ')).status).toBe(200);
  });
});

describe('run cap per player', () => {
  it('stores 60 practice runs an hour per player, then answers "too many runs" without a replay', async () => {
    const { call, join, clock, replay, db } = setup();
    const { token } = await join(NICKS[0]);
    for (let i = 0; i < 60; i++) {
      expect((await call('POST', '/api/runs', { token, body: runBody() })).json).toEqual({ serverScore: 50, accepted: true });
      clock.advance(10);
    }
    const calls = replay.calls.length;
    expect((await call('POST', '/api/runs', { token, body: runBody() })).json).toEqual({
      serverScore: 0,
      accepted: false,
      reason: 'too many runs',
    });
    expect(replay.calls.length).toBe(calls);
    expect((db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n).toBe(60);
    // Another player is not affected; an hour later the first may play again.
    const other = await join(NICKS[1]);
    expect((await call('POST', '/api/runs', { token: other.token, body: runBody() })).json.accepted).toBe(true);
    clock.advance(60 * MINUTE);
    expect((await call('POST', '/api/runs', { token, body: runBody() })).json.accepted).toBe(true);
  });

  it('stops at the lifetime cap too', async () => {
    const { call, join, clock } = setup({ limits: { requestsPerMinute: 1e6, joinsPerMinute: 1e6, runsPerPlayer: 3 } });
    const { token } = await join(NICKS[0]);
    for (let i = 0; i < 3; i++) {
      expect((await call('POST', '/api/runs', { token, body: runBody() })).json.accepted).toBe(true);
      clock.advance(2 * 60 * MINUTE);
    }
    expect((await call('POST', '/api/runs', { token, body: runBody() })).json.reason).toBe('too many runs');
  });
});

describe('one origin (the online demo)', () => {
  it('with no allowed origins, no page on another origin may read an answer, the dev origins included', async () => {
    const { call } = setup({ allowedOrigins: [] });
    for (const origin of ['http://localhost:5173', 'http://attacker.invalid']) {
      const r = await call('GET', '/api/health', { origin });
      expect(r.status).toBe(200);
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});

describe('final results cache', () => {
  it('a closed final is ranked once a minute per instance at most', async () => {
    const s = setup();
    s.db.prepare('INSERT INTO finals (id, name, opens_at, closes_at, case_ids_json) VALUES (1, ?, ?, ?, ?)').run(
      'F', T0, T0 + MINUTE, JSON.stringify(['test-case']),
    );
    const p = await s.join(NICKS[0]);
    await s.call('POST', '/api/final/start', { token: p.token, body: { finalId: 1, caseId: 'test-case' } });
    s.clock.set(T0 + MINUTE);
    const first = await s.call('GET', '/api/final/results?finalId=1');
    expect(first.json.city).toHaveLength(1);
    await s.call('DELETE', `/api/teacher/player/${p.playerId}`, { teacher: 'TEACH-A1' });
    expect((await s.call('GET', '/api/final/results?finalId=1')).json).toEqual(first.json);
    s.clock.advance(RESULTS_CACHE_MS);
    expect((await s.call('GET', '/api/final/results?finalId=1')).json.city).toEqual([]);
  });
});

describe('nickname options in one query', () => {
  it('gives distinct candidates, and stops when the random source repeats itself', () => {
    expect(new Set(nicknameCandidates(12)).size).toBe(12);
    const stuck = nicknameCandidates(12, () => 0);
    expect(stuck).toEqual([`Agile ${NOUNS[0]} 10`]);
  });

  it('never offers a nickname that is taken (a rigged random source offers one first)', async () => {
    const seq = [ADJECTIVES.indexOf('Brave'), NOUNS.indexOf('Falcon'), NUMBERS.indexOf(27)];
    let i = 0;
    const randomIndex = (n: number) => (i < seq.length ? seq[i++] : (i++ * 7) % n);
    const { call, join } = setup({ randomIndex });
    await join('Brave Falcon 27');
    const r = await call('GET', '/api/nicknames');
    expect(r.json.options).toHaveLength(6);
    expect(r.json.options).not.toContain('Brave Falcon 27');
  });
});
