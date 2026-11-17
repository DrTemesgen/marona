// Shared helpers for the character layer tests (not a test file itself).
import raw from '../fixtures/characters-case.json';
import type { CaseFile, CharacterReply, FilterResult } from '../../src/shared/contract';
import { validateCase } from '../../src/shared/validateCase';
import { filterReply, reasonCode } from '../../src/characters/filter';

export function loadFixture(): CaseFile {
  const check = validateCase(structuredClone(raw));
  if (!check.ok) throw new Error(`fixture is invalid:\n${check.errors.join('\n')}`);
  return check.caseFile;
}

export function replyFor(caseFile: CaseFile, lineId: string, text: string): CharacterReply {
  const line = caseFile.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(`fixture has no line ${lineId}`);
  return { characterId: line.characterId, lineId, text, emotion: line.emotion };
}

// The fixture plus one extra call-taker line with the given checked text. The extended case must
// still pass validateCase, so the tests never run on a broken case.
export function caseWithCheckedLine(checked: string, id = 'x-checked'): CaseFile {
  const base = structuredClone(raw) as { lines: unknown[] };
  base.lines.push({ id, characterId: 'calltaker', text: checked, emotion: 'calm' });
  const check = validateCase(base);
  if (!check.ok) throw new Error(`extended fixture is invalid:\n${check.errors.join('\n')}`);
  return check.caseFile;
}

// Filter `reworded` as an AI rewording of a call-taker line whose checked text is `checked`.
export function filterAs(reworded: string, checked: string = reworded): FilterResult {
  const c = caseWithCheckedLine(checked);
  return filterReply(replyFor(c, 'x-checked', reworded), c);
}

export function codeOf(result: FilterResult): string {
  return reasonCode(result) ?? 'ok';
}
