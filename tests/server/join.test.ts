import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ADJECTIVES, NOUNS, NUMBERS, isValidNickname, nicknameOptions } from '../../server/nicknames';
import { NICKS, setup } from './helpers';

describe('health and nickname options', () => {
  it('GET /api/health answers ok', async () => {
    const { call } = setup();
    const r = await call('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
  });

  it('GET /api/nicknames gives a fresh random set on each call', async () => {
    const { call } = setup();
    const sets = new Set<string>();
    for (let i = 0; i < 5; i++) sets.add(JSON.stringify((await call('GET', '/api/nicknames')).json.options));
    expect(sets.size).toBe(5);
  });

  it('GET /api/nicknames offers six distinct word-pair nicknames', async () => {
    const { call } = setup();
    const r = await call('GET', '/api/nicknames');
    expect(r.status).toBe(200);
    expect(r.json.options).toHaveLength(6);
    expect(new Set(r.json.options).size).toBe(6);
    for (const n of r.json.options) expect(isValidNickname(n)).toBe(true);
  });

  it('never offers a nickname that is already taken', () => {
    const taken = new Set(['Brave Falcon 27']);
    // A rigged random source that would produce the taken nickname first.
    const seq = [ADJECTIVES.indexOf('Brave'), NOUNS.indexOf('Falcon'), NUMBERS.indexOf(27)];
    let i = 0;
    const rand = (n: number) => (i < seq.length ? seq[i++] : (i++ * 7) % n);
    const opts = nicknameOptions(6, (n) => taken.has(n), rand);
    expect(opts).not.toContain('Brave Falcon 27');
    expect(opts.length).toBeGreaterThan(0);
  });

  it('word lists are about 60 words each, single capitalised words, no duplicates', () => {
    for (const list of [ADJECTIVES, NOUNS]) {
      expect(list.length).toBeGreaterThanOrEqual(55);
      expect(new Set(list).size).toBe(list.length);
      for (const w of list) expect(w).toMatch(/^[A-Z][a-z]+$/);
    }
    expect(NUMBERS).not.toContain(69);
    expect(NUMBERS).not.toContain(88);
  });
});

describe('POST /api/join', () => {
  it('joins with a listed nickname and returns a token; only its SHA-256 is stored', async () => {
    const { call, db } = setup();
    const r = await call('POST', '/api/join', { body: { classCode: 'TEST-A1', nickname: 'Brave Falcon 27' } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ nickname: 'Brave Falcon 27', className: 'Class A1', schoolName: 'Test School A' });
    expect(typeof r.json.playerId).toBe('number');
    expect(r.json.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(r.json.playerId) as Record<string, unknown>;
    expect(row.token_hash).toBe(createHash('sha256').update(r.json.token).digest('hex'));
    // The raw token appears nowhere in the database.
    const dump = JSON.stringify(db.prepare('SELECT * FROM players').all());
    expect(dump).not.toContain(r.json.token);
  });

  it('accepts the class code in any letter case', async () => {
    const { call } = setup();
    const r = await call('POST', '/api/join', { body: { classCode: 'test-a1', nickname: 'Brave Falcon 27' } });
    expect(r.status).toBe(200);
  });

  it.each([
    ['free text', 'Hello World 12'],
    ['adjective not on the list', 'Sleepy Falcon 27'],
    ['noun not on the list', 'Brave Toaster 27'],
    ['no number', 'Brave Falcon'],
    ['one digit', 'Brave Falcon 7'],
    ['three digits', 'Brave Falcon 270'],
    ['excluded number', 'Brave Falcon 69'],
    ['lower case', 'brave falcon 27'],
    ['double space', 'Brave  Falcon 27'],
    ['extra word', 'Brave Falcon 27 Lion'],
    ['words swapped', 'Falcon Brave 27'],
  ])('refuses a nickname that does not fit the pattern and lists (%s)', async (_why, nickname) => {
    const { call, db } = setup();
    const r = await call('POST', '/api/join', { body: { classCode: 'TEST-A1', nickname } });
    expect(r.status).toBe(400);
    expect((db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n).toBe(0);
  });

  it('refuses extra fields in the body (nothing else can ride along)', async () => {
    const { call } = setup();
    const r = await call('POST', '/api/join', {
      body: { classCode: 'TEST-A1', nickname: 'Brave Falcon 27', realName: 'x' },
    });
    expect(r.status).toBe(400);
  });

  it('refuses an unknown class code', async () => {
    const { call } = setup();
    const r = await call('POST', '/api/join', { body: { classCode: 'TEST-Z9', nickname: 'Brave Falcon 27' } });
    expect(r.status).toBe(404);
  });

  it('keeps nicknames unique: same class and across classes', async () => {
    const { call, join } = setup();
    await join('Brave Falcon 27', 'TEST-A1');
    const same = await call('POST', '/api/join', { body: { classCode: 'TEST-A1', nickname: 'Brave Falcon 27' } });
    expect(same.status).toBe(409);
    expect(same.json).toEqual({ error: 'nickname taken' });
    const other = await call('POST', '/api/join', { body: { classCode: 'TEST-B1', nickname: 'Brave Falcon 27' } });
    expect(other.status).toBe(409);
  });

  it('caps joins at the class size; a removed player frees the place', async () => {
    const { call, join } = setup();
    await join(NICKS[0], 'TEST-A2');
    const second = await join(NICKS[1], 'TEST-A2');
    const full = await call('POST', '/api/join', { body: { classCode: 'TEST-A2', nickname: NICKS[2] } });
    expect(full.status).toBe(409);
    expect(full.json).toEqual({ error: 'class is full' });
    const del = await call('DELETE', `/api/teacher/player/${second.playerId}`, { teacher: 'TEACH-A2' });
    expect(del.status).toBe(200);
    const again = await call('POST', '/api/join', { body: { classCode: 'TEST-A2', nickname: NICKS[2] } });
    expect(again.status).toBe(200);
  });
});
