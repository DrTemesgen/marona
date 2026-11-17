import { describe, expect, it } from 'vitest';
import { NICKS, runBody, setup } from './helpers';

// Integration step 1: generous per IP (a whole school may share one), per player on player routes.
describe('rate limit (default limits)', () => {
  it('allows 60 joins a minute per IP, answers 429 after, and forgets after a minute', async () => {
    const { call, clock } = setup({ limits: {} });
    const join = (ip: string, nickname: string) =>
      call('POST', '/api/join', { ip, body: { classCode: 'TEST-A1', nickname } });
    for (let i = 0; i < 60; i++) {
      const r = await join('10.1.1.1', 'Not A Nickname'); // refused nickname, but still counted
      expect(r.status).toBe(400);
    }
    const blocked = await join('10.1.1.1', NICKS[0]);
    expect(blocked.status).toBe(429);
    expect(blocked.json).toEqual({ error: 'too many requests' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await join('10.2.2.2', NICKS[0])).status).toBe(200); // another IP has its own count
    clock.advance(60_000);
    expect((await join('10.1.1.1', NICKS[1])).status).toBe(200);
  });

  it('allows 600 requests a minute per IP on routes without a player token, then 429', async () => {
    const { call } = setup({ limits: {} });
    for (let i = 0; i < 600; i++) expect((await call('GET', '/api/nicknames', { ip: '10.3.3.3' })).status).toBe(200);
    expect((await call('GET', '/api/nicknames', { ip: '10.3.3.3' })).status).toBe(429);
    expect((await call('GET', '/api/health', { ip: '10.4.4.4' })).status).toBe(200);
  });

  it('limits player routes per player (300 a minute), not per IP, so a school can share one IP', async () => {
    const { call, join, clock } = setup({ limits: { requestsPerMinute: 100, joinsPerMinute: 1000 } }); // a low IP limit
    const a = await join(NICKS[0]);
    const b = await join(NICKS[1]);
    for (let i = 0; i < 300; i++)
      expect((await call('GET', '/api/boards?scope=class', { token: a.token, ip: '10.5.5.5' })).status).toBe(200);
    const blocked = await call('GET', '/api/boards?scope=class', { token: a.token, ip: '10.5.5.5' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Same IP, another player: still allowed. Unknown tokens count against the IP.
    expect((await call('GET', '/api/boards?scope=class', { token: b.token, ip: '10.5.5.5' })).status).toBe(200);
    expect((await call('GET', '/api/boards?scope=class', { token: 'B'.repeat(43), ip: '10.5.5.5' })).status).toBe(401);
    clock.advance(60_000);
    expect((await call('GET', '/api/boards?scope=class', { token: a.token, ip: '10.5.5.5' })).status).toBe(200);
  });

  it('counts unknown player tokens against the IP, so guessing tokens is limited', async () => {
    const { call } = setup({ limits: { requestsPerMinute: 5 } });
    for (let i = 0; i < 5; i++)
      expect((await call('GET', '/api/boards?scope=class', { token: 'C'.repeat(43), ip: '10.6.6.6' })).status).toBe(401);
    expect((await call('GET', '/api/boards?scope=class', { token: 'C'.repeat(43), ip: '10.6.6.6' })).status).toBe(429);
  });
});

describe('CORS', () => {
  it('allows only the two dev origins', async () => {
    const { call } = setup();
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) {
      const r = await call('GET', '/api/health', { origin });
      expect(r.headers.get('access-control-allow-origin')).toBe(origin);
    }
    const evil = await call('GET', '/api/health', { origin: 'http://attacker.invalid' });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a preflight with the allowed headers', async () => {
    const { app } = setup();
    const res = await app.request('/api/runs', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-player-token',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('x-player-token');
  });
});

describe('errors and headers', () => {
  it('unknown routes give a JSON 404', async () => {
    const { call } = setup();
    const r = await call('GET', '/api/nothing-here');
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not found' });
  });

  it('an internal error gives a generic 500 with no details or stack trace', async () => {
    const logs: string[] = [];
    const s = setup({ log: (m) => logs.push(m) });
    const { token } = await s.join(NICKS[0]);
    s.db.exec('DROP TABLE runs');
    const r = await s.call('POST', '/api/runs', { token, body: runBody() });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: 'server error' });
    expect(r.text).not.toMatch(/runs|sqlite|stack|at \w+ \(/i);
    expect(logs.some((m) => m.startsWith('server error'))).toBe(true);
    expect(logs.join('\n')).not.toContain(token); // tokens never reach the log
  });

  it('API answers are not cached and carry basic security headers', async () => {
    const { call } = setup();
    const r = await call('GET', '/api/health');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
