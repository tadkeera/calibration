/**
 * Protocol execution (§16). Only RELEASED revisions compatible with the
 * selected registered equipment can be executed. The measurement form is
 * generated from the revision content; empty inputs are recorded as missing
 * (never zero). The preview uses the same shared engine as the backend, but
 * the stored result is always recalculated server-side against the released
 * snapshot. A calculated PASS is not an approval.
 */
import { useEffect, useMemo, useState } from "react";
import { FlaskConical, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CALCULATED_PASS_DISCLAIMER, evaluateExecution, type ExecutionEvaluation, type Measurements, type TestMeasurement } from "@shared/protocols/evaluate";
import type { ProtocolTest } from "@shared/protocols/model";
import { ErrorBox, Field, Loading, Panel, PendingTag, ResultBadge, errorText, fmtDate, type Nav, type PmUser } from "./common";

const NUMERIC_TYPES = ["numeric", "series", "reference-comparison"];
const expected = (t: ProtocolTest) => Math.max(1, t.readingsRequired || 0);
const parseNum = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function ExecutionCenter({ user, duties, initialRevisionId, setNav }: { user: PmUser; duties: readonly string[]; initialRevisionId?: string; setNav: (n: Nav) => void }) {
  const equipment = trpc.protocols.equipment.useQuery();
  const initial = trpc.protocols.revision.useQuery({ revisionId: initialRevisionId ?? "" }, { enabled: !!initialRevisionId });
  const [instrumentKey, setInstrumentKey] = useState("");
  const [revisionId, setRevisionId] = useState(initialRevisionId ?? "");
  const canExecute = duties.includes("executor");

  // Pre-select linked equipment when opened from a released protocol.
  useEffect(() => {
    if (instrumentKey || !initial.data || !equipment.data) return;
    const id = initial.data.revision.content.identification;
    const linked = initial.data.revision.content.equipmentLinks[0]?.instrumentKey;
    const match = linked ?? equipment.data.find(e => e.model.toLowerCase() === id.model.toLowerCase())?.instrumentKey;
    if (match) setInstrumentKey(match);
  }, [initial.data, equipment.data, instrumentKey]);

  const options = trpc.protocols.releasedForEquipment.useQuery({ instrumentKey }, { enabled: !!instrumentKey });
  const history = trpc.protocols.executions.useQuery({ instrumentKey: instrumentKey || undefined });

  return (
    <div className="pm-grid">
      {!canExecute && <div className="pm-alert pm-alert-info">You can view execution history. Recording an execution requires the Executor duty (role {user.role}).</div>}
      <Panel title={<><FlaskConical size={16} /> Execute a released protocol</>}>
        <div className="pm-grid c2">
          <Field label="Equipment (Equipment Library)">
            <select value={instrumentKey} onChange={e => { setInstrumentKey(e.target.value); setRevisionId(""); }}>
              <option value="">Select equipment…</option>
              {(equipment.data ?? []).map(e => <option key={e.instrumentKey} value={e.instrumentKey}>{e.name} · {e.instrumentId} · {e.manufacturer} {e.model} · S/N {e.serialNumber}</option>)}
            </select>
          </Field>
          <Field label="Released protocol revision">
            <select value={revisionId} disabled={!instrumentKey || options.isLoading} onChange={e => setRevisionId(e.target.value)}>
              <option value="">{options.data && !options.data.released.length ? "No released protocol for this equipment" : "Select…"}</option>
              {(options.data?.released ?? []).map(o => <option key={o.revisionId} value={o.revisionId} disabled={!o.compatible}>{o.protocolNumber} rev {o.revisionNumber} — {o.title}{o.compatible ? "" : " (incompatible)"}</option>)}
            </select>
          </Field>
        </div>
        {options.error && <ErrorBox error={options.error} />}
        {options.data?.released.filter(o => !o.compatible).map(o => <div key={o.revisionId} className="pm-alert pm-alert-warn">{o.protocolNumber} rev {o.revisionNumber} is not compatible: {o.compatibilityProblems.join("; ")}</div>)}
        {!!options.data?.notExecutable.length && (
          <div className="pm-alert pm-alert-info">Not executable (not released): {options.data.notExecutable.map(d => `${d.protocolNumber} (${d.status})`).join(", ")}. Draft or unreleased protocols cannot be used for execution.</div>
        )}
        {initialRevisionId && initial.data && initial.data.revision.status !== "released" && <div className="pm-alert pm-alert-bad">Revision {initial.data.revision.revisionNumber} is {initial.data.revision.statusLabel} — only RELEASED revisions can be executed.</div>}
      </Panel>
      {revisionId && instrumentKey && options.data?.released.some(o => o.revisionId === revisionId && o.compatible) && (
        <ExecutionForm key={`${revisionId}:${instrumentKey}`} revisionId={revisionId} instrumentKey={instrumentKey} canExecute={canExecute} setNav={setNav} />
      )}
      <ExecutionHistory rows={history.data ?? []} loading={history.isLoading} error={history.error} />
    </div>
  );
}

function ExecutionForm({ revisionId, instrumentKey, canExecute, setNav }: { revisionId: string; instrumentKey: string; canExecute: boolean; setNav: (n: Nav) => void }) {
  const utils = trpc.useUtils();
  const rev = trpc.protocols.revision.useQuery({ revisionId });
  const execute = trpc.protocols.execute.useMutation();
  const [m, setM] = useState<Measurements>({});
  const [stage, setStage] = useState("");
  const [comments, setComments] = useState("");
  const [result, setResult] = useState<{ executionId: string; evaluation: ExecutionEvaluation } | null>(null);
  const content = rev.data?.revision.content;
  const preview = useMemo(() => (content ? evaluateExecution(content, m) : null), [content, m]);

  if (rev.isLoading) return <Loading />;
  if (rev.error || !rev.data || !content) return <ErrorBox error={rev.error} />;
  const r = rev.data;
  const setTest = (key: string, fn: (t: TestMeasurement) => TestMeasurement) => setM(prev => ({ ...prev, [key]: fn(prev[key] ?? {}) }));

  const submit = async () => {
    if (!window.confirm("Record this execution? Measurements are stored with the released protocol snapshot and cannot be edited afterwards.")) return;
    try {
      const res = await execute.mutateAsync({ revisionId, instrumentKey, measurements: m, stage: stage || undefined, comments: comments || undefined });
      setResult(res);
      await Promise.all([utils.protocols.executions.invalidate(), utils.protocols.detail.invalidate()]);
      toast.success(`Execution recorded — calculated result: ${res.evaluation.overall}`);
    } catch (e) {
      toast.error(`Not recorded — your entries are preserved. ${errorText(e)}`);
    }
  };

  if (result) {
    return (
      <Panel title={<>Execution recorded <ResultBadge result={result.evaluation.overall} /></>} actions={<><button type="button" className="pm-btn" onClick={() => setNav({ view: "detail", protocolId: r.protocol.id, tab: "executions" })}>Open protocol executions</button><button type="button" className="pm-btn" onClick={() => { setResult(null); setM({}); }}>New execution</button></>}>
        <EvaluationView evaluation={result.evaluation} />
      </Panel>
    );
  }

  return (
    <div className="pm-split">
      <div className="pm-grid">
        <Panel title={<>{r.protocol.protocolNumber} rev {r.revision.revisionNumber} — measurement entry</>}>
          <div className="pm-grid c2">
            <Field label="Stage"><select value={stage} onChange={e => setStage(e.target.value)}><option value="">All applicable</option>{content.stages.map(s => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Execution comments"><input value={comments} onChange={e => setComments(e.target.value)} /></Field>
          </div>
          <p className="pm-muted">Leave a value empty if it was not measured — empty values are recorded as missing, never as zero.</p>
        </Panel>
        {content.sections.filter(s => s.tests.length && (!stage || !s.stage || s.stage === stage)).map(s => (
          <Panel key={s.key} title={s.title}>
            <div className="pm-grid">
              {s.tests.filter(t => !stage || !t.stage || t.stage === stage).map(t => <TestInput key={t.key} test={t} value={m[t.key] ?? {}} onChange={fn => setTest(t.key, fn)} preview={preview?.tests.find(x => x.testKey === t.key)?.status} />)}
            </div>
          </Panel>
        ))}
      </div>
      <div className="pm-grid" style={{ position: "sticky", top: 80 }}>
        <Panel title={<>Preview {preview && <ResultBadge result={preview.overall} />}</>}>
          <p className="pm-muted" style={{ marginTop: 0 }}>Preview only. The stored result is recalculated on the server.</p>
          {preview && <ul className="pm-list">{(Object.entries(preview.counts) as Array<[string, number]>).map(([k, v]) => <li key={k}><ResultBadge result={k} /> <strong>{v}</strong></li>)}</ul>}
          <div className="pm-alert pm-alert-info">{CALCULATED_PASS_DISCLAIMER}</div>
          <button type="button" className="pm-btn primary" disabled={!canExecute || execute.isPending} onClick={submit}><PlayCircle size={14} /> {execute.isPending ? "Recording…" : "Record execution"}</button>
        </Panel>
      </div>
    </div>
  );
}

function ReadingInputs({ count, values, onChange }: { count: number; values: Array<number | null>; onChange: (v: Array<number | null>) => void }) {
  return (
    <div className="pm-row">
      {Array.from({ length: count }, (_, i) => (
        <input key={i} className="pm-input" style={{ width: 96 }} type="number" step="any" aria-label={`Reading ${i + 1}`} placeholder={`#${i + 1}`} value={values[i] ?? ""} onChange={e => { const next = Array.from({ length: count }, (_, k) => values[k] ?? null); next[i] = parseNum(e.target.value); onChange(next); }} />
      ))}
    </div>
  );
}

function TestInput({ test: t, value: v, onChange, preview }: { test: ProtocolTest; value: TestMeasurement; onChange: (fn: (t: TestMeasurement) => TestMeasurement) => void; preview?: string }) {
  const n = expected(t);
  const pending = t.criteria.filter(c => c.verificationStatus !== "verified").length;
  return (
    <div className="pm-card is-test">
      <div className="pm-card-head">
        <strong>{t.name} {!t.required && <span className="pm-muted">(optional)</span>}</strong>
        <div className="pm-row">{pending > 0 && <PendingTag verified={false} />}{preview && <ResultBadge result={preview} />}</div>
      </div>
      {t.procedure && <details><summary className="pm-muted">Procedure</summary><div className="pm-pre">{t.procedure}</div></details>}
      {t.dependency.type !== "independent" && t.dependency.testKey && <div className="pm-muted">{t.dependency.type === "conditional" ? "Only if" : "After"} test {t.dependency.testKey}{t.dependency.type === "conditional" ? " passes" : ""}.</div>}
      <label className="pm-check"><input type="checkbox" checked={!!v.notApplicable} onChange={e => onChange(x => ({ ...x, notApplicable: e.target.checked }))} /> Not applicable</label>
      {v.notApplicable ? (
        <Field label="Justification for N/A *"><input value={v.naJustification ?? ""} onChange={e => onChange(x => ({ ...x, naJustification: e.target.value }))} /></Field>
      ) : (
        <>
          {NUMERIC_TYPES.includes(t.dataType) && (
            <Field label={`Readings (${n})${t.unit ? ` — ${t.unit}` : ""}`}><ReadingInputs count={n} values={v.readings ?? []} onChange={readings => onChange(x => ({ ...x, readings }))} /></Field>
          )}
          {NUMERIC_TYPES.includes(t.dataType) && t.nominal === null && (
            <Field label={`Reference value${t.dataType === "reference-comparison" ? " *" : ""}`} hint="Certified/reference value exactly as stated on the certificate"><input type="number" step="any" value={v.reference ?? ""} onChange={e => onChange(x => ({ ...x, reference: parseNum(e.target.value) }))} /></Field>
          )}
          {t.dataType === "multi-level" && t.levels.map(l => (
            <div key={l.key} className="pm-grid c2">
              <Field label={`${l.label || l.key}: readings (${n})`}><ReadingInputs count={n} values={v.levels?.[l.key] ?? []} onChange={vals => onChange(x => ({ ...x, levels: { ...(x.levels ?? {}), [l.key]: vals } }))} /></Field>
              {l.nominal === null ? (
                <Field label={`${l.label || l.key}: reference value *`} hint={l.referenceNote || "From the reference standard certificate"}><input type="number" step="any" value={v.levelReferences?.[l.key] ?? ""} onChange={e => onChange(x => ({ ...x, levelReferences: { ...(x.levelReferences ?? {}), [l.key]: parseNum(e.target.value) } }))} /></Field>
              ) : <div className="pm-muted">Nominal {l.nominal} {l.unit}</div>}
            </div>
          ))}
          {t.fields.length > 0 && (
            <div className="pm-grid c2">
              {t.fields.map(f => {
                const cur = v.fields?.[f.key];
                const setF = (val: string | number | boolean | string[] | null) => onChange(x => ({ ...x, fields: { ...(x.fields ?? {}), [f.key]: val } }));
                const label = `${f.label || f.key}${f.unit ? ` (${f.unit})` : ""}${f.required ? " *" : ""}`;
                if (f.type === "boolean")
                  return <Field key={f.key} label={label}><select value={typeof cur === "boolean" ? String(cur) : ""} onChange={e => setF(e.target.value === "" ? null : e.target.value === "true")}><option value="">— not answered —</option><option value="true">Yes / confirmed</option><option value="false">No / not confirmed</option></select></Field>;
                if (f.type === "number") return <Field key={f.key} label={label}><input type="number" step="any" value={typeof cur === "number" ? cur : ""} onChange={e => setF(parseNum(e.target.value))} /></Field>;
                if (f.type === "single-select") return <Field key={f.key} label={label}><select value={typeof cur === "string" ? cur : ""} onChange={e => setF(e.target.value || null)}><option value="">—</option>{f.options.map(o => <option key={o}>{o}</option>)}</select></Field>;
                if (f.type === "multi-select") return <Field key={f.key} label={label}><select multiple value={Array.isArray(cur) ? cur : []} onChange={e => setF(Array.from(e.target.selectedOptions).map(o => o.value))}>{f.options.map(o => <option key={o}>{o}</option>)}</select></Field>;
                const inputType = f.type === "date" ? "date" : f.type === "time" ? "time" : "text";
                const hint = ["attachment", "image", "certificate"].includes(f.type) ? "Record the document / certificate number or controlled file reference" : undefined;
                return <Field key={f.key} label={label} hint={hint}><input type={inputType} value={typeof cur === "string" ? cur : ""} onChange={e => setF(e.target.value || null)} /></Field>;
              })}
            </div>
          )}
          <Field label="Comment / observation"><input value={v.comment ?? ""} onChange={e => onChange(x => ({ ...x, comment: e.target.value }))} /></Field>
        </>
      )}
    </div>
  );
}

export function EvaluationView({ evaluation }: { evaluation: ExecutionEvaluation }) {
  return (
    <div className="pm-grid">
      <div className="pm-alert pm-alert-info">{evaluation.disclaimer}</div>
      <div className="pm-muted">Engine {evaluation.engineVersion} · calculated {fmtDate(evaluation.calculatedAt, true)}</div>
      {evaluation.tests.map(t => (
        <div key={t.testKey} className="pm-card">
          <div className="pm-card-head"><strong>{t.name}</strong><ResultBadge result={t.status} /></div>
          {t.notes.length > 0 && <ul className="pm-muted">{t.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {t.calculations.length > 0 && (
            <table className="pm-table"><thead><tr><th>Calculation</th><th>Level</th><th>Value</th><th>Formula (rev)</th></tr></thead><tbody>
              {t.calculations.map((c, i) => <tr key={i}><td>{c.label}</td><td>{c.levelKey ?? "—"}</td><td>{c.error ? <span className="pm-diff-removed">{c.error}</span> : `${c.value} ${c.unit}`}</td><td className="pm-mono">{c.formula} ({c.formulaRevision || "—"})</td></tr>)}
            </tbody></table>
          )}
          {t.criteria.length > 0 && (
            <table className="pm-table"><thead><tr><th>Criterion</th><th>Value</th><th>Limit</th><th>Result</th><th>Message</th></tr></thead><tbody>
              {t.criteria.map((c, i) => <tr key={i}><td>{c.parameter}{c.levelKey ? ` [${c.levelKey}]` : ""}<div className="pm-muted">{c.sourceClass}</div></td><td>{c.value === null ? "—" : String(c.value)}</td><td>{c.limit}</td><td><ResultBadge result={c.status} /></td><td>{c.message}</td></tr>)}
            </tbody></table>
          )}
        </div>
      ))}
    </div>
  );
}

function ExecutionHistory({ rows, loading, error }: { rows: Array<{ id: string; protocolNumber?: string; revisionNumber: number; equipmentId: string | null; overallResult: string; executedByName: string | null; executedAt: string; engineVersion: string }>; loading: boolean; error: unknown }) {
  const [open, setOpen] = useState<string | null>(null);
  const detail = trpc.protocols.execution.useQuery({ executionId: open ?? "" }, { enabled: !!open });
  return (
    <Panel title="Execution history">
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !rows.length ? <div className="pm-empty">No executions recorded.</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>Executed</th><th>Protocol</th><th>Equipment</th><th>Calculated result</th><th>By</th><th>Engine</th></tr></thead>
            <tbody>{rows.map(e => <tr key={e.id} className="is-click" onClick={() => setOpen(open === e.id ? null : e.id)}><td>{fmtDate(e.executedAt, true)}</td><td>{e.protocolNumber} rev {e.revisionNumber}</td><td>{e.equipmentId ?? "—"}</td><td><ResultBadge result={e.overallResult} /></td><td>{e.executedByName ?? "—"}</td><td>{e.engineVersion}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {open && (detail.isLoading ? <Loading /> : detail.data ? <div style={{ marginTop: 12 }}><div className="pm-muted">Content hash {detail.data.contentHash.slice(0, 16)}… · S/N {detail.data.serialNumber ?? "—"}{detail.data.comments ? ` · ${detail.data.comments}` : ""}</div><EvaluationView evaluation={detail.data.evaluation} /></div> : <ErrorBox error={detail.error} />)}
    </Panel>
  );
}
