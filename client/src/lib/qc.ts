/** Design reminder: the data model supports the "دفتر المختبر الأخضر" interface—clear acceptance limits, traceable identifiers, and unambiguous status. */
import type { PolarimeterV2 } from "@shared/polarimeter";

export type DeviceKey =
  | "disintegration"
  | "refractometer"
  | "dissolution"
  | "hplc"
  | "spectrophotometer"
  | "moisture"
  | "polarimeter"
  | "viscometer";

export type Device = {
  key: DeviceKey;
  name: string;
  english: string;
  sop: string;
  id: string;
  manufacturer: string;
  model: string;
  serial: string;
  form: string;
  accent: string;
};

export type DeviceProfileOverride = {
  instrumentKey: string;
  nameAr: string;
  nameEn: string;
  instrumentId: string;
  sopNumber: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  formNumber: string;
  accent: string;
};

export type ResultRow = {
  test: string;
  expected: string;
  actual: string;
  pass: boolean;
};

export type CalibrationResult = {
  deviceKey: DeviceKey;
  overall: boolean;
  rows: ResultRow[];
  metrics: {
    label: string;
    value: string;
    tone?: "success" | "warning" | "neutral";
  }[];
  chart?: { label: string; value: number; reference?: number }[];
  chartTitle?: string;
  reportCharts?: {
    title: string;
    xLabel: string;
    yLabel: string;
    data: { label: string; value: number; reference?: number }[];
  }[];
  note?: string;
  controlledSettings?: Record<string, unknown>;
  polarimeterData?: PolarimeterV2;
  createdAt: string;
};

/** Official English labels shown in the on-screen result record, independent of the interface language. */
const resultEnglishTerms: Record<string, string> = {
  "معايرة الصفر — الماء المقطر": "Zero calibration — Distilled Water",
  "معايرة المدى — زيت المعايرة": "Span calibration — Calibration oil",
  "معامل ارتباط الخطية R": "Linearity correlation factor R",
  "الدوران البصري النوعي": "Specific optical rotation",
  "الامتصاصية النوعية عند": "Specific absorbance at",
  "خطية الامتصاص مقابل التركيز": "Absorbance linearity vs concentration",
  "خطية الدوران البصري": "Optical rotation linearity",
  "حرارة وسط التفكك": "Disintegration medium temperature",
  "حرارة الحمام المائي": "Water-bath temperature",
  "حرارة الوعاء": "Vessel temperature",
  "سرعة التحريك": "Stirring speed",
  "ترنح عمود المجداف": "Paddle shaft wobble",
  "ترنح عمود السلة": "Basket shaft wobble",
  "متوسط حرارة الأوعية": "Mean vessel temperature",
  "معايرة Span": "Span calibration",
  "الحمل اللامركزي": "Off-center load",
  "معامل R": "R factor",
  "انحراف Span": "Span deviation",
  "خطية الوزن": "Weight linearity",
  "خطية اللزوجة": "Viscosity linearity",
  "لزوجة قياسية": "Viscosity standard",
  "معامل ارتباط": "Correlation factor",
  "دقة طول الموجة": "Wavelength accuracy",
  "دقة طول موجة": "Wavelength accuracy",
  "اختبار الضوء الشارد": "Stray-light limit",
  "الضوء الشارد": "Stray light",
  "معدل تدفق": "Flow rate",
  متوسط: "Mean",
  المتوسط: "Mean",
  "الدوران النوعي": "Specific rotation",
  التكرارية: "Reproducibility",
  "سرعة الدورات": "Cycle speed",
  "دقة التوقيت": "Timer accuracy",
  "أعلى ترنح": "Maximum wobble",
  الميل: "Slope",
  "نقطة التقاطع": "Intercept",
  "تحقق:": "Verification:",
  "ماء مقطر": "Distilled Water",
  "كحول أيزوبروبيلي": "Isopropyl Alcohol",
  "ثنائي كلورو ميثان": "Dichloromethane",
  جليسرين: "Glycerin",
  بنزالدهيد: "Benzaldehyde",
  المركز: "Centre",
  مركز: "Centre",
  ركن: "Corner",
  قراءة: "Reading",
  المحاولة: "Attempt",
  "من القراءة الأولى": "from the first reading",
};

export function englishResultLabel(value: string) {
  let translated = value;
  Object.entries(resultEnglishTerms)
    .sort(([first], [second]) => second.length - first.length)
    .forEach(([arabic, english]) => {
      translated = translated.replaceAll(arabic, english);
    });
  return translated;
}

export const devices: Device[] = [
  {
    key: "disintegration",
    name: "جهاز اختبار التفكك",
    english: "Disintegration Tester",
    sop: "QC-012C",
    id: "QC-I-008",
    manufacturer: "Erweka (Germany)",
    model: "ZT51",
    serial: "102010",
    form: "QC-012B-01",
    accent: "#0C5A4C",
  },
  {
    key: "refractometer",
    name: "جهاز قياس معامل الانكسار",
    english: "Refractometer",
    sop: "QC-034D",
    id: "QC-I-030",
    manufacturer: "Bellingham & Stanley (UK)",
    model: "RFM340",
    serial: "BT98350",
    form: "QC-034B-01",
    accent: "#2F6C61",
  },
  {
    key: "dissolution",
    name: "جهاز اختبار الذوبان",
    english: "Dissolution Tester",
    sop: "QC-011D",
    id: "QC-I-009",
    manufacturer: "Erweka (Germany)",
    model: "DT70",
    serial: "1026650-E71",
    form: "QC-011B-01",
    accent: "#B88238",
  },
  {
    key: "hplc",
    name: "مضخة جهاز HPLC",
    english: "Shimadzu HPLC2 Pump",
    sop: "QC-121D",
    id: "QC-I-104",
    manufacturer: "Shimadzu Corporation (Japan)",
    model: "LC-40B XR",
    serial: "L22146101115 AE",
    form: "QC-121D",
    accent: "#285F84",
  },
  {
    key: "spectrophotometer",
    name: "المطياف الضوئي UV-Vis",
    english: "Spectrophotometer",
    sop: "QC-116D",
    id: "QC-I-097",
    manufacturer: "Jasco (Japan)",
    model: "V-730",
    serial: "D289661798",
    form: "QC-116B-01",
    accent: "#7A5E35",
  },
  {
    key: "moisture",
    name: "جهاز قياس الرطوبة",
    english: "Moisture Analyzer",
    sop: "QC-020D",
    id: "QC-I-023",
    manufacturer: "Sartorius (Germany)",
    model: "MA30",
    serial: "90301372",
    form: "QC-020B-01",
    accent: "#64733F",
  },
  {
    key: "polarimeter",
    name: "جهاز الاستقطاب البصري",
    english: "Polarimeter",
    sop: "QC-032D",
    id: "QC-I-029",
    manufacturer: "Bellingham & Stanley (UK)",
    model: "ADP220",
    serial: "PE99003",
    form: "QC-032B-01",
    accent: "#9A633F",
  },
  {
    key: "viscometer",
    name: "جهاز قياس اللزوجة الدوار",
    english: "Rotational Viscometer",
    sop: "QC-041D",
    id: "QC-I-034",
    manufacturer: "Fungi lab (Spain)",
    model: "Visco Star-L",
    serial: "CL3010397",
    form: "QC-041B-01",
    accent: "#584F76",
  },
];

/** Keeps the controlled device registry in sync with administrative database overrides. */
export function applyDeviceProfileOverrides(profiles: DeviceProfileOverride[]) {
  profiles.forEach(profile => {
    const device = devices.find(
      candidate => candidate.key === profile.instrumentKey
    );
    if (!device) return;
    Object.assign(device, {
      name: profile.nameAr,
      english: profile.nameEn,
      id: profile.instrumentId,
      sop: profile.sopNumber,
      manufacturer: profile.manufacturer,
      model: profile.model,
      serial: profile.serialNumber,
      form: profile.formNumber,
      accent: profile.accent,
    });
  });
  return devices;
}

export const defaultSettings: Record<DeviceKey, Record<string, any>> = {
  disintegration: {
    bathSet: 38,
    bathTolerance: 2,
    mediumMin: 35,
    mediumMax: 39,
    timeMin: 239,
    timeMax: 241,
    cycleMin: 29,
    cycleMax: 32,
  },
  refractometer: {
    zeroNominal: 1.33299,
    zeroMin: 1.33294,
    zeroMax: 1.33304,
    spanNominal: 1.51822,
    spanMin: 1.51817,
    spanMax: 1.51827,
    rLimit: 0.99,
    standards: [
      { name: "ماء مقطر", nominal: 1.333, min: 1.3325, max: 1.3335 },
      { name: "كحول أيزوبروبيلي", nominal: 1.3772, min: 1.376, max: 1.379 },
      { name: "ثنائي كلورو ميثان", nominal: 1.4241, min: 1.423, max: 1.425 },
      { name: "جليسرين", nominal: 1.4729, min: 1.47, max: 1.475 },
      { name: "بنزالدهيد", nominal: 1.545, min: 1.544, max: 1.546 },
    ],
  },
  dissolution: {
    bathSet: 38,
    bathTolerance: 2,
    vesselMin: 36.5,
    vesselMax: 37.5,
    wobbleMax: 0.35,
    speeds: [
      { nominal: 25, min: 24, max: 26 },
      { nominal: 50, min: 48, max: 52 },
      { nominal: 100, min: 96, max: 104 },
      { nominal: 150, min: 144, max: 156 },
      { nominal: 200, min: 192, max: 208 },
    ],
  },
  hplc: {
    devLimit: 3,
    rsdLimit: 2,
    flows: [
      { nominal: 1, min: 0.97, max: 1.03 },
      { nominal: 1.5, min: 1.455, max: 1.545 },
      { nominal: 2, min: 1.94, max: 2.06 },
    ],
  },
  spectrophotometer: {
    wavelengthAccuracy: 656.1,
    wavelengthTolerance: 0.2,
    strayMin: 2,
    rLimit: 0.99,
    wavelengths: [
      { nominal: 278.4, min: 276.4, max: 280.4 },
      { nominal: 287.2, min: 285.2, max: 289.2 },
      { nominal: 333.8, min: 331.5, max: 338.8 },
      { nominal: 336.8, min: 334.8, max: 338.8 },
      { nominal: 385.5, min: 383.2, max: 388.8 },
      { nominal: 418.5, min: 415.5, max: 421.5 },
      { nominal: 446.6, min: 443, max: 449 },
      { nominal: 453.4, min: 450.4, max: 456.4 },
      { nominal: 536.4, min: 534.4, max: 539.4 },
      { nominal: 637.5, min: 634.5, max: 640.5 },
    ],
    absorbance: [
      { wave: 235, min: 122.9, max: 126.2 },
      { wave: 257, min: 142.8, max: 146.2 },
      { wave: 313, min: 47, max: 50.3 },
      { wave: 350, min: 105.6, max: 109 },
    ],
  },
  moisture: {
    spanWeight: 30,
    spanTolerance: 0.002,
    reproducibilityWeight: 20,
    reproducibilityTolerance: 0.002,
    offCenterWeight: 20,
    offCenterTolerance: 0.003,
    rLimit: 0.99,
  },
  polarimeter: {
    tubeLength: 2,
    specificMin: 66.3,
    specificMax: 67,
    specificPrecision: 4,
    repeatTolerance: 0.05,
    readingPrecision: 2,
    rLimit: 0.99,
    protocolId: "POL-QC-032D",
    sopNumber: "QC-032D",
    formNumber: "QC-032B-01",
    protocolVersion: 1,
    protocolStatus: "pending-verification",
    protocolEffectiveDate: null,
    requiredReadings: 6,
    repeatabilityMethod: "first-reading-deviation",
    repeatReferenceValue: null,
    referenceTemperatureC: 20,
    wavelengthLabel: "Sodium D",
    wavelengthNm: 589.3,
    measurementDateTimeRequired: true,
    temperatureRequired: false,
    referenceStandardRequired: false,
    linearityConcentrations: [10, 20, 30, 40],
    linearityMetric: "r",
    linearityUsesActualConcentration: false,
    regressionPrecision: 6,
    protocolHistory: [],
  },
  viscometer: {
    rLimit: 0.99,
    standards: [
      { nominal: 50, min: 47.5, max: 52.5, spindle: "L1", speed: 100 },
      { nominal: 1000, min: 950, max: 1050, spindle: "L2", speed: 20 },
      { nominal: 12500, min: 11875, max: 13125, spindle: "L3", speed: 4 },
    ],
  },
};

export function cloneSettings(): Record<DeviceKey, Record<string, any>> {
  return JSON.parse(JSON.stringify(defaultSettings)) as Record<
    DeviceKey,
    Record<string, any>
  >;
}

export function findDevice(key: DeviceKey): Device {
  return devices.find(device => device.key === key) ?? devices[0];
}

export function regression(x: number[], y: number[]) {
  const count = x.length;
  const sumX = x.reduce((total, value) => total + value, 0);
  const sumY = y.reduce((total, value) => total + value, 0);
  const sumXX = x.reduce((total, value) => total + value * value, 0);
  const sumYY = y.reduce((total, value) => total + value * value, 0);
  const sumXY = x.reduce((total, value, index) => total + value * y[index], 0);
  const denominator = count * sumXX - sumX * sumX;
  if (!denominator) return { slope: 0, intercept: 0, r: 0 };
  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const rDenominator = Math.sqrt(
    (count * sumXX - sumX * sumX) * (count * sumYY - sumY * sumY)
  );
  return {
    slope,
    intercept,
    r: rDenominator ? (count * sumXY - sumX * sumY) / rDenominator : 0,
  };
}

export function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function sampleStd(values: number[]) {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
      Math.max(values.length - 1, 1)
  );
}

export function parseTime(value: string) {
  const [minutes = "0", seconds = "0"] = value.trim().split(/[.:]/);
  return Number(minutes) * 60 + Number(seconds);
}
