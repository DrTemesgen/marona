// Leaderboard server: joins, practice runs, boards, the final and the teacher view.
// Integrity: the server replays every game from its actions and keeps only its own score.
// Privacy: players are word-pair nicknames; no real names, phone numbers or e-mail addresses.
// Every dependency is injected so tests can use a fake replay, a fake clock and ':memory:'.
// The database is reached through server/sql.ts (node:sqlite on a PC, libSQL on the online
// demo). Writes that must not race are single statements: several server instances may run.
import { createHash, randomBytes } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { z } from 'zod';
import type { BoardEntry, CaseFile, GameConfig, PlayerAction, ScoreReport, Variant } from '../src/shared/contract';
import type { ClassRow, FinalRow, FinalStartRow, PlayerRow } from './db';
import { isValidNickname, nicknameCandidates } from './nicknames';
import { checkLog } from './plausibility';
import { createRateLimiter } from './rateLimit';
import * as S from './schemas';
import type { Sql } from './sql';

// Same shape as replay() in src/engine/engine.ts (its GameState is not needed here).
export type ReplayFn = (cfg: GameConfig, actions: PlayerAction[], endT: number) => { report: ScoreReport };

export interface Limits {
  requestsPerMinute: number; // per IP: every route without a player token, and refused tokens
  joinsPerMinute: number; // POST /api/join, per IP
  playerRequestsPerMinute: number; // per player, on the routes that need x-player-token
  teacherFailuresPer10Min: number; // per IP: wrong teacher codes before a 10-minute stop
  runsPerPlayerPerHour: number; // practice runs stored per player in the last hour
  runsPerPlayer: number; // practice runs stored per player in all
}

export interface AppDeps {
  db: Sql;
  cases: CaseFile[];
  replay: ReplayFn;
  now: () => number;
  randomSeed?: () => number; // 32-bit unsigned seed for final games; default node:crypto
  newToken?: () => string; // player token; default 32 random bytes, base64url
  randomIndex?: (n: number) => number; // integer in [0, n) for nickname options; default node:crypto
  clientIp?: (c: Context) => string; // default: socket address from @hono/node-server
  limits?: Partial<Limits>;
  // Origins whose pages may call the API from a browser (CORS). Default: the two dev origins.
  // The online demo serves the app and the API from one origin and passes [].
  allowedOrigins?: readonly string[];
  // Teacher codes with fewer letters and digits are refused before any lookup. Default 0 (the
  // seeded test codes on a PC are short); the online demo passes 16.
  minTeacherCodeLength?: number;
  log?: (message: string) => void; // never receives tokens, codes or request bodies
}

// Generous per IP, because a whole school may share one IP address.
export const DEFAULT_LIMITS: Limits = {
  requestsPerMinute: 600,
  joinsPerMinute: 60,
  playerRequestsPerMinute: 300,
  teacherFailuresPer10Min: 20,
  runsPerPlayerPerHour: 60,
  runsPerPlayer: 1000,
};
export const BODY_LIMIT_BYTES = 256 * 1024;
export const SUBMIT_GRACE_MS = 60_000; // a final game may be submitted up to 60 s after maxDurationMs
export const ALLOWED_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];
export const FINAL_MODE = 'realtime' as const;
// A final submit scores 0 when its endT is longer than the time the server saw by more than this
// (a claimed game the server cannot have seen).
export const FINAL_CLOCK_AHEAD_MS = 5_000;
// When endT is shorter than the server time by more than this (a slow retry, a 429 wait or a
// reload), the replay score is kept without its time points. Ties use the server time anyway.
export const FINAL_CLOCK_TOLERANCE_MS = 30_000;
// Results of a closed final are kept this long per server instance (they are public and the
// query reads every start of the final).
export const RESULTS_CACHE_MS = 60_000;
export const TEACHER_LOCK_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;
// Routes behind requirePlayer: limited per player there, not per IP here.
const PLAYER_ROUTES: ReadonlySet<string> = new Set([
  '/api/runs',
  '/api/boards',
  '/api/final/current',
  '/api/final/start',
  '/api/final/submit',
]);
const WINDOW_MS = 60_000;
const MAX_ROWS = 1000;
const NICKNAME_OPTIONS = 6;
const NICKNAME_CANDIDATES = 12; // checked in one query; collisions are rare (over 300,000 nicknames)

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function defaultClientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

type Env = { Variables: { player: PlayerRow; cls: ClassRow } };

// Best realtime practice run per player, ranked: score desc, then shorter duration, then earlier
// run. Guided runs are stored and count as attempts, but are not ranked.
const boardSql = (filter: 'c.id' | 'c.school_id') => `
  WITH scoped AS (
    SELECT p.id AS player_id, p.nickname FROM players p JOIN classes c ON c.id = p.class_id
    WHERE p.removed = 0 AND ${filter} = ?
  ),
  best AS (
    SELECT r.player_id, r.server_score, r.duration_ms, r.created_at, r.id,
      ROW_NUMBER() OVER (PARTITION BY r.player_id
        ORDER BY r.server_score DESC, r.duration_ms ASC, r.created_at ASC, r.id ASC) AS rn
    FROM runs r JOIN scoped s ON s.player_id = r.player_id
    WHERE r.mode = 'realtime'
  )
  SELECT s.nickname AS nickname, b.server_score AS score, b.duration_ms AS durationMs
  FROM best b JOIN scoped s ON s.player_id = b.player_id
  WHERE b.rn = 1
  ORDER BY b.server_score DESC, b.duration_ms ASC, b.created_at ASC, b.id ASC
  LIMIT ${MAX_ROWS}`;

const SQL = {
  classByCode: 'SELECT * FROM classes WHERE class_code = ?',
  classByTeacherCode: 'SELECT * FROM classes WHERE teacher_code = ?',
  schoolName: 'SELECT name FROM schools WHERE id = ?',
  activePlayers: 'SELECT COUNT(*) AS n FROM players WHERE class_id = ? AND removed = 0',
  nicknameTaken: 'SELECT 1 AS x FROM players WHERE nickname = ?',
  takenAmong: (n: number) => `SELECT nickname FROM players WHERE nickname IN (${Array(n).fill('?').join(', ')})`,
  // One statement: the cap and the unique nickname hold even when two phones join at once.
  insertPlayerIfRoom: `INSERT INTO players (class_id, nickname, token_hash, created_at, removed)
    SELECT ?, ?, ?, ?, 0
    WHERE (SELECT COUNT(*) FROM players WHERE class_id = ? AND removed = 0) < ?
    ON CONFLICT DO NOTHING`,
  playerByToken: `SELECT p.id, p.class_id, p.nickname, c.school_id FROM players p JOIN classes c ON c.id = p.class_id
    WHERE p.token_hash = ? AND p.removed = 0`,
  runCounts: `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END), 0) AS recent
    FROM runs WHERE player_id = ?`,
  // One statement: the run caps hold even when one player sends many runs at once.
  insertRunIfRoom: `INSERT INTO runs (player_id, case_id, mode, seed, variant_id, actions_json, end_t, server_score,
    duration_ms, score_mismatch, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM runs WHERE player_id = ?) < ?
      AND (SELECT COUNT(*) FROM runs WHERE player_id = ? AND created_at > ?) < ?`,
  boardClass: boardSql('c.id'),
  boardSchool: boardSql('c.school_id'),
  finalById: 'SELECT * FROM finals WHERE id = ?',
  finalOpenAt: 'SELECT * FROM finals WHERE opens_at <= ? AND closes_at > ? ORDER BY opens_at ASC, id ASC LIMIT 1',
  finalNextAfter: 'SELECT * FROM finals WHERE opens_at > ? ORDER BY opens_at ASC, id ASC LIMIT 1',
  startGet: 'SELECT * FROM final_starts WHERE final_id = ? AND player_id = ? AND case_id = ?',
  startInsert: `INSERT INTO final_starts (final_id, player_id, case_id, seed, variant_id, server_start_ms)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  finalRunExists: 'SELECT 1 AS x FROM final_runs WHERE final_id = ? AND player_id = ? AND case_id = ?',
  finalRunInsert: `INSERT INTO final_runs (final_id, player_id, case_id, actions_json, end_t, server_score,
    server_duration_ms, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  resultRows: `SELECT p.id AS playerId, p.nickname AS nickname, s.name AS schoolName, fs.case_id AS caseId,
      fr.server_score AS score, fr.server_duration_ms AS duration, fr.submitted_at AS submittedAt
    FROM final_starts fs
    JOIN players p ON p.id = fs.player_id
    JOIN classes c ON c.id = p.class_id
    JOIN schools s ON s.id = c.school_id
    LEFT JOIN final_runs fr
      ON fr.final_id = fs.final_id AND fr.player_id = fs.player_id AND fr.case_id = fs.case_id
    WHERE fs.final_id = ? AND p.removed = 0
    LIMIT 100000`,
  teacherPlayers: `SELECT p.id AS playerId, p.nickname AS nickname,
      (SELECT COUNT(*) FROM runs r WHERE r.player_id = p.id)
        + (SELECT COUNT(*) FROM final_runs fr WHERE fr.player_id = p.id) AS attempts,
      (SELECT MAX(r.server_score) FROM runs r WHERE r.player_id = p.id) AS best
    FROM players p WHERE p.class_id = ? AND p.removed = 0
    ORDER BY p.nickname ASC LIMIT ${MAX_ROWS}`,
  removePlayer: 'UPDATE players SET removed = 1 WHERE id = ? AND class_id = ? AND removed = 0',
} as const;

interface ResultRow {
  playerId: number;
  nickname: string;
  schoolName: string;
  caseId: string;
  score: number | null;
  duration: number | null;
  submittedAt: number | null;
}

export function createApp(deps: AppDeps) {
  const { db, now } = deps;
  const log = deps.log ?? (() => {});
  const limits: Limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const limiter = createRateLimiter(now);
  const randomSeed = deps.randomSeed ?? (() => randomBytes(4).readUInt32BE(0));
  const newToken = deps.newToken ?? (() => randomBytes(32).toString('base64url'));
  const clientIp = deps.clientIp ?? defaultClientIp;
  const allowedOrigins = deps.allowedOrigins ?? ALLOWED_ORIGINS;
  const minTeacherCodeLength = deps.minTeacherCodeLength ?? 0;
  const caseById = new Map(deps.cases.map((c) => [c.id, c]));
  const resultsCache = new Map<number, { until: number; body: unknown }>();

  const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 500, error: string) => c.json({ error }, status);

  async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return null;
    }
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  // The variant a final plays for one case: finals.variant_id when that case has a finalOnly
  // variant with that id, otherwise (and normally, with variant_id NULL) the case's first
  // finalOnly variant. undefined when the case has none.
  function finalVariantOf(f: FinalRow, caseFile: CaseFile): Variant | undefined {
    const named = f.variant_id ? caseFile.variants.find((v) => v.finalOnly && v.id === f.variant_id) : undefined;
    return named ?? caseFile.variants.find((v) => v.finalOnly);
  }

  function caseIdsOf(f: FinalRow): string[] {
    let raw: unknown;
    try {
      raw = JSON.parse(f.case_ids_json);
    } catch {
      throw new Error(`final ${f.id} has unreadable case ids`);
    }
    const parsed = S.CaseIdList.safeParse(raw);
    if (!parsed.success) throw new Error(`final ${f.id} has invalid case ids`);
    return parsed.data;
  }

  // Replays with the injected engine. null means the log is not a valid game.
  function serverReport(cfg: GameConfig, actions: PlayerAction[], endT: number): ScoreReport | null {
    let report: ScoreReport;
    try {
      report = deps.replay(cfg, actions, endT).report;
    } catch (e) {
      log(`replay refused a ${cfg.caseFile.id} log: ${e instanceof Error ? e.message : 'unknown error'}`);
      return null;
    }
    const ok =
      report !== null &&
      typeof report === 'object' &&
      Number.isFinite(report.total) &&
      report.total >= 0 &&
      report.total <= 100 &&
      Number.isFinite(report.durationMs) &&
      report.durationMs >= 0;
    if (!ok) {
      log(`replay returned an unusable report for ${cfg.caseFile.id}`);
      return null;
    }
    return report;
  }

  const tooMany = (c: Context, wait: number) => {
    c.header('Retry-After', String(wait));
    return c.json({ error: 'too many requests' }, 429);
  };

  // Rate limit: a known player per player; a missing or unknown token counts against the IP.
  const requirePlayer = createMiddleware<Env>(async (c, next) => {
    const token = S.PlayerToken.safeParse(c.req.header('x-player-token'));
    const player = token.success ? await db.get<PlayerRow>(SQL.playerByToken, [hashToken(token.data)]) : undefined;
    if (!player) {
      const wait = limiter.hit(`all:${clientIp(c)}`, limits.requestsPerMinute, WINDOW_MS);
      if (wait) return tooMany(c, wait);
      return c.json({ error: 'unknown player' }, 401);
    }
    const wait = limiter.hit(`player:${player.id}`, limits.playerRequestsPerMinute, WINDOW_MS);
    if (wait) return tooMany(c, wait);
    c.set('player', player);
    await next();
  });

  // A teacher code. After too many wrong codes from one IP, that IP waits 10 minutes (per server
  // instance; the length of the codes is what makes guessing hopeless).
  const requireTeacher = createMiddleware<Env>(async (c, next) => {
    const failKey = `teacher-fail:${clientIp(c)}`;
    const locked = limiter.check(failKey, limits.teacherFailuresPer10Min);
    if (locked) return tooMany(c, locked);
    const code = S.TeacherCode.safeParse(c.req.header('x-teacher-code'));
    const longEnough = code.success && code.data.replace(/-/g, '').length >= minTeacherCodeLength;
    const cls = longEnough ? await db.get<ClassRow>(SQL.classByTeacherCode, [code.data]) : undefined;
    if (!cls) {
      limiter.hit(failKey, limits.teacherFailuresPer10Min, TEACHER_LOCK_MS);
      return c.json({ error: 'unknown teacher code' }, 401);
    }
    c.set('cls', cls);
    await next();
  });

  const app = new Hono<Env>();

  app.use('/api/*', secureHeaders());
  if (allowedOrigins.length > 0)
    app.use(
      '/api/*',
      cors({
        origin: [...allowedOrigins],
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['content-type', 'x-player-token', 'x-teacher-code'],
        maxAge: 600,
      }),
    );
  // Per-IP limit for every route that is not a player route (those are limited in requirePlayer).
  app.use('/api/*', async (c, next) => {
    if (PLAYER_ROUTES.has(c.req.path) && c.req.method !== 'OPTIONS') return next();
    const ip = clientIp(c);
    let wait = limiter.hit(`all:${ip}`, limits.requestsPerMinute, WINDOW_MS);
    if (!wait && c.req.method === 'POST' && c.req.path === '/api/join')
      wait = limiter.hit(`join:${ip}`, limits.joinsPerMinute, WINDOW_MS);
    if (wait) return tooMany(c, wait);
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: (c) => c.json({ error: 'request too large' }, 413) }),
  );
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/nicknames', async (c) => {
    const candidates = nicknameCandidates(NICKNAME_CANDIDATES, deps.randomIndex);
    const taken = new Set(
      (await db.all<{ nickname: string }>(SQL.takenAmong(candidates.length), candidates)).map((r) => r.nickname),
    );
    return c.json({ options: candidates.filter((n) => !taken.has(n)).slice(0, NICKNAME_OPTIONS) });
  });

  app.post('/api/join', async (c) => {
    const body = await readBody(c, S.JoinBody);
    if (!body) return fail(c, 400, 'invalid request');
    if (!isValidNickname(body.nickname)) return fail(c, 400, 'nickname not allowed');
    const cls = await db.get<ClassRow>(SQL.classByCode, [body.classCode]);
    if (!cls) return fail(c, 404, 'unknown class code');
    const token = newToken();
    const res = await db.run(SQL.insertPlayerIfRoom, [
      cls.id,
      body.nickname,
      hashToken(token),
      now(),
      cls.id,
      cls.size_cap,
    ]);
    if (res.changes !== 1) {
      // Nothing was written: the class is full, or the nickname is taken (perhaps a moment ago).
      const active = (await db.get<{ n: number }>(SQL.activePlayers, [cls.id]))?.n ?? 0;
      if (active >= cls.size_cap) return fail(c, 409, 'class is full');
      if (await db.get(SQL.nicknameTaken, [body.nickname])) return fail(c, 409, 'nickname taken');
      log('join wrote nothing for a free nickname in a class with room');
      return fail(c, 500, 'server error');
    }
    const school = await db.get<{ name: string }>(SQL.schoolName, [cls.school_id]);
    return c.json({
      token,
      playerId: res.lastInsertRowid,
      nickname: body.nickname,
      className: cls.name,
      schoolName: school?.name ?? '',
    });
  });

  app.post('/api/runs', requirePlayer, async (c) => {
    const body = await readBody(c, S.RunBody);
    if (!body) return fail(c, 400, 'invalid request');
    const caseFile = caseById.get(body.caseId);
    if (!caseFile) return fail(c, 400, 'unknown case');
    const variant = caseFile.variants.find((v) => v.id === body.variantId);
    if (!variant || variant.finalOnly) return fail(c, 400, 'unknown variant');
    const player = c.get('player');
    // A cap on stored runs keeps one player (or a script) from filling the database. Checked here
    // to save the replay, and again by the insert itself, which is exact.
    const tooManyRuns = () => {
      log('practice run refused: run limit reached');
      return c.json({ serverScore: 0, accepted: false, reason: 'too many runs' });
    };
    const hourAgo = now() - HOUR_MS;
    const counts = await db.get<{ total: number; recent: number }>(SQL.runCounts, [hourAgo, player.id]);
    if ((counts?.recent ?? 0) >= limits.runsPerPlayerPerHour || (counts?.total ?? 0) >= limits.runsPerPlayer)
      return tooManyRuns();
    const actions: PlayerAction[] = body.actions;
    const actionsJson = JSON.stringify(actions); // stored as validated, before the engine sees it
    const check = checkLog(caseFile, actions, body.endT, body.mode);
    if (!check.ok) {
      log(`practice run refused (${check.kind}): ${check.detail}`);
      const reason = check.kind === 'invalid' ? 'invalid game log' : 'implausible game log';
      return c.json({ serverScore: 0, accepted: false, reason });
    }
    const report = serverReport(
      { caseFile, seed: body.seed, mode: body.mode, variantId: variant.id },
      actions,
      body.endT,
    );
    if (!report) return c.json({ serverScore: 0, accepted: false, reason: 'invalid game log' });
    // The client score is never trusted; a difference is only recorded.
    const mismatch = body.clientScore === report.total ? 0 : 1;
    const ins = await db.run(SQL.insertRunIfRoom, [
      player.id,
      caseFile.id,
      body.mode,
      body.seed,
      variant.id,
      actionsJson,
      body.endT,
      report.total,
      report.durationMs,
      mismatch,
      now(),
      player.id,
      limits.runsPerPlayer,
      player.id,
      hourAgo,
      limits.runsPerPlayerPerHour,
    ]);
    if (ins.changes !== 1) return tooManyRuns();
    return c.json({ serverScore: report.total, accepted: true });
  });

  app.get('/api/boards', requirePlayer, async (c) => {
    const parsed = S.BoardsQuery.safeParse({ scope: c.req.query('scope') });
    if (!parsed.success) return fail(c, 400, 'invalid request');
    const { scope } = parsed.data;
    const player = c.get('player');
    const rows =
      scope === 'class'
        ? await db.all<Omit<BoardEntry, 'rank'>>(SQL.boardClass, [player.class_id])
        : await db.all<Omit<BoardEntry, 'rank'>>(SQL.boardSchool, [player.school_id]);
    const entries: BoardEntry[] = rows.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      score: r.score,
      durationMs: r.durationMs,
    }));
    return c.json({ scope, entries });
  });

  app.get('/api/final/current', requirePlayer, async (c) => {
    const t = now();
    const f = (await db.get<FinalRow>(SQL.finalOpenAt, [t, t])) ?? (await db.get<FinalRow>(SQL.finalNextAfter, [t]));
    if (!f) return c.json({ finalId: null });
    return c.json({
      finalId: f.id,
      opensAt: f.opens_at,
      closesAt: f.closes_at,
      open: f.opens_at <= t && t < f.closes_at,
      caseIds: caseIdsOf(f),
    });
  });

  app.post('/api/final/start', requirePlayer, async (c) => {
    const body = await readBody(c, S.FinalStartBody);
    if (!body) return fail(c, 400, 'invalid request');
    const f = await db.get<FinalRow>(SQL.finalById, [body.finalId]);
    if (!f) return fail(c, 404, 'unknown final');
    const t = now();
    if (!(f.opens_at <= t && t < f.closes_at)) return fail(c, 403, 'final not open');
    if (!caseIdsOf(f).includes(body.caseId)) return fail(c, 400, 'case not in this final');
    const caseFile = caseById.get(body.caseId);
    const variant = caseFile ? finalVariantOf(f, caseFile) : undefined;
    if (!caseFile || !variant) {
      log(`final ${f.id} is misconfigured for case ${body.caseId}`);
      return fail(c, 500, 'server error');
    }
    const player = c.get('player');
    let existing = await db.get<FinalStartRow>(SQL.startGet, [f.id, player.id, body.caseId]);
    if (!existing) {
      const seed = randomSeed() >>> 0;
      const ins = await db.run(SQL.startInsert, [f.id, player.id, body.caseId, seed, variant.id, t]);
      if (ins.changes === 1) return c.json({ seed, variantId: variant.id, variant, serverStartMs: t, elapsedMs: 0 });
      // A second request from the same player wrote the start first: answer with that one.
      existing = await db.get<FinalStartRow>(SQL.startGet, [f.id, player.id, body.caseId]);
      if (!existing) {
        log(`final ${f.id}: a start was neither written nor found`);
        return fail(c, 500, 'server error');
      }
    }
    // One start per player and case. Asking again returns the same seed and start time, so a
    // lost response does not lock a student out, and the clock keeps running from the first start.
    if (await db.get(SQL.finalRunExists, [f.id, player.id, body.caseId])) return fail(c, 409, 'already submitted');
    if (t >= existing.server_start_ms + caseFile.maxDurationMs + SUBMIT_GRACE_MS) return fail(c, 409, 'time is up');
    const stored = caseFile.variants.find((v) => v.id === existing.variant_id);
    if (!stored) {
      log(`final ${f.id}: the stored variant is no longer in case ${body.caseId}`);
      return fail(c, 500, 'server error');
    }
    return c.json({
      seed: existing.seed,
      variantId: stored.id,
      variant: stored,
      serverStartMs: existing.server_start_ms,
      // After a reload the app starts a fresh game at this clock time.
      elapsedMs: t - existing.server_start_ms,
    });
  });

  app.post('/api/final/submit', requirePlayer, async (c) => {
    const body = await readBody(c, S.FinalSubmitBody);
    if (!body) return fail(c, 400, 'invalid request');
    const f = await db.get<FinalRow>(SQL.finalById, [body.finalId]);
    if (!f) return fail(c, 404, 'unknown final');
    const player = c.get('player');
    const start = await db.get<FinalStartRow>(SQL.startGet, [f.id, player.id, body.caseId]);
    if (!start) return fail(c, 409, 'not started');
    const t = now();
    if (!(f.opens_at <= t && t < f.closes_at)) return fail(c, 403, 'final closed');
    const caseFile = caseById.get(body.caseId);
    if (!caseFile) {
      log(`final ${f.id}: case ${body.caseId} is not loaded`);
      return fail(c, 500, 'server error');
    }
    if (t >= start.server_start_ms + caseFile.maxDurationMs + SUBMIT_GRACE_MS) return fail(c, 403, 'too late');
    if (await db.get(SQL.finalRunExists, [f.id, player.id, body.caseId])) return fail(c, 409, 'already submitted');
    const actions: PlayerAction[] = body.actions;
    const actionsJson = JSON.stringify(actions);
    // A log that fails the checks or the replay scores 0. It is still the one submission for
    // this start, so a student cannot probe the server with several logs.
    let score = 0;
    // A claimed game time may not be longer than the time the server saw between start and submit.
    // A much shorter one (slow retry, 429 wait, reload) keeps the score without its time points.
    const serverElapsed = t - start.server_start_ms;
    const behind = body.endT < serverElapsed - FINAL_CLOCK_TOLERANCE_MS;
    const check: ReturnType<typeof checkLog> =
      body.endT > serverElapsed + FINAL_CLOCK_AHEAD_MS
        ? { ok: false, kind: 'implausible', detail: 'endT is longer than the time the server saw' }
        : checkLog(caseFile, actions, body.endT, FINAL_MODE);
    if (check.ok) {
      const report = serverReport(
        { caseFile, seed: start.seed, mode: FINAL_MODE, variantId: start.variant_id },
        actions,
        body.endT,
      );
      if (report) {
        const timePoints = Number.isFinite(report.timePoints) ? Math.max(0, report.timePoints) : 0;
        score = behind ? Math.max(0, report.total - timePoints) : report.total;
      }
    } else {
      log(`final run scored 0 (${check.kind}): ${check.detail}`);
    }
    const ins = await db.run(SQL.finalRunInsert, [
      f.id,
      player.id,
      body.caseId,
      actionsJson,
      body.endT,
      score,
      t - start.server_start_ms,
      t,
    ]);
    // A second submit that raced this one and lost keeps the first one: one submission per start.
    if (ins.changes !== 1) return fail(c, 409, 'already submitted');
    return c.json({ received: true }); // no score until the window closes citywide
  });

  app.get('/api/final/results', async (c) => {
    const parsed = S.ResultsQuery.safeParse({ finalId: c.req.query('finalId') });
    if (!parsed.success) return fail(c, 400, 'invalid request');
    const f = await db.get<FinalRow>(SQL.finalById, [parsed.data.finalId]);
    if (!f) return fail(c, 404, 'unknown final');
    if (now() < f.closes_at) return c.json({ error: 'window open' }, 403);
    const cached = resultsCache.get(f.id);
    if (cached && now() < cached.until) return c.json(cached.body);
    const caseIds = caseIdsOf(f);

    const byPlayer = new Map<number, { nickname: string; schoolName: string; cases: Map<string, ResultRow> }>();
    for (const r of await db.all<ResultRow>(SQL.resultRows, [f.id])) {
      let p = byPlayer.get(r.playerId);
      if (!p) {
        p = { nickname: r.nickname, schoolName: r.schoolName, cases: new Map() };
        byPlayer.set(r.playerId, p);
      }
      p.cases.set(r.caseId, r);
    }
    // Total score over the final's cases (a missing case counts 0). For ties, a missing case
    // counts as the longest allowed time, so skipping a case never wins a tie.
    const totals = [...byPlayer.entries()].map(([playerId, p]) => {
      let score = 0;
      let durationMs = 0;
      let lastSubmission = Number.NEGATIVE_INFINITY;
      for (const id of caseIds) {
        const r = p.cases.get(id);
        if (r && r.score !== null && r.duration !== null && r.submittedAt !== null) {
          score += r.score;
          durationMs += r.duration;
          lastSubmission = Math.max(lastSubmission, r.submittedAt);
        } else {
          durationMs += (caseById.get(id)?.maxDurationMs ?? 0) + SUBMIT_GRACE_MS;
        }
      }
      if (lastSubmission === Number.NEGATIVE_INFINITY) lastSubmission = Number.POSITIVE_INFINITY;
      return { playerId, nickname: p.nickname, schoolName: p.schoolName, score, durationMs, lastSubmission };
    });
    totals.sort(
      (a, b) =>
        b.score - a.score ||
        a.durationMs - b.durationMs ||
        (a.lastSubmission === b.lastSubmission ? 0 : a.lastSubmission < b.lastSubmission ? -1 : 1) ||
        a.playerId - b.playerId,
    );
    const city: BoardEntry[] = [];
    const schools = new Map<string, BoardEntry[]>();
    for (const t of totals) {
      const entry = { nickname: t.nickname, score: t.score, durationMs: t.durationMs };
      city.push({ rank: city.length + 1, ...entry });
      const list = schools.get(t.schoolName) ?? [];
      list.push({ rank: list.length + 1, ...entry });
      schools.set(t.schoolName, list);
    }
    const body = { city, bySchool: Object.fromEntries(schools) };
    if (resultsCache.size >= 100) resultsCache.clear();
    resultsCache.set(f.id, { until: now() + RESULTS_CACHE_MS, body });
    return c.json(body);
  });

  app.get('/api/teacher/class', requireTeacher, async (c) => {
    const cls = c.get('cls');
    const players = await db.all<{ playerId: number; nickname: string; attempts: number; best: number | null }>(
      SQL.teacherPlayers,
      [cls.id],
    );
    return c.json({ className: cls.name, players });
  });

  app.delete('/api/teacher/player/:playerId', requireTeacher, async (c) => {
    const id = S.PlayerIdParam.safeParse(c.req.param('playerId'));
    if (!id.success) return fail(c, 400, 'invalid request');
    const res = await db.run(SQL.removePlayer, [id.data, c.get('cls').id]);
    if (res.changes === 0) return fail(c, 404, 'unknown player');
    return c.json({ removed: true });
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((err, c) => {
    log(`server error: ${err instanceof Error ? err.message : 'unknown error'}`);
    return c.json({ error: 'server error' }, 500);
  });

  return app;
}
