// Character lines shown to the student, routed through the character layer (src/characters):
// the scripted provider gives the case file's own checked line, and the safety filter decides
// what is shown. The AI providers stay off in this prototype.
import type { CaseFile, CharacterProvider, CharacterReply, TranscriptEntry } from '../../shared/contract';
import { getProvider, showReply } from '../../characters';

const provider: CharacterProvider = getProvider('scripted');

// The reply to show for one transcript entry. Never rejects: a content error shows an empty line.
export async function lineReply(caseFile: CaseFile, entry: TranscriptEntry): Promise<CharacterReply> {
  try {
    const shown = await showReply(provider, caseFile, { characterId: entry.characterId, lineId: entry.lineId, t: entry.t });
    return shown.reply;
  } catch {
    return { characterId: entry.characterId, lineId: entry.lineId, text: '', emotion: 'neutral' };
  }
}

export function characterRole(caseFile: CaseFile, characterId: string): string {
  return caseFile.characters.find((c) => c.id === characterId)?.role ?? 'bystander';
}

export function characterName(caseFile: CaseFile, characterId: string): string {
  return caseFile.characters.find((c) => c.id === characterId)?.name ?? '';
}
