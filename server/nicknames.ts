// Word-pair nicknames, for example "Brave Falcon 27". Players never type free text: the server
// offers options from these lists and accepts only a nickname built from them.
// Word choice rules: friendly words only; no person names; no colours or words that can be read
// as remarks about skin or body; no primates; no animals used as insults; nothing that sounds
// like "cheater" (so no "Cheetah") or evokes alcohol brands (so no "Kingfisher").
import { randomInt } from 'node:crypto';

export const ADJECTIVES: readonly string[] = [
  'Agile', 'Alert', 'Bold', 'Brave', 'Bright', 'Calm', 'Careful', 'Caring', 'Cheerful', 'Clever',
  'Cosmic', 'Curious', 'Daring', 'Eager', 'Epic', 'Fearless', 'Friendly', 'Gentle', 'Golden', 'Happy',
  'Helpful', 'Heroic', 'Honest', 'Humble', 'Jolly', 'Joyful', 'Keen', 'Kind', 'Lively', 'Loyal',
  'Lucky', 'Merry', 'Mighty', 'Nimble', 'Patient', 'Peaceful', 'Plucky', 'Polite', 'Quick', 'Radiant',
  'Rapid', 'Ready', 'Sharp', 'Sincere', 'Smart', 'Speedy', 'Spirited', 'Steady', 'Stellar', 'Strong',
  'Sturdy', 'Swift', 'Thoughtful', 'Trusty', 'Valiant', 'Vivid', 'Warm', 'Wise', 'Witty', 'Zippy',
];

export const NOUNS: readonly string[] = [
  // animals
  'Antelope', 'Bison', 'Buffalo', 'Butterfly', 'Crane', 'Dolphin', 'Dragonfly', 'Eagle', 'Falcon', 'Flamingo',
  'Gazelle', 'Gecko', 'Giraffe', 'Hawk', 'Heron', 'Hummingbird', 'Ibex', 'Impala', 'Jaguar', 'Koala',
  'Kudu', 'Leopard', 'Lion', 'Lynx', 'Meerkat', 'Okapi', 'Oryx', 'Otter', 'Owl', 'Panda',
  'Parrot', 'Pelican', 'Penguin', 'Seahorse', 'Stork', 'Swan', 'Tiger', 'Turtle', 'Wolf', 'Zebra',
  // objects
  'Anchor', 'Arrow', 'Beacon', 'Canyon', 'Comet', 'Compass', 'Glacier', 'Harbor', 'Island', 'Kite',
  'Lantern', 'Lighthouse', 'Meteor', 'Mountain', 'Orbit', 'Planet', 'River', 'Rocket', 'Summit', 'Thunder',
];

// Two-digit numbers 10-99, without numbers teenagers or hate groups use as codes.
export const EXCLUDED_NUMBERS: ReadonlySet<number> = new Set([69, 88]);
export const NUMBERS: readonly number[] = Array.from({ length: 90 }, (_, i) => i + 10).filter(
  (n) => !EXCLUDED_NUMBERS.has(n),
);

const ADJ_SET = new Set(ADJECTIVES);
const NOUN_SET = new Set(NOUNS);
const NUMBER_SET = new Set(NUMBERS);
const PATTERN = /^([A-Z][a-z]+) ([A-Z][a-z]+) ([1-9][0-9])$/;

export function isValidNickname(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = PATTERN.exec(value);
  if (!m) return false;
  return ADJ_SET.has(m[1]) && NOUN_SET.has(m[2]) && NUMBER_SET.has(Number(m[3]));
}

// rand(n) returns an integer in [0, n). Injectable for tests.
export type RandomIndex = (n: number) => number;
const cryptoIndex: RandomIndex = (n) => randomInt(n);

export function randomNickname(rand: RandomIndex = cryptoIndex): string {
  return `${ADJECTIVES[rand(ADJECTIVES.length)]} ${NOUNS[rand(NOUNS.length)]} ${NUMBERS[rand(NUMBERS.length)]}`;
}

// `count` distinct random nicknames (fewer only if the random source keeps repeating). The server
// asks the database once which of them are taken, instead of once per nickname.
export function nicknameCandidates(count: number, rand: RandomIndex = cryptoIndex): string[] {
  const out = new Set<string>();
  for (let tries = 0; out.size < count && tries < count * 20; tries++) out.add(randomNickname(rand));
  return [...out];
}

// Up to `count` distinct nicknames that are not taken. Bounded number of tries.
export function nicknameOptions(
  count: number,
  isTaken: (nickname: string) => boolean,
  rand: RandomIndex = cryptoIndex,
): string[] {
  const out = new Set<string>();
  for (let tries = 0; out.size < count && tries < count * 20; tries++) {
    const n = randomNickname(rand);
    if (!out.has(n) && !isTaken(n)) out.add(n);
  }
  return [...out];
}
