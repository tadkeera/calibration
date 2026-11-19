/**
 * Execution review & approval (§16.4–16.5), deviations (§16.3), controlled
 * attachments (§16.3 / §11) and the interval schedule (§13.2).
 *
 * All decisions are enforced on the server (duties, segregation of duties,
 * sequence, password re-authentication). The UI only offers the actions the
 * server reports as available and never shows a calculated PASS as approval.
 */
import { useRef, useState } from "react";
import { CalendarClock, Download, FileUp, Paperclip, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, attachmentTypeProblem, mimeFromFileName, type AttachmentEntityType } from "@shared/protocols/attachments";
import { EXECUTION_REVIEW_STATUS_LABELS, type ExecutionDeviation, type ExecutionReviewAction, type ExecutionReviewStatus } from "@shared/protocols/executionReview";
import { ErrorBox, Field, Loading, Panel, ResultBadge, SignatureBox, errorText, fmtDate, type Nav, type PmUser } from "./common";
import { EvaluationView } from "./ExecutionCenter";

const REVIEW_TONES: Record<string, string> = { recorded: "warn", reviewed: "info", approved: "ok", rejected: "bad" };
export function ReviewStatusBadge({ status }: { status: string }) {
  return <span className={`pm-badge pm-tone-${REVIEW_TONES[status] ?? "neutral"}`}>{EXECUTION_REVIEW_STATUS_LABELS[status as ExecutionReviewStatus] ?? status}</span>;
}

const ACTION_LABELS: Record<ExecutionReviewAction, string> = { review: "Complete technical review", approve: "QA approve execution", reject: "Reject execution" };

/* ------------------------------ Deviations editor ------------------------------ */

export const emptyDeviation = (): ExecutionDeviation => ({ description: "", impact: "", immediateAction: "", reference: "" });

export function DeviationsEditor({ value, onChange }: { value: ExecutionDeviation[]; onChange: (v: ExecutionDeviation[]) => void }) {
  const set = (i: number, patch: Partial<ExecutionDeviation>) => onChange(value.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  return (
    <div className="pm-grid">
      {value.length === 0 && <div className="pm-muted">No deviation recorded. Record any departure from the protocol (environment, procedure, standard, equipment behaviour) here — it is reviewed with the execution.</div>}
      {value.map((d, i) => (
        <div key={i} className="pm-card is-criterion">
          <div className="pm-card-head">
            <strong>Deviation {i + 1}</strong>
            <button type="button" className="pm-btn ghost" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label={`Remove deviation ${i + 1}`}><Trash2 size={14} /></button>
          </div>
          <div className="pm-grid c2">
            <Field label="Description *"><textarea value={d.description} onChange={e => set(i, { description: e.target.value })} /></Field>
            <Field label="Impact assessment"><textarea value={d.impact} onChange={e => set(i, { impact: e.target.value })} /></Field>
            <Field label="Immediate action"><input value={d.immediateAction} onChange={e => set(i, { immediateAction: e.target.value })} /></Field>
            <Field label="Deviation / CAPA reference"><input value={d.reference} onChange={e => set(i, { reference: e.target.value })} placeholder="e.g. DEV-2026-014" /></Field>
          </div>
        </div>
      ))}
      <div><button type="button" className="pm-btn" disabled={value.length >= 20} onClick={() => onChange([...value, emptyDeviation()])}><Plus size={14} /> Add deviation</button></div>
    </div>
  );
}

/* ------------------------------ Attachments ------------------------------ */

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("File could not be read"));
    reader.readAsDataURL(file);
  });

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

export function AttachmentsPanel({ entityType, entityId, canUpload, title = "Attachments", note }: { entityType: AttachmentEntityType; entityId: string; canUpload: boolean; title?: string; note?: string }) {
  const utils = trpc.useUtils();
  const list = trpc.protocols.attachments.useQuery({ entityType, entityId });
  const upload = trpc.protocols.uploadAttachment.useMutation();
  const download = trpc.protocols.downloadAttachment.useMutation();
  const [description, setDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const mimeType = file.type || mimeFromFileName(file.name);
    const problem = attachmentTypeProblem(file.name, mimeType);
    if (problem) return toast.error(problem);
    if (file.size > MAX_ATTACHMENT_BYTES) return toast.error(`The file exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`);
    try {
      const contentBase64 = await readBase64(file);
      const res = await upload.mutateAsync({ entityType, entityId, fileName: file.name, mimeType, contentBase64, description: description.trim() || undefined });
      toast.success(`Attached — SHA-256 ${res.sha256.slice(0, 12)}…`);
      setDescription("");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      await Promise.all([utils.protocols.attachments.invalidate({ entityType, entityId }), utils.protocols.execution.invalidate()]);
    }
  };

  const open = async (id: string) => {
    try {
      const file = await download.mutateAsync({ attachmentId: id });
      if (!file.integrityOk) toast.error("Integrity check FAILED: the stored content does not match its SHA-256. Report this to QA.");
      const bytes = Uint8Array.from(atob(file.contentBase64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <Panel title={<><Paperclip size={15} /> {title} ({list.data?.length ?? 0})</>}>
      {note && <p className="pm-muted" style={{ marginTop: 0 }}>{note}</p>}
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.length ? <div className="pm-empty">No files attached.</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>File</th><th>Description</th><th>Size</th><th>SHA-256</th><th>Uploaded</th><th /></tr></thead>
            <tbody>{list.data.map(a => (
              <tr key={a.id}>
                <td>{a.fileName}<div className="pm-muted">{a.mimeType}</div></td>
                <td>{a.description || "—"}</td>
                <td>{fmtSize(a.sizeBytes)}</td>
                <td className="pm-mono" title={a.sha256}>{a.sha256.slice(0, 16)}…</td>
                <td>{a.uploadedByName ?? "—"}<div className="pm-muted">{fmtDate(a.createdAt, true)}</div></td>
                <td><button type="button" className="pm-btn" disabled={download.isPending} onClick={() => open(a.id)}><Download size={14} /> Download</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {canUpload && (
        <div className="pm-grid c2" style={{ marginTop: 10 }}>
          <Field label="Description of the file" hint="e.g. instrument printout, certificate of the reference standard, raw data export"><input value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} /></Field>
          <Field label={`File (PDF, image, CSV, TXT, XLSX, DOCX — max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`} hint="Stored unchanged with a server-calculated SHA-256; attachments cannot be edited or deleted.">
            <input ref={fileRef} type="file" accept={ATTACHMENT_ACCEPT} disabled={upload.isPending} onChange={e => onFile(e.target.files?.[0])} />
          </Field>
          {upload.isPending && <div className="pm-muted"><FileUp size={14} /> Uploading…</div>}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ Execution detail + review ------------------------------ */

export function ExecutionDetailView({ executionId, user, duties }: { executionId: string; user: PmUser; duties: readonly string[] }) {
  const utils = trpc.useUtils();
  const q = trpc.protocols.execution.useQuery({ executionId });
  const review = trpc.protocols.reviewExecution.useMutation();
  const [comment, setComment] = useState("");
  const [password, setPassword] = useState("");
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const e = q.data;
  const final = e.reviewStatus === "approved" || e.reviewStatus === "rejected";
  const canAttach = !final && ((e.executedByUserId === user.id && duties.includes("executor")) || duties.includes("technical-reviewer") || duties.includes("qa-approver"));

  const act = async (action: ExecutionReviewAction) => {
    if (comment.trim().length < 3) return toast.error("A review comment / decision rationale is required");
    if (!password) return toast.error("Re-enter your password to sign");
    try {
      await review.mutateAsync({ executionId, action, comment: comment.trim(), password });
      toast.success(`${ACTION_LABELS[action]}: signed`);
      setComment("");
      setPassword("");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      await Promise.all([utils.protocols.execution.invalidate({ executionId }), utils.protocols.executions.invalidate(), utils.protocols.dashboard.invalidate(), utils.protocols.notifications.invalidate(), utils.protocols.detail.invalidate()]);
    }
  };

  return (
    <div className="pm-grid" style={{ marginTop: 12 }}>
      <div className="pm-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <ResultBadge result={e.overallResult} />
        <ReviewStatusBadge status={e.reviewStatus} />
        <span className="pm-muted">
          {e.protocolNumber} rev {e.revisionNumber} · {e.equipmentId ?? e.instrumentKey} · S/N {e.serialNumber ?? "—"} · hash {e.contentHash.slice(0, 16)}… · executed by {e.executedByName ?? "—"} {fmtDate(e.executedAt, true)}
          {e.activityName ? ` · activity: ${e.activityName}` : ""}
          {e.stage ? ` · stage ${e.stage}` : ""}
        </span>
      </div>
      {e.reviewStatus !== "approved" && <div className="pm-alert pm-alert-info">This execution is not approved. A calculated result becomes an approved result only after technical review and QA approval.</div>}
      {e.linkedRecord ? (
        <div className="pm-muted">Linked validation record #{e.linkedRecord.id} — {e.linkedRecord.resultStatus.toUpperCase()} · {e.linkedRecord.lifecycleStatus}{e.linkedRecord.approvedAt ? ` (approved ${fmtDate(e.linkedRecord.approvedAt)})` : ""}</div>
      ) : e.validationRecordId ? <div className="pm-muted">Linked validation record #{e.validationRecordId} (not readable with your permissions)</div> : null}
      {e.comments && <div><span className="pm-muted">Comments:</span> {e.comments}</div>}
      {e.deviations.length > 0 && (
        <Panel title={`Deviations (${e.deviations.length})`}>
          <ul className="pm-list">{e.deviations.map((d, i) => <li key={i}><span><strong>{d.reference || `#${i + 1}`}</strong> {d.description}{d.impact ? <div className="pm-muted">Impact: {d.impact}</div> : null}{d.immediateAction ? <div className="pm-muted">Immediate action: {d.immediateAction}</div> : null}</span></li>)}</ul>
        </Panel>
      )}
      <Panel title="Review & approval">
        {!e.reviews.length ? <div className="pm-muted">No review decision yet.</div> : (
          <div className="pm-timeline">
            {e.reviews.map(r => (
              <div key={r.id} className="pm-timeline-item">
                <strong>{ACTION_LABELS[r.action as ExecutionReviewAction] ?? r.action}</strong> → <ReviewStatusBadge status={r.toStatus} />
                <div className="pm-muted">{r.actorName ?? `User #${r.actorUserId}`} ({r.actorRole ?? "—"}) · {fmtDate(r.createdAt, true)} · Signature: {r.signatureMeaning}{r.reauthenticated ? " · password re-authenticated" : ""}</div>
                <div>{r.comment}</div>
              </div>
            ))}
          </div>
        )}
        {e.availableReviewActions.length > 0 ? (
          <div className="pm-grid" style={{ marginTop: 10 }}>
            <Field label="Review comment / decision rationale *"><textarea value={comment} onChange={ev => setComment(ev.target.value)} /></Field>
            <SignatureBox meaning={e.availableReviewActions.includes("review") ? "Technical review of execution" : "QA decision on execution"} signer={user.name ?? `User #${user.id}`} password={password} onPassword={setPassword} detail={<>with this execution and its calculated result</>} />
            <div className="pm-row">
              {e.availableReviewActions.map(a => (
                <button key={a} type="button" disabled={review.isPending} className={`pm-btn ${a === "reject" ? "danger" : "primary"}`} onClick={() => act(a as ExecutionReviewAction)}>{ACTION_LABELS[a as ExecutionReviewAction]}</button>
              ))}
            </div>
          </div>
        ) : !final ? (
          <div className="pm-muted" style={{ marginTop: 8 }}>{e.reviewStatus === "recorded" ? "Awaiting technical review by a technical reviewer other than the executor." : "Awaiting QA decision by a QA approver other than the executor and the technical reviewer."}</div>
        ) : null}
      </Panel>
      <AttachmentsPanel entityType="execution" entityId={executionId} canUpload={canAttach} title="Evidence / attachments" note={final ? "The execution has a final QA decision — no further evidence can be added." : undefined} />
      <EvaluationView evaluation={e.evaluation} />
    </div>
  );
}

/* ------------------------------ Schedule (§13.2) ------------------------------ */

const STATE_TONES: Record<string, string> = { overdue: "bad", "due-soon": "warn", scheduled: "ok-soft", "event-based": "muted" };
const STATE_LABELS: Record<string, string> = { overdue: "OVERDUE", "due-soon": "Due soon", scheduled: "Scheduled", "event-based": "Event-based" };

export function SchedulePanel({ setNav, instrumentKey, limit }: { setNav: (n: Nav) => void; instrumentKey?: string; limit?: number }) {
  const q = trpc.protocols.schedule.useQuery(instrumentKey ? { instrumentKey } : undefined);
  const [showAll, setShowAll] = useState(false);
  const rows = q.data ?? [];
  const shown = showAll || !limit ? rows : rows.slice(0, limit);
  return (
    <Panel title={<><CalendarClock size={16} /> Activity schedule (released protocol intervals)</>} actions={limit && rows.length > limit ? <button type="button" className="pm-btn ghost" onClick={() => setShowAll(v => !v)}>{showAll ? "Show less" : `Show all ${rows.length}`}</button> : undefined}>
      <p className="pm-muted" style={{ marginTop: 0 }}>
        Next due date = last PASS execution of the activity on that equipment (not rejected) + the approved interval; if never performed under the protocol, the revision's effective date is the baseline. Due soon = within 30 days. Periodic review of the protocol itself is listed under "Upcoming periodic reviews".
      </p>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : !rows.length ? <div className="pm-empty">No interval activities in released protocols.</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>Status</th><th>Activity</th><th>Equipment</th><th>Protocol</th><th>Interval</th><th>Last performed</th><th>Next due</th></tr></thead>
            <tbody>{shown.map(i => (
              <tr key={`${i.protocolId}:${i.instrumentKey}:${i.intervalKey}`} className="is-click" onClick={() => setNav({ view: "executions", revisionId: i.revisionId })}>
                <td><span className={`pm-badge pm-tone-${STATE_TONES[i.state]}`}>{STATE_LABELS[i.state]}</span></td>
                <td>{i.activity}{i.mandatory ? <span className="pm-muted"> · mandatory</span> : null}</td>
                <td>{i.equipmentId}<div className="pm-muted">{i.equipmentName}</div></td>
                <td>{i.protocolNumber} rev {i.revisionNumber}</td>
                <td>{i.intervalText}</td>
                <td>{i.lastPerformedAt ? fmtDate(i.lastPerformedAt) : <span className="pm-muted">never (baseline: effective date)</span>}</td>
                <td>{i.nextDue ? <>{fmtDate(i.nextDue)}<div className="pm-muted">{i.daysRemaining! < 0 ? `${-i.daysRemaining!} day(s) overdue` : `in ${i.daysRemaining} day(s)`}</div></> : "On event"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
