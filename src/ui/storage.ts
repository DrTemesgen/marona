// localStorage wrapper that never throws (private mode, blocked storage).
const mem = new Map<string, string>();

// With ?fake=1 (the in-memory fake server) everything is kept under its own names, so a fake
// link can never overwrite a student's real session or an open final.
const fakeMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fake') === '1';

export function storageKey(key: string, fake = fakeMode): string {
  return `${fake ? 'fa.fake.' : 'fa.'}${key}`;
}

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(storageKey(key));
    } catch {
      return mem.get(storageKey(key)) ?? null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(storageKey(key), value);
    } catch {
      mem.set(storageKey(key), value);
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(storageKey(key));
    } catch {
      mem.delete(storageKey(key));
    }
  },
  getJson<T>(key: string, fallback: T): T {
    const raw = store.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    store.set(key, JSON.stringify(value));
  },
};

export interface Progress { played: boolean; best: number }

export function getProgress(caseId: string): Progress {
  return store.getJson<Progress>(`progress.${caseId}`, { played: false, best: 0 });
}

// Returns true when the score is a new personal best.
export function recordLocalScore(caseId: string, total: number): boolean {
  const p = getProgress(caseId);
  const isBest = !p.played || total > p.best;
  store.setJson(`progress.${caseId}`, { played: true, best: Math.max(p.best, total) });
  return isBest && p.played;
}
