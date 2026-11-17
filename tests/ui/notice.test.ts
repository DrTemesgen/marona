import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { alreadySubmitted, HttpError, NetworkError } from '../../src/ui/api/client';
import Home from '../../src/ui/screens/Home';
import Join from '../../src/ui/screens/Join';
import { storageKey } from '../../src/ui/storage';
import { S } from '../../src/ui/strings.en';

const noop = () => undefined;
const session = { token: 't', playerId: '1', nickname: 'Brave Falcon 27', className: 'Class A1', schoolName: 'Test School A' };

// Until the clinical review is done, the first screens say so in plain words.
describe('prototype notice', () => {
  it('says prototype, under clinical review, not for teaching', () => {
    expect(S.prototype).toMatch(/^Prototype\./);
    expect(S.prototype).toContain('under clinical review');
    expect(S.prototype).toContain('Not for teaching');
    expect(S.footer).toMatch(/^Prototype /);
  });

  it('is on the join screen and the home screen', () => {
    const join = renderToStaticMarkup(createElement(Join, { onJoined: noop }));
    const home = renderToStaticMarkup(
      createElement(Home, { session, onPick: noop, onBoards: noop, onFinal: noop, onTeacher: noop, onSwitch: noop }),
    );
    for (const html of [join, home]) {
      expect(html).toContain('data-testid="prototype-notice"');
      expect(html).toContain('under clinical review');
    }
  });
});

describe('final submit retried after a lost answer', () => {
  it('counts a 409 "already submitted" as received, nothing else', () => {
    expect(alreadySubmitted(new HttpError(409, 'already submitted'))).toBe(true);
    expect(alreadySubmitted(new HttpError(409, 'not started'))).toBe(false);
    expect(alreadySubmitted(new HttpError(403, 'final closed'))).toBe(false);
    expect(alreadySubmitted(new NetworkError())).toBe(false);
  });
});

describe('fake mode keeps its own storage', () => {
  it('uses fa.fake. names with ?fake=1, so a fake link cannot overwrite a real session', () => {
    expect(storageKey('token', false)).toBe('fa.token');
    expect(storageKey('token', true)).toBe('fa.fake.token');
  });
});
