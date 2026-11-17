# Marona (prototype)

**Prototype. The first aid content is still under clinical review. Do not use it to teach
first aid.** Every clinical line, rubric item and harm is marked "pending review" until a
clinician has checked all six chapters.

A first aid practice game for phones, for high school students in Addis Ababa. It is an
installable web app (a PWA): a student joins a class with a class code and a word-pair
nickname (never a real name), then plays short emergency scenes - collapse and CPR at the
school gate, choking at lunch, bleeding, burns, a seizure, a safe scene at a minibus stop.
Each scene is a set of cards (do, ask, call 907) on a running clock, with characters who
talk, a bystander who gives wrong advice on purpose, and a tap-rhythm game for chest
compressions. A debrief scores every step against the guideline, with a teaching point and
the guideline page.

- Guided mode: hints on every card, the clock runs at half speed.
- Real-time mode: no hints, real clock. Only Real-time games count on the class and school
  boards.
- Finals: a timed window across schools. Every student plays the same case once, and the
  results stay sealed until the window closes; then a city ranking and a ranking per school.
- Offline: after the first load, practice works without a connection; scores are then kept
  on the phone only.

Emergency number shown everywhere: 907. The game is practice only and does not replace a
hands-on first aid course.

## Run it on a Windows PC

Needs Node.js 24 or newer (built and tested with Node 26). In a terminal in this folder:

```
npm install                      (once)
npx tsx tools/seedPilot.ts       (creates data/game.db with the test classes and a final)
npm run server                   (the score server, http://127.0.0.1:8787)
npm run dev -- --host            (the app, in a second terminal)
```

Then open http://127.0.0.1:5173 in a browser on the PC.

The seed is safe to run twice. `npx tsx tools/seedPilot.ts --reopen` moves the practice
final's window to now (it lasts 60 minutes). To start again from nothing, stop the server,
delete `data/game.db` (and `game.db-shm`, `game.db-wal` next to it), and seed again.

### Seeded test codes

| School        | Class    | Class code | Teacher code |
|---------------|----------|------------|--------------|
| Test School A | Class A1 | TEST-A1    | TEACH-A1     |
| Test School A | Class A2 | TEST-A2    | TEACH-A2     |
| Test School B | Class B1 | TEST-B1    | TEACH-B1     |
| Test School B | Class B2 | TEST-B2    | TEACH-B2     |

Each class takes up to 40 players. The codes are easy to guess on purpose: they are for
testing on a PC only. The online demo and any real season use long random codes
(`npx tsx tools/newCodes.ts` prints a new pair).

The teacher view (Home, "Teacher") opens with a teacher code: it lists the class's
nicknames, attempts and best scores, and can remove a player after a confirm step.

Extra pages: `/?gallery=1` shows every scene and casualty drawing (art review), and
`/?fake=1` runs the app with an in-memory fake server (no score server needed).

## Play on a phone over home Wi-Fi

1. Connect the PC and the phone to the same Wi-Fi.
2. Start the server and `npm run dev -- --host` as above. Vite prints a "Network" address,
   for example `http://192.168.1.20:5173`.
3. Open that address in the phone's browser. If it does not load, allow Node.js through the
   Windows firewall for private networks.

The phone talks only to the app address; the app passes `/api` on to the score server, which
listens on the PC itself (127.0.0.1) and is not reachable from the network directly. All
phones then share one rate limit (600 requests and 60 joins a minute), which is enough for a
class.

Install to the home screen and offline play need a secure address (HTTPS, or localhost).
A plain `http://192.168.x.x` address plays fine but cannot install and has no offline
cache. Two ways round it for testing:

- USB port forwarding: connect an Android phone by USB, open `chrome://inspect` in Chrome on
  the PC, choose "Port forwarding", add port 5173 to `localhost:5173`, then open
  `http://localhost:5173` on the phone. Chrome treats it as secure.
- A temporary HTTPS tunnel to port 5173 (any tunnel tool). Close it after the session: anyone
  with the link can reach the app while it is open.

The offline cache is built by the production build (`npx vite build`, then
`npx vite preview --host` with the server running); the dev server does not register it.

## Online demo (Vercel and Turso)

The same code runs as an online demo with test data only: the phone app as static files and
the score server as one Vercel Function, with a Turso database (hosted SQLite). The build is
`npm run build:vercel` (Vercel runs it on every deploy):

- `tools/buildVercel.ts` writes `.vercel/output` (Vercel's Build Output API): the app, the API
  bundled into one file (`server/vercel.ts`), the routes and the security headers (a strict
  Content Security Policy, no framing, `noindex`).
- `tools/setupDemoDb.ts` creates the tables when they are missing and one demo class with the
  codes from the environment settings. It refuses short or test-looking codes.

Environment settings in the Vercel project (never in git):

| Name | What |
|------|------|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | set by the Turso integration (Vercel, Storage) |
| `DEMO_CLASS_CODE`, `DEMO_TEACHER_CODE` | long random codes from `npx tsx tools/newCodes.ts` |
| `MARONA_REGION` | optional: the Vercel region next to the database (default `fra1`) |

On the demo, teacher codes need at least 16 letters and digits, and the API answers only its
own origin. New codes need only new settings and a redeploy. Real student data does not go on
the demo: a school pilot needs consent, a data-protection check and its own server.

## Tests

```
npx vitest run           unit tests: engine, content, characters, server, tools
npx tsc --noEmit         type check
npx vite build           production build
npx playwright test      end-to-end, phone size 375 x 812, uses the installed Microsoft Edge
npm run build:vercel     the online demo build (needs the settings above for its last step)
npx tsx tools/privacyScan.ts      privacy scan of data/game.db (exit 0 = clean)
npx tsx tools/testPlayer.ts       smoke scores for every chapter
```

The end-to-end tests use the real server and `data/game.db`. Start from a fresh database:
delete `data/game.db`, run `npx tsx tools/seedPilot.ts`, then `npx playwright test`. They
start the server and the app themselves (or reuse ones already running on ports 8787 and
5173). When a playtest is using those ports, give the tests their own:
`MARONA_API_PORT=8797 MARONA_WEB_PORT=5183 npx playwright test` (PowerShell: set
`$env:MARONA_API_PORT` and `$env:MARONA_WEB_PORT` first). The final test adds its own short "Test final" (`--test-final=100`, closes 100 s
later) and waits for it to close, so the suite takes about three minutes. Screenshots of
every screen land in `docs/screenshots/`.

## Not done yet

- AI characters are off. Every line comes from the case files through the scripted
  provider and the safety filter; the AI providers are not connected.
- Clinical review: every clinical line, rubric item and harm is marked "pending review", and
  many guideline pages still say "to confirm". A clinician must review all six chapters
  before students use the game.
- No school server yet: the game runs on a PC on the local network, and as an online demo
  with test data (above). A school pilot needs a hosted HTTPS server where the students' data
  may legally live, consent, real class and teacher codes, and a backup of the database.
- Amharic comes later. All screen text is in `src/ui/strings.en.ts`, ready for a second
  language file.

## Licence

The code is under the MIT licence (see LICENSE). The first aid content in `src/content/` is a
paraphrase of published guidelines, with the source page on every clinical line; it is not yet
reviewed by a clinician, so it must not be used to teach first aid until it is.
