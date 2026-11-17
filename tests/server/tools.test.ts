import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { openDb } from '../../server/db';
import { nodeSql } from '../../server/sql';
import { privacyScan } from '../../tools/privacyScan';
import { FINAL_LENGTH_MS, PILOT_CASE_ID, seedPilot } from '../../tools/seedPilot';
import { CaseFile } from '../../src/shared/contract';
import { NICKS, T0, fakeReplay, makeCase, runBody, setup } from './helpers';

// Synthetic contact details, built at run time so no address or number sits in the source.
const PLANTED_EMAIL = ['nobody', 'example.invalid'].join('@');
const PLANTED_INTL_PHONE = ['+251', '900', '000', '000'].join(' ');
const PLANTED_LOCAL_PHONE = '09' + '0'.repeat(8);

async function cleanDb() {
  const s = setup();
  const { token } = await s.join(NICKS[0]);
  await s.call('POST', '/api/runs', { token, body: runBody() });
  return s.db;
}

describe('tools/privacyScan', () => {
  it('finds nothing in a database the server wrote', async () => {
    expect(privacyScan(await cleanDb())).toEqual([]);
  });

  it('finds a planted e-mail address used as a nickname (and the bad nickname)', async () => {
    const db = await cleanDb();
    db.prepare('INSERT INTO players (class_id, nickname, token_hash, created_at) VALUES (1, ?, ?, 0)').run(
      PLANTED_EMAIL,
      'b'.repeat(64),
    );
    const f = privacyScan(db);
    expect(f.map((x) => `${x.kind}:${x.table}.${x.column}`).sort()).toEqual([
      'email:players.nickname',
      'nickname:players.nickname',
    ]);
    expect(JSON.stringify(f)).not.toContain(PLANTED_EMAIL); // the report is masked
  });

  it('finds planted phone numbers in runs and final_runs', async () => {
    const db = await cleanDb();
    db.prepare('UPDATE runs SET actions_json = ?').run(JSON.stringify([{ note: PLANTED_INTL_PHONE }]));
    db.exec(`INSERT INTO finals (id, name, opens_at, closes_at, case_ids_json, variant_id)
             VALUES (1, 'F', 0, 10, '["test-case"]', 'final-x');
             INSERT INTO final_starts VALUES (1, 1, 'test-case', 7, 'final-x', 0);`);
    db.prepare('INSERT INTO final_runs VALUES (1, 1, ?, ?, 0, 0, 0, 0)').run(
      'test-case',
      `call me on ${PLANTED_LOCAL_PHONE}`,
    );
    const f = privacyScan(db);
    expect(f.map((x) => `${x.kind}:${x.table}.${x.column}`).sort()).toEqual([
      'phone:final_runs.actions_json',
      'phone:runs.actions_json',
    ]);
  });

  it('flags a column that is not allowed in players and a token that is not a hash', async () => {
    const db = await cleanDb();
    db.exec('ALTER TABLE players ADD COLUMN contact TEXT');
    db.exec("UPDATE players SET token_hash = 'plain-token-kept-by-mistake'");
    const kinds = privacyScan(db).map((x) => `${x.kind}:${x.column}`);
    expect(kinds).toContain('columns:contact');
    expect(kinds).toContain('token:token_hash');
  });

  it('does not flag the emergency number 907 or ordinary game data', async () => {
    const db = await cleanDb();
    db.prepare('UPDATE runs SET actions_json = ?').run(
      JSON.stringify([{ actionId: 'call-907', t: 123456 }, { actionId: 'push', t: 9_000_000, payload: { bpm: 110 } }]),
    );
    expect(privacyScan(db)).toEqual([]);
  });
});

describe('tools/seedPilot', () => {
  const ch2 = () => {
    const c = makeCase(PILOT_CASE_ID);
    return CaseFile.parse({ ...c, id: PILOT_CASE_ID });
  };

  it('creates two schools, four classes and one practice final over the finalOnly variant; safe to run twice', () => {
    const db = openDb(':memory:');
    const first = seedPilot(db, [ch2()], T0);
    const second = seedPilot(db, [ch2()], T0 + 5000);
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect([count('schools'), count('classes'), count('finals')]).toEqual([2, 4, 1]);
    expect(second).toEqual(first);
    expect(first.classes.map((c) => [c.classCode, c.teacherCode, c.sizeCap])).toEqual([
      ['TEST-A1', 'TEACH-A1', 40],
      ['TEST-A2', 'TEACH-A2', 40],
      ['TEST-B1', 'TEACH-B1', 40],
      ['TEST-B2', 'TEACH-B2', 40],
    ]);
    expect(first.final).toMatchObject({
      name: 'Practice final',
      opensAt: T0,
      closesAt: T0 + FINAL_LENGTH_MS,
      caseIds: [PILOT_CASE_ID],
      variantId: 'final-x',
    });
  });

  it('--reopen moves the window; without the case file no final is made', () => {
    const db = openDb(':memory:');
    expect(seedPilot(db, [], T0).final).toBeNull();
    seedPilot(db, [ch2()], T0);
    const later = seedPilot(db, [ch2()], T0 + 3 * FINAL_LENGTH_MS, { reopen: true });
    expect(later.final?.opensAt).toBe(T0 + 3 * FINAL_LENGTH_MS);
  });

  it('a seeded database works with the server: join and start the practice final', async () => {
    const db = openDb(':memory:');
    seedPilot(db, [ch2()], T0);
    const app = createApp({ db: nodeSql(db), cases: [ch2()], replay: fakeReplay().fn, now: () => T0 + 1000, clientIp: () => 'x' });
    const join = await app.request('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classCode: 'TEST-B2', nickname: NICKS[0] }),
    });
    const { token } = (await join.json()) as { token: string };
    const start = await app.request('/api/final/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-player-token': token },
      body: JSON.stringify({ finalId: 1, caseId: PILOT_CASE_ID }),
    });
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({ variantId: 'final-x', serverStartMs: T0 + 1000 });
    expect(privacyScan(db)).toEqual([]);
  });
});
