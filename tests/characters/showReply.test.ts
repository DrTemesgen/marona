import { describe, expect, it } from 'vitest';
import type { CharacterProvider } from '../../src/shared/contract';
import { createStandInProvider, getProvider, PLANTED_BAD_REPLIES, reasonCode, showReply } from '../../src/characters/index';
import { loadFixture } from './helpers';

const c = loadFixture();
const line = (id: string) => c.lines.find((l) => l.id === id)!;
const trigger = (lineId: string) => ({ characterId: line(lineId).characterId, lineId, t: 2000 });

describe('showReply', () => {
  it('shows every scripted line unchanged and not replaced', async () => {
    for (const l of c.lines) {
      const shown = await showReply(getProvider('scripted'), c, trigger(l.id));
      expect(shown.replaced).toBe(false);
      expect(shown.reply.text).toBe(l.text);
    }
  });

  it('replaces every planted bad reply with the scripted line', async () => {
    for (const bad of PLANTED_BAD_REPLIES) {
      const shown = await showReply(createStandInProvider({ 'ct-cpr': bad.text }), c, trigger('ct-cpr'));
      expect(shown.replaced).toBe(true);
      expect(shown.reply).toEqual({ characterId: 'calltaker', lineId: 'ct-cpr', text: line('ct-cpr').text, emotion: 'calm' });
      expect(reasonCode({ ok: false, reason: shown.reason! })).toBe(bad.rule);
    }
  });

  it('shows a safe rewording as it is', async () => {
    const text = 'Push hard and fast, 100 to 120 times a minute, 5 to 6 cm deep.';
    const shown = await showReply(createStandInProvider({ 'ct-cpr': text }), c, trigger('ct-cpr'));
    expect(shown).toEqual({ reply: { characterId: 'calltaker', lineId: 'ct-cpr', text, emotion: 'calm' }, replaced: false });
  });

  it('falls back to the exact wrong advice when its text is changed', async () => {
    const shown = await showReply(createStandInProvider({ 'by-still-breathing': 'He is fine, leave him.' }), c, trigger('by-still-breathing'));
    expect(shown.replaced).toBe(true);
    expect(shown.reply.text).toBe(line('by-still-breathing').text);
  });

  it('falls back when the wrong advice is given under another line', async () => {
    const shown = await showReply(createStandInProvider({ 'by-help': line('by-still-breathing').text }), c, trigger('by-help'));
    expect(shown.replaced).toBe(true);
    expect(shown.reply.text).toBe('Somebody help! The teacher has fallen down!');
  });

  it('falls back when the provider fails or answers another line', async () => {
    const failing: CharacterProvider = { name: 'claude', reply: async () => Promise.reject(new Error('timeout')) };
    const failed = await showReply(failing, c, trigger('ct-cpr'));
    expect(failed.replaced).toBe(true);
    expect(failed.reply.text).toBe(line('ct-cpr').text);
    expect(failed.reason).toMatch(/^provider-error/);

    const wrongLine: CharacterProvider = {
      name: 'claude',
      reply: async () => ({ characterId: 'calltaker', lineId: 'ct-answer', text: 'Call 907.', emotion: 'calm' }),
    };
    const other = await showReply(wrongLine, c, trigger('ct-cpr'));
    expect(other.replaced).toBe(true);
    expect(other.reason).toMatch(/^other-line/);
  });

  it('passes on only the contract fields', async () => {
    const extra: CharacterProvider = {
      name: 'claude',
      reply: async () =>
        ({ characterId: 'teacher', lineId: 'te-pain', text: 'My chest hurts.', emotion: 'pain', html: '<b>x</b>' }) as never,
    };
    const shown = await showReply(extra, c, trigger('te-pain'));
    expect(shown.replaced).toBe(false);
    expect(Object.keys(shown.reply).sort()).toEqual(['characterId', 'emotion', 'lineId', 'text']);
  });

  it('throws for a line the case does not have', async () => {
    await expect(showReply(getProvider('scripted'), c, { characterId: 'teacher', lineId: 'missing', t: 0 })).rejects.toThrow(
      /no line missing/,
    );
  });
});
