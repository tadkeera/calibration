/**
 * Generic Protocol Builder (§7–§13). One builder for every equipment type —
 * sections, tests, readings, levels, fields, calculations, acceptance
 * criteria, references, intervals, risk and technical gaps are configuration
 * data. Saving is server-validated (row-version guarded); unsaved work is kept
 * in local storage so it is never lost on a failed save or reload.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, Link2, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  CALC_KINDS,
  COMPARISONS,
  DATA_TYPES,
  FIELD_TYPES,
  GRAPH_TYPES,
  type GraphSpec,
  INTERVAL_ACTIVITIES,
  INTERVAL_UNITS,
  PENDING_LABEL,
  PROTOCOL_TYPES,
  QUALIFICATION_STAGES,
  RISK_FACTORS,
  RISK_LEVELS,
  SOURCE_CLASSES,
  STANDARD_SECTIONS,
  canonicalJson,
  parseProtocolContent,
  type Calculation,
  type Criterion,
  type ProtocolContent,
  type ProtocolSection,
  type ProtocolTest,
} from "@shared/protocols/model";
import { submissionIssues, type ReferenceLookup } from "@shared/protocols/validation";
import { ErrorBox, Field, Loading, Panel, PendingTag, askReason, errorText, newKey, type Nav, type ReferenceRowDto } from "./common";

type Mut = (fn: (c: ProtocolContent) => void) => void;
const backupKey = (revisionId: string) => `pm-draft-backup:${revisionId}`;
const numOrNull = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
const move = <T,>(list: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
};

export function ProtocolBuilder({ revisionId, setNav }: { revisionId: string; setNav: (n: Nav) => void }) {
  const utils = trpc.useUtils();
  const rev = trpc.protocols.revision.useQuery({ revisionId }, { refetchOnWindowFocus: false });
  const refs = trpc.protocols.references.useQuery();
  const equipment = trpc.protocols.equipment.useQuery();
  const save = trpc.protocols.saveDraft.useMutation();
  const [content, setContent] = useState<ProtocolContent | null>(null);
  const [baseline, setBaseline] = useState("");
  const [rowVersion, setRowVersion] = useState(0);
  const [section, setSection] = useState("identification");
  const [picker, setPicker] = useState<null | ((id: string) => void)>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!rev.data || loaded.current) return;
    loaded.current = true;
    const server = rev.data.revision.content;
    setBaseline(canonicalJson(server));
    setRowVersion(rev.data.revision.rowVersion);
    const backup = localStorage.getItem(backupKey(revisionId));
    if (backup) {
      try {
        const parsed = JSON.parse(backup) as { rowVersion: number; content: unknown };
        const restored = parseProtocolContent(parsed.content);
        if (canonicalJson(restored) !== canonicalJson(server) && window.confirm(`Unsaved changes from a previous session were found for this draft (based on version ${parsed.rowVersion}). Restore them?`)) {
          setContent(restored);
          return;
        }
      } catch {
        /* invalid backup is ignored */
      }
      localStorage.removeItem(backupKey(revisionId));
    }
    setContent(structuredClone(server));
  }, [rev.data, revisionId]);

  const dirty = !!content && canonicalJson(content) !== baseline;
  useEffect(() => {
    if (content && dirty) localStorage.setItem(backupKey(revisionId), JSON.stringify({ rowVersion, content }));
  }, [content, dirty, revisionId, rowVersion]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const lookup: ReferenceLookup = useMemo(() => new Map((refs.data ?? []).map(r => [r.id, { id: r.id, code: r.code, title: r.title, verificationStatus: r.verificationStatus, expiryDate: r.expiryDate || null, reviewDate: r.reviewDate || null }])), [refs.data]);
  const issues = useMemo(() => (content ? submissionIssues(content, lookup) : []), [content, lookup]);
  const refCode = (id: string | null) => (id ? refs.data?.find(r => r.id === id)?.code ?? "unknown reference" : "");

  if (rev.isLoading || !content) return rev.error ? <ErrorBox error={rev.error} /> : <Loading label="Loading draft…" />;
  const r = rev.data!;
  if (!r.editable)
    return <ErrorBox>Revision {r.revision.revisionNumber} is {r.revision.statusLabel} and cannot be edited{r.revision.locked ? " (approved content is immutable — create a new revision)" : ""}, or you do not hold the Protocol Author duty.</ErrorBox>;

  const mut: Mut = fn =>
    setContent(prev => {
      const next = structuredClone(prev!) as ProtocolContent;
      fn(next);
      return next;
    });

  const doSave = async () => {
    const reason = askReason("Reason for these changes");
    if (!reason) return;
    try {
      const res = await save.mutateAsync({ revisionId, expectedRowVersion: rowVersion, content, reason });
      setRowVersion(res.rowVersion);
      setBaseline(canonicalJson(content));
      localStorage.removeItem(backupKey(revisionId));
      await Promise.all([utils.protocols.revision.invalidate({ revisionId }), utils.protocols.detail.invalidate(), utils.protocols.list.invalidate(), utils.protocols.dashboard.invalidate()]);
      toast.success(res.changes ? `Draft saved (${res.changes} change(s) audited)` : "No changes to save");
    } catch (e) {
      toast.error(`Not saved — your changes are kept in this editor. ${errorText(e)}`);
    }
  };

  const errors = issues.filter(i => i.severity === "error");
  const navItems: Array<[string, string]> = [["identification", "Identification"], ["narrative", "Narrative"], ["stages", "Stages & risk"], ["equipment", "Equipment links"], ["references", "Protocol references"], ["intervals", "Intervals"], ["gaps", "Technical gaps"], ...content.sections.map((s, i) => [`section:${s.key}`, `${i + 1}. ${s.title}`] as [string, string]), ["add-section", "+ Add section"]];
  const currentSection = section.startsWith("section:") ? content.sections.findIndex(s => `section:${s.key}` === section) : -1;

  return (
    <div className="pm-grid">
      <Panel
        title={<>Builder — {content.identification.number} rev {r.revision.revisionNumber} <span className="pm-badge pm-tone-neutral">{r.revision.statusLabel}</span></>}
        actions={
          <>
            {dirty ? <span className="pm-badge pm-tone-warn">Unsaved changes (backed up locally)</span> : <span className="pm-badge pm-tone-ok">Saved</span>}
            <button type="button" className="pm-btn" disabled={!dirty} onClick={() => { if (window.confirm("Discard unsaved changes?")) { setContent(structuredClone(r.revision.content)); localStorage.removeItem(backupKey(revisionId)); } }}><Undo2 size={14} /> Discard</button>
            <button type="button" className="pm-btn primary" disabled={!dirty || save.isPending} onClick={doSave}><Save size={14} /> {save.isPending ? "Saving…" : "Save draft"}</button>
            <button type="button" className="pm-btn" onClick={() => { if (!dirty || window.confirm("Leave with unsaved changes? (they stay backed up locally)")) setNav({ view: "detail", protocolId: r.protocol.id, tab: "review" }); }}>Close</button>
          </>
        }
      >
        <div className={`pm-alert ${errors.length ? "pm-alert-warn" : "pm-alert-ok"}`}>
          <div>
            {errors.length ? <><strong>{errors.length} issue(s) must be resolved before the Quality Manager can approve this draft.</strong> Drafts can be saved at any time.</> : <strong>Ready for Quality Manager approval (Protocol page → Approve).</strong>}
            {issues.length > 0 && (
              <details><summary>Show {issues.length} validation message(s)</summary><ul>{issues.map((i, k) => <li key={k} className={i.severity === "error" ? "pm-diff-removed" : "pm-diff-modified"}>{i.message}</li>)}</ul></details>
            )}
          </div>
        </div>
      </Panel>
      <div className="pm-split" style={{ gridTemplateColumns: "220px minmax(0,1fr)" }}>
        <nav className="pm-panel pm-builder-nav" aria-label="Builder sections">
          {navItems.map(([k, l]) => <button key={k} type="button" className={section === k ? "is-active" : ""} onClick={() => setSection(k)}>{l}</button>)}
        </nav>
        <div className="pm-grid">
          {section === "identification" && <IdentificationEditor c={content} mut={mut} lockNumber={r.revision.revisionNumber > 1 || !!r.protocol.releasedRevisionId} />}
          {section === "narrative" && <NarrativeEditor c={content} mut={mut} />}
          {section === "stages" && <StagesRiskEditor c={content} mut={mut} />}
          {section === "equipment" && <EquipmentEditor c={content} mut={mut} equipment={equipment.data ?? []} />}
          {section === "references" && <ProtocolRefsEditor c={content} mut={mut} refCode={refCode} pick={setPicker} />}
          {section === "intervals" && <IntervalsEditor c={content} mut={mut} refCode={refCode} pick={setPicker} />}
          {section === "gaps" && <GapsEditor c={content} mut={mut} refCode={refCode} pick={setPicker} />}
          {section === "add-section" && <AddSection c={content} mut={mut} onAdded={k => setSection(`section:${k}`)} />}
          {currentSection >= 0 && <SectionEditor c={content} index={currentSection} mut={mut} refCode={refCode} pick={setPicker} onRemoved={() => setSection("identification")} />}
        </div>
      </div>
      {picker && <ReferencePicker refs={refs.data ?? []} onPick={id => { picker(id); setPicker(null); }} onClose={() => setPicker(null)} />}
    </div>
  );
}

/* ------------------------------ editors ------------------------------ */

function IdentificationEditor({ c, mut, lockNumber }: { c: ProtocolContent; mut: Mut; lockNumber: boolean }) {
  const id = c.identification;
  const set = (k: keyof typeof id, v: string) => mut(x => { (x.identification as Record<string, unknown>)[k] = v; });
  const text = (k: keyof typeof id, label: string, opts: { hint?: string; wide?: boolean; area?: boolean } = {}) => (
    <Field label={label} hint={opts.hint} wide={opts.wide}>{opts.area ? <textarea value={String(id[k] ?? "")} onChange={e => set(k, e.target.value)} /> : <input value={String(id[k] ?? "")} onChange={e => set(k, e.target.value)} />}</Field>
  );
  return (
    <Panel title="Protocol identification">
      <div className="pm-grid c3">
        {text("title", "Protocol title *", { wide: true })}
        <Field label="Protocol number *" hint={lockNumber ? "Fixed after release / revision" : "Unique"}><input value={id.number} disabled={lockNumber} onChange={e => set("number", e.target.value.toUpperCase())} /></Field>
        <Field label="Protocol type"><select value={id.protocolType} onChange={e => set("protocolType", e.target.value)}>{PROTOCOL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Association"><select value={id.associationType} onChange={e => set("associationType", e.target.value)}><option value="model">Model-level (all equipment of this model)</option><option value="equipment">Equipment-specific (linked equipment only)</option></select></Field>
        {text("category", "Protocol category")}
        {text("equipmentCategory", "Equipment category")}
        {text("equipmentType", "Equipment type")}
        {text("manufacturer", "Manufacturer *")}
        {text("model", "Model *")}
        {text("intendedUse", "Intended use")}
        {text("department", "Department")}
        {text("relatedForm", "Related form")}
        {text("applicableSops", "Applicable SOPs")}
        {text("applicableStandards", "Applicable standards (informative)", { wide: true, area: true, hint: "Traceable links belong in Protocol references / criteria." })}
        {text("description", "Description", { wide: true, area: true })}
      </div>
    </Panel>
  );
}

const NARRATIVE: Array<[keyof ProtocolContent["narrative"], string]> = [["purpose", "Purpose *"], ["scope", "Scope *"], ["responsibilities", "Responsibilities"], ["definitions", "Definitions"], ["abbreviations", "Abbreviations"], ["equipmentDescription", "Equipment description"], ["intendedApplication", "Intended application"], ["requiredQualifications", "Required personnel qualifications"], ["requiredMaterials", "Required materials"], ["requiredReferenceStandards", "Required reference standards"], ["environmentalConditions", "Environmental conditions"], ["safetyRequirements", "Safety requirements"], ["deviationManagement", "Deviation management"], ["finalAssessment", "Final assessment"]];

function NarrativeEditor({ c, mut }: { c: ProtocolContent; mut: Mut }) {
  return (
    <Panel title="Narrative sections">
      <div className="pm-grid c2">
        {NARRATIVE.map(([k, l]) => <Field key={k} label={l}><textarea value={c.narrative[k]} onChange={e => mut(x => { x.narrative[k] = e.target.value; })} /></Field>)}
      </div>
    </Panel>
  );
}

function StagesRiskEditor({ c, mut }: { c: ProtocolContent; mut: Mut }) {
  return (
    <>
      <Panel title="Applicable qualification stages">
        <div className="pm-row">
          {QUALIFICATION_STAGES.map(s => (
            <label key={s} className="pm-check"><input type="checkbox" checked={c.stages.includes(s)} onChange={e => mut(x => { x.stages = e.target.checked ? [...x.stages, s] : x.stages.filter(v => v !== s); })} /> {s}</label>
          ))}
        </div>
      </Panel>
      <Panel title="Risk assessment (§12)">
        <div className="pm-grid c3">
          {RISK_FACTORS.map(f => (
            <Field key={f.id} label={f.label}><select value={c.risk[f.id]} onChange={e => mut(x => { (x.risk as Record<string, string>)[f.id] = e.target.value; })}>{RISK_LEVELS.map(l => <option key={l} value={l}>{l || "— not assessed —"}</option>)}</select></Field>
          ))}
          <Field label="Overall risk *"><select value={c.risk.overall} onChange={e => mut(x => { x.risk.overall = e.target.value as typeof x.risk.overall; })}>{RISK_LEVELS.map(l => <option key={l} value={l}>{l || "— not assessed —"}</option>)}</select></Field>
          <Field label="Risk justification *" wide><textarea value={c.risk.justification} onChange={e => mut(x => { x.risk.justification = e.target.value; })} /></Field>
        </div>
      </Panel>
    </>
  );
}

function EquipmentEditor({ c, mut, equipment }: { c: ProtocolContent; mut: Mut; equipment: Array<{ instrumentKey: string; name: string; instrumentId: string; manufacturer: string; model: string; serialNumber: string; source: string }> }) {
  const [pick, setPick] = useState("");
  const norm = (v: string) => v.toLowerCase().replace(/\(.*?\)/g, "").replace(/&|\band\b/g, "+").replace(/[^a-z0-9+]/g, "");
  return (
    <Panel title="Equipment association (§6)" actions={<span className="pm-muted">Linked from the existing Equipment Library — no equipment record is created or changed here.</span>}>
      <div className="pm-row" style={{ marginBottom: 10 }}>
        <select className="pm-input" style={{ maxWidth: 420 }} value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Select registered equipment…</option>
          {equipment.map(e => <option key={e.instrumentKey} value={e.instrumentKey}>{e.name} · {e.instrumentId} · {e.manufacturer} {e.model} · S/N {e.serialNumber}</option>)}
        </select>
        <button type="button" className="pm-btn" disabled={!pick || c.equipmentLinks.some(l => l.instrumentKey === pick)} onClick={() => { const e = equipment.find(x => x.instrumentKey === pick)!; mut(x => { x.equipmentLinks.push({ instrumentKey: e.instrumentKey, instrumentId: e.instrumentId, serialNumber: e.serialNumber, manufacturer: e.manufacturer, model: e.model, compatibilityNote: "" }); }); setPick(""); }}><Plus size={14} /> Link equipment</button>
      </div>
      {!c.equipmentLinks.length ? <div className="pm-empty">{c.identification.associationType === "equipment" ? "An equipment-specific protocol requires at least one link." : "Model-level protocol — applies to every compatible equipment item of this manufacturer/model."}</div> : (
        <ul className="pm-list">
          {c.equipmentLinks.map((l, i) => {
            const current = equipment.find(e => e.instrumentKey === l.instrumentKey);
            const warnings = [
              !current && "Equipment no longer registered",
              current && current.instrumentId !== l.instrumentId && `Equipment ID changed (${l.instrumentId} → ${current.instrumentId})`,
              current && current.serialNumber !== l.serialNumber && `Serial changed (${l.serialNumber} → ${current.serialNumber})`,
              norm(l.manufacturer) !== norm(c.identification.manufacturer) && "Manufacturer differs from protocol",
              norm(l.model) !== norm(c.identification.model) && "Model differs from protocol",
            ].filter(Boolean);
            return (
              <li key={l.instrumentKey}>
                <div>
                  <strong>{l.instrumentId}</strong> · {l.manufacturer} {l.model} · S/N {l.serialNumber} <span className="pm-muted">({l.instrumentKey})</span>
                  {warnings.map((w, k) => <div key={k} className="pm-diff-removed">⚠ {w}</div>)}
                  <input className="pm-input" style={{ marginTop: 6 }} placeholder="Compatibility note" value={l.compatibilityNote} onChange={e => mut(x => { x.equipmentLinks[i].compatibilityNote = e.target.value; })} />
                </div>
                <button type="button" className="pm-btn small danger" onClick={() => mut(x => { x.equipmentLinks.splice(i, 1); })}><Trash2 size={12} /></button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function RefButton({ value, refCode, onPick, onClear }: { value: string | null; refCode: (id: string | null) => string; onPick: () => void; onClear: () => void }) {
  return (
    <div className="pm-row">
      <button type="button" className="pm-btn small" onClick={onPick}><Link2 size={12} /> {value ? refCode(value) : "Link reference"}</button>
      {value && <button type="button" className="pm-btn small ghost" onClick={onClear}>×</button>}
    </div>
  );
}

function ProtocolRefsEditor({ c, mut, refCode, pick }: { c: ProtocolContent; mut: Mut; refCode: (id: string | null) => string; pick: (fn: (id: string) => void) => void }) {
  return (
    <Panel title="Protocol-level references" actions={<button type="button" className="pm-btn" onClick={() => pick(id => mut(x => { if (!x.references.some(r => r.referenceId === id)) x.references.push({ referenceId: id, supports: "", clause: "" }); }))}><Plus size={14} /> Add from library</button>}>
      {!c.references.length ? <div className="pm-empty">No protocol-level references. Each must state what it supports.</div> : (
        <ul className="pm-list">
          {c.references.map((r, i) => (
            <li key={r.referenceId}>
              <div className="pm-grid c3" style={{ flex: 1 }}>
                <strong>{refCode(r.referenceId)}</strong>
                <input className="pm-input" placeholder="Supports (required)" value={r.supports} onChange={e => mut(x => { x.references[i].supports = e.target.value; })} />
                <input className="pm-input" placeholder="Clause / section" value={r.clause} onChange={e => mut(x => { x.references[i].clause = e.target.value; })} />
              </div>
              <button type="button" className="pm-btn small danger" onClick={() => mut(x => { x.references.splice(i, 1); })}><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function IntervalsEditor({ c, mut, refCode, pick }: { c: ProtocolContent; mut: Mut; refCode: (id: string | null) => string; pick: (fn: (id: string) => void) => void }) {
  return (
    <Panel title="Calibration / verification intervals (§13)" actions={<button type="button" className="pm-btn" onClick={() => mut(x => { x.intervals.push({ key: newKey("int"), activity: "Periodic Review", value: null, unit: "months", event: "", mandatory: false, sourceClass: "institutional", referenceId: null, riskBasis: "", justification: "", department: "", verificationStatus: "pending-technical-verification" }); })}><Plus size={14} /> Add interval</button>}>
      {!c.intervals.length && <div className="pm-empty">No intervals. The “Periodic Review” interval drives the next review date at release.</div>}
      {c.intervals.map((iv, i) => (
        <div key={iv.key} className="pm-card" style={{ marginBottom: 8 }}>
          <div className="pm-card-head"><strong>{iv.activity}</strong><div className="pm-row"><PendingTag verified={iv.verificationStatus === "verified"} /><button type="button" className="pm-btn small danger" onClick={() => mut(x => { x.intervals.splice(i, 1); })}><Trash2 size={12} /></button></div></div>
          <div className="pm-grid c4">
            <Field label="Activity"><select value={iv.activity} onChange={e => mut(x => { x.intervals[i].activity = e.target.value; })}>{Array.from(new Set([...INTERVAL_ACTIVITIES, iv.activity])).map(a => <option key={a}>{a}</option>)}</select></Field>
            <Field label="Unit"><select value={iv.unit} onChange={e => mut(x => { x.intervals[i].unit = e.target.value as typeof iv.unit; })}>{INTERVAL_UNITS.map(u => <option key={u}>{u}</option>)}</select></Field>
            {iv.unit === "event" ? <Field label="Event"><input value={iv.event} onChange={e => mut(x => { x.intervals[i].event = e.target.value; })} placeholder="e.g. after major repair" /></Field> : <Field label="Value"><input type="number" min={1} value={iv.value ?? ""} onChange={e => mut(x => { x.intervals[i].value = numOrNull(e.target.value); })} /></Field>}
            <Field label="Source class"><select value={iv.sourceClass} onChange={e => mut(x => { x.intervals[i].sourceClass = e.target.value as typeof iv.sourceClass; })}>{SOURCE_CLASSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
            <label className="pm-check"><input type="checkbox" checked={iv.mandatory} onChange={e => mut(x => { x.intervals[i].mandatory = e.target.checked; })} /> Mandatory</label>
            <Field label="Reference"><RefButton value={iv.referenceId} refCode={refCode} onPick={() => pick(id => mut(x => { x.intervals[i].referenceId = id; }))} onClear={() => mut(x => { x.intervals[i].referenceId = null; })} /></Field>
            <Field label="Department"><input value={iv.department} onChange={e => mut(x => { x.intervals[i].department = e.target.value; })} /></Field>
            <Field label="Verification"><select value={iv.verificationStatus} onChange={e => mut(x => { x.intervals[i].verificationStatus = e.target.value as typeof iv.verificationStatus; })}><option value="pending-technical-verification">{PENDING_LABEL}</option><option value="verified">Verified</option></select></Field>
            <Field label="Technical justification *" wide><textarea value={iv.justification} onChange={e => mut(x => { x.intervals[i].justification = e.target.value; })} /></Field>
            <Field label="Risk basis" wide><input value={iv.riskBasis} onChange={e => mut(x => { x.intervals[i].riskBasis = e.target.value; })} /></Field>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function GapsEditor({ c, mut, refCode, pick }: { c: ProtocolContent; mut: Mut; refCode: (id: string | null) => string; pick: (fn: (id: string) => void) => void }) {
  return (
    <Panel title="Technical gaps and conflicts (§10.4)" actions={<button type="button" className="pm-btn" onClick={() => mut(x => { x.gaps.push({ key: newKey("gap"), title: "New technical gap", description: "", testKey: null, unit: "", assessment: "", claimRestriction: "", specifications: [{ label: "Specification A", value: null, displayValue: "", sourceClass: "manufacturer", referenceId: null, clause: "" }, { label: "Specification B", value: null, displayValue: "", sourceClass: "pharmacopoeial", referenceId: null, clause: "" }] }); })}><Plus size={14} /> Add gap</button>}>
      <p className="pm-muted" style={{ marginTop: 0 }}>Gaps are shown side by side with their sources. Approval requires a documented assessment by the author and a technical reviewer decision (recorded during technical review).</p>
      {c.gaps.map((g, gi) => (
        <div key={g.key} className="pm-gap" style={{ marginBottom: 10 }}>
          <div className="pm-grid c3">
            <Field label="Title"><input value={g.title} onChange={e => mut(x => { x.gaps[gi].title = e.target.value; })} /></Field>
            <Field label="Related test"><select value={g.testKey ?? ""} onChange={e => mut(x => { x.gaps[gi].testKey = e.target.value || null; })}><option value="">—</option>{c.sections.flatMap(s => s.tests).map(t => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>
            <Field label="Unit"><input value={g.unit} onChange={e => mut(x => { x.gaps[gi].unit = e.target.value; })} /></Field>
            <Field label="Description *" wide><textarea value={g.description} onChange={e => mut(x => { x.gaps[gi].description = e.target.value; })} /></Field>
          </div>
          <div className="pm-gap-specs">
            {g.specifications.map((s, si) => (
              <div key={si} className="pm-grid">
                <input className="pm-input" value={s.label} onChange={e => mut(x => { x.gaps[gi].specifications[si].label = e.target.value; })} />
                <div className="pm-grid c2"><input className="pm-input" placeholder="Value" type="number" step="any" value={s.value ?? ""} onChange={e => mut(x => { x.gaps[gi].specifications[si].value = numOrNull(e.target.value); })} /><input className="pm-input" placeholder="Display (e.g. ±0.02°)" value={s.displayValue} onChange={e => mut(x => { x.gaps[gi].specifications[si].displayValue = e.target.value; })} /></div>
                <select className="pm-input" value={s.sourceClass} onChange={e => mut(x => { x.gaps[gi].specifications[si].sourceClass = e.target.value as typeof s.sourceClass; })}>{SOURCE_CLASSES.map(sc => <option key={sc.id} value={sc.id}>{sc.label}</option>)}</select>
                <RefButton value={s.referenceId} refCode={refCode} onPick={() => pick(id => mut(x => { x.gaps[gi].specifications[si].referenceId = id; }))} onClear={() => mut(x => { x.gaps[gi].specifications[si].referenceId = null; })} />
              </div>
            ))}
          </div>
          {g.specifications.length === 2 && g.specifications.every(s => s.value !== null) && <div className="pm-muted">Difference: {Math.abs((g.specifications[0].value as number) - (g.specifications[1].value as number)).toPrecision(3)} {g.unit}</div>}
          <Field label="Technical assessment (author) — required before approval"><textarea value={g.assessment} onChange={e => mut(x => { x.gaps[gi].assessment = e.target.value; })} /></Field>
          <Field label="Claim restriction"><input value={g.claimRestriction} onChange={e => mut(x => { x.gaps[gi].claimRestriction = e.target.value; })} /></Field>
          <div><button type="button" className="pm-btn small danger" onClick={() => window.confirm("Remove this gap from the draft?") && mut(x => { x.gaps.splice(gi, 1); })}><Trash2 size={12} /> Remove gap</button></div>
        </div>
      ))}
    </Panel>
  );
}

function AddSection({ c, mut, onAdded }: { c: ProtocolContent; mut: Mut; onAdded: (key: string) => void }) {
  const [title, setTitle] = useState("");
  const add = (s: { key: string; title: string; stage: string; required: boolean }) => {
    const key = c.sections.some(x => x.key === s.key) ? newKey(s.key) : s.key;
    mut(x => { x.sections.push({ key, title: s.title, stage: s.stage, required: s.required, description: "", body: "", referenceIds: [], attachments: "", tests: [] }); });
    onAdded(key);
  };
  return (
    <Panel title="Add a section">
      <h3>Standard sections (§7.3)</h3>
      <div className="pm-row">{STANDARD_SECTIONS.map(s => <button key={s.key} type="button" className="pm-btn small" disabled={c.sections.some(x => x.title === s.title)} onClick={() => add(s)}>{s.title}{s.required ? " *" : ""}</button>)}</div>
      <h3>Custom section</h3>
      <div className="pm-row"><input className="pm-input" style={{ maxWidth: 360 }} value={title} onChange={e => setTitle(e.target.value)} placeholder="Section title" /><button type="button" className="pm-btn" disabled={!title.trim()} onClick={() => { add({ key: newKey("sec"), title: title.trim(), stage: "General", required: false }); setTitle(""); }}><Plus size={14} /> Add</button></div>
    </Panel>
  );
}

function SectionEditor({ c, index, mut, refCode, pick, onRemoved }: { c: ProtocolContent; index: number; mut: Mut; refCode: (id: string | null) => string; pick: (fn: (id: string) => void) => void; onRemoved: () => void }) {
  const s = c.sections[index];
  const set = <K extends keyof ProtocolSection>(k: K, v: ProtocolSection[K]) => mut(x => { x.sections[index][k] = v; });
  const allTestKeys = c.sections.flatMap(sec => sec.tests.map(t => t.key));
  const addTest = () => {
    let key = newKey("test");
    while (allTestKeys.includes(key)) key = newKey("test");
    mut(x => { x.sections[index].tests.push(blankTest(key, s.stage)); });
  };
  return (
    <>
      <Panel
        title={<>Section {index + 1}: {s.title}</>}
        actions={
          <>
            <button type="button" className="pm-btn small" disabled={index === 0} onClick={() => mut(x => move(x.sections, index, -1))}><ArrowUp size={12} /> Up</button>
            <button type="button" className="pm-btn small" disabled={index === c.sections.length - 1} onClick={() => mut(x => move(x.sections, index, 1))}><ArrowDown size={12} /> Down</button>
            <button type="button" className="pm-btn small danger" onClick={() => { if (window.confirm(`Remove section "${s.title}" and its ${s.tests.length} test(s) from this draft?`)) { mut(x => { x.sections.splice(index, 1); }); onRemoved(); } }}><Trash2 size={12} /> Remove</button>
          </>
        }
      >
        <div className="pm-grid c3">
          <Field label="Title"><input value={s.title} onChange={e => set("title", e.target.value)} /></Field>
          <Field label="Stage"><select value={s.stage} onChange={e => set("stage", e.target.value)}><option value="">—</option>{QUALIFICATION_STAGES.map(q => <option key={q}>{q}</option>)}</select></Field>
          <label className="pm-check"><input type="checkbox" checked={s.required} onChange={e => set("required", e.target.checked)} /> Required section</label>
          <Field label="Description" wide><textarea value={s.description} onChange={e => set("description", e.target.value)} /></Field>
          <Field label="Section text" wide><textarea value={s.body} onChange={e => set("body", e.target.value)} /></Field>
          <Field label="Attachments"><input value={s.attachments} onChange={e => set("attachments", e.target.value)} /></Field>
          <Field label="Section references" wide>
            <div className="pm-row">{s.referenceIds.map(id => <span key={id} className="pm-badge pm-tone-info">{refCode(id)} <button type="button" className="pm-btn small ghost" onClick={() => set("referenceIds", s.referenceIds.filter(x => x !== id))}>×</button></span>)}<button type="button" className="pm-btn small" onClick={() => pick(id => mut(x => { if (!x.sections[index].referenceIds.includes(id)) x.sections[index].referenceIds.push(id); }))}><Link2 size={12} /> Link</button></div>
          </Field>
        </div>
      </Panel>
      <Panel title={`Tests (${s.tests.length})`} actions={<button type="button" className="pm-btn primary" onClick={addTest}><Plus size={14} /> Add test</button>}>
        {!s.tests.length && <div className="pm-empty">No tests in this section.</div>}
        {s.tests.map((t, ti) => <TestEditor key={t.key} c={c} si={index} ti={ti} mut={mut} refCode={refCode} pick={pick} />)}
      </Panel>
    </>
  );
}

function blankTest(key: string, stage: string): ProtocolTest {
  return parseProtocolContent({ identification: { title: "tmp x", number: "TMP", protocolType: "custom" }, sections: [{ key: "s", title: "s", tests: [{ key, name: "New test", stage }] }] }).sections[0].tests[0];
}

function TestEditor({ c, si, ti, mut, refCode, pick }: { c: ProtocolContent; si: number; ti: number; mut: Mut; refCode: (id: string | null) => string; pick: (fn: (id: string) => void) => void }) {
  const t = c.sections[si].tests[ti];
  const [open, setOpen] = useState(false);
  const up = (fn: (t: ProtocolTest) => void) => mut(x => fn(x.sections[si].tests[ti]));
  const set = <K extends keyof ProtocolTest>(k: K, v: ProtocolTest[K]) => up(x => { x[k] = v; });
  const txt = (k: "name" | "objective" | "description" | "method" | "procedure" | "category" | "parameter" | "unit" | "conditions" | "requiredMaterials" | "requiredInstruments" | "requiredReferenceStandards" | "requiredEvidence" | "notes" | "referenceClause", label: string, area = false, wide = false) => (
    <Field label={label} wide={wide}>{area ? <textarea value={t[k]} onChange={e => set(k, e.target.value)} /> : <input value={t[k]} onChange={e => set(k, e.target.value)} />}</Field>
  );
  const earlier = c.sections.flatMap(s => s.tests).slice(0, c.sections.slice(0, si).reduce((n, s) => n + s.tests.length, 0) + ti);
  const pending = t.criteria.filter(cr => cr.verificationStatus !== "verified").length;
  return (
    <div className="pm-card is-test" style={{ marginBottom: 8 }}>
      <div className="pm-card-head">
        <button type="button" className="pm-btn ghost" onClick={() => setOpen(o => !o)}><strong>{open ? "▾" : "▸"} {t.name}</strong> <span className="pm-muted">({t.key} · {t.dataType} · {t.readingsRequired} reading(s){t.levels.length ? ` · ${t.levels.length} levels` : ""}{pending ? ` · ${pending} pending` : ""})</span></button>
        <div className="pm-row">
          <button type="button" className="pm-btn small" disabled={ti === 0} onClick={() => mut(x => move(x.sections[si].tests, ti, -1))}><ArrowUp size={12} /></button>
          <button type="button" className="pm-btn small" disabled={ti === c.sections[si].tests.length - 1} onClick={() => mut(x => move(x.sections[si].tests, ti, 1))}><ArrowDown size={12} /></button>
          <button type="button" className="pm-btn small" title="Duplicate" onClick={() => mut(x => { const copy = structuredClone(t); copy.key = newKey(t.key.slice(0, 50)); copy.name = `${t.name} (copy)`; x.sections[si].tests.splice(ti + 1, 0, copy); })}><Copy size={12} /></button>
          <button type="button" className="pm-btn small danger" onClick={() => window.confirm(`Remove test "${t.name}" from this draft?`) && mut(x => { x.sections[si].tests.splice(ti, 1); })}><Trash2 size={12} /></button>
        </div>
      </div>
      {open && (
        <>
          <div className="pm-grid c3">
            {txt("name", "Test name *")}
            <Field label="Test key" hint="Unique in the protocol; used by formulas and executions"><input value={t.key} onChange={e => set("key", e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} /></Field>
            {txt("category", "Category")}
            <Field label="Stage"><select value={t.stage} onChange={e => set("stage", e.target.value)}><option value="">—</option>{QUALIFICATION_STAGES.map(q => <option key={q}>{q}</option>)}</select></Field>
            <Field label="Data type"><select value={t.dataType} onChange={e => set("dataType", e.target.value as ProtocolTest["dataType"])}>{DATA_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
            <label className="pm-check"><input type="checkbox" checked={t.required} onChange={e => set("required", e.target.checked)} /> Required test</label>
            <Field label="Readings required"><input type="number" min={0} max={100} value={t.readingsRequired} onChange={e => set("readingsRequired", Math.max(0, Math.min(100, Number(e.target.value) || 0)))} /></Field>
            <Field label="Replicates"><input type="number" min={1} max={50} value={t.replicates} onChange={e => set("replicates", Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></Field>
            {txt("parameter", "Measured parameter")}
            {txt("unit", "Unit")}
            <Field label="Nominal / reference value" hint="Leave empty when recorded from a certificate at execution"><input type="number" step="any" value={t.nominal ?? ""} onChange={e => set("nominal", numOrNull(e.target.value))} /></Field>
            {txt("conditions", "Conditions")}
            {txt("objective", "Objective", true, true)}
            {txt("description", "Description", true)}
            {txt("method", "Method", true)}
            {txt("procedure", "Step-by-step procedure", true, true)}
            {txt("requiredMaterials", "Required materials")}
            {txt("requiredInstruments", "Required instruments")}
            {txt("requiredReferenceStandards", "Required reference standards")}
            <Field label="Dependency"><select value={t.dependency.type} onChange={e => up(x => { x.dependency.type = e.target.value as ProtocolTest["dependency"]["type"]; })}><option value="independent">Independent</option><option value="sequential">Sequential (after a test)</option><option value="conditional">Conditional (only if a test passes)</option></select></Field>
            {t.dependency.type !== "independent" && <Field label="Depends on (earlier test)"><select value={t.dependency.testKey ?? ""} onChange={e => up(x => { x.dependency.testKey = e.target.value || null; })}><option value="">—</option>{earlier.map(e => <option key={e.key} value={e.key}>{e.name}</option>)}</select></Field>}
            {txt("requiredEvidence", "Required evidence")}
            <label className="pm-check"><input type="checkbox" checked={t.attachmentsRequired} onChange={e => set("attachmentsRequired", e.target.checked)} /> Attachments required</label>
            <Field label="Test references" wide><div className="pm-row">{t.referenceIds.map(id => <span key={id} className="pm-badge pm-tone-info">{refCode(id)} <button type="button" className="pm-btn small ghost" onClick={() => set("referenceIds", t.referenceIds.filter(x => x !== id))}>×</button></span>)}<button type="button" className="pm-btn small" onClick={() => pick(id => up(x => { if (!x.referenceIds.includes(id)) x.referenceIds.push(id); }))}><Link2 size={12} /> Link</button>{txt("referenceClause", "Clause")}</div></Field>
            {txt("notes", "Notes", true, true)}
          </div>
          <SubList title="Levels (multi-level nominal values)" onAdd={() => up(x => { x.levels.push({ key: `L${x.levels.length + 1}`, label: `Level ${x.levels.length + 1}`, nominal: null, unit: x.unit, referenceNote: "" }); })}>
            {t.levels.map((l, li) => (
              <div key={li} className="pm-grid c4">
                <input className="pm-input" value={l.key} onChange={e => up(x => { x.levels[li].key = e.target.value.replace(/[^A-Za-z0-9_-]/g, ""); })} placeholder="Key" />
                <input className="pm-input" value={l.label} onChange={e => up(x => { x.levels[li].label = e.target.value; })} placeholder="Label" />
                <input className="pm-input" type="number" step="any" value={l.nominal ?? ""} onChange={e => up(x => { x.levels[li].nominal = numOrNull(e.target.value); })} placeholder="Nominal (optional)" />
                <div className="pm-row"><input className="pm-input" value={l.referenceNote} onChange={e => up(x => { x.levels[li].referenceNote = e.target.value; })} placeholder="Reference note" /><button type="button" className="pm-btn small danger" onClick={() => up(x => { x.levels.splice(li, 1); })}><Trash2 size={12} /></button></div>
              </div>
            ))}
          </SubList>
          <SubList title="Recorded fields" onAdd={() => up(x => { x.fields.push({ key: newKey("f"), label: "", type: "text", unit: "", required: true, options: [] }); })}>
            {t.fields.map((f, fi) => (
              <div key={fi} className="pm-grid c4">
                <input className="pm-input" value={f.key} onChange={e => up(x => { x.fields[fi].key = e.target.value.replace(/[^A-Za-z0-9_]/g, ""); })} placeholder="Key (formula variable)" />
                <input className="pm-input" value={f.label} onChange={e => up(x => { x.fields[fi].label = e.target.value; })} placeholder="Label" />
                <select className="pm-input" value={f.type} onChange={e => up(x => { x.fields[fi].type = e.target.value as typeof f.type; })}>{FIELD_TYPES.map(ft => <option key={ft}>{ft}</option>)}</select>
                <div className="pm-row"><input className="pm-input" style={{ width: 70 }} value={f.unit} onChange={e => up(x => { x.fields[fi].unit = e.target.value; })} placeholder="Unit" /><label className="pm-check"><input type="checkbox" checked={f.required} onChange={e => up(x => { x.fields[fi].required = e.target.checked; })} /> req.</label><button type="button" className="pm-btn small danger" onClick={() => up(x => { x.fields.splice(fi, 1); })}><Trash2 size={12} /></button></div>
                {(f.type === "single-select" || f.type === "multi-select") && <input className="pm-input pm-wide" style={{ gridColumn: "1 / -1" }} value={f.options.join(", ")} onChange={e => up(x => { x.fields[fi].options = e.target.value.split(",").map(v => v.trim()).filter(Boolean); })} placeholder="Options, comma separated" />}
              </div>
            ))}
          </SubList>
          <SubList title="Calculations (§9)" onAdd={() => up(x => { x.calculations.push({ key: newKey("calc"), label: "", kind: "mean", formula: "", scope: "test", unit: x.unit, decimals: null, significantFigures: null, formulaRevision: "1", justification: "" } as Calculation); })}>
            {t.calculations.map((cl, ci) => (
              <div key={ci} className="pm-card">
                <div className="pm-grid c4">
                  <input className="pm-input" value={cl.key} onChange={e => up(x => { x.calculations[ci].key = e.target.value.replace(/[^A-Za-z0-9_]/g, ""); })} placeholder="Key" />
                  <input className="pm-input" value={cl.label} onChange={e => up(x => { x.calculations[ci].label = e.target.value; })} placeholder="Label" />
                  <select className="pm-input" value={cl.kind} onChange={e => up(x => { x.calculations[ci].kind = e.target.value as Calculation["kind"]; })}>{CALC_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
                  <select className="pm-input" value={cl.scope} onChange={e => up(x => { x.calculations[ci].scope = e.target.value as Calculation["scope"]; })}><option value="test">Whole test</option><option value="per-level">Per level</option></select>
                  {cl.kind === "custom" && <input className="pm-input pm-mono" style={{ gridColumn: "1 / -1" }} value={cl.formula} onChange={e => up(x => { x.calculations[ci].formula = e.target.value; })} placeholder="Formula, e.g. (instrumentTemp - referenceTemp) — variables: field keys, earlier calculations, n, mean, sd, min, max, reference, readings" />}
                  <input className="pm-input" value={cl.unit} onChange={e => up(x => { x.calculations[ci].unit = e.target.value; })} placeholder="Unit" />
                  <input className="pm-input" type="number" min={0} max={10} value={cl.decimals ?? ""} onChange={e => up(x => { x.calculations[ci].decimals = numOrNull(e.target.value); })} placeholder="Decimals" />
                  <input className="pm-input" type="number" min={1} max={15} value={cl.significantFigures ?? ""} onChange={e => up(x => { x.calculations[ci].significantFigures = numOrNull(e.target.value); })} placeholder="Significant figures" />
                  <div className="pm-row"><input className="pm-input" value={cl.formulaRevision} onChange={e => up(x => { x.calculations[ci].formulaRevision = e.target.value; })} placeholder="Formula rev." /><button type="button" className="pm-btn small danger" onClick={() => up(x => { x.calculations.splice(ci, 1); })}><Trash2 size={12} /></button></div>
                </div>
              </div>
            ))}
          </SubList>
          <SubList title="Acceptance criteria (§10)" onAdd={() => up(x => { x.criteria.push({ key: newKey("c"), parameter: x.calculations[0]?.key ?? "reading", requirement: "", comparison: "record-only", lower: null, upper: null, target: null, tolerance: null, unit: x.unit, levelKey: null, sourceClass: "manufacturer", referenceId: null, referenceClause: "", justification: "", verificationStatus: "pending-technical-verification", verificationEvidence: "", conflictNote: "" } as Criterion); })}>
            {t.criteria.map((cr, ci) => <CriterionEditor key={ci} t={t} cr={cr} up={fn => up(x => fn(x.criteria[ci]))} remove={() => up(x => { x.criteria.splice(ci, 1); })} refCode={refCode} pick={pick} />)}
          </SubList>
          <SubList title="Graphs (drawn only from the readings entered in New Validation)" onAdd={() => up(x => { x.graphs.push({ type: x.levels.length ? "calibration-curve" : "repeatability", title: "", xLabel: "", yLabel: "" }); })}>
            {t.graphs.map((g, gi) => (
              <div key={gi} className="pm-grid c4">
                <select className="pm-input" value={g.type} onChange={e => up(x => { x.graphs[gi].type = e.target.value as GraphSpec["type"]; })}>{GRAPH_TYPES.map(gt => <option key={gt.id} value={gt.id}>{gt.label}</option>)}</select>
                <input className="pm-input" value={g.title} onChange={e => up(x => { x.graphs[gi].title = e.target.value; })} placeholder="Title (optional)" />
                <input className="pm-input" value={g.xLabel} onChange={e => up(x => { x.graphs[gi].xLabel = e.target.value; })} placeholder="X-axis label (optional)" />
                <div className="pm-row"><input className="pm-input" value={g.yLabel} onChange={e => up(x => { x.graphs[gi].yLabel = e.target.value; })} placeholder="Y-axis label (optional)" /><button type="button" className="pm-btn small danger" onClick={() => up(x => { x.graphs.splice(gi, 1); })}><Trash2 size={12} /></button></div>
                {GRAPH_TYPES.find(gt => gt.id === g.type)?.needs === "levels" && !t.levels.length && <div className="pm-muted" style={{ gridColumn: "1 / -1" }}>This graph needs reference levels (nominal values); without levels it is not drawn.</div>}
              </div>
            ))}
          </SubList>
        </>
      )}
    </div>
  );
}

function SubList({ title, onAdd, children }: { title: string; onAdd: () => void; children: ReactNode }) {
  return (
    <div className="pm-grid" style={{ gap: 6 }}>
      <div className="pm-card-head"><h3 style={{ margin: 0 }}>{title}</h3><button type="button" className="pm-btn small" onClick={onAdd}><Plus size={12} /> Add</button></div>
      {children}
    </div>
  );
}

function CriterionEditor({ t, cr, up, remove, refCode, pick }: { t: ProtocolTest; cr: Criterion; up: (fn: (c: Criterion) => void) => void; remove: () => void; refCode: (id: string | null) => string; pick: (fn: (id: string) => void) => void }) {
  const params = ["reading", ...t.calculations.map(c => c.key), ...t.fields.map(f => f.key)];
  const n = (k: "lower" | "upper" | "target" | "tolerance", label: string) => <Field label={label}><input type="number" step="any" value={cr[k] ?? ""} onChange={e => up(c => { c[k] = numOrNull(e.target.value); })} /></Field>;
  const needs = { lower: ["between", ">=", ">"], upper: ["between", "<=", "<"], target: ["target±tolerance"], tolerance: ["abs<=", "target±tolerance"] };
  return (
    <div className="pm-card is-criterion">
      <div className="pm-card-head"><strong>Criterion {cr.key}</strong><div className="pm-row"><PendingTag verified={cr.verificationStatus === "verified"} /><button type="button" className="pm-btn small danger" onClick={remove}><Trash2 size={12} /></button></div></div>
      <div className="pm-grid c4">
        <Field label="Parameter"><select value={cr.parameter} onChange={e => up(c => { c.parameter = e.target.value; })}>{Array.from(new Set([...params, cr.parameter])).map(p => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Comparison"><select value={cr.comparison} onChange={e => up(c => { c.comparison = e.target.value as Criterion["comparison"]; })}>{COMPARISONS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
        {needs.lower.includes(cr.comparison) && n("lower", "Lower limit")}
        {needs.upper.includes(cr.comparison) && n("upper", "Upper limit")}
        {needs.target.includes(cr.comparison) && n("target", "Target")}
        {needs.tolerance.includes(cr.comparison) && n("tolerance", "Tolerance")}
        <Field label="Unit"><input value={cr.unit} onChange={e => up(c => { c.unit = e.target.value; })} /></Field>
        {t.levels.length > 0 && <Field label="Level"><select value={cr.levelKey ?? ""} onChange={e => up(c => { c.levelKey = e.target.value || null; })}><option value="">All / test-level</option>{t.levels.map(l => <option key={l.key} value={l.key}>{l.label || l.key}</option>)}</select></Field>}
        <Field label="Source class *"><select value={cr.sourceClass} onChange={e => up(c => { c.sourceClass = e.target.value as Criterion["sourceClass"]; })}>{SOURCE_CLASSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <Field label="Reference"><RefButton value={cr.referenceId} refCode={refCode} onPick={() => pick(id => up(c => { c.referenceId = id; }))} onClear={() => up(c => { c.referenceId = null; })} /></Field>
        <Field label="Clause"><input value={cr.referenceClause} onChange={e => up(c => { c.referenceClause = e.target.value; })} /></Field>
        <Field label="Verification"><select value={cr.verificationStatus} onChange={e => up(c => { c.verificationStatus = e.target.value as Criterion["verificationStatus"]; })}><option value="pending-technical-verification">{PENDING_LABEL}</option><option value="verified">Verified</option></select></Field>
        <Field label="Requirement text" wide><textarea value={cr.requirement} onChange={e => up(c => { c.requirement = e.target.value; })} /></Field>
        <Field label="Technical justification (required without a reference / for institutional criteria)" wide><textarea value={cr.justification} onChange={e => up(c => { c.justification = e.target.value; })} /></Field>
        {cr.verificationStatus === "verified" && <Field label="Verification evidence *" wide><textarea value={cr.verificationEvidence} onChange={e => up(c => { c.verificationEvidence = e.target.value; })} /></Field>}
        <Field label="Conflict note" wide><input value={cr.conflictNote} onChange={e => up(c => { c.conflictNote = e.target.value; })} placeholder="Describe any conflict with another source" /></Field>
      </div>
    </div>
  );
}

/* ------------------------------ reference search dialog (§11) ------------------------------ */

export function ReferencePicker({ refs, onPick, onClose }: { refs: ReferenceRowDto[]; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = refs.filter(r => [r.code, r.title, r.issuer, r.documentNumber, r.edition].some(v => v.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="pm-dialog-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="pm-dialog" onClick={e => e.stopPropagation()}>
        <div className="pm-card-head"><h2 style={{ margin: 0, fontSize: 16 }}>Select a reference</h2><button type="button" className="pm-btn small" onClick={onClose}>Close</button></div>
        <input className="pm-input" autoFocus placeholder="Search code, title, issuer, document number…" value={q} onChange={e => setQ(e.target.value)} />
        {!list.length ? <div className="pm-empty">No references found. Add them in the Reference Library.</div> : (
          <ul className="pm-list">
            {list.map(r => (
              <li key={r.id}>
                <button type="button" className="linkish" onClick={() => onPick(r.id)}>
                  <strong>{r.code}</strong> — {r.title}
                  <div className="pm-muted">{r.issuer} {r.documentNumber} {r.edition && `· ed. ${r.edition}`} {r.revision && `· rev ${r.revision}`}</div>
                </button>
                <span className={`pm-badge ${r.verificationStatus === "verified" ? "pm-tone-ok" : "pm-tone-warn"}`}>{r.expired ? "expired" : r.verificationStatus}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
