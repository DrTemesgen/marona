import { useEffect, useRef, useState } from 'react';
import type { Variant } from '../../shared/contract';
import { alreadySubmitted, api, NetworkError, type FinalInfo } from '../api/client';
import { findCase } from '../caseList';
import { Page, TopBar } from '../components/Layout';
import { S } from '../strings.en';
import { store } from '../storage';
import type { PlayResult } from './Play';

function when(at?: number | string): string {
  if (at === undefined || at === '') return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : d.toLocaleString();
}

type FinalId = string | number;

// elapsedMs: how long ago the server saw this start (more than 0 after a reload during the game).
export interface FinalStartInfo { finalId: FinalId; caseId: string; seed: number; variantId: string; variant?: Variant; elapsedMs?: number }

export function finalKey(finalId: FinalId, caseId: string): string {
  return `final.${finalId}.${caseId}`;
}

export default function Final({ onStart, onBack }: { onStart: (p: FinalStartInfo) => void; onBack: () => void }) {
  const [info, setInfo] = useState<FinalInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [retry, setRetry] = useState<null | (() => void)>(null);
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .finalCurrent()
      .then((f) => live && setInfo(f))
      .catch((e) => {
        if (!live) return;
        setError(e instanceof NetworkError ? S.noConnection : S.final.errStart);
        setRetry(() => () => {
          setError('');
          setRetry(null);
          setLoads((n) => n + 1);
        });
      });
    return () => {
      live = false;
    };
  }, [loads]);

  async function start(finalId: FinalId, caseId: string) {
    setBusy(caseId);
    setError('');
    setRetry(null);
    try {
      const r = await api.finalStart(finalId, caseId);
      // The final's variant comes from the server: the phone app carries no final variants.
      onStart({ finalId, caseId, seed: r.seed, variantId: r.variantId, variant: r.variant, elapsedMs: r.elapsedMs });
    } catch (e) {
      setError(e instanceof NetworkError ? S.noConnection : S.final.errStart);
      if (e instanceof NetworkError) setRetry(() => () => void start(finalId, caseId));
      setBusy('');
    }
  }

  return (
    <>
      <TopBar title={S.final.title} onBack={onBack} />
      <Page testId="screen-final">
        {info === null && !error ? <p>{S.loading}</p> : null}
        {error ? <p role="alert" style={{ color: '#b91c1c' }} data-testid="final-error">{error}</p> : null}
        {retry ? (
          <button type="button" className="btn btn-sun btn-wide" data-testid="final-retry" onClick={retry}>{S.retry}</button>
        ) : null}
        {info && !info.finalId ? <p>{S.final.none}</p> : null}
        {info && info.finalId ? (
          <>
            <div className="panel panel-sun">
              <p><strong>{S.final.opens}:</strong> <span data-testid="final-opens">{when(info.opensAt)}</span></p>
              <p><strong>{S.final.closes}:</strong> <span data-testid="final-closes">{when(info.closesAt)}</span></p>
              <p className="mt-2"><span className={`badge ${info.open ? 'badge-done' : 'badge-soon'}`}>{info.open ? S.final.open : S.final.notOpen}</span></p>
              <p className="mt-2" style={{ fontSize: '.9rem' }}>{S.final.rules}</p>
            </div>
            <ul className="flex flex-col gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {(info.caseIds ?? []).map((cid) => {
                const c = findCase(cid);
                const done = store.get(finalKey(info.finalId as FinalId, cid)) === '1';
                return (
                  <li key={cid} className="panel flex items-center gap-3">
                    <span className="flex-1">{c ? `${S.home.chapter(c.chapter)}: ${c.shortTitle}` : cid}</span>
                    {done ? (
                      <span className="badge badge-done">{S.final.submitted}</span>
                    ) : (
                      <button type="button" className="btn btn-primary" data-testid={`final-start-${cid}`} disabled={!info.open || busy !== ''} onClick={() => void start(info.finalId as FinalId, cid)}>
                        {S.final.start}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </Page>
    </>
  );
}

// Shown after a final run: submits the actions, then says the result is sealed. No score here.
export function FinalDone({ finalId, result, onBack }: { finalId: FinalId; result: PlayResult; onBack: () => void }) {
  const [state, setState] = useState<'sending' | 'sealed' | 'error'>('sending');
  const [offline, setOffline] = useState(false);
  const sent = useRef(false);

  function submit() {
    setState('sending');
    api
      .finalSubmit({ finalId, caseId: result.run.caseId, actions: result.run.actions, endT: result.run.endT })
      .then(() => {
        store.set(finalKey(finalId, result.run.caseId), '1');
        setState('sealed');
      })
      .catch((e) => {
        // The first try reached the server but its answer was lost: the game is in, so sealed.
        if (alreadySubmitted(e)) {
          store.set(finalKey(finalId, result.run.caseId), '1');
          setState('sealed');
          return;
        }
        setOffline(e instanceof NetworkError);
        setState('error');
      });
  }

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Page testId="screen-final-done">
      <h1 className="pt-4">{S.final.title}</h1>
      {state === 'sending' ? <p>{S.final.submitting}</p> : null}
      {state === 'sealed' ? <p className="panel panel-leaf" style={{ fontSize: '1.2rem' }} data-testid="final-sealed">{S.final.sealed}</p> : null}
      {state === 'error' ? (
        <>
          <p role="alert" style={{ color: '#b91c1c' }}>{offline ? S.noConnection : S.final.errSubmit}</p>
          <button type="button" className="btn btn-primary btn-wide" onClick={submit}>{S.retry}</button>
        </>
      ) : null}
      <button type="button" className="btn btn-wide" data-testid="final-back" onClick={onBack} disabled={state === 'sending'}>{S.final.back}</button>
    </Page>
  );
}
