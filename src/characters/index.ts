// The character layer: pick a provider, ask it for a line, and show the reply only if the
// safety filter passes it; otherwise show the checked scripted line for the same line id.
import type { CaseFile, CharacterProvider, CharacterReply, CharacterTrigger } from '../shared/contract';
import { filterReply } from './filter';
import { createScriptedProvider, scriptedLine } from './scripted';
import { createStandInProvider } from './standin';

export { filterReply, reasonCode, DANGER_RULES, LIMITS } from './filter';
export { createScriptedProvider, scriptedLine } from './scripted';
export { createStandInProvider, PLANTED_BAD_REPLIES } from './standin';

export interface ShownReply {
  reply: CharacterReply;
  replaced: boolean; // true when the scripted line was shown instead of the provider's reply
  reason?: string; // why it was replaced (filter reason or provider error)
}

export function getProvider(name: 'scripted' | 'standin', script: Record<string, string> = {}): CharacterProvider {
  if (name === 'scripted') return createScriptedProvider();
  if (name === 'standin') return createStandInProvider(script);
  throw new Error(`unknown character provider: ${String(name)}`);
}

export async function showReply(
  provider: CharacterProvider,
  caseFile: CaseFile,
  trigger: CharacterTrigger,
): Promise<ShownReply> {
  // Throws when the case has no such line: that is a content error, not something to hide.
  const fallback = scriptedLine(caseFile, trigger.lineId);
  let reply: CharacterReply;
  try {
    reply = await provider.reply(caseFile, trigger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reply: fallback, replaced: true, reason: `provider-error: ${message}` };
  }
  if (!reply || reply.lineId !== trigger.lineId) {
    return { reply: fallback, replaced: true, reason: `other-line: asked for ${trigger.lineId}` };
  }
  const result = filterReply(reply, caseFile);
  if (!result.ok) return { reply: fallback, replaced: true, reason: result.reason };
  // Copy only the contract fields, so nothing else a provider adds reaches the screen.
  const shown: CharacterReply = {
    characterId: reply.characterId,
    lineId: reply.lineId,
    text: reply.text,
    emotion: reply.emotion,
  };
  return { reply: shown, replaced: false };
}
