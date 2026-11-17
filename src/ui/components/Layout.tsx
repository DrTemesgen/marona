import type { ReactNode } from 'react';
import { S } from '../strings.en';

export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="footer-note" data-testid="footer" style={compact ? { padding: '.25rem .5rem', fontSize: '.65rem' } : undefined}>
      {S.footer}
    </footer>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-3 pt-3 pb-2">
      {onBack ? (
        <button type="button" className="btn" style={{ minWidth: '3.25rem', padding: '.4rem' }} onClick={onBack} aria-label={S.back} data-testid="back">
          <span aria-hidden="true">&lt;</span>
        </button>
      ) : null}
      <h1 className="flex-1" style={{ fontSize: '1.5rem' }}>{title}</h1>
      {right}
    </header>
  );
}

// The prototype notice: on the join and home screens until the clinical review is done.
export function PrototypeNotice() {
  return (
    <p className="notice" role="note" data-testid="prototype-notice">
      {S.prototype}
    </p>
  );
}

// A page with a scrolling body and the footer at the bottom.
export function Page({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="flex flex-1 flex-col" data-testid={testId}>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-1">{children}</main>
      <Footer />
    </div>
  );
}
