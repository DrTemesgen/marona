// Starts the leaderboard server on 127.0.0.1:8787 with the real engine, the case files on disk
// and the database file data/game.db (created on start; data/ is git-ignored).
// Run: npm run server
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadCasesFromDisk } from '../src/content/loadNode';
import { replay } from '../src/engine/engine';
import { createApp } from './app';
import { openDb } from './db';
import { nodeSql } from './sql';

const HOST = '127.0.0.1';
// MARONA_API_PORT moves it (the end-to-end tests use other ports when a playtest is running).
const PORT = Number(process.env.MARONA_API_PORT ?? 8787);

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'game.db'));
const cases = loadCasesFromDisk();

// The client address is the socket address (the default): this server listens on 127.0.0.1 only,
// so phones reach it through the app's /api proxy and share one address.
const app = createApp({
  db: nodeSql(db),
  cases,
  replay,
  now: Date.now,
  log: (message) => console.warn(`[server] ${message}`),
});

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`[server] ${cases.length} case file(s) loaded; listening on http://${HOST}:${info.port}`);
});
