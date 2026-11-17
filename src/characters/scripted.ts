// The scripted character provider: every reply is the case file's own checked line, unchanged.
import type { CaseFile, CharacterProvider, CharacterReply, CharacterTrigger } from '../shared/contract';

export function scriptedLine(caseFile: CaseFile, lineId: string): CharacterReply {
  const line = caseFile.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(`case ${caseFile.id} has no line ${lineId}`);
  // The speaker comes from the line itself, so a line can never be shown in another voice.
  return { characterId: line.characterId, lineId: line.id, text: line.text, emotion: line.emotion };
}

export function createScriptedProvider(): CharacterProvider {
  return {
    name: 'scripted',
    async reply(caseFile: CaseFile, trigger: CharacterTrigger): Promise<CharacterReply> {
      return scriptedLine(caseFile, trigger.lineId);
    },
  };
}
