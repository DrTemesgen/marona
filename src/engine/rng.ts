// Seeded 32-bit pseudo random numbers (mulberry32) and a seeded shuffle.
// The same seed gives the same sequence on every phone and on the server, so a game can be
// replayed exactly. Changing this algorithm changes every card order: keep it stable.

export type Rng = () => number;

// Returns a generator of numbers in [0, 1). The seed is taken as a 32-bit unsigned integer.
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle driven by the seed. Returns a new array; the input is not changed.
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
