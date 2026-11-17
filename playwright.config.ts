import { defineConfig } from '@playwright/test';

// Uses the Microsoft Edge already installed on this PC, so no browser download is needed.
// The tests run against the real server and its database data/game.db. Make a fresh one first:
//   delete data/game.db (and its -shm and -wal files), then npx tsx tools/seedPilot.ts
// One worker, file order: the tests share the seeded classes and build on each other's players.
// Ports: 8787 (API) and 5173 (app) by default, and servers already running there are reused.
// When a playtest is using those ports, run on others so the tests never touch it:
//   MARONA_API_PORT=8797 MARONA_WEB_PORT=5183 npx playwright test
const API_PORT = Number(process.env.MARONA_API_PORT ?? 8787);
const WEB_PORT = Number(process.env.MARONA_WEB_PORT ?? 5173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    channel: 'msedge',
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  },
  webServer: [
    {
      command: 'npm run server',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { MARONA_API_PORT: String(API_PORT) },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { MARONA_API_PORT: String(API_PORT) },
    },
  ],
});
