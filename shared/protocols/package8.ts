/**
 * EIGHT-PROTOCOL PACKAGE — import definitions.
 *
 * Source: docs/Calibration_8_Protocols_System_Integration_Package.zip
 * (8 protocol .docx drafts + register + balance technical review note) and
 * docs/HPLC.pdf (controlling HPLC reference). See docs/EIGHT-PROTOCOLS-INVENTORY.md.
 *
 * Rules (master prompt + user instructions):
 *  - every protocol is imported as a DRAFT; every criterion is
 *    PENDING TECHNICAL VERIFICATION (never pre-verified);
 *  - a numeric limit is configured only when the supplied source states it;
 *    otherwise the criterion is record-only and states
 *    "NOT SPECIFIED IN SUPPLIED USP SOURCE" (record-only never yields PASS);
 *  - conflicts between sources are imported as technical gaps (reviewer
 *    decision required) — nothing is silently overwritten;
 *  - historical record values are NOT imported as results;
 *  - the test list of each protocol is device-specific (the workflow stepper
 *    derives one step per test — there is no fixed number of steps).
 *
 * Reference ids are placeholders ("@KEY") remapped to Reference Library ids at import.
 */
import type { ProtocolContentInput, ReferenceType } from "./model";

export const NOT_SPECIFIED = "NOT SPECIFIED IN SUPPLIED USP SOURCE";
export const PACKAGE_ID = "CAL-PKG-8";
export const PACKAGE_IMPORT_REASON = "Import of the supplied 8-protocol calibration package (DRAFT, all criteria PENDING TECHNICAL VERIFICATION). Loading a protocol does not imply that the instrument passed.";

export type PackageReference = {
  placeholder: string;
  code: string;
  title: string;
  issuer: string;
  referenceType: ReferenceType;
  documentNumber: string;
  edition: string;
  revision: string;
  publicationDate: string;
  sourceUrl: string;
  applicableSection: string;
  notes: string;
};

const usp = (n: string, title: string, pages: string): PackageReference => ({
  placeholder: `@USP${n}`,
  code: `USP-${n}`,
  title: `USP General Chapter <${n}> ${title}`,
  issuer: "United States Pharmacopeia (USP)",
  referenceType: "pharmacopoeia",
  documentNumber: `<${n}>`,
  edition: "",
  revision: "",
  publicationDate: "",
  sourceUrl: "",
  applicableSection: "",
  notes: `Supplied USA USP extract (${pages}) from the 8-protocol package. Official edition, effective date and PDF/printed page references must be verified before approval.`,
});

export const PACKAGE_REFERENCES: PackageReference[] = [
  usp("621", "Chromatography", "19 pages"),
  usp("781", "Optical Rotation", "3 pages"),
  usp("41", "Balances", "1 page"),
  usp("1251", "Weighing on an Analytical Balance", "6 pages"),
  usp("731", "Loss on Drying", "1 page"),
  usp("711", "Dissolution", "18 pages"),
  usp("701", "Disintegration", "4 pages"),
  usp("831", "Refractive Index", "2 pages"),
  usp("857", "Ultraviolet-Visible Spectroscopy", "9 pages"),
  usp("1857", "Ultraviolet-Visible Spectroscopy—Theory and Practice", "14 pages"),
  usp("1058", "Analytical Instrument Qualification", "7 pages"),
  {
    placeholder: "@HPLCREC",
    code: "HPLC-CAL-RECORD-LC2030",
    title: "HPLC Calibration Summary Report and Calibration Record (Annexure II, format QC/049/F02-02) — Shimadzu LC 2030 PLUS, ID RLS/QC/HPLC/02",
    issuer: "Supplied instrument record (docs/HPLC.pdf, 9 scanned pages)",
    referenceType: "calibration-certificate",
    documentNumber: "QC/049/F02-02",
    edition: "",
    revision: "",
    publicationDate: "",
    sourceUrl: "",
    applicableSection: "Summary p.1; data sheets pp.2–9",
    notes: "Controlling HPLC reference per user instruction. Calibration date 20/08/2022, due 20/02/2023. Contains internal inconsistencies in flow-rate setpoints (see protocol gaps). Historical results are not imported as results.",
  },
  {
    placeholder: "@SARTORIUS",
    code: "SARTORIUS-ED224S-SPEC",
    title: "Sartorius ED224S data sheet / operating instructions (model specification table)",
    issuer: "Sartorius",
    referenceType: "manufacturer-specification",
    documentNumber: "",
    edition: "",
    revision: "",
    publicationDate: "",
    sourceUrl: "",
    applicableSection: "Capacity, readability, repeatability, linearity, operating conditions",
    notes: "Cited by CAL-QC-BAL-001 Rev.01 §3–4. Verify against the controlled manufacturer copy held by the site before execution.",
  },
  {
    placeholder: "@PKG",
    code: PACKAGE_ID,
    title: "Calibration & Qualification Protocol Package — eight device-specific protocol drafts (supplied)",
    issuer: "Supplied by the laboratory (docs/Calibration_8_Protocols_System_Integration_Package.zip)",
    referenceType: "institutional-procedure",
    documentNumber: PACKAGE_ID,
    edition: "",
    revision: "Rev.00 drafts; CAL-QC-BAL-001 Rev.01",
    publicationDate: "",
    sourceUrl: "",
    applicableSection: "Protocol sections 1–15",
    notes: "Source documents of the imported protocols. No device may be released based solely on this draft package.",
  },
];

/* ------------------------------------------------------------------ */
/* Builders                                                             */
/* ------------------------------------------------------------------ */

type Cmp = "between" | "<=" | "<" | ">=" | ">" | "abs<=" | "target±tolerance" | "pass-fail" | "record-only";
type CritOpts = { lower?: number; upper?: number; target?: number; tolerance?: number; unit?: string; levelKey?: string; sourceClass?: string; ref?: string; clause?: string; justification?: string; conflict?: string };

const crit = (key: string, parameter: string, requirement: string, comparison: Cmp, o: CritOpts = {}) => ({
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
  sourceClass: (o.sourceClass ?? "pharmacopoeial") as "pharmacopoeial",
  referenceId: o.ref ?? null,
  referenceClause: o.clause ?? "",
  justification: o.justification ?? "",
  verificationStatus: "pending-technical-verification" as const,
  verificationEvidence: "",
  conflictNote: o.conflict ?? "",
});

/** Record-only criterion: the source states no numeric limit. Never yields PASS. */
const notSpecified = (key: string, what: string, ref: string, clause = "") =>
  crit(key, "", `${what} — ${NOT_SPECIFIED}. Apply the requirement only after it is confirmed from the exact applicable USP section / monograph / approved instrument specification at technical review.`, "record-only", { ref, clause });

const passFail = (field: string, requirement: string, ref: string, clause = "") => crit(`c_${field}`, field, requirement, "pass-fail", { ref, clause });

const fBool = (key: string, label: string) => ({ key, label, type: "boolean" as const, unit: "", required: true, options: [] });
const fNum = (key: string, label: string, unit = "", required = true) => ({ key, label, type: "number" as const, unit, required, options: [] });
const fText = (key: string, label: string, required = false) => ({ key, label, type: "text" as const, unit: "", required, options: [] });
const fDate = (key: string, label: string, required = false) => ({ key, label, type: "date" as const, unit: "", required, options: [] });
const fSelect = (key: string, label: string, options: string[], required = true) => ({ key, label, type: "single-select" as const, unit: "", required, options });
const fCert = (key: string, label: string, required = true) => ({ key, label, type: "certificate" as const, unit: "", required, options: [] });

/** Intermediate calculations that feed other calculations are NOT rounded (decimals null) — rounding only the reported end results prevents premature rounding from changing a decision. */
type Calc = { key: string; label: string; kind: string; formula?: string; scope?: "test" | "per-level"; unit?: string; decimals?: number | null; formulaRevision?: string };
const calc = (c: Calc) => ({ key: c.key, label: c.label, kind: c.kind as "custom", formula: c.formula ?? "", scope: c.scope ?? "test", unit: c.unit ?? "", decimals: c.decimals ?? null, significantFigures: null, formulaRevision: c.formulaRevision ?? "PKG8-1", justification: "" });

const level = (key: string, label: string, nominal: number | null, unit: string, referenceNote = "") => ({ key, label, nominal, unit, referenceNote });

type TestDef = {
  key: string;
  name: string;
  stage: string;
  category?: string;
  procedure: string;
  sourceAcceptance: string;
  refs: string[];
  clause?: string;
  dataType: "numeric" | "series" | "multi-level" | "checklist" | "text" | "calculated" | "reference-comparison" | "documentary";
  unit?: string;
  readingsRequired?: number;
  levels?: ReturnType<typeof level>[];
  fields?: Array<ReturnType<typeof fBool> | ReturnType<typeof fNum> | ReturnType<typeof fText> | ReturnType<typeof fDate> | ReturnType<typeof fSelect> | ReturnType<typeof fCert>>;
  calculations?: ReturnType<typeof calc>[];
  criteria: ReturnType<typeof crit>[];
  notes?: string;
  dependsOn?: string;
};

const test = (d: TestDef) => ({
  key: d.key,
  name: d.name,
  description: `Source acceptance / rule (verbatim from the supplied protocol): ${d.sourceAcceptance}`,
  objective: "",
  category: d.category ?? d.stage,
  stage: d.stage,
  method: "",
  procedure: d.procedure,
  referenceIds: d.refs,
  referenceClause: d.clause ?? "",
  requiredMaterials: "",
  requiredInstruments: "",
  requiredReferenceStandards: "",
  parameter: "",
  unit: d.unit ?? "",
  nominal: null,
  dataType: d.dataType,
  readingsRequired: d.readingsRequired ?? (["numeric", "series", "reference-comparison", "multi-level"].includes(d.dataType) ? 1 : 0),
  replicates: 1,
  levels: d.levels ?? [],
  conditions: "",
  fields: d.fields ?? [],
  calculations: d.calculations ?? [],
  criteria: d.criteria,
  requiredEvidence: "Raw data printouts / certificates / photographs as applicable (attach to the execution).",
  attachmentsRequired: false,
  notes: d.notes ?? "",
  required: true,
  dependency: d.dependsOn ? { type: "sequential" as const, testKey: d.dependsOn, note: "" } : { type: "independent" as const, testKey: null, note: "" },
});

const placeholderCount = (n: number, what: string) => `${what}: count ${NOT_SPECIFIED.replace("USP ", "")} — configured placeholder ${n}; confirm and edit in the draft before technical review.`;

const gap = (key: string, title: string, description: string, specs: Array<{ label: string; displayValue: string; ref: string; clause: string; sourceClass?: string; value?: number | null }>, testKey: string | null = null, unit = "") => ({
  key,
  title,
  description,
  testKey,
  specifications: specs.map(s => ({ label: s.label, value: s.value ?? null, displayValue: s.displayValue, sourceClass: (s.sourceClass ?? "pharmacopoeial") as "pharmacopoeial", referenceId: s.ref, clause: s.clause })),
  unit,
  assessment: "",
  claimRestriction: "",
});

const STANDARD_NARRATIVE = (device: string) => ({
  purpose: `To define a documented, risk-based approach for installation, operational and performance qualification of the ${device} and to demonstrate fitness for its intended pharmaceutical laboratory use.`,
  scope: "Applies to the identified instrument and its critical accessories, measurement functions, software/firmware and associated records. This protocol does not replace product-specific analytical methods or monograph requirements.",
  responsibilities:
    "Calibration / Validation: protocol ownership, execution or oversight, calculations, traceability, deviations and technical report.\nEquipment Owner / QC User: define intended use, provide method/monograph conditions, support PQ and assess impact on analytical work.\nEngineering / Maintenance: installation utilities, repairs, preventive maintenance and technical support.\nQuality Assurance: independent review, deviation assessment, approval and controlled release.",
  definitions: "IQ: documented evidence of correct installation. OQ: documented evidence that functions operate as intended. PQ: documented evidence of suitable performance under routine or representative operating conditions. AIQ is a lifecycle, risk-based process; see USP <1058>.",
  requiredReferenceStandards: "Qualified reference standards with valid certificates; traceability and uncertainty information. Record reference standard ID / certificate / due date at execution.",
  environmentalConditions: "Suitable environment confirmed before testing; record environmental conditions at execution.",
  safetyRequirements: "Confirm approved protocol/revision; equipment identity and status; current maintenance; suitable environment; qualified reference standards with valid certificates; traceability and uncertainty information; trained personnel; clean and serviceable accessories; approved methods; and safe operating conditions. Record any unmet prerequisite as a deviation before testing.",
  deviationManagement:
    "Stop affected testing when a critical function fails or a result is outside its applicable acceptance criterion. Open a deviation; preserve raw data; assess instrument status, reference standards, method impact and results generated since the last acceptable check; investigate assignable cause; document corrective action and repeat testing only under an approved, justified plan. No result may be retrospectively invalidated without documented investigation.",
  finalAssessment:
    "Each test must be marked PASS, FAIL, NOT APPLICABLE (with justification), or NOT SPECIFIED IN SUPPLIED USP SOURCE. The instrument may be released only when all applicable tests pass, deviations are resolved or formally assessed, records are complete, and QA approval is documented. A missing USP criterion is not automatically a pass.",
});

const OPEN_ITEMS =
  "Open items before approval (source §15): complete instrument-specific model, serial number, range/capacity, resolution, software version, site SOP references, calibration interval, local environmental requirements, approved test conditions and reference-standard certificates. Confirm every acceptance criterion against the exact applicable USP section and instrument configuration. This draft is not an authorization to use the instrument.";

/** Generic IQ checklist (identity, installation, documentation) — every item must be confirmed. */
const iqTest = (key: string, procedure: string, items: Array<[string, string]>, refs: string[]) =>
  test({
    key,
    name: `${key} — Installation Qualification (IQ)`,
    stage: "IQ",
    procedure,
    sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
    refs,
    dataType: "checklist",
    fields: [...items.map(([k, l]) => fBool(k, l)), fText("software_version", "Software / firmware version (as found)", true), fText("location", "Location / room ID", true), fText("iq_notes", "Observations")],
    criteria: items.map(([k, l]) => passFail(k, `${l} — verified and documented (IQ procedure item of the supplied protocol).`, "@USP1058", "AIQ — IQ phase")),
  });

export type PackageProtocol = {
  number: string;
  instrumentKey: string | null;
  sourceRevision: string;
  sourceStatus: string;
  sourceFile: string;
  content: ProtocolContentInput;
};

type ProtocolSpec = {
  number: string;
  title: string;
  device: string;
  equipmentType: string;
  manufacturer: string;
  model: string;
  instrumentKey: string | null;
  sourceRevision: string;
  sourceStatus: string;
  sourceFile: string;
  references: Array<[string, string]>;
  stages: string[];
  sections: Array<{ key: string; title: string; stage: string; tests: ReturnType<typeof test>[] }>;
  gaps?: ReturnType<typeof gap>[];
  narrative?: Partial<ReturnType<typeof STANDARD_NARRATIVE>> & { equipmentDescription?: string; requiredMaterials?: string };
  extraDescription?: string;
};

function build(spec: ProtocolSpec): PackageProtocol {
  const description = [
    `Imported from the supplied package (${spec.sourceFile}). Source document revision: Rev.${spec.sourceRevision}; source status: ${spec.sourceStatus}.`,
    "System status: DRAFT — all acceptance criteria PENDING TECHNICAL VERIFICATION. Loading this protocol does not imply that the instrument passed.",
    spec.extraDescription ?? "",
    OPEN_ITEMS,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    number: spec.number,
    instrumentKey: spec.instrumentKey,
    sourceRevision: spec.sourceRevision,
    sourceStatus: spec.sourceStatus,
    sourceFile: spec.sourceFile,
    content: {
      identification: {
        title: spec.title,
        number: spec.number,
        description: description.slice(0, 2000),
        category: "Analytical instrument",
        equipmentCategory: "Laboratory instrument",
        equipmentType: spec.equipmentType,
        manufacturer: spec.manufacturer,
        model: spec.model,
        associationType: spec.instrumentKey ? "equipment" : "model",
        intendedUse: "Pharmaceutical QC laboratory use",
        protocolType: "IQ-OQ-PQ",
        department: "Quality Control",
        applicableStandards: spec.references.map(([, label]) => label).join("; "),
        applicableSops: "",
        relatedForm: "",
      },
      narrative: { ...STANDARD_NARRATIVE(spec.device), ...(spec.narrative ?? {}) },
      stages: spec.stages,
      risk: {},
      equipmentLinks: [],
      references: [
        ...spec.references.map(([ref, supports]) => ({ referenceId: ref, supports, clause: "" })),
        { referenceId: "@PKG", supports: `Source document ${spec.sourceFile} (Rev.${spec.sourceRevision})`, clause: "" },
      ],
      intervals: [],
      sections: spec.sections.map(s => ({ key: s.key, title: s.title, description: "", body: "", required: true, stage: s.stage, referenceIds: [], attachments: "", tests: s.tests })),
      gaps: spec.gaps ?? [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 1. HPLC — CAL-QC-HPLC-001 (values from docs/HPLC.pdf, controlling)   */
/* ------------------------------------------------------------------ */

const H = "@HPLCREC";
const hplcFlow = () => {
  const fields = [1, 2, 3].flatMap(i => [fNum(`set_${i}`, `Setpoint ${i} — set flow`, "mL/min"), fNum(`vol_${i}`, `Setpoint ${i} — volume collected (class A flask)`, "mL"), fNum(`time_${i}`, `Setpoint ${i} — time to fill`, "min")]);
  const calculations = [1, 2, 3].flatMap(i => [
    calc({ key: `flow_${i}`, label: `Actual flow ${i}`, kind: "custom", formula: `vol_${i} / time_${i}`, unit: "mL/min" }),
    calc({ key: `err_${i}`, label: `% error ${i}`, kind: "custom", formula: `(flow_${i} - set_${i}) / set_${i} * 100`, unit: "%", decimals: 2 }),
  ]);
  return test({
    key: "T01",
    name: "T01 — Flow-rate accuracy",
    stage: "OQ",
    procedure: "Record actual flow gravimetrically or volumetrically at the setpoints in the approved instrument-specific method. HPLC.pdf p.2: time taken for filling a 10.0 mL class A volumetric flask; actual flow = 10.0 / time taken (minutes). Calculate % error = (measured − set)/set × 100.",
    sourceAcceptance: "Record contains setpoints 1.0, 1.5 and 2.5 mL/min; acceptance ±1.0% of set value. Where USP <621> imposes a directly applicable requirement for the specific chromatographic procedure, verify and apply it; document any conflict and use the applicable USP requirement.",
    refs: [H, "@USP621"],
    clause: "HPLC.pdf summary item 1; data sheet p.2",
    dataType: "calculated",
    fields,
    calculations,
    criteria: [1, 2, 3].map(i => crit(`err_${i}_lim`, `err_${i}`, "Flow within ±1.0 % of the set value (HPLC.pdf: 'should be within ± 1.0% of the set value').", "abs<=", { tolerance: 1.0, unit: "%", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf summary item 1; data sheet p.2", conflict: "Setpoints conflict between sources (summary 1.0/1.5/2.0; data sheet printed 0.5/1.5/2.5 with handwritten corrections; protocol 1.0/1.5/2.5 mL/min) — enter the approved setpoint at execution; see gap H1." })),
    notes: "Setpoints are entered at execution (no default imposed) because the supplied sources conflict — see gap H1.",
  });
};

const HPLC = build({
  number: "CAL-QC-HPLC-001",
  title: "Calibration & Qualification Protocol — High-Performance Liquid Chromatography System",
  device: "HPLC",
  equipmentType: "HPLC",
  manufacturer: "Shimadzu",
  model: "LC-2030 PLUS",
  instrumentKey: null,
  sourceRevision: "00",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-HPLC-001_HPLC_Protocol_Rev00_DRAFT.docx",
  references: [
    [H, "Controlling HPLC values (user instruction): setpoints, acceptance limits, procedures and formulas"],
    ["@USP621", "Directly applicable chromatographic requirements (not to be conflated with instrument qualification)"],
    ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"],
  ],
  stages: ["OQ", "PQ"],
  extraDescription: "HPLC source hierarchy (source §3): compare the supplied instrument record (docs/HPLC.pdf) with the supplied USA USP chapters; HPLC.pdf is the controlling reference for values. Model association LC-2030 PLUS is taken from HPLC.pdf; the registered HPLC QC-I-104 (LC-40B XR / SPD-M40) differs — see gap H2.",
  narrative: { equipmentDescription: "HPLC.pdf identifies: Shimadzu LC 2030 PLUS, instrument ID RLS/QC/HPLC/02, semi-annual calibration 20/08/2022 (due 20/02/2023). Equipment identity of the system under qualification is completed at execution from the equipment profile." },
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Data Sheets",
      stage: "OQ",
      tests: [
        hplcFlow(),
        test({
          key: "T02", name: "T02 — Lamp reference energy", stage: "OQ",
          procedure: "Measure reference energy using the instrument procedure and record wavelength and displayed energy (HPLC.pdf p.3).",
          sourceAcceptance: "Record specifies NLT 400 mV. Confirm the source page and instrument method before execution.",
          refs: [H], clause: "HPLC.pdf summary item 2; p.3", dataType: "calculated",
          fields: [fNum("wavelength", "Wavelength", "nm", false), fNum("energy", "Displayed reference energy", "mV")],
          criteria: [crit("energy_min", "energy", "Reference energy NLT 400 mV (HPLC.pdf).", ">=", { lower: 400, unit: "mV", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf summary item 2; p.3", conflict: "HPLC.pdf records the wavelength as 'NA' — wavelength to be defined in the instrument method." })],
        }),
        test({
          key: "T03", name: "T03 — UV lamp hours", stage: "OQ",
          procedure: "Read lamp operating hours from instrument diagnostics; record lamp identity and replacement history.",
          sourceAcceptance: "Record states replace UV lamp at minimum 2000 h; treat as service/replacement trigger, not a universal USP acceptance limit.",
          refs: [H], clause: "HPLC.pdf summary item 3; p.3", dataType: "calculated",
          fields: [fNum("lamp_hours", "Lamp operating hours", "h"), fText("lamp_id", "Lamp identity / serial", true), fText("replacement_history", "Replacement history")],
          criteria: [crit("lamp_trigger", "lamp_hours", "Service / replacement trigger (HPLC.pdf: 'Minimum 2000hrs to replace the UV lamp'). Not a universal USP acceptance limit.", "<", { upper: 2000, unit: "h", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf summary item 3; p.3" })],
        }),
        test({
          key: "T04", name: "T04 — Column oven temperature", stage: "OQ",
          procedure: "Compare instrument display with a traceable calibrated thermometer at each specified setpoint after stabilization. Record the thermometer reading (reading field) and the instrument display (fields).",
          sourceAcceptance: "Record lists 25, 40, 50 and 60 °C; acceptance ±2.0 °C.",
          refs: [H], clause: "HPLC.pdf summary item 4; p.3", dataType: "multi-level", unit: "°C", readingsRequired: 1,
          levels: [level("C25", "25 °C", 25, "°C"), level("C40", "40 °C", 40, "°C"), level("C50", "50 °C", 50, "°C"), level("C60", "60 °C", 60, "°C")],
          fields: [fNum("disp_25", "Instrument display at 25 °C", "°C"), fNum("disp_40", "Instrument display at 40 °C", "°C"), fNum("disp_50", "Instrument display at 50 °C", "°C"), fNum("disp_60", "Instrument display at 60 °C", "°C"), fCert("thermometer_cert", "Reference thermometer ID / certificate")],
          calculations: [calc({ key: "dev", label: "Thermometer − set temperature", kind: "error", scope: "per-level", unit: "°C", decimals: 1 })],
          criteria: [crit("dev_lim", "dev", "Within ±2.0 °C of the set temperature (HPLC.pdf: '± 2.0 for set temperature and digital thermometer').", "abs<=", { tolerance: 2.0, unit: "°C", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf summary item 4; p.3" })],
        }),
        test({
          key: "T05", name: "T05 — System / injector precision", stage: "PQ",
          procedure: "HPLC.pdf p.4: caffeine standard 10 ppm (stock 50.0 mg / 50 mL, 1 mL → 100 mL); mobile phase water:methanol 750:250, column 25 cm × 4.6 mm C18, flow 1.5 mL/min, 272 nm, injection 20 µL, run time 12 min. Inject five replicates; record retention time (readings) and peak area (fields); calculate mean, SD and %RSD.",
          sourceAcceptance: "Record: retention-time %RSD NMT 1.0%; peak-area %RSD NMT 2.0%. Check the supplied USP <621> text for applicable chromatographic system-suitability requirements and do not conflate system suitability with instrument qualification.",
          refs: [H, "@USP621"], clause: "HPLC.pdf summary item 5; p.4", dataType: "series", unit: "min", readingsRequired: 5,
          fields: [...[1, 2, 3, 4, 5].map(i => fNum(`area_${i}`, `Peak area injection ${i}`, "counts")), fText("std_batch", "Caffeine standard batch / grade", true)],
          calculations: [
            calc({ key: "rt_mean", label: "Mean retention time", kind: "mean", unit: "min", decimals: 3 }),
            calc({ key: "rt_rsd", label: "Retention time %RSD", kind: "rsd", unit: "%", decimals: 3 }),
            calc({ key: "area_rsd", label: "Peak area %RSD", kind: "custom", formula: "rsd(area_1, area_2, area_3, area_4, area_5)", unit: "%", decimals: 3 }),
          ],
          criteria: [
            crit("rt_rsd_lim", "rt_rsd", "%RSD for retention time NMT 1.0 (HPLC.pdf).", "<=", { upper: 1.0, unit: "%", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf p.4" }),
            crit("area_rsd_lim", "area_rsd", "%RSD for area responses NMT 2.0 (HPLC.pdf).", "<=", { upper: 2.0, unit: "%", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf p.4" }),
          ],
        }),
        test({
          key: "T06", name: "T06 — Wavelength accuracy", stage: "OQ",
          procedure: "HPLC.pdf p.5: inject the 10 ppm standard and record the area response at 267–277 nm; determine the wavelength of maximum response.",
          sourceAcceptance: "Record specifies maximum absorbance at 272 ±2 nm. Confirm this test's applicability to the installed detector and applicable USP <621> provisions.",
          refs: [H, "@USP621"], clause: "HPLC.pdf summary item 6; p.5", dataType: "calculated",
          fields: [...[267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277].map(w => fNum(`a_${w}`, `Area response at ${w} nm`, "counts")), fNum("lambda_max", "Wavelength of maximum response (determined from the scan)", "nm")],
          criteria: [crit("lambda_lim", "lambda_max", "Maximum absorbance at 272 ± 2 nm (HPLC.pdf).", "target±tolerance", { target: 272, tolerance: 2, unit: "nm", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf p.5" })],
        }),
        test({
          key: "T07", name: "T07 — Detector linearity", stage: "OQ",
          procedure: "HPLC.pdf pp.5–6: caffeine standards 10, 20, 30, 40, 50 ppm (1–5 mL stock to 100 mL); record peak area; regression of response vs concentration.",
          sourceAcceptance: "Record: correlation coefficient not less than 0.99. Preserve actual concentration series from controlled method; incomplete preparation details require confirmation.",
          refs: [H], clause: "HPLC.pdf summary item 7; pp.5–6", dataType: "multi-level", unit: "counts", readingsRequired: 1,
          levels: [10, 20, 30, 40, 50].map(c => level(`P${c}`, `${c} ppm`, c, "ppm")),
          calculations: [calc({ key: "slope", label: "Slope", kind: "linearity-slope", decimals: 4 }), calc({ key: "intercept", label: "Intercept", kind: "linearity-intercept", decimals: 4 }), calc({ key: "r", label: "Correlation coefficient r", kind: "linearity-r", decimals: 5 })],
          criteria: [crit("r_min", "r", "Correlation coefficient should not be less than 0.99 (HPLC.pdf).", ">=", { lower: 0.99, sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf p.6" })],
        }),
        test({
          key: "T08", name: "T08 — Autosampler linearity", stage: "OQ",
          procedure: "HPLC.pdf p.6: for 100 µL injector capacity separately inject 5, 10, 20, 50, 80, 100 µL from different vials; plot peak area against injection volume.",
          sourceAcceptance: "Record: correlation coefficient not less than 0.99. Confirm exact volume series from the scanned record before execution.",
          refs: [H], clause: "HPLC.pdf summary item 8; p.6", dataType: "multi-level", unit: "counts", readingsRequired: 1,
          levels: [5, 10, 20, 50, 80, 100].map(v => level(`V${v}`, `${v} µL`, v, "µL")),
          calculations: [calc({ key: "slope", label: "Slope", kind: "linearity-slope", decimals: 4 }), calc({ key: "r", label: "Correlation coefficient r", kind: "linearity-r", decimals: 5 })],
          criteria: [crit("r_min", "r", "Correlation coefficient should not be less than 0.99 (HPLC.pdf).", ">=", { lower: 0.99, sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf p.6" })],
        }),
        test({
          key: "T09", name: "T09 — Carryover", stage: "OQ",
          procedure: "HPLC.pdf p.7: carryover solution (caffeine ~100 mg / 10 mL); inject carryover solution followed by blank (water). % carryover = area of caffeine in blank × 100 / area of caffeine in carryover solution.",
          sourceAcceptance: "Record: NMT 0.01%.",
          refs: [H], clause: "HPLC.pdf summary item 9; p.7", dataType: "calculated",
          fields: [fNum("blank_area", "Area of caffeine in blank", "counts"), fNum("carry_area", "Area of caffeine in carryover solution", "counts")],
          calculations: [calc({ key: "carryover", label: "% carryover", kind: "custom", formula: "blank_area * 100 / carry_area", unit: "%", decimals: 5 })],
          criteria: [crit("carry_lim", "carryover", "Carryover should not be more than 0.01 % (HPLC.pdf).", "<=", { upper: 0.01, unit: "%", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf p.7" })],
        }),
        (() => {
          const pairs = ["AB", "AC", "AD"];
          const fields = pairs.flatMap(p => [fNum(`h0_${p}`, `Pump A&${p[1]} — height at 0 %`, "counts"), fNum(`h100_${p}`, `Pump A&${p[1]} — height at 100 %`, "counts"), fNum(`h10_${p}`, `Pump A&${p[1]} — height at 10 %`, "counts"), fNum(`h50_${p}`, `Pump A&${p[1]} — height at 50 %`, "counts"), fNum(`h90_${p}`, `Pump A&${p[1]} — height at 90 %`, "counts")]);
          const calculations = pairs.flatMap(p => [10, 50, 90].map(s => calc({ key: `act${s}_${p}`, label: `Pump A&${p[1]} actual at ${s} %`, kind: "custom", formula: `(h${s}_${p} - h0_${p}) / (h100_${p} - h0_${p}) * 100`, unit: "%", decimals: 2 })));
          const criteria = pairs.flatMap(p => [10, 50, 90].map(s => crit(`act${s}_${p}_lim`, `act${s}_${p}`, `Setting value ± 2.0 % (HPLC.pdf p.9) — pump A&${p[1]} at ${s} %.`, "target±tolerance", { target: s, tolerance: 2.0, unit: "%", sourceClass: "external-calibration", ref: H, clause: "HPLC.pdf pp.7–9", conflict: "Protocol: 'units/definition must be verified from original form; do not silently interpret as absolute or relative percentage'. Imported as absolute percentage points from HPLC.pdf — interpretation PENDING (gap H3)." })));
          return test({
            key: "T10", name: "T10 — Gradient proportioning valve", stage: "OQ",
            procedure: "HPLC.pdf pp.7–9: wavelength 254 nm, flow 1.0 mL/min, pump A 100 % water, pumps B, C & D 0.3 % acetone. Verify each pump pair composition at 10 %, 50 % and 90 %. Actual concentration (%) = (height at x % − height at 0 %) / (height at 100 % − height at 0 %) × 100.",
            sourceAcceptance: "Record indicates acceptance ±2.0 (units/definition must be verified from original form); do not silently interpret as absolute or relative percentage.",
            refs: [H], clause: "HPLC.pdf summary item 10; pp.7–9", dataType: "calculated", fields, calculations, criteria,
          });
        })(),
      ],
    },
  ],
  gaps: [
    gap("H1", "Flow-rate setpoints conflict between sources", "HPLC.pdf summary p.1 lists 1.0 / 1.5 / 2.0 mL/min; HPLC.pdf data sheet p.2 prints 0.5 / 1.5 / 2.5 mL/min with handwritten corrections; CAL-QC-HPLC-001 T01 states 1.0 / 1.5 / 2.5 mL/min. A separate historical report for QC-I-104 (LC-40B XR) used 1.0 / 1.5 / 2.0 mL/min with Dev ≤ 3.0 % and RSD ≤ 2.0 % (different instrument, not adopted).", [
      { label: "HPLC.pdf summary (p.1)", displayValue: "1.0 / 1.5 / 2.0 mL/min, ±1.0 %", ref: H, clause: "Summary item 1", sourceClass: "external-calibration" },
      { label: "HPLC.pdf data sheet (p.2)", displayValue: "0.5 / 1.5 / 2.5 mL/min (handwritten corrections), ±1.0 %", ref: H, clause: "p.2 A–C", sourceClass: "external-calibration" },
      { label: "CAL-QC-HPLC-001 T01", displayValue: "1.0 / 1.5 / 2.5 mL/min, ±1.0 %", ref: "@PKG", clause: "§8 T01", sourceClass: "institutional" },
    ], "T01", "mL/min"),
    gap("H2", "HPLC equipment identity differs from the registered HPLC", "HPLC.pdf documents a Shimadzu LC 2030 PLUS (ID RLS/QC/HPLC/02). The registered system HPLC is QC-I-104, Shimadzu HPLC2 LC-40B XR pump / SPD-M40 detector. The protocol is model-associated with LC-2030 PLUS and is not linked to QC-I-104; formal execution on QC-I-104 requires a documented technical decision (and, if accepted, a model/equipment change in a draft revision).", [
      { label: "HPLC.pdf", displayValue: "Shimadzu LC 2030 PLUS — RLS/QC/HPLC/02", ref: H, clause: "Summary header", sourceClass: "external-calibration" },
      { label: "Equipment register", displayValue: "QC-I-104 — Shimadzu LC-40B XR / SPD-M40", ref: "@PKG", clause: "Equipment profile", sourceClass: "institutional" },
    ]),
    gap("H3", "Gradient proportioning acceptance units", "HPLC.pdf p.9 states 'Setting value ± 2.0 %'; the protocol requires the units/definition to be verified (absolute vs relative). Imported as absolute percentage points (target ± 2.0).", [
      { label: "HPLC.pdf p.9", displayValue: "Setting value ± 2.0 %", ref: H, clause: "p.9", sourceClass: "external-calibration" },
      { label: "CAL-QC-HPLC-001 T10", displayValue: "±2.0 — units/definition must be verified", ref: "@PKG", clause: "§8 T10", sourceClass: "institutional" },
    ], "T10", "%"),
    gap("H4", "'Flow Ramping (Flow slope)' mentioned without procedure", "HPLC.pdf p.9 carries the handwritten note 'Flow Ramping (Flow slope)' with no procedure, data or acceptance criterion. It is not imported as a test; a reviewer must decide whether a test is required.", [
      { label: "HPLC.pdf p.9", displayValue: "Handwritten note only — no criterion", ref: H, clause: "p.9", sourceClass: "external-calibration" },
    ]),
  ],
});

/* ------------------------------------------------------------------ */
/* 2. Polarimeter — CAL-QC-POL-001                                      */
/* ------------------------------------------------------------------ */

const POL = build({
  number: "CAL-QC-POL-001",
  title: "Calibration & Qualification Protocol — Polarimeter Qualification and Performance Verification",
  device: "Polarimeter",
  equipmentType: "Polarimeter",
  manufacturer: "Bellingham & Stanley (UK)",
  model: "ADP220",
  instrumentKey: "polarimeter",
  sourceRevision: "00",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-POL-001_Polarimeter_Protocol_Rev00_DRAFT.docx",
  references: [["@USP781", "Optical rotation requirements (temperature, accuracy, repeatability, linearity)"], ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"]],
  stages: ["IQ", "OQ", "PQ"],
  extraDescription: "Source restriction: the supplied USA USP package is the sole technical/pharmacopoeial reference. The system also contains POL-QC-032D (existing DRAFT for the same ADP220) — both are preserved; see gap P1.",
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Data Sheets",
      stage: "OQ",
      tests: [
        iqTest("T01", "Verify instrument identity, location, utilities, software/firmware, accessories, manuals, environmental conditions and installation records.", [["identity_ok", "Instrument identity (model / serial / equipment ID) matches"], ["utilities_ok", "Location and utilities verified"], ["accessories_ok", "Accessories and manuals present"], ["environment_ok", "Environmental conditions recorded and suitable"], ["install_records_ok", "Installation records available"]], ["@USP1058", "@USP781"]),
        test({
          key: "T02", name: "T02 — Temperature control", stage: "OQ",
          procedure: "Verify sample temperature indication resolution/reporting and control using a traceable temperature device. USP text: report temperature to at least ±0.1 °C or better; maintain operating temperature within ±0.5 °C of traceable reference.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP781"], dataType: "calculated",
          fields: [fNum("setpoint", "Operating temperature setpoint", "°C"), fNum("indicated", "Instrument indicated temperature", "°C"), fNum("reference", "Traceable reference temperature", "°C"), fNum("resolution", "Temperature reporting resolution", "°C"), fCert("ref_device", "Traceable temperature device ID / certificate")],
          calculations: [calc({ key: "diff", label: "Indicated − reference", kind: "custom", formula: "indicated - reference", unit: "°C", decimals: 2 })],
          criteria: [
            crit("diff_lim", "diff", "Maintain operating temperature within ±0.5 °C of the traceable reference (USP <781> as quoted in the protocol).", "abs<=", { tolerance: 0.5, unit: "°C", ref: "@USP781" }),
            crit("res_lim", "resolution", "Report temperature to at least ±0.1 °C or better (USP <781> as quoted in the protocol).", "<=", { upper: 0.1, unit: "°C", ref: "@USP781" }),
          ],
        }),
        test({
          key: "T03", name: "T03 — Wavelength / bandwidth", stage: "OQ",
          procedure: "Record operating wavelength(s), light source, filter/bandwidth characteristics and confirm suitability for intended measurement. USP recommends recording wavelength and bandwidth for continuum sources.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP781"], dataType: "calculated",
          fields: [fNum("wavelength", "Operating wavelength", "nm"), fText("light_source", "Light source", true), fText("bandwidth", "Filter / bandwidth characteristics", true), fBool("suitable", "Suitable for the intended measurement")],
          criteria: [notSpecified("wl_record", "Wavelength / bandwidth acceptance limit", "@USP781")],
        }),
        test({
          key: "T04", name: "T04 — Optical rotation accuracy", stage: "OQ",
          procedure: "Measure certified optical-rotation reference material at operating wavelength(s). USP: instrument reporting capability ±0.01° or better; CRM certified to ±0.01° or better. Result must agree with certified value within expanded uncertainty of CRM plus manufacturer instrument accuracy specification.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP781"], dataType: "reference-comparison", unit: "°", readingsRequired: 1,
          fields: [fNum("crm_u", "CRM expanded uncertainty (from certificate)", "°"), fNum("acc_spec", "Manufacturer instrument accuracy specification", "°"), fNum("reporting", "Instrument reporting capability", "°"), fCert("crm_cert", "CRM ID / certificate / due date")],
          calculations: [calc({ key: "abs_err", label: "|measured − certified|", kind: "abs-error", unit: "°" }), calc({ key: "allowed", label: "CRM U + instrument accuracy spec", kind: "custom", formula: "crm_u + acc_spec", unit: "°" }), calc({ key: "margin", label: "Allowed − |error|", kind: "custom", formula: "allowed - abs_err", unit: "°", decimals: 4 })],
          criteria: [
            crit("agree", "margin", "Result agrees with the certified value within the CRM expanded uncertainty plus the manufacturer instrument accuracy specification (margin ≥ 0).", ">=", { lower: 0, unit: "°", ref: "@USP781", conflict: "System protocol POL-QC-032D documents a ±0.02° (manufacturer manual) vs ±0.01° (USP) accuracy gap for the same ADP220 — see gap P1." }),
            crit("reporting_lim", "reporting", "Instrument reporting capability ±0.01° or better.", "<=", { upper: 0.01, unit: "°", ref: "@USP781" }),
          ],
        }),
        test({
          key: "T05", name: "T05 — Repeatability", stage: "PQ",
          procedure: "Perform at least five replicate measurements of a reference material at operating wavelength; calculate %RSD. Acceptance: not greater than manufacturer's stated repeatability specification.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP781"], dataType: "series", unit: "°", readingsRequired: 5,
          fields: [fNum("mfr_rep", "Manufacturer stated repeatability specification (same basis as %RSD)", "%")],
          calculations: [calc({ key: "mean", label: "Mean", kind: "mean", unit: "°", decimals: 4 }), calc({ key: "sd", label: "SD", kind: "sd", unit: "°", decimals: 5 }), calc({ key: "rsd", label: "%RSD", kind: "rsd", unit: "%" }), calc({ key: "rep_margin", label: "Spec − %RSD", kind: "custom", formula: "mfr_rep - rsd", unit: "%", decimals: 4 })],
          criteria: [crit("rep_lim", "rep_margin", "%RSD not greater than the manufacturer's stated repeatability specification (margin ≥ 0).", ">=", { lower: 0, unit: "%", ref: "@USP781", conflict: "The basis/unit of the manufacturer repeatability specification (degrees vs %RSD) must be confirmed at technical review." })],
        }),
        test({
          key: "T06", name: "T06 — Linearity", stage: "PQ",
          procedure: "Required when used for quantitative enantiomer measurement. Verify at three or more values across operational range; each value meets accuracy criteria. If not used quantitatively, mark NOT APPLICABLE with justification (reviewer confirmation required).",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP781"], dataType: "multi-level", unit: "°", readingsRequired: 1,
          levels: [level("L1", "Value 1 (low)", null, "°", "Certified value from the CRM certificate"), level("L2", "Value 2 (mid)", null, "°", "Certified value from the CRM certificate"), level("L3", "Value 3 (high)", null, "°", "Certified value from the CRM certificate")],
          fields: [fNum("crm_u", "CRM expanded uncertainty", "°"), fNum("acc_spec", "Manufacturer instrument accuracy specification", "°")],
          calculations: [calc({ key: "lvl_margin", label: "Allowed − |error| per value", kind: "custom", formula: "crm_u + acc_spec - abs(mean - reference)", scope: "per-level", unit: "°", decimals: 4 })],
          criteria: [crit("each_acc", "lvl_margin", "Each value meets the accuracy criterion (margin ≥ 0 at every level).", ">=", { lower: 0, unit: "°", ref: "@USP781" })],
        }),
      ],
    },
  ],
  gaps: [
    gap("P1", "Two polarimeter protocols for the same ADP220", "The system already holds POL-QC-032D (DRAFT, documents a ±0.02° manual vs ±0.01° USP accuracy gap). The package adds CAL-QC-POL-001. Neither overwrites the other; QA must designate the controlling protocol (and supersede/retire the other through the revision workflow).", [
      { label: "POL-QC-032D (system)", displayValue: "Existing DRAFT — ±0.02° manual vs ±0.01° USP gap", ref: "@USP781", clause: "Accuracy" },
      { label: "CAL-QC-POL-001 (package)", displayValue: "Imported DRAFT — CRM U + instrument spec", ref: "@PKG", clause: "§8 T04", sourceClass: "institutional" },
    ], "T04", "°"),
  ],
});

/* ------------------------------------------------------------------ */
/* 3. Analytical balance — CAL-QC-BAL-001 Rev.01 (QA pending)          */
/* ------------------------------------------------------------------ */

const BAL = build({
  number: "CAL-QC-BAL-001",
  title: "Calibration & Qualification Protocol — Analytical Balance Sartorius ED224S",
  device: "analytical balance",
  equipmentType: "Analytical Balance",
  manufacturer: "Sartorius (Germany)",
  model: "ED224S",
  instrumentKey: "balance",
  sourceRevision: "01",
  sourceStatus: "INITIAL QUALIFICATION ISSUE – TECHNICAL REVIEW COMPLETED (source) / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-BAL-001_Analytical_Balance_Protocol_Rev01_DRAFT_QA_PENDING.docx",
  references: [["@USP41", "Mandatory repeatability and accuracy requirements; minimum weight relationship"], ["@USP1251", "Installation, OQ, PQ guidance; sensitivity, linearity, eccentricity, minimum weight"], ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"], ["@SARTORIUS", "Instrument-specific characteristics (capacity, readability, repeatability, linearity, operating conditions)"]],
  stages: ["IQ", "OQ", "PQ"],
  extraDescription: "Source revision history: Rev.00 20-Nov-2026 initial generic draft (superseded); Rev.01 20-Nov-2026 identity populated, USP <41>/<1251> criteria clarified — QA approval pending. Technical review recorded in the source must be repeated/recorded in this system. The historical QC-I-074 record (6 repeatability readings, ±0.0004 g limit) is background only — USP <41> requires NLT 10 weighings (gap B1).",
  narrative: {
    purpose: "To define and document the installation, operational and performance qualification activities required to demonstrate that the identified analytical balance is suitable for its intended pharmaceutical laboratory use.",
    scope: "This protocol applies to Analytical Balance QC-I-074, Sartorius model ED224S, serial number 23304057. It covers IQ, OQ and risk-based PQ tests, including the compendial requirements of USP General Chapter <41> for balances used to weigh materials that must be accurately weighed. It does not replace product-specific analytical methods, approved site SOPs or any applicable monograph.",
    equipmentDescription: "Sartorius (Germany) ED224S, serial 23304057, equipment ID QC-I-074, site SOP QC-105D. Weighing capacity 220 g; readability d = 0.0001 g; manufacturer repeatability ≤ 0.0001 g; linearity ≤ 0.0002 g; typical response ≤ 2.5 s; pan 90 mm; operating +10 to +30 °C; external calibration weight 200 g class E2 (verify). Model specifications, not measured results.",
    requiredReferenceStandards: "Accuracy weights 5–100 % of capacity (11–220 g) with MPE or calibration uncertainty ≤ one-third of the applied test limit; sensitivity/linearity weights certified; repeatability/eccentricity weight need not be certified but must be mass-stable. Record certificate ID, calibration date, due date, uncertainty and coverage factor.",
    finalAssessment: "The instrument may be released only when all applicable tests pass, deviations are resolved or formally assessed, records are complete, the intended minimum net sample weight is defined and QA approval is documented. A missing criterion is not automatically a pass. This protocol itself does not establish that the instrument has passed or is released.",
  },
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Execution Data Sheets",
      stage: "OQ",
      tests: [
        test({
          key: "T01", name: "T01 — Installation Qualification (IQ)", stage: "IQ",
          procedure: "Verify nameplate identity, model, serial, equipment ID, accessories, manuals, installation records, support surface, leveling, power supply, location and environmental suitability. Document any deviations and photographs where permitted.",
          sourceAcceptance: "All identity fields match this protocol; installation and environment meet manufacturer instructions and approved site requirements. Any unmet requirement is documented and assessed.",
          refs: ["@USP1251", "@USP1058"], clause: "USP <1251> PDF p.1", dataType: "checklist",
          fields: [fBool("identity_ok", "Nameplate identity matches (ED224S / 23304057 / QC-I-074)"), fBool("docs_ok", "Accessories, manuals and installation records present"), fBool("surface_ok", "Solid, level, nonmagnetic, low-vibration support surface; leveled"), fBool("power_ok", "Power supply verified"), fBool("environment_ok", "Location and environment suitable (drafts, sunlight, temperature/humidity, EM fields assessed)"), fText("software_version", "Software / firmware (if applicable)"), fText("location", "Location / room ID", true)],
          criteria: ["identity_ok", "docs_ok", "surface_ok", "power_ok", "environment_ok"].map(k => passFail(k, "Verified per CAL-QC-BAL-001 Rev.01 T01 acceptance (identity matches; installation and environment meet manufacturer instructions and site requirements).", "@USP1251", "PDF p.1")),
        }),
        test({
          key: "T02", name: "T02 — Operational Qualification (OQ)", stage: "OQ",
          procedure: "Power on and equilibrate per manufacturer instructions. Verify mechanical mobility, stable indication, internal/manual adjustment function (as fitted), ancillary equipment, tare function and initial calibration at the normal use location.",
          sourceAcceptance: "Functions operate as specified by the manufacturer and approved site requirements. Record observed results; no generic numeric USP limit is assigned to these functional checks.",
          refs: ["@USP1251"], clause: "USP <1251> PDF pp.1–2", dataType: "checklist",
          fields: [fBool("equilibrated", "Equilibrated per manufacturer instructions"), fBool("mobility_ok", "Mechanical mobility / stable indication"), fBool("adjust_ok", "Internal / manual adjustment function (as fitted)"), fBool("tare_ok", "Tare function"), fBool("initial_cal_ok", "Initial calibration at the normal use location"), fText("oq_notes", "Observed results")],
          criteria: ["equilibrated", "mobility_ok", "adjust_ok", "tare_ok", "initial_cal_ok"].map(k => passFail(k, "Function operates as specified by the manufacturer (functional check — no numeric USP limit).", "@USP1251", "PDF pp.1–2")),
        }),
        (() => {
          const pts = [1, 2, 3];
          return test({
            key: "T03", name: "T03 — Accuracy (USP <41>)", stage: "OQ",
            procedure: "Use suitable calibrated weight(s) between 5% and 100% of capacity (11 g–220 g). Record certified/reference value and indicated value. Error (%) = [(Indicated − Reference) / Reference] × 100. Include the 200 g point if suitable; do not rely on a single point unless justified by the approved procedure.",
            sourceAcceptance: "Absolute relative error ≤ 0.10% at each tested point. Weight MPE or calibration uncertainty ≤ one-third of the applied accuracy test limit. This is a USP <41> requirement.",
            refs: ["@USP41"], clause: "USP <41> PDF p.1", dataType: "calculated",
            fields: pts.flatMap(i => [fCert(`w${i}_cert`, `Point ${i} — weight ID / certificate`), fNum(`ref_${i}`, `Point ${i} — reference (certified) value`, "g"), fNum(`ind_${i}`, `Point ${i} — indicated value`, "g"), fNum(`u_${i}`, `Point ${i} — weight MPE or calibration uncertainty`, "g")]),
            calculations: pts.flatMap(i => [
              calc({ key: `err_${i}`, label: `Error point ${i}`, kind: "custom", formula: `(ind_${i} - ref_${i}) / ref_${i} * 100`, unit: "%", decimals: 4 }),
              calc({ key: `umargin_${i}`, label: `One-third of limit − u (point ${i})`, kind: "custom", formula: `ref_${i} * 0.10 / 100 / 3 - u_${i}`, unit: "g", decimals: 6 }),
            ]),
            criteria: pts.flatMap(i => [
              crit(`err_${i}_lim`, `err_${i}`, "Absolute relative error ≤ 0.10 % (USP <41>).", "abs<=", { tolerance: 0.1, unit: "%", ref: "@USP41", clause: "PDF p.1" }),
              crit(`u_${i}_lim`, `umargin_${i}`, "Weight MPE / uncertainty ≤ one-third of the applied test limit (USP <41>).", ">=", { lower: 0, unit: "g", ref: "@USP41", clause: "PDF p.1" }),
              crit(`range_${i}`, `ref_${i}`, "Test weight between 5 % and 100 % of the 220 g capacity (11–220 g).", "between", { lower: 11, upper: 220, unit: "g", ref: "@USP41", clause: "PDF p.1" }),
            ]),
          });
        })(),
        test({
          key: "T04", name: "T04 — Repeatability (USP <41>)", stage: "OQ",
          procedure: "Perform NLT 10 weighings of one test weight within the balance operating range under the same conditions. Record all individual readings. Calculate sample standard deviation s. Scale interval d = 0.0001 g; s_eff = max(s, 0.41d) = max(s, 0.000041 g).",
          sourceAcceptance: "For the intended smallest net weight m: (2 × s_eff / m) × 100 ≤ 0.10%. The repeatability test weight need not be calibrated under USP <41>, but its mass must remain stable. This is a USP <41> requirement.",
          refs: ["@USP41"], clause: "USP <41> PDF p.1", dataType: "series", unit: "g", readingsRequired: 10,
          fields: [fNum("m", "Intended smallest net sample mass m (QC owner input)", "g")],
          calculations: [calc({ key: "s", label: "Sample SD s (n−1)", kind: "sd", unit: "g" }), calc({ key: "s_eff", label: "s_eff = max(s, 0.41d), d = 0.0001 g", kind: "custom", formula: "max(s, 0.000041)", unit: "g", formulaRevision: "BAL-Rev01 d=0.0001 g" }), calc({ key: "rep", label: "2·s_eff/m × 100", kind: "custom", formula: "2 * s_eff / m * 100", unit: "%", decimals: 4 })],
          criteria: [crit("rep_lim", "rep", "(2 × s_eff / m) × 100 ≤ 0.10 % with NLT 10 weighings (USP <41>).", "<=", { upper: 0.1, unit: "%", ref: "@USP41", clause: "PDF p.1", conflict: "Historical QC-I-074 record has 6 readings only — cannot substantiate this test (gap B1)." })],
          notes: "Ten readings are mandatory (USP <41> NLT 10). The intended smallest net mass m must be defined by the QC owner — no value is assumed.",
        }),
        test({
          key: "T05", name: "T05 — Minimum weight (USP <41>/<1251>)", stage: "OQ",
          procedure: "Calculate Mmin = 2000 × s_eff for materials that must be accurately weighed. Record the QC owner's intended smallest net sample mass and compare it with Mmin. The minimum weight applies to net sample mass, not tare or gross mass. Enter s from T04.",
          sourceAcceptance: "The intended smallest net sample mass must be ≥ Mmin. If s is below 0.41d, use 0.41d. For this balance the rounding floor is 0.000041 g and the corresponding floor-based Mmin is 0.082 g; this is a calculated lower-bound example only and is not the actual approved minimum weight unless supported by the measured repeatability result.",
          refs: ["@USP41", "@USP1251"], clause: "USP <41> PDF p.1; <1251> PDF p.3", dataType: "calculated", dependsOn: "T04",
          fields: [fNum("s", "Measured repeatability s (from T04)", "g"), fNum("m", "Intended smallest net sample mass", "g")],
          calculations: [calc({ key: "s_eff", label: "s_eff = max(s, 0.000041)", kind: "custom", formula: "max(s, 0.000041)", unit: "g" }), calc({ key: "mmin", label: "Mmin = 2000 × s_eff", kind: "custom", formula: "2000 * s_eff", unit: "g" }), calc({ key: "mw_margin", label: "m − Mmin", kind: "custom", formula: "m - mmin", unit: "g", decimals: 4 })],
          criteria: [crit("mw_lim", "mw_margin", "Intended smallest net sample mass ≥ Mmin (USP <41>).", ">=", { lower: 0, unit: "g", ref: "@USP41", clause: "PDF p.1" })],
        }),
        test({
          key: "T06", name: "T06 — Sensitivity (USP <1251> risk-based PQ)", stage: "PQ",
          procedure: "Use a certified test load at or sufficiently close to the balance capacity. Sensitivity ratio = change in displayed value / applied load; express deviation from 1 as a percentage. Record the weight certificate and uncertainty/MPE.",
          sourceAcceptance: "Where USP <41> applies and this test is selected to assess systematic deviation, NMT 0.05% deviation from 1. For other uses, use the approved weighing tolerance divided by 2. This is a suggested PQ test under <1251>, not a standalone mandatory <41> test.",
          refs: ["@USP1251"], clause: "USP <1251> PDF p.2", dataType: "calculated",
          fields: [fNum("ref_load", "Reference load", "g"), fNum("ind_change", "Indicated change", "g"), fCert("load_cert", "Test load certificate / uncertainty")],
          calculations: [calc({ key: "ratio", label: "Sensitivity ratio", kind: "custom", formula: "ind_change / ref_load" }), calc({ key: "sens_dev", label: "|ratio − 1| × 100", kind: "custom", formula: "abs(ratio - 1) * 100", unit: "%", decimals: 4 })],
          criteria: [crit("sens_lim", "sens_dev", "NMT 0.05 % deviation from 1 where USP <41> applies (otherwise approved tolerance / 2).", "<=", { upper: 0.05, unit: "%", ref: "@USP1251", clause: "PDF p.2" })],
        }),
        test({
          key: "T07", name: "T07 — Linearity (USP <1251> risk-based PQ)", stage: "PQ",
          procedure: "Assess 3–6 points across the balance range (6 configured, per the data sheet). Record reference and indicated values and calculate deviation from the reference values. Certified weights are required for the direct method.",
          sourceAcceptance: "Where USP <41> applies and this test is selected, NMT 0.05% deviation. For other uses, approved weighing tolerance divided by 2. This is a suggested PQ test under <1251>.",
          refs: ["@USP1251"], clause: "USP <1251> PDF p.2", dataType: "multi-level", unit: "g", readingsRequired: 1,
          levels: [1, 2, 3, 4, 5, 6].map(i => level(`P${i}`, `Point ${i}`, null, "g", "Certified reference value from the weight certificate")),
          calculations: [calc({ key: "lin_dev", label: "Deviation from reference", kind: "pct-error", scope: "per-level", unit: "%", decimals: 4 })],
          criteria: [crit("lin_lim", "lin_dev", "NMT 0.05 % deviation where USP <41> applies (otherwise approved tolerance / 2).", "abs<=", { tolerance: 0.05, unit: "%", ref: "@USP1251", clause: "PDF p.2" })],
          notes: "Source allows 3–6 points; the data sheet has 6 rows. If fewer points are justified, edit the levels in the draft before technical review.",
        }),
        test({
          key: "T08", name: "T08 — Eccentricity (USP <1251> risk-based PQ)", stage: "PQ",
          procedure: "Place the test load at the center and four quadrants. Test load usually should be 30% of capacity or higher (66 g for 220 g), subject to the manufacturer's upper limit. Record each position and the center reading.",
          sourceAcceptance: "Where USP <41> applies and this test is selected, NMT 0.05% deviation between off-center and center readings. For other uses, approved weighing tolerance divided by 2. Confirm load limit in the manufacturer manual.",
          refs: ["@USP1251"], clause: "USP <1251> PDF p.2", dataType: "calculated",
          fields: [fNum("load", "Test load", "g"), fNum("center", "Center reading", "g"), ...[1, 2, 3, 4].map(i => fNum(`q${i}`, `Quadrant ${i} reading`, "g"))],
          calculations: [1, 2, 3, 4].map(i => calc({ key: `ecc_${i}`, label: `Quadrant ${i} deviation from center`, kind: "custom", formula: `abs(q${i} - center) / center * 100`, unit: "%", decimals: 4 })),
          criteria: [1, 2, 3, 4].map(i => crit(`ecc_${i}_lim`, `ecc_${i}`, "NMT 0.05 % deviation between off-center and center readings (where USP <41> applies).", "<=", { upper: 0.05, unit: "%", ref: "@USP1251", clause: "PDF p.2" })),
        }),
      ],
    },
  ],
  gaps: [
    gap("B1", "Historical balance record cannot substantiate USP <41> repeatability", "The supplied historical QC-I-074 record contains six repeatability readings and a ±0.0004 g deviation limit. USP <41> requires NLT 10 weighings; the ±0.0004 g limit is not substituted for the 0.10 % accuracy criterion or the <1251> criteria. Re-execution under this protocol is required.", [
      { label: "USP <41>", displayValue: "NLT 10 weighings; 2s_eff/m ≤ 0.10 %", ref: "@USP41", clause: "PDF p.1" },
      { label: "Historical record QC-I-074", displayValue: "6 readings; ±0.0004 g", ref: "@PKG", clause: "Rev.01 §11", sourceClass: "institutional" },
    ], "T04", "g"),
    gap("B2", "Intended smallest net sample weight not defined", "The QC owner must define the intended smallest net sample weight before the <41> repeatability and minimum-weight decisions (Rev.01 §6, §15). No value was invented.", [
      { label: "CAL-QC-BAL-001 Rev.01", displayValue: "Required QC-owner input", ref: "@PKG", clause: "§6, §15", sourceClass: "institutional" },
    ], "T05", "g"),
  ],
});

/* ------------------------------------------------------------------ */
/* 4. Moisture analyzer — CAL-QC-MOA-001                                */
/* ------------------------------------------------------------------ */

const MOA = build({
  number: "CAL-QC-MOA-001",
  title: "Calibration & Qualification Protocol — Moisture Analyzer Qualification (Loss on Drying)",
  device: "Moisture Analyzer",
  equipmentType: "Moisture Analyzer",
  manufacturer: "Sartorius (Germany)",
  model: "MA30",
  instrumentKey: "moisture",
  sourceRevision: "00",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-MOA-001_Moisture Analyzer_Protocol_Rev00_DRAFT.docx",
  references: [["@USP731", "Loss on drying (monograph-driven procedure)"], ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"]],
  stages: ["IQ", "OQ", "PQ"],
  extraDescription: "USP <921> Water Determination is a distinct method family and is NOT substituted for loss on drying (<731>).",
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Data Sheets",
      stage: "OQ",
      tests: [
        iqTest("T01", "Verify equipment identity, installation, power, location, ventilation/exhaust, accessories, software/firmware and documentation.", [["identity_ok", "Equipment identity matches"], ["power_ok", "Installation and power verified"], ["ventilation_ok", "Location, ventilation / exhaust suitable"], ["accessories_ok", "Accessories and documentation present"]], ["@USP1058", "@USP731"]),
        test({
          key: "T02", name: "T02 — OQ – temperature", stage: "OQ",
          procedure: "Verify heating/temperature indication and control using a suitable traceable reference over the intended operating range. The supplied <731> extract does not provide a universal temperature accuracy limit.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP731"], dataType: "multi-level", unit: "°C", readingsRequired: 1,
          levels: [level("T1", "Setpoint 1", null, "°C", "Enter the setpoint as reference value"), level("T2", "Setpoint 2", null, "°C", "Enter the setpoint as reference value")],
          fields: [fCert("ref_device", "Traceable temperature reference ID / certificate")],
          calculations: [calc({ key: "dev", label: "Reference reading − setpoint", kind: "error", scope: "per-level", unit: "°C", decimals: 1 })],
          criteria: [notSpecified("temp_lim", "Temperature accuracy limit (supplied <731> extract has no universal limit)", "@USP731")],
          notes: placeholderCount(2, "Temperature setpoints"),
        }),
        test({
          key: "T03", name: "T03 — OQ – weighing function", stage: "OQ",
          procedure: "Verify balance indication using traceable weights appropriate to the instrument range. The supplied <731> extract does not define universal balance tolerances.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP731"], dataType: "multi-level", unit: "g", readingsRequired: 1,
          levels: [level("W1", "Weight 1", null, "g", "Certified value"), level("W2", "Weight 2", null, "g", "Certified value"), level("W3", "Weight 3", null, "g", "Certified value")],
          fields: [fCert("weights_cert", "Weight set ID / certificate")],
          calculations: [calc({ key: "dev", label: "Indicated − certified", kind: "error", scope: "per-level", unit: "g", decimals: 4 })],
          criteria: [notSpecified("weigh_lim", "Weighing tolerance (supplied <731> extract defines none)", "@USP731")],
          notes: placeholderCount(3, "Test weights"),
        }),
        test({
          key: "T04", name: "T04 — Drying procedure verification", stage: "PQ",
          procedure: "Execute the applicable monograph's loss-on-drying procedure: sample quantity, preparation, apparatus, temperature, pressure, drying time/endpoint and cooling/desiccation must follow the monograph. Do not generalize a single temperature/time across products.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP731"], dataType: "documentary",
          fields: [fText("monograph", "Monograph / method reference", true), fNum("sample_qty", "Sample quantity", "g"), fNum("drying_temp", "Drying temperature", "°C"), fText("endpoint", "Drying time / endpoint criterion", true), fText("conditions", "Pressure / cooling / desiccation as applicable")],
          criteria: [notSpecified("proc_lim", "Monograph-specific procedure compliance", "@USP731")],
        }),
        test({
          key: "T05", name: "T05 — Performance / repeatability", stage: "PQ",
          procedure: "Perform replicate determinations using a suitable control/reference material and evaluate against approved method precision or monograph criteria. The supplied <731> extract does not prescribe a universal replicate count or general acceptance limit.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP731"], dataType: "series", unit: "%", readingsRequired: 3,
          fields: [fText("control_material", "Control / reference material", true)],
          calculations: [calc({ key: "mean", label: "Mean LOD", kind: "mean", unit: "%", decimals: 3 }), calc({ key: "sd", label: "SD", kind: "sd", unit: "%", decimals: 4 }), calc({ key: "rsd", label: "%RSD", kind: "rsd", unit: "%", decimals: 3 })],
          criteria: [notSpecified("rep_lim", "Method precision / monograph criterion", "@USP731")],
          notes: placeholderCount(3, "Replicate determinations"),
        }),
        test({
          key: "T06", name: "T06 — Calculation and result", stage: "PQ",
          procedure: "Calculate loss on drying from initial and final mass using the monograph-defined basis; record raw masses, conditions, endpoint, calculation and units.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP731"], dataType: "calculated",
          fields: [fNum("m_initial", "Initial sample mass", "g"), fNum("m_final", "Final mass after drying", "g"), fText("basis", "Monograph-defined basis", true)],
          calculations: [calc({ key: "lod", label: "Loss on drying = (initial − final) / initial × 100", kind: "custom", formula: "(m_initial - m_final) / m_initial * 100", unit: "%", decimals: 3 })],
          criteria: [notSpecified("lod_lim", "Monograph LOD limit (product-specific)", "@USP731")],
        }),
      ],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* 5. Dissolution tester — CAL-QC-DIS-001                               */
/* ------------------------------------------------------------------ */

const DIS = build({
  number: "CAL-QC-DIS-001",
  title: "Calibration & Qualification Protocol — Dissolution Apparatus Qualification and Performance Verification",
  device: "Dissolution Tester",
  equipmentType: "Dissolution Tester",
  manufacturer: "Erweka (Germany)",
  model: "DT70",
  instrumentKey: "dissolution",
  sourceRevision: "00",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-DIS-001_Dissolution Tester_Protocol_Rev00_DRAFT.docx",
  references: [["@USP711", "Dissolution apparatus, mechanical requirements and performance verification"], ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"]],
  stages: ["IQ", "OQ", "PQ"],
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Data Sheets",
      stage: "OQ",
      tests: [
        iqTest("T01", "Verify apparatus type/configuration, vessel/basket/paddle identification, installation, level, drive, utilities, manuals, accessories and environmental conditions.", [["config_ok", "Apparatus type / configuration identified"], ["parts_ok", "Vessels, baskets and paddles identified"], ["level_ok", "Installation and level verified"], ["drive_ok", "Drive and utilities verified"], ["docs_ok", "Manuals and accessories present"]], ["@USP1058", "@USP711"]),
        test({
          key: "T02", name: "T02 — OQ – mechanical checks", stage: "OQ",
          procedure: "Verify vessel dimensions/condition and centering, shaft verticality, paddle/basket geometry and condition, rotation speed indication, temperature system, sampling system and timer using procedures and tolerances stated in the supplied <711> text.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP711"], dataType: "checklist",
          fields: [fBool("vessels_ok", "Vessel dimensions / condition and centering checked"), fBool("vertical_ok", "Shaft verticality checked"), fBool("geometry_ok", "Paddle / basket geometry and condition checked"), fBool("indication_ok", "Rotation speed indication, temperature system, sampling system and timer checked"), fText("measured_values", "Measured values and tolerances applied (per <711>)", true)],
          criteria: [notSpecified("mech_lim", "Mechanical tolerances (to be taken from the applicable <711> apparatus section)", "@USP711")],
        }),
        test({
          key: "T03", name: "T03 — Rotation speed", stage: "OQ",
          procedure: "Measure/verify rotation speed at applicable operating setpoints using a suitable calibrated tachometer or equivalent. Record raw readings and USP-specified limits from the applicable apparatus section.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP711"], dataType: "multi-level", unit: "rpm", readingsRequired: 1,
          levels: [level("S1", "Setpoint 1", null, "rpm", "Enter the setpoint as reference"), level("S2", "Setpoint 2", null, "rpm", "Enter the setpoint as reference"), level("S3", "Setpoint 3", null, "rpm", "Enter the setpoint as reference")],
          fields: [fCert("tacho_cert", "Tachometer ID / certificate")],
          calculations: [calc({ key: "dev", label: "Measured − set", kind: "error", scope: "per-level", unit: "rpm", decimals: 1 }), calc({ key: "pct", label: "% deviation", kind: "pct-error", scope: "per-level", unit: "%", decimals: 2 })],
          criteria: [notSpecified("speed_lim", "Rotation speed limit (applicable <711> apparatus section)", "@USP711")],
          notes: placeholderCount(3, "Speed setpoints"),
        }),
        test({
          key: "T04", name: "T04 — Temperature", stage: "OQ",
          procedure: "Verify dissolution medium temperature at the specified measurement locations and operating conditions against the <711> requirements; record stabilized readings (one per vessel position).",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP711"], dataType: "series", unit: "°C", readingsRequired: 6,
          fields: [fCert("thermo_cert", "Thermometer ID / certificate")],
          calculations: [calc({ key: "mean", label: "Mean", kind: "mean", unit: "°C", decimals: 2 }), calc({ key: "min", label: "Minimum", kind: "min", unit: "°C" }), calc({ key: "max", label: "Maximum", kind: "max", unit: "°C" })],
          criteria: [notSpecified("temp_lim", "Medium temperature requirement (<711>)", "@USP711")],
          notes: placeholderCount(6, "Vessel positions (DT70 historical record shows 6 vessels)"),
        }),
        test({
          key: "T05", name: "T05 — Sampling / timing", stage: "OQ",
          procedure: "Verify sampling position/depth, sampling cannula, timing accuracy, automation and volume replacement where applicable against <711> apparatus/procedure requirements.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP711"], dataType: "calculated",
          fields: [fBool("position_ok", "Sampling position / depth and cannula verified"), fNum("timer_set", "Timer set", "s"), fNum("timer_measured", "Timer measured (traceable)", "s"), fText("automation", "Automation / volume replacement (where applicable)")],
          calculations: [calc({ key: "timer_dev", label: "Measured − set", kind: "custom", formula: "timer_measured - timer_set", unit: "s", decimals: 1 })],
          criteria: [notSpecified("timing_lim", "Sampling / timing requirement (<711>)", "@USP711")],
        }),
        test({
          key: "T06", name: "T06 — Performance verification (PVT)", stage: "PQ",
          procedure: "Perform applicable USP Apparatus Performance Verification Test (PVT) using the current USP reference standard, lot-specific certificate, prescribed apparatus, medium, operating conditions, and acceptance calculations. Do not substitute mechanical checks for PVT.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP711"], dataType: "documentary",
          fields: [fText("rs_lot", "USP reference standard and lot", true), fCert("rs_cert", "Lot-specific certificate"), fText("apparatus_medium", "Apparatus, medium and operating conditions", true), fText("pvt_results", "PVT results and acceptance calculation (lot-specific)", true)],
          criteria: [notSpecified("pvt_lim", "PVT acceptance (lot-specific certificate)", "@USP711")],
        }),
        test({
          key: "T07", name: "T07 — Data evaluation", stage: "PQ",
          procedure: "Apply dosage-form/monograph Q value and staged acceptance table only for the specific product method; do not create a universal dissolution limit. If not product-specific, mark NOT APPLICABLE with justification.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP711"], dataType: "documentary",
          fields: [fText("product_method", "Product / method and Q value", true), fText("stage_result", "Staged acceptance evaluation", true)],
          criteria: [notSpecified("q_lim", "Monograph Q / staged acceptance (product-specific)", "@USP711")],
        }),
      ],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* 6. Disintegration tester — CAL-QC-DISINT-001                         */
/* ------------------------------------------------------------------ */

const DISINT = build({
  number: "CAL-QC-DISINT-001",
  title: "Calibration & Qualification Protocol — Disintegration Apparatus Qualification and Performance Verification",
  device: "Disintegration Tester",
  equipmentType: "Disintegration Tester",
  manufacturer: "Erweka (Germany)",
  model: "ZT51",
  instrumentKey: "disintegration",
  sourceRevision: "00",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-DISINT-001_Disintegration Tester_Protocol_Rev00_DRAFT.docx",
  references: [["@USP701", "Disintegration apparatus and procedure requirements"], ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"]],
  stages: ["IQ", "OQ", "PQ"],
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Data Sheets",
      stage: "OQ",
      tests: [
        iqTest("T01", "Verify apparatus identity, basket-rack assembly, tubes, disks, beakers, temperature control, drive mechanism, timer, installation and documentation.", [["identity_ok", "Apparatus identity matches"], ["assembly_ok", "Basket-rack assembly, tubes, disks and beakers present"], ["drive_ok", "Temperature control, drive mechanism and timer present"], ["docs_ok", "Installation and documentation verified"]], ["@USP1058", "@USP701"]),
        test({
          key: "T02", name: "T02 — OQ – dimensions / assembly", stage: "OQ",
          procedure: "Inspect basket-rack assembly and components against the dimensional and construction requirements in USP <701>; document component identification and condition.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP701"], dataType: "checklist",
          fields: [fBool("dimensions_ok", "Dimensions and construction inspected against <701>"), fText("components", "Component identification and condition", true)],
          criteria: [notSpecified("dim_lim", "Dimensional tolerances (<701>)", "@USP701")],
        }),
        test({
          key: "T03", name: "T03 — Temperature", stage: "OQ",
          procedure: "Verify test liquid temperature under operating conditions using a suitable traceable thermometer; apply the specific <701> requirement.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP701"], dataType: "calculated",
          fields: [fNum("set_temp", "Set temperature", "°C"), fNum("medium_temp", "Measured test liquid temperature", "°C"), fCert("thermo_cert", "Thermometer ID / certificate")],
          calculations: [calc({ key: "temp_dev", label: "Measured − set", kind: "custom", formula: "medium_temp - set_temp", unit: "°C", decimals: 1 })],
          criteria: [notSpecified("temp_lim", "Test liquid temperature requirement (<701>)", "@USP701")],
        }),
        test({
          key: "T04", name: "T04 — Movement / frequency", stage: "OQ",
          procedure: "Verify stroke frequency and stroke distance of basket-rack assembly against <701> requirements; record measured values and method.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP701"], dataType: "calculated",
          fields: [fNum("frequency", "Measured stroke frequency", "cycles/min"), fNum("distance", "Measured stroke distance", "mm"), fText("method", "Measurement method", true)],
          criteria: [notSpecified("freq_lim", "Stroke frequency / distance requirement (<701>)", "@USP701")],
        }),
        test({
          key: "T05", name: "T05 — Timer", stage: "OQ",
          procedure: "Verify operating and endpoint timing using a traceable timer.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP701"], dataType: "calculated",
          fields: [fNum("set_time", "Set time", "s"), fNum("actual_time", "Measured time (traceable timer)", "s"), fCert("timer_cert", "Timer ID / certificate")],
          calculations: [calc({ key: "time_dev", label: "Measured − set", kind: "custom", formula: "actual_time - set_time", unit: "s", decimals: 1 })],
          criteria: [notSpecified("time_lim", "Timer accuracy requirement", "@USP701")],
        }),
        test({
          key: "T06", name: "T06 — Operational performance", stage: "PQ",
          procedure: "Execute the procedure for the relevant dosage form exactly as specified in <701> and the applicable monograph, including medium, temperature, disc use, unit count and time.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP701"], dataType: "documentary",
          fields: [fText("dosage_form", "Dosage form / monograph", true), fText("conditions", "Medium, temperature, disc use, unit count and time", true), fText("observations", "Observations", true)],
          criteria: [notSpecified("op_lim", "Dosage-form-specific procedure (<701> / monograph)", "@USP701")],
        }),
        test({
          key: "T07", name: "T07 — Acceptance", stage: "PQ",
          procedure: "Apply the dosage-form-specific criteria in <701> and the monograph. Do not apply a single generic pass time to all products.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP701"], dataType: "documentary",
          fields: [fText("criteria_applied", "Dosage-form-specific criteria applied", true), fText("evaluation", "Evaluation", true)],
          criteria: [notSpecified("acc_lim", "Dosage-form-specific acceptance (no generic pass time)", "@USP701")],
        }),
      ],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* 7. Refractometer — CAL-QC-REF-001                                    */
/* ------------------------------------------------------------------ */

const REF = build({
  number: "CAL-QC-REF-001",
  title: "Calibration & Qualification Protocol — Refractometer Qualification and Performance Verification",
  device: "Refractometer",
  equipmentType: "Refractometer",
  manufacturer: "Bellingham & Stanley (UK)",
  model: "RFM340",
  instrumentKey: "refractometer",
  sourceRevision: "00",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-REF-001_Refractometer_Protocol_Rev00_DRAFT.docx",
  references: [["@USP831", "Refractive index requirements (accuracy, temperature, repeatability)"], ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"]],
  stages: ["IQ", "OQ", "PQ"],
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Data Sheets",
      stage: "OQ",
      tests: [
        iqTest("T01", "Verify instrument identity, prism, light source, temperature-control system, software, installation, utilities and documentation.", [["identity_ok", "Instrument identity matches"], ["prism_ok", "Prism and light source verified"], ["temp_system_ok", "Temperature-control system verified"], ["docs_ok", "Installation, utilities and documentation verified"]], ["@USP1058", "@USP831"]),
        test({
          key: "T02", name: "T02 — Temperature control", stage: "OQ",
          procedure: "Verify sample/prism temperature control using a traceable reference thermometer at intended measurement temperatures. Record setpoint and actual temperature.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP831"], dataType: "calculated",
          fields: [fNum("setpoint", "Setpoint", "°C"), fNum("actual", "Actual temperature (reference thermometer)", "°C"), fCert("thermo_cert", "Reference thermometer ID / certificate")],
          calculations: [calc({ key: "temp_dev", label: "Actual − setpoint", kind: "custom", formula: "actual - setpoint", unit: "°C", decimals: 2 })],
          criteria: [notSpecified("temp_lim", "Temperature control requirement (<831>)", "@USP831")],
        }),
        test({
          key: "T03", name: "T03 — Accuracy", stage: "OQ",
          procedure: "Measure certified refractive-index reference material(s) spanning the intended operational range and at the specified wavelength/temperature. Compare with certified values and account for CRM uncertainty and instrument specification as directed by <831>.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP831"], dataType: "multi-level", unit: "nD", readingsRequired: 1,
          levels: [level("R1", "CRM 1", null, "nD", "Certified RI from certificate"), level("R2", "CRM 2", null, "nD", "Certified RI from certificate"), level("R3", "CRM 3", null, "nD", "Certified RI from certificate")],
          fields: [fNum("temperature", "Measurement temperature", "°C"), fNum("wavelength", "Wavelength", "nm"), fCert("crm_cert", "CRM certificates / uncertainty")],
          calculations: [calc({ key: "err", label: "Measured − certified", kind: "error", scope: "per-level", unit: "nD", decimals: 5 })],
          criteria: [notSpecified("acc_lim", "Accuracy acceptance incl. CRM uncertainty and instrument specification (<831>)", "@USP831")],
          notes: placeholderCount(3, "CRM levels spanning the range"),
        }),
        test({
          key: "T04", name: "T04 — Repeatability", stage: "OQ",
          procedure: "Perform replicate measurements of reference material(s); calculate mean, SD and range/%RSD. Apply repeatability requirements/specification stated in <831> or manufacturer only where the supplied chapter explicitly refers to it.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP831"], dataType: "series", unit: "nD", readingsRequired: 5,
          calculations: [calc({ key: "mean", label: "Mean", kind: "mean", unit: "nD", decimals: 5 }), calc({ key: "sd", label: "SD", kind: "sd", unit: "nD", decimals: 6 }), calc({ key: "range", label: "Range", kind: "range", unit: "nD", decimals: 5 }), calc({ key: "rsd", label: "%RSD", kind: "rsd", unit: "%", decimals: 4 })],
          criteria: [notSpecified("rep_lim", "Repeatability requirement (<831>)", "@USP831")],
          notes: placeholderCount(5, "Replicate measurements"),
        }),
        test({
          key: "T05", name: "T05 — Scale / display verification", stage: "OQ",
          procedure: "Verify display resolution, zero/reference setting and operational range using suitable certified reference materials.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP831"], dataType: "calculated",
          fields: [fNum("resolution", "Display resolution", "nD"), fNum("zero_cert", "Zero / reference standard certified value", "nD"), fNum("zero_read", "Zero / reference reading", "nD"), fBool("range_ok", "Operational range verified with CRMs")],
          calculations: [calc({ key: "zero_dev", label: "Reading − certified", kind: "custom", formula: "zero_read - zero_cert", unit: "nD", decimals: 5 })],
          criteria: [notSpecified("disp_lim", "Scale / display acceptance", "@USP831")],
        }),
        test({
          key: "T06", name: "T06 — Performance qualification", stage: "PQ",
          procedure: "Periodically repeat accuracy and repeatability checks across intended range; retain reference material certificate, temperature, wavelength and raw readings.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP831"], dataType: "documentary",
          fields: [fBool("repeated_ok", "Accuracy and repeatability repeated across the intended range"), fText("records", "Certificates, temperature, wavelength and raw readings retained (references)", true)],
          criteria: [notSpecified("pq_lim", "PQ frequency / acceptance (risk-based)", "@USP831")],
        }),
      ],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* 8. UV-Visible spectrophotometer — CAL-QC-UV-001                      */
/* ------------------------------------------------------------------ */

const UV = build({
  number: "CAL-QC-UV-001",
  title: "Calibration & Qualification Protocol — UV-Visible Spectrophotometer Qualification and Performance Verification",
  device: "UV-Visible Spectrophotometer",
  equipmentType: "UV-Visible Spectrophotometer",
  manufacturer: "Jasco (Japan)",
  model: "V-730",
  instrumentKey: "spectrophotometer",
  sourceRevision: "00",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL PENDING",
  sourceFile: "CAL-QC-UV-001_UV-Visible Spectrophotometer_Protocol_Rev00_DRAFT.docx",
  references: [["@USP857", "UV-Vis qualification requirements (Table 1 limits, photometric accuracy, stray light)"], ["@USP1857", "Theory and practice (supporting information)"], ["@USP1058", "AIQ lifecycle / IQ-OQ-PQ framework"]],
  stages: ["IQ", "OQ", "PQ"],
  extraDescription: "Historical QC-I-097 record limits (r ≥ 0.99, baseline ±0.001 A, stray light ≥ 2.0 A) are NOT adopted as criteria (not stated in the protocol) — see notes.",
  sections: [
    {
      key: "qualification",
      title: "8. Qualification Tests and Data Sheets",
      stage: "OQ",
      tests: [
        iqTest("T01", "Verify instrument model/serial, optical configuration, detector, lamp(s), software/firmware, computer, installation, utilities, accessories and environment.", [["identity_ok", "Model / serial verified"], ["optics_ok", "Optical configuration, detector and lamp(s) verified"], ["computer_ok", "Software / computer verified"], ["install_ok", "Installation, utilities, accessories and environment verified"]], ["@USP1058", "@USP857"]),
        test({
          key: "T02", name: "T02 — Wavelength accuracy", stage: "OQ",
          procedure: "Use applicable certified wavelength reference (Hg/D2 emission lines, holmium oxide, cerium oxide or other chapter-listed standard). Non-diode-array instruments: at least six replicate measurements per line; mean must meet accuracy limits and SD for precision must not exceed 0.5 nm. Diode-array instruments: one accuracy measurement; no precision determination required (record N/A justification for precision in the comment).",
          sourceAcceptance: "USP <857> Table 1 limits: UV 200–400 nm accuracy ±1 nm; visible 400–780 nm and visible/NIR 400–900 nm accuracy ±2 nm. Non-diode-array: ≥ 6 replicates, SD ≤ 0.5 nm.",
          refs: ["@USP857"], clause: "<857> Table 1", dataType: "multi-level", unit: "nm", readingsRequired: 6,
          levels: [level("UVL", "UV line (200–400 nm)", null, "nm", "Certified line wavelength from the reference certificate"), level("VISL", "Visible line (400–780 nm)", null, "nm", "Certified line wavelength from the reference certificate")],
          fields: [fSelect("instrument_type", "Instrument type", ["non-diode-array", "diode-array"]), fText("wl_standard", "Wavelength reference standard", true), fCert("wl_cert", "Reference certificate")],
          calculations: [calc({ key: "err", label: "Mean − certified", kind: "error", scope: "per-level", unit: "nm", decimals: 2 }), calc({ key: "sd", label: "SD (precision)", kind: "sd", scope: "per-level", unit: "nm", decimals: 3 })],
          criteria: [
            crit("uv_acc", "err", "UV 200–400 nm: accuracy ±1 nm (USP <857> Table 1).", "abs<=", { tolerance: 1, unit: "nm", levelKey: "UVL", ref: "@USP857", clause: "Table 1" }),
            crit("vis_acc", "err", "Visible 400–780 nm: accuracy ±2 nm (USP <857> Table 1).", "abs<=", { tolerance: 2, unit: "nm", levelKey: "VISL", ref: "@USP857", clause: "Table 1" }),
            crit("uv_sd", "sd", "Non-diode-array precision: SD ≤ 0.5 nm (UV line).", "<=", { upper: 0.5, unit: "nm", levelKey: "UVL", ref: "@USP857", clause: "Table 1" }),
            crit("vis_sd", "sd", "Non-diode-array precision: SD ≤ 0.5 nm (visible line).", "<=", { upper: 0.5, unit: "nm", levelKey: "VISL", ref: "@USP857", clause: "Table 1" }),
          ],
        }),
        test({
          key: "T03", name: "T03 — Photometric accuracy / control of absorbance", stage: "OQ",
          procedure: "Perform chapter-prescribed photometric accuracy checks using suitable certified standards/reference materials and wavelengths/ranges. Extract exact material-specific limits and uncertainty treatment from <857> tables for the selected method; do not use one universal absorbance limit.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP857"], dataType: "multi-level", unit: "A", readingsRequired: 1,
          levels: [1, 2, 3, 4].map(i => level(`A${i}`, `Point ${i}`, null, "A", "Certified absorbance / specific absorbance; historical QC-I-097 record used K2Cr2O7 at 235/257/313/350 nm — confirm against <857>")),
          fields: [fText("material", "Standard / reference material and wavelengths", true), fCert("material_cert", "Certificate")],
          calculations: [calc({ key: "err", label: "Measured − certified", kind: "error", scope: "per-level", unit: "A", decimals: 4 })],
          criteria: [notSpecified("photo_lim", "Material-specific photometric limit (<857> table for the selected method)", "@USP857")],
          notes: placeholderCount(4, "Photometric points"),
        }),
        test({
          key: "T04", name: "T04 — Photometric linearity", stage: "OQ",
          procedure: "Verify response over intended absorbance range using chapter-prescribed standards/procedure; apply criteria for selected procedure and instrument type.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP857"], dataType: "multi-level", unit: "A", readingsRequired: 1,
          levels: [1, 2, 3, 4, 5].map(i => level(`C${i}`, `Level ${i}`, null, "", "Concentration / reference value")),
          calculations: [calc({ key: "slope", label: "Slope", kind: "linearity-slope", decimals: 5 }), calc({ key: "intercept", label: "Intercept", kind: "linearity-intercept", decimals: 5 }), calc({ key: "r", label: "Correlation coefficient r", kind: "linearity-r", decimals: 6 })],
          criteria: [notSpecified("lin_lim", "Linearity criterion for the selected <857> procedure (historical record r ≥ 0.99 not adopted)", "@USP857")],
          notes: placeholderCount(5, "Linearity levels"),
        }),
        test({
          key: "T05", name: "T05 — Stray light", stage: "OQ",
          procedure: "Verify using chapter-listed cut-off solutions/filters and prescribed wavelengths; apply the corresponding <857> limits.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP857"], dataType: "calculated",
          fields: [fText("cutoff", "Cut-off solution / filter", true), fNum("wavelength", "Wavelength", "nm"), fNum("absorbance", "Measured absorbance", "A")],
          criteria: [notSpecified("stray_lim", "Stray-light limit for the chosen cut-off solution (<857>; historical ≥ 2.0 A not adopted)", "@USP857")],
        }),
        test({
          key: "T06", name: "T06 — Resolution / spectral bandwidth", stage: "OQ",
          procedure: "Verify resolution or spectral bandwidth using the prescribed reference material/procedure where applicable to instrument design and intended use.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP857"], dataType: "calculated",
          fields: [fText("res_material", "Reference material / procedure", true), fNum("res_value", "Measured resolution ratio or bandwidth"), fText("res_unit", "Unit / basis", true)],
          criteria: [notSpecified("res_lim", "Resolution / bandwidth limit (<857>, where applicable)", "@USP857")],
        }),
        test({
          key: "T07", name: "T07 — Baseline / noise / stability", stage: "OQ",
          procedure: "Perform operational checks where required by the specific instrument design and procedure; acceptance limits must be from the applicable <857> procedure or approved instrument specification.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP857"], dataType: "calculated",
          fields: [fNum("baseline", "Baseline flatness / noise result", "A"), fText("baseline_method", "Procedure / specification source", true)],
          criteria: [notSpecified("base_lim", "Baseline / noise limit (<857> or approved instrument specification; historical ±0.001 A not adopted)", "@USP857")],
        }),
        test({
          key: "T08", name: "T08 — Performance qualification (PQ)", stage: "PQ",
          procedure: "Repeat relevant wavelength and photometric performance checks over the intended analytical range and frequency established by documented risk assessment.",
          sourceAcceptance: "As specified in the supplied USP chapter / applicable monograph; where not stated, mark not specified.",
          refs: ["@USP857"], dataType: "documentary",
          fields: [fBool("pq_repeated", "Wavelength and photometric checks repeated over the intended range"), fText("risk_basis", "Frequency / risk-assessment reference", true)],
          criteria: [notSpecified("pq_lim", "PQ frequency and acceptance (risk-based)", "@USP857")],
        }),
      ],
    },
  ],
});

/** The eight imported protocols, in register order. */
export const PACKAGE_PROTOCOLS: PackageProtocol[] = [HPLC, POL, BAL, MOA, DIS, DISINT, REF, UV];

/** Equipment created by the import (not part of the built-in device list). Values from CAL-QC-BAL-001 Rev.01 §4. */
export const PACKAGE_NEW_EQUIPMENT = [
  {
    instrumentKey: "balance",
    equipmentType: "balance",
    nameEn: "Analytical Balance",
    nameAr: "الميزان التحليلي",
    instrumentId: "QC-I-074",
    manufacturer: "Sartorius (Germany)",
    model: "ED224S",
    serialNumber: "23304057",
    sopNumber: "QC-105D",
    formNumber: "",
    source: "CAL-QC-BAL-001 Rev.01 §4 (Instrument Identification and Manufacturer Specifications) and the supplied QC-I-074 validation record image",
    specifications: {
      capacity: { value: 220, unit: "g", source: "CAL-QC-BAL-001 Rev.01 §4" },
      readability: { value: 0.0001, unit: "g", source: "CAL-QC-BAL-001 Rev.01 §4" },
      mfrRepeatability: { value: 0.0001, unit: "g", source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer)" },
      mfrLinearity: { value: 0.0002, unit: "g", source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer)" },
      responseTime: { value: 2.5, unit: "s", source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer, typical)" },
      panDiameter: { value: 90, unit: "mm", source: "CAL-QC-BAL-001 Rev.01 §4" },
      envTempMin: { value: 10, unit: "°C", source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer operating range)" },
      envTempMax: { value: 30, unit: "°C", source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer operating range)" },
      calWeight: { value: "200 g, class E2 (verify current manual/configuration before use)", unit: "", source: "CAL-QC-BAL-001 Rev.01 §4" },
    },
  },
] as const;
