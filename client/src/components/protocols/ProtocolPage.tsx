/**
 * «البروتوكول» — the single Protocol page (replaces the old Protocol
 * Management / Protocol Setup screens).
 *
 *  • Board: one card per laboratory instrument (fixed order, 3/2/1 grid),
 *    linked to the existing Equipment Master records (no duplicates).
 *  • Details: equipment information, revision dropdown with full metadata,
 *    tests / criteria / formulas / graphs / references of the selected
 *    revision (read-only unless it is a Draft).
 *  • Edit always works on a Draft — editing an approved protocol creates a
 *    new Draft copied from the active approved revision.
 *  • Approve: Draft → Approved (active) in one step, Quality Manager only,
 *    password-signed; the previous approved revision becomes Superseded.
 * Every rule is enforced by the backend; the UI only reflects it.
 */
import { useEffect, useMemo, useState } from "react";
import { BookMarked, CheckCircle2, ClipboardList, FileDown, FilePlus2, LayoutGrid, PencilLine, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { GRAPH_TYPES, SOURCE_CLASSES } from "@shared/protocols/model";
import { simpleRevisionStatus } from "@shared/protocols/protocolCards";
import { ErrorBox, Field, Loading, Panel, SignatureBox, askReason, errorText, fmtDate, type Nav, type PmUser, type RevisionDetailDto } from "./common";
import { ContentView, useProtocolPdf } from "./ProtocolDetail";
import { ProtocolBuilder } from "./ProtocolBuilder";
import { ReferenceLibrary } from "./ReferenceLibrary";
import { ModuleSettings } from "./ModuleSettings";
import "./protocols.css";

type Lang = "ar" | "en";
type View =
  | { view: "board" }
  | { view: "details"; instrumentKey: string; revisionId?: string }
  | { view: "builder"; instrumentKey: string; revisionId: string }
  | { view: "references" }
  | { view: "settings" };

const rev2 = (n: number) => `Rev.${String(n).padStart(2, "0")}`;
const TONE: Record<string, string> = { approved: "pm-tone-ok", draft: "pm-tone-warn", superseded: "pm-tone-muted", other: "pm-tone-neutral" };

function SimpleStatus({ status }: { status: string }) {
  const s = simpleRevisionStatus(status);
  return <span className={`pm-badge ${TONE[s.tone]}`}>{s.label}</span>;
}

export function ProtocolPage({ user, language }: { user: PmUser; language: Lang }) {
  const [view, setView] = useState<View>({ view: "board" });
  const status = trpc.protocols.moduleStatus.useQuery(undefined, { retry: false });
  const me = trpc.protocols.me.useQuery(undefined, { retry: false });
  const ar = language === "ar";

  if (status.isLoading) return <div className="pm-root"><Loading label="Checking the protocol database…" /></div>;
  if (status.error || (status.data && !status.data.ok))
    return (
      <div className="pm-root">
        <ErrorBox>
          <strong>The Protocol page is not available.</strong>
          <div>{status.error ? errorText(status.error) : `Missing database objects: ${status.data?.missing.join(", ")}`}</div>
          <div>Apply <code>server/sql/protocol_management_migration.sql</code> and then <code>server/sql/protocol_v4_simplified_approval_reset.sql</code> in the Supabase SQL Editor, then reload.</div>
        </ErrorBox>
      </div>
    );

  const tab = view.view === "details" || view.view === "builder" ? "board" : view.view;
  const tabs: Array<{ id: "board" | "references" | "settings"; label: string; icon: typeof LayoutGrid }> = [
    { id: "board", label: ar ? "البروتوكولات" : "Protocols", icon: LayoutGrid },
    { id: "references", label: ar ? "المراجع" : "Reference Library", icon: BookMarked },
    { id: "settings", label: ar ? "الصلاحيات وسجل التدقيق" : "Roles & audit trail", icon: Settings2 },
  ];
  return (
    <div className="pm-root page-enter">
      <section className="page-topline">
        <div>
          <span className="eyebrow">PROTOCOL</span>
          <h1>{ar ? "البروتوكول" : "Protocol"}</h1>
          <p>{ar ? "بروتوكول واحد لكل جهاز، بإصدارات (Revisions) واعتماد من مدير الجودة. البروتوكول المعتمد هو الذي يُستخدم في التحقق الجديد." : "One protocol per instrument, with controlled revisions and Quality Manager approval. The approved revision drives New Validation."}</p>
        </div>
        <div className="page-topline-icon"><ClipboardList size={26} /></div>
      </section>
      <nav className="pm-tabs" aria-label="Protocol sections">
        {tabs.map(t => (
          <button key={t.id} type="button" className={tab === t.id ? "is-active" : ""} onClick={() => setView({ view: t.id } as View)}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </nav>
      {view.view === "board" && <Board ar={ar} open={instrumentKey => setView({ view: "details", instrumentKey })} />}
      {view.view === "details" && <Details key={view.instrumentKey} instrumentKey={view.instrumentKey} initialRevisionId={view.revisionId} user={user} ar={ar} setView={setView} />}
      {view.view === "builder" && <BuilderWrapper instrumentKey={view.instrumentKey} revisionId={view.revisionId} setView={setView} />}
      {view.view === "references" && <ReferenceLibrary duties={me.data?.duties ?? []} />}
      {view.view === "settings" && <ModuleSettings user={user} duties={me.data?.duties ?? []} storage={me.data?.storage ?? ""} />}
    </div>
  );
}

/* ------------------------------ Board ------------------------------ */

function Board({ ar, open }: { ar: boolean; open: (instrumentKey: string) => void }) {
  const utils = trpc.useUtils();
  const board = trpc.protocols.board.useQuery();
  const register = trpc.protocols.registerPackageEquipment.useMutation();
  if (board.isLoading) return <Loading />;
  if (board.error) return <ErrorBox error={board.error} />;
  const { cards, permissions } = board.data!;
  return (
    <div className="pm-grid">
      <div className="pm-row pm-muted" style={{ fontSize: 13 }}>
        <span>{ar ? "صلاحياتك:" : "Your permissions:"}</span>
        <span className={`pm-badge ${permissions.canEdit ? "pm-tone-ok" : "pm-tone-muted"}`}>Protocol editor</span>
        <span className={`pm-badge ${permissions.canApprove ? "pm-tone-ok" : "pm-tone-muted"}`}>Quality Manager (approve)</span>
        <span className={`pm-badge ${permissions.canExecute ? "pm-tone-ok" : "pm-tone-muted"}`}>Validation</span>
      </div>
      <div className="pm-equipment-grid">
        {cards.map((c, i) => {
          const p = c.protocol;
          const body = (
            <>
              <span className="pm-card-index">{String(i + 1).padStart(2, "0")}</span>
              <strong>{c.title}</strong>
              <span className="pm-muted" dir="rtl" style={{ textAlign: "start" }}>{c.titleAr}</span>
              {c.equipment ? (
                <span className="pm-muted">{c.equipment.identity.instrumentId} · {c.equipment.identity.manufacturer} {c.equipment.identity.model} · S/N {c.equipment.identity.serialNumber}</span>
              ) : (
                <span className="pm-badge pm-tone-bad">Not registered in the Equipment Master</span>
              )}
              <div className="pm-row">
                {!p && c.equipment && <span className="pm-badge pm-tone-neutral">No protocol yet</span>}
                {p && (p.activeRevision ? <span className="pm-badge pm-tone-ok">{p.number} {rev2(p.activeRevision.revisionNumber)} — Approved (Active)</span> : <span className="pm-badge pm-tone-neutral">{p.number} — not approved</span>)}
                {p?.draftRevision && <span className="pm-badge pm-tone-warn">Draft {rev2(p.draftRevision.revisionNumber)}</span>}
              </div>
            </>
          );
          if (c.equipment)
            return (
              <button key={c.cardKey} type="button" className="pm-equipment-card" onClick={() => open(c.equipment!.instrumentKey)}>
                {body}
              </button>
            );
          return (
            <div key={c.cardKey} className="pm-equipment-card" style={{ cursor: "default" }}>
              {body}
              {permissions.canEdit && (
                <button type="button" className="pm-btn small" disabled={register.isPending} onClick={async () => {
                  try {
                    await register.mutateAsync();
                    await utils.protocols.invalidate();
                    toast.success("Package equipment registered in the Equipment Master (existing records were not modified)");
                  } catch (e) {
                    toast.error(errorText(e));
                  }
                }}>{register.isPending ? "Registering…" : "Register equipment record"}</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ Details ------------------------------ */

function Details({ instrumentKey, initialRevisionId, user, ar, setView }: { instrumentKey: string; initialRevisionId?: string; user: PmUser; ar: boolean; setView: (v: View) => void }) {
  const q = trpc.protocols.forEquipment.useQuery({ instrumentKey });
  const [revisionId, setRevisionId] = useState<string | undefined>(initialRevisionId);
  const revisions = useMemo(() => [...(q.data?.revisions ?? [])].sort((a, b) => b.revisionNumber - a.revisionNumber), [q.data]);
  useEffect(() => {
    if (!revisions.length) return;
    if (revisionId && revisions.some(r => r.id === revisionId)) return;
    setRevisionId((revisions.find(r => r.status === "released") ?? revisions[0]).id);
  }, [revisions, revisionId]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const eq = d.equipment!;
  const idn = eq.identity;
  const selected = revisions.find(r => r.id === revisionId) ?? null;
  return (
    <div className="pm-grid">
      <div className="pm-row">
        <button type="button" className="pm-btn" onClick={() => setView({ view: "board" })}>← {ar ? "كل الأجهزة" : "All instruments"}</button>
      </div>
      <Panel title={<>{d.card?.title ?? idn.nameEn} <span className="pm-muted" style={{ fontWeight: 400 }}>— {idn.instrumentId}</span></>} actions={d.protocol ? <strong>{d.protocol.number}</strong> : undefined}>
        <div className="pm-meta">
          <div><span>Equipment ID</span>{idn.instrumentId}</div>
          <div><span>Name</span>{idn.nameEn}{idn.nameAr ? <> / <bdi>{idn.nameAr}</bdi></> : null}</div>
          <div><span>Manufacturer</span>{idn.manufacturer || "—"}</div>
          <div><span>Model</span>{idn.model || "—"}</div>
          <div><span>Serial number</span>{idn.serialNumber || "—"}</div>
          <div><span>SOP / Form</span>{idn.sopNumber || "—"} / {idn.formNumber || "—"}</div>
          <div><span>Equipment status</span>{eq.status}</div>
        </div>
      </Panel>
      {!d.protocol ? (
        <CreateProtocol instrumentKey={instrumentKey} canEdit={d.permissions.canEdit} equipmentId={idn.instrumentId} ar={ar} onCreated={revisionId => setView({ view: "builder", instrumentKey, revisionId })} />
      ) : (
        <>
          <Panel
            title="Protocol revisions"
            actions={
              <label className="pm-row" style={{ gap: 6 }}>
                <span className="pm-muted">Revision</span>
                <select className="pm-input" value={revisionId ?? ""} onChange={e => setRevisionId(e.target.value)} aria-label="Select revision">
                  {revisions.map(r => <option key={r.id} value={r.id}>{rev2(r.revisionNumber)} — {simpleRevisionStatus(r.status).label}</option>)}
                </select>
              </label>
            }
          >
            {selected && (
              <div className="pm-meta">
                <div><span>Revision number</span>{rev2(selected.revisionNumber)}</div>
                <div><span>Status</span><SimpleStatus status={selected.status} /></div>
                <div><span>Creation date</span>{fmtDate(selected.createdAt, true)}</div>
                <div><span>Created by</span>{selected.authorName ?? "—"}</div>
                <div><span>Last modified</span>{fmtDate(selected.modifiedAt, true)}</div>
                <div><span>Modified by</span>{selected.modifiedBy ?? "—"}</div>
                <div><span>Approval date</span>{selected.approvedAt ? fmtDate(selected.approvedAt, true) : "—"}</div>
                <div><span>Approved by</span>{selected.approvedAt ? (selected.qaApproverName ?? selected.releasedByName ?? "—") : "—"}</div>
                <div style={{ gridColumn: "1 / -1" }}><span>Revision notes</span>{selected.changeReason || selected.revisionDescription || "—"}</div>
              </div>
            )}
          </Panel>
          {selected && <RevisionBody key={selected.id} revisionId={selected.id} protocolId={d.protocol.id} instrumentKey={instrumentKey} permissions={d.permissions} hasDraft={!!d.protocol.draftRevision} user={user} setView={setView} onChanged={id => { setRevisionId(id); void q.refetch(); }} />}
        </>
      )}
    </div>
  );
}

function CreateProtocol({ instrumentKey, canEdit, equipmentId, ar, onCreated }: { instrumentKey: string; canEdit: boolean; equipmentId: string; ar: boolean; onCreated: (revisionId: string) => void }) {
  const utils = trpc.useUtils();
  const create = trpc.protocols.createForEquipment.useMutation();
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  if (!canEdit)
    return <div className="pm-alert pm-alert-info"><div>{ar ? "لا يوجد بروتوكول لهذا الجهاز بعد. يقوم محرر البروتوكولات المخوّل بإنشائه." : "No protocol exists for this equipment yet. An Authorized Protocol Editor must create it."}</div></div>;
  return (
    <Panel title={<><FilePlus2 size={15} /> Create the protocol of {equipmentId}</>}>
      <p className="pm-muted" style={{ marginTop: 0 }}>Creates an empty Draft revision (Rev.01) linked to this equipment record. Tests, acceptance criteria, formulas, graphs and references are then entered manually from the supplied sources — nothing is pre-filled or invented.</p>
      <div className="pm-grid c3">
        <Field label="Protocol number *"><input value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. CAL-QC-POL-001" /></Field>
        <Field label="Title *"><input value={title} onChange={e => setTitle(e.target.value)} /></Field>
        <Field label="Revision notes"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason / description" /></Field>
      </div>
      <div className="pm-row" style={{ marginTop: 10 }}>
        <button type="button" className="pm-btn primary" disabled={create.isPending || number.trim().length < 2 || title.trim().length < 3} onClick={async () => {
          try {
            const r = await create.mutateAsync({ instrumentKey, number: number.trim(), title: title.trim(), reason: reason.trim() });
            await utils.protocols.invalidate();
            toast.success("Protocol created as Draft Rev.01");
            onCreated(r.revisionId);
          } catch (e) {
            toast.error(errorText(e));
          }
        }}>{create.isPending ? "Creating…" : "Create Draft and open editor"}</button>
      </div>
    </Panel>
  );
}

function RevisionBody({ revisionId, protocolId, instrumentKey, permissions, hasDraft, user, setView, onChanged }: { revisionId: string; protocolId: string; instrumentKey: string; permissions: { canEdit: boolean; canApprove: boolean }; hasDraft: boolean; user: PmUser; setView: (v: View) => void; onChanged: (revisionId: string) => void }) {
  const utils = trpc.useUtils();
  const q = trpc.protocols.revision.useQuery({ revisionId });
  const edit = trpc.protocols.edit.useMutation();
  const pdf = useProtocolPdf();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  const rv = r.revision;
  const isDraft = rv.status === "draft";
  const snapshotRefs = (rv.referenceSnapshot as { references?: typeof r.references } | null)?.references;
  const references = snapshotRefs ?? r.references;
  const refName = (id: string) => {
    const x = references.find(y => y.id === id);
    return x ? `${x.code}${x.edition ? ` (${x.edition})` : ""}` : id;
  };
  const tests = rv.content.sections.flatMap(s => s.tests);
  const graphCount = tests.reduce((n, t) => n + (t.graphs?.length ?? 0), 0);

  const startEdit = async () => {
    const reason = askReason("Reason for the new revision (revision notes)");
    if (!reason) return;
    try {
      const res = await edit.mutateAsync({ protocolId, reason });
      await utils.protocols.invalidate();
      toast.success(res.created ? `Draft ${rev2(res.revisionNumber)} created from the approved revision — the approved revision is unchanged` : `Opening the existing Draft ${rev2(res.revisionNumber)}`);
      setView({ view: "builder", instrumentKey, revisionId: res.revisionId });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <>
      <Panel
        title={<>{rev2(rv.revisionNumber)} <SimpleStatus status={rv.status} /> {rv.locked && <span className="pm-badge pm-tone-muted">Read-only</span>}</>}
        actions={
          <div className="pm-row">
            {isDraft && r.editable && <button type="button" className="pm-btn primary" onClick={() => setView({ view: "builder", instrumentKey, revisionId })}><PencilLine size={14} /> Edit draft</button>}
            {!isDraft && permissions.canEdit && <button type="button" className="pm-btn primary" disabled={edit.isPending} onClick={startEdit} title={hasDraft ? "A draft already exists — it will be opened" : "Creates a new Draft copied from the approved revision"}><PencilLine size={14} /> {hasDraft ? "Open existing draft" : "Edit (new revision)"}</button>}
            <button type="button" className="pm-btn" onClick={() => pdf(revisionId, user.name ?? `user ${user.id}`)}><FileDown size={14} /> Protocol PDF</button>
          </div>
        }
      >
        <div className="pm-muted">
          {tests.length} test(s) · {tests.reduce((n, t) => n + t.criteria.length, 0)} acceptance criteria · {tests.reduce((n, t) => n + t.calculations.length, 0)} formula(s) · {graphCount} graph(s) · {references.length} reference(s)
          {rv.locked ? " — approved and superseded revisions cannot be modified; Edit creates a new Draft." : ""}
        </div>
      </Panel>
      {isDraft && <ApprovePanel r={r} canApprove={permissions.canApprove} user={user} onApproved={() => { void utils.protocols.invalidate(); onChanged(revisionId); }} />}
      <ContentView content={rv.content} refName={refName} />
      <Panel title="Formulas and graphs per test">
        {!tests.length ? <div className="pm-empty">No tests in this revision.</div> : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>Test</th><th>Readings</th><th>Formulas / calculations</th><th>Acceptance criteria (source)</th><th>Graphs</th></tr></thead>
              <tbody>
                {tests.map(t => (
                  <tr key={t.key}>
                    <td><strong>{t.name}</strong><div className="pm-muted pm-mono">{t.key}</div></td>
                    <td>{t.readingsRequired}{t.levels.length ? ` × ${t.levels.length} levels` : ""}</td>
                    <td>{t.calculations.length ? t.calculations.map(c => <div key={c.key}>{c.label || c.key}: <span className="pm-mono">{c.kind === "custom" ? c.formula : c.kind}</span></div>) : "—"}</td>
                    <td>{t.criteria.length ? t.criteria.map(c => <div key={c.key}>{c.parameter}: {c.comparison} <span className="pm-muted">({SOURCE_CLASSES.find(s => s.id === c.sourceClass)?.label ?? c.sourceClass}{c.verificationStatus !== "verified" ? " · Needs Source Verification" : ""})</span></div>) : "—"}</td>
                    <td>{t.graphs?.length ? t.graphs.map((g, i) => <div key={i}>{GRAPH_TYPES.find(x => x.id === g.type)?.label ?? g.type}</div>) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="References">
        {!references.length ? <div className="pm-empty">No references linked to this revision.</div> : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>Code</th><th>Title</th><th>Edition / revision</th><th>Chapter / section</th><th>Clause / page</th><th>Verification</th></tr></thead>
              <tbody>
                {references.map(x => (
                  <tr key={x.id}>
                    <td className="pm-mono">{x.code}</td>
                    <td>{x.title}</td>
                    <td>{[x.edition, x.revision].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{"applicableSection" in x ? (x as { applicableSection?: string }).applicableSection || "—" : "—"}</td>
                    <td>{"applicableClause" in x ? (x as { applicableClause?: string }).applicableClause || "—" : "—"}</td>
                    <td>{x.verificationStatus === "verified" ? <span className="pm-badge pm-tone-ok">Verified</span> : <span className="pm-badge pm-tone-warn">Needs Source Verification</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rv.locked && snapshotRefs && <div className="pm-muted" style={{ marginTop: 6 }}>Shown as frozen at approval time.</div>}
      </Panel>
    </>
  );
}

type RevisionData = RevisionDetailDto;

function ApprovePanel({ r, canApprove, user, onApproved }: { r: RevisionData; canApprove: boolean; user: PmUser; onApproved: () => void }) {
  const approve = trpc.protocols.approve.useMutation();
  const [password, setPassword] = useState("");
  const [comment, setComment] = useState("");
  const blockers = r.qmApprovalBlockers;
  return (
    <Panel title={<><CheckCircle2 size={15} /> Approval — Draft → Approved (Active)</>}>
      {blockers.length > 0 ? (
        <div className="pm-alert pm-alert-warn"><div><strong>This draft cannot be approved yet:</strong><ul>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div></div>
      ) : (
        <div className="pm-alert pm-alert-ok"><div>No approval blockers. On approval this revision becomes the active protocol used by New Validation, becomes read-only, and the previous approved revision (if any) becomes Superseded.</div></div>
      )}
      {!canApprove ? (
        <div className="pm-muted" style={{ marginTop: 8 }}>Only a Quality Manager can approve protocol revisions.</div>
      ) : (
        <div className="pm-grid" style={{ marginTop: 8 }}>
          <Field label="Approval comment (optional)" wide><textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} /></Field>
          <SignatureBox meaning="Approved by Quality Manager" signer={user.name ?? `user ${user.id}`} password={password} onPassword={setPassword} detail={`for ${r.protocol.protocolNumber} ${rev2(r.revision.revisionNumber)}`} />
          <div className="pm-row">
            <button type="button" className="pm-btn primary" disabled={approve.isPending || blockers.length > 0 || !password} onClick={async () => {
              if (!window.confirm(`Approve ${r.protocol.protocolNumber} ${rev2(r.revision.revisionNumber)}? It becomes the active protocol and read-only.`)) return;
              try {
                await approve.mutateAsync({ revisionId: r.revision.id, expectedRowVersion: r.revision.rowVersion, comment: comment.trim() || undefined, password });
                setPassword("");
                toast.success(`${rev2(r.revision.revisionNumber)} approved and active`);
                onApproved();
              } catch (e) {
                toast.error(errorText(e));
              }
            }}>{approve.isPending ? "Approving…" : "Approve"}</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ Builder ------------------------------ */

function BuilderWrapper({ instrumentKey, revisionId, setView }: { instrumentKey: string; revisionId: string; setView: (v: View) => void }) {
  const utils = trpc.useUtils();
  // ProtocolBuilder's "Close" navigates to the legacy detail view; map it back to this page.
  const close = (_n: Nav) => {
    void utils.protocols.invalidate();
    setView({ view: "details", instrumentKey, revisionId });
  };
  return <ProtocolBuilder key={revisionId} revisionId={revisionId} setNav={close} />;
}
