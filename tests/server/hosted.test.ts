import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { forwardedClientIp, originalUrl, PATH_PARAM } from '../../server/hosted';
import { libsqlSql, nodeSql, type Sql } from '../../server/sql';
import { HOSTED_RUNS_PER_PLAYER, hostedApp, hostedDeps } from '../../server/vercel';
import { CSP, functionConfig, SECURITY_HEADERS, vercelConfig } from '../../tools/buildVercel';
import { checkDemoCodes, DEMO_CLASS, DEMO_SCHOOL, redactUrls, setupDemoDb } from '../../tools/setupDemoDb';

// Made-up codes in the demo's format. The real demo codes are random and never in git.
const CLASS_CODE = 'DEMO-ABCD-2345';
const TEACHER_CODE = 'WXYZ-6789-KMNP-QRST';

describe('hosted API: the URL the app sees', () => {
  it.each([
    ['/api/boards?scope=class', '/api/boards?scope=class'],
    [`/api?${PATH_PARAM}=boards&scope=class`, '/api/boards?scope=class'],
    [`/api?scope=class&${PATH_PARAM}=boards`, '/api/boards?scope=class'],
    [`/api/boards?${PATH_PARAM}=boards&scope=class`, '/api/boards?scope=class'],
    [`/api?${PATH_PARAM}=teacher/player/12`, '/api/teacher/player/12'],
    [`/api?${PATH_PARAM}=`, '/api'],
    ['/api/health', '/api/health'],
  ])('%s gives %s', (input, expected) => {
    expect(originalUrl(input)).toBe(expected);
  });
});

describe('hosted API: client address', () => {
  const app = new Hono();
  app.get('/', (c) => c.text(forwardedClientIp(c)));
  const ip = async (headers: Record<string, string>) => (await app.request('/', { headers })).text();

  it('uses the address Vercel sets, first x-real-ip, then the first x-forwarded-for entry', async () => {
    expect(await ip({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })).toBe('203.0.113.7');
    expect(await ip({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })).toBe('198.51.100.1');
    expect(await ip({})).toBe('unknown');
  });
});

describe('build:vercel output config', () => {
  it('the CSP allows only the app itself: no inline script or style, no framing', () => {
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*|http:/);
  });

  it('every answer gets the security headers and a noindex, before files and the API', () => {
    const { routes } = vercelConfig();
    expect(routes[0]).toEqual({ src: '^/(.*)$', headers: SECURITY_HEADERS, continue: true });
    expect(SECURITY_HEADERS['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    const fs = routes.findIndex((r) => 'handle' in r && r.handle === 'filesystem');
    const api = routes.findIndex((r) => 'dest' in r && String(r.dest).startsWith('/api?'));
    expect(fs).toBeGreaterThan(0);
    expect(api).toBeGreaterThan(fs);
    expect(routes[api]).toMatchObject({ src: '^/api(?:/(.*))?$', dest: `/api?${PATH_PARAM}=$1`, check: true });
  });

  it('the API function config names the bundle, a Node runtime and one region', () => {
    expect(functionConfig('fra1')).toEqual({
      runtime: 'nodejs26.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 10,
      regions: ['fra1'],
    });
  });
});

describe('setup-demo-db: the demo codes', () => {
  it('accepts long random codes', () => {
    expect(checkDemoCodes(CLASS_CODE, TEACHER_CODE)).toEqual([]);
  });

  it.each([
    ['missing codes', undefined, undefined],
    ['a short class code', 'AB12-CD', TEACHER_CODE],
    ['a short teacher code', CLASS_CODE, 'ABCD-EFGH-2345'],
    ['the seeded test codes', 'TEST-A1XYZ99', 'TEACH-A1-ABCDEFGHJKMN'],
    ['the same code twice', TEACHER_CODE, TEACHER_CODE],
    ['other signs', 'DEMO ABCD 2345', TEACHER_CODE],
  ])('refuses %s, and never repeats a code in the reasons', (_why, cls, teacher) => {
    const errors = checkDemoCodes(cls, teacher);
    expect(errors.length).toBeGreaterThan(0);
    for (const code of [cls, teacher]) if (code) expect(errors.join(' ')).not.toContain(code);
  });
});

// Both start empty, like a new Turso database: setup-demo-db must create the tables itself.
const engines: [string, () => Sql][] = [
  ['node:sqlite', () => nodeSql(new DatabaseSync(':memory:'))],
  ['libSQL', () => libsqlSql(createClient({ url: ':memory:' }))],
];

describe.each(engines)('setup-demo-db on %s', (_name, makeDb) => {
  it('creates the tables and one demo class; a second run with new codes updates it', async () => {
    const db = makeDb();
    expect(await setupDemoDb(db, CLASS_CODE, TEACHER_CODE)).toBe('created');
    expect(await setupDemoDb(db, 'DEMO-ZZZZ-9999', 'QQQQ-RRRR-SSSS-TTTT')).toBe('updated');
    expect(await db.all('SELECT s.name AS school, c.name AS cls, c.class_code AS code, c.teacher_code AS teacher, c.size_cap AS cap FROM classes c JOIN schools s ON s.id = c.school_id')).toEqual([
      { school: DEMO_SCHOOL, cls: DEMO_CLASS, code: 'DEMO-ZZZZ-9999', teacher: 'QQQQ-RRRR-SSSS-TTTT', cap: 40 },
    ]);
  });

  it('refuses weak codes before it touches the database', async () => {
    const db = makeDb();
    await expect(setupDemoDb(db, 'TEST-A1', 'TEACH-A1')).rejects.toThrow(/DEMO_CLASS_CODE/);
    expect(await db.get("SELECT name FROM sqlite_master WHERE name = 'classes'")).toBeUndefined();
  });
});

describe('the hosted app as Vercel builds it (server/vercel.ts)', () => {
  async function demo() {
    const client = createClient({ url: ':memory:' });
    await setupDemoDb(libsqlSql(client), CLASS_CODE, TEACHER_CODE);
    const app = hostedApp({ TURSO_DATABASE_URL: 'libsql://demo.invalid', TURSO_AUTH_TOKEN: 'not-a-real-token' }, () => client);
    const req = (path: string, init: RequestInit = {}) =>
      app.fetch(new Request(`https://demo.invalid${path}`, { ...init, headers: { 'x-real-ip': '203.0.113.9', ...init.headers } }));
    return { app, req, client };
  }

  it('joins the demo class with its code and opens the teacher view with the long code', async () => {
    const { req } = await demo();
    const nick = (await (await req('/api/nicknames')).json()).options[0] as string;
    const join = await req('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classCode: CLASS_CODE.toLowerCase(), nickname: nick }),
    });
    expect(join.status).toBe(200);
    expect(await join.json()).toMatchObject({ nickname: nick, className: DEMO_CLASS, schoolName: DEMO_SCHOOL });
    const teacher = await req('/api/teacher/class', { headers: { 'x-teacher-code': TEACHER_CODE } });
    expect(teacher.status).toBe(200);
    expect((await teacher.json()).players).toHaveLength(1);
  });

  it('refuses short teacher codes, even one a class holds, and answers no other origin', async () => {
    const { req, client } = await demo();
    await client.execute(
      "INSERT INTO classes (school_id, name, class_code, teacher_code, size_cap) VALUES (1, 'Old class', 'OLD-CLASS-1234', 'TEACH-A1', 40)",
    );
    expect((await req('/api/teacher/class', { headers: { 'x-teacher-code': 'TEACH-A1' } })).status).toBe(401);
    const r = await req('/api/health', { headers: { origin: 'http://localhost:5173' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('without a database setting, every call answers 503', async () => {
    const down = hostedApp({});
    expect((await down.fetch(new Request('https://demo.invalid/api/health'))).status).toBe(503);
  });
});

describe('setup-demo-db error messages', () => {
  it('replace any database address, so a build log never shows it', () => {
    const msg = 'fetch failed: libsql://demo-db.example.invalid and https://demo-db.example.invalid/v2/pipeline refused';
    expect(redactUrls(msg)).toBe('fetch failed: [database address] and [database address] refused');
  });
});

describe('demo run cap', () => {
  it('the hosted app stores at most 200 practice runs per player, 16-sign teacher codes, one origin', () => {
    const deps = hostedDeps({ TURSO_DATABASE_URL: 'libsql://demo.invalid' }, () => createClient({ url: ':memory:' }));
    expect(HOSTED_RUNS_PER_PLAYER).toBe(200);
    expect(deps).toMatchObject({ limits: { runsPerPlayer: 200 }, allowedOrigins: [], minTeacherCodeLength: 16 });
    expect(hostedDeps({})).toBeNull();
  });
});
