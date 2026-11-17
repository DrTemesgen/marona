// Phone-screen journeys at 375 x 812 against the real server (npm run server) and its seeded
// database. Before a run: delete data/game.db, then npx tsx tools/seedPilot.ts.
// Deterministic: game time runs on Playwright's fake clock (page.clock) wherever the engine's
// timing matters; the only real wait is for the short test final's window to close.
import { execSync } from 'node:child_process';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const SHOTS = 'docs/screenshots';
const CH2 = 'ch2-cpr-school-gate';
const API = `http://127.0.0.1:${process.env.MARONA_API_PORT ?? 8787}/api`;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
}

// Joins a class with the first offered nickname; returns the nickname.
async function join(page: Page, classCode: string, screenshot?: string): Promise<string> {
  await page.goto('/');
  await expect(page.getByTestId('screen-join')).toBeVisible();
  await expect(page.getByTestId('footer').first()).toContainText('907');
  await page.getByTestId('join-code').fill(classCode);
  await expect(page.getByTestId('nickname-option').first()).toBeVisible();
  await page.getByTestId('nickname-option').first().click();
  if (screenshot) await shot(page, screenshot);
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('screen-home')).toBeVisible();
  const hello = (await page.getByTestId('home-nickname').textContent()) ?? '';
  return hello.replace(/^Hi,\s*/, '').trim();
}

// Freezes the page clock; from here on only runFor moves game time.
async function freezeClock(page: Page): Promise<void> {
  await page.clock.pauseAt(Date.now() + 1000);
}

async function tapCard(page: Page, id: string, gapMs = 1000): Promise<void> {
  await page.clock.runFor(gapMs);
  const card = page.getByTestId(`card-${id}`);
  await expect(card).toBeVisible();
  await card.click();
}

// Runs the clock in 5 s steps until the scene reaches the phase (at most maxMs of wall time).
async function runUntilPhase(page: Page, phase: string, maxMs = 200_000): Promise<void> {
  const play = page.getByTestId('screen-play');
  for (let spent = 0; (await play.getAttribute('data-phase')) !== phase; spent += 5000) {
    expect(spent, `phase ${phase} not reached`).toBeLessThan(maxMs);
    await page.clock.runFor(5000);
  }
}

// Taps the rhythm circle `taps` times, gapMs apart on the page clock (550 ms = 109 a minute).
async function rhythm(page: Page, taps: number, gapMs = 550): Promise<void> {
  await tapCard(page, 'start_compressions');
  await expect(page.getByTestId('rhythm-overlay')).toBeVisible();
  const tap = page.getByTestId('rhythm-tap');
  for (let i = 0; i < taps; i++) {
    await page.clock.runFor(gapMs);
    await tap.click();
  }
  await expect(page.getByTestId('rhythm-sets')).toHaveAttribute('data-sets', String(Math.floor(taps / 10)));
}

// Chapter 2 played well: the key cards before and after the collapse, CPR sets, then Stop.
async function goodCh2Run(page: Page, opts: { shots?: boolean; taps?: number } = {}): Promise<void> {
  for (const id of ['check_danger', 'call_907', 'ask_pain', 'help_sit', 'send_friend_adult', 'ask_aspirin', 'tell_907_aspirin'])
    await tapCard(page, id);
  await expect(page.getByTestId('bubble').first()).toBeVisible();
  if (opts.shots) await shot(page, 'play-chest-pain');
  await runUntilPhase(page, 'arrest');
  await expect(page.getByTestId('scene-art')).toHaveAttribute('data-casualty', 'collapsed');
  for (const id of ['check_response', 'check_breathing', 'tell_907_not_breathing']) await tapCard(page, id);
  if (opts.shots) await shot(page, 'play-arrest');
  await rhythm(page, opts.taps ?? 30);
  if (opts.shots) await shot(page, 'rhythm');
  await page.getByTestId('rhythm-stop').click();
  await expect(page.getByTestId('rhythm-overlay')).toBeHidden();
  await expect(page.getByTestId('counter-compressions')).toContainText(String(opts.taps ?? 30));
  await page.clock.runFor(1000);
  await page.getByTestId('stop-finish').click();
}

async function openChapter2(page: Page, mode: 'guided' | 'realtime', screenshot?: string): Promise<void> {
  await page.getByTestId('chapter-open-2').click();
  await expect(page.getByTestId('screen-mode')).toBeVisible();
  if (screenshot) await shot(page, screenshot);
  await page.getByTestId(`mode-${mode}`).click();
  await expect(page.getByTestId('screen-play')).toBeVisible();
  await expect(page.getByTestId('screen-play')).toHaveAttribute('data-phase', 'chest_pain');
}

async function newPlayerPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test('a: join TEST-A1, chapter 2 in Guided mode with the rhythm game, debrief shows a score', async ({ page }) => {
  await page.clock.install();
  await join(page, 'TEST-A1', 'join');
  await shot(page, 'home');
  await freezeClock(page);
  await openChapter2(page, 'guided', 'mode-choice');
  // Guided mode shows hints on the cards.
  await expect(page.getByTestId('tray')).toContainText('Hint');
  await goodCh2Run(page, { shots: true, taps: 30 });
  await expect(page.getByTestId('screen-debrief')).toBeVisible();
  await expect(page.getByTestId('debrief-score')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('debrief-save')).toContainText('Recorded');
  await expect(page.getByTestId('rhythm-note')).toContainText('hands-on practice with a trainer');
  await shot(page, 'debrief');
});

test('b: a Real-time run is on the class board, a worse run in the same class ranks below', async ({ browser }) => {
  const p1 = await newPlayerPage(browser);
  await p1.clock.install();
  const nick1 = await join(p1, 'TEST-A1');
  await freezeClock(p1);
  await openChapter2(p1, 'realtime');
  await expect(p1.getByTestId('tray')).not.toContainText('Hint');
  await goodCh2Run(p1, { taps: 30 });
  await expect(p1.getByTestId('debrief-save')).toContainText('Recorded');
  const score1 = Number(await p1.getByTestId('debrief-score').textContent());

  const p2 = await newPlayerPage(browser);
  await p2.clock.install();
  const nick2 = await join(p2, 'TEST-A1');
  await freezeClock(p2);
  await openChapter2(p2, 'realtime');
  await tapCard(p2, 'check_danger');
  await p2.clock.runFor(1000);
  await p2.getByTestId('stop-finish').click();
  await expect(p2.getByTestId('debrief-save')).toContainText('Recorded');
  const score2 = Number(await p2.getByTestId('debrief-score').textContent());
  expect(score1).toBeGreaterThan(score2);

  await p2.getByTestId('debrief-boards').click();
  await expect(p2.getByTestId('screen-boards')).toBeVisible();
  await expect(p2.getByTestId('boards-realtime-only')).toHaveText('Boards count Real-time games only.');
  await expect(p2.getByTestId('board-row-me')).toBeVisible();
  const names = (await p2.getByTestId('board-list').locator('li').allTextContents()).map((t) => t.replace(/\s+/g, ' '));
  const i1 = names.findIndex((t) => t.includes(nick1));
  const i2 = names.findIndex((t) => t.includes(nick2));
  expect(i1, `${nick1} on the board`).toBeGreaterThanOrEqual(0);
  expect(i2, `${nick2} on the board`).toBeGreaterThan(i1);
  await shot(p2, 'boards');
  await p1.context().close();
  await p2.context().close();
});

// A player that plays the final through the API (to fill third place): no actions, then submit.
async function apiFinalPlayer(request: APIRequestContext, classCode: string, finalId: number): Promise<string> {
  const opts = (await (await request.get(`${API}/nicknames`)).json()) as { options: string[] };
  const joined = await request.post(`${API}/join`, { data: { classCode, nickname: opts.options[0] } });
  expect(joined.status()).toBe(200);
  const { token, nickname } = (await joined.json()) as { token: string; nickname: string };
  const headers = { 'x-player-token': token };
  const started = await request.post(`${API}/final/start`, { headers, data: { finalId, caseId: CH2 } });
  expect(started.status()).toBe(200);
  const t0 = Date.now();
  const sent = await request.post(`${API}/final/submit`, {
    headers,
    data: { finalId, caseId: CH2, actions: [], endT: Math.max(1, Date.now() - t0) },
  });
  expect(sent.status()).toBe(200);
  return nickname;
}

async function playFinal(page: Page, classCode: string, cards: string[], screenshot?: string): Promise<string> {
  await page.clock.install();
  const nick = await join(page, classCode);
  await freezeClock(page);
  await expect(page.getByTestId('final-card')).toBeVisible();
  await page.getByTestId('final-card').click();
  await expect(page.getByTestId('screen-final')).toBeVisible();
  await page.getByTestId(`final-start-${CH2}`).click();
  await expect(page.getByTestId('screen-play')).toBeVisible();
  for (const id of cards) await tapCard(page, id);
  await page.clock.runFor(1000);
  await page.getByTestId('stop-finish').click();
  await expect(page.getByTestId('final-sealed')).toContainText('sealed until the final closes');
  if (screenshot) await shot(page, screenshot);
  return nick;
}

test('c: a final in two schools is sealed, then the city ranking lists places 1-3 in order', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const out = execSync('npx tsx tools/seedPilot.ts --test-final=100', { encoding: 'utf8' });
  const m = /test final (\d+): closes (\S+)/.exec(out);
  expect(m, out).not.toBeNull();
  const finalId = Number(m![1]);
  const closesAt = Date.parse(m![2]);

  const a = await newPlayerPage(browser);
  const first = await playFinal(a, 'TEST-A2', ['check_danger', 'call_907', 'ask_pain', 'help_sit'], 'final-sealed');
  const b = await newPlayerPage(browser);
  const second = await playFinal(b, 'TEST-B1', ['check_danger']);
  const third = await apiFinalPlayer(request, 'TEST-B2', finalId);

  const early = await request.get(`${API}/final/results?finalId=${finalId}`);
  expect(early.status()).toBe(403);
  expect(Date.now()).toBeLessThan(closesAt);

  // The one real wait: until the final's window has closed.
  await expect
    .poll(async () => (await request.get(`${API}/final/results?finalId=${finalId}`)).status(), {
      timeout: Math.max(10_000, closesAt - Date.now() + 30_000),
      intervals: [2000],
    })
    .toBe(200);
  const results = (await (await request.get(`${API}/final/results?finalId=${finalId}`)).json()) as {
    city: { rank: number; nickname: string; score: number }[];
    bySchool: Record<string, { rank: number; nickname: string }[]>;
  };
  expect(results.city.slice(0, 3).map((e) => e.rank)).toEqual([1, 2, 3]);
  expect(results.city.slice(0, 3).map((e) => e.nickname)).toEqual([first, second, third]);
  expect(results.city[0].score).toBeGreaterThan(results.city[1].score);
  expect(Object.keys(results.bySchool).sort()).toEqual(['Test School A', 'Test School B']);
  await a.context().close();
  await b.context().close();
});

test('d: the teacher view for TEACH-A1 lists the players and removes one after the confirm step', async ({ page }) => {
  const nick = await join(page, 'TEST-A1');
  await page.getByTestId('open-teacher').click();
  await page.getByTestId('teacher-code').fill('TEACH-A1');
  await page.getByTestId('teacher-open').click();
  const rows = page.getByTestId('teacher-player');
  await expect(rows.filter({ hasText: nick })).toHaveCount(1);
  const before = await rows.count();
  expect(before).toBeGreaterThanOrEqual(4); // players from tests a, b and this one
  await shot(page, 'teacher');
  const mine = rows.filter({ hasText: nick });
  await mine.getByTestId('teacher-remove').click();
  await expect(mine.getByRole('alertdialog')).toBeVisible();
  await mine.getByTestId('teacher-confirm').click();
  await expect(rows).toHaveCount(before - 1);
  await expect(rows.filter({ hasText: nick })).toHaveCount(0);
});

test('e: offline practice still plays chapter 2 and saves on the phone only', async ({ page, context }) => {
  await page.clock.install();
  await join(page, 'TEST-A1');
  await freezeClock(page);
  await context.setOffline(true);
  await openChapter2(page, 'guided');
  for (const id of ['check_danger', 'call_907', 'ask_pain']) await tapCard(page, id);
  await expect(page.getByTestId('bubble').first()).toBeVisible();
  await page.clock.runFor(1000);
  await page.getByTestId('stop-finish').click();
  await expect(page.getByTestId('screen-debrief')).toBeVisible();
  await expect(page.getByTestId('debrief-score')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('debrief-save')).toContainText('Saved on this phone only');
  await context.setOffline(false);
});

test('f: the art gallery opens at /?gallery=1 and the handover casualty lies on a stretcher', async ({ page }) => {
  await page.goto('/?gallery=1');
  await expect(page.getByRole('heading', { name: 'Art gallery' })).toBeVisible();
  await shot(page, 'art-gallery');
  const handover = page.getByRole('region', { name: 'minibus-stop' }).locator('figure').filter({ hasText: 'minibus-stop / handover' });
  await handover.scrollIntoViewIfNeeded();
  await expect(handover.getByRole('img')).toHaveAttribute('aria-label', /lies on a stretcher/);
  await handover.screenshot({ path: `${SHOTS}/art-handover.png`, animations: 'disabled' });
});
