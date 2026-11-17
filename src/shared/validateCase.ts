// Checks a case file against the contract schema and the cross-reference rules.
// Shared by the engine, the server, the content tests and the UI loader.
import { CaseFile, type Condition, type Effect } from './contract';

export type CaseCheck = { ok: true; caseFile: CaseFile } | { ok: false; errors: string[] };

export function validateCase(raw: unknown): CaseCheck {
  const parsed = CaseFile.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `schema: ${i.path.join('.')}: ${i.message}`),
    };
  }
  const c = parsed.data;
  const errors: string[] = [];
  const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
  const dupes = (label: string, xs: { id: string }[]) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (seen.has(x.id)) errors.push(`duplicate ${label} id: ${x.id}`);
      seen.add(x.id);
    }
  };
  dupes('action', c.actions);
  dupes('line', c.lines);
  dupes('character', c.characters);
  dupes('phase', c.phases);
  dupes('fact', c.facts);
  dupes('timeline event', c.timeline);
  dupes('rubric item', c.rubric.items);
  dupes('harm', c.rubric.harms);
  dupes('variant', c.variants);

  const actionIds = ids(c.actions);
  const lineIds = ids(c.lines);
  const characterIds = ids(c.characters);
  const phaseIds = ids(c.phases);
  const factIds = ids(c.facts);
  const eventIds = ids(c.timeline);
  const sourceIds = ids(c.sources);
  const counters = new Set<string>();
  const flagsSet = new Set<string>(Object.keys(c.initialFlags));
  for (const v of c.variants) for (const f of Object.keys(v.flags)) flagsSet.add(f);

  const need = (ok: boolean, msg: string) => {
    if (!ok) errors.push(msg);
  };
  const checkEffects = (where: string, effects: Effect[]) => {
    for (const e of effects) {
      if (e.type === 'gotoPhase') need(phaseIds.has(e.phaseId), `${where}: unknown phase ${e.phaseId}`);
      if (e.type === 'revealFact') need(factIds.has(e.factId), `${where}: unknown fact ${e.factId}`);
      if (e.type === 'say') {
        need(characterIds.has(e.characterId), `${where}: unknown character ${e.characterId}`);
        need(lineIds.has(e.lineId), `${where}: unknown line ${e.lineId}`);
        // A line is always spoken in its own voice: the say effect must name the line's speaker.
        const line = c.lines.find((l) => l.id === e.lineId);
        if (line)
          need(
            line.characterId === e.characterId,
            `${where}: say ${e.lineId} names ${e.characterId}, but the line belongs to ${line.characterId}`,
          );
      }
      if (e.type === 'addCounter') counters.add(e.counter);
      if (e.type === 'setFlag') flagsSet.add(e.flag);
    }
  };
  const checkCondition = (where: string, cond: Condition | undefined) => {
    if (!cond) return;
    if (cond.phaseId) need(phaseIds.has(cond.phaseId), `${where}: unknown phase ${cond.phaseId}`);
  };

  need(phaseIds.has(c.startPhaseId), `startPhaseId: unknown phase ${c.startPhaseId}`);
  for (const a of c.actions) {
    for (const p of a.phases) need(phaseIds.has(p), `action ${a.id}: unknown phase ${p}`);
    if (a.targetCharacterId)
      need(characterIds.has(a.targetCharacterId), `action ${a.id}: unknown character ${a.targetCharacterId}`);
    checkCondition(`action ${a.id}`, a.requires);
    checkEffects(`action ${a.id}`, a.effects);
  }
  for (const t of c.timeline) {
    need(t.atMs !== undefined || t.afterActionId !== undefined, `event ${t.id}: needs atMs or afterActionId`);
    if (t.afterActionId) need(actionIds.has(t.afterActionId), `event ${t.id}: unknown action ${t.afterActionId}`);
    checkCondition(`event ${t.id}`, t.when);
    checkEffects(`event ${t.id}`, t.effects);
  }
  for (const l of c.lines) {
    need(characterIds.has(l.characterId), `line ${l.id}: unknown character ${l.characterId}`);
    if (l.ref) need(sourceIds.has(l.ref.sourceId), `line ${l.id}: unknown source ${l.ref.sourceId}`);
    if (l.correctionHarmId !== undefined)
      need(c.rubric.harms.some((h) => h.id === l.correctionHarmId), `line ${l.id}: correctionHarmId names unknown harm ${l.correctionHarmId}`);
  }
  for (const id of c.openingLineIds) need(lineIds.has(id), `openingLineIds: unknown line ${id}`);
  for (const f of c.facts) {
    if (f.ref) need(sourceIds.has(f.ref.sourceId), `fact ${f.id}: unknown source ${f.ref.sourceId}`);
  }

  for (const r of c.rubric.items) {
    const k = r.check;
    if ('actionId' in k) need(actionIds.has(k.actionId), `rubric ${r.id}: unknown action ${k.actionId}`);
    if (k.kind === 'didBefore')
      need(actionIds.has(k.beforeActionId), `rubric ${r.id}: unknown action ${k.beforeActionId}`);
    if (k.kind === 'didWithin' && k.fromEventId)
      need(eventIds.has(k.fromEventId), `rubric ${r.id}: unknown event ${k.fromEventId}`);
    if (k.kind === 'countAtLeast') need(counters.has(k.counter), `rubric ${r.id}: counter ${k.counter} is never added to`);
    if (k.kind === 'rateInRange') {
      const a = c.actions.find((x) => x.id === k.actionId);
      need(a?.kind === 'rhythm', `rubric ${r.id}: rateInRange needs a rhythm action`);
    }
    need(sourceIds.has(r.ref.sourceId), `rubric ${r.id}: unknown source ${r.ref.sourceId}`);
    checkCondition(`rubric ${r.id} appliesWhen`, r.appliesWhen);
  }
  for (const h of c.rubric.harms) {
    need(actionIds.has(h.actionId), `harm ${h.id}: unknown action ${h.actionId}`);
    need(sourceIds.has(h.ref.sourceId), `harm ${h.id}: unknown source ${h.ref.sourceId}`);
  }
  const total = c.rubric.items.reduce((s, r) => s + r.points, 0) + c.rubric.time.maxPoints;
  need(total === 100, `rubric points plus time points must be 100, got ${total}`);
  need(c.rubric.time.targetMs < c.rubric.time.zeroAtMs, 'rubric.time: targetMs must be below zeroAtMs');

  for (const v of c.variants) {
    if (v.time)
      need(v.time.targetMs < v.time.zeroAtMs, `variant ${v.id}: time.targetMs must be below time.zeroAtMs`);
    for (const ev of Object.keys(v.timelineAtMs))
      need(eventIds.has(ev), `variant ${v.id}: unknown event ${ev}`);
    for (const [from, to] of Object.entries(v.lineSwaps)) {
      need(lineIds.has(from), `variant ${v.id}: unknown line ${from}`);
      need(lineIds.has(to), `variant ${v.id}: unknown line ${to}`);
    }
  }
  need(c.variants.some((v) => !v.finalOnly), 'at least one practice variant (finalOnly false) is needed');

  for (const a of c.actions) {
    for (const cond of [a.requires]) {
      if (cond?.flag) need(flagsSet.has(cond.flag), `action ${a.id}: flag ${cond.flag} is never set`);
      if (cond?.counter) need(counters.has(cond.counter), `action ${a.id}: counter ${cond.counter} is never added to`);
    }
  }
  for (const t of c.timeline) {
    if (t.when?.flag) need(flagsSet.has(t.when.flag), `event ${t.id}: flag ${t.when.flag} is never set`);
    if (t.when?.counter) need(counters.has(t.when.counter), `event ${t.id}: counter ${t.when.counter} is never added to`);
  }
  for (const r of c.rubric.items) {
    const w = r.appliesWhen;
    if (w?.flag) need(flagsSet.has(w.flag), `rubric ${r.id}: appliesWhen flag ${w.flag} is never set`);
    if (w?.counter) need(counters.has(w.counter), `rubric ${r.id}: appliesWhen counter ${w.counter} is never added to`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, caseFile: c };
}
