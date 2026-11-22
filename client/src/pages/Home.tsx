/** Design reminder: the protected register keeps the existing "دفتر المختبر الأخضر" character while adding evidence, accountability, and bilingual controls. */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  ArrowUpLeft,
  BookOpenCheck,
  Check,
  ChevronLeft,
  ClipboardCheck,
  Download,
  FileStack,
  Wrench,
  FileText,
  FlaskConical,
  History,
  KeyRound,
  Languages,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { InstrumentEditor } from "@/components/InstrumentEditor";
import { QCChart } from "@/components/QCChart";
import { RecordHistory } from "@/components/RecordHistory";
import { LocalLogin } from "@/components/LocalLogin";
import { UserManagement } from "@/components/UserManagement";
import { AccountSecurity } from "@/components/AccountSecurity";
import { AdminActivityLog } from "@/components/AdminActivityLog";
import { startLogin } from "@/const";

// The Protocol page and the protocol-driven New Validation are large,
// self-contained modules: load them only when opened.
const ProtocolPage = lazy(() =>
  import("@/components/protocols/ProtocolPage").then(m => ({
    default: m.ProtocolPage,
  }))
);
const ProtocolValidation = lazy(() =>
  import("@/components/protocols/ProtocolValidation").then(m => ({
    default: m.ProtocolValidation,
  }))
);
const EquipmentDataPage = lazy(() =>
  import("@/components/protocols/EquipmentDataPage").then(m => ({
    default: m.EquipmentDataPage,
  }))
);
/** Exact page title required by the user: English "Equipment Settings" (shown in both interface languages). */
const EQUIPMENT_PAGE_TITLE = "Equipment Settings";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  applyDeviceProfileOverrides,
  Device,
  DeviceKey,
  cloneSettings,
  devices,
  findDevice,
} from "@/lib/qc";

type Page =
  | "dashboard"
  | "calibration"
  | "settings"
  | "history"
  | "account"
  | "users"
  | "activity"
  | "protocols"
  | "equipment";
type Language = "ar" | "en";
const storageKey = "yemen-qc-settings-v1";

const text = {
  ar: {
    app: "نظام التحقق المخبري",
    lab: "المختبر الوطني للرقابة الدوائية",
    city: "الهيئة العليا للأدوية — عدن",
    nav: [
      "لوحة التحكم",
      "إجراء معايرة",
      "الإعدادات والحدود",
      "السجلات والتدقيق",
    ],
    pages: ["لوحة التحكم", "إجراء معايرة", "الإعدادات", "السجلات"],
    session: "جلسة محمية",
    signIn: "تسجيل الدخول",
    signOut: "تسجيل الخروج",
    new: "بدء فحص جديد",
    standards: "مراجعة المعايير",
    hero: ["سجّل القراءات،", "ثم ثبّت قرار التحقق."],
    heroBody:
      "مساحة عمل موحدة لمتابعة معايرة الأجهزة وتحويل القياسات اليومية إلى نتائج مطابقة لحدود SOP المعتمدة.",
    records: "سجل الأجهزة",
    choose: "ابدأ من الجهاز المطلوب",
    chooseDesc: "تنتقل كل بطاقة مباشرةً إلى نموذج القياسات والحدود الخاصة بها.",
    allForms: "عرض كل النماذج",
    calibrationEyebrow: "إجراء معايرة جديدة",
    calibrationTitle: "محضر التحقق والمعايرة",
    calibrationDesc:
      "اختر الجهاز وسجّل القراءات الفعلية. لا تُحسم النتيجة إلا عند تنفيذ الفحص.",
    selected: "الجهاز المحدد",
    switchDevice: "تغيير الجهاز",
    metadata: [
      "الرقم التعريفي",
      "رقم SOP",
      "الشركة المصنعة",
      "الطراز / الرقم التسلسلي",
    ],
    result: "نتيجة موثقة",
    resultPass: "كل القياسات ضمن حدود القبول",
    resultFail: "توجد قراءات خارج حدود القبول",
    detail: "تفاصيل القرار",
    record: "سجل الفحص",
    approval: "اعتماد التقرير",
    approvalDesc: "ثبّت مسؤول الفحص وقرار الاعتماد",
    pharmacist: "الصيدلاني الفاحص",
    decision: "القرار النهائي",
    approved: "نعم — Approved",
    rejected: "لا — Rejected",
    officialPdf: "PDF رسمي",
    save: "حفظ سجل الفحص",
    savedDraft: "سجل محفوظ كمسودة",
    saveSuccess: "تم حفظ سجل الفحص في القاعدة بنجاح.",
    loginSave: "سجّل الدخول للحفظ",
    settingsEyebrow: "إعدادات الجلسة",
    settingsTitle: "معايير وحدود القبول",
    settingsDesc: "تُحفظ هذه المعايير محلياً وتُستخدم في فحص الجلسة القادمة.",
    reset: "استعادة القيم الأصلية",
    settingsNote:
      "راجع وثائق SOP المعتمدة في المختبر قبل اعتماد أي تعديل تشغيلي.",
    language: "English",
    help: "مساعدة الاستخدام",
  },
  en: {
    app: "Laboratory validation system",
    lab: "National Quality Control Laboratory",
    city: "Supreme Board for Drugs — Aden",
    nav: [
      "Dashboard",
      "New validation",
      "Limits & settings",
      "Records & audit",
    ],
    pages: ["Dashboard", "New validation", "Settings", "Records"],
    session: "Protected session",
    signIn: "Sign in",
    signOut: "Sign out",
    new: "Start new validation",
    standards: "Review limits",
    hero: ["Record the readings,", "then confirm the validation decision."],
    heroBody:
      "One controlled workspace for equipment calibration and for translating routine measurements into SOP-bound decisions.",
    records: "Instrument register",
    choose: "Start with the required instrument",
    chooseDesc:
      "Each controlled record opens the measurements and limits dedicated to that instrument.",
    allForms: "All validation forms",
    calibrationEyebrow: "New validation",
    calibrationTitle: "Validation & calibration record",
    calibrationDesc:
      "Select the instrument and record the actual readings. The decision is only determined when the test runs.",
    selected: "Selected instrument",
    switchDevice: "Change instrument",
    metadata: [
      "ID number",
      "SOP number",
      "Manufacturer",
      "Model / serial number",
    ],
    result: "Documented outcome",
    resultPass: "Every reading is within the acceptance limits",
    resultFail: "One or more readings fall outside acceptance limits",
    detail: "Decision detail",
    record: "Test record",
    approval: "Report approval",
    approvalDesc: "Confirm the validating pharmacist and the decision state.",
    pharmacist: "Validated by",
    decision: "Decision",
    approved: "Yes — Approved",
    rejected: "No — Rejected",
    officialPdf: "Official PDF",
    save: "Save validation record",
    savedDraft: "Record saved as draft",
    saveSuccess: "Validation record saved to the database.",
    loginSave: "Sign in to save",
    settingsEyebrow: "Session settings",
    settingsTitle: "Acceptance criteria & limits",
    settingsDesc:
      "These limits are held locally and apply to the next test in this browser.",
    reset: "Restore original limits",
    settingsNote:
      "Review the approved laboratory SOP documentation before operationally accepting a change.",
    language: "العربية",
    help: "Usage help",
  },
} as const;

function statusChip(pass: boolean, label?: string) {
  return (
    <span className={pass ? "status-chip pass" : "status-chip fail"}>
      {pass ? <Check size={14} /> : <X size={14} />}
      {label ?? (pass ? "PASS" : "FAIL")}
    </span>
  );
}

function DeviceSelector({
  selected,
  onChange,
  language,
}: {
  selected: DeviceKey;
  onChange: (key: DeviceKey) => void;
  language: Language;
}) {
  const copy = text[language];
  return (
    <label className="device-select">
      <span>{copy.switchDevice}</span>
      <select
        value={selected}
        onChange={event => onChange(event.target.value as DeviceKey)}
      >
        {devices.map(device => (
          <option key={device.key} value={device.key}>
            {language === "ar" ? device.name : device.english} — {device.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function DeviceEntry({
  device,
  language,
  onChoose,
}: {
  device: Device;
  language: Language;
  onChoose: () => void;
}) {
  return (
    <button className="device-card" onClick={onChoose} type="button">
      <span className="device-card-mark" style={{ background: device.accent }}>
        <FlaskConical size={17} />
      </span>
      <span className="device-card-content">
        <span className="device-card-title">
          {language === "ar" ? device.name : device.english}
        </span>
        <span className="device-card-meta">
          {device.id} · {device.sop}
        </span>
      </span>
      <ChevronLeft size={17} className="device-card-arrow" />
    </button>
  );
}

function Dashboard({
  language,
  navigate,
  chooseDevice,
}: {
  language: Language;
  navigate: (page: Page) => void;
  chooseDevice: (key: DeviceKey) => void;
}) {
  const copy = text[language];
  const date = new Intl.DateTimeFormat(language === "ar" ? "ar-YE" : "en-GB", {
    dateStyle: "full",
  }).format(new Date());
  return (
    <div className="page-enter">
      <section className="hero-panel">
        <img
          src="/manus-storage/yemen-qc-lab-dashboard-hero_bfac1693.jpg"
          alt="Laboratory quality-control workspace"
        />
        <div className="hero-copy">
          <span className="eyebrow hero-eyebrow">{copy.lab} — Aden</span>
          <h1>
            {copy.hero[0]}
            <br />
            <em>{copy.hero[1]}</em>
          </h1>
          <p>{copy.heroBody}</p>
          <div className="hero-actions">
            <button
              className="primary-button"
              onClick={() => navigate("calibration")}
            >
              <ClipboardCheck size={18} /> {copy.new}
            </button>
            <button
              className="quiet-button"
              onClick={() => navigate("settings")}
            >
              {copy.standards} <ArrowUpLeft size={16} />
            </button>
          </div>
        </div>
        <div className="hero-stamp">
          <ShieldCheck size={19} />
          <span>
            {language === "ar" ? "سجل تحقق\nرقمي" : "Digital\nvalidation log"}
          </span>
        </div>
      </section>
      <section className="overview-row">
        <article>
          <span>
            {language === "ar" ? "الأجهزة المعتمدة" : "Approved instruments"}
          </span>
          <strong>08</strong>
          <small>
            {language === "ar" ? "تحليلية وفيزيائية" : "Analytical & physical"}
          </small>
        </article>
        <article>
          <span>
            {language === "ar" ? "معايير قابلة للتعديل" : "Editable limits"}
          </span>
          <strong>36+</strong>
          <small>
            {language === "ar" ? "قيمة وحدّ قبول" : "Values & limits"}
          </small>
        </article>
        <article>
          <span>
            {language === "ar" ? "السجلات المؤرشفة" : "Archived records"}
          </span>
          <strong>DB</strong>
          <small>
            {language === "ar" ? "مرتبطة بالحساب" : "Account-linked"}
          </small>
        </article>
        <article>
          <span>{language === "ar" ? "تاريخ العمل" : "Working date"}</span>
          <strong className="date-stat">{date}</strong>
          <small>
            {language === "ar" ? "جاهز للتوثيق" : "Ready to document"}
          </small>
        </article>
      </section>
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{copy.records}</span>
            <h2>{copy.choose}</h2>
            <p>{copy.chooseDesc}</p>
          </div>
          <button
            className="link-button"
            onClick={() => navigate("calibration")}
          >
            {copy.allForms} <ChevronLeft size={16} />
          </button>
        </div>
        <div className="devices-list">
          {devices.map(device => (
            <DeviceEntry
              key={device.key}
              device={device}
              language={language}
              onChoose={() => chooseDevice(device.key)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

const settingFields: Record<
  DeviceKey,
  { key: string; ar: string; en: string; step?: number }[]
> = {
  disintegration: [
    {
      key: "bathSet",
      ar: "الحرارة القياسية للحمام المائي °C",
      en: "Water bath set temperature °C",
    },
    {
      key: "bathTolerance",
      ar: "تفاوت حرارة الحمام ±°C",
      en: "Water bath tolerance ±°C",
    },
    {
      key: "mediumMin",
      ar: "الحد الأدنى لحرارة الوسط °C",
      en: "Medium minimum °C",
    },
    {
      key: "mediumMax",
      ar: "الحد الأقصى لحرارة الوسط °C",
      en: "Medium maximum °C",
    },
    {
      key: "cycleMin",
      ar: "الحد الأدنى للدورات rpm",
      en: "Minimum cycles rpm",
    },
    {
      key: "cycleMax",
      ar: "الحد الأقصى للدورات rpm",
      en: "Maximum cycles rpm",
    },
  ],
  refractometer: [
    {
      key: "zeroMin",
      ar: "الحد الأدنى — Zero",
      en: "Zero minimum",
      step: 0.00001,
    },
    {
      key: "zeroMax",
      ar: "الحد الأعلى — Zero",
      en: "Zero maximum",
      step: 0.00001,
    },
    {
      key: "spanMin",
      ar: "الحد الأدنى — Span",
      en: "Span minimum",
      step: 0.00001,
    },
    {
      key: "spanMax",
      ar: "الحد الأعلى — Span",
      en: "Span maximum",
      step: 0.00001,
    },
    {
      key: "rLimit",
      ar: "الحد الأدنى لمعامل R",
      en: "Minimum R factor",
      step: 0.01,
    },
  ],
  dissolution: [
    {
      key: "bathSet",
      ar: "حرارة الحمام المطلوبة °C",
      en: "Required bath temperature °C",
    },
    {
      key: "bathTolerance",
      ar: "تفاوت حرارة الحمام ±°C",
      en: "Water bath tolerance ±°C",
    },
    {
      key: "vesselMin",
      ar: "الحد الأدنى لحرارة الأوعية °C",
      en: "Vessel temperature minimum °C",
    },
    {
      key: "vesselMax",
      ar: "الحد الأعلى لحرارة الأوعية °C",
      en: "Vessel temperature maximum °C",
    },
    {
      key: "wobbleMax",
      ar: "الحد الأعلى للترنح mm",
      en: "Maximum wobble mm",
      step: 0.01,
    },
  ],
  hplc: [
    {
      key: "devLimit",
      ar: "الحد الأعلى للانحراف %",
      en: "Maximum deviation %",
    },
    { key: "rsdLimit", ar: "الحد الأعلى لـ RSD %", en: "Maximum RSD %" },
  ],
  spectrophotometer: [
    {
      key: "wavelengthAccuracy",
      ar: "الطول الموجي القياسي nm",
      en: "Reference wavelength nm",
    },
    {
      key: "wavelengthTolerance",
      ar: "تفاوت الطول الموجي ± nm",
      en: "Wavelength tolerance ± nm",
    },
    {
      key: "strayMin",
      ar: "الحد الأدنى للضوء الشارد",
      en: "Minimum stray light",
    },
    {
      key: "rLimit",
      ar: "الحد الأدنى لمعامل R",
      en: "Minimum R factor",
      step: 0.01,
    },
  ],
  moisture: [
    {
      key: "spanWeight",
      ar: "وزن Span القياسي g",
      en: "Span reference weight g",
      step: 0.001,
    },
    {
      key: "spanTolerance",
      ar: "تفاوت Span ±g",
      en: "Span tolerance ±g",
      step: 0.0001,
    },
    {
      key: "reproducibilityTolerance",
      ar: "تفاوت التكرارية ±g",
      en: "Reproducibility tolerance ±g",
      step: 0.0001,
    },
    {
      key: "offCenterTolerance",
      ar: "تفاوت الحمل اللامركزي ±g",
      en: "Off-center tolerance ±g",
      step: 0.0001,
    },
  ],
  polarimeter: [
    {
      key: "specificMin",
      ar: "الحد الأدنى للدوران النوعي °",
      en: "Specific rotation minimum °",
      step: 0.1,
    },
    {
      key: "specificMax",
      ar: "الحد الأعلى للدوران النوعي °",
      en: "Specific rotation maximum °",
      step: 0.1,
    },
    {
      key: "repeatTolerance",
      ar: "حد التكرارية (الوحدة حسب الطريقة)",
      en: "Repeatability limit (unit set by method)",
      step: 0.01,
    },
    {
      key: "rLimit",
      ar: "الحد الأدنى لمعامل R أو R²",
      en: "Minimum configured r / R²",
      step: 0.01,
    },
    {
      key: "tubeLength",
      ar: "طول الأنبوب dm",
      en: "Tube length dm",
      step: 0.1,
    },
    {
      key: "referenceTemperatureC",
      ar: "درجة الحرارة المرجعية °C",
      en: "Reference temperature °C",
      step: 0.1,
    },
    {
      key: "wavelengthNm",
      ar: "الطول الموجي المرجعي nm",
      en: "Reference wavelength nm",
      step: 0.1,
    },
  ],
  viscometer: [
    {
      key: "rLimit",
      ar: "الحد الأدنى لمعامل R",
      en: "Minimum R factor",
      step: 0.01,
    },
  ],
};

function PolarimeterProtocolSettings({
  settings,
  update,
  canEditLimits,
}: {
  settings: Record<string, any>;
  update: (key: string, value: unknown) => void;
  canEditLimits: boolean;
}) {
  const concentrations = Array.isArray(settings.linearityConcentrations)
    ? settings.linearityConcentrations
    : [10, 20, 30, 40];
  const [countText, setCountText] = useState(
    String(settings.requiredReadings ?? 6)
  );
  const [pointsText, setPointsText] = useState(concentrations.join(", "));
  const [referenceValueText, setReferenceValueText] = useState(
    settings.repeatReferenceValue == null
      ? ""
      : String(settings.repeatReferenceValue)
  );
  const [sopText, setSopText] = useState(
    String(settings.sopNumber ?? "QC-032D")
  );
  const [formText, setFormText] = useState(
    String(settings.formNumber ?? "QC-032B-01")
  );
  const numericFields = [
    {
      key: "specificMin",
      label: "Specific-rotation lower limit (°)",
      step: "any",
    },
    {
      key: "specificMax",
      label: "Specific-rotation upper limit (°)",
      step: "any",
    },
    {
      key: "repeatTolerance",
      label: "Repeatability tolerance (unit selected by method)",
      step: "any",
    },
    { key: "rLimit", label: "Minimum configured r or R²", step: "any" },
    { key: "tubeLength", label: "Polarimeter tube length (dm)", step: "any" },
    {
      key: "referenceTemperatureC",
      label: "Reference temperature (°C)",
      step: "any",
    },
    { key: "wavelengthNm", label: "Reference wavelength (nm)", step: "any" },
  ];
  const [numericText, setNumericText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      numericFields.map(field => [field.key, String(settings[field.key] ?? "")])
    )
  );
  useEffect(
    () =>
      setReferenceValueText(
        settings.repeatReferenceValue == null
          ? ""
          : String(settings.repeatReferenceValue)
      ),
    [settings.repeatReferenceValue]
  );
  useEffect(
    () => setSopText(String(settings.sopNumber ?? "QC-032D")),
    [settings.sopNumber]
  );
  useEffect(
    () => setFormText(String(settings.formNumber ?? "QC-032B-01")),
    [settings.formNumber]
  );
  useEffect(
    () =>
      setNumericText(
        Object.fromEntries(
          numericFields.map(field => [
            field.key,
            String(settings[field.key] ?? ""),
          ])
        )
      ),
    [
      settings.specificMin,
      settings.specificMax,
      settings.repeatTolerance,
      settings.rLimit,
      settings.tubeLength,
      settings.referenceTemperatureC,
      settings.wavelengthNm,
    ]
  );
  useEffect(
    () => setCountText(String(settings.requiredReadings ?? 6)),
    [settings.requiredReadings]
  );
  useEffect(
    () =>
      setPointsText(
        (Array.isArray(settings.linearityConcentrations)
          ? settings.linearityConcentrations
          : [10, 20, 30, 40]
        ).join(", ")
      ),
    [settings.linearityConcentrations]
  );
  const history = Array.isArray(settings.protocolHistory)
    ? settings.protocolHistory
    : [];
  const commitCount = () => {
    const value = Number(countText);
    if (!Number.isInteger(value) || value < 2 || value > 50) {
      toast.error(
        "Required repeatability count must be an integer from 2 to 50."
      );
      setCountText(String(settings.requiredReadings ?? 6));
      return;
    }
    update("requiredReadings", value);
  };
  const commitPoints = () => {
    const points = pointsText
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    if (
      points.length < 2 ||
      points.length > 20 ||
      points.some(value => !Number.isFinite(value) || value <= 0) ||
      new Set(points).size !== points.length
    ) {
      toast.error("Enter 2–20 unique positive nominal concentration points.");
      setPointsText(concentrations.join(", "));
      return;
    }
    update("linearityConcentrations", points);
  };
  const commitReferenceValue = () => {
    if (!referenceValueText.trim()) {
      update("repeatReferenceValue", null);
      return;
    }
    const value = Number(referenceValueText);
    if (!Number.isFinite(value)) {
      toast.error("Repeatability reference value must be a finite number.");
      setReferenceValueText(
        settings.repeatReferenceValue == null
          ? ""
          : String(settings.repeatReferenceValue)
      );
      return;
    }
    update("repeatReferenceValue", value);
  };
  const commitProtocolIdentifier = (
    key: "sopNumber" | "formNumber",
    value: string
  ) => {
    const normalized = value.trim();
    if (!normalized) {
      toast.error("Protocol SOP and form identifiers cannot be empty.");
      if (key === "sopNumber")
        setSopText(String(settings.sopNumber ?? "QC-032D"));
      else setFormText(String(settings.formNumber ?? "QC-032B-01"));
      return;
    }
    update(key, normalized);
  };
  const commitNumericSetting = (key: string) => {
    const raw = numericText[key] ?? "";
    const value = Number(raw);
    const otherLower =
      key === "specificMax"
        ? Number(settings.specificMin)
        : key === "specificMin"
          ? value
          : Number(settings.specificMin);
    const otherUpper =
      key === "specificMin"
        ? Number(settings.specificMax)
        : key === "specificMax"
          ? value
          : Number(settings.specificMax);
    const valid =
      raw.trim() !== "" &&
      Number.isFinite(value) &&
      ((key !== "specificMin" && key !== "specificMax") ||
        otherLower < otherUpper) &&
      (key !== "repeatTolerance" || value >= 0) &&
      (key !== "rLimit" || (value >= 0 && value <= 1)) &&
      ((key !== "tubeLength" && key !== "wavelengthNm") || value > 0);
    if (!valid) {
      toast.error(
        "Enter a finite value that preserves valid protocol limits (r/R² 0–1; positive tube length and wavelength)."
      );
      setNumericText(current => ({
        ...current,
        [key]: String(settings[key] ?? ""),
      }));
      return;
    }
    update(key, value);
  };
  return (
    <section className="polarimeter-protocol-editor" dir="ltr">
      <div className="polarimeter-protocol-editor-heading">
        <div>
          <span className="eyebrow">POLARIMETER PROTOCOL</span>
          <h3>
            {settings.protocolId ?? "POL-QC-032D"} · v
            {settings.protocolVersion ?? 1}
          </h3>
          <p>
            Changes create a new pending-verification version; the approved
            status cannot be set from this general settings form.
          </p>
        </div>
        <span className="protocol-state pending">PENDING VERIFICATION</span>
      </div>
      <div className="polarimeter-protocol-config-grid">
        <label className="field">
          <span>Protocol SOP number</span>
          <input
            type="text"
            disabled={!canEditLimits}
            value={sopText}
            onChange={event => setSopText(event.target.value)}
            onBlur={() => commitProtocolIdentifier("sopNumber", sopText)}
          />
        </label>
        <label className="field">
          <span>Protocol form number</span>
          <input
            type="text"
            disabled={!canEditLimits}
            value={formText}
            onChange={event => setFormText(event.target.value)}
            onBlur={() => commitProtocolIdentifier("formNumber", formText)}
          />
        </label>
        {numericFields.map(field => (
          <label className="field" key={field.key}>
            <span>{field.label}</span>
            <input
              type="number"
              step={field.step}
              disabled={!canEditLimits}
              value={numericText[field.key] ?? ""}
              onChange={event =>
                setNumericText(current => ({
                  ...current,
                  [field.key]: event.target.value,
                }))
              }
              onBlur={() => commitNumericSetting(field.key)}
            />
          </label>
        ))}
        <label className="field">
          <span>Required repeatability readings</span>
          <input
            type="number"
            min="2"
            max="50"
            step="1"
            disabled={!canEditLimits}
            value={countText}
            onChange={event => setCountText(event.target.value)}
            onBlur={commitCount}
          />
        </label>
        <label className="field">
          <span>Nominal linearity concentrations (g/100ml)</span>
          <input
            type="text"
            disabled={!canEditLimits}
            value={pointsText}
            onChange={event => setPointsText(event.target.value)}
            onBlur={commitPoints}
            placeholder="10, 20, 30, 40"
          />
        </label>
        <label className="field">
          <span>Repeatability evaluation method</span>
          <select
            disabled={!canEditLimits}
            value={settings.repeatabilityMethod ?? "first-reading-deviation"}
            onChange={event =>
              update("repeatabilityMethod", event.target.value)
            }
          >
            <option value="first-reading-deviation">
              Deviation from first reading
            </option>
            <option value="reference-value-deviation">
              Deviation from reference value
            </option>
            <option value="mean-deviation">Deviation from mean</option>
            <option value="maximum-range">Maximum permitted range</option>
            <option value="sample-standard-deviation">
              Sample standard deviation
            </option>
            <option value="rsd-percent">RSD percent</option>
          </select>
        </label>
        <label className="field">
          <span>Linearity acceptance metric</span>
          <select
            disabled={!canEditLimits}
            value={settings.linearityMetric ?? "r"}
            onChange={event => update("linearityMetric", event.target.value)}
          >
            <option value="r">Correlation coefficient r</option>
            <option value="r2">Coefficient of determination R²</option>
          </select>
        </label>
        <label className="field">
          <span>Repeatability reference value (°)</span>
          <input
            type="number"
            step="any"
            disabled={!canEditLimits}
            value={referenceValueText}
            onChange={event => setReferenceValueText(event.target.value)}
            onBlur={commitReferenceValue}
            placeholder="Required only for reference-value method"
          />
        </label>
        <label className="polarimeter-checkbox-field">
          <input
            type="checkbox"
            disabled={!canEditLimits}
            checked={settings.linearityUsesActualConcentration === true}
            onChange={event =>
              update("linearityUsesActualConcentration", event.target.checked)
            }
          />
          <span>
            Use measured actual concentration for the linearity X-axis
            (otherwise use nominal concentration).
          </span>
        </label>
        <label className="polarimeter-checkbox-field">
          <input
            type="checkbox"
            disabled={!canEditLimits}
            checked={settings.temperatureRequired === true}
            onChange={event =>
              update("temperatureRequired", event.target.checked)
            }
          />
          <span>Require measured temperature for each accuracy test.</span>
        </label>
        <label className="polarimeter-checkbox-field">
          <input
            type="checkbox"
            disabled={!canEditLimits}
            checked={settings.referenceStandardRequired === true}
            onChange={event =>
              update("referenceStandardRequired", event.target.checked)
            }
          />
          <span>
            Require reference-standard identifiers and certificate details.
          </span>
        </label>
      </div>
      <p className="polarimeter-protocol-editor-warning">
        <AlertTriangle size={15} /> Initial acceptance values and test
        assumptions remain Pending Verification until checked against the
        approved QC-032D SOP. Do not use this configuration for a successful
        formal approval before that gate is cleared.
      </p>
      {history.length > 0 && (
        <details className="polarimeter-protocol-history">
          <summary>Previous protocol configurations ({history.length})</summary>
          <ol>
            {history
              .slice()
              .reverse()
              .map((entry: any, index: number) => {
                const snapshot = entry.snapshot ?? {};
                return (
                  <li key={`${entry.protocolVersion ?? "version"}-${index}`}>
                    <strong>
                      Version {entry.protocolVersion ?? "unknown"}
                    </strong>{" "}
                    · {entry.changedAt ?? "Historical snapshot"} ·{" "}
                    {entry.protocolStatus ?? "pending-verification"}
                    {entry.changedByUserId
                      ? ` · prior version last saved by user ${entry.changedByUserId}`
                      : ""}
                    <details>
                      <summary>Review stored configuration snapshot</summary>
                      <p>
                        Specific rotation: {snapshot.specificMin ?? "—"} to{" "}
                        {snapshot.specificMax ?? "—"} ° · Repeatability:{" "}
                        {snapshot.repeatTolerance ?? "—"} (
                        {snapshot.repeatabilityMethod ?? "method not recorded"})
                        · Required readings: {snapshot.requiredReadings ?? "—"}
                      </p>
                      <p>
                        Linearity points:{" "}
                        {Array.isArray(snapshot.linearityConcentrations)
                          ? snapshot.linearityConcentrations.join(", ")
                          : "not recorded"}{" "}
                        · Metric: {snapshot.linearityMetric ?? "—"} · Tube
                        length: {snapshot.tubeLength ?? "—"} dm · Wavelength:{" "}
                        {snapshot.wavelengthNm ?? "—"} nm
                      </p>
                    </details>
                  </li>
                );
              })}
          </ol>
        </details>
      )}
    </section>
  );
}

function SettingsPage({
  deviceKey,
  setDeviceKey,
  settings,
  update,
  reset,
  language,
  canEditDevice,
  canEditLimits,
}: {
  deviceKey: DeviceKey;
  setDeviceKey: (key: DeviceKey) => void;
  settings: Record<DeviceKey, Record<string, any>>;
  update: (key: string, value: unknown) => void;
  reset: () => void;
  language: Language;
  canEditDevice: boolean;
  canEditLimits: boolean;
}) {
  const pageLanguage: Language = deviceKey === "polarimeter" ? "en" : language;
  const copy = text[pageLanguage];
  const device = findDevice(deviceKey);
  return (
    <div
      className="page-enter"
      dir={deviceKey === "polarimeter" ? "ltr" : undefined}
    >
      <section className="page-topline">
        <div>
          <span className="eyebrow">{copy.settingsEyebrow}</span>
          <h1>{copy.settingsTitle}</h1>
          <p>{copy.settingsDesc}</p>
        </div>
        <div className="page-topline-icon">
          <SlidersHorizontal size={26} />
        </div>
      </section>
      <section className="settings-shell">
        <div className="settings-side">
          <img
            src="/manus-storage/yemen-qc-lab-refractometer_7698add3.jpg"
            alt="Laboratory instrument"
          />
          <div>
            <span className="eyebrow">{copy.selected}</span>
            <h2>{pageLanguage === "ar" ? device.name : device.english}</h2>
            <p>
              {pageLanguage === "ar" ? "رقم النموذج" : "Form number"}{" "}
              {device.form}
            </p>
          </div>
          {statusChip(
            true,
            canEditLimits
              ? pageLanguage === "ar"
                ? "تعديل الحدود مسموح"
                : "Limit editing enabled"
              : pageLanguage === "ar"
                ? "قراءة فقط للحدود"
                : "Limits read-only"
          )}
        </div>
        <div className="settings-content">
          <DeviceSelector
            selected={deviceKey}
            onChange={setDeviceKey}
            language={pageLanguage}
          />
          {deviceKey !== "polarimeter" && (
            <div className="settings-fields">
              {settingFields[deviceKey].map(field => (
                <label className="field" key={field.key}>
                  <span>{pageLanguage === "ar" ? field.ar : field.en}</span>
                  <input
                    type="number"
                    disabled={!canEditLimits}
                    step={field.step ?? 0.1}
                    value={settings[deviceKey][field.key]}
                    onChange={event =>
                      update(field.key, Number(event.target.value))
                    }
                  />
                </label>
              ))}
            </div>
          )}
          {deviceKey === "polarimeter" && (
            <PolarimeterProtocolSettings
              settings={settings.polarimeter}
              update={update}
              canEditLimits={canEditLimits}
            />
          )}
          <div className="settings-actions">
            <div>
              <strong>
                {canEditLimits
                  ? pageLanguage === "ar"
                    ? "تحديث تلقائي"
                    : "Automatic update"
                  : pageLanguage === "ar"
                    ? "صلاحية قراءة"
                    : "Read-only access"}
              </strong>
              <p>
                {canEditLimits
                  ? pageLanguage === "ar"
                    ? "تطبق الحدود المعدلة في الفحص التالي."
                    : "Updated values apply to the next validation run."
                  : pageLanguage === "ar"
                    ? "تعديل الحدود ثابت للمدير فقط."
                    : "Only administrators can edit fixed limits."}
              </p>
            </div>
            {canEditLimits && (
              <button className="secondary-button" onClick={reset}>
                <ArchiveRestore size={16} /> {copy.reset}
              </button>
            )}
          </div>
        </div>
      </section>
      <InstrumentEditor
        device={device}
        language={pageLanguage}
        canEdit={canEditDevice}
      />
      <section className="standards-note">
        <BookOpenCheck size={22} />
        <div>
          <h3>{pageLanguage === "ar" ? "تنبيه تشغيلي" : "Operational note"}</h3>
          <p>{copy.settingsNote}</p>
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [activePage, setActivePage] = useState<Page>("dashboard");
  const [deviceKey, setDeviceKey] = useState<DeviceKey>("disintegration");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("yemen-qc-language") === "en" ? "en" : "ar"
  );
  const polarimeterEnglishMode =
    deviceKey === "polarimeter" &&
    (activePage === "calibration" || activePage === "settings");
  const interfaceLanguage: Language = polarimeterEnglishMode ? "en" : language;
  const copy = text[interfaceLanguage];
  const [settings, setSettings] = useState<
    Record<DeviceKey, Record<string, any>>
  >(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : cloneSettings();
    } catch {
      return cloneSettings();
    }
  });
  const instrumentProfilesQuery = trpc.instruments.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const validationSettingsQuery = trpc.settings.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const saveSettingsMutation = trpc.settings.save.useMutation({
    onSuccess: saved =>
      setSettings(current => ({
        ...current,
        [saved.deviceKey as DeviceKey]: {
          ...current[saved.deviceKey as DeviceKey],
          ...saved.settings,
        },
      })),
    onError: error => toast.error(error.message),
  });
  useMemo(
    () => applyDeviceProfileOverrides(instrumentProfilesQuery.data ?? []),
    [instrumentProfilesQuery.data]
  );
  useEffect(() => {
    if (!validationSettingsQuery.data?.length) return;
    setSettings(current => {
      const next = { ...current };
      validationSettingsQuery.data.forEach(entry => {
        if (entry.deviceKey in next)
          next[entry.deviceKey as DeviceKey] = {
            ...next[entry.deviceKey as DeviceKey],
            ...entry.settings,
          };
      });
      return next;
    });
  }, [validationSettingsQuery.data]);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("yemen-qc-language", language);
    document.documentElement.lang = interfaceLanguage;
    document.documentElement.dir = interfaceLanguage === "ar" ? "rtl" : "ltr";
  }, [language, interfaceLanguage]);
  useEffect(() => {
    if (
      user?.role !== "admin" &&
      (activePage === "users" || activePage === "activity")
    )
      setActivePage("dashboard");
  }, [activePage, user?.role]);
  const activeDevice = useMemo(() => findDevice(deviceKey), [deviceKey]);
  const navigate = (page: Page) => {
    setActivePage(page);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const chooseDevice = (key: DeviceKey) => {
    setDeviceKey(key);
    navigate("calibration");
  };
  const updateSetting = (key: string, value: unknown) => {
    const currentDevice = settings[deviceKey];
    if (JSON.stringify(currentDevice[key]) === JSON.stringify(value)) return;
    let updatedDevice: Record<string, any> = { ...currentDevice, [key]: value };
    if (
      deviceKey === "polarimeter" &&
      !["protocolVersion", "protocolStatus", "protocolHistory"].includes(key)
    ) {
      const previousSnapshot = { ...currentDevice };
      delete previousSnapshot.protocolHistory;
      const history = Array.isArray(currentDevice.protocolHistory)
        ? currentDevice.protocolHistory
        : [];
      updatedDevice = {
        ...updatedDevice,
        protocolVersion: Number(currentDevice.protocolVersion ?? 1) + 1,
        protocolStatus: "pending-verification",
        protocolEffectiveDate: null,
        protocolHistory: [
          ...history,
          {
            protocolVersion: currentDevice.protocolVersion ?? 1,
            protocolStatus:
              currentDevice.protocolStatus ?? "pending-verification",
            changedAt: new Date().toISOString(),
            snapshot: previousSnapshot,
          },
        ].slice(-30),
      };
    }
    setSettings({ ...settings, [deviceKey]: updatedDevice });
    if (user?.role === "admin")
      saveSettingsMutation.mutate({ deviceKey, settings: updatedDevice });
  };
  const reset = () => {
    const defaults = cloneSettings();
    const previous = settings.polarimeter;
    const priorSnapshot = { ...previous };
    delete priorSnapshot.protocolHistory;
    defaults.polarimeter = {
      ...defaults.polarimeter,
      protocolVersion: Number(previous.protocolVersion ?? 1) + 1,
      protocolStatus: "pending-verification",
      protocolHistory: [
        ...(Array.isArray(previous.protocolHistory)
          ? previous.protocolHistory
          : []),
        {
          protocolVersion: previous.protocolVersion ?? 1,
          protocolStatus: previous.protocolStatus ?? "pending-verification",
          changedAt: new Date().toISOString(),
          snapshot: priorSnapshot,
        },
      ].slice(-30),
    };
    setSettings(defaults);
    if (user?.role === "admin")
      Object.entries(defaults).forEach(([key, value]) =>
        saveSettingsMutation.mutate({ deviceKey: key, settings: value })
      );
  };
  const navItems: { id: Page; icon: typeof LayoutDashboard; label: string }[] =
    [
      { id: "dashboard", icon: LayoutDashboard, label: copy.nav[0] },
      { id: "calibration", icon: ClipboardCheck, label: copy.nav[1] },
      { id: "settings", icon: Settings2, label: copy.nav[2] },
      { id: "history", icon: History, label: copy.nav[3] },
      {
        id: "protocols",
        icon: FileStack,
        label: interfaceLanguage === "ar" ? "البروتوكول" : "Protocol",
      },
      { id: "equipment", icon: Wrench, label: EQUIPMENT_PAGE_TITLE },
      {
        id: "account",
        icon: KeyRound,
        label: interfaceLanguage === "ar" ? "أمان الحساب" : "Account security",
      },
      ...(user?.role === "admin"
        ? [
            {
              id: "users" as Page,
              icon: Users,
              label:
                interfaceLanguage === "ar"
                  ? "المستخدمون والأدوار"
                  : "Users & roles",
            },
            {
              id: "activity" as Page,
              icon: Activity,
              label:
                interfaceLanguage === "ar" ? "سجل الأنشطة" : "Activity log",
            },
          ]
        : []),
    ];
  const pageLabel =
    activePage === "protocols"
      ? interfaceLanguage === "ar"
        ? "البروتوكول"
        : "Protocol"
      : activePage === "equipment"
      ? EQUIPMENT_PAGE_TITLE
      : activePage === "users"
      ? interfaceLanguage === "ar"
        ? "المستخدمون"
        : "Users"
      : activePage === "activity"
        ? interfaceLanguage === "ar"
          ? "الأنشطة"
          : "Activity"
        : activePage === "account"
          ? interfaceLanguage === "ar"
            ? "أمان الحساب"
            : "Account security"
          : copy.pages[
              ["dashboard", "calibration", "settings", "history"].indexOf(
                activePage
              )
            ];
  if (!loading && !isAuthenticated)
    return <LocalLogin language={interfaceLanguage} />;
  return (
    <div
      className={`app-shell ${interfaceLanguage === "en" ? "english" : ""}`}
      dir={interfaceLanguage === "ar" ? "rtl" : "ltr"}
    >
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="brand-block">
          <img
            src="/manus-storage/yemen-qc-official-header-logo_68fac21a.png"
            alt="Official National Quality Control Laboratory seal"
          />
          <div>
            <strong>مِعيار</strong>
            <span>{copy.app}</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>
        <div className="lab-ident">
          <span>
            {interfaceLanguage === "ar"
              ? "الجمهورية اليمنية"
              : "Republic of Yemen"}
          </span>
          <strong>{copy.lab}</strong>
          <small>{copy.city}</small>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activePage === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {activePage === item.id && <i />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-block">
            <>
              <span className="small-symbol">
                <UserRound size={15} />
              </span>
              <div>
                <small>
                  {user?.role === "admin"
                    ? "Administrator"
                    : user?.role === "viewer"
                      ? "Viewer"
                      : interfaceLanguage === "ar"
                        ? "مستخدم مخوّل"
                        : "Authorized user"}
                </small>
                <strong>{user?.name ?? "—"}</strong>
              </div>
              <button onClick={() => logout()} aria-label={copy.signOut}>
                <LogOut size={15} />
              </button>
            </>
          </div>
          <div className="mini-device">
            <span
              className="small-symbol"
              style={{ background: activeDevice.accent }}
            >
              <FlaskConical size={15} />
            </span>
            <div>
              <small>{copy.selected}</small>
              <strong>{activeDevice.id}</strong>
            </div>
          </div>
          {!polarimeterEnglishMode && (
            <button
              className="support-link"
              onClick={() =>
                setLanguage(current => (current === "ar" ? "en" : "ar"))
              }
            >
              <Languages size={16} /> {copy.language}
            </button>
          )}
        </div>
      </aside>
      <div
        className={`sidebar-backdrop ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <main className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>{copy.app}</span>
            <b> / </b>
            <strong>{pageLabel}</strong>
          </div>
          <div className="topbar-status">
            {!polarimeterEnglishMode && (
              <button
                className="language-toggle"
                onClick={() =>
                  setLanguage(current => (current === "ar" ? "en" : "ar"))
                }
              >
                <Languages size={15} /> {copy.language}
              </button>
            )}
            <span className="pulse" />
            <span>{copy.session}</span>
            <span className="role-pill">{user?.role}</span>
          </div>
        </header>
        <div className="workspace-content">
          {activePage === "dashboard" && (
            <Dashboard
              language={interfaceLanguage}
              navigate={navigate}
              chooseDevice={chooseDevice}
            />
          )}
          {activePage === "calibration" && user && (
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> New Validation…
                </div>
              }
            >
              <ProtocolValidation
                user={{ id: user.id, name: user.name ?? null, role: user.role }}
                language={interfaceLanguage}
                initialInstrumentKey={deviceKey}
              />
            </Suspense>
          )}
          {activePage === "settings" && (
            <SettingsPage
              deviceKey={deviceKey}
              setDeviceKey={setDeviceKey}
              settings={settings}
              update={updateSetting}
              reset={reset}
              language={interfaceLanguage}
              canEditDevice={user?.role === "admin" || user?.role === "user"}
              canEditLimits={user?.role === "admin"}
            />
          )}
          {activePage === "history" && (
            <RecordHistory
              language={interfaceLanguage}
              isAuthenticated={isAuthenticated}
              isAdmin={user?.role === "admin"}
              currentUserId={user?.id ?? 0}
            />
          )}
          {activePage === "protocols" && user && (
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading Protocol…
                </div>
              }
            >
              <ProtocolPage
                user={{ id: user.id, name: user.name ?? null, role: user.role }}
                language={interfaceLanguage}
              />
            </Suspense>
          )}
          {activePage === "equipment" && user && (
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {EQUIPMENT_PAGE_TITLE}…
                </div>
              }
            >
              <EquipmentDataPage
                user={{ id: user.id, name: user.name ?? null, role: user.role }}
                language={interfaceLanguage}
              />
            </Suspense>
          )}
          {activePage === "account" && (
            <AccountSecurity language={interfaceLanguage} email={user?.email} />
          )}
          {activePage === "users" && user?.role === "admin" && (
            <UserManagement language={interfaceLanguage} />
          )}
          {activePage === "activity" && user?.role === "admin" && (
            <AdminActivityLog language={interfaceLanguage} />
          )}
        </div>
      </main>
    </div>
  );
}
