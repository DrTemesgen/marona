import { useCallback, useEffect, useState } from 'react';
import { api, NetworkError, type Session } from '../api/client';
import { Page, PrototypeNotice } from '../components/Layout';
import { S } from '../strings.en';

export default function Join({ onJoined }: { onJoined: (s: Session) => void }) {
  const [code, setCode] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // What the Retry button does after a network failure; null when there is nothing to retry.
  const [retry, setRetry] = useState<null | 'names' | 'join'>(null);

  const load = useCallback(async () => {
    setError('');
    setRetry(null);
    try {
      const r = await api.nicknames();
      setOptions(r.options.slice(0, 6));
      setNick('');
    } catch (e) {
      setError(e instanceof NetworkError ? S.noConnection : S.join.errNoServer);
      if (e instanceof NetworkError) setRetry('names');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function doJoin() {
    if (!code.trim() || !nick || busy) return;
    setBusy(true);
    setError('');
    setRetry(null);
    try {
      onJoined(await api.join(code.trim(), nick));
    } catch (e) {
      // No connection: say so and offer Retry. Never a pretend session.
      setError(e instanceof NetworkError ? S.noConnection : S.join.errNoServer);
      if (e instanceof NetworkError) setRetry('join');
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void doJoin();
  }

  return (
    <Page testId="screen-join">
      <div className="flex items-center gap-3 pt-4">
        <img src="/icon.svg" alt="" width={56} height={56} />
        <div>
          <div style={{ fontSize: '.9rem' }}>{S.appName}</div>
          <h1>{S.join.title}</h1>
        </div>
      </div>
      <PrototypeNotice />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>{S.join.classCode}</span>
          <input
            className="field" data-testid="join-code" value={code} maxLength={32} autoCapitalize="characters"
            autoComplete="off" placeholder={S.join.classCodeHint} onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="mb-1">{S.join.pick}</legend>
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o} type="button" className="chip" aria-pressed={nick === o} data-testid="nickname-option"
                onClick={() => setNick(o)}
              >
                {o}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost" data-testid="nickname-more" onClick={() => void load()}>
            {S.join.showOthers}
          </button>
        </fieldset>
        {error ? <p role="alert" style={{ color: '#b91c1c' }} data-testid="join-error">{error}</p> : null}
        {retry ? (
          <button type="button" className="btn btn-sun btn-wide" data-testid="join-retry" onClick={() => void (retry === 'names' ? load() : doJoin())}>
            {S.retry}
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary btn-wide" data-testid="join-submit" disabled={!code.trim() || !nick || busy}>
          {S.join.button}
        </button>
        <p className="text-center" style={{ fontWeight: 700 }}>{S.join.privacy}</p>
      </form>
    </Page>
  );
}
