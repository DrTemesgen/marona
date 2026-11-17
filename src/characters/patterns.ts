// The safety filter's rules, in one place, for clinical review (17 Nov 2026, status: PENDING
// CLINICAL REVIEW).
//
// How to read this file (no programming needed for the review):
// - DANGER_RULES: one row per kind of dangerous advice. Read "catches", "why" and the examples.
//   Every "blocked" example must be stopped and every "allowed" example must pass; the tests
//   in tests/characters/ check this, so a reviewer can add an example and see the result.
// - LIMITS: the numbers the filter enforces (CPR rate and depth, checking time, length, the
//   emergency number).
// - The word lists (REMEDIES, DRINKS, ...) hold the synonyms; add a word there to widen a rule.
//
// What the filter does with these rules (code in filter.ts):
// - Text is lower-cased and typographic quotes and dashes are made plain before matching.
// - "do not / don't / never / avoid / cannot / must not" DIRECTLY before the matched words makes
//   the match safe teaching ("Do not give him water" passes). "Never forget to give him water"
//   or "Don't panic, give him water" do NOT count as negated and are blocked.
// - "mention" patterns catch a remedy named next to a burn or wound. They pass when the same
//   sentence says the remedy harms ("Butter on a burn traps the heat").
// - "strict" patterns block even when negated (for example "Do not call 907").
// - When a rule wrongly blocks a correct line, the game shows the checked scripted line
//   instead, so a false block costs variety, never safety. A missed dangerous line is the
//   failure that matters; when in doubt, the rules block.
// - The rules read English only. Any character outside plain English text is blocked until
//   Amharic rules exist.

export interface DangerPattern {
  re: RegExp;
  kind: 'say' | 'mention' | 'strict';
}

export interface DangerRule {
  id: string;
  topic: string;
  catches: string; // plain words, for the reviewer
  why: string; // the harm, for the reviewer
  patterns: DangerPattern[];
  // For "mention" patterns: the sentence is allowed when it also says the thing harms.
  harmPhrase?: RegExp;
  examples: { blocked: string[]; allowed: string[] };
}

// ---------- Numbers the filter enforces ----------

export const LIMITS = {
  // Chest compression rate, per minute (rule c). Rates in "per second" are converted (x 60).
  compressionRatePerMin: { min: 100, max: 120 },
  // Chest compression depth (rule c). Inches are the usual 2 to 2.4 inch equivalent.
  depth: {
    cm: { min: 5, max: 6 },
    mm: { min: 50, max: 60 },
    inch: { min: 2, max: 2.4 },
  },
  // Looking, listening or feeling for breathing: no more than this many seconds.
  checkSecondsMax: 10,
  // Rule d.
  maxLength: 400,
  allowedPhoneNumber: '907',
} as const;

// ---------- Word lists (synonyms) ----------

// Who the advice is about.
const PERSON = String.raw`(?:him|her|them|the (?:casualty|patient|person|victim|boy|girl|man|woman|child|teacher|student|driver|classmate))`;
const POSS = String.raw`(?:his|her|their|the)`;
const DET = String.raw`(?:the|that|this|your|his|her|their|a|an|my|our)`;

// Things people put on burns or wounds. Left out on purpose, for the reviewer to decide:
// aloe vera (mixed evidence for minor burns), cling film and clean cloth (correct covers).
const REMEDIES = String.raw`butter|ghee|kibe|tooth paste|toothpaste|ice cubes|ice cube|iced water|ice water|ice|cooking oil|oil|egg white|eggs|egg|flour|mud|soil|ashes|ash|cow dung|dung|honey|petrol|kerosene|lotion|creams|cream|ointment|spit|saliva|urine|coffee grounds|coffee powder|coffee|salt|sugar|alcohol`;

// Drinks and food (nothing by mouth for a person who is not fully awake).
const DRINKS = String.raw`holy water|water|tea|juice|milk|coffee|soda|soft drink|drinks|drink|food|sugar|bread|eat`;

// Objects people push into the mouth during a seizure.
const MOUTH_THINGS = String.raw`spoon|stick|pen|pencil|wallet|belt|rag|piece of wood|wood|keys|key|shoe`;

// Cloths used to press on a wound (bleeding).
const CLOTHS = String.raw`cloths|cloth|bandages|bandage|dressings|dressing|pads|pad|gauze|towels|towel|scarf|shawl|rags|rag|netela|gabi`;

// Up to n characters inside one clause (stops at . ! ? ; : and commas).
const gap = (n: number) => String.raw`[^.!?;:,]{0,${n}}?`;

// "butter, toothpaste or ice" read as one list, so one "do not" covers all of it.
const listOf = (words: string) =>
  String.raw`(?:${words})(?:(?:\s*,\s*(?:or\s+|and\s+|nor\s+)?|\s+(?:or|and|nor)\s+)(?:any\s+|some\s+)?(?:${words}))*`;

const rx = (s: TemplateStringsArray, ...v: string[]) => new RegExp(String.raw(s, ...v));
const say = (re: RegExp): DangerPattern => ({ re, kind: 'say' });
const mention = (re: RegExp): DangerPattern => ({ re, kind: 'mention' });
const strict = (re: RegExp): DangerPattern => ({ re, kind: 'strict' });

// ---------- The table ----------

export const DANGER_RULES: readonly DangerRule[] = [
  {
    id: 'discourage-call',
    topic: 'Calling 907 (all chapters)',
    catches: 'Telling the player not to call 907 or an ambulance, or that there is no need to.',
    why: 'Every minute without the ambulance and the call-taker lowers the chance of survival.',
    patterns: [
      strict(
        /\b(?:do not|don't|dont|never|no need to|(?:you )?(?:do not|don't) need to|there's no need to|there is no need to|needn't|no point(?: in)?)\s*(?:call|calling|phone|phoning|ring|ringing|dial|dialing|dialling)\s+(?:907|(?:an? |the )?ambulance|for (?:help|an ambulance)|emergency|the emergency|anyone|anybody|someone)\b/,
      ),
    ],
    examples: {
      blocked: ['Do not call 907, he will be fine.', 'There is no need to call an ambulance.'],
      allowed: ['Call 907 now, do not wait.', 'Never hesitate to call 907.'],
    },
  },
  {
    id: 'delay-call',
    topic: 'Calling 907 (all chapters)',
    catches: 'Waiting before calling, calling later, or hanging up on the call-taker.',
    why: 'The call-taker sends the ambulance and coaches CPR; the line should stay open on speaker.',
    patterns: [
      say(/\bwait(?:ing)?\s+(?:before|to)\s+(?:call|calling|phone|phoning|ring)\b/),
      say(
        /\bcall(?:ing)?\s+(?:907|an? ambulance|the ambulance|for help)\s+(?:later|tomorrow|afterwards?|after (?:you|we|i) (?:finish|try|see))\b/,
      ),
      say(/\bhang up\b|\bend the call\b|\bput the phone down\b/),
    ],
    examples: {
      blocked: ['Wait before calling, let us see if he wakes up.', 'Hang up and start pushing.'],
      allowed: ["Don't wait to call 907.", 'Do not hang up until the call-taker tells you.'],
    },
  },
  {
    id: 'gasping-trap',
    topic: 'CPR (chapter 2)',
    catches:
      'Calling gasping or snoring "breathing", "he is still breathing", "wait, he is breathing", "he is just sleeping".',
    why: 'Gasping after a collapse is a sign of cardiac arrest, not normal breathing. Waiting delays CPR.',
    patterns: [
      say(/\bstill breath(?:ing|es)\b(?! normally)/),
      say(/\bwait\b[^.!?;:]{0,40}?\bbreath(?:ing|es)\b/),
      say(/\bbreath(?:ing|es)\b[^.!?;:]{0,40}?\b(?:wait|leave (?:him|her|them)|let (?:him|her|them) (?:rest|sleep|be))\b/),
      say(
        /\b(?:gasp|gasps|gasping|snore|snores|snoring)\b[^.!?;:]{0,25}?\b(?:is|are|means|mean|counts? as|shows?)\s+(?:that\s+)?(?:(?:he|she|they)(?:'s|'re| is| are)\s+)?(?:breathing|normal|fine|ok|okay|good|a good sign|alive)\b/,
      ),
      say(
        /\b(?:he|she|they)(?:'s|'re| is| are| has| have)?\s+(?:just|only|probably)\s+(?:sleeping|asleep|snoring|resting|tired|fainted|passed out|drunk|pretending)\b/,
      ),
    ],
    examples: {
      blocked: ['Wait, he is still breathing.', "He's just snoring, let him sleep.", 'Those gasps mean he is breathing.', 'He has only fainted.'],
      allowed: ['Gasping is not normal breathing. Start CPR now.', 'Is he breathing normally?'],
    },
  },
  {
    id: 'wait-and-see',
    topic: 'CPR (chapter 2), collapse',
    catches: 'Waiting to see whether a collapsed person wakes up: "give him a minute", "wait and see", "wait for him to wake up".',
    why: 'Every minute without CPR after a cardiac arrest lowers the chance of survival.',
    patterns: [
      say(/\bgive\s+(?:him|her|them)\s+(?:a|one|a few|some|a couple of)\s+(?:more\s+)?(?:minutes?|moments?|seconds?|time)\b/),
      say(
        /\bwait\s+(?:and\s+see|a\s+(?:minute|moment|bit|while|second|few minutes)|for\s+(?:him|her|them)\s+to\s+(?:wake|come round|come around|come to))\b/,
      ),
    ],
    examples: {
      blocked: ['He has fallen. Give him a minute.', 'Let us wait and see if he wakes up.'],
      allowed: ['Do not wait and see. Start pushing now.', 'Do not wait for him to wake up. Start CPR.'],
    },
  },
  {
    id: 'pulse-check',
    topic: 'CPR (chapter 2)',
    catches: 'Checking or feeling for a pulse or heartbeat, or checking for a minute before acting.',
    why: 'Lay rescuers cannot find a pulse reliably; the search delays CPR. Breathing is checked for no more than 10 seconds.',
    patterns: [
      say(
        /\b(?:check|checking|checks|feel|feeling|feels|find|finding|take|taking|look|looking|search|searching|count|counting|wait|waiting)\b[^.!?;:,]{0,20}?\b(?:pulse|heartbeat|heart beat|heart rate)\b/,
      ),
      say(/\blisten(?:ing)?\s+(?:for|to)\s+(?:a|his|her|their|the)\s+(?:heart|heartbeat)\b/),
      say(
        /\b(?:check|checking|look|looking|listen|listening|feel|feeling|watch|watching|wait|waiting)\b[^.!?;:]{0,40}?\bfor\s+(?:a|one|1|two|2|a full|a whole|several|a few|a couple of)\s+(?:full\s+|whole\s+)?minutes?\b/,
      ),
    ],
    examples: {
      blocked: ['Check for a pulse for a minute before you start.', 'Feel his neck for a heartbeat.'],
      allowed: ['Do not waste time checking for a pulse. Start pushing.', 'Look and listen for normal breathing.'],
    },
  },
  {
    id: 'mouth-object',
    topic: 'Seizures (chapter 6)',
    catches:
      'Putting anything in the mouth or between the teeth, forcing the mouth open, holding the tongue, the "swallowed tongue" myth.',
    why: 'Objects in the mouth break teeth, block the airway and injure helpers. A person cannot swallow their tongue.',
    patterns: [
      say(
        rx`\b(?:put|putting|puts|place|placing|stick|sticking|shove|shoving|force|forcing|insert|inserting|push|pushing|jam|jamming|wedge|wedging)\b${gap(40)}\b(?:in|into|inside|between)\s+${POSS}\s+(?:mouth|teeth|jaws?|lips)\b`,
      ),
      say(rx`\b(?:${MOUTH_THINGS})\b[^.!?;:]{0,40}?\b(?:mouth|teeth|jaws?|tongues?|bite)\b`),
      say(/\bsomething\s+(?:hard\s+)?(?:to|he can|she can|they can)\s+bite\b/),
      say(rx`\b(?:force|forcing|pry|prying|prise|prising|wrench|wrenching)\b${gap(25)}\b(?:mouth|jaws?|teeth)\b${gap(10)}\bopen\b`),
      say(rx`\b(?:force|forcing|pry|prying|prise|prising)\s+open\s+${POSS}\s+(?:mouth|jaws?)\b`),
      say(/\b(?:hold|holding|grab|grabbing|pull|pulling|catch|catching|pin|pinning)\b[^.!?;:]{0,40}?\btongues?\b/),
      say(/\bswallow(?:s|ing)?\s+(?:his|her|their|the)\s+tongues?\b/),
    ],
    examples: {
      blocked: [
        'Put something in his mouth so he does not bite his tongue.',
        'Quick, put a spoon between her teeth.',
        'Hold his tongue so he does not swallow it.',
      ],
      allowed: ['Do not put anything in her mouth.', 'A person cannot swallow their tongue.'],
    },
  },
  {
    id: 'restrain-seizure',
    topic: 'Seizures (chapter 6)',
    catches: 'Holding, pinning or tying the person down, restraining them, gripping arms or legs, trying to stop the jerking.',
    why: 'Restraint can break bones and dislocate joints, and it does not stop a seizure.',
    patterns: [
      say(
        rx`\b(?:hold|holding|holds|pin|pinning|pins|press|pressing|tie|tying|ties|strap|strapping|push|pushing|keep|keeping|force|forcing)\s+${PERSON}\s+down\b`,
      ),
      say(/\brestrain(?:s|ing)?\b/),
      say(
        /\b(?:hold|holding|grab|grabbing|pin|pinning|tie|tying|grip|gripping|squeeze|squeezing)\s+(?:his|her|their|the)\s+(?:arms?|legs?|hands?|body|shoulders|wrists?|ankles?)\s+(?:down|still|tight|tightly|firmly|hard)\b/,
      ),
      say(
        /\b(?:stop|stopping|control|controlling)\s+(?:the|his|her|their)\s+(?:shaking|jerking|jerks|movements?|fit|fitting|seizure|convulsions?|spasms?|thrashing)\b/,
      ),
      say(/\bstop\s+(?:him|her|them)\s+(?:from\s+)?(?:shaking|jerking|moving|fitting|thrashing|convulsing)\b/),
    ],
    examples: {
      blocked: ['Hold him down until the shaking stops.', 'Grab her arms tight so she cannot hurt herself.'],
      allowed: ['Do not hold her down. Move hard things away and cushion her head.', 'You cannot stop the seizure, so keep her safe.'],
    },
  },
  {
    id: 'finger-sweep',
    topic: 'Choking (chapter 3)',
    catches: 'Fingers down the throat or in the mouth, finger sweeps, digging the object out, making them vomit, holding them upside down.',
    why: 'Blind finger sweeps push the object deeper and injure the throat. Back blows and abdominal thrusts are the method.',
    patterns: [
      say(
        rx`\b(?:stick|sticking|put|putting|push|pushing|shove|shoving|insert|inserting|use|using|reach|reaching|hook|hooking|poke|poking|jam|jamming)\b${gap(25)}\bfingers?\b${gap(25)}\b(?:throat|mouth)\b`,
      ),
      say(/\b(?:reach|reaching|go|going|dig|digging|feel|feeling)\s+(?:into|in|down|inside)\s+(?:his|her|their|the)\s+(?:throat|mouth)\b/),
      say(/\bfinger[\s-]+sweeps?\b/),
      say(/\bsweep(?:s|ing)?\s+(?:out\s+)?(?:his|her|their|the)\s+mouth\b/),
      say(/\b(?:hook|hooking|dig|digging|fish|fishing|scoop|scooping)\s+(?:it|the food|the object|the piece|the bone|the sweet|the candy)\s+out\b/),
      say(/\b(?:make|making|let|help|get)\s+(?:him|her|them)\s+(?:vomit|throw up|be sick)\b|\binduce vomiting\b/),
      say(/\b(?:hold|holding|turn|turning|hang|hanging|flip|flipping)\s+(?:him|her|them)\s+upside down\b/),
    ],
    examples: {
      blocked: ['Stick your fingers down her throat and pull it out.', 'Do a finger sweep to clear her mouth.'],
      allowed: ['Do not put your fingers in her mouth.', 'If she can cough, tell her to keep coughing.'],
    },
  },
  {
    id: 'give-drink',
    topic: 'Unresponsive person, seizure, choking, bleeding',
    catches: 'Giving water (holy water included), other drinks or food by mouth, or making the person drink or eat.',
    why: 'A person who is not fully awake can choke; an injured person may need surgery and should not eat or drink.',
    patterns: [
      say(rx`\b(?:give|giving|gives|gave|offer|offering|offers|feed|feeding|feeds)\b(?:\s+[a-z'-]+){0,4}?\s+(?<thing>${listOf(DRINKS)})\b`),
      say(rx`\bfeed(?:ing|s)?\s+${PERSON}\b`),
      say(/\b(?:make|making|let|letting|help|helping|get|getting|have|having)\s+(?:[a-z'-]+\s+){0,2}?(?:to\s+)?(?:drink|eat|swallow|sip)\b/),
      say(rx`\b(?:sip|sips|glass|cup|mouthful)\s+of\s+(?<thing>${listOf(DRINKS)})\b`),
      say(rx`\bdrink(?:s|ing)?\s+(?:some\s+|a little\s+|a bit of\s+|lots of\s+|plenty of\s+)?(?<thing>${listOf(DRINKS)})\b`),
    ],
    examples: {
      blocked: ['He is not waking up. Give him water.', 'Let her drink some holy water.', 'Offer him a glass of juice.'],
      allowed: ['Do not give him anything to eat or drink.', 'Do not move him or give him water.'],
    },
  },
  {
    id: 'move-casualty',
    topic: 'Bleeding and road crash (chapter 4), collapse',
    catches:
      'Carrying, dragging or lifting the casualty, putting them in a car, taxi or minibus, driving or rushing them anywhere, taking them "ourselves", sitting or standing them up.',
    why: 'Moving an injured or collapsed person can worsen injuries and delays CPR and the ambulance. Move only out of real danger. Left out on purpose: "take her to the health centre" is correct aftercare after choking, burns and seizures.',
    patterns: [
      say(rx`\b(?:carry|carrying|carries|drag|dragging|drags|lift|lifting|lifts|haul|hauling)\s+${PERSON}\b`),
      say(rx`\bpick(?:ing|s)?\s+(?:${PERSON}\s+up|up\s+${PERSON})\b`),
      say(
        rx`\b(?:move|moving|moves|take|taking|takes|get|getting|bring|bringing|put|putting|load|loading|send|sending|walk|walking)\s+${PERSON}\s+(?:to|into|onto|in|inside|in to)\s+(?:${DET}\s+)?(?:car|taxi|minibus|bajaj|bus|vehicle|truck|van|motorbike|cart)\b`,
      ),
      say(rx`\b(?:drive|driving|drives|rush|rushing|rushes|transport|transporting|transports)\s+${PERSON}\b`),
      say(rx`\b(?:take|taking|bring|bringing|get|getting|move|moving)\s+${PERSON}\b${gap(40)}\b(?:ourselves|yourselves|yourself|myself)\b`),
      say(rx`\b(?:move|moving|take|taking|carry|carrying|bring|bringing|get|getting|walk|walking)\s+${PERSON}\s+(?:inside|indoors)\b`),
      say(rx`\b(?:sit|sitting|stand|standing)\s+${PERSON}\s+up\b`),
      say(rx`\b(?:make|making|let|letting|help|helping|get|getting)\s+${PERSON}\s+(?:walk|stand|get up)\b`),
      say(/\bwalk it off\b/),
    ],
    examples: {
      blocked: [
        'Carry him to my car, we will drive him to the clinic.',
        'Let us put her in a taxi.',
        'We can take him to hospital ourselves.',
        'Sit him up so he can breathe.',
      ],
      allowed: [
        'Keep him still and do not move him unless he is in danger.',
        'Do not carry him to a car.',
        'I will take her to the health centre to be checked.',
      ],
    },
  },
  {
    id: 'water-on-face',
    topic: 'Collapse, fainting, seizure',
    catches:
      'Pouring, throwing or splashing water (holy water included) on the face or head, slapping, shaking hard, making them smell onion, perfume, kerosene or a shoe.',
    why: 'None of these wakes a person in cardiac arrest or a seizure; water can be breathed in; the minutes are needed for CPR and 907.',
    patterns: [
      say(
        rx`\b(?:pour|pouring|pours|throw|throwing|throws|splash|splashing|splashes|sprinkle|sprinkling|spray|spraying|dash|dashing|douse|dousing|tip|tipping)\b${gap(30)}\bwater\b(?:(?!burn|scald)[^.!?;:,]){0,25}?\b(?:face|head)\b`,
      ),
      say(rx`\b(?:throw|throwing|splash|splashing|sprinkle|sprinkling|dash|dashing|douse|dousing)\b${gap(20)}\bwater\s+(?:on|at|over|onto)\s+(?:him|her|them)\b`),
      say(
        /\b(?:slap|slapping|slaps|smack|smacking)\s+(?:him|her|them|his face|her face|their face|his cheeks?|her cheeks?|their cheeks?)\b(?!\s+(?:on the\s+|between the\s+)?(?:back|shoulder))/,
      ),
      say(/\b(?:hit|hitting)\s+(?:him|her|them)\s+(?:in|on)\s+the\s+face\b/),
      say(/\bshak(?:e|es|ing)\s+(?:him|her|them)\s+(?:hard|harder|violently|roughly|really hard)\b/),
      say(/\b(?:onion|garlic|perfume|kerosene|petrol|shoe|smelling salts?|ammonia)\b[^.!?;:]{0,30}?\b(?:nose|smell|sniff)\b/),
      say(/\b(?:make|making|let|letting)\s+(?:him|her|them)\s+(?:smell|sniff)\b/),
    ],
    examples: {
      blocked: ['Pour cold water on his face to wake him up.', 'Slap her face, she will wake up.', 'Hold an onion under his nose.'],
      allowed: ['Tap his shoulders and shout to see if he responds.', 'Cool the burn on her face under clean running water.'],
    },
  },
  {
    id: 'home-remedy',
    topic: 'Burns (chapter 5), wounds (chapter 4)',
    catches:
      'Putting butter, ghee, oil, toothpaste, ice, egg, flour, honey, mud, ash, dung, coffee, salt, sugar, spit or creams on a burn or wound; bursting blisters.',
    why: 'Home remedies keep the heat in, cause infection and delay cooling; ice damages the skin. Cool clean running water, then a clean loose cover.',
    patterns: [
      say(
        rx`\b(?:put|putting|puts|apply|applying|applies|rub|rubbing|rubs|spread|spreading|smear|smearing|use|using|uses|try|trying|cover|covering|dab|dabbing|place|placing|hold|holding|press|pressing|pour|pouring|add|adding|massage|massaging)\b${gap(40)}\b(?<thing>${listOf(REMEDIES)})\b`,
      ),
      mention(
        rx`\b(?<thing>${listOf(REMEDIES)})\s+(?:on|onto|over|to|against|for)\s+(?:it|them|the burns?|a burn|burns|the skin|the wound|a wound|the cut|the blister|the scald|(?:his|her|their)\s+[a-z]+)\b`,
      ),
      mention(rx`\b(?<thing>${listOf(REMEDIES)})\b${gap(30)}\b(?:burns?|burned|burnt|scalds?|scalded|blisters?|wounds?|cuts?)\b`),
      mention(rx`\b(?:burns?|burned|burnt|scalds?|scalded|blisters?|wounds?|cuts?)\b${gap(30)}\b(?<thing>${listOf(REMEDIES)})\b`),
      // The myth itself, even with no burn named: "butter is good", "toothpaste does not hurt".
      mention(
        rx`\b(?<thing>${listOf(REMEDIES)})\b${gap(20)}\b(?:is|are|works?|helps?|does not|doesn't|will not|won't)\s+(?:good|fine|ok|okay|safe|great|the best|best|healing|make it worse|hurt|harm|damage)\b`,
      ),
      say(/\b(?:pop|popping|burst|bursting|prick|pricking|break|breaking|peel|peeling)\s+(?:the|that|this|his|her|their|a|any)?\s*blisters?\b/),
    ],
    harmPhrase:
      /\b(?:makes?|making)\s+(?:it|them|the burn|burns|a burn|the skin|the wound|things)\s+worse\b|\btraps?\s+(?:the\s+)?heat\b|\bkeeps?\s+the\s+heat\s+in\b|\bcauses?\s+(?:an\s+)?infection\b|\bcan\s+(?:cause|harm|damage|hurt)\b|\b(?:is|are)\s+(?:not good|bad|wrong|dangerous|harmful|(?:a\s+)?myths?)\b|\b(?:isn't|aren't)\s+good\b|\b(?:do|does)\s+not\s+help\b|\b(?:doesn't|don't)\s+help\b|\bdamages?\s+the\s+skin\b|\bharms?\s+the\s+skin\b/,
    examples: {
      blocked: ['Put butter on the burn.', 'Toothpaste on the burn will cool it.', 'Put ice on the burn right away.', 'Put coffee powder on the cut.'],
      allowed: [
        'Do not put butter, toothpaste or ice on a burn.',
        'Cool the burn with clean running water, not ice.',
        'Butter on a burn traps the heat and can cause infection.',
      ],
    },
  },
  {
    id: 'remove-dressing',
    topic: 'Bleeding (chapter 4)',
    catches: 'Removing, lifting or changing the cloth pressed on a wound to look at it.',
    why: 'Lifting the cloth breaks the clot and restarts the bleeding. If blood soaks through, add another cloth on top and keep pressing.',
    patterns: [
      say(
        rx`\b(?:remove|removing|removes|lift|lifting|lifts|peel|peeling|rip|ripping|tear|tearing|change|changing|replace|replacing|swap|swapping)\b(?:\s+(?:off|away|up|back))?\s+(?:${DET}\s+)?(?:[a-z-]+\s+)?(?:${CLOTHS})\b`,
      ),
      say(rx`\b(?:take|taking|takes|pull|pulling|pulls|get|getting)\s+(?:off|away)\s+(?:${DET}\s+)?(?:[a-z-]+\s+)?(?:${CLOTHS})\b`),
      say(rx`\b(?:take|taking|takes|pull|pulling|pulls|get|getting|lift|lifting)\s+${DET}\s+(?:[a-z-]+\s+)?(?:${CLOTHS})\s+(?:off|away|up|back)\b`),
      say(rx`\b(?:look|looking|check|checking|peek|peeking|see|peep|peeping)\s+(?:under|beneath|underneath)\s+(?:${DET}\s+)?(?:[a-z-]+\s+)?(?:${CLOTHS})\b`),
    ],
    examples: {
      blocked: ['Pull the cloth off to check the bleeding.', 'Lift the bandage and look at the wound.'],
      allowed: ['If blood soaks through, put another cloth on top. Do not remove the first one.', 'Take a clean cloth and press hard on the wound.'],
    },
  },
];
