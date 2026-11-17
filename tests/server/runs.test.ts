import { describe, expect, it } from 'vitest';
import { checkLog } from '../../server/plausibility';
import { makeCase, runBody, setup } from './helpers';

async function joined() {
  const s = setup();
  const p = await s.join('Brave Falcon 27');
  return { ...s, token: p.token, playerId: p.playerId };
}

const runCount = (db: ReturnType<typeof setup>['db']) =>
  (db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n;

describe('POST /api/runs: the server keeps its own score', () => {
  it('stores an accepted run with the replay score', async () => {
    const { call, token, db, replay, playerId } = await joined();
    replay.scores.push(64);
    const r = await call('POST', '/api/runs', { token, body: runBody({ clientScore: 64 }) });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ serverScore: 64, accepted: true });
    expect(replay.calls).toHaveLength(1);
    expect(replay.calls[0].cfg).toMatchObject({ seed: 12345, mode: 'realtime', variantId: 'practice' });
    expect(replay.calls[0].cfg.caseFile.id).toBe('test-case');
    const row = db.prepare('SELECT * FROM runs').get() as Record<string, unknown>;
    expect(row).toMatchObject({ player_id: playerId, case_id: 'test-case', server_score: 64, score_mismatch: 0 });
    expect(JSON.parse(row.actions_json as string)).toEqual(runBody().actions);
  });

  it('ignores a forged clientScore: keeps the server score and flags the mismatch', async () => {
    const { call, token, db, replay } = await joined();
    replay.scores.push(40);
    const r = await call('POST', '/api/runs', { token, body: runBody({ clientScore: 100 }) });
    expect(r.json).toEqual({ serverScore: 40, accepted: true });
    const row = db.prepare('SELECT server_score, score_mismatch FROM runs').get();
    expect(row).toEqual({ server_score: 40, score_mismatch: 1 });
  });

  it('answers accepted false, "invalid game log", when the replay throws; nothing is stored', async () => {
    const { call, token, db, replay } = await joined();
    replay.throwNext = true;
    const r = await call('POST', '/api/runs', { token, body: runBody() });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ serverScore: 0, accepted: false, reason: 'invalid game log' });
    expect(runCount(db)).toBe(0);
  });

  it('treats an unusable engine report (score above 100) as an invalid log', async () => {
    const { call, token, db, replay } = await joined();
    replay.scores.push(250);
    const r = await call('POST', '/api/runs', { token, body: runBody() });
    expect(r.json).toMatchObject({ accepted: false, reason: 'invalid game log' });
    expect(runCount(db)).toBe(0);
  });
});

describe('POST /api/runs: plausibility checks before replay', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['time goes backwards', { actions: [{ actionId: 'check', t: 5000 }, { actionId: 'call', t: 4000 }] }],
    // Rhythm actions skip the 150 ms rule, so only the backwards check can catch this one.
    ['time goes backwards between rhythm actions', {
      actions: [
        { actionId: 'push', t: 5000, payload: { bpm: 110, count: 5 } },
        { actionId: 'push', t: 4000, payload: { bpm: 110, count: 5 } },
      ],
    }],
    ['endT beyond maxDurationMs', { endT: 300_001 }],
    ['two plain actions 149 ms apart', { actions: [{ actionId: 'check', t: 1000 }, { actionId: 'call', t: 1149 }] }],
    ['two plain actions 74 ms apart in guided mode', {
      mode: 'guided',
      actions: [{ actionId: 'check', t: 1000 }, { actionId: 'call', t: 1074 }],
    }],
    ['plain actions 100 ms apart with a rhythm action between', {
      actions: [
        { actionId: 'check', t: 1000 },
        { actionId: 'push', t: 1050, payload: { bpm: 400, count: 1 } },
        { actionId: 'call', t: 1100 },
      ],
    }],
    // Integration step 1: bpm 1-400 and count 1-60 are allowed; a wrong rate is not a cheat.
    ['rhythm bpm 0.5', { actions: [{ actionId: 'push', t: 59_000, payload: { bpm: 0.5, count: 1 } }] }],
    ['rhythm bpm 401', { actions: [{ actionId: 'push', t: 10_000, payload: { bpm: 401, count: 10 } }] }],
    ['rhythm count 0', { actions: [{ actionId: 'push', t: 10_000, payload: { bpm: 110, count: 0 } }] }],
    ['rhythm count 61', { actions: [{ actionId: 'push', t: 50_000, payload: { bpm: 110, count: 61 } }] }],
    ['rhythm action without a bpm', { actions: [{ actionId: 'push', t: 1000 }] }],
    ['rhythm action without a count', { actions: [{ actionId: 'push', t: 10_000, payload: { bpm: 110 } }] }],
    // 10 taps at 100 bpm need 10 * 60000 / 100 * 0.5 = 3000 ms since the action before.
    ['a rhythm set faster than the clock', {
      actions: [
        { actionId: 'call', t: 1000 },
        { actionId: 'push', t: 3999, payload: { bpm: 100, count: 10 } },
      ],
    }],
    ['two rhythm sets faster than the clock', {
      actions: [
        { actionId: 'push', t: 3000, payload: { bpm: 100, count: 10 } },
        { actionId: 'push', t: 5999, payload: { bpm: 100, count: 10 } },
      ],
    }],
    ['action after endT', { endT: 5000, actions: [{ actionId: 'call', t: 6000 }] }],
  ];
  it.each(cases)('refuses: %s (replay not called, nothing stored)', async (_why, over) => {
    const { call, token, db, replay } = await joined();
    const r = await call('POST', '/api/runs', { token, body: runBody(over) });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ serverScore: 0, accepted: false, reason: 'implausible game log' });
    expect(replay.calls).toHaveLength(0);
    expect(runCount(db)).toBe(0);
  });

  it('refuses an action id that is not in the case as an invalid log', async () => {
    const { call, token, replay } = await joined();
    const r = await call('POST', '/api/runs', { token, body: runBody({ actions: [{ actionId: 'fly', t: 1000 }] }) });
    expect(r.json).toEqual({ serverScore: 0, accepted: false, reason: 'invalid game log' });
    expect(replay.calls).toHaveLength(0);
  });

  it('accepts the limits themselves: 150 ms apart, bpm 1 and 400, count 1 and 60, sets that just fit, endT = max', async () => {
    const { call, token } = await joined();
    const r = await call('POST', '/api/runs', {
      token,
      body: runBody({
        endT: 300_000,
        actions: [
          { actionId: 'check', t: 1000 },
          { actionId: 'call', t: 1150 },
          { actionId: 'push', t: 1150 + 75, payload: { bpm: 400, count: 1 } }, // 1 * 60000 / 400 * 0.5 = 75
          { actionId: 'push', t: 1225 + 4500, payload: { bpm: 400, count: 60 } }, // 60 * 150 * 0.5 = 4500
          { actionId: 'push', t: 5725 + 30_000, payload: { bpm: 1, count: 1 } }, // 60000 * 0.5 = 30000
          { actionId: 'check', t: 35_725 },
          { actionId: 'call', t: 35_725 + 150 },
        ],
      }),
    });
    expect(r.json).toEqual({ serverScore: 50, accepted: true });
  });

  it('guided mode allows 75 ms between plain actions and rhythm sets in half the time', async () => {
    const { call, token } = await joined();
    const r = await call('POST', '/api/runs', {
      token,
      body: runBody({
        mode: 'guided',
        actions: [
          { actionId: 'check', t: 1000 },
          { actionId: 'call', t: 1075 },
          { actionId: 'push', t: 1075 + 1500, payload: { bpm: 100, count: 10 } }, // 6000 ms x 0.25
        ],
      }),
    });
    expect(r.json).toEqual({ serverScore: 50, accepted: true });
  });

  it('checkLog unit: at most 3000 actions per run', () => {
    const c = makeCase();
    const plain = (n: number) => Array.from({ length: n }, (_, i) => ({ actionId: i % 2 ? 'check' : 'call', t: i * 75 }));
    expect(checkLog(c, plain(3000), 300_000, 'guided')).toEqual({ ok: true });
    expect(checkLog(c, plain(3001), 300_000, 'guided')).toMatchObject({ ok: false, kind: 'implausible' });
  });

  it('checkLog unit: equal times for two plain actions are too fast; an empty log is fine', () => {
    const c = makeCase();
    expect(checkLog(c, [], 0)).toEqual({ ok: true });
    const same = checkLog(c, [{ actionId: 'check', t: 10 }, { actionId: 'call', t: 10 }], 100);
    expect(same.ok).toBe(false);
  });
});

describe('POST /api/runs: request validation', () => {
  it('needs a known player token', async () => {
    const { call } = await joined();
    expect((await call('POST', '/api/runs', { body: runBody() })).status).toBe(401);
    const forged = 'A'.repeat(43);
    expect((await call('POST', '/api/runs', { token: forged, body: runBody() })).status).toBe(401);
  });

  it('refuses an unknown case, an unknown variant and a finalOnly variant', async () => {
    const { call, token, replay } = await joined();
    expect((await call('POST', '/api/runs', { token, body: runBody({ caseId: 'no-such-case' }) })).json).toEqual({
      error: 'unknown case',
    });
    expect((await call('POST', '/api/runs', { token, body: runBody({ variantId: 'nope' }) })).status).toBe(400);
    const fin = await call('POST', '/api/runs', { token, body: runBody({ variantId: 'final-x' }) });
    expect(fin.status).toBe(400);
    expect(fin.json).toEqual({ error: 'unknown variant' });
    expect(replay.calls).toHaveLength(0);
  });

  it.each([
    ['not JSON', null, '{"caseId": '],
    ['missing clientScore', { ...runBody(), clientScore: undefined }, undefined],
    ['seed too big', runBody({ seed: 2 ** 32 }), undefined],
    ['negative t', runBody({ actions: [{ actionId: 'call', t: -1 }] }), undefined],
    ['unknown mode', runBody({ mode: 'cheat' }), undefined],
    ['extra field', runBody({ email: 'x' }), undefined],
    ['extra field in an action', runBody({ actions: [{ actionId: 'call', t: 1000, note: 'x' }] }), undefined],
    ['too many actions', runBody({ actions: Array.from({ length: 3001 }, (_, i) => ({ actionId: 'push', t: i })) }), undefined],
  ])('answers 400 with a generic message: %s', async (_why, body, rawBody) => {
    const { call, token } = await joined();
    const r = await call('POST', '/api/runs', { token, body: rawBody === undefined ? body : undefined, rawBody });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: 'invalid request' });
  });

  it('refuses a body over 256 KB with 413', async () => {
    const { call, token } = await joined();
    const big = JSON.stringify(runBody({ pad: 'x'.repeat(260 * 1024) }));
    const r = await call('POST', '/api/runs', { token, rawBody: big });
    expect(r.status).toBe(413);
    expect(r.json).toEqual({ error: 'request too large' });
  });
});
