import { useRef, useState } from 'react';
import { S } from '../strings.en';

// Taps are handed in as sets of 10 (the rest when the player stops), each with the rate measured
// from the real time between taps. The engine counts every tap as one compression.
export const SET_SIZE = 10;
const MIN = 100;
const MAX = 120;
const GAP_RESET_MS = 3000; // a longer pause starts a new run of taps
export const BPM_MIN = 1;
export const BPM_MAX = 400; // the server accepts 1 to 400

// Taps per minute over the intervals between the given tap times (ms), clamped to 1-400.
// 0 when there is no interval to measure.
export function measuredBpm(times: number[]): number {
  if (times.length < 2) return 0;
  const span = times[times.length - 1] - times[0];
  if (!(span > 0)) return BPM_MAX;
  const bpm = Math.round(((times.length - 1) / span) * 60000);
  return Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));
}

interface Props {
  onSend: (p: { bpm: number; count: number }) => void;
  onClose: () => void;
}

export default function Rhythm({ onSend, onClose }: Props) {
  // Wall-clock tap times of the current run of taps; `handed` of them are already in sets.
  const times = useRef<number[]>([]);
  const handed = useRef(0);
  const [pending, setPending] = useState(0);
  const [sets, setSets] = useState(0);
  const [live, setLive] = useState(0);

  // Hands in the taps after `handed`. Its rate also uses the last tap of the set before it, so
  // no interval is lost between sets. Returns false when there is nothing to measure.
  function handIn(): boolean {
    const arr = times.current;
    const count = arr.length - handed.current;
    if (count < 1) return false;
    const from = Math.max(0, handed.current - 1);
    const bpm = measuredBpm(arr.slice(from));
    if (bpm === 0) return false; // a single tap with nothing before it
    handed.current = arr.length;
    onSend({ bpm, count });
    setSets((k) => k + 1);
    return true;
  }

  function tap() {
    const now = performance.now();
    const arr = times.current;
    if (arr.length > 0 && now - arr[arr.length - 1] > GAP_RESET_MS) {
      handIn();
      arr.length = 0;
      handed.current = 0;
    }
    arr.push(now);
    try {
      navigator.vibrate?.(15);
    } catch {
      /* not supported */
    }
    setLive(measuredBpm(arr.slice(-8)));
    if (arr.length - handed.current >= SET_SIZE) handIn();
    setPending(arr.length - handed.current);
  }

  function stop() {
    handIn();
    onClose();
  }

  const shown = live;
  const inside = shown >= MIN && shown <= MAX;
  const zone = shown === 0 ? 'idle' : inside ? 'ok' : 'warn';
  // The scale runs 60 to 160 taps per minute.
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - 60) / 100) * 100))}%`;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={S.rhythm.title} data-testid="rhythm-overlay">
      <h2>{S.rhythm.title}</h2>
      <p className="text-center">{S.rhythm.instruction}</p>
      <div style={{ width: '100%', maxWidth: '22rem' }}>
        <div className="band" aria-hidden="true">
          <div className="band-target" style={{ left: pos(MIN), width: `${((MAX - MIN) / 100) * 100}%` }} />
          {shown > 0 ? <div className="band-marker" style={{ left: pos(shown) }} /> : null}
        </div>
        <div className="flex justify-between" style={{ fontSize: '.75rem' }}>
          <span>60</span>
          <span>{S.rhythm.target}</span>
          <span>160</span>
        </div>
      </div>
      <div className="text-center" aria-live="polite">
        <div style={{ fontSize: '3rem', lineHeight: 1, fontWeight: 900, color: zone === 'ok' ? '#15803d' : zone === 'warn' ? '#b45309' : '#1f2937' }} data-testid="rhythm-bpm">
          {shown}
        </div>
        <div style={{ fontSize: '.9rem' }}>{S.rhythm.tapsPerMinute}</div>
        <div style={{ fontSize: '.9rem' }} data-testid="rhythm-hint">
          {zone === 'ok' ? S.rhythm.inside : zone === 'warn' ? (shown < MIN ? S.rhythm.tooSlow : S.rhythm.tooFast) : ''}
        </div>
      </div>
      <button
        type="button" className="tap-target" data-zone={zone === 'warn' ? 'warn' : 'ok'} data-testid="rhythm-tap"
        onPointerDown={(e) => { e.preventDefault(); tap(); }}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) tap(); } }}
      >
        {S.rhythm.tap}
      </button>
      <div className="text-center">
        <div data-testid="rhythm-count" style={{ fontSize: '1.1rem' }}>{S.rhythm.count(pending, SET_SIZE)}</div>
        <div data-testid="rhythm-sets" data-sets={sets} style={{ fontSize: '.95rem' }}>{S.rhythm.sets(sets)}</div>
      </div>
      <button type="button" className="btn btn-wide" style={{ maxWidth: '22rem' }} data-testid="rhythm-stop" onClick={stop}>{S.rhythm.stop}</button>
      <p style={{ fontSize: '.8rem' }}>{S.rhythm.stopHint}</p>
    </div>
  );
}
