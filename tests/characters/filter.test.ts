import { describe, expect, it } from 'vitest';
import { DANGER_RULES, LIMITS, filterReply } from '../../src/characters/filter';
import { PLANTED_BAD_REPLIES } from '../../src/characters/standin';
import { codeOf, filterAs, loadFixture, replyFor } from './helpers';

const c = loadFixture();
const WRONG = c.lines.find((l) => l.wrongAdvice)!;

describe('planted bad replies', () => {
  it('cover the dangerous replies named in the brief', () => {
    const texts = PLANTED_BAD_REPLIES.map((b) => b.text.toLowerCase()).join(' | ');
    for (const needle of ['60 times', '150 times', '2 cm', '10 cm', 'in his mouth', 'give him water', 'carry him to my car',
      'cold water on his face', 'hold him down', 'butter', 'toothpaste', 'ice', 'pull the cloth off',
      'fingers down her throat', 'still breathing', 'pulse for a minute']) {
      expect(texts).toContain(needle);
    }
  });

  for (const bad of PLANTED_BAD_REPLIES) {
    it(`blocks "${bad.text}" (${bad.rule}) from the call-taker and from the bystander`, () => {
      for (const lineId of ['ct-cpr', 'by-help', 'te-pain']) {
        const r = filterReply(replyFor(c, lineId, bad.text), c);
        expect(r.ok).toBe(false);
        expect(codeOf(r)).toBe(bad.rule);
      }
    });
  }
});

// A checked line, as a content author writes it, and an AI-style rewording that must pass.
const SAFE_PAIRS: { checked: string; reworded: string }[] = [
  {
    checked: 'Push hard and fast in the middle of the chest, 5 to 6 cm deep, 100 to 120 times a minute.',
    reworded: 'Push hard and fast in the middle of the chest, 100 to 120 times a minute.',
  },
  {
    checked: 'Push hard and fast in the middle of the chest, 5 to 6 cm deep, 100 to 120 times a minute.',
    reworded: 'Press down about 5 to 6 cm with each push, at least 100 times a minute but no more than 120.',
  },
  { checked: 'Call 907 now and put your phone on speaker.', reworded: 'Call 907 now.' },
  {
    checked: 'Gasping is not normal breathing. Start CPR now.',
    reworded: 'Those gasps are not normal breathing, so start pushing on his chest now.',
  },
  {
    checked: 'Swap with another person every 2 minutes so the pushes stay strong.',
    reworded: 'Every 2 minutes, swap with a friend so your pushes stay strong.',
  },
  {
    checked: 'Cool the burn under cool running water for at least 10 minutes, ideally 20.',
    reworded: 'Cool the burn under running water for 20 minutes.',
  },
  { checked: 'Do not put butter, toothpaste or ice on a burn.', reworded: 'Never put butter, toothpaste or ice on the burn.' },
  {
    checked: 'Cover the cooled burn loosely with cling film or a clean plastic bag.',
    reworded: 'When it has cooled, cover the burn loosely with cling film.',
  },
  {
    checked: 'Give up to 5 back blows between the shoulder blades, then up to 5 abdominal thrusts.',
    reworded: 'Give her up to 5 firm back blows between the shoulder blades.',
  },
  {
    checked: 'Press firmly on the wound with a clean cloth. If blood soaks through, add another cloth on top. Do not remove the first one.',
    reworded: 'Keep pressing hard on the wound. If blood comes through, put another cloth on top and do not lift the first one.',
  },
  {
    checked: 'Keep him still and warm. Do not move him unless he is in danger.',
    reworded: 'Keep him still and warm, and do not move him unless he is in danger.',
  },
  {
    checked: 'Protect her head. Do not hold her down and put nothing in her mouth.',
    reworded: 'Cushion her head, do not hold her down, and do not put anything in her mouth.',
  },
  {
    checked: 'Time the seizure. Call 907 if it lasts more than 5 minutes.',
    reworded: 'Time the seizure, and call 907 if it goes on for more than 5 minutes.',
  },
  {
    checked: 'When the jerking stops and she breathes normally, turn her onto her side.',
    reworded: 'Once the shaking stops and she is breathing normally, roll her onto her side.',
  },
  {
    checked: 'Check for danger first. Look for traffic before you go near him.',
    reworded: 'First check that it is safe: look out for cars before you go to him.',
  },
  {
    checked: 'Look and listen for normal breathing for no more than 10 seconds.',
    reworded: 'Check his breathing for no more than 10 seconds.',
  },
  {
    checked: 'Do not waste time checking for a pulse. Start pushing.',
    reworded: "Don't waste time checking for a pulse, just start pushing.",
  },
  { checked: 'Do not give him anything to eat or drink.', reworded: "Don't give him any water or food." },
  { checked: 'If she can cough, encourage her to keep coughing.', reworded: 'If she can still cough, tell her to keep coughing hard.' },
  { checked: 'Tap his shoulders and shout to see if he responds.', reworded: 'Tap him on the shoulders and ask loudly if he is okay.' },
];

describe('realistic safe lines', () => {
  it('has at least 15 pairs', () => {
    expect(SAFE_PAIRS.length).toBeGreaterThanOrEqual(15);
  });
  for (const { checked, reworded } of SAFE_PAIRS) {
    it(`passes "${reworded}"`, () => {
      expect(filterAs(checked, checked)).toEqual({ ok: true });
      expect(filterAs(reworded, checked)).toEqual({ ok: true });
    });
  }
});

describe('planned wrong advice (rule a)', () => {
  it('passes by its id with its exact text', () => {
    expect(filterReply(replyFor(c, WRONG.id, WRONG.text), c)).toEqual({ ok: true });
  });

  it('is blocked when its text changes in any way, even to safe text', () => {
    for (const text of [`${WRONG.text} `, WRONG.text.toUpperCase(), 'Wait, he is still breathing. Let him rest. Do not touch him.', 'Start CPR now.']) {
      expect(codeOf(filterReply(replyFor(c, WRONG.id, text), c))).toBe('wrong-advice-changed');
    }
  });

  it('is blocked when the same text arrives under another line id', () => {
    for (const lineId of ['by-help', 'ct-answer', 'ct-gasping', 'te-pain']) {
      expect(codeOf(filterReply(replyFor(c, lineId, WRONG.text), c))).toBe('danger/gasping-trap');
    }
  });

  it('is blocked when it is put in another character\'s mouth', () => {
    const r = filterReply({ characterId: 'calltaker', lineId: WRONG.id, text: WRONG.text, emotion: 'calm' }, c);
    expect(codeOf(r)).toBe('wrong-character');
  });
});

describe('negation is read narrowly', () => {
  const tricks = [
    'Never forget to put a spoon in his mouth.',
    "Don't panic, give him some water.",
    'Do not wait, carry him to the car.',
    "Don't just stand there, pour water on his face.",
    'Do not put butter on it, put toothpaste on it instead.',
    'Do not hesitate to hold him down.',
    "Don't move him; give him water.",
    'Do not let him rest, give him water.',
    "Don't forget to call for help or give him water.",
    'Put nothing in his mouth except a spoon.',
    'Butter does not make it worse, put some on.',
    'Butter on a burn does not make it worse.',
    "Let's lift him into a minibus and take him to hospital ourselves.",
    'Use toothpaste, not water.',
  ];
  for (const t of tricks) {
    it(`blocks "${t}"`, () => {
      const r = filterAs(t);
      expect(r.ok).toBe(false);
      expect(codeOf(r)).toMatch(/^danger\//);
    });
  }
  const fine = [
    'Do not move him or give him water.',
    "Don\u2019t give him water.",
    'Avoid giving her anything to drink.',
    'Do not let anyone give him water.',
    'Never, ever put anything in her mouth.',
  ];
  for (const t of fine) {
    it(`passes "${t}"`, () => {
      expect(filterAs(t)).toEqual({ ok: true });
    });
  }
});

describe('CPR numbers (rule c)', () => {
  const pass = [
    'Push 100 to 120 times a minute.',
    'Push 100-120/min.',
    'Push 100\u2013120 times a minute.',
    'Push about 110 compressions per minute.',
    'Push at least 100 times a minute.',
    'Push no more than 120 times a minute.',
    'Push between 100 and 120 times a minute.',
    'Push one hundred and ten times a minute.',
    'Push twice a second.',
    'Push 2 times per second.',
    'Press 5-6 cm deep.',
    'Press at least 5 cm but no more than 6 cm deep.',
    'Press about 2 inches deep.',
    'There is a cut 10 cm long on his leg.',
    'Check his breathing for no more than 10 seconds.',
  ];
  for (const t of pass) {
    it(`passes "${t}"`, () => expect(filterAs(t)).toEqual({ ok: true }));
  }
  const block: [string, string][] = [
    ['Push 90 to 110 times a minute.', 'rate'],
    ['Push faster than 120 a minute.', 'rate'],
    ['Push more than 120 per minute.', 'rate'],
    ['Push 130/min.', 'rate'],
    ['Push at a rate of 150.', 'rate'],
    ['Push 3 times a second.', 'rate'],
    ['Push sixty times a minute.', 'rate'],
    ['Push 60 or 150 times a minute.', 'rate'],
    ['Press 4 to 5 cm deep.', 'depth'],
    ['Press 3 inches deep.', 'depth'],
    ['Press more than 6 cm.', 'depth'],
    ['Press 80 mm deep.', 'depth'],
    ['Push ten centimetres deep.', 'depth'],
    ['Check his breathing for 30 seconds.', 'check-time'],
    ['Look for breathing for at least 15 seconds.', 'check-time'],
  ];
  for (const [t, code] of block) {
    it(`blocks "${t}" (${code})`, () => expect(codeOf(filterAs(t))).toBe(code));
  }
  it('uses the limits in the reviewed table', () => {
    expect(LIMITS.compressionRatePerMin).toEqual({ min: 100, max: 120 });
    expect(LIMITS.depth.cm).toEqual({ min: 5, max: 6 });
  });
});

describe('length, links, e-mail and phone numbers (rule d)', () => {
  it('passes 400 characters and blocks 401', () => {
    const t400 = 'Keep going. '.repeat(33) + 'Good';
    expect(t400.length).toBe(400);
    expect(filterAs(t400)).toEqual({ ok: true });
    expect(codeOf(filterAs(t400 + '!'))).toBe('too-long');
  });
  it('blocks links', () => {
    for (const t of ['See www.example.org for more.', 'Go to https://example.org/help now.', 'Read example.com today.']) {
      expect(codeOf(filterAs(t))).toBe('url');
    }
  });
  it('blocks e-mail addresses and handles', () => {
    // Built at run time from a reserved test domain, so no address sits in the source.
    const address = ['nobody', 'example.invalid'].join('@');
    expect(codeOf(filterAs(`Write to ${address} later.`))).toBe('email');
    expect(codeOf(filterAs('Follow @firstaidteam for tips.'))).toBe('email');
  });
  it('allows 907 and blocks every other phone number', () => {
    expect(filterAs('Call 907 now.')).toEqual({ ok: true });
    expect(codeOf(filterAs('Call 123 now.'))).toBe('phone');
    expect(codeOf(filterAs('Call 907 or 123.'))).toBe('phone');
    expect(codeOf(filterAs('Ring 0000 000 000 for help.'))).toBe('phone');
    expect(codeOf(filterAs('My number is +000 00 000 0000.'))).toBe('phone');
  });
});

describe('text the patterns cannot read is blocked', () => {
  it('blocks hidden characters', () => {
    expect(codeOf(filterAs('Give him w\u200bater.'))).toBe('hidden-characters');
  });
  it('blocks look-alike letters from other scripts', () => {
    expect(codeOf(filterAs('Give him w\u0430ter.'))).toBe('unchecked-characters');
  });
  it('reads wide letters as plain letters', () => {
    expect(codeOf(filterAs('\uff27ive him water.'))).toBe('danger/give-drink');
  });
  it('blocks empty text', () => {
    expect(codeOf(filterAs('   ', 'Call 907 now.'))).toBe('empty');
  });
});

describe('the reply must belong to its line (rule e and consistency)', () => {
  it('blocks a number the checked line does not have', () => {
    expect(codeOf(filterReply(replyFor(c, 'ct-swap', 'Swap every 3 minutes.'), c))).toBe('new-number');
    expect(codeOf(filterReply(replyFor(c, 'ct-cpr', 'Push 110 times a minute.'), c))).toBe('new-number');
    expect(filterReply(replyFor(c, 'ct-cpr', 'Push 5 to 6 cm deep, 100 to 120 times a minute.'), c)).toEqual({ ok: true });
  });
  it('blocks an unknown line, another speaker, a bad emotion and a bad shape', () => {
    expect(codeOf(filterReply({ characterId: 'calltaker', lineId: 'nope', text: 'Call 907.', emotion: 'calm' }, c))).toBe('unknown-line');
    expect(codeOf(filterReply({ characterId: 'shopkeeper', lineId: 'ct-cpr', text: 'Call 907.', emotion: 'calm' }, c))).toBe('wrong-character');
    expect(codeOf(filterReply({ characterId: 'calltaker', lineId: 'ct-answer', text: 'Call 907.', emotion: 'angry' as never }, c))).toBe('bad-emotion');
    expect(codeOf(filterReply({ characterId: 'calltaker', lineId: 'ct-answer', text: 42 as never, emotion: 'calm' }, c))).toBe('bad-shape');
  });
});

describe('the reviewed table', () => {
  it('has unique rule ids and examples for every rule', () => {
    const ids = DANGER_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DANGER_RULES) {
      expect(r.examples.blocked.length).toBeGreaterThan(0);
      expect(r.examples.allowed.length).toBeGreaterThan(0);
    }
  });
  for (const rule of DANGER_RULES) {
    for (const t of rule.examples.blocked) {
      it(`${rule.id} blocks "${t}"`, () => expect(codeOf(filterAs(t))).toBe(`danger/${rule.id}`));
    }
    for (const t of rule.examples.allowed) {
      it(`${rule.id} allows "${t}"`, () => expect(filterAs(t)).toEqual({ ok: true }));
    }
  }
});
