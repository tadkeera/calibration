/**
 * Structured comparison between two protocol revisions (also used to describe
 * every draft modification in the audit trail).
 */
import { canonicalJson, collectReferenceIds, type ProtocolContent, type ProtocolTest } from "./model";

export type DiffEntity =
  | "identification"
  | "narrative"
  | "stages"
  | "risk"
  | "equipment-link"
  | "reference-link"
  | "interval"
  | "section"
  | "test"
  | "reading-count"
  | "level"
  | "field"
  | "calculation"
  | "criterion"
  | "gap";

export type DiffEntry = {
  entity: DiffEntity;
  change: "added" | "removed" | "modified";
  path: string;
  label: string;
  before?: unknown;
  after?: unknown;
};

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function keyed<T extends { key: string }>(
  entity: DiffEntity,
  base: string,
  before: T[],
  after: T[],
  label: (x: T) => string,
  out: DiffEntry[],
  nested?: (b: T, a: T) => void
) {
  const a = new Map(after.map(x => [x.key, x]));
  const b = new Map(before.map(x => [x.key, x]));
  before.forEach(x => {
    if (!a.has(x.key)) out.push({ entity, change: "removed", path: `${base}.${x.key}`, label: label(x), before: x });
  });
  after.forEach(x => {
    const prev = b.get(x.key);
    if (!prev) out.push({ entity, change: "added", path: `${base}.${x.key}`, label: label(x), after: x });
    else if (!same(prev, x)) {
      if (nested) nested(prev, x);
      else out.push({ entity, change: "modified", path: `${base}.${x.key}`, label: label(x), before: prev, after: x });
    }
  });
}

function diffTest(prev: ProtocolTest, next: ProtocolTest, out: DiffEntry[]) {
  const p = `tests.${next.key}`;
  const { levels: pl, fields: pf, calculations: pc, criteria: pcr, ...prevCore } = prev;
  const { levels: nl, fields: nf, calculations: nc, criteria: ncr, ...nextCore } = next;
  if (prev.readingsRequired !== next.readingsRequired)
    out.push({ entity: "reading-count", change: "modified", path: `${p}.readingsRequired`, label: `${next.name}: readings ${prev.readingsRequired} → ${next.readingsRequired}`, before: prev.readingsRequired, after: next.readingsRequired });
  const { readingsRequired: _a, ...prevRest } = prevCore;
  const { readingsRequired: _b, ...nextRest } = nextCore;
  if (!same(prevRest, nextRest)) out.push({ entity: "test", change: "modified", path: p, label: next.name, before: prevRest, after: nextRest });
  keyed("level", `${p}.levels`, pl, nl, l => `${next.name}: level ${l.label || l.key}`, out);
  keyed("field", `${p}.fields`, pf, nf, f => `${next.name}: field ${f.label || f.key}`, out);
  keyed("calculation", `${p}.calculations`, pc, nc, c => `${next.name}: formula ${c.label || c.key}`, out);
  keyed("criterion", `${p}.criteria`, pcr, ncr, c => `${next.name}: criterion ${c.key}`, out);
}

export function compareContents(before: ProtocolContent, after: ProtocolContent): DiffEntry[] {
  const out: DiffEntry[] = [];
  (Object.keys(after.identification) as Array<keyof ProtocolContent["identification"]>).forEach(k => {
    if (!same(before.identification[k], after.identification[k]))
      out.push({ entity: "identification", change: "modified", path: `identification.${k}`, label: k, before: before.identification[k], after: after.identification[k] });
  });
  (Object.keys(after.narrative) as Array<keyof ProtocolContent["narrative"]>).forEach(k => {
    if (!same(before.narrative[k], after.narrative[k]))
      out.push({ entity: "narrative", change: "modified", path: `narrative.${k}`, label: k, before: before.narrative[k], after: after.narrative[k] });
  });
  if (!same(before.stages, after.stages)) out.push({ entity: "stages", change: "modified", path: "stages", label: "Qualification stages", before: before.stages, after: after.stages });
  if (!same(before.risk, after.risk)) out.push({ entity: "risk", change: "modified", path: "risk", label: "Risk assessment", before: before.risk, after: after.risk });
  const linkKey = <T extends { instrumentKey: string }>(x: T) => ({ ...x, key: x.instrumentKey });
  keyed("equipment-link", "equipmentLinks", before.equipmentLinks.map(linkKey), after.equipmentLinks.map(linkKey), l => `${l.instrumentKey} ${l.instrumentId}`, out);
  const refKey = <T extends { referenceId: string }>(x: T) => ({ ...x, key: x.referenceId });
  keyed("reference-link", "references", before.references.map(refKey), after.references.map(refKey), r => `Reference ${r.referenceId}`, out);
  const beforeRefs = collectReferenceIds(before);
  const afterRefs = collectReferenceIds(after);
  afterRefs.filter(r => !beforeRefs.includes(r)).forEach(r => out.push({ entity: "reference-link", change: "added", path: `allReferences.${r}`, label: `Reference ${r} now linked`, after: r }));
  beforeRefs.filter(r => !afterRefs.includes(r)).forEach(r => out.push({ entity: "reference-link", change: "removed", path: `allReferences.${r}`, label: `Reference ${r} no longer linked`, before: r }));
  keyed("interval", "intervals", before.intervals, after.intervals, i => i.activity, out);
  keyed("gap", "gaps", before.gaps, after.gaps, g => g.title, out);
  keyed("section", "sections", before.sections, after.sections, s => s.title, out, (prev, next) => {
    const { tests: pt, ...pcore } = prev;
    const { tests: nt, ...ncore } = next;
    if (!same(pcore, ncore)) out.push({ entity: "section", change: "modified", path: `sections.${next.key}`, label: next.title, before: pcore, after: ncore });
    if (!same(pt.map(t => t.key), nt.map(t => t.key)) && same([...pt.map(t => t.key)].sort(), [...nt.map(t => t.key)].sort()))
      out.push({ entity: "section", change: "modified", path: `sections.${next.key}.order`, label: `${next.title}: tests reordered`, before: pt.map(t => t.key), after: nt.map(t => t.key) });
  });
  if (!same(before.sections.map(s => s.key), after.sections.map(s => s.key)))
    out.push({ entity: "section", change: "modified", path: "sections.order", label: "Section order", before: before.sections.map(s => s.key), after: after.sections.map(s => s.key) });
  // Tests are compared across the whole protocol (a test may move between sections).
  const tb = new Map(before.sections.flatMap(s => s.tests).map(t => [t.key, t]));
  const ta = new Map(after.sections.flatMap(s => s.tests).map(t => [t.key, t]));
  tb.forEach((t, k) => !ta.has(k) && out.push({ entity: "test", change: "removed", path: `tests.${k}`, label: t.name, before: t }));
  ta.forEach((t, k) => {
    const prev = tb.get(k);
    if (!prev) out.push({ entity: "test", change: "added", path: `tests.${k}`, label: t.name, after: t });
    else if (!same(prev, t)) diffTest(prev, t, out);
  });
  return out;
}

export function summarizeDiff(entries: DiffEntry[]) {
  const counts: Record<string, number> = {};
  entries.forEach(e => {
    const k = `${e.entity}:${e.change}`;
    counts[k] = (counts[k] ?? 0) + 1;
  });
  return counts;
}
