/**
 * Unified, controlled nine-step calibration-run workflow. ONE workflow and the
 * same nine labelled steps for every instrument:
 *
 *   Equipment Selection → Protocol → Accuracy → Repeatability → Linearity →
 *   Results → Review → Approval → PDF
 *
 * The protocol still determines the actual test inventory. Device-specific
 * tests are mapped into the three common test steps by their controlled name;
 * every remaining test is recorded unchanged in Results as a labelled sub-test.
 * No test, criterion or acceptance limit is omitted or altered.
 *
 *  - equipment data are frozen in a snapshot when the run is created
 *    (newer equipment data are announced, never applied silently);
 *  - every save is versioned; a concurrent save raises DRAFT_CONFLICT and the
 *    user compares / merges per test (both versions are always kept);
 *  - an inapplicable Accuracy / Repeatability / Linearity step must carry a
 *    written justification and a recorded confirmation — never silently skipped;
 *  - recording hands the data to the existing execution review / approval
 *    workflow (segregation of duties, password re-authentication);
 *  - the PDF is generated from the snapshot with a watermark until approved.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, FileDown, GitMerge, PlayCircle, Save, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { evaluateExecution, type Measurements, type TestMeasurement } from "@shared/protocols/evaluate";
import { diffEquipment, IDENTITY_FIELDS, NOT_AVAILABLE, SPEC_GROUPS, specDefinitions, type EquipmentSnapshot } from "@shared/protocols/equipment";
import {
  CANONICAL_STEP_KEYS,
  CANONICAL_STEP_LABELS,
  NA_CONFIRMATION_FIELD,
  isStepNotApplicable,
  mapTestsToSteps,
  measurementConflicts,
  mergeMeasurements,
  naMeasurementKey,
  type CanonicalStepKey,
  type NaStepKey,
  type RunStep,
} from "@shared/protocols/runWorkflow";
import type { ExecutionDeviation } from "@shared/protocols/executionReview";
import { ErrorBox, Field, Loading, Panel, PendingTag, ResultBadge, askReason, errorText, fmtDate, type Nav, type PmUser, type ProtocolOutputs } from "./common";
import { EvaluationView, TestInput } from "./ExecutionCenter";
import { DeviationsEditor, ExecutionDetailView, ReviewStatusBadge } from "./ExecutionReview";
import { buildRunPdf } from "./runPdf";

const ORGANIZATION = "National Drug Quality Control Laboratory — Supreme Board of Drugs";

export function RunWorkflow({ user, duties, initialRunId, setNav }: { user: PmUser; duties: readonly string[]; initialRunId?: string; setNav: (n: Nav) => void }) {
  const [runId, setRunId] = useState<string | undefined>(initialRunId);
  useEffect(() => setRunId(initialRunId), [initialRunId]);
  if (runId) return <RunView key={runId} runId={runId} user={user} duties={duties} onClose={() => { setRunId(undefined); setNav({ view: "runs" }); }} />;
  return <RunLauncher canExecute={duties.includes("executor")} onOpen={id => setRunId(id)} />;
}

/* --------------------------- launcher + run list --------------------------- */

function RunLauncher({ canExecute, onOpen }: { canExecute: boolean; onOpen: (runId: string) => void }) {
  const utils = trpc.useUtils();
  const catalog = trpc.protocols.runCatalog.useQuery();
  const runs = trpc.protocols.runs.useQuery();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const create = trpc.protocols.createRun.useMutation({
    onSuccess: r => {
      toast.success(`Run ${r.runNumber} created — equipment data snapshot captured`);
      utils.protocols.runs.invalidate();
      onOpen(r.runId);
    },
    onError: e => toast.error(errorText(e)),
  });
  return (
    <div className="pm-grid">
      <Panel title="Start a calibration run">
        <div className="pm-alert pm-alert-info">
          <AlertTriangle size={16} />
          <div>All eight devices use the same nine controlled steps (Equipment Selection, Protocol, Accuracy, Repeatability, Linearity, Results, Review, Approval, PDF). The selected protocol supplies the device-specific tests — they are mapped into the test steps and all remaining tests stay visible in Results. Starting or completing a run never implies that the instrument passed.</div>
        </div>
        {catalog.isLoading ? <Loading /> : catalog.error ? <ErrorBox error={catalog.error} /> : !catalog.data?.length ? (
          <div className="pm-empty">No protocols are available for execution. Import the 8 calibration protocols from “Create Protocol”.</div>
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>Protocol</th><th>Revision</th><th>Tests / steps</th><th>Pending verification</th><th>Equipment</th><th /></tr></thead>
              <tbody>
                {catalog.data.map(p => {
                  const active = p.equipment.filter(e => e.status !== "retired");
                  const selected = choice[p.protocolId] ?? active[0]?.instrumentKey ?? "";
                  return (
                    <tr key={p.protocolId}>
                      <td><strong>{p.protocolNumber}</strong><div className="pm-muted">{p.title}</div></td>
                      <td>Rev {p.revisionNumber}<div><span className={`pm-badge ${p.revisionStatus === "released" ? "pm-tone-ok" : "pm-tone-warn"}`}>{p.revisionStatus}</span></div></td>
                      <td>{p.testCount} tests<div className="pm-muted">{p.stepCount} steps</div></td>
                      <td>{p.pendingVerification > 0 ? <PendingTag verified={false} /> : <PendingTag verified />}{p.openGaps > 0 && <div className="pm-muted">{p.openGaps} open gap(s)</div>}</td>
                      <td>
                        {active.length ? (
                          <select value={selected} onChange={e => setChoice(c => ({ ...c, [p.protocolId]: e.target.value }))}>
                            {active.map(e => <option key={e.instrumentKey} value={e.instrumentKey}>{e.instrumentId} — {e.name}</option>)}
                          </select>
                        ) : <span className="pm-muted">No linked / compatible equipment</span>}
                      </td>
                      <td>
                        <button type="button" className="pm-btn primary small" disabled={!canExecute || !selected || create.isPending} title={!canExecute ? "Requires the executor duty" : undefined} onClick={() => create.mutate({ protocolId: p.protocolId, instrumentKey: selected })}>
                          <PlayCircle size={14} /> Start run
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Calibration runs">
        {runs.isLoading ? <Loading /> : runs.error ? <ErrorBox error={runs.error} /> : !runs.data?.length ? <div className="pm-empty">No calibration runs yet.</div> : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>Run</th><th>Protocol</th><th>Equipment</th><th>Status</th><th>Calculated outcome</th><th>Last saved</th></tr></thead>
              <tbody>
                {runs.data.map(r => (
                  <tr key={r.id} className="is-click" onClick={() => onOpen(r.id)}>
                    <td><strong>{r.runNumber}</strong><div className="pm-muted">v{r.rowVersion}</div></td>
                    <td>{r.protocolNumber} Rev {r.revisionNumber}{r.revisionStatus !== "released" && <div className="pm-muted">trial run on {r.revisionStatus} revision</div>}</td>
                    <td>{r.equipmentId}{r.newerEquipmentData && <div><span className="pm-badge pm-tone-warn">newer equipment data</span></div>}</td>
                    <td><span className={`pm-badge ${r.status === "recorded" ? "pm-tone-ok" : r.status === "abandoned" ? "pm-tone-muted" : "pm-tone-info"}`}>{r.status}</span></td>
                    <td>{r.overall ? <ResultBadge result={r.overall} /> : "—"}</td>
                    <td>{fmtDate(r.updatedAt, true)}<div className="pm-muted">{r.updatedBy ?? ""}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------- run view -------------------------------- */

type Conflict = { theirsVersion: number; theirsBy: string | null; theirs: Measurements; base: Measurements; choices: Record<string, "mine" | "theirs"> };

function RunView({ runId, user, duties, onClose }: { runId: string; user: PmUser; duties: readonly string[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.protocols.run.useQuery({ runId });
  const [measurements, setMeasurements] = useState<Measurements>({});
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [stepKey, setStepKey] = useState("equipment");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [comments, setComments] = useState("");
  const [deviations, setDeviations] = useState<ExecutionDeviation[]>([]);
  const [language, setLanguage] = useState<"ar" | "en">(() => (localStorage.getItem("yemen-qc-language") === "ar" ? "ar" : "en"));

  useEffect(() => {
    if (!q.data || dirty) return;
    setMeasurements(q.data.run.measurements);
    setLoadedVersion(q.data.run.rowVersion);
    if (!loadedVersion && q.data.run.currentStep && q.data.steps.some(s => s.key === q.data.run.currentStep)) setStepKey(q.data.run.currentStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const content = q.data?.content;
  const evaluation = useMemo(() => (content ? evaluateExecution(content, measurements) : null), [content, measurements]);
  const mapping = useMemo(() => (content ? mapTestsToSteps(content) : null), [content]);
  const execution = trpc.protocols.execution.useQuery({ executionId: q.data?.run.executionId ?? "" }, { enabled: !!q.data?.run.executionId });

  const save = trpc.protocols.saveRun.useMutation();
  const record = trpc.protocols.recordRun.useMutation();
  const abandon = trpc.protocols.abandonRun.useMutation();
  const logPdf = trpc.protocols.logRunPdf.useMutation();

  if (q.isLoading) return <Loading label="Loading calibration run…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const editable = d.run.status === "draft" && d.canRecord;
  const steps = d.steps;
  const idx = Math.max(0, steps.findIndex(s => s.key === stepKey));
  const step = steps[idx];
  const testResult = (testKey?: string) => evaluation?.tests.find(t => t.testKey === testKey);

  const doSave = async (opts: { reason?: string; measurements?: Measurements; expected?: number } = {}) => {
    try {
      const r = await save.mutateAsync({ runId, expectedRowVersion: opts.expected ?? loadedVersion, measurements: opts.measurements ?? measurements, currentStep: stepKey, reason: opts.reason });
      setLoadedVersion(r.rowVersion);
      if (opts.measurements) setMeasurements(opts.measurements);
      setDirty(false);
      setConflict(null);
      toast.success(`Saved as version ${r.rowVersion}`);
      await utils.protocols.run.invalidate({ runId });
      return true;
    } catch (e) {
      const msg = errorText(e);
      if (msg.includes("DRAFT_CONFLICT")) {
        const latest = await utils.protocols.run.fetch({ runId });
        const base = loadedVersion ? (await utils.protocols.runVersion.fetch({ runId, rowVersion: loadedVersion })).measurements : {};
        setConflict({ theirsVersion: latest.run.rowVersion, theirsBy: latest.run.updatedBy, theirs: latest.run.measurements, base, choices: {} });
        toast.error("Another user saved this run. Your changes are kept — compare and merge below.");
      } else toast.error(msg);
      return false;
    }
  };

  const setTest = (testKey: string) => (fn: (t: TestMeasurement) => TestMeasurement) => {
    setMeasurements(m => ({ ...m, [testKey]: fn(m[testKey] ?? {}) }));
    setDirty(true);
  };

  /** Navigation follows validation rules: review/approval need a recorded execution. */
  const go = (i: number) => {
    const target = steps[Math.min(steps.length - 1, Math.max(0, i))];
    const targetIndex = CANONICAL_STEP_KEYS.indexOf(target.key as CanonicalStepKey);
    if (targetIndex >= CANONICAL_STEP_KEYS.indexOf("review") && !d.run.executionId) {
      toast.error("Record the run in the Results step before opening Review or Approval.");
      return;
    }
    setStepKey(target.key);
  };

  const stepStatus = (s: RunStep): string | undefined => {
    if (s.key === "accuracy" || s.key === "repeatability" || s.key === "linearity") {
      const results = s.testKeys.map(k => testResult(k)?.status).filter(Boolean) as string[];
      if (results.includes("FAIL")) return "FAIL";
      if (results.includes("INCOMPLETE")) return "INCOMPLETE";
      if (results.length && results.every(r => r === "PASS")) return "PASS";
      if (results.length && results.some(r => r === "UNDER REVIEW")) return "UNDER REVIEW";
      if (isStepNotApplicable(measurements, s.key as NaStepKey)) return "NOT APPLICABLE";
      return undefined;
    }
    return frameStatus(s.key, d, dirty);
  };
  const stepTitle = (s: RunStep) => (language === "ar" ? s.labelAr : s.label);

  const recordBlockers = d.blockers.filter(b => b.blocksRecording);
  const approvalBlockers = d.blockers.filter(b => b.blocksApproval);

  const generatePdf = async () => {
    if (!evaluation || !content) return;
    const ex = execution.data;
    const { doc, documentId, status } = buildRunPdf({
      organization: ORGANIZATION,
      runNumber: d.run.runNumber,
      runStatus: d.run.status,
      rowVersion: d.run.rowVersion,
      protocolNumber: d.run.protocolNumber,
      revisionNumber: d.run.revisionNumber,
      revisionStatus: d.revision.status,
      contentHash: d.run.contentHash,
      content,
      equipment: d.run.equipmentSnapshot as EquipmentSnapshot,
      newerEquipmentData: d.newerEquipmentData,
      measurements: d.run.measurements,
      evaluation: evaluateExecution(content, d.run.measurements),
      blockers: d.blockers,
      executionReviewStatus: ex?.reviewStatus ?? d.execution?.reviewStatus ?? null,
      createdBy: d.run.createdBy,
      createdAt: d.run.createdAt,
      updatedBy: d.run.updatedBy,
      updatedAt: d.run.updatedAt,
      history: d.history,
      signatures: [
        { role: "Executed / recorded by", name: ex?.executedByName ?? null, date: ex?.executedAt ?? null, meaning: ex ? "Execution recorded" : null },
        { role: "Technical reviewer", name: ex?.reviewerName ?? null, date: ex?.reviews.find(r => r.actorName === ex.reviewerName && r.toStatus === "reviewed")?.createdAt ?? null, meaning: ex?.reviews.find(r => r.toStatus === "reviewed")?.signatureMeaning ?? null },
        { role: "QA approver", name: ex?.approverName ?? null, date: ex?.reviews.find(r => r.toStatus === "approved")?.createdAt ?? null, meaning: ex?.reviews.find(r => r.toStatus === "approved")?.signatureMeaning ?? null },
      ],
      generatedBy: user.name ?? `user #${user.id}`,
      generatedAt: new Date(),
    });
    doc.save(`${d.run.runNumber}-v${d.run.rowVersion}.pdf`);
    try {
      await logPdf.mutateAsync({ runId, documentStatus: status.label.slice(0, 60), documentId });
    } catch (e) {
      toast.error(`PDF generated but the audit entry failed: ${errorText(e)}`);
      return;
    }
    toast.success(`PDF ${documentId} generated (${status.watermark ? `watermark: ${status.watermark}` : "approved execution"})`);
  };

  return (
    <div className="pm-grid">
      <Panel
        title={<>{d.run.runNumber} <span className="pm-muted">· {d.run.protocolNumber} Rev {d.run.revisionNumber} · {(d.run.equipmentSnapshot as EquipmentSnapshot).identity.instrumentId}</span></>}
        actions={
          <>
            <span className={`pm-badge ${d.run.status === "recorded" ? "pm-tone-ok" : d.run.status === "abandoned" ? "pm-tone-muted" : "pm-tone-info"}`}>{d.run.status} · v{d.run.rowVersion}</span>
            {evaluation && <ResultBadge result={evaluation.overall} />}
            {editable && <button type="button" className="pm-btn primary small" disabled={!dirty || save.isPending || !!conflict} onClick={() => doSave()}><Save size={14} /> {dirty ? "Save draft" : "Saved"}</button>}
            {editable && (
              <button type="button" className="pm-btn danger small" disabled={abandon.isPending} onClick={async () => {
                const reason = askReason("Reason for abandoning this run (the run and its history are kept):");
                if (!reason) return;
                try { await abandon.mutateAsync({ runId, expectedRowVersion: loadedVersion, reason }); toast.success("Run abandoned"); utils.protocols.run.invalidate({ runId }); utils.protocols.runs.invalidate(); } catch (e) { toast.error(errorText(e)); }
              }}><XCircle size={14} /> Abandon</button>
            )}
            <button type="button" className="pm-btn small" onClick={() => { if (dirty && !window.confirm("Discard unsaved changes?")) return; onClose(); }}>All runs</button>
          </>
        }
      >
        <Banners d={d} dirty={dirty} />
        <nav className="pm-stepper" aria-label="Calibration run steps" dir={language === "ar" ? "rtl" : "ltr"}>
          {steps.map((s, i) => <StepButton key={s.key} step={s} index={i} active={i === idx} status={stepStatus(s)} lang={language} onClick={() => go(i)} />)}
        </nav>
        <div className="pm-row" style={{ marginTop: 6, justifyContent: "space-between" }}>
          <div className="pm-muted">Step {idx + 1} of {steps.length} — {content ? content.sections.flatMap(s => s.tests).length : 0} protocol-specific tests mapped across the nine controlled steps.</div>
          <button type="button" className="pm-btn small ghost" onClick={() => setLanguage(l => (l === "ar" ? "en" : "ar"))}>{language === "ar" ? "English" : "العربية"}</button>
        </div>
      </Panel>

      {conflict && evaluation && (
        <ConflictPanel conflict={conflict} mine={measurements} content={content!} setChoices={choices => setConflict(c => (c ? { ...c, choices } : c))}
          onUseTheirs={() => { setMeasurements(conflict.theirs); setLoadedVersion(conflict.theirsVersion); setDirty(false); setConflict(null); toast.info(`Loaded version ${conflict.theirsVersion}; your unsaved changes were discarded`); }}
          onMerge={merged => doSave({ measurements: merged, expected: conflict.theirsVersion, reason: `Merged with concurrent version ${conflict.theirsVersion}${conflict.theirsBy ? ` by ${conflict.theirsBy}` : ""}; choices: ${Object.entries(conflict.choices).map(([k, v]) => `${k}=${v}`).join(", ") || "no conflicting tests"}` })}
          busy={save.isPending} />
      )}

      <Panel title={`${idx + 1}. ${stepTitle(step)}`} actions={<><button type="button" className="pm-btn small" disabled={idx === 0} onClick={() => go(idx - 1)}>← Previous</button><button type="button" className="pm-btn small" disabled={idx === steps.length - 1} onClick={() => go(idx + 1)}>Next →</button></>}>
        {step.key === "equipment" && <EquipmentStep snapshot={d.run.equipmentSnapshot as EquipmentSnapshot} current={d.currentEquipment as EquipmentSnapshot | null} newer={d.newerEquipmentData} />}
        {step.key === "protocol" && content && <ProtocolStep d={d} />}
        {(step.key === "accuracy" || step.key === "repeatability" || step.key === "linearity") && content && mapping && (
          <div className="pm-grid">
            {step.testKeys.length === 0 ? (
              <NaStepPanel
                step={step.key as NaStepKey}
                value={measurements[naMeasurementKey(step.key)] ?? {}}
                editable={editable}
                onChange={next => { setMeasurements(m => ({ ...m, [naMeasurementKey(step.key)]: next })); setDirty(true); }}
              />
            ) : step.testKeys.map(testKey => {
              const test = content.sections.flatMap(s => s.tests).find(t => t.key === testKey);
              if (!test) return null;
              const r = testResult(testKey);
              return (
                <div className="pm-grid" key={testKey}>
                  <h3>{test.key} · {test.name}</h3>
                  {test.description && <div className="pm-muted" style={{ whiteSpace: "pre-wrap" }}>{test.description}</div>}
                  {test.notes && <div className="pm-alert pm-alert-info"><div className="pm-pre">{test.notes}</div></div>}
                  {editable ? <TestInput test={test} value={measurements[test.key] ?? {}} onChange={setTest(test.key)} preview={r?.status} /> : <ReadOnlyTest measurement={measurements[test.key] ?? {}} />}
                  {r && (r.calculations.length > 0 || r.criteria.length > 0) && (
                    <div className="pm-table-wrap">
                      <table className="pm-table">
                        <thead><tr><th>Item</th><th>Value</th><th>Limit / formula</th><th>Outcome</th></tr></thead>
                        <tbody>
                          {r.calculations.map(c => <tr key={`c-${c.key}-${c.levelKey ?? ""}`}><td>{c.label}{c.levelKey ? ` @${c.levelKey}` : ""}</td><td>{c.error ? <span className="pm-tone-bad">{c.error}</span> : `${c.value ?? "—"} ${c.unit}`}</td><td className="pm-muted">{c.formula}</td><td /></tr>)}
                          {r.criteria.map(c => <tr key={`k-${c.key}-${c.levelKey ?? ""}`}><td>{c.key}{c.levelKey ? ` @${c.levelKey}` : ""} {c.verificationStatus !== "verified" && <PendingTag verified={false} />}</td><td>{c.value === null || c.value === undefined ? "—" : String(c.value)}</td><td>{c.limit}</td><td><ResultBadge result={c.status} /><div className="pm-muted">{c.message}</div></td></tr>)}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {r?.notes.length ? <ul className="pm-muted">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
                </div>
              );
            })}
          </div>
        )}
        {step.key === "results" && evaluation && mapping && (
          <div className="pm-grid">
            <EvaluationView evaluation={evaluation} />
            {mapping.results.length > 0 && (
              <div className="pm-grid">
                <h3>Additional protocol-specific tests</h3>
                <div className="pm-alert pm-alert-info">
                  <div>Tests defined by the selected protocol that are not Accuracy, Repeatability or Linearity. They are recorded here with their original names, units, formulas and acceptance criteria — none is omitted or changed.</div>
                </div>
                {mapping.results.map(test => {
                  const r = testResult(test.key);
                  return (
                    <div className="pm-grid" key={test.key}>
                      <h4>{test.key} · {test.name} <span className="pm-muted">({test.stage})</span></h4>
                      {editable ? <TestInput test={test} value={measurements[test.key] ?? {}} onChange={setTest(test.key)} preview={r?.status} /> : <ReadOnlyTest measurement={measurements[test.key] ?? {}} />}
                      {r && (r.calculations.length > 0 || r.criteria.length > 0) && (
                        <div className="pm-table-wrap">
                          <table className="pm-table">
                            <thead><tr><th>Item</th><th>Value</th><th>Limit / formula</th><th>Outcome</th></tr></thead>
                            <tbody>
                              {r.calculations.map(c => <tr key={`c-${c.key}-${c.levelKey ?? ""}`}><td>{c.label}{c.levelKey ? ` @${c.levelKey}` : ""}</td><td>{c.error ? <span className="pm-tone-bad">{c.error}</span> : `${c.value ?? "—"} ${c.unit}`}</td><td className="pm-muted">{c.formula}</td><td /></tr>)}
                              {r.criteria.map(c => <tr key={`k-${c.key}-${c.levelKey ?? ""}`}><td>{c.key}{c.levelKey ? ` @${c.levelKey}` : ""} {c.verificationStatus !== "verified" && <PendingTag verified={false} />}</td><td>{c.value === null || c.value === undefined ? "—" : String(c.value)}</td><td>{c.limit}</td><td><ResultBadge result={c.status} /><div className="pm-muted">{c.message}</div></td></tr>)}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {d.run.status === "draft" && (
              <div className="pm-grid">
                <h3>Record formal execution</h3>
                {recordBlockers.length > 0 && <div className="pm-alert pm-alert-bad"><AlertTriangle size={16} /><div>Recording is blocked:<ul>{recordBlockers.map(b => <li key={b.code}>{b.message}</li>)}</ul></div></div>}
                <Field label="Comments"><textarea rows={3} value={comments} onChange={e => setComments(e.target.value)} /></Field>
                <DeviationsEditor value={deviations} onChange={setDeviations} />
                <button type="button" className="pm-btn primary" disabled={!editable || dirty || recordBlockers.length > 0 || record.isPending} title={dirty ? "Save the draft first" : undefined}
                  onClick={async () => {
                    if (!window.confirm("Record this run? Raw data become immutable and the execution enters technical review. Recording is not an approval.")) return;
                    try {
                      await record.mutateAsync({ runId, expectedRowVersion: loadedVersion, comments: comments || undefined, deviations: deviations.filter(x => x.description.trim()) });
                      toast.success("Execution recorded — awaiting technical review");
                      await utils.protocols.run.invalidate({ runId });
                      utils.protocols.runs.invalidate();
                      setStepKey("review");
                    } catch (e) { toast.error(errorText(e)); }
                  }}>Record execution (submit for review)</button>
                {dirty && <div className="pm-muted">Unsaved changes — save the draft before recording.</div>}
              </div>
            )}
          </div>
        )}
        {step.key === "review" && (d.run.executionId ? <ExecutionDetailView executionId={d.run.executionId} user={user} duties={duties} /> : <div className="pm-empty">Record the run (Results step) to start the technical review.</div>)}
        {step.key === "approval" && (
          <div className="pm-grid">
            {approvalBlockers.length > 0 ? (
              <div className="pm-alert pm-alert-warn"><AlertTriangle size={16} /><div>Approval is blocked until these conditions are resolved:<ul>{approvalBlockers.map(b => <li key={b.code}>{b.message}</li>)}</ul></div></div>
            ) : <div className="pm-alert pm-alert-ok"><CheckCircle2 size={16} /><div>No system condition blocks approval. Approval still requires an independent QA approver with password re-authentication.</div></div>}
            {d.run.executionId ? (
              <div className="pm-row">Execution review status: <ReviewStatusBadge status={execution.data?.reviewStatus ?? d.execution?.reviewStatus ?? "recorded"} /> <span className="pm-muted">Review and approval actions are available in the Review step for users holding those duties (segregation of duties is enforced).</span></div>
            ) : <div className="pm-empty">Not recorded yet.</div>}
          </div>
        )}
        {step.key === "pdf" && (
          <div className="pm-grid">
            <div className="pm-alert pm-alert-info"><FileDown size={16} /><div>The report is generated from the run snapshot (protocol revision, equipment data, saved raw data). Until the execution is approved every page carries a DRAFT / NOT APPROVED watermark. Each generation is audit-logged with a unique document ID.</div></div>
            {dirty && <div className="pm-alert pm-alert-warn"><AlertTriangle size={16} /><div>Unsaved changes are not included — the PDF uses saved version v{d.run.rowVersion}.</div></div>}
            <div><button type="button" className="pm-btn primary" onClick={generatePdf} disabled={logPdf.isPending}><FileDown size={14} /> Generate PDF report</button></div>
          </div>
        )}
      </Panel>

      <Panel title="Saved versions (immutable history)">
        <HistoryTable runId={runId} history={d.history} current={measurements} />
      </Panel>
    </div>
  );
}

function frameStatus(key: string, d: { run: { status: string; executionId: string | null }; execution: { reviewStatus: string } | null }, dirty: boolean) {
  if (key === "results") return d.run.status === "recorded" ? "RECORDED" : dirty ? "UNSAVED" : undefined;
  if (key === "review") return d.execution ? d.execution.reviewStatus.toUpperCase() : undefined;
  if (key === "approval") return d.execution?.reviewStatus === "approved" ? "APPROVED" : undefined;
  return undefined;
}

function StepButton({ step, index, active, status, lang, onClick }: { step: RunStep; index: number; active: boolean; status?: string; lang: "ar" | "en"; onClick: () => void }) {
  const tone = status === "PASS" || status === "APPROVED" || status === "RECORDED" ? "ok" : status === "FAIL" || status === "REJECTED" ? "bad" : status === "UNDER REVIEW" || status === "NOT APPLICABLE" ? "info" : status === "INCOMPLETE" || status === "UNSAVED" ? "warn" : status ? "muted" : "";
  const label = lang === "ar" ? step.labelAr : step.label;
  return (
    <button type="button" className={`pm-step ${active ? "is-active" : ""} ${tone ? `is-${tone}` : ""}`} onClick={onClick} title={status ? `${step.label} — ${status}` : step.label} aria-label={`${index + 1}. ${step.label}`}>
      <span className="pm-step-num">{tone === "ok" ? <CheckCircle2 size={13} /> : tone === "bad" ? <XCircle size={13} /> : index + 1}</span>
      <span className="pm-step-label">
        {label}
        {lang === "en" && <span className="pm-muted" style={{ display: "block", fontSize: 10 }} dir="rtl">{step.labelAr}</span>}
        {status && <span className="pm-muted" style={{ display: "block", fontSize: 10 }}>{status}</span>}
      </span>
    </button>
  );
}

type RunData = ProtocolOutputs["run"];

function Banners({ d, dirty }: { d: RunData; dirty: boolean }) {
  const items: Array<{ tone: "bad" | "warn" | "info"; text: string }> = [];
  if (d.run.status === "recorded") items.push({ tone: "info", text: "This run is recorded — raw data are immutable. Corrections require a new run." });
  if (d.run.status === "abandoned") items.push({ tone: "info", text: `Abandoned: ${d.run.abandonReason ?? ""}` });
  if (d.newerEquipmentData) items.push({ tone: "warn", text: "Newer equipment data exist in the equipment profile. This run keeps the snapshot captured at creation (see the Equipment step for the differences). Start a new run to use the latest data." });
  if (d.protocolChangedSinceRun) items.push({ tone: "warn", text: "The protocol revision content changed after this run was created. The run keeps its own protocol snapshot." });
  if (d.revision.status !== "released") items.push({ tone: "warn", text: `Trial run: the protocol revision is “${d.revision.status}”, not released. Results cannot support an approved calibration.` });
  if (d.revision.pendingVerification > 0) items.push({ tone: "warn", text: `${d.revision.pendingVerification} acceptance criteria are pending technical verification — they can be recorded but never produce a PASS and they block approval.` });
  if (dirty) items.push({ tone: "info", text: "You have unsaved changes." });
  d.blockers.filter(b => !["revision-not-released", "pending-verification", "protocol-changed"].includes(b.code)).forEach(b => items.push({ tone: b.blocksRecording ? "bad" : "warn", text: b.message }));
  if (!items.length) return null;
  return (
    <div className="pm-grid" style={{ marginBottom: 10, gap: 6 }}>
      {items.map((b, i) => <div key={i} className={`pm-alert pm-alert-${b.tone}`}><AlertTriangle size={16} /><div>{b.text}</div></div>)}
    </div>
  );
}

function EquipmentStep({ snapshot, current, newer }: { snapshot: EquipmentSnapshot; current: EquipmentSnapshot | null; newer: boolean }) {
  const defs = specDefinitions(snapshot.equipmentType);
  const diffs = newer && current ? diffEquipment(snapshot.equipmentType, snapshot, current) : [];
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? NOT_AVAILABLE : String(v));
  return (
    <div className="pm-grid">
      <div className="pm-muted">Read-only. Snapshot captured {fmtDate(snapshot.capturedAt, true)} (equipment data version {snapshot.specsRowVersion}). Edit equipment data on the page «تعديل بيانات المعدات والمواصفات».</div>
      <div className="pm-grid c4">
        {IDENTITY_FIELDS.map(f => <Field key={f.key} label={f.label}><div className={snapshot.identity[f.key] ? "" : "pm-muted"}>{show(snapshot.identity[f.key])}</div></Field>)}
        <Field label="Status at snapshot"><div>{snapshot.status}</div></Field>
      </div>
      {SPEC_GROUPS.map(g => {
        const groupDefs = defs.filter(x => x.group === g.key);
        if (!groupDefs.length) return null;
        return (
          <div key={g.key}>
            <h3>{g.label}</h3>
            <div className="pm-grid c3">
              {groupDefs.map(def => {
                const v = snapshot.specs[def.key];
                const has = v && v.value !== null && v.value !== "";
                return <Field key={def.key} label={def.label} hint={has && v.source ? `Source: ${v.source}` : undefined}><div className={has ? "" : "pm-muted"}>{has ? `${v.value} ${v.unit}`.trim() : NOT_AVAILABLE}</div></Field>;
              })}
            </div>
          </div>
        );
      })}
      {diffs.length > 0 && (
        <div className="pm-alert pm-alert-warn">
          <AlertTriangle size={16} />
          <div>
            Newer equipment data (not applied to this run):
            <ul>{diffs.map(c => <li key={`${c.group}-${c.field}`}>{c.label}: {show(c.previous)} → {show(c.next)} {c.unit}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}

function ProtocolStep({ d }: { d: RunData }) {
  const c = d.content;
  const tests = c.sections.flatMap(s => s.tests);
  return (
    <div className="pm-grid">
      <div className="pm-grid c3">
        <Field label="Protocol"><div>{c.identification.number} — {c.identification.title}</div></Field>
        <Field label="Revision (snapshot)"><div>Rev {d.run.revisionNumber} · {d.revision.status}</div></Field>
        <Field label="Content hash"><div className="pm-muted">{d.run.contentHash.slice(0, 16)}…</div></Field>
        <Field label="Stages"><div>{c.stages.join(", ") || "—"}</div></Field>
        <Field label="Tests"><div>{tests.length}</div></Field>
        <Field label="Pending verification"><div>{d.revision.pendingVerification}</div></Field>
      </div>
      {c.identification.description && <Field label="Description"><div className="pm-pre">{c.identification.description}</div></Field>}
      {c.gaps.length > 0 && <div className="pm-alert pm-alert-warn"><AlertTriangle size={16} /><div>Open technical gaps:<ul>{c.gaps.map(g => <li key={g.key}><strong>{g.key}</strong> {g.title}</li>)}</ul></div></div>}
      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead><tr><th>#</th><th>Test</th><th>Stage</th><th>Criteria</th><th>Required</th></tr></thead>
          <tbody>{tests.map((t, i) => <tr key={t.key}><td>{i + 1}</td><td>{t.key} · {t.name}</td><td>{t.stage}</td><td>{t.criteria.length} {t.criteria.some(k => k.verificationStatus !== "verified") && <PendingTag verified={false} />}</td><td>{t.required ? "Yes" : "Optional"}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function ReadOnlyTest({ measurement: m }: { measurement: TestMeasurement }) {
  const rows: Array<[string, string]> = [];
  if (m.notApplicable) rows.push(["Not applicable", m.naJustification ?? ""]);
  if (m.readings?.length) rows.push(["Readings", m.readings.map(v => v ?? "—").join("; ")]);
  if (m.reference !== undefined && m.reference !== null) rows.push(["Reference", String(m.reference)]);
  Object.entries(m.levels ?? {}).forEach(([k, v]) => rows.push([`Level ${k}`, v.map(x => x ?? "—").join("; ")]));
  Object.entries(m.levelReferences ?? {}).forEach(([k, v]) => rows.push([`Reference ${k}`, String(v ?? "—")]));
  Object.entries(m.fields ?? {}).forEach(([k, v]) => rows.push([k, Array.isArray(v) ? v.join(", ") : String(v ?? "—")]));
  if (m.comment) rows.push(["Comment", m.comment]);
  if (!rows.length) return <div className="pm-empty">No data recorded for this test.</div>;
  return <div className="pm-table-wrap"><table className="pm-table"><tbody>{rows.map(([k, v], i) => <tr key={i}><th>{k}</th><td>{v}</td></tr>)}</tbody></table></div>;
}

/** Documents a canonical test step that has no configured test for this device. */
function NaStepPanel({ step, value, editable, onChange }: { step: NaStepKey; value: TestMeasurement; editable: boolean; onChange: (next: TestMeasurement) => void }) {
  const label = CANONICAL_STEP_LABELS[step];
  const justification = value.naJustification ?? "";
  const documented = isStepNotApplicable({ [naMeasurementKey(step)]: value }, step);
  const patch = (p: Partial<TestMeasurement>) => onChange({ ...value, ...p });
  return (
    <div className="pm-grid">
      <div className="pm-alert pm-alert-warn"><AlertTriangle size={16} /><div><strong>Not Applicable — {label.label} ({label.labelAr})</strong><br />The selected protocol defines no {label.label.toLowerCase()} test. The step is never silently skipped: record a written justification and a reviewer confirmation to close it. Formal recording and approval stay blocked until this is done.</div></div>
      {!editable && <div className="pm-alert pm-alert-info"><div>{documented ? "Documented as Not Applicable." : "Not documented — this step is still open."}</div></div>}
      <Field label="This test is not applicable for this device / protocol">
        <label className="pm-row"><input type="checkbox" disabled={!editable} checked={value.notApplicable === true} onChange={e => patch({ notApplicable: e.target.checked })} /> Not applicable</label>
      </Field>
      <Field label="Documented justification (minimum 10 characters)" hint="Explain why the protocol has no such test for this device. Do not invent a test or a criterion.">
        <textarea rows={3} disabled={!editable} value={justification} onChange={e => patch({ naJustification: e.target.value })} placeholder="e.g. The supplied CAL-QC-MOA-001 protocol defines no linearity test; only the documented OQ/PQ tests apply." />
      </Field>
      <Field label="Reviewer confirmation">
        <label className="pm-row"><input type="checkbox" disabled={!editable} checked={value.fields?.[NA_CONFIRMATION_FIELD] === true} onChange={e => patch({ fields: { ...(value.fields ?? {}), [NA_CONFIRMATION_FIELD]: e.target.checked } })} /> I confirm this Not Applicable decision is technically reviewed and accepted</label>
      </Field>
      {value.notApplicable && !documented && <div className="pm-alert pm-alert-bad"><AlertTriangle size={16} /><div>Provide a justification of at least 10 characters and tick the reviewer confirmation to close this step.</div></div>}
    </div>
  );
}

function summarize(m: unknown) {
  if (!m) return "— (no data)";
  const t = m as TestMeasurement;
  const parts: string[] = [];
  if (t.notApplicable) parts.push("N/A");
  if (t.readings?.length) parts.push(`readings ${t.readings.map(v => v ?? "—").join(", ")}`);
  if (t.reference !== undefined && t.reference !== null) parts.push(`ref ${t.reference}`);
  const f = Object.entries(t.fields ?? {}).filter(([, v]) => v !== null && v !== "");
  if (f.length) parts.push(f.slice(0, 4).map(([k, v]) => `${k}=${String(v)}`).join(", ") + (f.length > 4 ? ` +${f.length - 4}` : ""));
  const l = Object.keys(t.levels ?? {});
  if (l.length) parts.push(`${l.length} level(s)`);
  if (t.comment) parts.push(`“${t.comment}”`);
  return parts.join(" · ") || "(empty)";
}

function ConflictPanel({ conflict, mine, content, setChoices, onUseTheirs, onMerge, busy }: { conflict: Conflict; mine: Measurements; content: RunData["content"]; setChoices: (c: Record<string, "mine" | "theirs">) => void; onUseTheirs: () => void; onMerge: (m: Measurements) => void; busy: boolean }) {
  const rows = measurementConflicts(mine, conflict.theirs, conflict.base);
  const name = (k: string) => content.sections.flatMap(s => s.tests).find(t => t.key === k)?.name ?? k;
  const open = rows.filter(r => r.kind === "conflict" && !conflict.choices[r.testKey]);
  return (
    <Panel title={<><GitMerge size={16} /> Draft conflict — version {conflict.theirsVersion}{conflict.theirsBy ? ` saved by ${conflict.theirsBy}` : ""}</>} className="pm-conflict">
      <div className="pm-alert pm-alert-warn"><AlertTriangle size={16} /><div>Both versions are kept. Non-overlapping changes are merged automatically; for tests changed by both users choose which version to keep. Nothing is overwritten silently — the merge is saved as a new version with the reason recorded.</div></div>
      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead><tr><th>Test</th><th>Change</th><th>My version</th><th>Their version</th><th>Keep</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.testKey}>
                <td>{r.testKey} · {name(r.testKey)}</td>
                <td><span className={`pm-badge ${r.kind === "conflict" ? "pm-tone-bad" : "pm-tone-info"}`}>{r.kind === "mine" ? "changed by me" : r.kind === "theirs" ? "changed by them" : r.kind === "both-same" ? "same change" : "CONFLICT"}</span></td>
                <td className="pm-muted">{summarize(mine[r.testKey])}</td>
                <td className="pm-muted">{summarize(conflict.theirs[r.testKey])}</td>
                <td>
                  {r.kind === "conflict" ? (
                    <select value={conflict.choices[r.testKey] ?? ""} onChange={e => setChoices({ ...conflict.choices, [r.testKey]: e.target.value as "mine" | "theirs" })}>
                      <option value="">— choose —</option><option value="mine">Mine</option><option value="theirs">Theirs</option>
                    </select>
                  ) : <span className="pm-muted">{r.kind === "mine" ? "mine" : r.kind === "theirs" ? "theirs" : "either"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pm-row" style={{ marginTop: 10 }}>
        <button type="button" className="pm-btn primary" disabled={busy || open.length > 0} onClick={() => onMerge(mergeMeasurements(mine, conflict.theirs, conflict.base, conflict.choices) as Measurements)}><GitMerge size={14} /> Save merged version</button>
        <button type="button" className="pm-btn" disabled={busy} onClick={onUseTheirs}>Discard mine, load their version</button>
        {open.length > 0 && <span className="pm-muted">{open.length} conflicting test(s) still need a choice.</span>}
      </div>
    </Panel>
  );
}

function HistoryTable({ runId, history, current }: { runId: string; history: RunData["history"]; current: Measurements }) {
  const utils = trpc.useUtils();
  const [compare, setCompare] = useState<{ version: number; rows: ReturnType<typeof measurementConflicts> } | null>(null);
  return (
    <div className="pm-grid">
      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead><tr><th>Version</th><th>Action</th><th>Outcome</th><th>By</th><th>Date</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>v{h.rowVersion}</td><td>{h.action}</td><td>{h.overall ? <ResultBadge result={h.overall} /> : "—"}</td><td>{h.actorName ?? "—"}</td><td>{fmtDate(h.createdAt, true)}</td><td className="pm-muted">{h.reason ?? ""}</td>
                <td><button type="button" className="pm-btn small ghost" onClick={async () => {
                  try {
                    const v = await utils.protocols.runVersion.fetch({ runId, rowVersion: h.rowVersion });
                    setCompare({ version: h.rowVersion, rows: measurementConflicts(current, v.measurements, v.measurements).filter(r => r.kind !== "none") });
                  } catch (e) { toast.error(errorText(e)); }
                }}>Compare with current</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compare && (
        <div className="pm-alert pm-alert-info">
          <Circle size={14} />
          <div>Current data vs v{compare.version}: {compare.rows.length ? <>differences in {compare.rows.map(r => r.testKey).join(", ")}</> : "identical"}. <button type="button" className="pm-btn small ghost" onClick={() => setCompare(null)}>Close</button></div>
        </div>
      )}
    </div>
  );
}
