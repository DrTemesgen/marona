import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The engine must stay pure: it runs on the phone and on the server and must give the same
// result in both. This reads the engine source as text and fails on anything that reads a
// clock, draws unseeded random numbers, does input or output, or imports a module that could.
const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'engine');

const FORBIDDEN: [string, RegExp][] = [
  ['Date', /\bDate\b/],
  ['Math.random', /Math\s*\.\s*random/],
  ['fetch', /\bfetch\b/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['WebSocket', /WebSocket/],
  ['performance', /\bperformance\b/],
  ['crypto', /\bcrypto\b/],
  ['timers', /\b(setTimeout|setInterval|setImmediate|requestAnimationFrame)\b/],
  ['storage', /\b(localStorage|sessionStorage|indexedDB)\b/],
  ['process', /\bprocess\s*\./],
  ['require', /\brequire\s*\(/],
  ['dynamic import', /\bimport\s*\(/],
  ['node: import', /from\s+['"]node:/],
  ['fs import', /from\s+['"](fs|fs\/promises|path|os|child_process|http|https|net)['"]/],
];

// Every import must be relative and stay inside src (engine, or shared types).
const IMPORT = /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm;

const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts'));

describe('engine purity guard', () => {
  it('finds the engine files', () => {
    expect(files).toEqual(expect.arrayContaining(['engine.ts', 'rng.ts']));
  });

  for (const f of files) {
    const text = readFileSync(join(ENGINE_DIR, f), 'utf8');
    it(`${f} uses no clock, unseeded randomness, network, storage or node modules`, () => {
      const hits = FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => name);
      expect(hits).toEqual([]);
    });
    it(`${f} imports only relative engine or shared modules`, () => {
      const specs = [...text.matchAll(IMPORT)].map((m) => m[1] as string);
      const bad = specs.filter((s) => !(s.startsWith('./') || s.startsWith('../shared/')));
      expect(bad).toEqual([]);
    });
  }

  it('can see a planted defect', () => {
    const planted = 'const now = Date.now();\nimport { readFileSync } from "node:fs";';
    const hits = FORBIDDEN.filter(([, re]) => re.test(planted)).map(([name]) => name);
    expect(hits).toEqual(['Date', 'node: import']);
  });
});
