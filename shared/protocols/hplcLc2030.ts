/**
 * HPLC Calibration Protocol – Shimadzu LC 2030 PLUS
 *
 * Source (PRIMARY AND AUTHORITATIVE, user instruction): docs/HPLC.pdf — 9 scanned
 * pages, Laboratory Calibration Reference (NOT a USP requirement), with its
 * English extraction docs/protocols/hplc/HPLC_Complete_Analysis_English.txt
 * ("HPLC.txt"). Every test and criterion carries its PDF page reference.
 *
 * Exactly ten tests — no USP system-suitability tests are added. Historical
 * values of the 2022 record (dates, results) are NEVER used as defaults.
 * Source discrepancies are stored as review notes (technical gaps) and
 * criteria affected by an open interpretation stay PENDING TECHNICAL
 * VERIFICATION, so the Quality Manager must confirm them before approval.
 *
 * Expressed only with the generic protocol model (levels, named readings,
 * fields, calculations, criteria, advisories, graphs) — the calculation
 * engine, New Validation form, graphs and PDF are protocol-driven.
 */
import { parseProtocolContent, type ProtocolContent, type ProtocolContentInput } from "./model";

/** Same number as the earlier HPLC draft of the 8-protocol package — an existing protocol is updated (new revision), never duplicated. */
export const HPLC_PROTOCOL_NUMBER = "CAL-QC-HPLC-001";
export const HPLC_PROTOCOL_TITLE = "HPLC Calibration Protocol – Shimadzu LC 2030 PLUS";
export const HPLC_INSTRUMENT_KEY = "hplc";
export const HPLC_SOURCE_DOCUMENT = "HPLC.pdf";
export const HPLC_SOURCE_TYPE = "Laboratory Calibration Reference";
export const HPLC_INITIAL_STATUS = "Draft – Pending Quality Manager Approval";
/** Marker stored in the identification description (identifies seeded content; bump when the seeded content changes). */
export const HPLC_SEED_VERSION = "HPLC.pdf seed v2";
/** Earlier seed markers: a draft that still carries one of them is updated to the current content (audited). */
export const HPLC_PREVIOUS_SEED_VERSIONS = ["HPLC.pdf seed v1"];
/** User decisions applied in seed v2 (recorded during the protocol-update request on branch arena/7d2d31ac-calibration). */
export const HPLC_USER_DECISIONS = {
  flow: "Flow-rate setpoints 1.0 / 1.5 / 2.0 mL/min (HPLC.pdf p.1) confirmed by user instruction.",
  gpv: "GPV tolerance \"Setting value ± 2.0\" applied as ± 2.0 % RELATIVE to the setting value (|actual − setting| / setting × 100 ≤ 2.0) by user decision. The supplied USP <621> Chromatography and USP <1058> Analytical Instrument Qualification extracts specify NO acceptance limit for gradient proportioning accuracy (NOT SPECIFIED IN SUPPLIED USP SOURCE); the limit therefore remains the HPLC.pdf laboratory value.",
};
export const HPLC_REF_PLACEHOLDER = "@HPLCPDF";

/** Stable test keys (idempotent seeding: the same keys are updated, never duplicated). */
export const HPLC_TEST_KEYS = [
  "hplc_flow_rate",
  "hplc_lamp_energy",
  "hplc_uv_lamp_hours",
  "hplc_column_oven",
  "hplc_precision",
  "hplc_wavelength",
  "hplc_detector_linearity",
  "hplc_autosampler_linearity",
  "hplc_carryover",
  "hplc_gpv",
] as const;

export const HPLC_TEST_NAMES = [
  "Flow Rate Accuracy",
  "Lamp Reference Energy",
  "UV Lamp Hours",
  "HPLC Column Oven Temperature",
  "System and Injector Precision",
  "Wavelength Accuracy",
  "Detector Linearity",
  "Autosampler Linearity",
  "Carryover Test",
  "Gradient Proportioning Valve",
] as const;

/** Reference Library entry for the source document (seeded as pending verification — never marked verified automatically). */
export const HPLC_REFERENCE_SEED = {
  placeholder: HPLC_REF_PLACEHOLDER,
  code: "HPLC-CAL-RECORD-LC2030", // reused when already in the Reference Library (no duplicate)
  title: "HPLC.pdf — HPLC Calibration Summary Report and HPLC Calibration Record (Annexure II), Shimadzu LC 2030 PLUS, Instrument ID RLS/QC/HPLC/02",
  issuer: "Laboratory calibration record (scanned, 9 pages) supplied by the user",
  referenceType: "laboratory-calibration-reference" as const,
  documentNumber: "Format no. QC/049/F02-02",
  edition: "Semi-annual calibration record dated 20/08/2022 (historical record)",
  revision: "",
  publicationDate: "",
  sourceUrl: "docs/HPLC.pdf",
  applicableSection: "PDF pages 1–9",
  notes:
    "Source type: Laboratory Calibration Reference (not a USP requirement). Authoritative source of " +
    HPLC_PROTOCOL_NUMBER +
    " per user instruction; English extraction: docs/protocols/hplc/HPLC_Complete_Analysis_English.txt. Historical results and the dates 20/08/2022 / 20/02/2023 are reference only — never defaults or new calibration dates. Verify edition / status before approving the protocol.",
};

export type HplcEquipment = { instrumentKey: string; instrumentId: string; serialNumber: string; manufacturer: string; model: string; equipmentType?: string; formNumber?: string; sopNumber?: string };

const R = HPLC_REF_PLACEHOLDER;
const SRC = "laboratory-calibration-reference" as const;

type CritOpts = { lower?: number; upper?: number; tolerance?: number; target?: number; unit?: string; levelKey?: string; clause: string; quote: string; pending?: string; conflict?: string; evidence?: string };
function crit(key: string, parameter: string, requirement: string, comparison: "abs<=" | ">=" | "<=" | "between", o: CritOpts) {
  return {
    key,
    parameter,
    requirement,
    comparison,
    lower: o.lower ?? null,
    upper: o.upper ?? null,
    target: o.target ?? null,
    tolerance: o.tolerance ?? null,
    unit: o.unit ?? "",
    levelKey: o.levelKey ?? null,
    sourceClass: SRC,
    referenceId: R,
    referenceClause: o.clause,
    justification: "",
    verificationStatus: o.pending ? ("pending-technical-verification" as const) : ("verified" as const),
    verificationEvidence: o.pending
      ? ""
      : o.evidence
      ? `Transcribed from ${HPLC_SOURCE_DOCUMENT} ${o.clause}: "${o.quote}". ${o.evidence}`
      : `Transcribed from ${HPLC_SOURCE_DOCUMENT} ${o.clause}: "${o.quote}". Cross-checked against the scanned page and the supplied extraction (HPLC_Complete_Analysis_English.txt). Source type: ${HPLC_SOURCE_TYPE}.`,
    conflictNote: [o.pending ? `PENDING QUALITY REVIEW: ${o.pending}` : "", o.conflict ?? ""].filter(Boolean).join(" "),
  };
}

const custom = (key: string, label: string, formula: string, unit: string, scope: "test" | "per-level" = "test", justification = "") => ({ key, label, kind: "custom" as const, formula, scope, unit, decimals: null, significantFigures: null, formulaRevision: "HPLC.pdf-1", justification });
const builtin = (key: string, label: string, kind: "max" | "linearity-slope" | "linearity-intercept" | "linearity-r" | "linearity-r2" | "level-reference-at-max", unit = "", justification = "") => ({ key, label, kind, formula: "", scope: "test" as const, unit, decimals: null, significantFigures: null, formulaRevision: "HPLC.pdf-1", justification });
const numField = (key: string, label: string, unit: string, extra: { defaultValue?: number; gt?: number; gte?: number; required?: boolean } = {}) => ({ key, label, type: "number" as const, unit, required: extra.required ?? true, options: [], ...(extra.defaultValue !== undefined ? { defaultValue: extra.defaultValue } : {}), ...(extra.gt !== undefined ? { gt: extra.gt } : {}), ...(extra.gte !== undefined ? { gte: extra.gte } : {}) });
const level = (key: string, label: string, nominal: number, unit: string, referenceNote = "", group?: string) => ({ key, label, nominal, unit, referenceNote, ...(group ? { group } : {}) });

const PRECISION_CONDITIONS =
  "Mobile phase: 750 mL DI water + 250 mL methanol, mix and sonicate 15 min. Column: C18, 25 cm × 4.6 mm. Flow rate: 1.5 mL/min. Wavelength: 272 nm. Injection volume: 20 µL. Run time: 12 min. Standard: caffeine — stock 1000 ppm (50.0 mg in 50 mL water), working standard 10 ppm (1 mL stock → 100 mL water). (HPLC.pdf p.4; handwritten batch / grade not reliably legible — verify.)";

function tests(): NonNullable<NonNullable<ProtocolContentInput["sections"]>[number]["tests"]> {
  return [
    /* 1 ------------------------------------------------------------ */
    {
      key: "hplc_flow_rate",
      name: "Flow Rate Accuracy",
      objective: "Verify the actual mobile-phase flow delivered by the pump by timing the collection of a known volume.",
      category: "Pump",
      stage: "Calibration",
      method: "Volumetric: time to fill a 10.0 mL class A volumetric flask at each set flow rate.",
      procedure:
        "At each set flow rate measure the time (minutes) taken to fill a 10.0 mL class A volumetric flask. Actual flow = collected volume / time taken; deviation = actual − set; deviation % = (actual − set) / set × 100; absolute error % = |deviation %|. Setpoints 1.0 / 1.5 / 2.0 mL/min (HPLC.pdf p.1, confirmed by user instruction) — p.2 prints 0.5 / 1.5 / 2.5 mL/min (review note A, resolved).",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.2 (procedure, formula, criterion); p.1 summary (adopted setpoints)",
      requiredMaterials: "10.0 mL class A volumetric flask; calibrated stopwatch.",
      parameter: "Flow rate",
      unit: "mL/min",
      dataType: "multi-level",
      levelName: "Set flow rate",
      readingsRequired: 1,
      readingKeys: [{ key: "time", label: "Time taken (min)", unit: "min", gt: 0 }],
      levels: [
        level("F1", "1.0 mL/min", 1.0, "mL/min", "HPLC.pdf p.1 (confirmed setpoint)"),
        level("F2", "1.5 mL/min", 1.5, "mL/min", "HPLC.pdf p.1 and p.2"),
        level("F3", "2.0 mL/min", 2.0, "mL/min", "HPLC.pdf p.1 (confirmed setpoint)"),
      ],
      fields: [numField("volume", "Collected volume (class A volumetric flask)", "mL", { defaultValue: 10.0, gt: 0 })],
      calculations: [
        custom("actual", "Actual flow rate", "volume / time", "mL/min", "per-level", "HPLC.pdf p.2: actual flow = 10.0 / time taken (minutes)"),
        custom("dev", "Deviation (actual − set)", "actual - reference", "mL/min", "per-level"),
        custom("dev_pct", "Deviation %", "(actual - reference) / reference * 100", "%", "per-level"),
        custom("abs_err_pct", "Absolute error %", "abs(dev_pct)", "%", "per-level"),
      ],
      criteria: [
        crit("flow_limit", "dev_pct", "Flow within ± 1.0 % of the set value at every setpoint (|deviation %| ≤ 1.0).", "abs<=", {
          tolerance: 1.0,
          unit: "%",
          clause: "p.2 (also p.1 summary)",
          quote: "Acceptance criteria: should be within ± 1.0% of the set value",
          evidence: HPLC_USER_DECISIONS.flow,
          conflict: "Review note A (resolved): p.2 prints 0.5 / 1.5 / 2.5 mL/min; the p.1 setpoints 1.0 / 1.5 / 2.0 mL/min apply.",
        }),
      ],
      graphs: [
        { type: "level-xy", title: "Flow rate accuracy — set flow vs actual flow", xLabel: "Set flow rate (mL/min)", yLabel: "Actual flow rate (mL/min)", y: "actual", line: "identity" },
        { type: "level-xy", title: "Flow rate accuracy — deviation % by set flow", xLabel: "Set flow rate (mL/min)", yLabel: "Deviation (%)", y: "dev_pct", line: "none", guideLines: [{ name: "Zero", y: 0 }, { name: "+1.0 % limit", y: 1 }, { name: "-1.0 % limit", y: -1 }] },
      ],
      notes: "Historical p.2 entries (10.0/10.0 = 1.0; 10.0/6.6 = 1.52; 10.0/5 = 2.0, with handwritten corrections) are reference only and are not defaults.",
    },
    /* 2 ------------------------------------------------------------ */
    {
      key: "hplc_lamp_energy",
      name: "Lamp Reference Energy",
      objective: "Record and check the UV lamp reference energy.",
      category: "Detector",
      stage: "Calibration",
      procedure: "Record the detector reference energy (mV) at the stated wavelength and compare it directly with the acceptance limit (no calculation formula is specified in the source).",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.3 (also p.1 summary item 2)",
      parameter: "Reference energy",
      unit: "mV",
      dataType: "calculated",
      readingsRequired: 0,
      fields: [numField("wavelength", "Wavelength", "nm", { defaultValue: 254, gt: 0 }), numField("energy", "Reference energy", "mV", { gte: 0 })],
      criteria: [crit("energy_min", "energy", "Reference energy NLT 400 mV.", ">=", { lower: 400, unit: "mV", clause: "p.3 (also p.1 summary)", quote: "Acceptance criteria: NLT 400 mv" })],
      notes: "Wavelength 254 nm per HPLC.txt / execution prompt; the scanned p.3 shows the wavelength written as \"NA\" — see review note F.",
    },
    /* 3 ------------------------------------------------------------ */
    {
      key: "hplc_uv_lamp_hours",
      name: "UV Lamp Hours",
      objective: "Record the accumulated UV lamp operating hours (maintenance status).",
      category: "Detector",
      stage: "Calibration",
      procedure: "Record the UV lamp hours from the instrument. HPLC.pdf: \"Minimum 2000 hrs to replace the UV lamps.\" This is a lamp replacement / maintenance recommendation, not a calibration acceptance criterion: reaching 2000 h raises a maintenance alert and does not fail the calibration.",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.3 (also p.1 summary item 3)",
      parameter: "Lamp hours",
      unit: "h",
      dataType: "calculated",
      readingsRequired: 0,
      decisionRole: "informational",
      fields: [numField("lamp_hours", "UV lamp hours", "h", { gte: 0 })],
      advisories: [
        {
          key: "lamp_replacement",
          parameter: "lamp_hours",
          comparison: ">=",
          limit: 2000,
          unit: "h",
          alertMessage: "Maintenance status: lamp replacement / maintenance review required — lamp hours have reached the 2000 h replacement recommendation (HPLC.pdf p.3). Not a calibration failure.",
          okMessage: "Maintenance status: no replacement threshold reached (below the 2000 h recommendation of HPLC.pdf p.3).",
          referenceId: R,
          referenceClause: "HPLC.pdf p.3: \"Minimum 2000 hrs to replace the UV lamps\"",
        },
      ],
      notes: "Review note D: the 2000 h value is a replacement recommendation, not a pass/fail criterion.",
    },
    /* 4 ------------------------------------------------------------ */
    {
      key: "hplc_column_oven",
      name: "HPLC Column Oven Temperature",
      objective: "Verify the column oven temperature at four setpoints with a thermometer and the instrument display.",
      category: "Column oven",
      stage: "Calibration",
      procedure: "At each set temperature record the temperature observed on the (digital) thermometer and on the instrument display. Thermometer deviation = thermometer − set; display deviation = display − set; display-to-thermometer difference = display − thermometer (informative, no limit in the source).",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.3 (also p.1 summary item 4)",
      requiredInstruments: "Calibrated digital thermometer.",
      parameter: "Temperature",
      unit: "°C",
      dataType: "multi-level",
      levelName: "Set temperature",
      readingsRequired: 2,
      readingKeys: [
        { key: "thermometer", label: "Thermometer reading", unit: "°C" },
        { key: "display", label: "Instrument display reading", unit: "°C" },
      ],
      levels: [level("T25", "25.0 °C", 25, "°C"), level("T40", "40.0 °C", 40, "°C"), level("T50", "50.0 °C", 50, "°C"), level("T60", "60.0 °C", 60, "°C")],
      calculations: [
        custom("th_dev", "Thermometer deviation (thermometer − set)", "thermometer - reference", "°C", "per-level"),
        custom("disp_dev", "Display deviation (display − set)", "display - reference", "°C", "per-level"),
        custom("diff", "Display − thermometer difference (informative)", "display - thermometer", "°C", "per-level", "Informative only — the source specifies no limit for this difference."),
        custom("th_abs", "|Thermometer deviation|", "abs(th_dev)", "°C", "per-level"),
        custom("disp_abs", "|Display deviation|", "abs(disp_dev)", "°C", "per-level"),
      ],
      criteria: [
        crit("th_limit", "th_dev", "Thermometer reading within ± 2.0 °C of the set temperature.", "abs<=", { tolerance: 2.0, unit: "°C", clause: "p.3 (also p.1 summary)", quote: "Acceptance criteria ± 2.0 for set temperature and digital thermometer" }),
        crit("disp_limit", "disp_dev", "Instrument display reading within ± 2.0 °C of the set temperature.", "abs<=", { tolerance: 2.0, unit: "°C", clause: "p.1 summary (\"Should be within ± 2.0 of the set temperature\"); p.3", quote: "Should be within ± 2.0 of the set temperature" }),
      ],
      graphs: [
        { type: "level-xy", title: "Column oven — set temperature vs thermometer", xLabel: "Set temperature (°C)", yLabel: "Thermometer reading (°C)", y: "thermometer", line: "identity" },
        { type: "level-xy", title: "Column oven — set temperature vs instrument display", xLabel: "Set temperature (°C)", yLabel: "Instrument display reading (°C)", y: "display", line: "identity" },
      ],
    },
    /* 5 ------------------------------------------------------------ */
    {
      key: "hplc_precision",
      name: "System and Injector Precision",
      objective: "Evaluate the repeatability of the chromatographic system and injector (five replicate injections of caffeine 10 ppm).",
      category: "System",
      stage: "Calibration",
      procedure: "Inject the 10 ppm caffeine standard five times and record the retention time and peak area of caffeine for every injection. Calculate separately for RT and area: mean, sample SD (n − 1), individual deviation (xᵢ − mean), |deviation| and RSD % = SD / mean × 100. The test passes only if both criteria pass.",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.4 (also p.1 summary item 5)",
      conditions: PRECISION_CONDITIONS,
      requiredMaterials: "DI water, methanol, caffeine standard, C18 column 25 cm × 4.6 mm.",
      requiredReferenceStandards: "Caffeine (batch / grade to be recorded — not reliably legible in the source).",
      parameter: "Retention time and peak area",
      unit: "",
      dataType: "multi-level",
      levelName: "Injection No.",
      readingsRequired: 2,
      readingKeys: [
        { key: "rt", label: "Retention time", unit: "min", gt: 0 },
        { key: "area", label: "Peak area", unit: "", gt: 0 },
      ],
      levels: [1, 2, 3, 4, 5].map(i => level(`INJ${i}`, `Injection ${i}`, i, "")),
      calculations: [
        custom("rt_mean", "Mean RT", "mean(rt)", "min"),
        custom("rt_sd", "SD RT (n − 1)", "sd(rt)", "min"),
        custom("rt_rsd", "RSD RT %", "sd(rt) / mean(rt) * 100", "%"),
        custom("area_mean", "Mean peak area", "mean(area)", ""),
        custom("area_sd", "SD peak area (n − 1)", "sd(area)", ""),
        custom("area_rsd", "RSD peak area %", "sd(area) / mean(area) * 100", "%"),
        custom("rt_dev", "RT deviation (RTᵢ − mean)", "rt - rt_mean", "min", "per-level"),
        custom("rt_abs_dev", "|RT deviation|", "abs(rt_dev)", "min", "per-level"),
        custom("area_dev", "Area deviation (areaᵢ − mean)", "area - area_mean", "", "per-level"),
        custom("area_abs_dev", "|Area deviation|", "abs(area_dev)", "", "per-level"),
      ],
      criteria: [
        crit("rt_rsd_lim", "rt_rsd", "% RSD for retention time NMT 1.0 %.", "<=", { upper: 1.0, unit: "%", clause: "p.4 (also p.1 summary)", quote: "% RSD for Retention time is NMT 1.0" }),
        crit("area_rsd_lim", "area_rsd", "% RSD for area responses NMT 2.0 %.", "<=", { upper: 2.0, unit: "%", clause: "p.4 (also p.1 summary)", quote: "% RSD for Area responses is NMT 2.0" }),
      ],
      graphs: [
        { type: "level-xy", title: "Precision — retention time by injection number", xLabel: "Injection number", yLabel: "Retention time (min)", y: "rt", line: "connect", meanGuide: true },
        { type: "level-xy", title: "Precision — peak area by injection number", xLabel: "Injection number", yLabel: "Peak area", y: "area", line: "connect", meanGuide: true },
      ],
      notes: "Historical summary values (RT RSD 0.2 %, area RSD 0.1 %) are reference only and are not defaults.",
    },
    /* 6 ------------------------------------------------------------ */
    {
      key: "hplc_wavelength",
      name: "Wavelength Accuracy",
      objective: "Identify the wavelength of maximum chromatographic area response of caffeine 10 ppm.",
      category: "Detector",
      stage: "Calibration",
      procedure: "Inject the 10 ppm caffeine standard and record the area response at 267, 268, … 277 nm (11 points). Report the maximum response and the wavelength at which it occurs; tied maxima are all shown and flagged for review (never selected silently).",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.5 (also p.1 summary item 6)",
      conditions: "Caffeine standard 10 ppm; chromatographic conditions as for System and Injector Precision (HPLC.pdf p.4–5).",
      parameter: "Area response",
      unit: "nm",
      dataType: "multi-level",
      levelName: "Wavelength",
      readingsRequired: 1,
      readingKeys: [{ key: "area", label: "Area response", unit: "", gte: 0 }],
      levels: Array.from({ length: 11 }, (_, i) => level(`W${267 + i}`, `${267 + i} nm`, 267 + i, "nm")),
      calculations: [builtin("max_response", "Maximum area response", "max"), builtin("lambda_max", "Wavelength of maximum response", "level-reference-at-max", "nm")],
      criteria: [crit("lambda_lim", "lambda_max", "Maximum absorbance / response at 272 ± 2 nm (270–274 nm).", "between", { lower: 270, upper: 274, unit: "nm", clause: "p.5 (also p.1 summary)", quote: "Maximum absorbance should be 272 ± 2" })],
      graphs: [{ type: "level-xy", title: "Wavelength accuracy — area response vs wavelength", xLabel: "Wavelength (nm)", yLabel: "Area response", y: "area", line: "connect", markMax: true }],
      notes: "Historical maximum (274 nm) is reference only.",
    },
    /* 7 ------------------------------------------------------------ */
    {
      key: "hplc_detector_linearity",
      name: "Detector Linearity",
      objective: "Evaluate the relationship between caffeine concentration and detector peak area.",
      category: "Detector",
      stage: "Calibration",
      procedure: "Prepare caffeine 10, 20, 30, 40 and 50 ppm (1, 2, 3, 4, 5 mL of 1000 ppm stock → 100 mL) and record the peak area of each. Pearson r, least-squares slope m, intercept b (y = m·x + b), R² = 1 − SSres/SStot, predicted area and residual (actual − predicted) per level. Decision on r (not R²).",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.5–6 (also p.1 summary item 7)",
      conditions: "Chromatographic conditions as for System and Injector Precision (HPLC.pdf p.4–6).",
      parameter: "Peak area",
      unit: "ppm",
      dataType: "multi-level",
      levelName: "Concentration",
      readingsRequired: 1,
      readingKeys: [{ key: "area", label: "Peak area", unit: "", gt: 0 }],
      levels: [1, 2, 3, 4, 5].map(i => level(`C${i * 10}`, `${i * 10} ppm`, i * 10, "ppm", `${i} mL of 1000 ppm stock → 100 mL (HPLC.pdf p.5)`)),
      calculations: [
        builtin("slope", "Slope m", "linearity-slope"),
        builtin("intercept", "Intercept b", "linearity-intercept"),
        builtin("r", "Pearson correlation coefficient r", "linearity-r"),
        builtin("r2", "Coefficient of determination R²", "linearity-r2", "", "For the least-squares line with intercept R² = 1 − SSres/SStot = r²."),
        custom("predicted", "Predicted peak area (m·x + b)", "slope * reference + intercept", "", "per-level"),
        custom("residual", "Residual (actual − predicted)", "area - predicted", "", "per-level"),
      ],
      criteria: [
        crit("r_min", "r", "Correlation coefficient r should not be less than 0.99 (r ≥ 0.99).", ">=", {
          lower: 0.99,
          clause: "p.6 (detailed acceptance)",
          quote: "Correlation coefficient should not be less than 0.99",
          conflict: "Review note B: the p.1 summary wording reads \"Should ot be less than 0.99\" (appears as \"less than 0.99\"); r ≥ 0.99 adopted from p.6 per user instruction.",
        }),
      ],
      graphs: [{ type: "level-xy", title: "Detector linearity — concentration vs peak area", xLabel: "Concentration (ppm)", yLabel: "Peak area", y: "area", line: "regression" }],
      notes: "Historical r = 1.00 is reference only.",
    },
    /* 8 ------------------------------------------------------------ */
    {
      key: "hplc_autosampler_linearity",
      name: "Autosampler Linearity",
      objective: "Evaluate the relationship between injection volume and caffeine peak area.",
      category: "Autosampler",
      stage: "Calibration",
      procedure: "For the 100 µL injector capacity inject 5, 10, 20, 50, 80 and 100 µL of the standard from separate vials and record the peak area. Pearson r, slope, intercept, R², predicted area and residuals as for detector linearity. Decision on r.",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.6 (also p.1 summary item 8)",
      conditions: "Mobile phase, column, flow rate, wavelength and standard solution as for System and Injector Precision. Injector capacity 100 µL per source — verify the configured capacity (review note G).",
      parameter: "Peak area",
      unit: "µL",
      dataType: "multi-level",
      levelName: "Injection volume",
      readingsRequired: 1,
      readingKeys: [{ key: "area", label: "Peak area", unit: "", gt: 0 }],
      levels: [5, 10, 20, 50, 80, 100].map(v => level(`V${v}`, `${v} µL`, v, "µL")),
      calculations: [
        builtin("slope", "Slope m", "linearity-slope"),
        builtin("intercept", "Intercept b", "linearity-intercept"),
        builtin("r", "Pearson correlation coefficient r", "linearity-r"),
        builtin("r2", "Coefficient of determination R²", "linearity-r2", "", "For the least-squares line with intercept R² = 1 − SSres/SStot = r²."),
        custom("predicted", "Predicted peak area (m·x + b)", "slope * reference + intercept", "", "per-level"),
        custom("residual", "Residual (actual − predicted)", "area - predicted", "", "per-level"),
      ],
      criteria: [crit("r_min", "r", "Correlation coefficient r should not be less than 0.99 (r ≥ 0.99).", ">=", { lower: 0.99, clause: "p.6 (also p.1 summary)", quote: "Correlation coefficient Should not be less than 0.99" })],
      graphs: [{ type: "level-xy", title: "Autosampler linearity — injection volume vs peak area", xLabel: "Injection volume (µL)", yLabel: "Peak area", y: "area", line: "regression" }],
      notes: "Historical r = 1.00 is reference only.",
    },
    /* 9 ------------------------------------------------------------ */
    {
      key: "hplc_carryover",
      name: "Carryover Test",
      objective: "Assess residual caffeine response in a blank injection following the carryover solution.",
      category: "Autosampler",
      stage: "Calibration",
      procedure: "Inject the carryover solution, then the blank (water); record the caffeine areas. Carryover % = area of caffeine in blank / area of caffeine in carryover solution × 100.",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.7 (also p.1 summary item 9)",
      requiredMaterials: "Carryover solution — Preparation Details Pending Verification (handwritten: approx. 100 mg caffeine into a 10 mL volumetric flask, dissolve and dilute with water; batch / make / grade not reliably legible). Blank: water.",
      parameter: "Carryover",
      unit: "%",
      dataType: "calculated",
      readingsRequired: 0,
      fields: [numField("blank_area", "Area of caffeine in blank solution (water)", "", { gte: 0 }), numField("carry_area", "Area of caffeine in carryover solution", "", { gt: 0 })],
      calculations: [custom("carry_pct", "Carryover %", "blank_area / carry_area * 100", "%", "test", "HPLC.pdf p.7")],
      criteria: [crit("carry_lim", "carry_pct", "Carryover NMT 0.01 %.", "<=", { upper: 0.01, unit: "%", clause: "p.7 (also p.1 summary)", quote: "Acceptance criteria: Carryover should not be more than 0.01%" })],
      notes: "Preparation Details Pending Verification (review note G). Historical result 0.0002 % is reference only.",
    },
    /* 10 ----------------------------------------------------------- */
    {
      key: "hplc_gpv",
      name: "Gradient Proportioning Valve",
      objective: "Assess the proportioning performance of the gradient valve for pump combinations A&B, A&C, A&D at 10 / 50 / 90 %.",
      category: "Pump",
      stage: "Calibration",
      procedure: "For each combination and setting record the signal height at 0 %, at the setting and at 100 %. Actual concentration % = (H setting − H 0 %) / (H 100 % − H 0 %) × 100; deviation = actual − setting (percentage points); relative deviation % = (actual − setting) / setting × 100. Acceptance: |relative deviation| ≤ 2.0 % of the setting value. H 100 % must differ from H 0 %.",
      referenceIds: [R],
      referenceClause: "HPLC.pdf p.7–9 (also p.1 summary item 10)",
      conditions: "Wavelength 254 nm (handwritten — verify); flow rate 1.0 mL/min; pump A: water (100 %); pumps B, C, D: acetone (handwritten concentration appears as 0.3 % — verify). (HPLC.pdf p.7)",
      parameter: "Actual concentration",
      unit: "%",
      dataType: "multi-level",
      levelName: "Setting value",
      readingsRequired: 3,
      readingKeys: [
        { key: "h0", label: "Height at 0 %", unit: "" },
        { key: "hset", label: "Height at setting", unit: "" },
        { key: "h100", label: "Height at 100 %", unit: "" },
      ],
      levels: (["B", "C", "D"] as const).flatMap(p => [10, 50, 90].map(v => level(`A${p}${v}`, `Pump A & ${p} — ${v} %`, v, "%", "", `Pump A & ${p}`))),
      calculations: [
        custom("actual", "Actual concentration %", "(hset - h0) / (h100 - h0) * 100", "%", "per-level", "HPLC.pdf p.7–8"),
        custom("dev", "Deviation (actual − setting)", "actual - reference", "percentage points", "per-level"),
        custom("abs_dev", "|Deviation|", "abs(dev)", "percentage points", "per-level"),
        custom("rel_dev", "Relative deviation % of setting", "(actual - reference) / reference * 100", "%", "per-level", "± 2.0 % relative to the setting value (user decision, review note C)"),
      ],
      criteria: [
        crit("gpv_limit", "rel_dev", "Actual concentration within the setting value ± 2.0 % (relative): |actual − setting| / setting × 100 ≤ 2.0 (e.g. 9.8–10.2 % at a 10 % setting).", "abs<=", {
          tolerance: 2.0,
          unit: "%",
          clause: "p.1 summary (\"Setting value ± 2.0\"); p.7–9",
          quote: "Setting value ± 2.0",
          evidence: HPLC_USER_DECISIONS.gpv,
          conflict: "Review note C (resolved): relative interpretation applied by user decision; USP <621> / <1058> extracts specify no GPV limit.",
        }),
      ],
      graphs: [{ type: "level-xy", title: "Gradient proportioning valve — setting vs actual concentration", xLabel: "Setting (%)", yLabel: "Actual concentration (%)", y: "actual", line: "identity" }],
      notes: "Historical summary values (A&B 10.5 / 51.1 / 90.8; A&C 9.8 / 50.5 / 90.1; A&D 10.3 / 50.5 / 90.4 %) are reference only.",
    },
  ];
}

function gaps(): NonNullable<ProtocolContentInput["gaps"]> {
  const spec = (label: string, displayValue: string, clause: string, value: number | null = null) => ({ label, value, displayValue, sourceClass: SRC, referenceId: R, clause });
  return [
    {
      key: "noteA_flow_setpoints",
      title: "A — Flow-rate setpoints differ between p.1 and p.2 (resolved: p.1 values)",
      description: "HPLC.pdf p.1 summary lists 1.0 / 1.5 / 2.0 mL/min; the p.2 detailed procedure prints 0.5 / 1.5 / 2.5 mL/min (with handwritten calculations 10.0/10.0 = 1.0, 10.0/6.6 = 1.52, 10.0/5 = 2.0 and margin corrections). The execution prompt proposed p.2; the user's later instruction (HPLC.txt authoritative) adopts p.1.",
      testKey: "hplc_flow_rate",
      unit: "mL/min",
      specifications: [spec("p.1 summary (adopted)", "1.0 / 1.5 / 2.0 mL/min", "HPLC.pdf p.1"), spec("p.2 detailed procedure (retained)", "0.5 / 1.5 / 2.5 mL/min", "HPLC.pdf p.2")],
      assessment: `RESOLVED — ${HPLC_USER_DECISIONS.flow} The p.2 values are retained here unchanged for traceability.`,
      claimRestriction: "",
    },
    {
      key: "noteB_linearity_wording",
      title: "B — Detector linearity wording on p.1",
      description: "The p.1 summary reads \"Correlation coefficient Should ot be less than 0.99\" (appears as \"less than 0.99\"); p.6 states \"Correlation coefficient should not be less than 0.99\".",
      testKey: "hplc_detector_linearity",
      unit: "",
      specifications: [spec("p.1 summary wording", "\"Should ot be less than 0.99\"", "HPLC.pdf p.1"), spec("p.6 detailed acceptance (adopted)", "r ≥ 0.99", "HPLC.pdf p.6", 0.99)],
      assessment: "Adopted r ≥ 0.99 (Pearson r, not R²) from p.6 per user instruction. Recorded for Quality Manager review.",
      claimRestriction: "",
    },
    {
      key: "noteC_gpv_interpretation",
      title: "C — Gradient proportioning valve tolerance interpretation (resolved: ± 2.0 % relative)",
      description: "The source states \"Setting value ± 2.0\" without defining percentage points vs relative percent. The formula yields a difference in percentage points.",
      testKey: "hplc_gpv",
      unit: "percentage points",
      specifications: [
        spec("Source wording", "Setting value ± 2.0", "HPLC.pdf p.1"),
        spec("Earlier interpretation (superseded)", "|actual − setting| ≤ 2.0 percentage points", "HPLC.pdf p.1, p.7–9", 2.0),
        spec("Adopted (user decision)", "|actual − setting| / setting × 100 ≤ 2.0 %", "HPLC.pdf p.1, p.7–9", 2.0),
        { label: "USP <621> / <1058> (supplied extracts)", value: null, displayValue: "NOT SPECIFIED IN SUPPLIED USP SOURCE", sourceClass: "pharmacopoeial" as const, referenceId: null, clause: "USP <621> Chromatography; USP <1058> AIQ" },
      ],
      assessment: `RESOLVED — ${HPLC_USER_DECISIONS.gpv}`,
      claimRestriction: "",
    },
    {
      key: "noteD_lamp_hours",
      title: "D — UV lamp hours: replacement recommendation, not a pass criterion",
      description: "The source states \"Minimum 2000 hrs to replace the UV lamps\".",
      testKey: "hplc_uv_lamp_hours",
      unit: "h",
      specifications: [spec("Replacement recommendation", "2000 h", "HPLC.pdf p.3", 2000)],
      assessment: "Implemented as a maintenance / replacement advisory (alert at ≥ 2000 h). The test is informational and never fails the calibration.",
      claimRestriction: "",
    },
    {
      key: "noteE_equipment_identity",
      title: "E — Source instrument differs from the Equipment Master record",
      description: "HPLC.pdf identifies Shimadzu LC 2030 PLUS, instrument ID RLS/QC/HPLC/02. The existing Equipment Master HPLC record (reused — no duplicate created) is QC-I-104, model LC-40B XR, S/N L22146101115 AE.",
      testKey: null,
      unit: "",
      specifications: [spec("Source record (HPLC.pdf p.1)", "Shimadzu LC 2030 PLUS — ID RLS/QC/HPLC/02", "HPLC.pdf p.1"), { label: "Equipment Master", value: null, displayValue: "QC-I-104 — LC-40B XR — S/N L22146101115 AE", sourceClass: "institutional" as const, referenceId: null, clause: "Equipment Master record \"hplc\"" }],
      assessment: "The protocol is linked to the existing Equipment Master record (current identification comes from the Equipment Master). The model / ID difference is recorded for Quality Manager review before approval.",
      claimRestriction: "",
    },
    {
      key: "noteF_lamp_wavelength",
      title: "F — Lamp reference energy wavelength",
      description: "HPLC.txt and the execution prompt give 254 nm; the scanned p.3 shows the wavelength written as \"NA\".",
      testKey: "hplc_lamp_energy",
      unit: "nm",
      specifications: [spec("HPLC.txt / execution prompt", "254 nm", "HPLC.txt §4 Test 2", 254), spec("Scanned p.3", "\"NA\"", "HPLC.pdf p.3")],
      assessment: "254 nm is pre-filled as the source-defined wavelength and can be changed at execution; recorded for review.",
      claimRestriction: "",
    },
    {
      key: "noteG_handwritten_details",
      title: "G — Handwritten details pending verification",
      description: "Not reliably legible / to be verified against the original record: mobile phase preparation (p.4), caffeine batch and grade (p.4, p.7), carryover solution preparation (~100 mg caffeine in 10 mL — Preparation Details Pending Verification, p.7), gradient mobile phase (acetone concentration, p.7), gradient wavelength 254 nm (p.7), autosampler capacity 100 µL (p.6).",
      testKey: null,
      unit: "",
      specifications: [spec("Items to verify", "HPLC.txt section 8 items 3–11", "HPLC.pdf p.4, p.6, p.7")],
      assessment: "Kept as source notes only; no missing value was invented. Historical values of the 2022 record are never defaults.",
      claimRestriction: "",
    },
  ];
}

const SRC_NOTE = "source instrument Shimadzu LC 2030 PLUS, ID RLS/QC/HPLC/02 — verify for this equipment";
/**
 * Specification values documented in HPLC.pdf, recorded on the Equipment Master
 * HPLC record (empty fields only). Not used: historical results, lamp hours
 * (763 h, 2022 "as found"), calibration dates 20/08/2022 / 20/02/2023, location
 * of the source laboratory. Software name / version are not in the source.
 */
export const HPLC_EQUIPMENT_SPEC_SEED: Record<string, { value: string | number; unit: string; source: string }> = {
  pumpConfiguration: { value: "Four solvent channels (pumps A, B, C, D) with gradient proportioning valve", unit: "", source: `HPLC.pdf p.7–9 (GPV test A&B, A&C, A&D); ${SRC_NOTE}` },
  injectorType: { value: "Autosampler", unit: "", source: `HPLC.pdf p.6 (autosampler linearity); ${SRC_NOTE}` },
  injectorCapacity: { value: 100, unit: "µL", source: `HPLC.pdf p.6 ("For 100 µL injector capacity"); ${SRC_NOTE}` },
  detectorType: { value: "UV detector (UV lamp)", unit: "", source: `HPLC.pdf p.3 (lamp energy, UV lamp hours); ${SRC_NOTE}` },
  detectorWavelength: { value: "272 nm (precision / linearity; wavelength check 267–277 nm); 254 nm (lamp energy / GPV)", unit: "", source: `HPLC.pdf p.3–7; ${SRC_NOTE}` },
  columnType: { value: "C18", unit: "", source: `HPLC.pdf p.4 (chromatographic conditions); ${SRC_NOTE}` },
  columnDimensions: { value: "25 cm × 4.6 mm", unit: "", source: `HPLC.pdf p.4 (chromatographic conditions); ${SRC_NOTE}` },
  calibrationInterval: { value: "Semi-annual (6 months)", unit: "", source: `HPLC.pdf p.1 ("Semi Annual Calibration"); ${SRC_NOTE}` },
};

/** Equipment information fields required by the protocol (HPLC.pdf execution prompt §2.2); unknown values show "Needs Equipment Information". */
export const HPLC_EQUIPMENT_FIELDS = [
  ["Identification", "Equipment Name", "identity:nameEn"],
  ["Identification", "Equipment ID", "identity:instrumentId"],
  ["Identification", "Manufacturer", "identity:manufacturer"],
  ["Identification", "Model", "identity:model"],
  ["Identification", "Serial Number", "identity:serialNumber"],
  ["Identification", "Location", "spec:location"],
  ["Identification", "Installation Date", "spec:installationDate"],
  ["Identification", "Calibration Date", "spec:lastCalibration"],
  ["Identification", "Due Date", "spec:nextCalibration"],
  ["Chromatographic System", "Pump Configuration", "spec:pumpConfiguration"],
  ["Chromatographic System", "Injector Type", "spec:injectorType"],
  ["Chromatographic System", "Autosampler Capacity", "spec:injectorCapacity"],
  ["Chromatographic System", "Detector Type", "spec:detectorType"],
  ["Chromatographic System", "Detector Wavelength", "spec:detectorWavelength"],
  ["Chromatographic System", "Column Type", "spec:columnType"],
  ["Chromatographic System", "Column Dimensions", "spec:columnDimensions"],
  ["Chromatographic System", "Software Name", "spec:softwareName"],
  ["Chromatographic System", "Software Version", "spec:softwareVersion"],
] as const;

export function hplcEquipmentDescription(eq: { identity: Record<string, string>; specs: Record<string, { value: number | string | null; unit: string } | undefined> } | null) {
  return HPLC_EQUIPMENT_FIELDS.map(([group, label, path]) => {
    const [kind, k] = path.split(":");
    let v: string | null = null;
    if (eq && kind === "identity") v = eq.identity[k]?.trim() || null;
    if (eq && kind === "spec") {
      const s = eq.specs[k];
      v = s && s.value !== null && String(s.value).trim() !== "" ? `${s.value}${s.unit ? ` ${s.unit}` : ""}` : null;
    }
    return `${group} — ${label}: ${v ?? "Needs Equipment Information"}`;
  }).join("\n");
}

/**
 * Full protocol content. `equipment` is the existing Equipment Master record
 * (identification + link); `referenceId` the Reference Library id of HPLC.pdf.
 */
export function hplcProtocolContent(input: { referenceId: string; equipment: HplcEquipment; equipmentDescription: string }): ProtocolContent {
  const eq = input.equipment;
  const raw: ProtocolContentInput = {
    identification: {
      title: HPLC_PROTOCOL_TITLE,
      number: HPLC_PROTOCOL_NUMBER,
      description: `${HPLC_INITIAL_STATUS}. Source type: ${HPLC_SOURCE_TYPE}; source document: ${HPLC_SOURCE_DOCUMENT} (9 scanned pages; page references on every test and criterion). Not a USP requirement. Ten tests. Discrepancies are recorded as review notes A–G. [${HPLC_SEED_VERSION}]`,
      category: "HPLC",
      equipmentCategory: "HPLC",
      equipmentType: eq.equipmentType || "hplc",
      manufacturer: eq.manufacturer,
      model: eq.model,
      associationType: "equipment",
      intendedUse: "Semi-annual calibration of the HPLC system",
      protocolType: "calibration",
      department: "Quality Control",
      applicableStandards: `${HPLC_SOURCE_DOCUMENT} — ${HPLC_SOURCE_TYPE} (not a USP requirement)`,
      applicableSops: eq.sopNumber ?? "",
      relatedForm: eq.formNumber ?? "",
    },
    narrative: {
      purpose: "To calibrate the HPLC system (pump, detector, column oven, autosampler and gradient proportioning valve) with the ten tests of the laboratory calibration reference HPLC.pdf.",
      scope: `Applies to the HPLC registered in the Equipment Master (${eq.instrumentId}, ${eq.manufacturer} ${eq.model}, S/N ${eq.serialNumber}). Source instrument of HPLC.pdf: Shimadzu LC 2030 PLUS, ID RLS/QC/HPLC/02 (review note E). Exactly ten tests; no USP system-suitability tests are part of this protocol.`,
      responsibilities: "Analyst: performs the tests and records the readings in New Validation. Quality Manager: reviews the review notes A–G, verifies the source reference and the pending criteria, and approves the revision (Draft → Approved). The protocol is not approved automatically.",
      definitions: "RT — retention time; RSD — relative standard deviation (sample SD, n − 1); r — Pearson correlation coefficient; R² — coefficient of determination; GPV — gradient proportioning valve; ppm — parts per million (mg/L).",
      equipmentDescription: input.equipmentDescription,
      requiredMaterials: "10.0 mL class A volumetric flask, stopwatch, calibrated digital thermometer, DI water, methanol, acetone, caffeine standard, C18 column 25 cm × 4.6 mm.",
      requiredReferenceStandards: "Caffeine standard (batch / grade to be recorded).",
      deviationManagement: "Any FAIL, invalid input or missing reading prevents a PASS. Missing or invalid inputs are reported as Pending and are never treated as zero or as passing. Deviations are handled according to the laboratory deviation procedure.",
      finalAssessment: "Each test is evaluated against its source criterion with full-precision calculations (rounding for display only). The overall result is PASS only when every decisional test passes; UV lamp hours are informational (maintenance status) and are not part of the PASS / FAIL decision. Historical results of the 2022 record are reference only.",
    },
    stages: ["Calibration"],
    equipmentLinks: [{ instrumentKey: eq.instrumentKey, instrumentId: eq.instrumentId, serialNumber: eq.serialNumber, manufacturer: eq.manufacturer, model: eq.model, compatibilityNote: `Existing Equipment Master record reused (no duplicate). Source record: Shimadzu LC 2030 PLUS, ID RLS/QC/HPLC/02 — see review note E.` }],
    references: [{ referenceId: R, supports: `All ten tests — procedures, setpoints, formulas and acceptance limits (${HPLC_SOURCE_TYPE})`, clause: "PDF pages 1–9" }],
    sections: [{ key: "calibration", title: "Calibration Tests (HPLC.pdf)", stage: "Calibration", referenceIds: [R], description: "Ten tests transcribed from HPLC.pdf with page references.", tests: tests() }],
    gaps: gaps(),
  };
  const json = JSON.stringify(raw).split(JSON.stringify(R)).join(JSON.stringify(input.referenceId));
  return parseProtocolContent(JSON.parse(json));
}
