import { cases } from '../content/loadVite';
import type { CaseFile } from '../shared/contract';
import { fakeCase } from './game/fakeCase';

// While no real case files exist, the built-in fake case stands in.
export const allCases: CaseFile[] = cases.length > 0 ? cases : [fakeCase];

export function findCase(caseId: string): CaseFile | undefined {
  return allCases.find((c) => c.id === caseId);
}

export function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

export function practiceVariant(c: CaseFile): string {
  const open = c.variants.filter((v) => !v.finalOnly);
  const pool = open.length > 0 ? open : c.variants;
  return pool[Math.floor(Math.random() * pool.length)].id;
}
