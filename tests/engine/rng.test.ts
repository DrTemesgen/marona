import { describe, expect, it } from 'vitest';
import { mulberry32, shuffle } from '../../src/engine/rng';

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('gives different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const xs = Array.from({ length: 10 }, () => a());
    const ys = Array.from({ length: 10 }, () => b());
    expect(xs).not.toEqual(ys);
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const r = mulberry32(2026);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(Math.abs(sum / 20000 - 0.5)).toBeLessThan(0.02);
  });

  it('treats seeds as 32-bit unsigned values', () => {
    expect(mulberry32(0xffffffff)()).toBe(mulberry32(-1)());
  });

  // Golden values: if these change, every card order changes and old replays no longer match.
  it('matches the pinned golden values', () => {
    const r = mulberry32(42);
    const first = [r(), r(), r()].map((x) => Math.floor(x * 1e6));
    expect(first).toEqual(GOLDEN_42);
    expect(shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 7)).toEqual(GOLDEN_SHUFFLE_7);
  });
});

describe('shuffle', () => {
  it('returns a permutation and leaves the input alone', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    const copy = input.slice();
    const out = shuffle(input, 99);
    expect(input).toEqual(copy);
    expect(out.slice().sort()).toEqual(copy.slice().sort());
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(shuffle(items, 5)).toEqual(shuffle(items, 5));
    const orders = new Set(Array.from({ length: 10 }, (_, s) => shuffle(items, s).join(',')));
    expect(orders.size).toBeGreaterThan(5);
  });
});

// Computed with the published mulberry32 reference code, not with src/engine/rng.ts.
const GOLDEN_42 = [601103, 448290, 852465];
const GOLDEN_SHUFFLE_7 = [6, 5, 8, 1, 2, 3, 4, 7, 9, 0];
