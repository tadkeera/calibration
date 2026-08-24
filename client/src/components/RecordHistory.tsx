/** Design reminder: archived results are presented as an orderly register, with the audit trail treated as evidence rather than decoration. */
import { useState } from "react";
import { Check, Download, FileText, History, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CalibrationResult, findDevice } from "@/lib/qc";
import { downloadOfficialPdf } from "@/lib/officialPdf";

type Language = "ar" | "en";
const copy = {
  ar: { eyebrow: "الأرشيف المحفوظ", title: "سجل الفحوصات والاعتمادات", desc: "تعرض هذه الصفحة السجلات المرتبطة بحسابك. يرى المدير سجلات الفريق كاملة ويمكنه اعتماد المسودات أو رفضها.", loading: "جارٍ تحميل السجلات…", empty: "لا توجد سجلات محفوظة حتى الآن.", table: ["الجهاز", "النتيجة", "الحالة", "المنشئ", "التاريخ", "الإجراء"], open: "عرض", trail: "سجل التدقيق", approve: "اعتماد", reject: "رفض", pdf: "PDF رسمي", signIn: "سجل الدخول لاستعراض السجل المحفوظ.", pending: "مسودة", approved: "معتمد", rejected: "مرفوض", pass: "مطابق", fail: "فشل", noEvents: "لا توجد أحداث تدقيق بعد." },
  en: { eyebrow: "SAVED ARCHIVE", title: "Validation records & approvals", desc: "This screen lists the records linked to your account. Administrators can view the team register and decide draft records.", loading: "Loading records…", empty: "No saved validation records yet.", table: ["Instrument", "Result", "State", "Owner", "Date", "Action"], open: "Open", trail: "Audit trail", approve: "Approve", reject: "Reject", pdf: "Official PDF", signIn: "Sign in to review saved records.", pending: "Draft", approved: "Approved", rejected: "Rejected", pass: "Pass", fail: "Fail", noEvents: "No audit events yet." },
} as const;

function statusText(status: "draft" | "approved" | "rejected", language: Language) {
  const text = copy[language];
  return status === "draft" ? text.pending : status === "approved" ? text.approved : text.rejected;
}

export function RecordHistory({ language, isAuthenticated, isAdmin, userName }: { language: Language; isAuthenticated: boolean; isAdmin: boolean; userName?: string | null }) {
  const t = copy[language];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const recordsQuery = trpc.records.list.useQuery(undefined, { enabled: isAuthenticated });
  const selectedRecord = trpc.records.get.useQuery({ id: selectedId ?? 0 }, { enabled: Boolean(selectedId) && isAuthenticated });
  const trailQuery = trpc.records.trail.useQuery({ id: selectedId ?? 0 }, { enabled: Boolean(selectedId) && isAuthenticated });
  const decideMutation = trpc.records.decide.useMutation({ onSuccess: () => { utils.records.list.invalidate(); utils.records.get.invalidate(); utils.records.trail.invalidate(); toast.success(language === "ar" ? "تم تسجيل قرار الاعتماد في سجل التدقيق." : "Approval decision recorded in the audit trail."); } });
  const exportedMutation = trpc.records.markExported.useMutation();

  const exportPdf = async () => {
    const record = selectedRecord.data;
    if (!record) return;
    const device = findDevice(record.instrumentKey as Parameters<typeof findDevice>[0]);
    await downloadOfficialPdf({ device, result: record.resultData as unknown as CalibrationResult, pharmacistName: record.pharmacistName, lifecycleStatus: record.lifecycleStatus, approvedByName: record.approvedByUserId ? userName : null, approvedAt: record.approvedAt, language });
    await exportedMutation.mutateAsync({ id: record.id });
    utils.records.trail.invalidate({ id: record.id });
  };

  if (!isAuthenticated) return <section className="archive-empty"><ShieldCheck size={25} /><div><span className="eyebrow">{t.eyebrow}</span><h2>{t.signIn}</h2></div></section>;
  return <div className="page-enter records-page"><section className="page-topline"><div><span className="eyebrow">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.desc}</p></div><div className="page-topline-icon"><History size={25} /></div></section><section className="records-register">{recordsQuery.isLoading ? <div className="records-loading"><Loader2 className="animate-spin" size={19} /> {t.loading}</div> : recordsQuery.data?.length ? <div className="table-scroll"><table className="records-table"><thead><tr>{t.table.map((item) => <th key={item}>{item}</th>)}</tr></thead><tbody>{recordsQuery.data.map((record) => <tr key={record.id} className={selectedId === record.id ? "selected" : ""}><td><strong>{record.instrumentName}</strong><small>{record.instrumentId} · {record.sopNumber}</small></td><td><span className={record.resultStatus === "pass" ? "record-result pass" : "record-result fail"}>{record.resultStatus === "pass" ? <Check size={13} /> : <X size={13} />}{record.resultStatus === "pass" ? t.pass : t.fail}</span></td><td><span className={`lifecycle ${record.lifecycleStatus}`}>{statusText(record.lifecycleStatus, language)}</span></td><td>{record.pharmacistName}</td><td>{new Intl.DateTimeFormat(language === "ar" ? "ar-YE" : "en-GB", { dateStyle: "medium" }).format(new Date(record.createdAt))}</td><td><button className="record-open" onClick={() => setSelectedId(record.id)}>{t.open}</button></td></tr>)}</tbody></table></div> : <div className="records-empty"><FileText size={24} /><p>{t.empty}</p></div>}</section>{selectedRecord.data && <section className="record-detail"><div className="record-detail-header"><div><span className="eyebrow">{t.trail}</span><h2>{selectedRecord.data.instrumentName} <small>{selectedRecord.data.instrumentId}</small></h2></div><div className="record-detail-actions"><button className="secondary-button" onClick={exportPdf} disabled={exportedMutation.isPending}><Download size={16} /> {t.pdf}</button>{isAdmin && selectedRecord.data.lifecycleStatus === "draft" && <><button className="secondary-button decision-reject" onClick={() => decideMutation.mutate({ id: selectedRecord.data!.id, decision: "rejected" })}><X size={16} /> {t.reject}</button><button className="primary-button" onClick={() => decideMutation.mutate({ id: selectedRecord.data!.id, decision: "approved" })}><Check size={16} /> {t.approve}</button></>}</div></div><div className="audit-trail">{trailQuery.isLoading ? <Loader2 className="animate-spin" size={18} /> : trailQuery.data?.length ? trailQuery.data.map((event) => <article className="audit-event" key={event.id}><span className={`audit-dot ${event.action}`} /><div><strong>{event.summary}</strong><p>{event.actorName ? `${event.actorName} · ` : ""}{new Intl.DateTimeFormat(language === "ar" ? "ar-YE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</p></div><span>{event.action}</span></article>) : <p className="muted-copy">{t.noEvents}</p>}</div></section>}</div>;
}
