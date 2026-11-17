import { useState } from 'react';
import { api } from '../api/client';
import { Page, TopBar } from '../components/Layout';
import { S } from '../strings.en';

interface Player { playerId: string; nickname: string; attempts: number; best: number | null }

export default function Teacher({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('');
  const [cls, setCls] = useState<{ className: string; players: Player[] } | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    try {
      setCls(await api.teacherClass(code.trim()));
    } catch {
      setError(S.teacher.err);
    }
  }

  async function remove(id: string) {
    try {
      await api.teacherRemove(code.trim(), id);
      setConfirming(null);
      await load();
    } catch {
      setError(S.teacher.err);
    }
  }

  return (
    <>
      <TopBar title={S.teacher.title} onBack={onBack} />
      <Page testId="screen-teacher">
        {cls === null ? (
          <form onSubmit={load} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span>{S.teacher.code}</span>
              <input className="field" type="password" autoComplete="off" data-testid="teacher-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
            <button type="submit" className="btn btn-primary btn-wide" data-testid="teacher-open" disabled={!code.trim()}>{S.teacher.open}</button>
          </form>
        ) : (
          <>
            <h2>{cls.className}</h2>
            {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
            {cls.players.length === 0 ? <p>{S.teacher.empty}</p> : null}
            <ul className="flex flex-col gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {cls.players.map((p) => (
                <li key={p.playerId} className="panel" data-testid="teacher-player">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{p.nickname}</span>
                    <span style={{ fontSize: '.85rem' }}>{S.teacher.attempts}: {p.attempts}</span>
                    <span style={{ fontSize: '.85rem' }}>{S.teacher.best}: {p.best ?? '-'}</span>
                  </div>
                  {confirming === p.playerId ? (
                    <div className="mt-2 flex flex-col gap-2" role="alertdialog" aria-label={S.teacher.confirmRemove(p.nickname)}>
                      <p>{S.teacher.confirmRemove(p.nickname)}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" className="btn btn-danger" data-testid="teacher-confirm" onClick={() => void remove(p.playerId)}>{S.teacher.confirm}</button>
                        <button type="button" className="btn" onClick={() => setConfirming(null)}>{S.teacher.cancel}</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="btn mt-2" data-testid="teacher-remove" onClick={() => setConfirming(p.playerId)}>{S.teacher.remove}</button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Page>
    </>
  );
}
