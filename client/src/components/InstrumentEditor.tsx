import { useEffect, useState } from "react";
import { ClipboardPenLine, History, Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Device } from "@/lib/qc";

type Language = "ar" | "en";

type Props = { device: Device; language: Language; canEdit: boolean };

const copy = {
  ar: { eyebrow: "سجل الجهاز", title: "تعديل بيانات الجهاز", description: "تُطبَّق التعديلات على نماذج الفحص والتقارير اللاحقة، ويُسجَّل كل حفظ في تدقيق الجهاز.", edit: "تعديل بيانات الجهاز", save: "حفظ بيانات الجهاز", audit: "سجل تعديلات الجهاز", updated: "تم حفظ بيانات الجهاز في السجل المنضبط.", fields: ["الاسم بالعربية", "الاسم بالإنجليزية", "رقم الجهاز", "رقم SOP", "الشركة المصنعة", "الطراز", "الرقم التسلسلي", "رقم النموذج", "لون الجهاز"] },
  en: { eyebrow: "INSTRUMENT REGISTER", title: "Edit instrument profile", description: "Updates apply to future validation forms and reports. Each save is recorded in the instrument audit trail.", edit: "Edit instrument profile", save: "Save instrument profile", audit: "Instrument change audit", updated: "Instrument profile saved to the controlled register.", fields: ["Arabic name", "English name", "Instrument ID", "SOP number", "Manufacturer", "Model", "Serial number", "Form number", "Instrument color"] },
} as const;

function valuesFrom(device: Device) {
  return { instrumentKey: device.key, nameAr: device.name, nameEn: device.english, instrumentId: device.id, sopNumber: device.sop, manufacturer: device.manufacturer, model: device.model, serialNumber: device.serial, formNumber: device.form, accent: device.accent };
}

export function InstrumentEditor({ device, language, canEdit }: Props) {
  const text = copy[language];
  const [open, setOpen] = useState(false);
  const [showTrail, setShowTrail] = useState(false);
  const [form, setForm] = useState(() => valuesFrom(device));
  const utils = trpc.useUtils();
  const saveMutation = trpc.instruments.update.useMutation({ onSuccess: () => { utils.instruments.list.invalidate(); utils.instruments.trail.invalidate({ instrumentKey: device.key }); toast.success(text.updated); setOpen(false); } });
  const trailQuery = trpc.instruments.trail.useQuery({ instrumentKey: device.key }, { enabled: canEdit && showTrail });

  useEffect(() => setForm(valuesFrom(device)), [device]);
  if (!canEdit) return null;
  const keys = ["nameAr", "nameEn", "instrumentId", "sopNumber", "manufacturer", "model", "serialNumber", "formNumber"] as const;
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return <section className="instrument-editor">
    <div className="instrument-editor-head"><div><span className="eyebrow">{text.eyebrow}</span><h3>{text.title}</h3><p>{text.description}</p></div><button type="button" className="secondary-button" onClick={() => setOpen((current) => !current)}><ClipboardPenLine size={16} /> {text.edit}</button></div>
    {open && <div className="instrument-editor-form"><div className="instrument-editor-fields">{keys.map((key, index) => <label className="field" key={key}><span>{text.fields[index]}</span><input value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>)}<label className="field"><span>{text.fields[8]}</span><input type="color" value={form.accent} onChange={(event) => update("accent", event.target.value)} /></label></div><div className="instrument-editor-actions"><button type="button" className="primary-button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(form)}>{saveMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} {text.save}</button><button type="button" className="quiet-button" onClick={() => setShowTrail((current) => !current)}><History size={16} /> {text.audit}</button></div></div>}
    {showTrail && <div className="instrument-change-trail">{trailQuery.isLoading ? <Loader2 className="animate-spin" size={17} /> : trailQuery.data?.length ? trailQuery.data.map((event) => <article key={event.id}><span className="small-symbol"><ShieldCheck size={14} /></span><div><strong>{event.editorName ?? "Administrator"}</strong><p>{new Intl.DateTimeFormat(language === "ar" ? "ar-YE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</p></div></article>) : <p>{language === "ar" ? "لا توجد تعديلات مسجلة لهذا الجهاز بعد." : "No instrument changes have been recorded yet."}</p>}</div>}
  </section>;
}
