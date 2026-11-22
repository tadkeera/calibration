/** Design reminder: the protected register keeps the existing "دفتر المختبر الأخضر" character while adding evidence, accountability, and bilingual controls. */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpLeft,
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
  UserRound,
  Users,
  X,
} from "lucide-react";
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
// «الإعدادات والحدود»: read-only limits from the protocol stored in the DB
// (legacy per-device settings are no longer shown; they stay stored).
const ProtocolLimitsPage = lazy(() =>
  import("@/components/protocols/ProtocolLimitsPage").then(m => ({
    default: m.ProtocolLimitsPage,
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
    activePage === "calibration";
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
          {activePage === "settings" && user && (
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {copy.nav[2]}…
                </div>
              }
            >
              <ProtocolLimitsPage language={interfaceLanguage} />
            </Suspense>
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
