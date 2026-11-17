// The reply safety filter. Today it checks scripted lines; later it checks every line an AI model
// phrases, and the game shows a reply only when filterReply says ok (contract.ts).
// The rules a clinician reviews live in patterns.ts. This file is the machinery. It fails closed:
// anything it cannot read or check is blocked, and the game then shows the checked scripted line.
//
// Order of checks (the first failure is the reason):
//   shape, line exists, speaker matches the line, emotion is valid,
//   (a) planned wrong advice: passes by line id with its exact text only,
//   length (d), hidden or non-English characters, URL / e-mail / phone (d),
//   (b) dangerous advice (DANGER_RULES), (c) CPR rate, depth and checking time (LIMITS),
//   (e) no new numbers: every number must already be in the checked line (907 always allowed).
import { Emotion, type CaseFile, type CharacterReply, type FilterResult } from '../shared/contract';
import { DANGER_RULES, LIMITS, type DangerRule } from './patterns';

export { DANGER_RULES, LIMITS } from './patterns';

export function filterReply(reply: CharacterReply, caseFile: CaseFile): FilterResult {
  try {
    return check(reply, caseFile);
  } catch {
    return block('filter-error', 'the reply could not be checked');
  }
}

/** The reason code of a blocked result, for example "danger/give-drink" or "rate". */
export function reasonCode(result: FilterResult): string | null {
  if (result.ok) return null;
  const colon = result.reason.indexOf(':');
  return colon < 0 ? result.reason : result.reason.slice(0, colon);
}

function block(code: string, detail: string): FilterResult {
  return { ok: false, reason: `${code}: ${detail}` };
}

function check(reply: CharacterReply, caseFile: CaseFile): FilterResult {
  if (
    !reply ||
    typeof reply !== 'object' ||
    typeof reply.text !== 'string' ||
    typeof reply.lineId !== 'string' ||
    typeof reply.characterId !== 'string'
  ) {
    return block('bad-shape', 'a reply needs characterId, lineId and text');
  }
  const line = caseFile.lines.find((l) => l.id === reply.lineId);
  if (!line) return block('unknown-line', `case ${caseFile.id} has no line ${reply.lineId}`);
  if (reply.characterId !== line.characterId) {
    return block('wrong-character', `line ${line.id} belongs to ${line.characterId}, not ${reply.characterId}`);
  }
  if (!Emotion.safeParse(reply.emotion).success) return block('bad-emotion', `unknown emotion ${String(reply.emotion)}`);

  // (a) Planned wrong advice is allowed by its id, with its exact text, and nothing else.
  if (line.wrongAdvice) {
    return reply.text === line.text
      ? { ok: true }
      : block('wrong-advice-changed', `planned wrong advice ${line.id} must be shown exactly as written`);
  }

  const text = reply.text;
  if (text.trim() === '') return block('empty', 'the reply has no text');
  if (text.length > LIMITS.maxLength) {
    return block('too-long', `${text.length} characters; the limit is ${LIMITS.maxLength}`);
  }
  if (HIDDEN.test(text)) return block('hidden-characters', 'invisible or control characters');
  const plain = toPlain(text);
  if (/[^\t\n\r\x20-\x7e]/.test(plain)) {
    return block('unchecked-characters', 'characters outside plain English text cannot be checked');
  }
  const lower = forMatching(plain);

  // (d) No links, e-mail addresses or phone numbers other than 907.
  if (URL_RE.test(lower)) return block('url', 'links are not allowed');
  if (EMAIL_RE.test(lower)) return block('email', 'e-mail addresses and handles are not allowed');
  const phone = phoneNumberIn(lower);
  if (phone) return block('phone', `only ${LIMITS.allowedPhoneNumber} may be named, found ${phone}`);

  // (b) Dangerous advice.
  const danger = dangerIn(lower);
  if (danger) return block(`danger/${danger.rule.id}`, `"${danger.excerpt}"`);

  // (c) CPR numbers.
  const view = numericView(lower);
  const numeric = numericProblem(view);
  if (numeric) return block(numeric.code, numeric.detail);

  // (e) The AI may reword a line but not change or add a number.
  const known = new Set(numbersIn(numericView(forMatching(toPlain(line.text)))));
  for (const n of numbersIn(view)) {
    if (n !== Number(LIMITS.allowedPhoneNumber) && !known.has(n)) {
      return block('new-number', `${n} is not in the checked line ${line.id}`);
    }
  }
  return { ok: true };
}

// ---------- Text clean-up ----------

// Invisible and control characters (zero-width spaces, direction marks, soft hyphens...). They
// can hide words from the patterns, and real lines never contain them.
const HIDDEN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]/;

// Wide letters become plain letters (NFKC); curly quotes, dashes and bullets become plain ones.
function toPlain(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201a\u201b\u2032`\u00b4]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2022\u00b7]/g, '-');
}

function forMatching(plain: string): string {
  return plain
    .toLowerCase()
    .replace(/[ \t]*[\r\n]+[ \t]*/g, '. ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ---------- (d) Links, e-mail, phone ----------

const URL_RE =
  /\b(?:https?|ftp|file|mailto|tel|sms|javascript|whatsapp|tg):|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|int|info|io|ly|et|uk|app|dev|tv|xyz|biz|site|online|link|ai|health|news|gl|gg)\b|\b[a-z0-9-]+\.[a-z]{2,}\/\S|\b[a-z0-9-]+ dot (?:com|org|net|edu|gov|et)\b/;

// Any "@" (addresses and social media handles) or a spelled-out "(at)".
const EMAIL_RE = /@|\(at\)|\[at\]/;

// Seven or more digits in a row, with or without spaces, dots, dashes or brackets.
const LONG_NUMBER = /(?<!\d)\+?\s*\d(?:[\s().-]*\d){6,}/;
const CALL_WORD =
  /\b(?:call|calling|dial|dialing|dialling|ring|ringing|phone|phoning|text|texting|sms|whatsapp|telegram|contact|number|hotline)\b/g;
const NEXT_NUMBER = /^\s*(?:,|or|and|\/)?\s*(?:the\s+)?(?:number\s+)?(\+?\d[\d-]*\d|\d)/;

function phoneNumberIn(lower: string): string | null {
  const long = LONG_NUMBER.exec(lower);
  if (long) return long[0].trim();
  // A short number of three or more digits right after "call", "dial", "number"...
  for (const m of lower.matchAll(CALL_WORD)) {
    let rest = lower.slice((m.index ?? 0) + m[0].length);
    for (let k = 0; k < 5; k++) {
      const n = NEXT_NUMBER.exec(rest);
      if (!n) break;
      const digits = n[1].replace(/\D/g, '');
      if (digits.length >= 3 && digits !== LIMITS.allowedPhoneNumber) return n[1];
      rest = rest.slice(n[0].length);
    }
  }
  return null;
}

// ---------- (b) Dangerous advice, with negation ----------

// "do not", "never"... directly before the matched words make them safe teaching.
const CUE = String.raw`do not|don't|dont|never|must not|mustn't|should not|shouldn't|cannot|can't|cant|can not|will not|won't|no one should|nobody should|avoid`;
// Words allowed between the cue and the matched words: "do not EVER give", "do not WASTE TIME checking".
const FILLER = String.raw`ever|even|try to|attempt to|need to|have to|waste time on|waste time by|waste time|bother to|bother|be tempted to|let anyone|allow anyone to`;
const NEG_END = new RegExp(String.raw`(?:^|[^a-z'])(?:${CUE})(?:,?\s+ever,?)?\s+(?:(?:${FILLER})\s+)?$`);
// "do not move him OR give him water": the cue carries over "or" / "nor" in the same clause...
const OR_CHAIN = new RegExp(String.raw`(?:^|[^a-z'])(?:${CUE})\s+((?:[a-z']+\s+){1,6}?)(?:or|nor)\s+$`);
// ...unless the words in between turn it around ("don't forget to call or give him water").
const CHAIN_BREAKERS = /\b(?:forget|hesitate|fail|wait|delay|stop|afraid|scared|worry|panic|shy|need|just|but|then|instead|until|unless|let)\b/;
// A listed thing preceded by "not" / "no" / "without": "cool it with water, not ice".
const NOUN_NEG_END = /(?:^|[^a-z'])(?:not|no|never|without|instead of|rather than)\s+(?:any\s+|some\s+)?$/;
// "put NOTHING in her mouth", "give him NO water" are negated inside the match, unless an
// exception follows in the sentence ("put nothing in his mouth EXCEPT a spoon").
const OBJECT_NEG = /\b(?:nothing|no)\b(?!\s+(?:one|doubt|matter|problem|time|need)\b)/;
const EXCEPTION = /\b(?:but|except|other than|apart from|besides|save for|unless)\b/;
// A harm phrase that is itself negated does not excuse a mention: "butter does NOT make it worse".
const STATEMENT_NEG_END =
  /(?:^|[^a-z'])(?:not|never|no|cannot|can't|don't|do not|doesn't|does not|didn't|did not|won't|will not|isn't|is not|aren't|are not)\s+$/;

interface CompiledPattern {
  re: RegExp;
  kind: 'say' | 'mention' | 'strict';
}
const COMPILED: { rule: DangerRule; patterns: CompiledPattern[] }[] = DANGER_RULES.map((rule) => ({
  rule,
  patterns: rule.patterns.map((p) => ({ re: new RegExp(p.re.source, 'gd'), kind: p.kind })),
}));

interface Hit {
  start: number;
  end: number;
  safe: boolean;
  strict: boolean;
  text: string;
}

function dangerIn(lower: string): { rule: DangerRule; excerpt: string } | null {
  for (const { rule, patterns } of COMPILED) {
    const hits: Hit[] = [];
    for (const p of patterns) {
      for (const m of lower.matchAll(p.re)) {
        if (!m[0]) continue;
        const start = m.index ?? 0;
        const thingStart = m.indices?.groups?.thing?.[0];
        let safe = false;
        if (p.kind !== 'strict') {
          safe = isNegated(lower, start, start + m[0].length, thingStart);
          if (!safe && p.kind === 'mention' && rule.harmPhrase) safe = sentenceSaysHarm(lower, start, rule.harmPhrase);
        }
        hits.push({ start, end: start + m[0].length, safe, strict: p.kind === 'strict', text: m[0] });
      }
    }
    // A match is excused when it is negated, or when it is part of a negated match of the same
    // rule ("do not put butter, toothpaste or ice on a burn" is one negated instruction).
    const bad = hits.find(
      (h) => !h.safe && (h.strict || !hits.some((o) => o.safe && !o.strict && o.start < h.end && h.start < o.end)),
    );
    if (bad) return { rule, excerpt: bad.text.slice(0, 80) };
  }
  return null;
}

function sentenceStart(text: string, i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    const c = text[j];
    if (c === '.' || c === '!' || c === '?' || c === ';' || c === ':') return j + 1;
    if (c === '-' && text[j - 1] === ' ' && text[j + 1] === ' ') return j + 1;
  }
  return 0;
}

function sentenceEnd(text: string, i: number): number {
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '.' || c === '!' || c === '?' || c === ';' || c === ':') return j;
    if (c === '-' && text[j - 1] === ' ' && text[j + 1] === ' ') return j;
  }
  return text.length;
}

function isNegated(text: string, start: number, end: number, thingStart?: number): boolean {
  const s0 = sentenceStart(text, start);
  const prefix = text.slice(s0, start);
  if (NEG_END.test(prefix)) return true;
  const chain = OR_CHAIN.exec(prefix);
  if (chain && !CHAIN_BREAKERS.test(chain[1])) return true;
  if (thingStart !== undefined && NOUN_NEG_END.test(text.slice(s0, thingStart))) return true;
  const inside = OBJECT_NEG.exec(text.slice(start, end));
  if (inside && !EXCEPTION.test(text.slice(start + inside.index, sentenceEnd(text, start)))) return true;
  return false;
}

function sentenceSaysHarm(text: string, at: number, harm: RegExp): boolean {
  const sentence = text.slice(sentenceStart(text, at), sentenceEnd(text, at));
  for (const m of sentence.matchAll(new RegExp(harm.source, 'g'))) {
    if (!STATEMENT_NEG_END.test(sentence.slice(0, m.index))) return true;
  }
  return false;
}

// ---------- (c) Numbers: rate, depth, checking time ----------

const UNITS_19 =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const UNITS_9 = 'one|two|three|four|five|six|seven|eight|nine';
const TENS_WORDS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const BELOW_100 = String.raw`(?:(?:${TENS_WORDS})(?:[\s-](?:${UNITS_9}))?|${UNITS_19})`;
const WORD_NUMBER = new RegExp(
  String.raw`\b(?:(?:a|${UNITS_9})\s+hundred(?:\s+(?:and\s+)?${BELOW_100})?|${BELOW_100})(?:\s+and\s+a\s+half)?\b`,
  'g',
);
const UNIT_AFTER_ONE = /^\s+(?:hundred\b|minutes?\b|min\b|seconds?\b|secs?\b|cms?\b|centimet|mm\b|millimet|inch|times?\b|per\b)/;

function wordValue(phrase: string): number {
  const words = phrase.replace(/-/g, ' ').split(/\s+/);
  const units = UNITS_19.split('|');
  const tens = ['', '', ...TENS_WORDS.split('|')];
  let value = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'and' && words[i + 1] === 'a' && words[i + 2] === 'half') return value + 0.5;
    if (w === 'a') value = value || 1;
    else if (w === 'hundred') value = (value || 1) * 100;
    else if (units.includes(w)) value += units.indexOf(w);
    else if (tens.includes(w)) value += tens.indexOf(w) * 10;
  }
  return value;
}

// Number words become digits ("a hundred and twenty" -> "120", "twice a second" -> "2 times a
// second"). "one" counts only before a unit ("one minute"), not in "no one" or "one of you".
function numericView(lower: string): string {
  return lower
    .replace(/\b(\d+)\s+and\s+a\s+half\b/g, (_m, n: string) => `${n}.5`)
    .replace(/\bonce(?=\s+(?:a|per|every|each)\s+(?:second|sec|minute|min)\b)/g, '1 times')
    .replace(/\btwice(?=\s+(?:a|per|every|each)\s+(?:second|sec|minute|min)\b)/g, '2 times')
    .replace(WORD_NUMBER, (phrase: string, offset: number, whole: string) => {
      if (phrase === 'one' && !UNIT_AFTER_ONE.test(whole.slice(offset + phrase.length))) return phrase;
      return String(wordValue(phrase));
    });
}

function numbersIn(view: string): number[] {
  return [...view.matchAll(/(?<![\d.])\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

const NUM = String.raw`(?<![\d.])\d+(?:\.\d+)?`;
const QUAL_UP = 'at least|more than|over|above|faster than|greater than|no less than|not less than|no slower than|not slower than|a minimum of|minimum of';
const QUAL_DOWN = 'less than|under|below|slower than|fewer than|at most|no more than|not more than|up to|no faster than|not faster than|a maximum of|maximum of';
const APPROX = 'about|around|roughly|approximately|approx|nearly|almost|close to|some|between';
const SUFFIX_UP = String.raw`\+|or more|or faster|or higher|or above|plus`;
const SUFFIX_DOWN = 'or less|or fewer|or slower|or lower|or below';
// Groups: 1 qualifier, 2 first number, 3 second number of a range, 4 suffix.
const LEAD = String.raw`(?:\b(${QUAL_UP}|${QUAL_DOWN})\s+)?(?:\b(?:${APPROX})\s+)?`;
const AMOUNT = String.raw`(${NUM})(?:\s*(?:-|to|and|or)\s*(${NUM}))?\s*(${SUFFIX_UP}|${SUFFIX_DOWN})?`;
const RATE_NOUNS = 'chest compressions|compressions|times|pushes|presses|pumps|beats|counts';
const PER_MIN = String.raw`per minute|a minute|each minute|every minute|in a minute|in 1 minute|per min|a min|\/\s?minute|\/\s?min|bpm|cpm|beats per minute|beats a minute`;
const PER_SEC = String.raw`per second|a second|each second|every second|\/\s?second|\/\s?sec|\/\s?s`;
// Groups 5 and 6: per minute or per second.
const RATE_RE = new RegExp(String.raw`${LEAD}${AMOUNT}\s*(?:(?:${RATE_NOUNS})\s+)?(?:(${PER_MIN})|(${PER_SEC}))(?![a-z])`, 'g');
// "a rate of 150" with no unit is read as per minute.
const RATE_OF_RE = new RegExp(
  String.raw`\b(?:rate|pace|speed|tempo|beat)\s+of\s+${LEAD}${AMOUNT}(?!\s*(?:(?:${RATE_NOUNS})\s+)?(?:${PER_MIN}|${PER_SEC}))`,
  'g',
);
const CM = 'centimetres|centimeters|centimetre|centimeter|cms|cm';
const MM = 'millimetres|millimeters|millimetre|millimeter|mm';
const INCH = 'inches|inch';
// A size, not a depth: "a cut 10 cm long", "a 3 cm burn".
const SIZE_AFTER =
  'long|wide|across|in length|in diameter|in size|tall|away|apart|from|of|cut|wound|gash|burn|scar|bruise|bandage|strip|piece|square|blister|tear|laceration|big|large|larger|bigger|deep cut|deep wound';
// Groups 5, 6, 7: cm, mm, inch.
const DEPTH_RE = new RegExp(
  String.raw`${LEAD}${AMOUNT}\s*-?\s*(?:(${CM})|(${MM})|(${INCH}))(?![a-z])(?!\s+(?:${SIZE_AFTER})\b)`,
  'g',
);
const CHECK_TIME_RE = new RegExp(
  String.raw`\b(?:check|checking|checks|look|looking|listen|listening|feel|feeling|watch|watching)\b[^.!?;:]{0,40}?\bfor\s+${LEAD}${AMOUNT}\s*(?:seconds?|secs?)\b`,
  'g',
);

type Direction = 'up' | 'down' | null;

function direction(qualifier?: string, suffix?: string): Direction {
  if (qualifier) return new RegExp(`^(?:${QUAL_UP})$`).test(qualifier) ? 'up' : 'down';
  if (suffix) return new RegExp(`^(?:${SUFFIX_UP})$`).test(suffix) ? 'up' : 'down';
  return null;
}

// Outside the range? "at least N" passes only for the minimum and "no more than N" only for
// the maximum, because an open-ended number invites going too fast or too deep.
function outside(values: number[], dir: Direction, min: number, max: number): boolean {
  if (values.length === 1 && dir === 'up') return values[0] !== min;
  if (values.length === 1 && dir === 'down') return values[0] !== max;
  return values.some((v) => v < min || v > max);
}

function amount(m: RegExpMatchArray, factor = 1): { values: number[]; dir: Direction } {
  const values = [Number(m[2]) * factor];
  if (m[3] !== undefined) values.push(Number(m[3]) * factor);
  return { values, dir: m[3] !== undefined ? null : direction(m[1], m[4]) };
}

function numericProblem(view: string): { code: string; detail: string } | null {
  const rate = LIMITS.compressionRatePerMin;
  for (const m of view.matchAll(RATE_RE)) {
    const { values, dir } = amount(m, m[6] !== undefined ? 60 : 1);
    if (outside(values, dir, rate.min, rate.max)) {
      return { code: 'rate', detail: `"${m[0].trim()}" is outside ${rate.min}-${rate.max} per minute` };
    }
  }
  for (const m of view.matchAll(RATE_OF_RE)) {
    const { values, dir } = amount(m);
    if (outside(values, dir, rate.min, rate.max)) {
      return { code: 'rate', detail: `"${m[0].trim()}" is outside ${rate.min}-${rate.max} per minute` };
    }
  }
  for (const m of view.matchAll(DEPTH_RE)) {
    const unit = m[5] !== undefined ? 'cm' : m[6] !== undefined ? 'mm' : 'inch';
    const { min, max } = LIMITS.depth[unit];
    const { values, dir } = amount(m);
    if (outside(values, dir, min, max)) {
      return { code: 'depth', detail: `"${m[0].trim()}" is outside ${min}-${max} ${unit}` };
    }
  }
  for (const m of view.matchAll(CHECK_TIME_RE)) {
    const { values, dir } = amount(m);
    const max = LIMITS.checkSecondsMax;
    if (dir === 'up' || values.some((v) => v > max)) {
      return { code: 'check-time', detail: `checking for "${m[0].trim()}" is longer than ${max} seconds` };
    }
  }
  return null;
}
