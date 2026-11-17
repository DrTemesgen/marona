// A tiny built-in case so the screens work before real case files exist.
import type { CaseFile } from '../../shared/contract';
import { S } from '../strings.en';

const ref = { sourceId: 'demo', page: 'to confirm', review: 'pending' as const };

export const fakeCase: CaseFile = {
  id: 'fake-ch2-school-gate',
  chapter: 2,
  title: S.fakeCase.title,
  shortTitle: S.fakeCase.shortTitle,
  version: 'fake-1',
  scene: 'school-gate',
  intro: 'A classmate has collapsed at the school gate. Stay calm and help.',
  sources: [{ id: 'demo', title: 'Demo source (placeholder)', url: 'https://example.org/demo' }],
  characters: [
    { id: 'casualty', name: 'Classmate', role: 'casualty', description: 'Collapsed on the ground.' },
    { id: 'friend', name: 'Friend', role: 'friend', description: 'A worried friend.' },
    { id: 'calltaker', name: 'Call-taker', role: 'calltaker', description: 'Emergency line 907.' },
  ],
  facts: [],
  phases: [
    { id: 'assess', title: 'Check the scene' },
    { id: 'act', title: 'Act now' },
  ],
  startPhaseId: 'assess',
  startCasualty: 'collapsed',
  initialFlags: {},
  actions: [
    {
      id: 'check_safe', label: 'Check the area is safe', kind: 'action', phases: ['assess', 'act'],
      repeatable: false, hint: 'Look around before you touch anyone.', effects: [],
    },
    {
      id: 'ask_ok', label: 'Ask: "Can you hear me?"', kind: 'question', targetCharacterId: 'casualty',
      phases: ['assess', 'act'], repeatable: false, hint: 'Shout and tap the shoulders.',
      effects: [
        { type: 'say', characterId: 'casualty', lineId: 'l_silent' },
        { type: 'gotoPhase', phaseId: 'act' },
      ],
    },
    {
      id: 'shout_help', label: 'Shout for help', kind: 'action', phases: ['assess', 'act'],
      repeatable: false, hint: 'Get people to come.', effects: [{ type: 'say', characterId: 'friend', lineId: 'l_help' }],
    },
    {
      id: 'call_907', label: 'Call 907', kind: 'call', targetCharacterId: 'calltaker', phases: ['assess', 'act'],
      repeatable: false, hint: 'Say where you are and that the person is not breathing normally.',
      effects: [{ type: 'say', characterId: 'calltaker', lineId: 'l_call' }],
    },
    {
      id: 'compress', label: 'Push hard and fast on the chest', kind: 'rhythm', phases: ['act', 'assess'],
      repeatable: true, hint: 'Centre of the chest, to the beat.',
      effects: [{ type: 'setCasualty', status: 'cpr' }],
    },
    {
      id: 'give_water', label: 'Give water to drink', kind: 'action', phases: ['assess', 'act'],
      repeatable: false, hint: 'Think: is this safe?', effects: [],
    },
  ],
  timeline: [
    { id: 'ev_panic', atMs: 15000, effects: [{ type: 'say', characterId: 'friend', lineId: 'l_panic' }] },
  ],
  lines: [
    { id: 'l_open', characterId: 'friend', text: 'Oh no! She just fell down!', emotion: 'panicked', wrongAdvice: false },
    { id: 'l_silent', characterId: 'casualty', text: '(No answer. Not moving.)', emotion: 'neutral', wrongAdvice: false },
    { id: 'l_help', characterId: 'friend', text: 'I will stay with you. What next?', emotion: 'worried', wrongAdvice: false },
    { id: 'l_call', characterId: 'calltaker', text: 'Help is on the way. Keep pushing on the chest.', emotion: 'calm', wrongAdvice: false },
    { id: 'l_panic', characterId: 'friend', text: 'Quick, do something!', emotion: 'panicked', wrongAdvice: false },
  ],
  openingLineIds: ['l_open'],
  rubric: {
    items: [
      { id: 'r_safe', description: 'Checked the area was safe', check: { kind: 'did', actionId: 'check_safe' }, points: 15, critical: false, teachingPoint: 'Check for danger first, so you do not become a second casualty.', ref },
      { id: 'r_ask', description: 'Checked if the person responds', check: { kind: 'did', actionId: 'ask_ok' }, points: 15, critical: true, teachingPoint: 'Shout and tap to check for a response.', ref },
      { id: 'r_call', description: 'Called 907 quickly', check: { kind: 'didWithin', actionId: 'call_907', withinMs: 60000 }, points: 20, critical: true, teachingPoint: 'Call early. Emergency in Addis Ababa: 907.', ref },
      { id: 'r_rate', description: 'Compressions at 100 to 120 a minute', check: { kind: 'rateInRange', actionId: 'compress', minBpm: 100, maxBpm: 120, minShare: 0.5 }, points: 30, critical: true, teachingPoint: 'A steady fast rhythm keeps blood moving.', ref },
    ],
    harms: [
      { id: 'h_water', description: 'Gave water to an unresponsive person', actionId: 'give_water', deduction: 15, teachingPoint: 'Never give food or drink to someone who is not awake.', ref },
    ],
    time: { maxPoints: 20, targetMs: 90000, zeroAtMs: 240000 },
  },
  maxDurationMs: 300000,
  variants: [{ id: 'v1', label: 'Standard', finalOnly: false, flags: {}, timelineAtMs: {}, lineSwaps: {} }],
  disclaimer: 'Practice game - not a substitute for first aid training.',
};
