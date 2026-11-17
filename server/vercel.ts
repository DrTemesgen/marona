// The API on Vercel (the online demo): one function answers every /api route. The database is
// Turso (libSQL over HTTPS); tools/setupDemoDb.ts creates its tables at build time. Bundled into
// one file by tools/buildVercel.ts. Runs on a PC use server/index.ts instead.
// Settings come from Vercel's environment settings, never from the code:
//   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN (set by the Turso integration).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createClient, type Client, type Config } from '@libsql/client/web';
import { Hono } from 'hono';
import { loadStaticCases } from '../src/content/loadStatic';
import { replay } from '../src/engine/engine';
import { createApp, type AppDeps } from './app';
import { forwardedClientIp, originalUrl } from './hosted';
import { libsqlSql } from './sql';

// Teacher codes on the demo have at least this many letters and digits (tools/newCodes.ts makes 16).
export const HOSTED_MIN_TEACHER_CODE = 16;
// A demo needs far fewer stored practice runs per player than a season (it keeps the free
// database small).
export const HOSTED_RUNS_PER_PLAYER = 200;

type FetchApp = { fetch: (request: Request) => Response | Promise<Response> };
type Env = Readonly<Record<string, string | undefined>>;

// The settings of the hosted app; null without a database setting.
export function hostedDeps(env: Env, makeClient: (config: Config) => Client = createClient): AppDeps | null {
  const url = env.TURSO_DATABASE_URL;
  if (!url) return null;
  return {
    db: libsqlSql(makeClient({ url, authToken: env.TURSO_AUTH_TOKEN })),
    cases: loadStaticCases(),
    replay,
    now: Date.now,
    clientIp: forwardedClientIp,
    limits: { runsPerPlayer: HOSTED_RUNS_PER_PLAYER },
    allowedOrigins: [], // the app and the API share one origin
    minTeacherCodeLength: HOSTED_MIN_TEACHER_CODE,
    log: (message) => console.warn(`[server] ${message}`),
  };
}

export function hostedApp(env: Env, makeClient?: (config: Config) => Client): FetchApp {
  const deps = hostedDeps(env, makeClient);
  if (!deps) {
    console.error('[server] TURSO_DATABASE_URL is not set; every API call answers 503');
    const down = new Hono();
    down.all('*', (c) => c.json({ error: 'server not configured' }, 503));
    return down;
  }
  return createApp(deps);
}

let listener: ReturnType<typeof getRequestListener> | undefined;

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  listener ??= getRequestListener(hostedApp(process.env).fetch);
  req.url = originalUrl(req.url ?? '/');
  return listener(req, res);
}
