// The debrief section "Wrong advice you heard": every wrongAdvice line the student heard in this
// game, once each, with its correction (the teachingPoint of the harm the line names).
import type { CaseFile } from '../../shared/contract';

export interface HeardAdvice {
  lineId: string;
  characterId: string;
  text: string;
  correction: string; // '' when the line names no harm
}

export function wrongAdviceHeard(caseFile: CaseFile, transcript: readonly { lineId: string }[]): HeardAdvice[] {
  const seen = new Set<string>();
  const out: HeardAdvice[] = [];
  for (const entry of transcript) {
    if (seen.has(entry.lineId)) continue;
    const line = caseFile.lines.find((l) => l.id === entry.lineId);
    if (!line || !line.wrongAdvice) continue;
    seen.add(line.id);
    const harm = line.correctionHarmId ? caseFile.rubric.harms.find((h) => h.id === line.correctionHarmId) : undefined;
    out.push({ lineId: line.id, characterId: line.characterId, text: line.text, correction: harm?.teachingPoint ?? '' });
  }
  return out;
}
