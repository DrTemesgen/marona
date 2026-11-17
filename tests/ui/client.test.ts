import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onBusy, retryAfterSeconds } from '../../src/ui/api/client';
import { measuredBpm } from '../../src/ui/screens/Rhythm';

// Integration step 2: the client waits and retries once after a 429, and shows a short notice.
describe('client: 429 with Retry-After', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reads Retry-After as 1 to 60 whole seconds, 5 when missing or odd', () => {
    expect(retryAfterSeconds('3')).toBe(3);
    expect(retryAfterSeconds('0')).toBe(1);
    expect(retryAfterSeconds('600')).toBe(60);
    expect(retryAfterSeconds(null)).toBe(5);
    expect(retryAfterSeconds('soon')).toBe(5);
    expect(retryAfterSeconds(new Date(10_000).toUTCString(), 2_000)).toBe(8);
  });

  it('waits as asked, retries once, and clears the notice', async () => {
    vi.useFakeTimers();
    const replies = [
      new Response(JSON.stringify({ error: 'too many requests' }), { status: 429, headers: { 'Retry-After': '2' } }),
      new Response(JSON.stringify({ options: ['Brave Falcon 27'] }), { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => replies.shift() as Response);
    vi.stubGlobal('fetch', fetchMock);
    const notices: number[] = [];
    const off = onBusy((s) => notices.push(s));
    const pending = api.nicknames();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ options: ['Brave Falcon 27'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notices).toEqual([2, 0]);
    off();
  });

  it('gives up after one retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: 'too many requests' }), { status: 429, headers: { 'Retry-After': '1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = api.nicknames();
    const check = expect(pending).rejects.toThrow('too many requests');
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('rhythm: rate from real tap times', () => {
  it('measures taps a minute over the intervals and clamps to 1-400', () => {
    expect(measuredBpm([0])).toBe(0);
    expect(measuredBpm([0, 550, 1100])).toBe(109);
    expect(measuredBpm([0, 10, 20])).toBe(400);
    expect(measuredBpm([0, 0])).toBe(400);
    expect(measuredBpm([0, 120_000])).toBe(1);
  });
});
