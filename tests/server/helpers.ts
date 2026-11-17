// Shared test setup for the server: an in-memory database, a fake replay with a controllable
// score, a controllable clock and small request helpers. Not a test file itself.
import type { DatabaseSync } from 'node:sqlite';
import { createApp, type AppDeps, type ReplayFn } from '../../server/app';
import { openDb } from '../../server/db';
import { nodeSql } from '../../server/sql';
import { CaseFile, type GameConfig, type PlayerAction } from '../../src/shared/contract';

export const T0 = Date.UTC(2027, 3, 21, 6, 0, 0); // fixed start of the fake clock
export const MINUTE = 60_000;

// A small valid case: two plain cards, one rhythm card, a practice and a final-only variant.
export function makeCase(id = 'test-case', maxDurationMs = 300_000): CaseFile {
  return CaseFile.parse({
    id,
    chapter: 2,
    title: 'Test case',
    shortTitle: 'Test',
    version: '0.0.1',
    scene: 'school-gate',
    intro: 'A test scene.',
    sources: [{ id: 'src1', title: 'Test source', url: 'https://example.org/guide' }],
    characters: [{ id: 'casualty', name: 'Teacher', role: 'casualty', description: 'A teacher.' }],
    facts: [],
    phases: [{ id: 'p1', title: 'Phase 1' }],
    startPhaseId: 'p1',
    startCasualty: 'collapsed',
    actions: [
      { id: 'check', label: 'Check breathing', kind: 'action', phases: ['p1'] },
      { id: 'call', label: 'Call 907', kind: 'call', phases: ['p1'] },
      { id: 'push', label: 'Push hard and fast', kind: 'rhythm', phases: ['p1'], repeatable: true },
    ],
    lines: [],
    rubric: {
      items: [
        {
          id: 'r1',
          description: 'Called 907',
          check: { kind: 'did', actionId: 'call' },
          points: 90,
          critical: true,
          teachingPoint: 'Call early.',
          ref: { sourceId: 'src1', page: 'to confirm', review: 'pending' },
        },
      ],
      time: { maxPoints: 10, targetMs: 60_000, zeroAtMs: 120_000 },
    },
    maxDurationMs,
    variants: [
      { id: 'practice', label: 'Practice' },
      { id: 'final-x', label: 'Final', finalOnly: true },
    ],
    disclaimer: 'Practice only.',
  });
}

export interface FakeReplay {
  fn: ReplayFn;
  calls: { cfg: GameConfig; actions: PlayerAction[]; endT: number }[];
  scores: number[]; // totals to return in order; 50 when empty
  timePoints: number[]; // time points to return in order; 0 when empty
  throwNext: boolean;
}

export function fakeReplay(): FakeReplay {
  const fr: FakeReplay = {
    calls: [],
    scores: [],
    timePoints: [],
    throwNext: false,
    fn: (cfg, actions, endT) => {
      fr.calls.push({ cfg, actions, endT });
      if (fr.throwNext) {
        fr.throwNext = false;
        throw new Error('EngineError: card not available');
      }
      const total = fr.scores.length ? (fr.scores.shift() as number) : 50;
      const timePoints = fr.timePoints.length ? (fr.timePoints.shift() as number) : 0;
      return { report: { caseId: cfg.caseFile.id, total, items: [], harms: [], timePoints, durationMs: endT } };
    },
  };
  return fr;
}

export function fakeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    set: (v: number) => {
      t = v;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// Two schools, three classes. Class A2 has room for two players only.
export function seedSchools(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO schools (id, name) VALUES (1, 'Test School A'), (2, 'Test School B');
    INSERT INTO classes (id, school_id, name, class_code, teacher_code, size_cap) VALUES
      (1, 1, 'Class A1', 'TEST-A1', 'TEACH-A1', 40),
      (2, 1, 'Class A2', 'TEST-A2', 'TEACH-A2', 2),
      (3, 2, 'Class B1', 'TEST-B1', 'TEACH-B1', 40);
  `);
}

export interface CallOpts {
  body?: unknown;
  rawBody?: string;
  token?: string;
  teacher?: string;
  ip?: string;
  origin?: string;
}

export function setup(overrides: Partial<AppDeps> = {}) {
  const db = openDb(':memory:');
  seedSchools(db);
  const clock = fakeClock();
  const replay = fakeReplay();
  const cases = [makeCase()];
  const app = createApp({
    db: nodeSql(db),
    cases,
    replay: replay.fn,
    now: clock.now,
    clientIp: (c) => c.req.header('x-test-ip') ?? '10.0.0.1',
    limits: { requestsPerMinute: 1_000_000, joinsPerMinute: 1_000_000 },
    ...overrides,
  });

  async function call(method: string, path: string, o: CallOpts = {}) {
    const headers: Record<string, string> = {};
    if (o.body !== undefined || o.rawBody !== undefined) headers['content-type'] = 'application/json';
    if (o.token) headers['x-player-token'] = o.token;
    if (o.teacher) headers['x-teacher-code'] = o.teacher;
    if (o.ip) headers['x-test-ip'] = o.ip;
    if (o.origin) headers.origin = o.origin;
    const res = await app.request(path, {
      method,
      headers,
      body: o.rawBody ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  async function join(nickname: string, classCode = 'TEST-A1') {
    const r = await call('POST', '/api/join', { body: { classCode, nickname } });
    if (r.status !== 200) throw new Error(`join failed: ${r.status} ${r.text}`);
    return r.json as { token: string; playerId: number; nickname: string; className: string; schoolName: string };
  }

  return { db, clock, replay, cases, app, call, join };
}

// A valid practice run for makeCase().
export function runBody(over: Record<string, unknown> = {}) {
  return {
    caseId: 'test-case',
    mode: 'realtime',
    seed: 12345,
    variantId: 'practice',
    actions: [
      { actionId: 'check', t: 1000 },
      { actionId: 'call', t: 2000 },
      // a set of 10 taps at 110 bpm takes about 5.5 s; it must fit the clock (integration step 1)
      { actionId: 'push', t: 7500, payload: { bpm: 110, count: 10 } },
    ],
    endT: 60_000,
    clientScore: 50,
    ...over,
  };
}

export const NICKS = [
  'Brave Falcon 27',
  'Calm Otter 31',
  'Kind Zebra 42',
  'Swift Eagle 15',
  'Wise Owl 50',
  'Happy Panda 23',
  'Steady Lion 64',
  'Clever Comet 77',
];
