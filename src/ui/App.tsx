import { useEffect, useState } from 'react';
import type { CaseFile, Mode, Variant } from '../shared/contract';
import { onBusy, tokenAllowed, type Session } from './api/client';
import { findCase, newSeed, practiceVariant } from './caseList';
import { store } from './storage';
import { S } from './strings.en';
import Boards from './screens/Boards';
import Debrief from './screens/Debrief';
import Final, { FinalDone } from './screens/Final';
import Home from './screens/Home';
import Join from './screens/Join';
import ModeChoice from './screens/ModeChoice';
import Play, { type PlayResult } from './screens/Play';
import Teacher from './screens/Teacher';

type Screen =
  | { name: 'join' }
  | { name: 'home' }
  | { name: 'mode'; caseId: string }
  | { name: 'play'; caseId: string; mode: Mode; seed: number; variantId: string; finalId?: string | number; variant?: Variant; startAtMs?: number; key: number }
  | { name: 'debrief'; result: PlayResult }
  | { name: 'finalDone'; finalId: string | number; result: PlayResult }
  | { name: 'boards'; from: 'home' | 'debrief' }
  | { name: 'final' }
  | { name: 'teacher' };

// A final plays a variant the phone does not carry: add the one the server sent before createGame.
function withVariant(c: CaseFile, v?: Variant): CaseFile {
  if (!v) return c;
  return { ...c, variants: [...c.variants.filter((x) => x.id !== v.id), v] };
}

// A short notice while the client waits to retry after the server said "too many requests".
function BusyBanner() {
  const [wait, setWait] = useState(0);
  useEffect(() => onBusy(setWait), []);
  if (wait <= 0) return null;
  return (
    <div role="status" data-testid="busy-banner" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60, background: '#fde68a', padding: '.5rem 1rem', textAlign: 'center', fontWeight: 700 }}>
      {S.busy(wait)}
    </div>
  );
}

// A fake token (from ?fake=1) is never used outside ?fake=1: drop it and join again.
function loadSession(): Session | null {
  const s = store.getJson<Session | null>('session', null);
  if (s && tokenAllowed(s.token)) return s;
  if (s || store.get('token')) {
    store.remove('token');
    store.remove('session');
  }
  return null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [screen, setScreen] = useState<Screen>(() => (loadSession() ? { name: 'home' } : { name: 'join' }));
  const [runKey, setRunKey] = useState(0);

  function joined(s: Session) {
    if (!tokenAllowed(s.token)) return;
    store.set('token', s.token);
    store.set('nickname', s.nickname);
    store.setJson('session', s);
    setSession(s);
    setScreen({ name: 'home' });
  }

  function switchPlayer() {
    store.remove('token');
    store.remove('nickname');
    store.remove('session');
    setSession(null);
    setScreen({ name: 'join' });
  }

  function startPractice(caseId: string, mode: Mode) {
    const c = findCase(caseId);
    if (!c) return;
    setRunKey((k) => k + 1);
    setScreen({ name: 'play', caseId, mode, seed: newSeed(), variantId: practiceVariant(c), key: runKey + 1 });
  }

  const home = () => setScreen({ name: 'home' });

  let body;
  if (!session || screen.name === 'join') {
    body = <Join onJoined={joined} />;
  } else if (screen.name === 'home') {
    body = (
      <Home
        session={session}
        onPick={(caseId) => setScreen({ name: 'mode', caseId })}
        onBoards={() => setScreen({ name: 'boards', from: 'home' })}
        onFinal={() => setScreen({ name: 'final' })}
        onTeacher={() => setScreen({ name: 'teacher' })}
        onSwitch={switchPlayer}
      />
    );
  } else if (screen.name === 'mode') {
    const c = findCase(screen.caseId);
    body = c ? <ModeChoice caseFile={c} onBack={home} onChoose={(m) => startPractice(c.id, m)} /> : null;
  } else if (screen.name === 'play') {
    const base = findCase(screen.caseId);
    const c = base ? withVariant(base, screen.variant) : undefined;
    const { finalId } = screen;
    body = c ? (
      <Play
        key={screen.key}
        caseFile={c}
        mode={screen.mode}
        seed={screen.seed}
        variantId={screen.variantId}
        startAtMs={screen.startAtMs}
        onFinish={(result) =>
          setScreen(finalId ? { name: 'finalDone', finalId, result } : { name: 'debrief', result })
        }
      />
    ) : null;
  } else if (screen.name === 'debrief') {
    const { result } = screen;
    body = (
      <Debrief
        result={result}
        onAgain={() => startPractice(result.run.caseId, result.run.mode)}
        onBoards={() => setScreen({ name: 'boards', from: 'debrief' })}
        onHome={home}
      />
    );
  } else if (screen.name === 'finalDone') {
    body = <FinalDone finalId={screen.finalId} result={screen.result} onBack={() => setScreen({ name: 'final' })} />;
  } else if (screen.name === 'boards') {
    body = <Boards nickname={session.nickname} onBack={home} />;
  } else if (screen.name === 'final') {
    body = (
      <Final
        onBack={home}
        onStart={({ finalId, caseId, seed, variantId, variant, elapsedMs }) => {
          setRunKey((k) => k + 1);
          // After a reload the server says how long ago the final started: the clock resumes there.
          setScreen({ name: 'play', caseId, mode: 'realtime', seed, variantId, finalId, variant, startAtMs: elapsedMs, key: runKey + 1 });
        }}
      />
    );
  } else {
    body = <Teacher onBack={home} />;
  }

  return (
    <div className="app-shell">
      <BusyBanner />
      {body}
    </div>
  );
}
