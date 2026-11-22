/**
 * New Validation — driven ONLY by the active approved protocol revision of the
 * selected equipment (no hard-coded tests, fields or limits).
 *
 *   select equipment → backend returns the active approved revision → the form
 *   is generated from its tests → "Calibration" runs the shared calculation
 *   engine on the server → numerical results, PASS/FAIL per test and overall,
 *   graphs from the entered data → Save stores an immutable record tied to the
 *   protocol revision → PDF (Section A tables, Section B graphs).
 */
import { useEffect, useMemo, useState } from "react";
import { Calculator, FileDown, History, Save } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ExecutionEvaluation, Measurements, TestMeasurement } from "@shared/protocols/evaluate";
import { NO_APPROVED_PROTOCOL } from "@shared/protocols/protocolCards";
import { ErrorBox, Field, Loading, Panel, ResultBadge, errorText, fmtDate, type PmUser } from "./common";
import { EvaluationView, TestInput } from "./ExecutionCenter";
import { ValidationGraph } from "./ValidationGraph";
import { buildValidationPdf } from "./validationPdf";
import "./protocols.css";

const ORGANIZATION = "National Drug Quality Control Laboratory — Supreme Board of Drugs";
type Lang = "ar" | "en";

export function ProtocolValidation({ user, language, initialInstrumentKey }: { user: PmUser; language: Lang; initialInstrumentKey?: string }) {
  const board = trpc.protocols.board.useQuery(undefined, { refetchOnWindowFocus: false });
  const [instrumentKey, setInstrumentKey] = useState<string | null>(null);
  // Pre-select the instrument chosen on the dashboard (only when it is a registered card).
  useEffect(() => {
    if (instrumentKey || !initialInstrumentKey || !board.data) return;
    if (board.data.cards.some(c => c.equipment?.instrumentKey === initialInstrumentKey)) setInstrumentKey(initialInstrumentKey);
  }, [board.data, initialInstrumentKey, instrumentKey]);
  const ar = language === "ar";
  const cards = (board.data?.cards ?? []).filter(c => c.equipment);
  return (
    <div className="pm-root" dir="ltr">
      <Panel title={<>New Validation <span className="pm-muted" style={{ fontWeight: 400 }}>— {ar ? "التحقق وفق البروتوكول المعتمد فقط" : "driven by the approved protocol only"}</span></>}>
        {board.isLoading ? <Loading /> : board.error ? <ErrorBox error={board.error} /> : (
          <div className="pm-equipment-grid" role="listbox" aria-label="Equipment">
            {cards.map(c => (
              <button key={c.cardKey} type="button" role="option" aria-selected={instrumentKey === c.equipment!.instrumentKey} className={`pm-equipment-card ${instrumentKey === c.equipment!.instrumentKey ? "is-active" : ""}`} onClick={() => setInstrumentKey(c.equipment!.instrumentKey)}>
                <strong>{c.title}</strong>
                <span className="pm-muted">{c.equipment!.identity.instrumentId} · {c.equipment!.identity.model}</span>
                {c.protocol?.activeRevision ? <span className="pm-badge pm-tone-ok">{c.protocol.number} Rev.{String(c.protocol.activeRevision.revisionNumber).padStart(2, "0")} — Approved</span> : <span className="pm-badge pm-tone-neutral">No approved protocol</span>}
              </button>
            ))}
          </div>
        )}
      </Panel>
      {instrumentKey && <ActiveValidation key={instrumentKey} instrumentKey={instrumentKey} user={user} canExecute={!!board.data?.permissions.canExecute} ar={ar} />}
    </div>
  );
}

function ActiveValidation({ instrumentKey, user, canExecute, ar }: { instrumentKey: string; user: PmUser; canExecute: boolean; ar: boolean }) {
  const utils = trpc.useUtils();
  const active = trpc.protocols.activeForEquipment.useQuery({ instrumentKey }, { refetchOnWindowFocus: false });
  const calc = trpc.protocols.calculateValidation.useMutation();
  const record = trpc.protocols.recordValidation.useMutation();
  const [measurements, setMeasurements] = useState<Measurements>({});
  const [evaluation, setEvaluation] = useState<ExecutionEvaluation | null>(null);
  const [comments, setComments] = useState("");
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const data = active.data;
  const revisionId = data?.available ? data.revision.id : null;
  useEffect(() => {
    setMeasurements({});
    setEvaluation(null);
    setSavedRunId(null);
  }, [revisionId]);
  const tests = useMemo(() => (data?.available ? data.content.sections.flatMap(s => s.tests) : []), [data]);

  if (active.isLoading) return <Loading label="Loading the active approved protocol…" />;
  if (active.error) return <ErrorBox error={active.error} />;
  if (!data) return null;
  if (!data.available)
    return (
      <div className="pm-alert pm-alert-warn" role="alert" style={{ fontSize: 15 }}>
        <div>
          <strong>{NO_APPROVED_PROTOCOL}</strong>
          <div>لا يوجد بروتوكول معتمد لهذا الجهاز. يجب إنشاء البروتوكول واعتماده من مدير الجودة في صفحة «البروتوكول» قبل إجراء التحقق.</div>
        </div>
      </div>
    );

  const setTest = (key: string) => (fn: (t: TestMeasurement) => TestMeasurement) => {
    setMeasurements(prev => ({ ...prev, [key]: fn(prev[key] ?? {}) }));
    setEvaluation(null);
    setSavedRunId(null);
  };
  const runCalibration = async () => {
    try {
      const res = await calc.mutateAsync({ instrumentKey, revisionId: data.revision.id, measurements });
      setEvaluation(res);
      setTimeout(() => document.getElementById("pv-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) {
      toast.error(errorText(e));
      if (/changed/.test(errorText(e))) void active.refetch();
    }
  };
  const save = async () => {
    try {
      const res = await record.mutateAsync({ instrumentKey, revisionId: data.revision.id, measurements, comments: comments.trim() || undefined });
      setSavedRunId(res.runId);
      setEvaluation(res.evaluation);
      toast.success(`Validation ${res.runNumber} saved (${res.evaluation.overall}) — tied to ${data.protocol.number} Rev.${String(data.revision.revisionNumber).padStart(2, "0")}`);
      await utils.protocols.validations.invalidate();
    } catch (e) {
      toast.error(`Not saved: ${errorText(e)}`);
    }
  };
  const incomplete = evaluation?.tests.some(t => t.status === "INCOMPLETE") ?? true;
  const graphs = evaluation?.tests.flatMap(t => t.graphs ?? []) ?? [];

  return (
    <>
      <Panel title={<>{data.protocol.number} — {data.protocol.title}</>} actions={<span className="pm-badge pm-tone-ok">Rev.{String(data.revision.revisionNumber).padStart(2, "0")} — Approved (active)</span>}>
        <div className="pm-muted">
          Approved by {data.revision.approvedBy ?? "—"} on {fmtDate(data.revision.approvedAt, true)} · {data.equipment?.identity.instrumentId} · {data.equipment?.identity.manufacturer} {data.equipment?.identity.model} · S/N {data.equipment?.identity.serialNumber}
        </div>
        {!tests.length && <div className="pm-empty">The approved revision contains no tests.</div>}
        <div className="pm-grid">
          {tests.map(t => (
            <TestInput key={t.key} test={t} value={measurements[t.key] ?? {}} onChange={setTest(t.key)} preview={evaluation?.tests.find(r => r.testKey === t.key)?.status} />
          ))}
        </div>
        <Field label="Comments (optional)" wide><textarea rows={2} value={comments} onChange={e => setComments(e.target.value)} /></Field>
        <div className="pm-row">
          <button type="button" className="pm-btn primary" disabled={calc.isPending || !tests.length} onClick={runCalibration}><Calculator size={15} /> {calc.isPending ? "Calculating…" : "Calibration"}</button>
          {canExecute && (
            <button type="button" className="pm-btn" disabled={!evaluation || incomplete || record.isPending || !!savedRunId} title={!evaluation ? "Press Calibration first" : incomplete ? "Complete all required readings" : ""} onClick={save}><Save size={15} /> {record.isPending ? "Saving…" : savedRunId ? "Saved" : "Save validation"}</button>
          )}
          {savedRunId && <PdfButton runId={savedRunId} user={user} />}
          {!canExecute && <span className="pm-muted">Your account can calculate but not save validations.</span>}
        </div>
      </Panel>
      {evaluation && (
        <div id="pv-results" className="pm-grid">
          <div className={`pm-alert ${evaluation.overall === "PASS" ? "pm-alert-ok" : evaluation.overall === "FAIL" ? "pm-alert-danger" : "pm-alert-warn"}`} style={{ fontSize: 16 }}>
            <div><strong>Overall result: {evaluation.overall}</strong> {ar && <span>— النتيجة الإجمالية</span>}</div>
          </div>
          <Panel title="Numerical results">
            <EvaluationView evaluation={evaluation} />
          </Panel>
          <Panel title={`Graphs (${graphs.length})`}>
            {graphs.length ? <div className="pm-grid c2 pm-graph-grid">{graphs.map(g => <ValidationGraph key={g.key} graph={g} />)}</div> : <div className="pm-empty">No graph is configured for these tests, or the entered data are not sufficient to draw one. Graphs are drawn only from real readings.</div>}
          </Panel>
        </div>
      )}
      <ValidationHistory instrumentKey={instrumentKey} user={user} />
    </>
  );
}

function PdfButton({ runId, user }: { runId: string; user: PmUser }) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="pm-btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const v = await utils.protocols.validation.fetch({ runId });
        const { doc } = buildValidationPdf({ organization: ORGANIZATION, runNumber: v.runNumber, protocolNumber: v.protocolNumber, protocolTitle: v.protocolTitle, revisionNumber: v.revisionNumber, revisionApprovedBy: v.revisionApprovedBy, revisionApprovedAt: v.revisionApprovedAt, contentHash: v.contentHash, content: v.content, equipment: v.equipment, measurements: v.measurements, evaluation: v.evaluation, referenceSnapshot: v.referenceSnapshot, recordedBy: v.recordedBy, recordedAt: v.recordedAt, generatedBy: user.name ?? `user ${user.id}`, generatedAt: new Date() });
        doc.save(`${v.runNumber}.pdf`);
      } catch (e) {
        toast.error(`PDF could not be generated: ${errorText(e)}`);
      } finally {
        setBusy(false);
      }
    }}><FileDown size={15} /> PDF</button>
  );
}

function ValidationHistory({ instrumentKey, user }: { instrumentKey: string; user: PmUser }) {
  const list = trpc.protocols.validations.useQuery({ instrumentKey });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title={<><History size={15} /> Validation history (protocol-driven)</>}>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.length ? <div className="pm-empty">No protocol-driven validations recorded for this equipment yet. Earlier validations remain available in “السجلات والتدقيق”.</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>Recorded</th><th>Record</th><th>Protocol / revision</th><th>Result</th><th>By</th><th /></tr></thead>
            <tbody>
              {list.data.map(v => (
                <tr key={v.id}>
                  <td>{fmtDate(v.recordedAt, true)}</td>
                  <td className="pm-mono">{v.runNumber}</td>
                  <td>{v.protocolNumber} Rev.{String(v.revisionNumber).padStart(2, "0")}</td>
                  <td><ResultBadge result={v.overall ?? "—"} /></td>
                  <td>{v.recordedBy ?? "—"}</td>
                  <td><div className="pm-row"><button type="button" className="pm-btn small" onClick={() => setOpen(open === v.id ? null : v.id)}>{open === v.id ? "Hide" : "View"}</button><PdfButton runId={v.id} user={user} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <StoredValidation runId={open} />}
    </Panel>
  );
}

function StoredValidation({ runId }: { runId: string }) {
  const v = trpc.protocols.validation.useQuery({ runId });
  if (v.isLoading) return <Loading />;
  if (v.error || !v.data) return <ErrorBox error={v.error} />;
  const d = v.data;
  const graphs = d.evaluation.tests.flatMap(t => t.graphs ?? []);
  return (
    <div className="pm-grid">
      <div className="pm-alert pm-alert-info"><div>Stored record {d.runNumber} — {d.protocolNumber} Rev.{String(d.revisionNumber).padStart(2, "0")} (revision status now: {d.revisionStatusNow ?? "—"}). Results are shown exactly as recorded; later revisions never change them.</div></div>
      <EvaluationView evaluation={d.evaluation} />
      {graphs.length > 0 && <div className="pm-grid c2 pm-graph-grid">{graphs.map(g => <ValidationGraph key={g.key} graph={g} />)}</div>}
    </div>
  );
}
