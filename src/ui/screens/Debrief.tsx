import { useEffect, useRef, useState } from 'react';
import type { Ref } from '../../shared/contract';
import { api, type RunResult } from '../api/client';
import { findCase } from '../caseList';
import { characterName } from '../game/lineText';
import { wrongAdviceHeard } from '../game/wrongAdvice';
import { Page } from '../components/Layout';
import { S } from '../strings.en';
import { getProgress, recordLocalScore } from '../storage';
import type { PlayResult } from './Play';

function refText(r: Ref): string {
  return r.page.trim() && r.page !== 'to confirm' ? S.debrief.guideline(r.page) : S.debrief.pageToConfirm;
}

interface Props {
  result: PlayResult;
  onAgain: () => void;
  onBoards: () => void;
  onHome: () => void;
}

export default function Debrief({ result, onAgain, onBoards, onHome }: Props) {
  const { report, run } = result;
  const [saved, setSaved] = useState<RunResult | null>(null);
  const [newBest, setNewBest] = useState(false);
  const [best, setBest] = useState(0);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    setNewBest(recordLocalScore(run.caseId, report.total));
    setBest(getProgress(run.caseId).best);
    void api.postRun(run).then(setSaved);
  }, [run, report.total]);

  const offline = saved?.source === 'offline';
  const caseFile = findCase(run.caseId);
  const heard = caseFile ? wrongAdviceHeard(caseFile, result.transcript ?? []) : [];

  return (
    <Page testId="screen-debrief">
      <h1 className="pt-3">{S.debrief.title}</h1>
      <div className="panel panel-sun text-center">
        <div style={{ fontSize: '4.5rem', lineHeight: 1, fontWeight: 900 }} data-testid="debrief-score">{report.total}</div>
        <div>{S.debrief.scoreOutOf}</div>
        {newBest ? <div className="badge badge-gold mt-2">{S.debrief.newBest}</div> : null}
      </div>

      <p data-testid="debrief-save" style={{ fontSize: '.9rem' }}>
        {saved === null
          ? S.debrief.saving
          : offline
            ? S.debrief.savedLocal
            : saved.accepted === false
              ? S.debrief.notAccepted
              : S.debrief.savedServer(saved.serverScore ?? report.total)}
        {offline ? <span> - {S.debrief.personalBest(best)}</span> : null}
      </p>

      <section className="flex flex-col gap-3" aria-label={S.debrief.items}>
        <h2>{S.debrief.items}</h2>
        {report.items.map((it) => (
          <article key={it.id} className="panel" data-testid={`item-${it.status}`}>
            <div className="flex items-center gap-2">
              <span className={`badge badge-${it.status}`}>
                {it.status === 'done' ? S.debrief.done : it.status === 'late' ? S.debrief.late : it.status === 'na' ? S.debrief.na : S.debrief.missed}
              </span>
              {it.critical && it.status !== 'na' ? <span className="badge badge-sun" style={{ background: '#fef9c3' }}>{S.debrief.critical}</span> : null}
              <span className="flex-1 text-right" style={it.status === 'na' ? { fontSize: '.8rem', color: '#4b5563' } : undefined}>
                {it.status === 'na' ? S.debrief.notCounted(it.points) : S.debrief.points(it.earned, it.points)}
              </span>
            </div>
            <p className="mt-2" style={{ fontSize: '1.05rem' }}>{it.description}</p>
            <p style={{ fontWeight: 600 }}>{it.teachingPoint}</p>
            <p style={{ fontSize: '.8rem', color: '#4b5563' }}>{refText(it.ref)}</p>
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-label={S.debrief.harms}>
        <h2>{S.debrief.harms}</h2>
        {report.harms.length === 0 ? <p>{S.debrief.noHarms}</p> : null}
        {report.harms.map((h) => (
          <article key={h.id} className="panel" style={{ borderColor: '#dc2626' }} data-testid="harm">
            <div className="flex items-center gap-2">
              <span className="badge" style={{ background: '#fecaca' }}>{S.debrief.deduction(h.deduction)}</span>
            </div>
            <p className="mt-2" style={{ fontSize: '1.05rem' }}>{h.description}</p>
            <p style={{ fontWeight: 600 }}>{h.teachingPoint}</p>
            <p style={{ fontSize: '.8rem', color: '#4b5563' }}>{refText(h.ref)}</p>
          </article>
        ))}
      </section>

      {heard.length > 0 && caseFile ? (
        <section className="flex flex-col gap-3" aria-label={S.debrief.wrongAdvice} data-testid="wrong-advice">
          <h2>{S.debrief.wrongAdvice}</h2>
          {heard.map((w) => (
            <article key={w.lineId} className="panel" style={{ borderColor: '#f59e0b' }} data-testid="wrong-advice-line" data-line={w.lineId}>
              <p style={{ fontSize: '.8rem', color: '#4b5563' }}>{characterName(caseFile, w.characterId)}</p>
              <p style={{ fontSize: '1.05rem', textDecoration: 'line-through' }}>{w.text}</p>
              {w.correction ? (
                <p className="mt-2" style={{ fontWeight: 600 }}>{S.debrief.correction}: {w.correction}</p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel panel-leaf">
        <h2>{S.debrief.time}</h2>
        <p>{S.debrief.timeLine(report.timePoints, Math.round(report.durationMs / 1000))}</p>
      </section>

      <p className="panel" style={{ background: '#fffbeb', borderColor: '#f59e0b' }} data-testid="rhythm-note">{S.debrief.rhythmNote}</p>

      <div className="flex flex-col gap-3">
        <button type="button" className="btn btn-primary btn-wide" data-testid="play-again" onClick={onAgain}>{S.debrief.playAgain}</button>
        <button type="button" className="btn btn-sun btn-wide" data-testid="debrief-boards" onClick={onBoards}>{S.debrief.boards}</button>
        <button type="button" className="btn btn-wide" data-testid="debrief-home" onClick={onHome}>{S.debrief.home}</button>
      </div>
    </Page>
  );
}
