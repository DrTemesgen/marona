// In-memory fixed-window rate limiter. One process, one map; it forgets everything on restart.
// On a host with several server instances (the online demo) each instance counts on its own, so
// these limits slow a flood down but are not exact. Limits that protect stored data (the class
// cap, the run cap per player) are checked in the database instead.
export interface RateLimiter {
  // Counts one hit for `key`. Returns 0 when allowed, else the seconds until the window resets.
  hit(key: string, limit: number, windowMs: number): number;
  // Counts nothing. Returns the seconds until the window resets when `key` already has `limit`
  // hits in its window, else 0. Used for failed attempts: check first, hit only on a failure.
  check(key: string, limit: number): number;
}

const SWEEP_AT = 10_000; // sweep expired windows once the map grows past this many keys

export function createRateLimiter(now: () => number): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const wait = (resetAt: number, t: number) => Math.max(1, Math.ceil((resetAt - t) / 1000));
  return {
    hit(key, limit, windowMs) {
      const t = now();
      let w = windows.get(key);
      if (!w || t >= w.resetAt) {
        w = { count: 0, resetAt: t + windowMs };
        windows.set(key, w);
      }
      w.count += 1;
      if (windows.size > SWEEP_AT) {
        for (const [k, v] of windows) if (t >= v.resetAt) windows.delete(k);
      }
      return w.count <= limit ? 0 : wait(w.resetAt, t);
    },
    check(key, limit) {
      const t = now();
      const w = windows.get(key);
      if (!w || t >= w.resetAt) return 0;
      return w.count >= limit ? wait(w.resetAt, t) : 0;
    },
  };
}
