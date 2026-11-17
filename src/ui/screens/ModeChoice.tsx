import type { CaseFile, Mode } from '../../shared/contract';
import { Page, TopBar } from '../components/Layout';
import { S } from '../strings.en';

export default function ModeChoice({ caseFile, onChoose, onBack }: { caseFile: CaseFile; onChoose: (m: Mode) => void; onBack: () => void }) {
  return (
    <>
      <TopBar title={caseFile.shortTitle} onBack={onBack} />
      <Page testId="screen-mode">
        <p style={{ fontWeight: 700 }}>{caseFile.intro}</p>
        <h2>{S.mode.title}</h2>
        <button type="button" className="action-card panel-leaf" style={{ background: '#dcfce7', minHeight: '6.5rem' }} data-testid="mode-guided" onClick={() => onChoose('guided')}>
          <span style={{ fontSize: '1.4rem' }}>{S.mode.guided}</span>
          <small style={{ fontSize: '.95rem' }}>{S.mode.guidedText}</small>
        </button>
        <button type="button" className="action-card" style={{ background: '#fef9c3', minHeight: '6.5rem' }} data-testid="mode-realtime" onClick={() => onChoose('realtime')}>
          <span style={{ fontSize: '1.4rem' }}>{S.mode.realtime}</span>
          <small style={{ fontSize: '.95rem' }}>{S.mode.realtimeText}</small>
        </button>
      </Page>
    </>
  );
}
