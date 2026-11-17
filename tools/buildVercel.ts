// Builds the online demo for Vercel in its Build Output API layout (.vercel/output):
//   static/              the phone app, copied from dist/ (vite build runs first), and robots.txt
//   functions/api.func/  the API (server/vercel.ts) bundled into one file, index.mjs
//   config.json          the routes and the security headers for every page and API answer
// Run: npm run build:vercel (Vercel runs it at each deploy). Reads no secret.
// MARONA_REGION picks the Vercel region of the API (default fra1, Frankfurt); it should be the
// region of the Turso database, or every query crosses an ocean.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { PATH_PARAM } from '../server/hosted';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.vercel', 'output');
// Vercel's default Node.js (26.x) when this was written; package.json engines (>=24) lets Vercel
// build with the same version.
export const NODE_RUNTIME = 'nodejs26.x';
export const DEFAULT_REGION = 'fra1';

// The app loads only its own files: no inline script or style, no other site.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  // An unlisted demo: search engines are asked not to list it.
  'X-Robots-Tag': 'noindex, nofollow',
};

// Same order as Vercel's own vercel.json routes: headers, then files, then the API rewrite.
export function vercelConfig() {
  return {
    version: 3,
    routes: [
      { src: '^/(.*)$', headers: SECURITY_HEADERS, continue: true },
      { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
      { handle: 'filesystem' },
      { src: '^/api(?:/(.*))?$', dest: `/api?${PATH_PARAM}=$1`, check: true },
    ],
  };
}

export function functionConfig(region: string) {
  return {
    runtime: NODE_RUNTIME,
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    maxDuration: 10,
    regions: [region],
  };
}

export async function buildVercel(region = DEFAULT_REGION): Promise<string> {
  if (!/^[a-z]{3}[0-9]$/.test(region)) throw new Error(`MARONA_REGION "${region}" is not a Vercel region id`);
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html is missing: run vite build first');
  rmSync(OUT, { recursive: true, force: true });

  const staticDir = join(OUT, 'static');
  mkdirSync(staticDir, { recursive: true });
  cpSync(dist, staticDir, { recursive: true });
  writeFileSync(join(staticDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

  const fnDir = join(OUT, 'functions', 'api.func');
  mkdirSync(fnDir, { recursive: true });
  await build({
    entryPoints: [join(ROOT, 'server', 'vercel.ts')],
    outfile: join(fnDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node26', // the same major version as NODE_RUNTIME
    // A few dependencies still call require(); give the ESM bundle one.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    legalComments: 'eof',
    logLevel: 'warning',
  });
  writeFileSync(join(fnDir, '.vc-config.json'), `${JSON.stringify(functionConfig(region), null, 2)}\n`);
  writeFileSync(join(OUT, 'config.json'), `${JSON.stringify(vercelConfig(), null, 2)}\n`);
  return OUT;
}

const invokedAs = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (process.platform === 'win32' ? invokedAs.toLowerCase() === self.toLowerCase() : invokedAs === self) {
  buildVercel(process.env.MARONA_REGION || DEFAULT_REGION)
    .then((out) => console.log(`build:vercel: ${out}`))
    .catch((e: unknown) => {
      console.error(`build:vercel: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    });
}
