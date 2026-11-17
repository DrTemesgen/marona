import { describe, expect, it } from 'vitest';
import { caseFileNames, loadCasesFromDisk } from '../../src/content/loadNode';
import { STATIC_CASE_FILES, loadStaticCases } from '../../src/content/loadStatic';

// The online demo's API reads the case files from static imports, not from the disk.
describe('static case list (online demo)', () => {
  it('lists exactly the .json files in src/content', () => {
    expect(Object.keys(STATIC_CASE_FILES).sort()).toEqual(caseFileNames());
  });

  it('gives the same full case files as the disk loader, final-only variants included', () => {
    const fromDisk = loadCasesFromDisk();
    expect(loadStaticCases()).toEqual(fromDisk);
    expect(fromDisk.some((c) => c.variants.some((v) => v.finalOnly))).toBe(true);
  });
});
