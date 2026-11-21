/**
 * Protocol Management — the single, universal module for every equipment
 * protocol (one navigation page, one generic builder; no per-model pages).
 * All authorisation, segregation of duties and state rules are enforced by
 * the backend (server/protocols/service.ts); the UI only reflects them.
 */
import { useMemo, useState } from "react";
import { Bell, BookMarked, ListChecks, ClipboardList, FileStack, FilePlus2, FolderSearch, Gauge, PlayCircle, Settings2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PROTOCOL_TYPES, STATUS_LABELS, type RevisionStatus } from "@shared/protocols/model";
import { ErrorBox, Field, Loading, Panel, StatusBadge, errorText, fmtDate, type Nav, type PmUser, type RegistryFlag } from "./common";
import { ProtocolDetail } from "./ProtocolDetail";
import { ProtocolBuilder } from "./ProtocolBuilder";
import { ReferenceLibrary } from "./ReferenceLibrary";
import { ReviewCenter } from "./ReviewCenter";
import { ExecutionCenter } from "./ExecutionCenter";
import { RunWorkflow } from "./RunWorkflow";
import { SchedulePanel } from "./ExecutionReview";
import { ModuleSettings } from "./ModuleSettings";
import "./protocols.css";

const TABS: Array<{ view: Nav["view"]; label: string; icon: typeof Gauge }> = [
  { view: "dashboard", label: "Dashboard", icon: Gauge },
  { view: "registry", label: "Protocol Registry", icon: FolderSearch },
  { view: "create", label: "Create Protocol", icon: FilePlus2 },
  { view: "review", label: "Review & Approval", icon: ShieldCheck },
  { view: "references", label: "Reference Library", icon: BookMarked },
  { view: "runs", label: "Calibration Runs", icon: ListChecks },
  { view: "executions", label: "Execution History", icon: PlayCircle },
  { view: "documents", label: "Documents", icon: FileStack },
  { view: "settings", label: "Settings", icon: Settings2 },
];

export function ProtocolManagement({ user }: { user: PmUser }) {
  const [nav, setNav] = useState<Nav>({ view: "dashboard" });
  const status = trpc.protocols.moduleStatus.useQuery(undefined, { retry: false });
  const me = trpc.protocols.me.useQuery(undefined, { retry: false });
  const active = nav.view === "detail" || nav.view === "builder" ? "registry" : nav.view;

  if (status.isLoading) return <div className="pm-root"><Loading label="Checking Protocol Management database…" /></div>;
  if (status.error || (status.data && !status.data.ok))
    return (
      <div className="pm-root">
        <ErrorBox>
          <strong>Protocol Management is not available.</strong>
          <div>{status.error ? errorText(status.error) : `Missing database objects: ${status.data?.missing.join(", ")}`}</div>
          <div>Apply <code>server/sql/protocol_management_migration.sql</code> in the Supabase SQL Editor, then reload. No data is stored until the schema exists.</div>
        </ErrorBox>
      </div>
    );

  return (
    <div className="pm-root page-enter">
      <section className="page-topline">
        <div>
          <span className="eyebrow">CENTRALIZED PROTOCOL CONTROL</span>
          <h1>Protocol Management</h1>
          <p>Single source of truth for equipment protocols: sections, tests, acceptance criteria, formulas, references, intervals, reviews and revisions.</p>
        </div>
        <div className="page-topline-icon"><ClipboardList size={26} /></div>
      </section>
      <nav className="pm-tabs" aria-label="Protocol Management sections">
        {TABS.map(t => (
          <button key={t.view} type="button" className={active === t.view ? "is-active" : ""} onClick={() => setNav({ view: t.view } as Nav)}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
        <span className="pm-spacer" />
        <Notifications onOpen={(protocolId, revisionId) => protocolId && setNav({ view: "detail", protocolId, revisionId: revisionId ?? undefined })} />
      </nav>
      {me.data && !me.data.duties.length && <div className="pm-alert pm-alert-info">Read-only access: your role ({user.role}) has no protocol duties.</div>}
      {nav.view === "dashboard" && <Dashboard setNav={setNav} />}
      {nav.view === "registry" && <Registry setNav={setNav} initialFlag={nav.flag} initialStatus={nav.status} />}
      {nav.view === "create" && <CreateProtocol setNav={setNav} canAuthor={!!me.data?.duties.includes("author")} />}
      {nav.view === "detail" && <ProtocolDetail key={nav.protocolId} protocolId={nav.protocolId} initialTab={nav.tab} initialRevisionId={nav.revisionId} user={user} setNav={setNav} />}
      {nav.view === "builder" && <ProtocolBuilder key={nav.revisionId} revisionId={nav.revisionId} setNav={setNav} />}
      {nav.view === "references" && <ReferenceLibrary duties={me.data?.duties ?? []} />}
      {nav.view === "review" && <ReviewCenter user={user} setNav={setNav} />}
      {nav.view === "executions" && <ExecutionCenter user={user} duties={me.data?.duties ?? []} initialRevisionId={nav.revisionId} setNav={setNav} />}
      {nav.view === "runs" && (status.data?.workflowOk === false ? <ErrorBox><strong>Calibration runs need the v3 tables.</strong> Missing: {status.data.workflowMissing.join(", ")}. Re-run <code>server/sql/protocol_management_migration.sql</code> in the Supabase SQL Editor.</ErrorBox> : <RunWorkflow user={user} duties={me.data?.duties ?? []} initialRunId={nav.runId} setNav={setNav} />)}
      {nav.view === "documents" && <Documents setNav={setNav} />}
      {nav.view === "settings" && <ModuleSettings user={user} duties={me.data?.duties ?? []} storage={me.data?.storage ?? ""} />}
    </div>
  );
}

function Notifications({ onOpen }: { onOpen: (protocolId: string | null, revisionId: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const list = trpc.protocols.notifications.useQuery(undefined, { refetchInterval: 60000 });
  const mark = trpc.protocols.markNotificationRead.useMutation({ onSuccess: () => utils.protocols.notifications.invalidate() });
  const unread = list.data?.filter(n => !n.read).length ?? 0;
  return (
    <div className="pm-notify">
      <button type="button" aria-label="Notifications" onClick={() => setOpen(o => !o)}>
        <Bell size={16} /> Notifications
        {unread > 0 && <span className="pm-notify-count">{unread}</span>}
      </button>
      {open && (
        <div className="pm-notify-panel">
          {!list.data?.length ? (
            <div className="pm-empty">No notifications for your duties.</div>
          ) : (
            <ul className="pm-list">
              {list.data.map(n => (
                <li key={n.id} style={{ opacity: n.read ? 0.6 : 1 }}>
                  <button type="button" className="linkish" onClick={() => { if (!n.read) mark.mutate({ notificationId: n.id }); onOpen(n.protocolId, n.revisionId); setOpen(false); }}>
                    {n.message}
                    <div className="pm-muted">{fmtDate(n.createdAt, true)} · {n.kind}</div>
                  </button>
                  {!n.read && <button type="button" className="pm-btn small ghost" onClick={() => mark.mutate({ notificationId: n.id })}>Mark read</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Dashboard (§4) ------------------------------ */

function Dashboard({ setNav }: { setNav: (n: Nav) => void }) {
  const q = trpc.protocols.dashboard.useQuery();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const s = d.stats;
  const tile = (label: string, value: number, target: Nav, tone = "") => (
    <button type="button" className={`pm-stat ${value > 0 ? tone : ""}`} onClick={() => setNav(target)} key={label}>
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
  const reg = (status?: string, flag?: RegistryFlag): Nav => ({ view: "registry", status, flag });
  return (
    <div className="pm-grid">
      <div className="pm-stats">
        {tile("Total protocols", s.total, reg())}
        {tile("Draft", s.draft, reg("draft"))}
        {tile("Pending technical review", s.pendingTechnicalReview, { view: "review" }, "warn")}
        {tile("Technical changes required", s.technicalChangesRequired, reg("technical-changes-required"), "warn")}
        {tile("Pending QA review", s.pendingQa, { view: "review" }, "warn")}
        {tile("QA changes required", s.qaChangesRequired, reg("qa-changes-required"), "warn")}
        {tile("Approved (not released)", s.approved, reg("approved"))}
        {tile("Released", s.released, reg("released"))}
        {tile("Superseded revisions", s.superseded, reg("superseded"))}
        {tile("Retired", s.retired, reg("retired"))}
        {tile("Rejected", s.rejected, reg("rejected"), "bad")}
        {tile("Due for periodic review", s.dueForReview, reg(undefined, "due-for-review"), "warn")}
        {tile("With expired references", s.expiredReferences, reg(undefined, "expired-references"), "bad")}
        {tile("Pending technical verification", s.pendingVerification, reg(undefined, "pending-verification"), "warn")}
        {tile("Open technical gaps", s.openGaps, reg(undefined, "open-gaps"), "bad")}
        {tile("Flagged for review", s.reviewFlagged, reg(undefined, "review-flag"), "warn")}
        {tile("Activities overdue", s.activitiesOverdue, { view: "executions" }, "bad")}
        {tile("Activities due ≤ 30 days", s.activitiesDueSoon, { view: "executions" }, "warn")}
        {tile("Executions awaiting technical review", s.executionsAwaitingReview, { view: "executions" }, "warn")}
        {tile("Executions awaiting QA approval", s.executionsAwaitingApproval, { view: "executions" }, "warn")}
      </div>
      <SchedulePanel setNav={setNav} limit={8} />
      <div className="pm-grid c2">
        <Panel title="Recently created">
          <MiniList items={d.recentlyCreated.map(r => ({ key: r.id, label: `${r.protocolNumber} — ${r.title}`, meta: fmtDate(r.createdAt), badge: r.status, open: () => setNav({ view: "detail", protocolId: r.id }) }))} />
        </Panel>
        <Panel title="Upcoming periodic reviews">
          <MiniList items={d.upcomingReviews.map(r => ({ key: r.id, label: r.protocolNumber, meta: `${r.overdue ? "OVERDUE · " : ""}${fmtDate(r.nextReviewDate)}`, open: () => setNav({ view: "detail", protocolId: r.id }) }))} />
        </Panel>
        <Panel title="Executions awaiting a decision">
          <MiniList items={d.executionsPendingDecision.map(e => ({ key: e.id, label: `${e.protocolNumber} rev ${e.revisionNumber} · ${e.equipmentId ?? e.instrumentKey}`, meta: `${e.reviewStatusLabel} · calculated ${e.overallResult} · ${fmtDate(e.executedAt)}`, open: () => setNav(e.protocolId ? { view: "detail", protocolId: e.protocolId, tab: "executions" } : { view: "executions" }) }))} />
        </Panel>
        <Panel title="Recently approved">
          <MiniList items={d.recentlyApproved.map(r => ({ key: `${r.protocolId}-${r.at}`, label: `${r.protocolNumber} rev ${r.revisionNumber}`, meta: `${r.actorName ?? ""} · ${fmtDate(r.at)}`, open: () => setNav({ view: "detail", protocolId: r.protocolId }) }))} />
        </Panel>
        <Panel title="Recently released">
          <MiniList items={d.recentlyReleased.map(r => ({ key: `${r.protocolId}-${r.at}`, label: `${r.protocolNumber} rev ${r.revisionNumber}`, meta: `${r.actorName ?? ""} · ${fmtDate(r.at)}`, open: () => setNav({ view: "detail", protocolId: r.protocolId }) }))} />
        </Panel>
      </div>
      <Panel title="Unresolved technical issues">
        <MiniList items={d.unresolvedIssues.map((r, i) => ({ key: `${r.protocolId}-${i}`, label: r.protocolNumber, meta: r.issue, open: () => setNav({ view: "detail", protocolId: r.protocolId }) }))} />
      </Panel>
    </div>
  );
}

function MiniList({ items }: { items: Array<{ key: string; label: string; meta?: string; badge?: string; open: () => void }> }) {
  if (!items.length) return <div className="pm-empty">Nothing to show.</div>;
  return (
    <ul className="pm-list">
      {items.map(i => (
        <li key={i.key}>
          <button type="button" className="linkish" onClick={i.open}>
            {i.label}
            {i.meta && <div className="pm-muted">{i.meta}</div>}
          </button>
          {i.badge && <StatusBadge status={i.badge} />}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ Registry (§5) ------------------------------ */

type SortKey = "protocolNumber" | "title" | "updatedAt" | "status" | "nextReviewDate";
const STATUS_FILTERS = ["draft", "technical-review-pending", "technical-review-in-progress", "technical-changes-required", "technically-reviewed", "qa-review-pending", "qa-review-in-progress", "qa-changes-required", "approved", "released", "superseded", "retired", "rejected"] as RevisionStatus[];

function Registry({ setNav, initialFlag, initialStatus }: { setNav: (n: Nav) => void; initialFlag?: RegistryFlag; initialStatus?: string }) {
  const [filters, setFilters] = useState({ search: "", status: initialStatus ?? "", protocolType: "", equipmentCategory: "", author: "", reviewBefore: "", approvedFrom: "", approvedTo: "", flag: initialFlag ?? "" });
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "protocolNumber", dir: "asc" });
  const [page, setPage] = useState(1);
  const input = useMemo(
    () => ({
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      flag: (filters.flag || undefined) as RegistryFlag | undefined,
      sort: sort.key,
      direction: sort.dir,
      page,
      pageSize: 20,
    }),
    [filters, sort, page]
  );
  const q = trpc.protocols.list.useQuery(input);
  const categories = trpc.protocols.dashboard.useQuery().data?.categories ?? [];
  const set = (k: keyof typeof filters, v: string) => {
    setFilters(f => ({ ...f, [k]: v }));
    setPage(1);
  };
  const th = (key: SortKey, label: string) => (
    <th><button type="button" onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))}>{label}{sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</button></th>
  );
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <Panel title="Protocol Registry" actions={<button type="button" className="pm-btn primary" onClick={() => setNav({ view: "create" })}><FilePlus2 size={15} /> New protocol</button>}>
      <div className="pm-grid c4" style={{ marginBottom: 12 }}>
        <Field label="Search" hint="Number, title, manufacturer, model, equipment ID"><input value={filters.search} onChange={e => set("search", e.target.value)} placeholder="e.g. POL-QC-032D or ADP220" /></Field>
        <Field label="Status"><select value={filters.status} onChange={e => set("status", e.target.value)}><option value="">All</option>{STATUS_FILTERS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></Field>
        <Field label="Protocol type"><select value={filters.protocolType} onChange={e => set("protocolType", e.target.value)}><option value="">All</option>{PROTOCOL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Equipment category"><select value={filters.equipmentCategory} onChange={e => set("equipmentCategory", e.target.value)}><option value="">All</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label="Author"><input value={filters.author} onChange={e => set("author", e.target.value)} /></Field>
        <Field label="Approved from"><input type="date" value={filters.approvedFrom} onChange={e => set("approvedFrom", e.target.value)} /></Field>
        <Field label="Approved to"><input type="date" value={filters.approvedTo} onChange={e => set("approvedTo", e.target.value)} /></Field>
        <Field label="Review due before"><input type="date" value={filters.reviewBefore} onChange={e => set("reviewBefore", e.target.value)} /></Field>
        <Field label="Flag"><select value={filters.flag} onChange={e => set("flag", e.target.value)}><option value="">None</option><option value="due-for-review">Due for review</option><option value="expired-references">Expired references</option><option value="pending-verification">Pending technical verification</option><option value="open-gaps">Open technical gaps</option><option value="review-flag">Flagged by reference change</option></select></Field>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : !q.data?.rows.length ? (
        <div className="pm-empty">No protocols match the current filters.</div>
      ) : (
        <>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr>{th("protocolNumber", "Number")}{th("title", "Title")}<th>Equipment</th><th>Type</th><th>Revision</th>{th("status", "Status")}<th>Approved</th><th>Effective</th>{th("nextReviewDate", "Next review")}<th>Flags</th>{th("updatedAt", "Updated")}</tr></thead>
              <tbody>
                {q.data.rows.map(r => (
                  <tr key={r.id} className="is-click" onClick={() => setNav({ view: "detail", protocolId: r.id })}>
                    <td><strong>{r.protocolNumber}</strong></td>
                    <td>{r.title}</td>
                    <td>{r.manufacturer} {r.model}{r.equipmentId ? <div className="pm-muted">{r.equipmentId}</div> : null}</td>
                    <td>{PROTOCOL_TYPES.find(t => t.id === r.protocolType)?.label ?? r.protocolType}</td>
                    <td>{r.currentRevision ? `Rev ${r.currentRevision.revisionNumber}` : "—"}{r.releasedRevision && r.releasedRevision.id !== r.currentRevision?.id ? <div className="pm-muted">Released: rev {r.releasedRevision.revisionNumber}</div> : null}</td>
                    <td><StatusBadge status={r.currentRevision?.status ?? r.status} /></td>
                    <td>{fmtDate(r.lastApprovedAt)}</td>
                    <td>{fmtDate(r.releasedRevision?.effectiveDate)}</td>
                    <td>{fmtDate(r.releasedRevision?.nextReviewDate)}{r.overdueForReview && <div className="pm-badge pm-tone-bad">Overdue</div>}</td>
                    <td className="pm-row">
                      {r.pendingVerification > 0 && <span className="pm-badge pm-tone-warn" title="Items pending technical verification">{r.pendingVerification} pending</span>}
                      {r.openGaps > 0 && <span className="pm-badge pm-tone-bad">{r.openGaps} gap</span>}
                      {r.expiredReferences.length > 0 && <span className="pm-badge pm-tone-bad">Expired ref</span>}
                      {r.reviewFlag && <span className="pm-badge pm-tone-warn" title={r.reviewFlagReason}>Review flag</span>}
                    </td>
                    <td>{fmtDate(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pm-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
            <span className="pm-muted">{q.data.total} protocol(s)</span>
            <div className="pm-row">
              <button type="button" className="pm-btn small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span className="pm-muted">Page {q.data.page} of {pages}</span>
              <button type="button" className="pm-btn small" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------ Create (§5.4 / §23) ------------------------------ */

function CreateProtocol({ setNav, canAuthor }: { setNav: (n: Nav) => void; canAuthor: boolean }) {
  const utils = trpc.useUtils();
  const templates = trpc.protocols.templates.useQuery();
  const equipment = trpc.protocols.equipment.useQuery();
  const [form, setForm] = useState({ templateId: "tpl-custom", title: "", number: "", protocolType: "custom" as (typeof PROTOCOL_TYPES)[number]["id"], instrumentKey: "", manufacturer: "", model: "", equipmentCategory: "", equipmentType: "", associationType: "model" as "model" | "equipment", intendedUse: "", department: "Quality Control Laboratory", relatedForm: "" });
  const create = trpc.protocols.create.useMutation();
  const adp = trpc.protocols.configureAdp220.useMutation();
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const pickEquipment = (key: string) => {
    const e = equipment.data?.find(x => x.instrumentKey === key);
    setForm(f => ({ ...f, instrumentKey: key, manufacturer: e?.manufacturer ?? f.manufacturer, model: e?.model ?? f.model, relatedForm: e?.formNumber ?? f.relatedForm }));
  };
  const submit = async () => {
    try {
      const res = await create.mutateAsync({
        templateId: form.templateId,
        identification: { title: form.title, number: form.number, protocolType: form.protocolType, manufacturer: form.manufacturer, model: form.model, equipmentCategory: form.equipmentCategory, equipmentType: form.equipmentType, associationType: form.associationType, intendedUse: form.intendedUse, department: form.department, relatedForm: form.relatedForm },
        reason: "Protocol created",
      });
      // Equipment-specific association is configured in the builder (links are validated against the Equipment Library).
      await utils.protocols.invalidate();
      toast.success("Draft protocol created");
      setNav({ view: "builder", revisionId: res.revisionId });
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  if (!canAuthor) return <ErrorBox>Creating protocols requires the Protocol Author duty.</ErrorBox>;
  return (
    <div className="pm-grid">
      <Panel title="Create a protocol from a template" actions={<span className="pm-muted">Templates contain structure only — never acceptance limits or verification claims.</span>}>
        <div className="pm-grid c3">
          <Field label="Template" wide>
            <select value={form.templateId} onChange={e => { const t = templates.data?.find(x => x.id === e.target.value); setForm(f => ({ ...f, templateId: e.target.value, protocolType: (t?.protocolType as typeof f.protocolType) ?? f.protocolType, equipmentCategory: t?.templateCategory ?? f.equipmentCategory })); }}>
              {templates.data?.map(t => <option key={t.id} value={t.id}>{t.name}{t.builtin ? "" : " (institutional)"} — {t.templateCategory}</option>)}
            </select>
          </Field>
          <Field label="Protocol title *"><input value={form.title} onChange={e => set("title", e.target.value)} /></Field>
          <Field label="Protocol number *" hint="Unique; letters, digits, . _ / -"><input value={form.number} onChange={e => set("number", e.target.value.toUpperCase())} /></Field>
          <Field label="Protocol type"><select value={form.protocolType} onChange={e => set("protocolType", e.target.value)}>{PROTOCOL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
          <Field label="Equipment (from the existing Equipment Library)" hint="Fills manufacturer/model. No new equipment record is created.">
            <select value={form.instrumentKey} onChange={e => pickEquipment(e.target.value)}><option value="">— Model-level (no specific equipment) —</option>{equipment.data?.map(e => <option key={e.instrumentKey} value={e.instrumentKey}>{e.name} · {e.instrumentId} · {e.manufacturer} {e.model}</option>)}</select>
          </Field>
          <Field label="Manufacturer *"><input value={form.manufacturer} onChange={e => set("manufacturer", e.target.value)} /></Field>
          <Field label="Model *"><input value={form.model} onChange={e => set("model", e.target.value)} /></Field>
          <Field label="Equipment category"><input value={form.equipmentCategory} onChange={e => set("equipmentCategory", e.target.value)} /></Field>
          <Field label="Equipment type"><input value={form.equipmentType} onChange={e => set("equipmentType", e.target.value)} /></Field>
          <Field label="Intended use"><input value={form.intendedUse} onChange={e => set("intendedUse", e.target.value)} /></Field>
          <Field label="Department"><input value={form.department} onChange={e => set("department", e.target.value)} /></Field>
          <Field label="Related form"><input value={form.relatedForm} onChange={e => set("relatedForm", e.target.value)} /></Field>
        </div>
        <div className="pm-row" style={{ marginTop: 12 }}>
          <button type="button" className="pm-btn primary" disabled={create.isPending || form.title.trim().length < 3 || form.number.trim().length < 2} onClick={submit}>{create.isPending ? "Creating…" : "Create draft and open builder"}</button>
          <span className="pm-muted">Equipment-specific links are added in the builder and are checked against the registered equipment.</span>
        </div>
      </Panel>
      <Panel title="First configured protocol: POL-QC-032D (Bellingham + Stanley ADP220)">
        <p className="pm-muted" style={{ marginTop: 0 }}>Creates the polarimeter protocol as configuration data inside this generic module (DRAFT). It links the existing equipment record QC-I-029 / S/N PE99003 (no duplicate is created), seeds its references as pending verification, marks every criterion {"\u201C"}PENDING TECHNICAL VERIFICATION{"\u201D"}, and documents the ±0.02° (manual) vs ±0.01° (USP {"<781>"}) accuracy gap. Running it again only opens the existing draft.</p>
        <button type="button" className="pm-btn" disabled={adp.isPending} onClick={async () => { try { const r = await adp.mutateAsync(); await utils.protocols.invalidate(); toast.success(r.created ? "POL-QC-032D created as DRAFT" : "POL-QC-032D already exists — opening it"); setNav({ view: "detail", protocolId: r.protocolId }); } catch (e) { toast.error(errorText(e)); } }}>{adp.isPending ? "Configuring…" : "Configure POL-QC-032D draft"}</button>
      </Panel>
      <ImportPackagePanel />
      <BalanceRev03Panel />
    </div>
  );
}

/* ------------------------------ Documents (§17) ------------------------------ */

function Documents({ setNav }: { setNav: (n: Nav) => void }) {
  const q = trpc.protocols.list.useQuery({ pageSize: 100, sort: "protocolNumber" });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <Panel title="Protocol documents" actions={<span className="pm-muted">PDFs are generated from the exact revision. Drafts are watermarked “DRAFT – NOT APPROVED”.</span>}>
      {!q.data?.rows.length ? <div className="pm-empty">No protocols yet.</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>Protocol</th><th>Current revision</th><th>Released (controlled) revision</th><th /></tr></thead>
            <tbody>
              {q.data.rows.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.protocolNumber}</strong><div className="pm-muted">{r.title}</div></td>
                  <td>{r.currentRevision ? <>Rev {r.currentRevision.revisionNumber} <StatusBadge status={r.currentRevision.status} /></> : "—"}</td>
                  <td>{r.releasedRevision ? <>Rev {r.releasedRevision.revisionNumber} · effective {fmtDate(r.releasedRevision.effectiveDate)}</> : <span className="pm-muted">Not released</span>}</td>
                  <td><button type="button" className="pm-btn small" onClick={() => setNav({ view: "detail", protocolId: r.id, tab: "revisions" })}>Open revisions & PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* -------------------- 8-protocol calibration package import -------------------- */

function ImportPackagePanel() {
  const utils = trpc.useUtils();
  const imp = trpc.protocols.importPackage.useMutation();
  const [result, setResult] = useState<Awaited<ReturnType<typeof imp.mutateAsync>> | null>(null);
  return (
    <Panel title="Import the 8 calibration protocols (supplied package)">
      <p className="pm-muted" style={{ marginTop: 0 }}>
        Imports CAL-QC-HPLC-001, POL-001, BAL-001 (Rev.03 DRAFT), MOA-001, DIS-001, DISINT-001, REF-001 and UV-001 as DRAFT revisions,
        exactly as supplied. Every criterion is marked {"\u201C"}PENDING TECHNICAL VERIFICATION{"\u201D"}; values not given by the source stay
        {"\u201C"}NOT SPECIFIED IN SUPPLIED USP SOURCE{"\u201D"}. Historical records are not imported as results. Matching equipment is linked automatically
        (the balance QC-I-074 is registered if missing; the HPLC is not linked because LC-2030 PLUS ≠ QC-I-104). Running it again skips existing protocols.
        Importing a protocol never implies that an instrument passed.
      </p>
      <button type="button" className="pm-btn primary" disabled={imp.isPending} onClick={async () => {
        try {
          const r = await imp.mutateAsync();
          setResult(r);
          await utils.protocols.invalidate();
          toast.success(`Package import: ${r.created} created, ${r.skipped} already existed, ${r.failed} failed`);
        } catch (e) { toast.error(errorText(e)); }
      }}>{imp.isPending ? "Importing…" : "Import 8 protocols"}</button>
      {result && (
        <div className="pm-table-wrap" style={{ marginTop: 12 }}>
          <table className="pm-table">
            <thead><tr><th>Protocol</th><th>Status</th><th>Tests</th><th>Linked equipment</th><th>Notes</th></tr></thead>
            <tbody>{result.lines.map(l => <tr key={l.protocolNumber}><td>{l.protocolNumber}</td><td><span className={`pm-badge ${l.status === "created" ? "pm-tone-ok" : l.status === "failed" ? "pm-tone-bad" : "pm-tone-muted"}`}>{l.status}</span></td><td>{l.tests}</td><td>{l.linkedEquipment ?? "— (model-level)"}</td><td className="pm-muted">{l.notes.join(" ")}</td></tr>)}</tbody>
          </table>
          {result.notes.length > 0 && <ul className="pm-muted">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      )}
    </Panel>
  );
}

const BAL03_OUTCOME: Record<string, string> = {
  created: "Created as a new DRAFT protocol",
  "updated-draft": "Open draft updated with the Rev.03 content",
  "new-revision": "New draft revision created with the Rev.03 content",
  "already-current": "Already on Rev.03 — nothing changed",
};

/** Replaces the CAL-QC-BAL-001 Rev.01 content already in the system with the supplied Rev.03 (history preserved). */
function BalanceRev03Panel() {
  const utils = trpc.useUtils();
  const adopt = trpc.protocols.adoptBalanceRev03.useMutation();
  const [result, setResult] = useState<Awaited<ReturnType<typeof adopt.mutateAsync>> | null>(null);
  return (
    <Panel title="Analytical balance — adopt CAL-QC-BAL-001 Rev.03 (replaces Rev.01)">
      <p className="pm-muted" style={{ marginTop: 0 }}>
        Applies the supplied <b>CAL-QC-BAL-001 Rev.03</b> (CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf, 21-Nov-2026 — DRAFT, technical review / QA approval required)
        in place of the Rev.01 content. An open draft is updated; a released revision is <b>kept unchanged</b> and a new draft revision is created, so every
        earlier revision and its audit trail remain in history. Rev.03 adds DQ/URS, the proposed 20–25 °C / 40–60 %RH site window, the reference-weight
        register and explicit worksheets, and removes the previously assumed numeric limits for accuracy, sensitivity, linearity and eccentricity (record-only until
        the current USP text / approved method defines them). All criteria stay PENDING TECHNICAL VERIFICATION; this does not mean the balance passed.
      </p>
      <button type="button" className="pm-btn primary" disabled={adopt.isPending} onClick={async () => {
        if (!window.confirm("Replace the CAL-QC-BAL-001 content with Rev.03? Earlier revisions stay in history.")) return;
        try {
          const r = await adopt.mutateAsync();
          setResult(r);
          await utils.protocols.invalidate();
          toast.success(`CAL-QC-BAL-001: ${BAL03_OUTCOME[r.outcome]} (revision ${r.revisionNumber})`);
        } catch (e) { toast.error(errorText(e)); }
      }}>{adopt.isPending ? "Applying…" : "Adopt Rev.03"}</button>
      {result && (
        <div style={{ marginTop: 12 }}>
          <p><span className={`pm-badge ${result.outcome === "already-current" ? "pm-tone-muted" : "pm-tone-ok"}`}>{BAL03_OUTCOME[result.outcome]}</span>{" "}
            Revision {result.revisionNumber}{result.previousRevisionNumber ? ` (previous: revision ${result.previousRevisionNumber})` : ""} · Linked equipment: {result.linkedEquipment ?? "— (model-level)"}</p>
          <ul className="pm-muted">
            {result.referencesCreated.length > 0 && <li>References added (pending verification): {result.referencesCreated.join(", ")}</li>}
            {result.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}
