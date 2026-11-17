import { useEffect, useState } from 'react';
import { api, type FinalInfo, type Session } from '../api/client';
import { allCases } from '../caseList';
import { Page, PrototypeNotice } from '../components/Layout';
import { S } from '../strings.en';
import { getProgress } from '../storage';

interface Props {
  session: Session;
  onPick: (caseId: string) => void;
  onBoards: () => void;
  onFinal: () => void;
  onTeacher: () => void;
  onSwitch: () => void;
}

export default function Home({ session, onPick, onBoards, onFinal, onTeacher, onSwitch }: Props) {
  const [fin, setFin] = useState<FinalInfo | null>(null);

  useEffect(() => {
    let live = true;
    api.finalCurrent().then((f) => live && setFin(f)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <Page testId="screen-home">
      <div className="pt-3">
        <p style={{ fontSize: '.95rem' }} data-testid="home-nickname">{S.home.hello(session.nickname)}</p>
        <p style={{ fontSize: '.8rem', color: '#4b5563' }}>{S.home.classLine(session.className, session.schoolName)}</p>
        <h1 className="mt-1">{S.home.title}</h1>
      </div>

      <PrototypeNotice />

      {fin && fin.finalId ? (
        <button type="button" className="action-card" data-kind="call" data-testid="final-card" onClick={onFinal}>
          <span style={{ fontSize: '1.3rem' }}>{S.home.finalTitle}</span>
          <small>{fin.open ? S.home.finalOpen : S.home.finalSoon}</small>
        </button>
      ) : null}

      <ol className="flex flex-col gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const c = allCases.find((x) => x.chapter === n);
          if (!c) {
            return (
              <li key={n}>
                <div className="panel flex items-center gap-3" style={{ opacity: 0.7, background: '#f5f5f4' }} data-testid={`chapter-soon-${n}`}>
                  <span className="badge badge-soon" style={{ width: '2.4rem', height: '2.4rem' }}>{n}</span>
                  <span className="flex-1">{S.home.chapter(n)}</span>
                  <span className="badge badge-soon">{S.home.comingSoon}</span>
                </div>
              </li>
            );
          }
          const p = getProgress(c.id);
          return (
            <li key={n}>
              <button
                type="button" className="action-card" style={{ flexDirection: 'row', alignItems: 'center', gap: '.75rem' }}
                data-testid={`chapter-open-${n}`} onClick={() => onPick(c.id)}
              >
                <span className="badge badge-new" style={{ width: '2.6rem', height: '2.6rem', fontSize: '1.1rem' }}>{n}</span>
                <span className="flex-1">{c.shortTitle}</span>
                {p.played ? (
                  <span className="flex flex-col items-end gap-1">
                    <span className="badge badge-played">{S.home.statusPlayed}</span>
                    <small>{S.home.best(p.best)}</small>
                  </span>
                ) : (
                  <span className="badge badge-new">{S.home.statusNew}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <button type="button" className="btn btn-sun btn-wide" data-testid="open-boards" onClick={onBoards}>
        {S.home.boards}
      </button>

      <div className="flex items-center justify-between">
        <button type="button" className="btn btn-ghost" data-testid="open-teacher" onClick={onTeacher}>{S.home.teacher}</button>
        <button type="button" className="btn btn-ghost" data-testid="switch-player" onClick={onSwitch}>{S.home.switchPlayer}</button>
      </div>
    </Page>
  );
}
