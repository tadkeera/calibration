import { useState } from "react";
import { Activity, Filter, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Language = "ar" | "en";
type EventType = "login_succeeded" | "login_failed" | "account_disabled" | "account_enabled" | "password_changed" | "recovery_requested";
const labels: Record<EventType, { ar: string; en: string; tone: string }> = {
  login_succeeded: { ar: "دخول ناجح", en: "Successful sign-in", tone: "success" },
  login_failed: { ar: "دخول مرفوض", en: "Rejected sign-in", tone: "danger" },
  account_disabled: { ar: "تعطيل حساب", en: "Account disabled", tone: "danger" },
  account_enabled: { ar: "إعادة تفعيل", en: "Account reactivated", tone: "success" },
  password_changed: { ar: "تغيير كلمة المرور", en: "Password changed", tone: "warning" },
  recovery_requested: { ar: "طلب استعادة", en: "Recovery requested", tone: "warning" },
};

export function AdminActivityLog({ language }: { language: Language }) {
  const [filters, setFilters] = useState<{ eventType?: EventType; dateFrom?: string; dateTo?: string }>({});
  const ar = language === "ar";
  const query = trpc.adminActivities.list.useQuery(filters);
  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => setFilters((current) => ({ ...current, [key]: value || undefined }));
  return <div className="page-enter admin-activity-page"><section className="page-topline"><div><span className="eyebrow">{ar ? "رقابة الوصول" : "ACCESS OVERSIGHT"}</span><h1>{ar ? "سجل الأنشطة الإدارية" : "Administrative activity log"}</h1><p>{ar ? "تتبّع محاولات الدخول وطلبات استعادة كلمة المرور وتغييرات حالة الحسابات ضمن سجل مستقل." : "Review sign-in attempts, password recovery requests, and account-state changes in a separate administrative register."}</p></div><div className="page-topline-icon"><Activity size={26} /></div></section><section className="activity-filter-panel"><div className="record-filter-heading"><Filter size={19} /><strong>{ar ? "مرشحات النشاط" : "Activity filters"}</strong></div><div className="activity-filter-fields"><label className="field"><span>{ar ? "نوع الحدث" : "Event type"}</span><select value={filters.eventType ?? ""} onChange={(event) => setFilter("eventType", event.target.value === "" ? undefined : event.target.value as EventType)}><option value="">{ar ? "كل الأحداث" : "All events"}</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{ar ? label.ar : label.en}</option>)}</select></label><label className="field"><span>{ar ? "من تاريخ" : "From"}</span><input type="date" value={filters.dateFrom ?? ""} onChange={(event) => setFilter("dateFrom", event.target.value)} /></label><label className="field"><span>{ar ? "إلى تاريخ" : "To"}</span><input type="date" value={filters.dateTo ?? ""} onChange={(event) => setFilter("dateTo", event.target.value)} /></label></div><button type="button" className="quiet-button filter-reset" onClick={() => setFilters({})}><RotateCcw size={15} /> {ar ? "إعادة ضبط" : "Reset"}</button></section><section className="admin-activity-register">{query.isLoading ? <div className="records-loading"><Loader2 className="animate-spin" size={20} /> {ar ? "جارٍ تحميل الأنشطة…" : "Loading activity…"}</div> : query.data?.length ? <div className="activity-list">{query.data.map((event) => { const label = labels[event.eventType]; return <article key={event.id}><span className={`activity-icon ${label.tone}`}><ShieldAlert size={16} /></span><div><strong>{ar ? label.ar : label.en}</strong><p>{event.summary}</p><small>{event.actorName ? `${ar ? "بواسطة" : "by"} ${event.actorName} · ` : ""}{event.subjectName ? `${ar ? "الحساب" : "account"}: ${event.subjectName} · ` : ""}{event.email ?? ""}</small></div><time>{new Intl.DateTimeFormat(ar ? "ar-YE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</time></article>; })}</div> : <div className="records-empty"><ShieldAlert size={24} /><p>{ar ? "لا توجد أحداث تطابق المرشحات الحالية." : "No activity matches the current filters."}</p></div>}</section></div>;
}
