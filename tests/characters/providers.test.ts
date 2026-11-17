import { describe, expect, it } from 'vitest';
import { createScriptedProvider } from '../../src/characters/scripted';
import { createStandInProvider } from '../../src/characters/standin';
import { getProvider } from '../../src/characters/index';
import { loadFixture } from './helpers';

const c = loadFixture();

describe('scripted provider', () => {
  const p = createScriptedProvider();

  it('is named scripted', () => {
    expect(p.name).toBe('scripted');
  });

  it('returns every line of the case exactly: text, emotion and speaker', async () => {
    expect(c.lines.length).toBeGreaterThan(5);
    for (const line of c.lines) {
      const r = await p.reply(c, { characterId: line.characterId, lineId: line.id, t: 1000 });
      expect(r).toEqual({ characterId: line.characterId, lineId: line.id, text: line.text, emotion: line.emotion });
    }
  });

  it('returns the planned wrong advice unchanged', async () => {
    const r = await p.reply(c, { characterId: 'shopkeeper', lineId: 'by-still-breathing', t: 0 });
    expect(r.text).toBe('Wait, he is still breathing. Let him rest.');
    expect(r.emotion).toBe('worried');
  });

  it('keeps the line speaker even when the trigger names someone else', async () => {
    const r = await p.reply(c, { characterId: 'shopkeeper', lineId: 'ct-cpr', t: 0 });
    expect(r.characterId).toBe('calltaker');
  });

  it('throws when the line is missing', async () => {
    await expect(p.reply(c, { characterId: 'calltaker', lineId: 'no-such-line', t: 0 })).rejects.toThrow(
      /no line no-such-line/,
    );
  });
});

describe('stand-in provider', () => {
  it('returns the canned text by line id, with the line speaker and emotion', async () => {
    const p = createStandInProvider({ 'ct-cpr': 'Push 150 times a minute.' });
    expect(p.name).toBe('standin');
    const r = await p.reply(c, { characterId: 'calltaker', lineId: 'ct-cpr', t: 0 });
    expect(r).toEqual({ characterId: 'calltaker', lineId: 'ct-cpr', text: 'Push 150 times a minute.', emotion: 'calm' });
  });

  it('falls back to the scripted line when it has no canned reply', async () => {
    const p = createStandInProvider({ 'ct-cpr': 'anything' });
    const r = await p.reply(c, { characterId: 'teacher', lineId: 'te-pain', t: 0 });
    expect(r.text).toBe('My chest hurts. I need to sit down.');
  });

  it('throws for a missing line it has no canned reply for', async () => {
    const p = createStandInProvider({});
    await expect(p.reply(c, { characterId: 'teacher', lineId: 'nope', t: 0 })).rejects.toThrow();
  });
});

describe('getProvider', () => {
  it('builds the scripted and stand-in providers', async () => {
    expect(getProvider('scripted').name).toBe('scripted');
    const s = getProvider('standin', { 'te-pain': 'Ow, my chest.' });
    expect(s.name).toBe('standin');
    expect((await s.reply(c, { characterId: 'teacher', lineId: 'te-pain', t: 0 })).text).toBe('Ow, my chest.');
  });

  it('rejects an unknown provider name', () => {
    expect(() => getProvider('claude' as never)).toThrow(/unknown character provider/);
  });
});
