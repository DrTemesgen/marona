import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, NetworkError, tokenAllowed } from '../../src/ui/api/client';
import { ADJ, ANI, FAKE_TOKEN, fakeServer } from '../../src/ui/api/fakeServer';
import { startGameAt } from '../../src/ui/game/resume';
import { wrongAdviceHeard } from '../../src/ui/game/wrongAdvice';
import { loadCasesFromDisk } from '../../src/content/loadNode';
import * as engine from '../../src/engine/engine';
import { ADJECTIVES, NOUNS, isValidNickname } from '../../server/nicknames';

const cases = loadCasesFromDisk();

// Review fix 1: no fall-back to the fake server; a network failure is a clear error.
describe('client: never falls back to the fake server', () => {
  afterEach(() => vi.unstubAllGlobals());
  const offline = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

  it('join, finalCurrent, finalStart and finalSubmit throw a NetworkError when the server cannot be reached', async () => {
    offline();
    await expect(api.join('TEST-A1', 'Brave Falcon 27')).rejects.toBeInstanceOf(NetworkError);
    await expect(api.finalCurrent()).rejects.toBeInstanceOf(NetworkError);
    await expect(api.finalStart(1, 'ch2-cpr-school-gate')).rejects.toBeInstanceOf(NetworkError);
    await expect(api.finalSubmit({ finalId: 1, caseId: 'ch2-cpr-school-gate', actions: [], endT: 1000 })).rejects.toBeInstanceOf(NetworkError);
    // and still no fake after those failures
    await expect(api.nicknames()).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps a practice run on this phone when offline', async () => {
    offline();
    const run = { caseId: 'x', mode: 'guided', seed: 1, variantId: 'v', actions: [], endT: 1, clientScore: 50 };
    await expect(api.postRun(run)).resolves.toEqual({ source: 'offline' });
  });

  it('allows the fake token only with ?fake=1', () => {
    expect(tokenAllowed(FAKE_TOKEN)).toBe(false);
    expect(tokenAllowed(FAKE_TOKEN, true)).toBe(true);
    expect(tokenAllowed('real-token')).toBe(true);
    expect(tokenAllowed(null)).toBe(false);
  });
});

// Review fix 2: a final resumed after a reload starts a fresh game at the server's clock time.
describe('final resume: a fresh game at elapsedMs', () => {
  const ch2 = cases.find((c) => c.id === 'ch2-cpr-school-gate');
  it('starts at the given clock time, with the timeline fired up to it', () => {
    expect(ch2).toBeDefined();
    const cfg = { caseFile: ch2!, seed: 7, mode: 'realtime' as const, variantId: ch2!.variants[0].id };
    const fresh = engine.view(startGameAt(engine, cfg, 0));
    const resumed = engine.view(startGameAt(engine, cfg, 80_000));
    expect(fresh.elapsedMs).toBe(0);
    expect(resumed.elapsedMs).toBe(80_000);
    expect(resumed.transcript.length).toBeGreaterThan(fresh.transcript.length);
    // a reload after the time is up ends the game at once, so the app submits straight away
    expect(engine.view(startGameAt(engine, cfg, ch2!.maxDurationMs + 1000)).ended).toBe(true);
  });
});

// Review fix 3: the debrief shows each wrong advice heard, with the named harm's teaching point.
describe('debrief: wrong advice you heard', () => {
  it('gives every wrongAdvice line in every case a correction from its harm', () => {
    let n = 0;
    for (const c of cases) {
      for (const l of c.lines.filter((x) => x.wrongAdvice)) {
        const harm = c.rubric.harms.find((h) => h.id === l.correctionHarmId);
        expect(harm, `${c.id} ${l.id}`).toBeDefined();
        const heard = wrongAdviceHeard(c, [{ lineId: l.id }, { lineId: l.id }]);
        expect(heard).toEqual([{ lineId: l.id, characterId: l.characterId, text: l.text, correction: harm!.teachingPoint }]);
        n++;
      }
    }
    expect(n).toBe(12);
  });
  it('leaves out lines that are not wrong advice', () => {
    const c = cases[0];
    const plain = c.lines.find((l) => !l.wrongAdvice)!;
    expect(wrongAdviceHeard(c, [{ lineId: plain.id }])).toEqual([]);
  });
});

// Review fix 5: the fake server offers only nicknames the real server accepts.
describe('fake server nicknames', () => {
  it('uses only words from the server lists', async () => {
    for (const w of ADJ) expect(ADJECTIVES, w).toContain(w);
    for (const w of ANI) expect(NOUNS, w).toContain(w);
    for (let i = 0; i < 20; i++) {
      const { options } = await fakeServer.nicknames();
      for (const o of options) expect(isValidNickname(o), o).toBe(true);
    }
  });
});
