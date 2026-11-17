import { useEffect, useState } from 'react';
import type { BoardEntry } from '../../shared/contract';
import { api } from '../api/client';
import { Page, TopBar } from '../components/Layout';
import { S } from '../strings.en';
import { store } from '../storage';

type Scope = 'class' | 'school';

function medal(rank: number): { cls: string; label: string } | null {
  if (rank === 1) return { cls: 'badge-gold', label: S.boards.gold };
  if (rank === 2) return { cls: 'badge-silver', label: S.boards.silver };
  if (rank === 3) return { cls: 'badge-bronze', label: S.boards.bronze };
  return null;
}

export default function Boards({ nickname, onBack }: { nickname: string; onBack: () => void }) {
  const [scope, setScope] = useState<Scope>('class');
  const [entries, setEntries] = useState<BoardEntry[] | null>(null);
  const [error, setError] = useState(false);
  const me = nickname || store.get('nickname') || '';

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(false);
    api.boards(scope).then((r) => live && setEntries(r.entries)).catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [scope]);

  return (
    <>
      <TopBar title={S.boards.title} onBack={onBack} />
      <Page testId="screen-boards">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" className="tab" aria-selected={scope === 'class'} data-testid="tab-class" onClick={() => setScope('class')}>{S.boards.class}</button>
          <button type="button" role="tab" className="tab" aria-selected={scope === 'school'} data-testid="tab-school" onClick={() => setScope('school')}>{S.boards.school}</button>
        </div>
        <p style={{ fontSize: '.9rem', fontWeight: 700 }} data-testid="boards-realtime-only">{S.boards.realtimeOnly}</p>
        {error ? <p role="alert">{S.boards.offline}</p> : null}
        {entries === null && !error ? <p>{S.loading}</p> : null}
        {entries && entries.length === 0 ? <p>{S.boards.empty}</p> : null}
        <ol className="flex flex-col gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="board-list">
          {(entries ?? []).map((e) => {
            const m = medal(e.rank);
            const mine = e.nickname === me;
            return (
              <li key={`${e.rank}-${e.nickname}`} className={`flex items-center gap-3 px-3 py-2 ${mine ? 'row-me' : ''}`} style={{ minHeight: '3.25rem', borderBottom: mine ? undefined : '2px solid #e7e5e4' }} data-testid={mine ? 'board-row-me' : 'board-row'}>
                <span className={`badge ${m ? m.cls : ''}`} style={{ minWidth: '2.4rem', height: '2.4rem' }} aria-label={m ? `${m.label} ${e.rank}` : `${S.boards.rank} ${e.rank}`}>{e.rank}</span>
                <span className="flex-1">{e.nickname}{mine ? <span style={{ fontSize: '.75rem' }}> ({S.boards.you})</span> : null}</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 900 }}>{e.score}</span>
              </li>
            );
          })}
        </ol>
      </Page>
    </>
  );
}
