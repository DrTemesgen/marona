import { useEffect, useRef, useState } from 'react';
import type { CaseFile, CharacterReply, GameCard, GameView, Mode, PlayerAction, ScoreReport, TranscriptEntry } from '../../shared/contract';
import { Avatar, Scene } from '../artAdapter';
import { Footer } from '../components/Layout';
import { advanceTo, applyAction, createGame, endGame, score, view, type GameState } from '../game/engineAdapter';
import { characterName, characterRole, lineReply } from '../game/lineText';
import { clockOrigin, startGameAt } from '../game/resume';
import { S } from '../strings.en';
import Rhythm from './Rhythm';

export interface RunRecord {
  caseId: string; mode: Mode; seed: number; variantId: string;
  actions: PlayerAction[]; endT: number; clientScore: number;
}
// transcript: the lines heard in this game, for the debrief's wrong-advice section.
export interface PlayResult { run: RunRecord; report: ScoreReport; transcript: TranscriptEntry[] }

interface Props {
  caseFile: CaseFile; mode: Mode; seed: number; variantId: string;
  // A final resumed after a reload: a fresh game whose clock starts here (ms, from the server).
  startAtMs?: number;
  onFinish: (r: PlayResult) => void;
}

// Guided mode runs the game clock at half speed, so there is more time to think.
const GUIDED_SCALE = 0.5;

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Play({ caseFile, mode, seed, variantId, startAtMs, onFinish }: Props) {
  const scale = mode === 'guided' ? GUIDED_SCALE : 1;
  const startAt = Math.max(0, Math.round(startAtMs ?? 0));
  const stateRef = useRef<GameState | null>(null);
  const startRef = useRef(clockOrigin(performance.now(), startAt, scale));
  const lastT = useRef(startAt);
  const actions = useRef<PlayerAction[]>([]);
  const finished = useRef(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  if (stateRef.current === null) {
    stateRef.current = startGameAt({ createGame, advanceTo }, { caseFile, seed, mode, variantId }, startAt);
  }
  const [gv, setGv] = useState<GameView>(() => view(stateRef.current as GameState));
  const [clock, setClock] = useState(startAt);
  const [rhythm, setRhythm] = useState<GameCard | null>(null);
  // Character replies arrive asynchronously; they are shown in transcript order only.
  const [replies, setReplies] = useState<CharacterReply[]>([]);
  const asked = useRef(0);
  const resolved = useRef(new Map<number, CharacterReply>());

  function nowT(): number {
    const t = Math.max(lastT.current, Math.round((performance.now() - startRef.current) * scale));
    lastT.current = t;
    return t;
  }

  function commit(next: GameState) {
    stateRef.current = next;
    const v = view(next);
    setGv(v);
    if (v.ended && !finished.current) {
      finished.current = true;
      setRhythm(null);
      onFinish({
        run: { caseId: caseFile.id, mode, seed, variantId, actions: [...actions.current], endT: lastT.current, clientScore: score(next).total },
        report: score(next),
        transcript: v.transcript,
      });
    }
  }

  // Timeline events happen while the student thinks.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (finished.current || !stateRef.current) return;
      const t = nowT();
      setClock(t);
      commit(advanceTo(stateRef.current, t));
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const list = gv.transcript;
    for (let i = asked.current; i < list.length; i++) {
      const idx = i;
      void lineReply(caseFile, list[idx]).then((r) => {
        resolved.current.set(idx, r);
        setReplies((prev) => {
          const next = [...prev];
          while (resolved.current.has(next.length)) next.push(resolved.current.get(next.length) as CharacterReply);
          return next.length === prev.length ? prev : next;
        });
      });
    }
    asked.current = Math.max(asked.current, list.length);
  }, [gv.transcript, caseFile]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' });
  }, [replies.length]);

  function act(actionId: string, payload?: { bpm?: number; count?: number }) {
    if (finished.current || !stateRef.current) return;
    const t = nowT();
    const pa: PlayerAction = payload ? { actionId, t, payload } : { actionId, t };
    try {
      const next = applyAction(stateRef.current, pa);
      actions.current.push(pa);
      setClock(t);
      commit(next);
    } catch {
      // The card was no longer available; the next tick refreshes the tray.
      commit(advanceTo(stateRef.current, t));
    }
  }

  function tapCard(card: GameCard) {
    if (card.kind === 'rhythm') setRhythm(card);
    else act(card.id);
  }

  function stop() {
    if (finished.current || !stateRef.current) return;
    const t = nowT();
    commit(endGame(stateRef.current, t));
  }

  const phase = caseFile.phases.find((p) => p.id === gv.phaseId)?.title ?? '';
  // Only counters with a friendly label, and only once they have started.
  const counters = Object.entries(gv.counters ?? {}).filter(([name, n]) => S.counters[name] && n > 0);
  const questions = gv.cards.filter((c) => c.kind === 'question');
  const others = gv.cards.filter((c) => c.kind !== 'question');

  return (
    <div className="flex flex-col" style={{ height: '100dvh' }} data-testid="screen-play" data-phase={gv.phaseId}>
      <header className="flex items-center gap-2 px-3 py-2" style={{ background: '#15803d', color: '#fff' }}>
        <div className="flex-1">
          <div style={{ fontSize: '.7rem', opacity: 0.9 }}>{mode === 'guided' ? S.scene.guidedTag : S.scene.realtimeTag}</div>
          <h1 style={{ fontSize: '1.15rem' }} data-testid="phase-title">{phase}</h1>
        </div>
        <div className="badge" style={{ fontSize: '1.1rem', height: '2.4rem', minWidth: '4.2rem', color: '#1f2937', background: '#facc15' }} role="timer" aria-label={S.scene.clock} data-testid="scene-clock">
          {fmt(clock)}
        </div>
      </header>

      <div style={{ height: '24dvh', minHeight: '8rem', flex: 'none', borderBottom: '3px solid #1f2937', background: '#fafaf9' }} data-testid="scene-art" data-casualty={gv.casualty}>
        <Scene scene={caseFile.scene} casualty={gv.casualty} className="h-full" />
      </div>

      {counters.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3 pt-2" aria-label={S.scene.counters} data-testid="counters">
          {counters.map(([name, n]) => (
            <span key={name} className="badge" style={{ background: '#e0f2fe', height: '2rem', padding: '0 .6rem' }} data-testid={`counter-${name}`}>
              {S.counters[name]}: {n}
            </span>
          ))}
        </div>
      ) : null}

      <section className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2" aria-label={S.scene.transcript} aria-live="polite" data-testid="transcript">
        {replies.map((r, i) => {
          const role = characterRole(caseFile, r.characterId);
          return (
            <div key={`${i}-${r.lineId}`} className="flex items-end gap-2 pop" data-testid="bubble" data-line={r.lineId}>
              <Avatar role={role} emotion={r.emotion} size={40} />
              <div className="bubble">
                <div style={{ fontSize: '.7rem', color: '#4b5563' }}>{characterName(caseFile, r.characterId)}</div>
                {r.text}
              </div>
            </div>
          );
        })}
        <div ref={transcriptEnd} />
      </section>

      <section className="flex flex-col gap-2 px-3 pt-2" style={{ maxHeight: '44dvh', overflowY: 'auto', background: '#f5f5f4', borderTop: '3px solid #1f2937' }} data-testid="tray">
        {questions.length > 0 ? (
          <div>
            <div style={{ fontSize: '.75rem' }}>{S.scene.questions}</div>
            <div className="flex flex-wrap gap-2 py-1">
              {questions.map((c) => (
                <button key={c.id} type="button" className="chip" data-testid={`card-${c.id}`} data-kind={c.kind} onClick={() => tapCard(c)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {others.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 pb-1">
            {others.map((c) => (
              <button key={c.id} type="button" className="action-card" data-testid={`card-${c.id}`} data-kind={c.kind} onClick={() => tapCard(c)}>
                <span>{c.label}</span>
                {mode === 'guided' && c.hint ? <small>{S.scene.hint}: {c.hint}</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {gv.cards.length === 0 ? <p>{S.scene.noCards}</p> : null}
        <button type="button" className="btn btn-wide" style={{ background: '#fde68a' }} data-testid="stop-finish" onClick={stop}>
          {S.scene.stop}
        </button>
        <Footer compact />
      </section>

      {rhythm ? (
        <Rhythm
          onSend={(p) => act(rhythm.id, p)}
          onClose={() => setRhythm(null)}
        />
      ) : null}
    </div>
  );
}
