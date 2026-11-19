import { useEffect, useMemo, useState } from "react";
import { Download, Edit3, GitCompare, History, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { COMPARISONS, GAP_DECISIONS, PENDING_LABEL, PROTOCOL_TYPES, SOURCE_CLASSES, STATUS_LABELS, allCriteria, type ProtocolContent, type RevisionStatus } from "@shared/protocols/model";
import { TRANSITIONS, type WorkflowAction } from "@shared/protocols/workflow";
import { ErrorBox, Field, Loading, Panel, PendingTag, ResultBadge, StatusBadge, askReason, errorText, fmtDate, type DetailTab, type Nav, type PmUser, type ProtocolDetailDto, type RevisionDetailDto } from "./common";
import { buildProtocolPdf, documentStatus } from "./protocolPdf";

const ORGANIZATION = "National Drug Quality Control Laboratory — Supreme Board of Drugs";

export function useProtocolPdf() {
  const utils = trpc.useUtils();
  const log = trpc.protocols.logPdf.useMutation();
  return async (revisionId: string, generatedBy: string) => {
    try {
      const r = await utils.protocols.revision.fetch({ revisionId });
      const doc = buildProtocolPdf({
        organization: ORGANIZATION,
        content: r.revision.content,
        revisionNumber: r.revision.revisionNumber,
        status: r.revision.status,
        contentHash: r.revision.contentHash,
        effectiveDate: r.revision.effectiveDate,
        nextReviewDate: r.revision.nextReviewDate,
        approvedAt: r.revision.approvedAt,
        authorName: r.revision.authorName,
        technicalReviewerName: r.revision.technicalReviewedAt ? r.revision.technicalReviewerName : null,
        technicalReviewedAt: r.revision.technicalReviewedAt,
        qaApproverName: r.revision.qaApproverName,
        releasedByName: r.revision.releasedByName,
        releasedAt: r.revision.releasedAt,
        changeReason: r.revision.changeReason,
        // Locked revisions print the approval-time reference snapshot (exact revision content).
        references: ((r.revision.referenceSnapshot as { references?: RevisionDetailDto["references"] } | null)?.references ?? r.references).map(x => ({ id: x.id, code: x.code, title: x.title, edition: x.edition, revision: x.revision, documentNumber: x.documentNumber, verificationStatus: x.verificationStatus, sourceUrl: x.sourceUrl })),
        approvals: r.approvals.map(a => ({ action: a.action, actorName: a.actorName, signatureMeaning: a.signatureMeaning, createdAt: a.createdAt, comment: a.comment })),
        gapDecisions: r.gapDecisions,
        generatedBy,
        generatedAt: new Date(),
      });
      const st = documentStatus(r.revision.status);
      doc.save(`${r.protocol.protocolNumber}_Rev${r.revision.revisionNumber}_${r.revision.status}.pdf`);
      log.mutate({ revisionId, documentStatus: st.label });
    } catch (e) {
      toast.error(`PDF could not be generated: ${errorText(e)}`);
    }
  };
}

export function ProtocolDetail({ protocolId, initialTab, initialRevisionId, user, setNav }: { protocolId: string; initialTab?: DetailTab; initialRevisionId?: string; user: PmUser; setNav: (n: Nav) => void }) {
  const [tab, setTab] = useState<DetailTab>(initialTab ?? (initialRevisionId ? "review" : "overview"));
  const detail = trpc.protocols.detail.useQuery({ protocolId });
  const [revisionId, setRevisionId] = useState<string | undefined>(initialRevisionId);
  useEffect(() => {
    if (!revisionId && detail.data) setRevisionId(detail.data.protocol.currentRevisionId ?? detail.data.revisions[0]?.id);
  }, [detail.data, revisionId]);
  const rev = trpc.protocols.revision.useQuery({ revisionId: revisionId ?? "" }, { enabled: !!revisionId });
  const pdf = useProtocolPdf();
  if (detail.isLoading) return <Loading />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const d = detail.data!;
  const p = d.protocol;
  return (
    <div className="pm-grid">
      <Panel
        title={<>{p.protocolNumber} — {p.title}</>}
        actions={
          <>
            <select className="pm-input" style={{ width: "auto" }} value={revisionId} onChange={e => setRevisionId(e.target.value)} aria-label="Revision">
              {d.revisions.map(r => <option key={r.id} value={r.id}>Rev {r.revisionNumber} — {STATUS_LABELS[r.status as RevisionStatus]}</option>)}
            </select>
            {rev.data?.editable && <button type="button" className="pm-btn primary" onClick={() => setNav({ view: "builder", revisionId: rev.data!.revision.id })}><Edit3 size={14} /> Edit draft</button>}
            {revisionId && <button type="button" className="pm-btn" onClick={() => pdf(revisionId, user.name ?? `user ${user.id}`)}><Download size={14} /> PDF</button>}
            {p.releasedRevisionId && <button type="button" className="pm-btn" onClick={() => setNav({ view: "executions", revisionId: p.releasedRevisionId! })}><PlayCircle size={14} /> Execute released</button>}
          </>
        }
      >
        <div className="pm-row">
          <StatusBadge status={rev.data?.revision.status ?? p.status} />
          <span className="pm-muted">{PROTOCOL_TYPES.find(t => t.id === p.protocolType)?.label} · {p.manufacturer} {p.model} · {p.associationType === "equipment" ? `Equipment-specific (${p.equipmentId || p.instrumentKey})` : "Model-level"}</span>
          {p.releasedRevisionNumber && <span className="pm-badge pm-tone-ok">Released: Rev {p.releasedRevisionNumber}</span>}
        </div>
        {p.reviewFlag && <div className="pm-alert pm-alert-warn" style={{ marginTop: 10 }}><div><strong>Flagged for review.</strong> {p.reviewFlagReason}</div></div>}
        <nav className="pm-tabs" style={{ marginTop: 12 }}>
          {(["overview", "review", "revisions", "compare", "executions", "audit"] as DetailTab[]).map(t => (
            <button key={t} type="button" className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>{t === "review" ? "Review & approval" : t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </nav>
      </Panel>
      {rev.error && <ErrorBox error={rev.error} />}
      {tab === "overview" && (rev.data ? <Overview r={rev.data} /> : <Loading />)}
      {tab === "review" && (rev.data ? <ReviewPanel r={rev.data} user={user} /> : <Loading />)}
      {tab === "revisions" && <Revisions d={d} user={user} setNav={setNav} onSelect={id => { setRevisionId(id); setTab("overview"); }} />}
      {tab === "compare" && <Compare d={d} />}
      {tab === "executions" && <Executions d={d} />}
      {tab === "audit" && <Audit d={d} />}
    </div>
  );
}

/* ------------------------------ Overview ------------------------------ */

function Overview({ r }: { r: RevisionDetailDto }) {
  const c = r.revision.content;
  const refs = new Map(r.references.map(x => [x.id, x]));
  const pending = allCriteria(c).filter(x => x.criterion.verificationStatus !== "verified").length + c.intervals.filter(i => i.verificationStatus !== "verified").length;
  return (
    <div className="pm-grid">
      {r.revision.locked && <div className="pm-alert pm-alert-info">This revision is locked (status {STATUS_LABELS[r.revision.status as RevisionStatus]}). Approved content is immutable; changes require a new revision.</div>}
      {pending > 0 && <div className="pm-alert pm-alert-warn">{pending} criterion/interval item(s) are {PENDING_LABEL}. No compliance conclusion may be drawn from them.</div>}
      <div className="pm-split">
        <ContentView content={c} refName={id => refs.get(id)?.code ?? "unresolved reference"} />
        <div className="pm-grid">
          <Panel title="Revision">
            <dl className="pm-grid c2" style={{ margin: 0, fontSize: 13 }}>
              <div><dt className="pm-muted">Revision</dt><dd>{r.revision.revisionNumber}</dd></div>
              <div><dt className="pm-muted">Author</dt><dd>{r.revision.authorName}</dd></div>
              <div><dt className="pm-muted">Technical reviewer</dt><dd>{r.revision.technicalReviewerName ?? "—"}</dd></div>
              <div><dt className="pm-muted">QA</dt><dd>{r.revision.qaApproverName ?? "—"}</dd></div>
              <div><dt className="pm-muted">Approved</dt><dd>{fmtDate(r.revision.approvedAt)}</dd></div>
              <div><dt className="pm-muted">Effective</dt><dd>{fmtDate(r.revision.effectiveDate)}</dd></div>
              <div><dt className="pm-muted">Next review</dt><dd>{fmtDate(r.revision.nextReviewDate)}</dd></div>
              <div><dt className="pm-muted">Reason</dt><dd>{r.revision.changeReason}</dd></div>
            </dl>
            <div className="pm-muted pm-mono" style={{ marginTop: 8 }}>SHA-256 {r.revision.contentHash}</div>
          </Panel>
          <Panel title="Linked references">
            {!r.references.length ? <div className="pm-empty">None</div> : (
              <ul className="pm-list">{r.references.map(x => <li key={x.id}><span><strong>{x.code}</strong> {x.title}{x.expired && <span className="pm-badge pm-tone-bad"> Expired</span>}</span><span className={`pm-badge ${x.verificationStatus === "verified" ? "pm-tone-ok" : "pm-tone-warn"}`}>{x.verificationStatus}</span></li>)}</ul>
            )}
          </Panel>
          <Panel title="Validation">
            {!r.issues.length ? <div className="pm-alert pm-alert-ok">No content issues.</div> : (
              <ul className="pm-list">{r.issues.map((i, k) => <li key={k}><span className={i.severity === "error" ? "pm-diff-removed" : "pm-diff-modified"}>{i.severity.toUpperCase()}: {i.message}</span></li>)}</ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

const limitText = (c: ProtocolContent["sections"][number]["tests"][number]["criteria"][number]) => {
  const v = (x: number | null) => (x === null ? "not established" : String(x));
  const u = c.unit ? ` ${c.unit}` : "";
  switch (c.comparison) {
    case "between": return `${v(c.lower)} – ${v(c.upper)}${u}`;
    case "<=": case "<": return `${c.comparison} ${v(c.upper)}${u}`;
    case ">=": case ">": return `${c.comparison} ${v(c.lower)}${u}`;
    case "abs<=": return `|x| ≤ ${v(c.tolerance ?? c.upper)}${u}`;
    case "target±tolerance": return `${v(c.target)} ± ${v(c.tolerance)}${u}`;
    default: return COMPARISONS.find(x => x.id === c.comparison)?.label ?? c.comparison;
  }
};

export function ContentView({ content, refName }: { content: ProtocolContent; refName: (id: string) => string }) {
  const id = content.identification;
  return (
    <Panel title="Protocol content">
      <p className="pm-muted" style={{ marginTop: 0 }}>{id.description}</p>
      <div className="pm-grid c3" style={{ fontSize: 13 }}>
        <div><span className="pm-muted">Stages</span><div>{content.stages.join(", ") || "—"}</div></div>
        <div><span className="pm-muted">Intended use</span><div>{id.intendedUse || "—"}</div></div>
        <div><span className="pm-muted">Risk</span><div>{content.risk.overall || "not assessed"}</div></div>
        {content.equipmentLinks.map(l => <div key={l.instrumentKey}><span className="pm-muted">Linked equipment</span><div>{l.instrumentId} · S/N {l.serialNumber}</div></div>)}
      </div>
      {content.gaps.map(g => (
        <div className="pm-gap" key={g.key} style={{ marginTop: 12 }}>
          <strong>Technical gap: {g.title}</strong>
          <div className="pm-muted">{g.description}</div>
          <div className="pm-gap-specs">{g.specifications.map((s, i) => <div key={i}><strong>{s.displayValue || `${s.value ?? "—"} ${g.unit}`}</strong><div>{s.label}</div><div className="pm-muted">{SOURCE_CLASSES.find(x => x.id === s.sourceClass)?.label}{s.referenceId ? ` · ${refName(s.referenceId)}` : ""}</div></div>)}</div>
          {g.specifications.length === 2 && g.specifications.every(s => s.value !== null) && <div className="pm-muted">Difference: {Math.abs((g.specifications[0].value as number) - (g.specifications[1].value as number)).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} {g.unit}</div>}
          <div><span className="pm-muted">Technical assessment:</span> {g.assessment || <em>not documented</em>}</div>
          {g.claimRestriction && <div><span className="pm-muted">Claim restriction:</span> {g.claimRestriction}</div>}
        </div>
      ))}
      {content.sections.map((s, si) => (
        <div key={s.key} style={{ marginTop: 14 }}>
          <h3>{si + 1}. {s.title} {s.stage && <span className="pm-badge pm-tone-neutral">{s.stage}</span>} {!s.required && <span className="pm-badge pm-tone-muted">optional</span>}</h3>
          {s.description && <p className="pm-muted" style={{ margin: "0 0 6px" }}>{s.description}</p>}
          {s.tests.map(t => (
            <details key={t.key} className="pm-card is-test" style={{ marginBottom: 6 }}>
              <summary className="pm-card-head"><strong>{t.name}</strong><span className="pm-muted">{t.dataType} · {t.readingsRequired || 0} reading(s){t.levels.length ? ` · ${t.levels.length} level(s)` : ""}{t.dependency.type !== "independent" ? ` · ${t.dependency.type} on ${t.dependency.testKey}` : ""}</span></summary>
              {t.objective && <div><span className="pm-muted">Objective:</span> {t.objective}</div>}
              {t.procedure && <div style={{ whiteSpace: "pre-wrap" }}><span className="pm-muted">Procedure:</span> {t.procedure}</div>}
              {t.calculations.length > 0 && <div><span className="pm-muted">Calculations:</span> {t.calculations.map(c => `${c.label || c.key} (${c.kind === "custom" ? c.formula : c.kind})`).join("; ")}</div>}
              {t.criteria.map(c => (
                <div key={c.key} className="pm-card is-criterion">
                  <div className="pm-card-head"><strong>{c.parameter}{c.levelKey ? ` [${c.levelKey}]` : ""}: {limitText(c)}</strong><PendingTag verified={c.verificationStatus === "verified"} /></div>
                  {c.requirement && <div>{c.requirement}</div>}
                  <div className="pm-muted">{SOURCE_CLASSES.find(x => x.id === c.sourceClass)?.label}{c.referenceId ? ` · ${refName(c.referenceId)} ${c.referenceClause}` : ""}{c.justification ? ` · Justification: ${c.justification}` : ""}</div>
                  {c.conflictNote && <div className="pm-diff-removed">⚠ {c.conflictNote}</div>}
                </div>
              ))}
            </details>
          ))}
        </div>
      ))}
      {content.intervals.length > 0 && (
        <>
          <h3>Intervals</h3>
          <ul className="pm-list">{content.intervals.map(i => <li key={i.key}><span><strong>{i.activity}</strong>: {i.unit === "event" ? i.event : `${i.value} ${i.unit}`} <span className="pm-muted">— {i.justification}</span></span><PendingTag verified={i.verificationStatus === "verified"} /></li>)}</ul>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------ Review & approval (§14–15) ------------------------------ */

const NEEDS_ATTESTATION: WorkflowAction[] = ["complete-technical-review", "qa-approve"];

export function ReviewPanel({ r, user }: { r: RevisionDetailDto; user: PmUser }) {
  const utils = trpc.useUtils();
  const transition = trpc.protocols.transition.useMutation();
  const addComment = trpc.protocols.addComment.useMutation();
  const resolve = trpc.protocols.resolveComment.useMutation();
  const gapDecision = trpc.protocols.recordGapDecision.useMutation();
  const [comment, setComment] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [attest, setAttest] = useState(false);
  const [newComment, setNewComment] = useState({ targetType: "protocol" as const, targetKey: "", body: "" });
  const [decision, setDecision] = useState<Record<string, { decision: string; rationale: string }>>({});
  const refresh = () => Promise.all([utils.protocols.revision.invalidate(), utils.protocols.detail.invalidate(), utils.protocols.list.invalidate(), utils.protocols.dashboard.invalidate(), utils.protocols.notifications.invalidate()]);
  const run = async (action: WorkflowAction) => {
    const rule = TRANSITIONS[action];
    if (rule.commentRequired && comment.trim().length < 3) return toast.error(`"${rule.label}" requires a comment / reason`);
    if (NEEDS_ATTESTATION.includes(action) && !attest) return toast.error("Confirm the attestation first");
    if (rule.signatureMeaning && !window.confirm(`Electronic signature\n\nAction: ${rule.label}\nMeaning: ${rule.signatureMeaning}\nSigned by: ${user.name ?? user.id}\n\nThis is recorded with your identity, date/time and the content hash of revision ${r.revision.revisionNumber}.`)) return;
    try {
      await transition.mutateAsync({ revisionId: r.revision.id, expectedRowVersion: r.revision.rowVersion, action, comment: comment.trim() || undefined, effectiveDate: action === "release" ? effectiveDate : undefined, attestation: NEEDS_ATTESTATION.includes(action) ? attest : undefined });
      setComment("");
      setAttest(false);
      toast.success(`${rule.label}: done`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      await refresh();
    }
  };
  const status = r.revision.status as RevisionStatus;
  const inTechReview = status === "technical-review-in-progress" && r.revision.technicalReviewerUserId === user.id;
  const inQaReview = status === "qa-review-in-progress" && r.revision.qaApproverUserId === user.id;
  const decisions = new Map(r.gapDecisions.map(g => [g.gapKey, g]));
  const timeline = useMemo(() => r.approvals, [r.approvals]);
  return (
    <div className="pm-split">
      <div className="pm-grid">
        <Panel title={<>Workflow — {STATUS_LABELS[status]}</>}>
          {r.availableActions.length === 0 ? (
            <div className="pm-alert pm-alert-info">No workflow action is available to you for this revision (state, duty or segregation-of-duties rules).</div>
          ) : (
            <div className="pm-grid">
              <Field label="Comment / reason" hint="Required for returns, approval, rejection and retirement; stored with the signature."><textarea value={comment} onChange={e => setComment(e.target.value)} /></Field>
              {r.availableActions.some(a => NEEDS_ATTESTATION.includes(a as WorkflowAction)) && (
                <label className="pm-check"><input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} /> I attest that I have reviewed the complete revision content, references, acceptance criteria and calculations, and that this decision is mine.</label>
              )}
              {r.availableActions.includes("release") && <Field label="Effective date (release)"><input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></Field>}
              <div className="pm-row">
                {r.availableActions.map(a => {
                  const action = a as WorkflowAction;
                  const blocked = action === "qa-approve" && r.approvalBlockers.length > 0;
                  return <button key={a} type="button" disabled={transition.isPending || blocked} className={`pm-btn ${["qa-reject", "retire"].includes(a) ? "danger" : ["qa-approve", "release", "complete-technical-review", "submit-technical-review", "submit-qa-review"].includes(a) ? "primary" : ""}`} onClick={() => run(action)} title={blocked ? "Blocked — see approval blockers" : ""}>{TRANSITIONS[action].label}</button>;
                })}
              </div>
            </div>
          )}
          {r.approvalBlockers.length > 0 && ["qa-review-pending", "qa-review-in-progress", "technically-reviewed", "technical-review-in-progress", "draft", "technical-review-pending"].includes(status) && (
            <div className="pm-alert pm-alert-warn" style={{ marginTop: 10 }}>
              <div><strong>QA approval blockers ({r.approvalBlockers.length})</strong><ul>{r.approvalBlockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
            </div>
          )}
        </Panel>
        {r.revision.content.gaps.length > 0 && (
          <Panel title="Technical gaps — reviewer decisions">
            {r.revision.content.gaps.map(g => {
              const existing = decisions.get(g.key);
              const draft = decision[g.key] ?? { decision: GAP_DECISIONS[0].id, rationale: "" };
              return (
                <div key={g.key} className="pm-gap" style={{ marginBottom: 8 }}>
                  <strong>{g.title}</strong>
                  <div className="pm-gap-specs">{g.specifications.map((s, i) => <div key={i}><strong>{s.displayValue || s.value}</strong><div>{s.label}</div></div>)}</div>
                  <div><span className="pm-muted">Author's assessment:</span> {g.assessment || <em className="pm-diff-removed">not documented — return the draft to the author</em>}</div>
                  {existing ? <div className="pm-alert pm-alert-info"><div><strong>Decision:</strong> {GAP_DECISIONS.find(x => x.id === existing.decision)?.label ?? existing.decision}<br />{existing.rationale}<div className="pm-muted">{existing.reviewerName} · {fmtDate(existing.createdAt, true)}</div></div></div> : <div className="pm-muted">No reviewer decision recorded.</div>}
                  {inTechReview && (
                    <div className="pm-grid c2">
                      <Field label="Decision"><select value={draft.decision} onChange={e => setDecision(m => ({ ...m, [g.key]: { ...draft, decision: e.target.value } }))}>{GAP_DECISIONS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
                      <Field label="Rationale (≥ 10 characters)"><textarea value={draft.rationale} onChange={e => setDecision(m => ({ ...m, [g.key]: { ...draft, rationale: e.target.value } }))} /></Field>
                      <div><button type="button" className="pm-btn primary" disabled={gapDecision.isPending} onClick={async () => { try { await gapDecision.mutateAsync({ revisionId: r.revision.id, gapKey: g.key, decision: draft.decision as (typeof GAP_DECISIONS)[number]["id"], rationale: draft.rationale }); toast.success("Gap decision recorded"); } catch (e) { toast.error(errorText(e)); } finally { await refresh(); } }}>{existing ? "Record new decision" : "Record decision"}</button></div>
                    </div>
                  )}
                </div>
              );
            })}
          </Panel>
        )}
        <Panel title={`Review comments (${r.comments.filter(c => c.kind === "comment").length})`}>
          {(inTechReview || inQaReview) && (
            <div className="pm-grid c3" style={{ marginBottom: 10 }}>
              <Field label="Target"><select value={newComment.targetType} onChange={e => setNewComment(n => ({ ...n, targetType: e.target.value as typeof n.targetType }))}>{["protocol", "section", "test", "criterion", "reference", "interval", "gap", "calculation"].map(t => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Target key (optional)"><input value={newComment.targetKey} onChange={e => setNewComment(n => ({ ...n, targetKey: e.target.value }))} placeholder="e.g. pq-accuracy" /></Field>
              <Field label="Comment" wide><textarea value={newComment.body} onChange={e => setNewComment(n => ({ ...n, body: e.target.value }))} /></Field>
              <div><button type="button" className="pm-btn primary" disabled={addComment.isPending || newComment.body.trim().length < 3} onClick={async () => { try { await addComment.mutateAsync({ revisionId: r.revision.id, targetType: newComment.targetType, targetKey: newComment.targetKey || null, body: newComment.body }); setNewComment(n => ({ ...n, body: "" })); } catch (e) { toast.error(errorText(e)); } finally { await refresh(); } }}>Add comment</button></div>
            </div>
          )}
          {!r.comments.filter(c => c.kind === "comment").length ? <div className="pm-empty">No comments.</div> : (
            <ul className="pm-list">
              {r.comments.filter(c => c.kind === "comment").map(c => (
                <li key={c.id}>
                  <div>
                    <div><span className={`pm-badge ${c.status === "open" ? "pm-tone-warn" : "pm-tone-ok"}`}>{c.status}</span> <span className="pm-muted">{c.stage} · {c.targetType}{c.targetKey ? `/${c.targetKey}` : ""} · {c.authorName} · {fmtDate(c.createdAt, true)}</span></div>
                    <div>{c.body}</div>
                    {c.resolutionNote && <div className="pm-muted">Resolved by {c.resolvedByName}: {c.resolutionNote}</div>}
                  </div>
                  {c.status === "open" && (c.authorUserId === user.id || r.editable) && (
                    <button type="button" className="pm-btn small" onClick={async () => { const note = askReason("Resolution note for this comment"); if (!note) return; try { await resolve.mutateAsync({ commentId: c.id, expectedRowVersion: c.rowVersion, note }); } catch (e) { toast.error(errorText(e)); } finally { await refresh(); } }}>Resolve</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Signatures & history">
        {!timeline.length ? <div className="pm-empty">No workflow actions yet.</div> : (
          <div className="pm-timeline">
            {timeline.map(a => (
              <div key={a.id}>
                <strong>{TRANSITIONS[a.action as WorkflowAction]?.label ?? a.action}</strong> — {a.actorName} <span className="pm-muted">({a.actorRole})</span>
                <div className="pm-muted">{fmtDate(a.createdAt, true)} · {STATUS_LABELS[a.fromStatus as RevisionStatus]} → {STATUS_LABELS[a.toStatus as RevisionStatus]}</div>
                {a.signatureMeaning && <div className="pm-muted">Signature meaning: {a.signatureMeaning}</div>}
                {a.comment && <div>“{a.comment}”</div>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------ Revisions / compare / executions / audit ------------------------------ */

function Revisions({ d, user, setNav, onSelect }: { d: ProtocolDetailDto; user: PmUser; setNav: (n: Nav) => void; onSelect: (id: string) => void }) {
  const utils = trpc.useUtils();
  const create = trpc.protocols.createRevision.useMutation();
  const saveTemplate = trpc.protocols.saveTemplate.useMutation();
  const pdf = useProtocolPdf();
  const hasOpen = d.revisions.some(r => !["released", "superseded", "retired", "rejected"].includes(r.status));
  return (
    <Panel
      title={<><History size={16} /> Revision history</>}
      actions={
        <button type="button" className="pm-btn primary" disabled={hasOpen || create.isPending} title={hasOpen ? "Only one open revision is allowed" : ""} onClick={async () => {
          const reason = askReason("Reason for the new revision (what must change and why)");
          if (!reason) return;
          try {
            const r = await create.mutateAsync({ protocolId: d.protocol.id, reason, description: reason });
            await utils.protocols.invalidate();
            toast.success("New draft revision created from the latest released/approved content");
            setNav({ view: "builder", revisionId: r.revisionId });
          } catch (e) { toast.error(errorText(e)); }
        }}>Create new revision</button>
      }
    >
      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead><tr><th>Rev</th><th>Status</th><th>Reason</th><th>Author</th><th>Technical review</th><th>QA approval</th><th>Effective</th><th>Superseded</th><th /></tr></thead>
          <tbody>
            {d.revisions.map(r => (
              <tr key={r.id}>
                <td><strong>{r.revisionNumber}</strong></td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.changeReason}</td>
                <td>{r.authorName}<div className="pm-muted">{fmtDate(r.createdAt)}</div></td>
                <td>{r.technicalReviewerName ?? "—"}<div className="pm-muted">{fmtDate(r.technicalReviewedAt)}</div></td>
                <td>{r.qaApproverName ?? "—"}<div className="pm-muted">{fmtDate(r.approvedAt)}</div></td>
                <td>{fmtDate(r.effectiveDate)}</td>
                <td>{fmtDate(r.supersededAt)}</td>
                <td className="pm-row">
                  <button type="button" className="pm-btn small" onClick={() => onSelect(r.id)}>View</button>
                  <button type="button" className="pm-btn small" onClick={() => pdf(r.id, user.name ?? `user ${user.id}`)}><Download size={12} /> PDF</button>
                  <button type="button" className="pm-btn small ghost" onClick={async () => {
                    const name = window.prompt("Template name (structure only — limits, references and verification are removed)", `${d.protocol.title} structure`);
                    if (!name) return;
                    try { await saveTemplate.mutateAsync({ revisionId: r.id, name, templateCategory: d.protocol.equipmentCategory || "Custom Equipment Categories", description: `From ${d.protocol.protocolNumber} rev ${r.revisionNumber}` }); await utils.protocols.templates.invalidate(); toast.success("Template saved (structure only)"); } catch (e) { toast.error(errorText(e)); }
                  }}>Save as template</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Compare({ d }: { d: ProtocolDetailDto }) {
  const sorted = [...d.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const [from, setFrom] = useState(sorted[Math.max(0, sorted.length - 2)]?.id ?? "");
  const [to, setTo] = useState(sorted[sorted.length - 1]?.id ?? "");
  const q = trpc.protocols.compare.useQuery({ fromRevisionId: from, toRevisionId: to }, { enabled: !!from && !!to && from !== to });
  return (
    <Panel title={<><GitCompare size={16} /> Compare revisions</>}>
      <div className="pm-grid c2">
        <Field label="From"><select value={from} onChange={e => setFrom(e.target.value)}>{sorted.map(r => <option key={r.id} value={r.id}>Rev {r.revisionNumber} — {r.status}</option>)}</select></Field>
        <Field label="To"><select value={to} onChange={e => setTo(e.target.value)}>{sorted.map(r => <option key={r.id} value={r.id}>Rev {r.revisionNumber} — {r.status}</option>)}</select></Field>
      </div>
      {sorted.length < 2 ? <div className="pm-empty">Only one revision exists.</div> : from === to ? <div className="pm-empty">Select two different revisions.</div> : q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : !q.data?.entries.length ? <div className="pm-empty">No content differences.</div> : (
        <ul className="pm-list" style={{ marginTop: 12 }}>
          {q.data.entries.map((e, i) => (
            <li key={i} style={{ display: "block" }}>
              <strong className={`pm-diff-${e.change}`}>{e.change.toUpperCase()}</strong> <span className="pm-badge pm-tone-neutral">{e.entity}</span> {e.label} <span className="pm-muted pm-mono">{e.path}</span>
              {(e.before !== undefined || e.after !== undefined) && (
                <div className="pm-grid c2">
                  <pre className="pm-pre">{e.before === undefined ? "—" : JSON.stringify(e.before, null, 2)}</pre>
                  <pre className="pm-pre">{e.after === undefined ? "—" : JSON.stringify(e.after, null, 2)}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Executions({ d }: { d: ProtocolDetailDto }) {
  return (
    <Panel title="Executions of this protocol">
      {!d.executions.length ? <div className="pm-empty">No executions recorded. Only released revisions can be executed.</div> : (
        <div className="pm-table-wrap"><table className="pm-table"><thead><tr><th>Date</th><th>Revision</th><th>Equipment</th><th>Calculated outcome</th><th>By</th><th>Linked record</th></tr></thead><tbody>
          {d.executions.map(e => <tr key={e.id}><td>{fmtDate(e.executedAt, true)}</td><td>Rev {e.revisionNumber}</td><td>{e.equipmentId} ({e.instrumentKey})</td><td><ResultBadge result={e.overallResult} /></td><td>{e.executedByName}</td><td>{e.validationRecordId ?? "—"}</td></tr>)}
        </tbody></table></div>
      )}
    </Panel>
  );
}

function Audit({ d }: { d: ProtocolDetailDto }) {
  return (
    <Panel title="Audit trail (append-only)">
      {!d.audit.length ? <div className="pm-empty">No events.</div> : (
        <div className="pm-table-wrap"><table className="pm-table"><thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Record</th><th>Reason</th><th>Previous → new</th></tr></thead><tbody>
          {d.audit.map(a => (
            <tr key={a.id}>
              <td>{fmtDate(a.createdAt, true)}</td>
              <td>{a.actorName}<div className="pm-muted">{a.actorRole}</div></td>
              <td>{a.action}</td>
              <td>{a.entityType}{a.revisionNumber ? ` · rev ${a.revisionNumber}` : ""}</td>
              <td>{a.reason ?? "—"}</td>
              <td>
                <details><summary className="pm-muted">values</summary><div className="pm-grid c2"><pre className="pm-pre">{JSON.stringify(a.previousValue, null, 2)}</pre><pre className="pm-pre">{JSON.stringify(a.newValue, null, 2)}</pre></div></details>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </Panel>
  );
}
