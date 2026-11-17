// Typed API client. JSON over fetch with the x-player-token header from localStorage.
// The in-memory fake server is used only with ?fake=1. When the server cannot be reached, calls
// throw a NetworkError (the screens show a short message and a Retry button); only practice runs
// are then kept on this phone.
import type { BoardEntry, Variant } from '../../shared/contract';
import { FAKE_TOKEN, fakeServer, type RunBody } from './fakeServer';
import { store } from '../storage';

export interface Session {
  token: string; playerId: string; nickname: string; className: string; schoolName: string;
}
export interface FinalInfo {
  // The server sends ms since 1970; the fake server sends ISO strings.
  finalId: string | number | null; opensAt?: number | string; closesAt?: number | string; open?: boolean; caseIds?: string[];
}
// elapsedMs: now - serverStartMs on the server (0 on the first start, more after a reload).
export interface FinalStart { seed: number; variantId: string; variant?: Variant; serverStartMs: number; elapsedMs?: number }
export interface RunResult {
  serverScore?: number; accepted?: boolean; reason?: string;
  source: 'server' | 'fake' | 'offline';
}

const forcedFake = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fake') === '1';

export function usingFake(): boolean {
  return forcedFake;
}

// A fake token is stored and sent only with ?fake=1; anywhere else it is dropped.
export function tokenAllowed(token: string | null | undefined, fake = forcedFake): token is string {
  return typeof token === 'string' && token !== '' && (fake || token !== FAKE_TOKEN);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The server already holds this final game: a submit whose answer was lost, then retried.
export function alreadySubmitted(e: unknown): boolean {
  return e instanceof HttpError && e.status === 409 && e.message === 'already submitted';
}

// No answer from the server at all (no Wi-Fi, server down), as opposed to an HTTP error.
export class NetworkError extends Error {
  constructor() {
    super('No connection to the game server');
    this.name = 'NetworkError';
  }
}

// "Busy" notices for the screen: seconds until the one retry after a 429, or 0 when it is over.
type BusyListener = (seconds: number) => void;
const busyListeners = new Set<BusyListener>();
export function onBusy(listener: BusyListener): () => void {
  busyListeners.add(listener);
  return () => busyListeners.delete(listener);
}
function busy(seconds: number): void {
  for (const l of busyListeners) l(seconds);
}

const MAX_RETRY_WAIT_S = 60;

// Retry-After is whole seconds (or an HTTP date); 1 to 60 s, 5 s when it is missing or odd.
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (header === null || header.trim() === '') return 5;
  const n = Number(header);
  const s = Number.isFinite(n) ? n : (Date.parse(header) - now) / 1000;
  if (!Number.isFinite(s)) return 5;
  return Math.min(MAX_RETRY_WAIT_S, Math.max(1, Math.ceil(s)));
}

async function http<T>(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const token = store.get('token');
  if (tokenAllowed(token)) headers['x-player-token'] = token;
  const send = () => fetch(`/api${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  let res = await send();
  if (res.status === 429) {
    // Too many requests: wait as long as the server asks, then try once more.
    const wait = retryAfterSeconds(res.headers.get('Retry-After'));
    busy(wait);
    try {
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await send();
    } finally {
      busy(0);
    }
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* keep status text */ }
    throw new HttpError(res.status, msg);
  }
  return (await res.json()) as T;
}

// Run against the real server, or the fake with ?fake=1 only. A network failure (not an HTTP
// error) throws a NetworkError: there is never a fall-back to the fake server.
async function call<T>(real: () => Promise<T>, fake: () => Promise<T>): Promise<T> {
  if (forcedFake) return fake();
  try {
    return await real();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new NetworkError();
  }
}

export const api = {
  nicknames: () => call(() => http<{ options: string[] }>('GET', '/nicknames'), () => fakeServer.nicknames()),
  join: (classCode: string, nickname: string) =>
    call(() => http<Session>('POST', '/join', { body: { classCode, nickname } }), () => fakeServer.join({ classCode, nickname })),
  boards: (scope: 'class' | 'school') =>
    call(() => http<{ scope: string; entries: BoardEntry[] }>('GET', `/boards?scope=${scope}`), () => fakeServer.boards(scope)),
  finalCurrent: () => call<FinalInfo>(() => http<FinalInfo>('GET', '/final/current'), () => fakeServer.finalCurrent()),
  // The server's final ids are numbers; the fake server's is a string.
  finalStart: (finalId: string | number, caseId: string): Promise<FinalStart> =>
    call(
      () => http<FinalStart>('POST', '/final/start', { body: { finalId, caseId } }),
      () => fakeServer.finalStart({ finalId, caseId }),
    ),
  finalSubmit: (body: { finalId: string | number; caseId: string; actions: unknown[]; endT: number }) =>
    call(() => http<{ received: true }>('POST', '/final/submit', { body }), () => fakeServer.finalSubmit(body)),
  teacherClass: (code: string) =>
    call(
      () => http<{ className: string; players: { playerId: string; nickname: string; attempts: number; best: number | null }[] }>('GET', '/teacher/class', { headers: { 'x-teacher-code': code } }),
      () => fakeServer.teacherClass(code),
    ),
  teacherRemove: (code: string, playerId: string) =>
    call(
      () => http<{ removed: true }>('DELETE', `/teacher/player/${encodeURIComponent(playerId)}`, { headers: { 'x-teacher-code': code } }),
      () => fakeServer.teacherRemove(code, playerId),
    ),
  // Practice runs: posted when online. Without a connection the run stays on this phone.
  async postRun(body: RunBody): Promise<RunResult> {
    if (forcedFake) return { ...(await fakeServer.runs(body)), source: 'fake' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { source: 'offline' };
    try {
      return { ...(await http<{ serverScore: number; accepted: boolean; reason?: string }>('POST', '/runs', { body })), source: 'server' };
    } catch (e) {
      if (e instanceof HttpError) return { accepted: false, reason: e.message, source: 'server' };
      return { source: 'offline' };
    }
  },
};
