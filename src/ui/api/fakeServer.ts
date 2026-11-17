// In-memory stand-in for the server API, used only with ?fake=1.
import type { BoardEntry } from '../../shared/contract';
import { allCases } from '../caseList';

export interface RunBody {
  caseId: string; mode: string; seed: number; variantId: string;
  actions: unknown[]; endT: number; clientScore: number;
}

// The fake final is over chapter 2 when it is bundled, else the first case.
function fakeFinalCase() {
  return allCases.find((c) => c.chapter === 2) ?? allCases[0];
}

// The fake session token: stored only with ?fake=1 (see tokenAllowed in client.ts).
export const FAKE_TOKEN = 'fake-token';

// Words from the server lists only (server/nicknames.ts, which needs node:crypto and so cannot be
// bundled), so every fake nickname is one the server accepts. A test checks this.
export const ADJ = ['Brave', 'Quick', 'Calm', 'Bright', 'Kind', 'Bold', 'Swift', 'Gentle', 'Wise', 'Steady', 'Happy', 'Lucky'];
export const ANI = ['Falcon', 'Lion', 'Gazelle', 'Eagle', 'Zebra', 'Ibex', 'Otter', 'Heron', 'Crane', 'Impala', 'Kudu', 'Oryx'];

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

const mem = {
  players: [
    { playerId: 'p1', nickname: 'Calm Heron 11', attempts: 3, best: 72 },
    { playerId: 'p2', nickname: 'Bold Zebra 40', attempts: 1, best: 55 },
  ] as { playerId: string; nickname: string; attempts: number; best: number }[],
  me: { nickname: '', playerId: 'me', attempts: 0, best: 0 },
  finalSubmitted: new Set<string>(),
};

export const fakeServer = {
  health: async () => ({ ok: true as const }),
  nicknames: async () => {
    const set = new Set<string>();
    // 10-99 without 69 and 88, which the server leaves out.
    const num = () => pick(Array.from({ length: 90 }, (_, i) => i + 10).filter((n) => n !== 69 && n !== 88));
    while (set.size < 6) set.add(`${pick(ADJ)} ${pick(ANI)} ${num()}`);
    return { options: [...set] };
  },
  join: async (b: { classCode: string; nickname: string }) => {
    if (!b.classCode.trim() || !b.nickname.trim()) throw new Error('bad request');
    mem.me.nickname = b.nickname;
    return { token: FAKE_TOKEN, playerId: 'me', nickname: b.nickname, className: 'Class 9B', schoolName: 'Demo School' };
  },
  runs: async (b: RunBody) => {
    mem.me.attempts += 1;
    mem.me.best = Math.max(mem.me.best, b.clientScore);
    return { serverScore: b.clientScore, accepted: true };
  },
  boards: async (scope: 'class' | 'school'): Promise<{ scope: string; entries: BoardEntry[] }> => {
    const rows = [
      { nickname: 'Brave Falcon 27', score: 91, durationMs: 80000 },
      { nickname: 'Swift Oryx 52', score: 84, durationMs: 95000 },
      { nickname: 'Calm Heron 11', score: 72, durationMs: 120000 },
      { nickname: 'Bold Zebra 40', score: 55, durationMs: 150000 },
    ];
    if (scope === 'school') rows.push({ nickname: 'Kind Ibex 63', score: 66, durationMs: 130000 });
    if (mem.me.nickname && mem.me.best > 0) rows.push({ nickname: mem.me.nickname, score: mem.me.best, durationMs: 100000 });
    rows.sort((a, b) => b.score - a.score);
    return { scope, entries: rows.map((r, i) => ({ rank: i + 1, ...r })) };
  },
  finalCurrent: async () => {
    const now = Date.now();
    return {
      finalId: 'fake-final', opensAt: new Date(now - 3600_000).toISOString(),
      closesAt: new Date(now + 86400_000).toISOString(), open: true, caseIds: [fakeFinalCase().id],
    };
  },
  // The fake final plays a practice variant: the phone carries no final variants.
  finalStart: async (_b: { finalId: string | number; caseId: string }) => ({
    seed: 1234567, variantId: fakeFinalCase().variants[0].id, variant: fakeFinalCase().variants[0], serverStartMs: Date.now(), elapsedMs: 0,
  }),
  finalSubmit: async (b: { finalId: string | number; caseId: string }) => {
    mem.finalSubmitted.add(`${b.finalId}:${b.caseId}`);
    return { received: true as const };
  },
  teacherClass: async (code: string) => {
    if (!code.trim()) throw new Error('forbidden');
    const players = [...mem.players];
    if (mem.me.nickname) players.push({ ...mem.me });
    return { className: 'Class 9B', players };
  },
  teacherRemove: async (_code: string, playerId: string) => {
    mem.players = mem.players.filter((p) => p.playerId !== playerId);
    return { removed: true as const };
  },
};
