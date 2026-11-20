/**
 * «تعديل بيانات ومواصفات الأجهزة» — single page to view and edit equipment
 * identity and technical specifications.
 *
 *  - typed, unit-aware specification groups (no automatic unit conversion);
 *  - duplicate equipment-ID / serial check;
 *  - optimistic concurrency: a concurrent edit is detected, the user's edits are
 *    kept on screen and compared with the latest saved data before re-saving;
 *  - a reason is mandatory for critical fields; every changed field is logged
 *    immutably (field, old, new, user, role, time, reason, reference);
 *  - equipment is retired, never deleted;
 *  - linked unapproved protocol drafts update automatically (audited), approved
 *    protocols are flagged for a new revision, in-progress runs keep their
 *    snapshot. Specification values never change acceptance criteria.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, History, Link2, ListChecks, Plus, Save, Search, Wrench } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { diffEquipment, IDENTITY_FIELDS, NOT_AVAILABLE, SPEC_CATALOG, SPEC_GROUPS, specDefinitions, specIssues, type EquipmentIdentity, type SpecDefinition, type SpecMap } from "@shared/protocols/equipment";
import { ErrorBox, Field, Loading, Panel, askReason, errorText, fmtDate, type PmUser, type ProtocolOutputs } from "./common";
import "./protocols.css";

export const EQUIPMENT_PAGE_TITLE = "تعديل بيانات ومواصفات الأجهزة";

type Lang = "ar" | "en";
type EquipmentItem = ProtocolOutputs["equipmentData"][number];
/** Mirrors the server rule: every identity field except SOP / form number is required. */
const REQUIRED_IDENTITY_KEYS = IDENTITY_FIELDS.map(f => f.key).filter(k => k !== "sopNumber" && k !== "formNumber");
const EMPTY_IDENTITY = Object.fromEntries(IDENTITY_FIELDS.map(f => [f.key, ""])) as EquipmentIdentity;

export function EquipmentDataPage({ user, language = "ar" }: { user: PmUser; language?: Lang }) {
  const t = (en: string, ar: string) => (language === "ar" ? ar : en);
  const status = trpc.protocols.moduleStatus.useQuery(undefined, { retry: false });
  const list = trpc.protocols.equipmentData.useQuery(undefined, { enabled: !!status.data?.ok });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const readOnly = user.role === "viewer";

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (list.data ?? []).filter(e => (showRetired || e.status !== "retired") && (!s || [e.identity.instrumentId, e.identity.nameEn, e.identity.nameAr, e.identity.model, e.identity.manufacturer, e.identity.serialNumber].some(v => v.toLowerCase().includes(s))));
  }, [list.data, search, showRetired]);

  useEffect(() => {
    if (!selected && rows.length && !creating) setSelected(rows[0].instrumentKey);
  }, [rows, selected, creating]);

  return (
    <div className="pm-root page-enter" dir={language === "ar" ? "rtl" : "ltr"}>
      <section className="page-topline">
        <div>
          <span className="eyebrow">EQUIPMENT DATA &amp; SPECIFICATIONS</span>
          <h1>{EQUIPMENT_PAGE_TITLE}</h1>
          <p>{t("Equipment identity and technical specifications. Changes are versioned, audited and linked automatically to protocols; historical records are never altered.", "هوية الأجهزة ومواصفاتها الفنية. كل تعديل له إصدار وسجل تدقيق ويرتبط تلقائياً بالبروتوكولات، ولا تُعدَّل السجلات التاريخية أبداً.")}</p>
        </div>
        <div className="page-topline-icon"><Wrench size={26} /></div>
      </section>
      {status.isLoading ? <Loading /> : status.error || !status.data?.ok ? (
        <ErrorBox><strong>{t("Protocol Management database is not available.", "قاعدة بيانات إدارة البروتوكولات غير متاحة.")}</strong> {status.error ? errorText(status.error) : status.data?.missing.join(", ")}</ErrorBox>
      ) : (
        <>
          {!status.data.workflowOk && (
            <div className="pm-alert pm-alert-warn"><AlertTriangle size={16} /><div>{t("Editing requires the v3 tables. Re-run server/sql/protocol_management_migration.sql in Supabase. Missing:", "التعديل يتطلب جداول الإصدار v3. أعد تشغيل ملف الترحيل في Supabase. الناقص:")} {status.data.workflowMissing.join(", ")}</div></div>
          )}
          <div className="pm-equipment-layout">
            <Panel title={t("Equipment", "الأجهزة")} actions={!readOnly && <button type="button" className="pm-btn small primary" onClick={() => { setCreating(true); setSelected(null); }}><Plus size={14} /> {t("New equipment", "جهاز جديد")}</button>}>
              <div className="pm-grid" style={{ gap: 8 }}>
                <label className="pm-field"><span><Search size={12} /> {t("Search", "بحث")}</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("ID, name, model, serial…", "الرقم، الاسم، الموديل، التسلسلي…")} /></label>
                <label className="pm-check"><input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> {t("Show retired", "إظهار المُستبعدة")}</label>
                {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
                  <ul className="pm-equipment-list">
                    {rows.map(e => (
                      <li key={e.instrumentKey}>
                        <button type="button" className={selected === e.instrumentKey ? "is-active" : ""} onClick={() => { setCreating(false); setSelected(e.instrumentKey); }}>
                          <span className="pm-equipment-dot" style={{ background: e.accent }} />
                          <span>
                            <strong>{e.identity.instrumentId || "—"}</strong> {language === "ar" ? e.identity.nameAr || e.identity.nameEn : e.identity.nameEn}
                            <div className="pm-muted">{e.identity.manufacturer} {e.identity.model}{e.status === "retired" ? ` · ${t("retired", "مُستبعد")}` : ""}</div>
                          </span>
                        </button>
                      </li>
                    ))}
                    {!rows.length && <li className="pm-empty">{t("No equipment", "لا توجد أجهزة")}</li>}
                  </ul>
                )}
              </div>
            </Panel>
            <div className="pm-grid">
              {creating ? <CreateEquipment lang={language} all={list.data ?? []} onDone={key => { setCreating(false); setSelected(key); }} onCancel={() => setCreating(false)} />
                : selected ? <EquipmentDetail key={selected} instrumentKey={selected} lang={language} all={list.data ?? []} readOnly={readOnly || !status.data.workflowOk} />
                : <div className="pm-empty">{t("Select equipment", "اختر جهازاً")}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ helpers ------------------------------ */

const normSpecs = (specs: SpecMap): SpecMap =>
  Object.fromEntries(Object.entries(specs).filter(([, v]) => v.value !== null && v.value !== "").map(([k, v]) => [k, { value: v.value, unit: v.unit ?? "", source: (v.source ?? "").trim() }]));

function duplicateProblems(identity: EquipmentIdentity, all: EquipmentItem[], selfKey: string | null) {
  const out: string[] = [];
  const same = (a: string, b: string) => a.trim() !== "" && a.trim().toLowerCase() === b.trim().toLowerCase();
  all.filter(e => e.instrumentKey !== selfKey).forEach(e => {
    if (same(identity.instrumentId, e.identity.instrumentId)) out.push(`Equipment ID ${identity.instrumentId} is already used by ${e.identity.nameEn}`);
    if (same(identity.serialNumber, e.identity.serialNumber) && same(identity.model, e.identity.model)) out.push(`Serial ${identity.serialNumber} (${identity.model}) is already registered for ${e.identity.instrumentId}`);
  });
  return out;
}

function SpecInput({ def, value, onChange, disabled, lang, changed }: { def: SpecDefinition; value: SpecMap[string] | undefined; onChange: (v: SpecMap[string] | null) => void; disabled: boolean; lang: Lang; changed: boolean }) {
  const v = value ?? { value: null, unit: def.units[0] ?? "", source: "" };
  const set = (patch: Partial<SpecMap[string]>) => onChange({ ...v, ...patch });
  const label = `${lang === "ar" ? def.labelAr : def.label}${def.critical ? " ★" : ""}`;
  return (
    <div className={`pm-field ${changed ? "pm-spec-changed" : ""}`}>
      <span title={def.critical ? "Critical field — a reason is required to change it" : undefined}>{label}</span>
      <div className="pm-row" style={{ flexWrap: "nowrap" }}>
        {def.type === "number" ? (
          <input type="number" step="any" disabled={disabled} value={typeof v.value === "number" ? v.value : ""} onChange={e => set({ value: e.target.value.trim() === "" ? null : Number(e.target.value) })} placeholder={NOT_AVAILABLE} />
        ) : def.type === "date" ? (
          <input type="date" disabled={disabled} value={typeof v.value === "string" ? v.value : ""} onChange={e => set({ value: e.target.value || null })} />
        ) : def.type === "select" ? (
          <select disabled={disabled} value={typeof v.value === "string" ? v.value : ""} onChange={e => set({ value: e.target.value || null })}><option value="">—</option>{def.options?.map(o => <option key={o}>{o}</option>)}</select>
        ) : (
          <input disabled={disabled} value={typeof v.value === "string" ? v.value : v.value === null ? "" : String(v.value)} onChange={e => set({ value: e.target.value || null })} placeholder={NOT_AVAILABLE} />
        )}
        {def.units.length > 1 ? (
          <select disabled={disabled} value={v.unit} onChange={e => set({ unit: e.target.value })} style={{ width: 90 }} title="Unit (no automatic conversion)">{def.units.map(u => <option key={u}>{u}</option>)}</select>
        ) : def.units[0] ? <span className="pm-muted" style={{ minWidth: 40 }}>{def.units[0]}</span> : null}
      </div>
      <input disabled={disabled} className="pm-spec-source" value={v.source} onChange={e => set({ source: e.target.value })} placeholder={lang === "ar" ? "المصدر (كتيّب الصانع، شهادة…)" : "Source (manual, certificate…)"} />
      {def.hint && <small>{def.hint}</small>}
    </div>
  );
}

/* ------------------------------ detail ------------------------------ */

type DetailTab = "specs" | "history" | "protocols" | "runs";

function EquipmentDetail({ instrumentKey, lang, all, readOnly }: { instrumentKey: string; lang: Lang; all: EquipmentItem[]; readOnly: boolean }) {
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const utils = trpc.useUtils();
  const q = trpc.protocols.equipmentDetail.useQuery({ instrumentKey });
  const [tab, setTab] = useState<DetailTab>("specs");
  const [identity, setIdentity] = useState<EquipmentIdentity>(EMPTY_IDENTITY);
  const [specs, setSpecs] = useState<SpecMap>({});
  const [base, setBase] = useState<{ identity: EquipmentIdentity; specs: SpecMap; version: number } | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [conflict, setConflict] = useState<{ identity: EquipmentIdentity; specs: SpecMap; by: string | null; at: string | null } | null>(null);
  const update = trpc.protocols.updateEquipment.useMutation();
  const retire = trpc.protocols.retireEquipment.useMutation();

  useEffect(() => {
    if (!q.data || base) return;
    const e = q.data.equipment;
    setIdentity({ ...e.identity });
    setSpecs({ ...e.specs });
    setBase({ identity: { ...e.identity }, specs: { ...e.specs }, version: e.specsRowVersion });
  }, [q.data, base]);

  if (q.isLoading || !base) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const d = q.data!;
  const e = d.equipment;
  const retired = e.status === "retired";
  const disabled = readOnly || retired;
  const draft = { identity, specs: normSpecs(specs) };
  const changes = diffEquipment(e.equipmentType, { identity: base.identity, specs: normSpecs(base.specs) }, draft);
  const critical = changes.filter(c => c.critical);
  const issues = specIssues(e.equipmentType, draft.specs);
  const dupes = duplicateProblems(identity, all, instrumentKey);
  const changedKeys = new Set(changes.map(c => c.field));
  const extraKeys = Object.keys(specs).filter(k => !d.definitions.some(x => x.key === k));
  const canSave = !disabled && changes.length > 0 && !issues.length && !dupes.length && (!critical.length || reason.trim().length >= 3) && !update.isPending;

  const doSave = async () => {
    try {
      const r = await update.mutateAsync({ instrumentKey, expectedSpecsRowVersion: base.version, identity, specs: draft.specs, reason, reference });
      toast.success(t(`Saved ${r.changed} change(s). Drafts updated: ${r.propagated}; approved protocols flagged for revision: ${r.flagged}; in-progress runs notified: ${r.outdatedRuns}.`, `حُفظ ${r.changed} تعديل. مسودات حُدّثت: ${r.propagated}؛ بروتوكولات معتمدة تحتاج مراجعة جديدة: ${r.flagged}؛ تشغيلات جارية أُشعرت: ${r.outdatedRuns}.`));
      setReason("");
      setReference("");
      setConflict(null);
      setBase(null);
      await Promise.all([utils.protocols.equipmentDetail.invalidate({ instrumentKey }), utils.protocols.equipmentData.invalidate()]);
    } catch (err) {
      const msg = errorText(err);
      if (msg.includes("changed by another user")) {
        const latest = await utils.protocols.equipmentDetail.fetch({ instrumentKey });
        setConflict({ identity: latest.equipment.identity, specs: latest.equipment.specs, by: latest.equipment.updatedBy, at: latest.equipment.updatedAt });
        toast.error(t("Another user saved this equipment. Your edits are kept — review the differences below.", "قام مستخدم آخر بحفظ بيانات هذا الجهاز. تعديلاتك محفوظة على الشاشة — راجع الفروقات أدناه."));
      } else toast.error(msg);
    }
  };

  const conflictRows = conflict ? diffEquipment(e.equipmentType, { identity: conflict.identity, specs: normSpecs(conflict.specs) }, draft) : [];

  return (
    <>
      <Panel
        title={<>{e.identity.instrumentId} — {lang === "ar" ? e.identity.nameAr || e.identity.nameEn : e.identity.nameEn} <span className="pm-muted">· {e.identity.manufacturer} {e.identity.model}</span></>}
        actions={
          <>
            <span className={`pm-badge ${retired ? "pm-tone-muted" : "pm-tone-ok"}`}>{retired ? t("Retired", "مُستبعد") : t("Active", "نشط")}</span>
            <span className="pm-badge pm-tone-neutral" title="Equipment data version (fingerprint)">v{e.specsRowVersion} · {e.version}</span>
            {!disabled && (
              <button type="button" className="pm-btn small danger" disabled={retire.isPending} onClick={async () => {
                const r = askReason(t("Reason for retiring this equipment (it is not deleted; history is kept):", "سبب استبعاد الجهاز (لا يُحذف، ويُحتفظ بالسجل):"));
                if (!r) return;
                try { await retire.mutateAsync({ instrumentKey, expectedSpecsRowVersion: base.version, reason: r }); toast.success(t("Equipment retired", "تم استبعاد الجهاز")); setBase(null); utils.protocols.equipmentDetail.invalidate({ instrumentKey }); utils.protocols.equipmentData.invalidate(); } catch (err) { toast.error(errorText(err)); }
              }}><Archive size={14} /> {t("Retire", "استبعاد")}</button>
            )}
          </>
        }
      >
        {retired && <div className="pm-alert pm-alert-info"><AlertTriangle size={16} /><div>{t("Retired", "مُستبعد")}: {e.retiredReason}</div></div>}
        <nav className="pm-tabs" style={{ marginBottom: 12 }}>
          <button type="button" className={tab === "specs" ? "is-active" : ""} onClick={() => setTab("specs")}><Wrench size={14} /> {t("Data & specifications", "البيانات والمواصفات")}</button>
          <button type="button" className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}><History size={14} /> {t("Change history", "سجل التعديلات")} ({d.changes.length})</button>
          <button type="button" className={tab === "protocols" ? "is-active" : ""} onClick={() => setTab("protocols")}><Link2 size={14} /> {t("Linked protocols", "البروتوكولات المرتبطة")} ({d.protocols.length})</button>
          <button type="button" className={tab === "runs" ? "is-active" : ""} onClick={() => setTab("runs")}><ListChecks size={14} /> {t("Calibration runs", "تشغيلات المعايرة")} ({d.runs.length})</button>
        </nav>

        {tab === "specs" && (
          <div className="pm-grid">
            <h3>{t("Identity", "الهوية")}</h3>
            <div className="pm-grid c4">
              {IDENTITY_FIELDS.map(f => (
                <label key={f.key} className={`pm-field ${changedKeys.has(f.key) ? "pm-spec-changed" : ""}`}>
                  <span>{lang === "ar" ? f.labelAr : f.label}{f.critical ? " ★" : ""}</span>
                  <input disabled={disabled} value={identity[f.key]} onChange={ev => setIdentity(i => ({ ...i, [f.key]: ev.target.value }))} dir={f.key === "nameAr" ? "rtl" : "ltr"} />
                </label>
              ))}
            </div>
            {SPEC_GROUPS.map(g => {
              const defs = d.definitions.filter(x => x.group === g.key);
              if (!defs.length) return null;
              return (
                <div key={g.key}>
                  <h3>{lang === "ar" ? g.labelAr : g.label}</h3>
                  <div className="pm-grid c3">
                    {defs.map(def => <SpecInput key={def.key} def={def} lang={lang} disabled={disabled} changed={changedKeys.has(def.key)} value={specs[def.key]} onChange={v => setSpecs(s => { const n = { ...s }; if (v) n[def.key] = v; else delete n[def.key]; return n; })} />)}
                  </div>
                </div>
              );
            })}
            {extraKeys.length > 0 && (
              <div>
                <h3>{t("Other recorded specifications", "مواصفات أخرى مسجلة")}</h3>
                <div className="pm-grid c3">{extraKeys.map(k => <Field key={k} label={k}><div>{String(specs[k].value ?? "—")} {specs[k].unit}</div></Field>)}</div>
              </div>
            )}
            <div className="pm-muted">★ {t("Critical field: changing it requires a reason. Specification values are informational and never change protocol acceptance criteria. Units are never converted automatically.", "حقل حرج: تعديله يتطلب ذكر السبب. قيم المواصفات معلوماتية ولا تغيّر معايير القبول في البروتوكول، ولا يتم تحويل الوحدات تلقائياً.")}</div>

            {(issues.length > 0 || dupes.length > 0) && (
              <div className="pm-alert pm-alert-bad"><AlertTriangle size={16} /><div><ul>{[...dupes, ...issues.map(i => i.message)].map((m, i) => <li key={i}>{m}</li>)}</ul></div></div>
            )}

            {conflict && (
              <div className="pm-alert pm-alert-warn">
                <AlertTriangle size={16} />
                <div>
                  {t("Concurrent change", "تعديل متزامن")}: {conflict.by ?? "—"} · {fmtDate(conflict.at, true)}. {t("Differences between the latest saved data and your edits:", "الفروقات بين آخر بيانات محفوظة وتعديلاتك:")}
                  <ul>{conflictRows.map(c => <li key={`${c.group}-${c.field}`}>{c.label}: {t("saved", "المحفوظ")} <strong>{String(c.previous ?? "—")}</strong> / {t("yours", "تعديلك")} <strong>{String(c.next ?? "—")}</strong> {c.unit}</li>)}</ul>
                  <div className="pm-row">
                    <button type="button" className="pm-btn small primary" onClick={() => { setBase({ identity: conflict.identity, specs: conflict.specs, version: q.data!.equipment.specsRowVersion }); setConflict(null); utils.protocols.equipmentDetail.invalidate({ instrumentKey }); }}>{t("Keep my edits on top of the latest version", "اعتماد تعديلاتي فوق أحدث إصدار")}</button>
                    <button type="button" className="pm-btn small" onClick={() => { setIdentity({ ...conflict.identity }); setSpecs({ ...conflict.specs }); setBase(null); setConflict(null); utils.protocols.equipmentDetail.invalidate({ instrumentKey }); }}>{t("Discard mine, load the latest", "تجاهل تعديلاتي وتحميل الأحدث")}</button>
                  </div>
                </div>
              </div>
            )}

            {!disabled && (
              <div className="pm-panel" style={{ background: "#F8FAF5" }}>
                <h3 style={{ marginTop: 0 }}>{t("Pending changes", "التعديلات المعلّقة")} ({changes.length})</h3>
                {changes.length ? (
                  <div className="pm-table-wrap">
                    <table className="pm-table">
                      <thead><tr><th>{t("Field", "الحقل")}</th><th>{t("Old", "القديم")}</th><th>{t("New", "الجديد")}</th><th>{t("Unit", "الوحدة")}</th><th /></tr></thead>
                      <tbody>{changes.map(c => <tr key={`${c.group}-${c.field}`}><td>{c.label}</td><td>{String(c.previous ?? "—")}</td><td><strong>{String(c.next ?? "—")}</strong></td><td>{c.unit}</td><td>{c.critical && <span className="pm-badge pm-tone-warn">{t("critical", "حرج")}</span>}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : <div className="pm-muted">{t("No changes.", "لا توجد تعديلات.")}</div>}
                <div className="pm-grid c2" style={{ marginTop: 10 }}>
                  <Field label={`${t("Reason for change", "سبب التعديل")}${critical.length ? " *" : ""}`} hint={critical.length ? t("Required: critical fields changed", "مطلوب: تم تعديل حقول حرجة") : undefined}><input value={reason} onChange={ev => setReason(ev.target.value)} /></Field>
                  <Field label={t("Reference (document / certificate / change control)", "المرجع (وثيقة / شهادة / طلب تغيير)")}><input value={reference} onChange={ev => setReference(ev.target.value)} /></Field>
                </div>
                <div className="pm-row" style={{ marginTop: 8 }}>
                  <button type="button" className="pm-btn primary" disabled={!canSave} onClick={doSave}><Save size={14} /> {t("Save changes", "حفظ التعديلات")}</button>
                  <button type="button" className="pm-btn" disabled={!changes.length} onClick={() => { setIdentity({ ...base.identity }); setSpecs({ ...base.specs }); }}>{t("Undo", "تراجع")}</button>
                  <span className="pm-muted">{t("Unapproved linked protocol drafts are updated automatically; approved protocols require a new revision; in-progress runs keep their snapshot.", "تُحدَّث مسودات البروتوكولات غير المعتمدة تلقائياً؛ البروتوكولات المعتمدة تحتاج مراجعة جديدة؛ التشغيلات الجارية تحتفظ بلقطتها.")}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "history" && (d.changes.length ? (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>{t("Date", "التاريخ")}</th><th>{t("Field", "الحقل")}</th><th>{t("Old", "القديم")}</th><th>{t("New", "الجديد")}</th><th>{t("By", "بواسطة")}</th><th>{t("Reason / reference", "السبب / المرجع")}</th></tr></thead>
              <tbody>{d.changes.map(c => <tr key={c.id}><td>{fmtDate(c.createdAt, true)}</td><td>{c.label}{c.critical && <> <span className="pm-badge pm-tone-warn">{t("critical", "حرج")}</span></>}</td><td>{String(c.previous ?? "—")}</td><td><strong>{String(c.next ?? "—")}</strong> {c.unit}</td><td>{c.actorName ?? "—"}<div className="pm-muted">{c.actorRole}</div></td><td>{c.reason ?? ""}{c.reference && <div className="pm-muted">{c.reference}</div>}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="pm-empty">{t("No recorded changes yet.", "لا توجد تعديلات مسجلة بعد.")}</div>)}

        {tab === "protocols" && (d.protocols.length ? (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>{t("Protocol", "البروتوكول")}</th><th>{t("Link", "الربط")}</th><th>{t("Current revision", "المراجعة الحالية")}</th></tr></thead>
              <tbody>{d.protocols.map(p => <tr key={p.protocolId}><td><strong>{p.protocolNumber}</strong><div className="pm-muted">{p.title}</div></td><td>{p.association === "link" ? t("Equipment link", "ربط بالجهاز") : t("Model association", "ارتباط بالموديل")}</td><td><span className={`pm-badge ${p.revisionStatus === "released" ? "pm-tone-ok" : "pm-tone-warn"}`}>{p.revisionStatus}</span></td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="pm-empty">{t("No protocols are linked to this equipment.", "لا توجد بروتوكولات مرتبطة بهذا الجهاز.")}</div>)}

        {tab === "runs" && (d.runs.length ? (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>{t("Run", "التشغيل")}</th><th>{t("Protocol", "البروتوكول")}</th><th>{t("Status", "الحالة")}</th><th>{t("Updated", "آخر تحديث")}</th></tr></thead>
              <tbody>{d.runs.map(r => <tr key={r.id}><td>{r.runNumber}</td><td>{r.protocolNumber} Rev {r.revisionNumber}</td><td>{r.status}{r.outdated && <> <span className="pm-badge pm-tone-warn">{t("newer equipment data", "بيانات جهاز أحدث")}</span></>}</td><td>{fmtDate(r.updatedAt, true)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="pm-empty">{t("No calibration runs for this equipment.", "لا توجد تشغيلات معايرة لهذا الجهاز.")}</div>)}
      </Panel>
    </>
  );
}

/* ------------------------------ create ------------------------------ */

function CreateEquipment({ lang, all, onDone, onCancel }: { lang: Lang; all: EquipmentItem[]; onDone: (key: string) => void; onCancel: () => void }) {
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const utils = trpc.useUtils();
  const [key, setKey] = useState("");
  const [type, setType] = useState(Object.keys(SPEC_CATALOG)[0]);
  const [identity, setIdentity] = useState<EquipmentIdentity>(EMPTY_IDENTITY);
  const [specs, setSpecs] = useState<SpecMap>({});
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const create = trpc.protocols.createEquipment.useMutation();
  const defs = specDefinitions(type);
  const clean = normSpecs(specs);
  const issues = specIssues(type, clean);
  const dupes = duplicateProblems(identity, all, null);
  const keyOk = /^[a-z][a-z0-9-]{1,63}$/.test(key) && !all.some(e => e.instrumentKey === key);
  const required = REQUIRED_IDENTITY_KEYS.filter(k => !identity[k].trim());
  const ok = keyOk && !issues.length && !dupes.length && !required.length && reason.trim().length >= 3 && !create.isPending;
  return (
    <Panel title={t("Register new equipment", "تسجيل جهاز جديد")} actions={<button type="button" className="pm-btn small" onClick={onCancel}>{t("Cancel", "إلغاء")}</button>}>
      <div className="pm-grid">
        <div className="pm-grid c3">
          <Field label={t("Equipment key *", "مفتاح الجهاز *")} hint={keyOk || !key ? "lowercase, digits, - (e.g. balance-2)" : t("Invalid or already used", "غير صالح أو مستخدم")}><input value={key} onChange={e => setKey(e.target.value.toLowerCase())} dir="ltr" /></Field>
          <Field label={t("Equipment type *", "نوع الجهاز *")}><select value={type} onChange={e => { setType(e.target.value); setSpecs({}); }}>{Object.keys(SPEC_CATALOG).map(k => <option key={k}>{k}</option>)}</select></Field>
        </div>
        <div className="pm-grid c4">
          {IDENTITY_FIELDS.map(f => <Field key={f.key} label={`${lang === "ar" ? f.labelAr : f.label}${(REQUIRED_IDENTITY_KEYS as readonly string[]).includes(f.key) ? " *" : ""}`}><input value={identity[f.key]} onChange={e => setIdentity(i => ({ ...i, [f.key]: e.target.value }))} dir={f.key === "nameAr" ? "rtl" : "ltr"} /></Field>)}
        </div>
        {SPEC_GROUPS.map(g => {
          const gd = defs.filter(x => x.group === g.key);
          if (!gd.length) return null;
          return <div key={g.key}><h3>{lang === "ar" ? g.labelAr : g.label}</h3><div className="pm-grid c3">{gd.map(def => <SpecInput key={def.key} def={def} lang={lang} disabled={false} changed={false} value={specs[def.key]} onChange={v => setSpecs(s => { const n = { ...s }; if (v) n[def.key] = v; else delete n[def.key]; return n; })} />)}</div></div>;
        })}
        {(issues.length > 0 || dupes.length > 0) && <div className="pm-alert pm-alert-bad"><AlertTriangle size={16} /><div><ul>{[...dupes, ...issues.map(i => i.message)].map((m, i) => <li key={i}>{m}</li>)}</ul></div></div>}
        <div className="pm-grid c2">
          <Field label={t("Reason *", "السبب *")}><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <Field label={t("Reference", "المرجع")}><input value={reference} onChange={e => setReference(e.target.value)} /></Field>
        </div>
        <div>
          <button type="button" className="pm-btn primary" disabled={!ok} onClick={async () => {
            try {
              await create.mutateAsync({ instrumentKey: key, equipmentType: type, identity, specs: clean, reason, reference });
              toast.success(t("Equipment registered", "تم تسجيل الجهاز"));
              await utils.protocols.equipmentData.invalidate();
              onDone(key);
            } catch (e) { toast.error(errorText(e)); }
          }}><Plus size={14} /> {t("Register equipment", "تسجيل الجهاز")}</button>
          {required.length > 0 && <span className="pm-muted"> {t("Required:", "مطلوب:")} {required.join(", ")}</span>}
        </div>
      </div>
    </Panel>
  );
}
