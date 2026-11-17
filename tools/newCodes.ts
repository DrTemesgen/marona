// Prints a new random class code and teacher code for a hosted demo. Random from node:crypto,
// in letters and digits that are hard to mix up on a phone (no 0, O, 1, I or L).
// Give the codes only to the demo's owner, who enters them in the host's environment settings
// (DEMO_CLASS_CODE, DEMO_TEACHER_CODE). Never put them in git, a README or a chat with others.
// Usage: npx tsx tools/newCodes.ts
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomGroups(groups: number, size = 4, rand: (n: number) => number = randomInt): string {
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let part = '';
    for (let i = 0; i < size; i++) part += ALPHABET[rand(ALPHABET.length)];
    parts.push(part);
  }
  return parts.join('-');
}

// Class code: 12 signs (about 59 bits), 14 characters, easy to type in the join field.
// Teacher code: 16 signs (about 79 bits).
export function newDemoCodes(rand?: (n: number) => number): { classCode: string; teacherCode: string } {
  return { classCode: randomGroups(3, 4, rand), teacherCode: randomGroups(4, 4, rand) };
}

const invokedAs = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (process.platform === 'win32' ? invokedAs.toLowerCase() === self.toLowerCase() : invokedAs === self) {
  const { classCode, teacherCode } = newDemoCodes();
  console.log(`DEMO_CLASS_CODE=${classCode}`);
  console.log(`DEMO_TEACHER_CODE=${teacherCode}`);
}
