/**
 * «الإعدادات والحدود» — read-only view of the settings and acceptance limits
 * of the equipment protocols, taken directly from the protocol stored in the
 * database (no local copies, no hardcoded limits, nothing editable here).
 *
 *  - Initially the HPLC only (LIMITS_EQUIPMENT); more equipment can be added
 *    to the list without code changes to the display.
 *  - Shows the active approved revision when one exists; otherwise the current
 *    draft, clearly labelled as NOT in force (pending Quality Manager approval).
 *  - Changes are made on the Protocol page (new revision + approval).
 *  - The legacy per-device settings are no longer shown; they remain stored.
 */
import { useState } from "react";
import { AlertTriangle, BookOpenCheck, CheckCircle2, SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { describeLimit } from "@shared/protocols/evaluate";
import { DATA_TYPES, SOURCE_CLASSES, type ProtocolTest } from "@shared/protocols/model";
import { ErrorBox, Loading, Panel, fmtDate, type RevisionDetailDto } from "./common";
import "./protocols.css";

type Lang = "ar" | "en";

/** Equipment shown on the page (Equipment Master instrument keys). */
export const LIMITS_EQUIPMENT = ["hplc"] as const;

const rev2 = (n: number) => `Rev.${String(n).padStart(2, "0")}`;

export function ProtocolLimitsPage({ language = "ar" }: { language?: Lang }) {
  const t = (en: string, ar: string) => (language === "ar" ? ar : en);
  const [instrumentKey, setInstrumentKey] = useState<string>(LIMITS_EQUIPMENT[0]);
  return (
    <div className="pm-root page-enter" dir={language === "ar" ? "rtl" : "ltr"}>
      <section className="page-topline">
        <div>
          <span className="eyebrow">{t("PROTOCOL SETTINGS & ACCEPTANCE LIMITS", "إعدادات البروتوكول وحدود القبول")}</span>
          <h1>{t("Limits & settings", "الإعدادات والحدود")}</h1>
          <p>{t("Read-only. All values come from the equipment protocol stored in the database. Changes are made only on the Protocol page (new revision + Quality Manager approval).", "للعرض فقط. جميع القيم مأخوذة من بروتوكول الجهاز المخزَّن في قاعدة البيانات. لا يتم التعديل إلا من صفحة البروتوكول (مراجعة جديدة + اعتماد مدير الجودة).")}</p>
        </div>
        <div className="page-topline-icon"><SlidersHorizontal size={26} /></div>
      </section>
      {LIMITS_EQUIPMENT.length > 1 && (
        <nav className="pm-tabs" style={{ marginBottom: 12 }}>
          {LIMITS_EQUIPMENT.map(k => <button key={k} type="button" className={instrumentKey === k ? "is-active" : ""} onClick={() => setInstrumentKey(k)}>{k}</button>)}
        </nav>
      )}
      <EquipmentLimits key={instrumentKey} instrumentKey={instrumentKey} lang={language} />
    </div>
  );
}

function EquipmentLimits({ instrumentKey, lang }: { instrumentKey: string; lang: Lang }) {
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const q = trpc.protocols.forEquipment.useQuery({ instrumentKey }, { retry: false });
  const p = q.data?.protocol ?? null;
  const shown = p?.activeRevision ?? p?.draftRevision ?? null;
  const rq = trpc.protocols.revision.useQuery({ revisionId: shown?.id ?? "" }, { enabled: !!shown });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const eq = q.data!.equipment;
  if (!p || !shown) return <div className="pm-alert pm-alert-warn"><AlertTriangle size={16} /><div>{t("No protocol is registered for this equipment.", "لا يوجد بروتوكول مسجّل لهذا الجهاز.")}</div></div>;
  if (rq.isLoading) return <Loading />;
  if (rq.error) return <ErrorBox error={rq.error} />;
  const r = rq.data!;
  const active = !!p.activeRevision && shown.id === p.activeRevision.id;
  return (
    <>
      <Panel
        title={<>{eq?.identity.instrumentId} — {lang === "ar" ? eq?.identity.nameAr || eq?.identity.nameEn : eq?.identity.nameEn} <span className="pm-muted">· {eq?.identity.manufacturer} {eq?.identity.model} · S/N {eq?.identity.serialNumber || "—"}</span></>}
        actions={<span className={`pm-badge ${active ? "pm-tone-ok" : "pm-tone-warn"}`}>{active ? t("Approved — in force", "معتمد — ساري") : t("Draft — pending approval", "مسودة — بانتظار الاعتماد")}</span>}
      >
        <div className="pm-grid c3">
          <Info label={t("Protocol", "البروتوكول")} value={`${p.number} ${rev2(r.revision.revisionNumber)}`} />
          <Info label={t("Title", "العنوان")} value={p.title} />
          <Info label={active ? t("Approved", "تاريخ الاعتماد") : t("Last update", "آخر تحديث")} value={active ? `${fmtDate(p.activeRevision!.approvedAt)}${p.activeRevision!.approvedBy ? ` · ${p.activeRevision!.approvedBy}` : ""}` : fmtDate(r.revision.updatedAt, true)} />
        </div>
        {active ? (
          <div className="pm-alert pm-alert-ok" style={{ marginTop: 10 }}><CheckCircle2 size={16} /><div>{t("These limits are used by New Validation for this equipment.", "هذه الحدود هي التي يستخدمها التحقق الجديد لهذا الجهاز.")}{p.draftRevision ? ` ${t(`A newer draft (${rev2(p.draftRevision.revisionNumber)}) exists and is not yet in force.`, `توجد مسودة أحدث (${rev2(p.draftRevision.revisionNumber)}) غير سارية بعد.`)}` : ""}</div></div>
        ) : (
          <div className="pm-alert pm-alert-warn" style={{ marginTop: 10 }}><AlertTriangle size={16} /><div>{t("No approved revision yet: the values below are the current DRAFT, shown for information only. They are not in force and New Validation is not available until the Quality Manager approves the protocol.", "لا توجد مراجعة معتمدة بعد: القيم أدناه من المسودة الحالية وللاطلاع فقط. ليست سارية ولن يتاح التحقق الجديد حتى يعتمد مدير الجودة البروتوكول.")}</div></div>
        )}
      </Panel>
      <LimitsSummary r={r} lang={lang} />
      {r.revision.content.sections.flatMap(s => s.tests).map((test, i) => <TestLimits key={test.key} index={i + 1} test={test} r={r} lang={lang} />)}
      <Panel title={<><BookOpenCheck size={15} /> {t("Review notes recorded in the protocol", "ملاحظات المراجعة المسجّلة في البروتوكول")}</>}>
        {!r.revision.content.gaps.length ? <div className="pm-empty">—</div> : (
          <ul style={{ margin: 0 }}>{r.revision.content.gaps.map(g => <li key={g.key}><strong>{g.title}</strong>{g.assessment ? <div className="pm-muted">{g.assessment}</div> : null}</li>)}</ul>
        )}
      </Panel>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><div className="pm-muted" style={{ fontSize: 12 }}>{label}</div><strong>{value || "—"}</strong></div>;
}

const refNameOf = (r: RevisionDetailDto) => (id: string | null) => {
  if (!id) return "";
  const x = r.references.find(y => y.id === id);
  return x ? x.code : id;
};

function VerifyBadge({ verified, lang }: { verified: boolean; lang: Lang }) {
  return verified ? <span className="pm-badge pm-tone-ok">{lang === "ar" ? "متحقق" : "Verified"}</span> : <span className="pm-badge pm-tone-warn">{lang === "ar" ? "بانتظار التحقق من المصدر" : "Needs Source Verification"}</span>;
}

/** One line per acceptance criterion — the at-a-glance limits table. */
function LimitsSummary({ r, lang }: { r: RevisionDetailDto; lang: Lang }) {
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const refName = refNameOf(r);
  const tests = r.revision.content.sections.flatMap(s => s.tests);
  return (
    <Panel title={t("Acceptance limits — summary", "حدود القبول — ملخص")}>
      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead><tr><th>#</th><th>{t("Test", "الاختبار")}</th><th>{t("Parameter", "المعامل")}</th><th>{t("Acceptance limit", "حد القبول")}</th><th>{t("Source", "المصدر")}</th><th>{t("Verification", "التحقق")}</th></tr></thead>
          <tbody>
            {tests.flatMap((test, i) => {
              const rows = test.criteria.map((c, j) => (
                <tr key={`${test.key}/${c.key}`}>
                  {j === 0 && <td rowSpan={test.criteria.length + (test.advisories?.length ?? 0)}>{i + 1}</td>}
                  {j === 0 && <td rowSpan={test.criteria.length + (test.advisories?.length ?? 0)}><strong>{test.name}</strong></td>}
                  <td>{c.parameter}{c.levelKey ? <span className="pm-muted"> ({c.levelKey})</span> : null}</td>
                  <td><strong dir="ltr">{describeLimit(c)}</strong></td>
                  <td className="pm-muted">{[refName(c.referenceId), c.referenceClause].filter(Boolean).join(" · ") || SOURCE_CLASSES.find(s => s.id === c.sourceClass)?.label}</td>
                  <td><VerifyBadge verified={c.verificationStatus === "verified"} lang={lang} /></td>
                </tr>
              ));
              const adv = (test.advisories ?? []).map((a, j) => (
                <tr key={`${test.key}/adv/${a.key}`}>
                  {!test.criteria.length && j === 0 && <td rowSpan={test.advisories!.length}>{i + 1}</td>}
                  {!test.criteria.length && j === 0 && <td rowSpan={test.advisories!.length}><strong>{test.name}</strong></td>}
                  <td>{a.parameter}</td>
                  <td><strong dir="ltr">{a.comparison} {a.limit} {a.unit}</strong> <span className="pm-badge pm-tone-info">{t("advisory only", "تنبيه فقط")}</span></td>
                  <td className="pm-muted">{[refName(a.referenceId), a.referenceClause].filter(Boolean).join(" · ")}</td>
                  <td>—</td>
                </tr>
              ));
              if (!rows.length && !adv.length) return [<tr key={test.key}><td>{i + 1}</td><td><strong>{test.name}</strong></td><td colSpan={4} className="pm-muted">{t("No acceptance criterion", "لا يوجد معيار قبول")}</td></tr>];
              return [...rows, ...adv];
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Full read-only settings of one test: conditions, setpoints / levels, input fields, formulas, criteria. */
function TestLimits({ index, test, r, lang }: { index: number; test: ProtocolTest; r: RevisionDetailDto; lang: Lang }) {
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const refName = refNameOf(r);
  return (
    <Panel title={<>{index}. {test.name} <span className="pm-muted pm-mono" style={{ fontSize: 12 }}>{test.key}</span>{test.decisionRole === "informational" ? <> <span className="pm-badge pm-tone-info">{t("informational", "معلوماتي")}</span></> : null}</>}>
      <div className="pm-grid c3">
        <Info label={t("Source clause", "بند المصدر")} value={[...test.referenceIds.map(id => refName(id)), test.referenceClause].filter(Boolean).join(" · ")} />
        <Info label={t("Data type", "نوع البيانات")} value={DATA_TYPES.find(d => d.id === test.dataType)?.label ?? test.dataType} />
        <Info label={t("Readings", "عدد القراءات")} value={`${test.readingsRequired}${test.levels.length ? ` × ${test.levels.length} ${t("levels", "مستويات")}` : ""}${test.readingKeys?.length ? ` (${test.readingKeys.map(k => `${k.label || k.key}${k.unit ? ` [${k.unit}]` : ""}`).join(", ")})` : ""}`} />
      </div>
      {(test.conditions || test.method) && (
        <div style={{ marginTop: 10 }}>
          {test.conditions && <div><span className="pm-muted">{t("Conditions", "الظروف")}:</span> {test.conditions}</div>}
          {test.method && <div><span className="pm-muted">{t("Method", "الطريقة")}:</span> {test.method}</div>}
        </div>
      )}
      {test.levels.length > 0 && (
        <>
          <h4 style={{ margin: "12px 0 6px" }}>{test.levelName || t("Levels / setpoints", "المستويات / القيم المضبوطة")}</h4>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>{t("Key", "الرمز")}</th><th>{t("Label", "الوصف")}</th><th>{t("Setpoint / nominal", "القيمة الاسمية")}</th>{test.levels.some(l => l.group) && <th>{t("Group", "المجموعة")}</th>}<th>{t("Note", "ملاحظة")}</th></tr></thead>
              <tbody>{test.levels.map(l => <tr key={l.key}><td className="pm-mono">{l.key}</td><td>{l.label}</td><td dir="ltr"><strong>{l.nominal ?? "—"}</strong> {l.unit}</td>{test.levels.some(x => x.group) && <td>{l.group ?? ""}</td>}<td className="pm-muted">{l.referenceNote}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {test.fields.length > 0 && (
        <>
          <h4 style={{ margin: "12px 0 6px" }}>{t("Recorded fields", "الحقول المسجّلة")}</h4>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>{t("Field", "الحقل")}</th><th>{t("Type", "النوع")}</th><th>{t("Unit", "الوحدة")}</th><th>{t("Default (from protocol)", "القيمة الافتراضية (من البروتوكول)")}</th></tr></thead>
              <tbody>{test.fields.map(f => <tr key={f.key}><td>{f.label || f.key}</td><td>{f.type}</td><td>{f.unit || "—"}</td><td>{f.defaultValue ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {test.calculations.length > 0 && (
        <>
          <h4 style={{ margin: "12px 0 6px" }}>{t("Calculations", "الحسابات")}</h4>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead><tr><th>{t("Calculation", "الحساب")}</th><th>{t("Formula", "المعادلة")}</th><th>{t("Scope", "النطاق")}</th><th>{t("Unit", "الوحدة")}</th></tr></thead>
              <tbody>{test.calculations.map(c => <tr key={c.key}><td>{c.label || c.key}</td><td className="pm-mono" dir="ltr">{c.kind === "custom" ? c.formula : c.kind}</td><td>{c.scope === "per-level" ? t("per level", "لكل مستوى") : t("test", "الاختبار")}</td><td>{c.unit || "—"}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <h4 style={{ margin: "12px 0 6px" }}>{t("Acceptance criteria", "معايير القبول")}</h4>
      {!test.criteria.length && !(test.advisories ?? []).length ? <div className="pm-muted">{t("No acceptance criterion — recorded only.", "لا يوجد معيار قبول — للتسجيل فقط.")}</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>{t("Parameter", "المعامل")}</th><th>{t("Requirement", "المتطلب")}</th><th>{t("Limit", "الحد")}</th><th>{t("Source", "المصدر")}</th><th>{t("Verification", "التحقق")}</th></tr></thead>
            <tbody>
              {test.criteria.map(c => (
                <tr key={c.key}>
                  <td>{c.parameter}</td>
                  <td>{c.requirement}{c.conflictNote ? <div className="pm-muted" style={{ marginTop: 4 }}>⚠ {c.conflictNote}</div> : null}</td>
                  <td><strong dir="ltr">{describeLimit(c)}</strong></td>
                  <td className="pm-muted">{[refName(c.referenceId), c.referenceClause].filter(Boolean).join(" · ") || "—"}<div>{SOURCE_CLASSES.find(s => s.id === c.sourceClass)?.label ?? c.sourceClass}</div></td>
                  <td><VerifyBadge verified={c.verificationStatus === "verified"} lang={lang} /></td>
                </tr>
              ))}
              {(test.advisories ?? []).map(a => (
                <tr key={`adv-${a.key}`}>
                  <td>{a.parameter}</td>
                  <td>{a.alertMessage}</td>
                  <td><strong dir="ltr">{a.comparison} {a.limit} {a.unit}</strong> <span className="pm-badge pm-tone-info">{t("advisory — no PASS/FAIL", "تنبيه — لا يؤثر على النتيجة")}</span></td>
                  <td className="pm-muted">{[refName(a.referenceId), a.referenceClause].filter(Boolean).join(" · ") || "—"}</td>
                  <td>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
