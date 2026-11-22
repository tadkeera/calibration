/**
 * Equipment data & specifications model (page «Equipment Settings»).
 *
 * Identity fields remain in the existing Equipment Library (instrument_profiles);
 * typed, unit-aware specification groups are stored in protocol_equipment_specs.
 * Every change is recorded field-by-field (old, new, user, time, reason, reference).
 *
 * Rules:
 *  - values are stored WITH their unit; units are never converted silently
 *    (changing the unit of a value is itself an audited, critical change);
 *  - specification values NEVER change protocol acceptance criteria;
 *  - critical fields require a written reason;
 *  - equipment is retired, never deleted.
 */
import { canonicalJson } from "./model";

export type SpecType = "number" | "text" | "date" | "select";
export type SpecDefinition = { key: string; label: string; labelAr: string; group: SpecGroupKey; type: SpecType; units: string[]; critical: boolean; options?: string[]; hint?: string };
export type SpecGroupKey = "range" | "operating" | "configuration" | "calibration" | "software";
export type SpecValue = { value: number | string | null; unit: string; source: string };
export type SpecMap = Record<string, SpecValue>;

export const SPEC_GROUPS: Array<{ key: SpecGroupKey; label: string; labelAr: string }> = [
  { key: "range", label: "Measurement range & resolution", labelAr: "نطاق القياس والدقة" },
  { key: "operating", label: "Operating & environmental conditions", labelAr: "ظروف التشغيل والبيئة" },
  { key: "configuration", label: "Configuration & accessories", labelAr: "التهيئة والملحقات" },
  { key: "calibration", label: "Calibration & maintenance", labelAr: "المعايرة والصيانة" },
  { key: "software", label: "Software / firmware", labelAr: "البرمجيات / البرنامج الثابت" },
];

const n = (key: string, label: string, labelAr: string, group: SpecGroupKey, units: string[], critical = false, hint?: string): SpecDefinition => ({ key, label, labelAr, group, type: "number", units, critical, hint });
const t = (key: string, label: string, labelAr: string, group: SpecGroupKey, critical = false, hint?: string): SpecDefinition => ({ key, label, labelAr, group, type: "text", units: [""], critical, hint });
const d = (key: string, label: string, labelAr: string, group: SpecGroupKey): SpecDefinition => ({ key, label, labelAr, group, type: "date", units: [""], critical: false });

/** Specifications common to every equipment type. */
const COMMON: SpecDefinition[] = [
  t("location", "Location / room", "الموقع / الغرفة", "operating"),
  n("envTempMin", "Operating temperature — min", "أدنى حرارة تشغيل", "operating", ["°C"]),
  n("envTempMax", "Operating temperature — max", "أعلى حرارة تشغيل", "operating", ["°C"]),
  n("envHumidityMax", "Max relative humidity", "أقصى رطوبة نسبية", "operating", ["%RH"]),
  t("softwareVersion", "Software / firmware version", "إصدار البرنامج", "software", true),
  d("lastCalibration", "Last calibration date", "تاريخ آخر معايرة", "calibration"),
  d("nextCalibration", "Next calibration due", "موعد المعايرة القادمة", "calibration"),
  t("calibrationInterval", "Calibration interval (site SOP)", "فترة المعايرة (حسب الإجراء)", "calibration"),
  t("serviceProvider", "Service provider", "مزوّد الخدمة", "calibration"),
];

/** Type-specific specification catalog (labels only — values come from the user / supplied documents). */
export const SPEC_CATALOG: Record<string, SpecDefinition[]> = {
  balance: [
    n("capacity", "Weighing capacity", "سعة الوزن", "range", ["g", "mg", "kg"], true),
    n("readability", "Readability d", "قابلية القراءة d", "range", ["g", "mg"], true),
    n("mfrRepeatability", "Manufacturer repeatability", "التكرارية (الصانع)", "range", ["g", "mg"]),
    n("mfrLinearity", "Manufacturer linearity", "الخطية (الصانع)", "range", ["g", "mg"]),
    n("responseTime", "Typical response time", "زمن الاستجابة", "range", ["s"]),
    n("panDiameter", "Pan diameter", "قطر الكفة", "configuration", ["mm"]),
    t("calWeight", "External calibration weight", "وزن المعايرة الخارجي", "configuration"),
    n("minWeight", "Approved minimum net weight (from executed repeatability)", "أقل وزن صافٍ معتمد", "range", ["g", "mg"], true, "Only from an executed USP <41> repeatability test"),
  ],
  hplc: [
    t("pumpModel", "Pump module", "وحدة المضخة", "configuration", true),
    t("detectorModel", "Detector module", "وحدة الكاشف", "configuration", true),
    t("autosamplerModel", "Autosampler module", "وحدة الحاقن الآلي", "configuration"),
    t("ovenModel", "Column oven module", "فرن العمود", "configuration"),
    n("flowMin", "Flow range — min", "أدنى معدل تدفق", "range", ["mL/min"]),
    n("flowMax", "Flow range — max", "أعلى معدل تدفق", "range", ["mL/min"]),
    n("wavelengthMin", "Detector wavelength — min", "أدنى طول موجي", "range", ["nm"]),
    n("wavelengthMax", "Detector wavelength — max", "أعلى طول موجي", "range", ["nm"]),
    n("ovenMax", "Column oven — max temperature", "أعلى حرارة للفرن", "range", ["°C"]),
    n("injectorCapacity", "Injector / autosampler capacity", "سعة الحاقن / الحاقن الآلي", "configuration", ["µL"]),
    n("lampHours", "Lamp hours (as found)", "ساعات المصباح", "calibration", ["h"]),
    d("installationDate", "Installation date", "تاريخ التركيب", "calibration"),
    t("pumpConfiguration", "Pump configuration (e.g. quaternary / binary)", "تهيئة المضخة", "configuration", true),
    t("injectorType", "Injector type", "نوع الحاقن", "configuration"),
    t("detectorType", "Detector type", "نوع الكاشف", "configuration", true),
    t("detectorWavelength", "Detector wavelength (range / setting)", "الطول الموجي للكاشف", "configuration"),
    t("columnType", "Column type", "نوع العمود", "configuration"),
    t("columnDimensions", "Column dimensions", "أبعاد العمود", "configuration"),
    t("softwareName", "Chromatography software name", "اسم برنامج الكروماتوغرافيا", "software"),
  ],
  polarimeter: [
    n("rangeMin", "Optical rotation range — min", "أدنى مدى دوران", "range", ["°"]),
    n("rangeMax", "Optical rotation range — max", "أعلى مدى دوران", "range", ["°"]),
    n("resolution", "Resolution", "الدقة (Resolution)", "range", ["°"], true),
    n("mfrAccuracy", "Manufacturer accuracy", "الضبط (الصانع)", "range", ["°"]),
    n("wavelength", "Operating wavelength", "الطول الموجي", "configuration", ["nm"], true),
    t("tubeLengths", "Sample tube lengths", "أطوال أنابيب العينة", "configuration"),
  ],
  refractometer: [
    n("rangeMin", "Refractive index range — min", "أدنى معامل انكسار", "range", ["nD"]),
    n("rangeMax", "Refractive index range — max", "أعلى معامل انكسار", "range", ["nD"]),
    n("resolution", "Resolution", "الدقة", "range", ["nD"], true),
    n("wavelength", "Wavelength", "الطول الموجي", "configuration", ["nm"]),
    n("tempControlMin", "Temperature control — min", "أدنى حرارة تحكم", "range", ["°C"]),
    n("tempControlMax", "Temperature control — max", "أعلى حرارة تحكم", "range", ["°C"]),
  ],
  spectrophotometer: [
    n("wavelengthMin", "Wavelength range — min", "أدنى طول موجي", "range", ["nm"]),
    n("wavelengthMax", "Wavelength range — max", "أعلى طول موجي", "range", ["nm"]),
    n("bandwidth", "Spectral bandwidth", "عرض الحزمة الطيفية", "range", ["nm"], true),
    { key: "detectorType", label: "Detector type", labelAr: "نوع الكاشف", group: "configuration", type: "select", units: [""], critical: true, options: ["non-diode-array", "diode-array"] },
    n("photometricRangeMax", "Photometric range — max", "أعلى مدى ضوئي", "range", ["A"]),
  ],
  moisture: [
    n("capacity", "Weighing capacity", "سعة الوزن", "range", ["g"], true),
    n("readability", "Readability", "قابلية القراءة", "range", ["g", "mg", "%"], true),
    n("tempMin", "Drying temperature — min", "أدنى حرارة تجفيف", "range", ["°C"]),
    n("tempMax", "Drying temperature — max", "أعلى حرارة تجفيف", "range", ["°C"]),
    t("heater", "Heating element", "عنصر التسخين", "configuration"),
  ],
  dissolution: [
    n("vessels", "Number of vessels", "عدد الأوعية", "configuration", ["count"], true),
    t("apparatusTypes", "Apparatus types fitted (e.g. 1 basket / 2 paddle)", "أنواع الأجهزة المركبة", "configuration", true),
    n("speedMin", "Speed range — min", "أدنى سرعة", "range", ["rpm"]),
    n("speedMax", "Speed range — max", "أعلى سرعة", "range", ["rpm"]),
    n("vesselVolume", "Vessel volume", "حجم الوعاء", "configuration", ["mL"]),
  ],
  disintegration: [
    n("baskets", "Number of basket-rack assemblies", "عدد السلال", "configuration", ["count"], true),
    n("strokeRate", "Nominal stroke rate", "معدل الحركة الاسمي", "range", ["cycles/min"]),
    n("strokeDistance", "Nominal stroke distance", "مسافة الحركة الاسمية", "range", ["mm"]),
    n("beakerVolume", "Beaker volume", "حجم الكأس", "configuration", ["mL"]),
  ],
  viscometer: [
    n("rangeMin", "Viscosity range — min", "أدنى لزوجة", "range", ["mPa·s"]),
    n("rangeMax", "Viscosity range — max", "أعلى لزوجة", "range", ["mPa·s"]),
    t("spindles", "Spindle set", "مجموعة المغازل", "configuration"),
  ],
};

export function specDefinitions(equipmentType: string): SpecDefinition[] {
  return [...(SPEC_CATALOG[equipmentType] ?? []), ...COMMON];
}

export const IDENTITY_FIELDS = [
  { key: "instrumentId", label: "Equipment ID", labelAr: "رقم الجهاز", critical: true },
  { key: "manufacturer", label: "Manufacturer", labelAr: "الشركة المصنعة", critical: true },
  { key: "model", label: "Model", labelAr: "الموديل", critical: true },
  { key: "serialNumber", label: "Serial number", labelAr: "الرقم التسلسلي", critical: true },
  { key: "nameEn", label: "Name (English)", labelAr: "الاسم (إنجليزي)", critical: false },
  { key: "nameAr", label: "Name (Arabic)", labelAr: "الاسم (عربي)", critical: false },
  { key: "sopNumber", label: "SOP number", labelAr: "رقم الإجراء SOP", critical: false },
  { key: "formNumber", label: "Form number", labelAr: "رقم النموذج", critical: false },
] as const;
export type IdentityKey = (typeof IDENTITY_FIELDS)[number]["key"];
export type EquipmentIdentity = Record<IdentityKey, string>;

export type EquipmentFieldChange = { group: "identity" | SpecGroupKey | "status"; field: string; label: string; previous: unknown; next: unknown; unit: string; critical: boolean };

const sameSpec = (a: SpecValue | undefined, b: SpecValue | undefined) =>
  (a?.value ?? null) === (b?.value ?? null) && (a?.unit ?? "") === (b?.unit ?? "") && (a?.source ?? "") === (b?.source ?? "");

/** Field-level diff between the current and proposed equipment data. */
export function diffEquipment(equipmentType: string, before: { identity: EquipmentIdentity; specs: SpecMap }, after: { identity: EquipmentIdentity; specs: SpecMap }): EquipmentFieldChange[] {
  const changes: EquipmentFieldChange[] = [];
  IDENTITY_FIELDS.forEach(f => {
    const a = (before.identity[f.key] ?? "").trim();
    const b = (after.identity[f.key] ?? "").trim();
    if (a !== b) changes.push({ group: "identity", field: f.key, label: f.label, previous: a, next: b, unit: "", critical: f.critical });
  });
  const defs = new Map(specDefinitions(equipmentType).map(d => [d.key, d]));
  const keys = Array.from(new Set([...Object.keys(before.specs), ...Object.keys(after.specs)])).sort();
  keys.forEach(k => {
    const a = before.specs[k];
    const b = after.specs[k];
    if (sameSpec(a, b)) return;
    const def = defs.get(k);
    const unitChanged = !!a && !!b && a.value !== null && (a.unit ?? "") !== (b.unit ?? "");
    changes.push({
      group: def?.group ?? "configuration",
      field: `spec.${k}`,
      label: def?.label ?? k,
      previous: a ?? null,
      next: b ?? null,
      unit: b?.unit ?? a?.unit ?? "",
      // Unit changes are always critical (no silent unit conversion).
      critical: (def?.critical ?? false) || unitChanged,
    });
  });
  return changes;
}

export type SpecIssue = { field: string; message: string };

/** Validates a proposed spec map: numbers must be finite, units must belong to the field's unit list. */
export function specIssues(equipmentType: string, specs: SpecMap): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const defs = new Map(specDefinitions(equipmentType).map(d => [d.key, d]));
  Object.entries(specs).forEach(([key, v]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) issues.push({ field: key, message: "Invalid specification key" });
    const def = defs.get(key);
    if (v.value === null || v.value === "") return;
    if (def?.type === "number") {
      if (typeof v.value !== "number" || !Number.isFinite(v.value)) issues.push({ field: key, message: `${def.label}: a finite number is required` });
      if (!def.units.includes(v.unit)) issues.push({ field: key, message: `${def.label}: unit must be one of ${def.units.join(", ")} (no automatic unit conversion)` });
    }
    if (def?.type === "select" && def.options && !def.options.includes(String(v.value))) issues.push({ field: key, message: `${def.label}: choose one of ${def.options.join(", ")}` });
    if (def?.type === "date" && typeof v.value === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(v.value)) issues.push({ field: key, message: `${def.label}: use YYYY-MM-DD` });
    if (typeof v.value === "string" && v.value.length > 500) issues.push({ field: key, message: "Value too long (max 500)" });
  });
  min_max(specs, "envTempMin", "envTempMax", issues);
  return issues;
}

function min_max(specs: SpecMap, lo: string, hi: string, issues: SpecIssue[]) {
  const a = specs[lo];
  const b = specs[hi];
  if (a && b && typeof a.value === "number" && typeof b.value === "number" && a.unit === b.unit && a.value > b.value) issues.push({ field: hi, message: "Maximum must not be below minimum" });
}

/** Frozen equipment data captured when a calibration run is created. */
export type EquipmentSnapshot = {
  instrumentKey: string;
  equipmentType: string;
  identity: EquipmentIdentity;
  specs: SpecMap;
  status: "active" | "retired";
  specsRowVersion: number;
  capturedAt: string;
};

/** Content version of the equipment data (identity + specs) — detects "newer data available". */
export function equipmentVersion(identity: EquipmentIdentity, specs: SpecMap) {
  const s = canonicalJson({ identity, specs });
  // FNV-1a 32-bit — compact, deterministic, browser-safe (not a security hash).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `eq-${h.toString(16).padStart(8, "0")}-${s.length}`;
}

/** Fields of the snapshot that are missing from the current equipment profile (shown as "Not available in the current equipment profile"). */
export const NOT_AVAILABLE = "Not available in the current equipment profile";
/** Shown for every equipment information field that has no recorded value (values are never invented). */
export const NEEDS_EQUIPMENT_INFORMATION = "Needs Equipment Information";

/** Equipment information rows (identity + specifications) with "Needs Equipment Information" for empty values. */
export function equipmentInformationRows(snapshot: { equipmentType: string; identity: EquipmentIdentity; specs: SpecMap }): Array<{ group: string; label: string; value: string; source: string }> {
  const idn = snapshot.identity as unknown as Record<string, string>;
  const shown = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? NEEDS_EQUIPMENT_INFORMATION : String(v));
  const rows: Array<{ group: string; label: string; value: string; source: string }> = IDENTITY_FIELDS.filter(f => f.key !== "nameAr").map(f => ({ group: "Identification", label: f.label as string, value: shown(idn[f.key]), source: "Equipment Master" }));
  specDefinitions(snapshot.equipmentType).forEach(def => {
    const v = snapshot.specs?.[def.key];
    const has = v && v.value !== null && v.value !== undefined && String(v.value).trim() !== "";
    rows.push({ group: SPEC_GROUPS.find(g => g.key === def.group)?.label ?? def.group, label: def.label, value: has ? `${v!.value}${v!.unit ? ` ${v!.unit}` : ""}` : NEEDS_EQUIPMENT_INFORMATION, source: has ? v!.source || "Equipment Master" : "—" });
  });
  return rows;
}
