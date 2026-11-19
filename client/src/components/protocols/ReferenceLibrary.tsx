/**
 * Reference Library (§11). Typed, searchable reference records. Significant
 * changes are audited server-side and flag every protocol that uses the
 * reference for review; approved revisions keep their reference snapshot.
 * No certificate or reference value is invented — fields left empty stay empty.
 */
import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { REFERENCE_TYPES, REFERENCE_VERIFICATION_STATUSES, type ReferenceType, type ReferenceVerificationStatus } from "@shared/protocols/model";
import { ErrorBox, Field, Loading, Panel, askReason, errorText, fmtDate, type ReferenceRowDto } from "./common";

type Form = {
  id?: string;
  expectedRowVersion?: number;
  code: string;
  title: string;
  issuer: string;
  referenceType: ReferenceType;
  documentNumber: string;
  edition: string;
  revision: string;
  publicationDate: string;
  effectiveDate: string;
  expiryDate: string;
  reviewDate: string;
  sourceUrl: string;
  documentUrl: string;
  applicableSection: string;
  applicableClause: string;
  verificationStatus: ReferenceVerificationStatus;
  notes: string;
};

const EMPTY: Form = { code: "", title: "", issuer: "", referenceType: "pharmacopoeia", documentNumber: "", edition: "", revision: "", publicationDate: "", effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: "", documentUrl: "", applicableSection: "", applicableClause: "", verificationStatus: "pending-verification", notes: "" };
const typeLabel = (id: string) => REFERENCE_TYPES.find(t => t.id === id)?.label ?? id;

export function ReferenceLibrary({ duties }: { duties: readonly string[] }) {
  const refs = trpc.protocols.references.useQuery();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const canEdit = duties.some(d => d === "author" || d === "technical-reviewer" || d === "qa-approver");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (refs.data ?? []).filter(r =>
      (!type || r.referenceType === type) &&
      (!status || (status === "expired" ? r.expired : r.verificationStatus === status)) &&
      (!s || [r.code, r.title, r.issuer, r.documentNumber, r.edition, r.revision, r.notes].some(v => v.toLowerCase().includes(s)))
    );
  }, [refs.data, q, type, status]);

  if (refs.isLoading) return <Loading />;
  if (refs.error) return <ErrorBox error={refs.error} />;

  return (
    <div className="pm-grid">
      <Panel
        title={<><BookOpen size={16} /> Reference Library <span className="pm-badge pm-tone-neutral">{refs.data?.length ?? 0}</span></>}
        actions={canEdit && <button type="button" className="pm-btn primary" onClick={() => setForm({ ...EMPTY })}><Plus size={14} /> New reference</button>}
      >
        <div className="pm-row" style={{ marginBottom: 10 }}>
          <input className="pm-input" style={{ maxWidth: 320 }} placeholder="Search code, title, issuer, document…" value={q} onChange={e => setQ(e.target.value)} />
          <select className="pm-input" style={{ maxWidth: 220 }} value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{REFERENCE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <select className="pm-input" style={{ maxWidth: 220 }} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{REFERENCE_VERIFICATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}<option value="expired">expired</option></select>
        </div>
        {!rows.length ? <div className="pm-empty">No references match.</div> : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>Code</th><th>Title</th><th>Type</th><th>Edition / rev</th><th>Effective</th><th>Expiry / review</th><th>Status</th><th>Used by</th><th /></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.code}</strong></td>
                    <td>{r.title}<div className="pm-muted">{r.issuer} {r.documentNumber}</div>{(r.sourceUrl || r.documentUrl) && <a href={r.sourceUrl || r.documentUrl} target="_blank" rel="noreferrer noopener" className="pm-muted"><ExternalLink size={11} /> source</a>}</td>
                    <td>{typeLabel(r.referenceType)}</td>
                    <td>{[r.edition, r.revision].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{r.effectiveDate || "—"}</td>
                    <td>{r.expiryDate || "—"}{r.reviewDate && <div className="pm-muted">review {r.reviewDate}</div>}</td>
                    <td><span className={`pm-badge ${r.expired ? "pm-tone-bad" : r.verificationStatus === "verified" ? "pm-tone-ok" : "pm-tone-warn"}`}>{r.expired ? "expired" : r.verificationStatus}</span>{r.verifiedByName && <div className="pm-muted">by {r.verifiedByName}</div>}</td>
                    <td>{r.usedByProtocolCount} protocol(s)</td>
                    <td>{canEdit && <button type="button" className="pm-btn small" onClick={() => setForm(toForm(r))}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {form && <ReferenceForm form={form} setForm={setForm} />}
    </div>
  );
}

function toForm(r: ReferenceRowDto): Form {
  return { id: r.id, expectedRowVersion: r.rowVersion, code: r.code, title: r.title, issuer: r.issuer, referenceType: r.referenceType as ReferenceType, documentNumber: r.documentNumber, edition: r.edition, revision: r.revision, publicationDate: r.publicationDate, effectiveDate: r.effectiveDate, expiryDate: r.expiryDate, reviewDate: r.reviewDate, sourceUrl: r.sourceUrl, documentUrl: r.documentUrl, applicableSection: r.applicableSection, applicableClause: r.applicableClause, verificationStatus: r.verificationStatus as ReferenceVerificationStatus, notes: r.notes };
}

function ReferenceForm({ form, setForm }: { form: Form; setForm: (f: Form | null) => void }) {
  const utils = trpc.useUtils();
  const save = trpc.protocols.saveReference.useMutation();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const txt = (k: keyof Form, label: string, hint?: string, wide = false) => <Field label={label} hint={hint} wide={wide}><input value={String(form[k] ?? "")} onChange={e => set(k, e.target.value as never)} /></Field>;
  const submit = async () => {
    const reason = askReason(form.id ? "Reason for changing this reference (protocols using it will be flagged for review if significant fields change)" : "Reason for adding this reference");
    if (!reason) return;
    try {
      const res = await save.mutateAsync({ ...form, reason });
      await Promise.all([utils.protocols.references.invalidate(), utils.protocols.dashboard.invalidate(), utils.protocols.list.invalidate(), utils.protocols.notifications.invalidate()]);
      toast.success(res.affectedProtocols.length ? `Reference saved. Flagged for review: ${res.affectedProtocols.join(", ")}` : "Reference saved");
      setForm(null);
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  return (
    <Panel title={form.id ? `Edit reference ${form.code}` : "New reference"} actions={<><button type="button" className="pm-btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="pm-btn primary" disabled={save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save reference"}</button></>}>
      <div className="pm-alert pm-alert-info">Enter only information taken from the actual document or certificate. Leave unknown values empty — never estimate certified values.</div>
      <div className="pm-grid c3">
        {txt("code", "Code *", "Unique, e.g. USP-781")}
        {txt("title", "Title *", undefined, false)}
        <Field label="Type *"><select value={form.referenceType} onChange={e => set("referenceType", e.target.value as ReferenceType)}>{REFERENCE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        {txt("issuer", "Issuer / organisation")}
        {txt("documentNumber", "Document / certificate number")}
        {txt("edition", "Edition / version")}
        {txt("revision", "Revision")}
        {txt("publicationDate", "Publication date", "YYYY, YYYY-MM or YYYY-MM-DD")}
        {txt("effectiveDate", "Effective date", "YYYY-MM-DD")}
        {txt("expiryDate", "Expiry date", "Certificates: from the certificate only")}
        {txt("reviewDate", "Review date")}
        <Field label="Verification status"><select value={form.verificationStatus} onChange={e => set("verificationStatus", e.target.value as ReferenceVerificationStatus)}>{REFERENCE_VERIFICATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
        {txt("sourceUrl", "Source URL / DOI link", "https://…", true)}
        {txt("documentUrl", "Controlled document URL", "https://…", true)}
        {txt("applicableSection", "Applicable section")}
        {txt("applicableClause", "Applicable clause")}
        <Field label="Notes" wide><textarea value={form.notes} onChange={e => set("notes", e.target.value)} /></Field>
      </div>
      {form.verificationStatus === "verified" && <p className="pm-muted">Marking as verified records you as the verifier (requires a Technical Reviewer or QA duty on the server).</p>}
    </Panel>
  );
}
