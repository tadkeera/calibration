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
    placeholder: "@SOPQC105D",
    code: "SOP-QC-105D",
    title: "Site SOP QC-105D and related procedures (analytical balance use, calibration, checks, deviations, records, maintenance)",
    issuer: "National Quality Control Laboratory",
    referenceType: "institutional-procedure",
    documentNumber: "QC-105D",
    edition: "",
    revision: "",
    publicationDate: "",
    sourceUrl: "",
    applicableSection: "Site-specific use, calibration, checks, deviations, records and maintenance",
    notes: "Cited by CAL-QC-BAL-001 Rev.03 §3. Confirm the current approved revision before execution.",
  },
  {
    placeholder: "@BALREV03",
    code: "CAL-QC-BAL-001-REV03-SRC",
    title: "CAL-QC-BAL-001 Rev.03 — Calibration & Qualification Protocol, Analytical Balance Sartorius ED224S (supplied draft, 21-Nov-2026)",
    issuer: "Supplied by the laboratory (CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf, 7 pages)",
    referenceType: "institutional-procedure",
    documentNumber: "CAL-QC-BAL-001",
    edition: "",
    revision: "03",
    publicationDate: "2026-11-21",
    sourceUrl: "",
    applicableSection: "§1–11, Appendices A–B",
    notes: "Status in the source: DRAFT – TECHNICAL REVIEW / QA APPROVAL REQUIRED. Supersedes Rev.00/01/02. No execution or release is authorized until all approval gates are met.",
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
  /** false = optional / risk-based test (an unperformed optional test is reported NOT APPLICABLE). */
  required?: boolean;
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
  required: d.required ?? true,
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
  /** Reference placeholder of the source document (default: the 8-protocol package). */
  sourceRef?: string;
  /** Source-specific open-items text (default: the package §15 open items). */
  openItems?: string;
};

function build(spec: ProtocolSpec): PackageProtocol {
  const description = [
    `Imported from the supplied package (${spec.sourceFile}). Source document revision: Rev.${spec.sourceRevision}; source status: ${spec.sourceStatus}.`,
    "System status: DRAFT — all acceptance criteria PENDING TECHNICAL VERIFICATION. Loading this protocol does not imply that the instrument passed.",
    spec.extraDescription ?? "",
    spec.openItems ?? OPEN_ITEMS,
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
        { referenceId: spec.sourceRef ?? "@PKG", supports: `Source document ${spec.sourceFile} (Rev.${spec.sourceRevision})`, clause: "" },
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
/* 3. Analytical balance — CAL-QC-BAL-001 Rev.03 (DRAFT, supersedes Rev.01) */
/* ------------------------------------------------------------------ */

/**
 * Source: CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf (21-Nov-2026, 7 pages).
 * Rev.03 removes the numeric limits that Rev.01 had assumed for accuracy,
 * sensitivity, linearity and eccentricity: they are record-only here until the
 * current official USP text / approved site method defines them. Only the
 * limits Rev.03 itself states are configured (repeatability prior ≤0.10 %,
 * Mmin ≤ m, 5–100 % accuracy range, proposed 20–25 °C / 40–60 %RH window) and,
 * like every criterion, they are PENDING TECHNICAL VERIFICATION.
 */
const B3 = "@BALREV03";
const BAL_USP41 = "Use currently official document; DOI preview located: USPNF_M98780_05_01 (2025). Verify 2026 notices/IRAs before approval.";
const BAL_USP1251 = "Use currently official document; DOI preview located: USPNF_M99963_04_01 (2025). Verify 2026 notices/IRAs before approval.";
const URS: Array<[string, string, string]> = [
  ["urs01", "URS-01 Intended use", "List QC tests/materials; identify which require accurate weighing."],
  ["urs02", "URS-02 Operating range", "Routine gross/net weighing range and units."],
  ["urs03", "URS-03 Smallest net sample weight m", "Smallest mass used by any approved method/SOP, with method reference and scientific rationale. Do not assume a value."],
  ["urs04", "URS-04 Required tolerance", "Compendial, method-specific or approved site tolerance for each use."],
  ["urs05", "URS-05 Capacity/readability", "Confirm 220 g and d = 0.0001 g against nameplate/manual and suitability for URS."],
  ["urs06", "URS-06 Environment", "Approve location, temperature, RH, vibration, drafts, sunlight, power and bench (provisional window §6; site approval open)."],
  ["urs07", "URS-07 Data and records", "Define paper/electronic record controls, audit trail, access, backup and retention."],
  ["urs08", "URS-08 Service and maintenance", "Calibration, preventive maintenance, service and response arrangements."],
];
const ENV_NOTE = "PROPOSED SITE CONTROL LIMIT (Rev.03 §6) — not a confirmed Sartorius ED224S manufacturer limit and not a USP-mandated range. Enforceable only after QC, Engineering and QA approve it and confirm compatibility with the controlled manual, room capability and local SOP. If the manual specifies a narrower/different range, the manufacturer requirement governs.";
const ECC_POS: Array<[string, string]> = [["fl", "Front-left"], ["fr", "Front-right"], ["rl", "Rear-left"], ["rr", "Rear-right"]];

const BAL = build({
  number: "CAL-QC-BAL-001",
  title: "Calibration & Qualification Protocol — Analytical Balance Sartorius ED224S",
  device: "analytical balance",
  equipmentType: "Analytical Balance",
  manufacturer: "Sartorius",
  model: "ED224S",
  instrumentKey: "balance",
  sourceRevision: "03",
  sourceStatus: "DRAFT – TECHNICAL REVIEW / QA APPROVAL REQUIRED",
  sourceFile: "CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf",
  sourceRef: B3,
  references: [
    ["@USP41", `Compendial accuracy, repeatability, calibration and minimum-weight requirements when in scope. ${BAL_USP41}`],
    ["@USP1251", `Technical guidance for weighing practice and risk-based PQ checks. ${BAL_USP1251}`],
    ["@USP1058", "DQ/IQ/OQ/PQ lifecycle framework. Verify currently official text/status in subscribed USP-NF."],
    ["@SARTORIUS", "Exact capacity, readability, equilibration, operating environment, load and performance specifications. Obtain controlled manual for exact instrument variant and retain copy."],
    ["@SOPQC105D", "Site-specific use, calibration, checks, deviations, records and maintenance. Confirm current approved revision."],
  ],
  stages: ["DQ", "IQ", "OQ", "PQ"],
  extraDescription:
    "Revision history (source): Rev.00 20-Nov-2026 initial generic draft (superseded); Rev.01 20-Nov-2026 instrument identity and initial compendial review (superseded); Rev.02 21-Nov-2026 DQ/URS, test sheets and technical corrections (superseded draft); Rev.03 21-Nov-2026 provisional environmental operating window, expanded reference-weight register, explicit calculation worksheets and current USP source review — draft, not approved. Rev.03 replaces the Rev.01 content previously imported. Note: the PDF's hidden page-header layer still contains \"Rev.02\"; the visible header and the document-control table state Rev.03 (document control to correct).",
  openItems:
    "Open items before approval (Rev.03 §11): verify current official USP <41>, <1251>, <1058> and any revision bulletins / IRAs on the approval date; confirm the ED224S exact variant, capacity, d, equilibration and manufacturer environment limits; approve DQ/URS and intended use/tolerances; set the intended smallest net sample mass m; approve or replace the proposed temperature/RH range; attach reference-weight certificates and complete the register; approve the T07 linearity method and limit; approve the T08 eccentricity positions, denominator and limit; execute tests and resolve deviations; final technical review and QA release. No execution or release is authorized until all approval gates are met.",
  narrative: {
    purpose: "To define documented design, installation, operational and performance qualification activities demonstrating that the identified analytical balance is fit for its approved QC laboratory intended use. This protocol defines procedures, acceptance criteria, data records, deviation controls and approval responsibilities. It does not establish that the balance has passed qualification until all required testing and approvals are complete.",
    scope: "Applies to Analytical Balance QC-I-074, Sartorius ED224S, serial number 23304057. Includes DQ/URS, IQ, OQ and risk-based PQ. USP <41> applies when materials must be accurately weighed. Applicable monographs, approved methods/SOPs and the controlled manufacturer instructions remain applicable.",
    responsibilities:
      "Calibration / Validation: protocol execution/oversight, raw data, calculations, traceability, deviations and report.\nQC Equipment Owner: define intended use, m, tolerances and PQ frequency; provide methods/SOPs; approve URS.\nEngineering / Maintenance: installation, environment, power, repairs and maintenance.\nTechnical Reviewer: independent review of methods, raw data, calculations, uncertainty and deviations.\nQA: approve protocol, deviations and final release.\nDocument Control: verify controlled references, effective date and issuance.",
    definitions:
      "Signed relative error = 100 × (I − m_ref) / m_ref (retain sign; assess absolute value). Sample SD s of n ≥ 10 readings. s_eff = max(s, 0.41d) with verified d. Repeatability % = 100 × 2·s_eff / m (m = approved intended smallest net sample mass). Floor-only Mmin = 2000 × 0.41d (0.082 g for d = 0.0001 g; not an approved measured minimum). Linearity e_i = I_i − m_i. Eccentricity Δ_j = I_j − I_center; if % required 100 × Δ_j / m_ref (approve denominator first). (Rev.03 Appendix A)",
    equipmentDescription:
      "Analytical Balance, Sartorius ED224S, equipment ID QC-I-074, serial 23304057. Capacity 220 g — verify from nameplate and controlled manual. Readability / scale interval d 0.0001 g — verify from nameplate/manual. Manufacturer repeatability / linearity / response time / pan size: previously transcribed values are UNVERIFIED — do not use as acceptance criteria until exact variant documentation is attached. Room / location / bench: to be recorded during IQ. Calibration status / due date: verify before execution. Firmware / software: record if available/applicable. (Rev.03 §4)",
    requiredReferenceStandards:
      "No certificate identifiers, certified values or uncertainties have been supplied — none are populated. Complete the register (weight ID, nominal, certified value, class, certificate no., U / MPE (mg), k, calibration date / due date, traceability provider) from original, current certificates before testing. Verify unique ID, certificate authenticity and status, certified mass and uncertainty or MPE, coverage factor, traceability, dates, handling/storage and suitability for the load. For USP <41> accuracy, verify that the MPE or calibration uncertainty meets the current official chapter's required relationship to the applied accuracy limit; assess combined uncertainty when weights are combined. Attach certificates as controlled appendices. (Rev.03 §7)",
    environmentalConditions:
      "Provisional operating window for planning and initial monitoring only: temperature 20–25 °C and relative humidity 40–60 % RH — PROPOSED SITE CONTROL LIMITS, not confirmed manufacturer limits and not a USP-mandated range. Record actual temperature/RH at start and end of each session; no abrupt temperature change; no direct airflow; rigid, level, low-vibration bench; no direct sunlight or nearby heat source. Do not record proposed ranges as actual observed conditions. (Rev.03 §6)",
    safetyRequirements:
      "Prerequisites (Rev.03 §8): approved protocol available at point of use; identity matches QC-I-074 / Sartorius ED224S / serial 23304057; balance clean, level, mechanically sound and within calibration/maintenance status; controlled manufacturer instructions available and followed exactly (equilibration, operating limits); room conditions and actual location recorded; reference weights with suitable current certificates, thermally equilibrated and handled appropriately; QC Owner has approved m and required tolerance before the repeatability/minimum-weight decision; operator, date/time, environment, settings and all readings recorded contemporaneously.",
    deviationManagement:
      "Historical record reportedly contains six readings only; it cannot retrospectively satisfy a requirement for not fewer than 10 replicate readings. Preserve the original record unchanged; perform a new repeatability test with at least 10 readings under the approved method. Record all deviations, investigations, impact assessments, corrective actions and retest evidence. No fabricated or reconstructed raw data are permitted. (Rev.03 §10)",
    finalAssessment:
      "Each test is reported PASS / FAIL / N/A with raw-data reference, deviation number and reviewer/date (Rev.03 §11). Approval checklist (Appendix B): current official USP chapters and notices verified; exact manufacturer documentation verified; DQ/URS approved; m and tolerance approved; environmental range approved; reference-weight certificates accepted; linearity and eccentricity methods and criteria approved; all tests completed and deviations resolved; technical review and QA release completed. Document status: DRAFT – NOT APPROVED — no execution or release is authorized until all approval gates are met.",
  },
  sections: [
    {
      key: "dq",
      title: "5. DQ / User Requirements Specification",
      stage: "DQ",
      tests: [
        test({
          key: "DQ", name: "DQ — Design Qualification / User Requirements (URS-01 … URS-08)", stage: "DQ",
          procedure: "The QC Equipment Owner completes and approves intended use, weighing range, smallest net sample mass and required weighing tolerance before the relevant acceptance decisions can be made. Record the entry / evidence reference for each URS item.",
          sourceAcceptance: "All applicable URS items must be completed and approved. The intended smallest net sample weight and weighing tolerance must be derived from actual approved applications, not invented by the protocol author.",
          refs: [B3, "@USP1058"], clause: "Rev.03 §5", dataType: "checklist",
          fields: [
            ...URS.map(([k, l]) => fBool(`${k}_ok`, `${l} — completed and approved`)),
            ...URS.map(([k, l, hint]) => fText(`${k}_ev`, `${l} — entry / evidence (${hint})`, false)),
            fNum("m_urs", "Approved smallest net sample mass m (URS-03)", "g", false),
            fText("m_rationale", "URS-03 method reference and scientific rationale for m", false),
          ],
          criteria: URS.map(([k, l]) => passFail(`${k}_ok`, `${l}: completed and approved (Rev.03 §5 DQ acceptance).`, B3, "§5")),
          notes: "Rev.03 lists every URS item as OPEN (URS-06: provisional window, site approval open). The protocol does not supply m — it must come from an approved method (gap B2).",
        }),
      ],
    },
    {
      key: "qualification",
      title: "9. Qualification Tests",
      stage: "OQ",
      tests: [
        test({
          key: "T01", name: "T01 — Installation Qualification (IQ)", stage: "IQ",
          procedure: "Verify nameplate, model, serial number, equipment ID, accessories, manuals, installation records, bench, level, vibration, drafts, sunlight, power, location, temperature/RH, software/firmware where applicable, calibration status and due date. Attach evidence. Record actual room temperature and RH at the start and end of the session.",
          sourceAcceptance: "Identity matches; installation meets the exact controlled manufacturer instructions and approved site requirements; all evidence is available. Missing site data is not a pass.",
          refs: [B3, "@USP1251", "@USP1058", "@SARTORIUS"], clause: "Rev.03 §9 T01; §6", dataType: "checklist",
          fields: [
            fBool("identity_ok", "Nameplate and identity (QC-I-074 / ED224S / 23304057)"),
            fBool("docs_ok", "Accessories / manual"),
            fBool("location_ok", "Room / location / bench"),
            fBool("level_ok", "Level / vibration / drafts"),
            fBool("env_ok", "Temperature / RH recorded; no direct sunlight or heat source"),
            fBool("power_ok", "Power / utilities"),
            fBool("cal_status_ok", "Calibration status / due date verified"),
            fText("location", "Room / location / bench ID", true),
            fText("software_version", "Software / firmware (record if available/applicable)"),
            fDate("cal_due", "Calibration due date", true),
            fNum("temp_start", "Room temperature — start", "°C"),
            fNum("temp_end", "Room temperature — end", "°C"),
            fNum("rh_start", "Relative humidity — start", "%RH"),
            fNum("rh_end", "Relative humidity — end", "%RH"),
            fText("evidence", "Observation / evidence references", true),
          ],
          criteria: [
            ...["identity_ok", "docs_ok", "location_ok", "level_ok", "env_ok", "power_ok", "cal_status_ok"].map(k => passFail(k, "Verified and documented; meets the controlled manufacturer instructions and approved site requirements (Rev.03 T01). Missing site data is not a pass.", B3, "§9 T01")),
            ...["temp_start", "temp_end"].map(k => crit(`${k}_lim`, k, "Room temperature within the proposed site window 20–25 °C.", "between", { lower: 20, upper: 25, unit: "°C", sourceClass: "institutional", ref: B3, clause: "§6", conflict: ENV_NOTE })),
            ...["rh_start", "rh_end"].map(k => crit(`${k}_lim`, k, "Relative humidity within the proposed site window 40–60 % RH.", "between", { lower: 40, upper: 60, unit: "%RH", sourceClass: "institutional", ref: B3, clause: "§6", conflict: ENV_NOTE })),
          ],
          notes: "The environmental limits are proposed site control limits (gap B5) — indicative only until approved.",
        }),
        test({
          key: "T02", name: "T02 — Operational Qualification (OQ)", stage: "OQ",
          procedure: "Power on and equilibrate according to controlled manufacturer instructions. Verify stable indication, mechanical mobility, adjustment function as fitted, tare, display/readability, ancillary equipment and operation at the routine location. If connected to computerized systems, assess data capture, security, access, audit trail, storage, backup and recovery as applicable.",
          sourceAcceptance: "Functions comply with controlled manufacturer specifications and approved URS. Do not invent universal numeric OQ limits.",
          refs: [B3, "@USP1251", "@SARTORIUS"], clause: "Rev.03 §9 T02", dataType: "checklist",
          fields: [
            fBool("equilibrated", "Equilibrated per controlled manufacturer instructions"),
            fBool("stable_ok", "Stable indication"),
            fBool("mobility_ok", "Mechanical mobility"),
            fBool("adjust_ok", "Adjustment function (as fitted)"),
            fBool("tare_ok", "Tare"),
            fBool("display_ok", "Display / readability"),
            fBool("ancillary_ok", "Ancillary equipment"),
            fBool("routine_loc_ok", "Operation at the routine location"),
            fSelect("computerized", "Computerized system connection", ["Not connected — not applicable", "Connected — data capture, security, access, audit trail, storage, backup and recovery assessed"]),
            fText("oq_notes", "Observed results / evidence references", true),
          ],
          criteria: ["equilibrated", "stable_ok", "mobility_ok", "adjust_ok", "tare_ok", "display_ok", "ancillary_ok", "routine_loc_ok"].map(k => passFail(k, "Function complies with the controlled manufacturer specification and approved URS (no universal numeric OQ limit).", B3, "§9 T02")),
        }),
        (() => {
          const pts = [1, 2, 3, 4];
          return test({
            key: "T03", name: "T03 — Accuracy (USP <41>)", stage: "OQ",
            procedure: "Use suitable calibrated reference weight(s) over the required operating range and within the range stated in the current official USP <41>. The prior 5 %–100 % range is retained only pending confirmation against the current controlled chapter (5 % of 220 g = 11 g). Select and justify test points across the intended use range. Record certified reference value, indicated value, weight ID and certificate, and complete the reference-weight register (§7). Signed relative error (%) = [(indicated − certified) / certified] × 100.",
            sourceAcceptance: "Acceptance decision uses the absolute error and the currently official chapter's criterion. Confirm current chapter wording and decision rule before approval; do not rely solely on the 2024 extract. Verify that the applicable MPE or calibration uncertainty meets the current official chapter's required relationship to the applied accuracy limit.",
            refs: ["@USP41", B3], clause: "Rev.03 §9 T03; §7", dataType: "calculated",
            fields: [
              ...pts.flatMap(i => [
                fCert(`w${i}_cert`, `Point ${i} — weight ID / certificate no.`),
                fText(`w${i}_class`, `Point ${i} — weight class`, true),
                fNum(`w${i}_u`, `Point ${i} — U / MPE`, "mg"),
                fNum(`w${i}_k`, `Point ${i} — coverage factor k (where stated)`, "", false),
                fDate(`w${i}_due`, `Point ${i} — certificate due date`, true),
                fText(`w${i}_trace`, `Point ${i} — traceability provider`, true),
                fNum(`ref_${i}`, `Point ${i} — certified value`, "g"),
                fNum(`ind_${i}`, `Point ${i} — indication`, "g"),
              ]),
              fBool("cert_checks_ok", "Certificates authentic, current, traceable; weights handled/stored appropriately and thermally equilibrated (§7)"),
              fBool("u_relation_ok", "MPE / calibration uncertainty meets the current official <41> relationship to the applied accuracy limit (§7)"),
            ],
            calculations: pts.flatMap(i => [
              calc({ key: `err_${i}`, label: `Signed relative error point ${i}`, kind: "custom", formula: `(ind_${i} - ref_${i}) / ref_${i} * 100`, unit: "%", decimals: 4, formulaRevision: "BAL-Rev03 App.A" }),
              calc({ key: `abserr_${i}`, label: `Absolute error point ${i}`, kind: "custom", formula: `abs(ind_${i} - ref_${i}) / ref_${i} * 100`, unit: "%", decimals: 4, formulaRevision: "BAL-Rev03 App.A" }),
            ]),
            criteria: [
              passFail("cert_checks_ok", "Reference-weight certificate and traceability checks complete (Rev.03 §7).", B3, "§7"),
              passFail("u_relation_ok", "Weight MPE / uncertainty relationship to the applied accuracy limit verified against the current official <41> (Rev.03 §7).", "@USP41", "Rev.03 §7"),
              ...pts.map(i => notSpecified(`acc_${i}`, `Point ${i} absolute error: acceptance per the currently official USP <41> criterion (Rev.03 states no numeric limit; Rev.01's ≤ 0.10 % is not carried over without verification — gap B10)`, "@USP41", "Rev.03 §9 T03")),
              ...pts.map(i => crit(`range_${i}`, `ref_${i}`, "Test weight within 5 %–100 % of the 220 g capacity (11–220 g) — prior range retained only pending confirmation against the current controlled chapter.", "between", { lower: 11, upper: 220, unit: "g", ref: "@USP41", clause: "Rev.03 §9 T03", conflict: "Range retained pending confirmation (Rev.03 T03); capacity 220 g itself is to be verified from nameplate/manual (URS-05)." })),
            ],
            notes: "Rev.03 data sheet has 4 rows; if fewer points are justified, edit the draft before technical review. Each point's weight-register entry is recorded with the point.",
          });
        })(),
        test({
          key: "T04", name: "T04 — Repeatability (USP <41>)", stage: "OQ",
          procedure: "Perform not fewer than 10 replicate weighings of one stable test weight under consistent conditions. Record every reading; investigate anomalous values and do not delete them without documented justification. Confirm the current official chapter's test conditions and calculation before execution. Worksheet (supplied <41> extract): sample SD s from n ≥ 10 readings; d = verified scale interval; s_eff = max(s, 0.41d); repeatability (%) = (2 × s_eff / m) × 100, m = QC Owner-approved smallest net sample mass.",
          sourceAcceptance: "The prior criterion ≤ 0.10 % must be checked against the current official <41> during approval.",
          refs: ["@USP41", B3], clause: "Rev.03 §9 T04; App.A", dataType: "series", unit: "g", readingsRequired: 10,
          fields: [fNum("d", "Verified scale interval d", "g"), fNum("m", "QC Owner-approved smallest net sample mass m", "g")],
          calculations: [
            calc({ key: "mean", label: "Mean", kind: "mean", unit: "g", decimals: 5 }),
            calc({ key: "s", label: "Sample SD s (n−1)", kind: "sd", unit: "g" }),
            calc({ key: "res_floor", label: "0.41d", kind: "custom", formula: "0.41 * d", unit: "g", formulaRevision: "BAL-Rev03 App.A" }),
            calc({ key: "s_eff", label: "s_eff = max(s, 0.41d)", kind: "custom", formula: "max(s, res_floor)", unit: "g", formulaRevision: "BAL-Rev03 App.A" }),
            calc({ key: "rep", label: "Repeatability = 100 × 2·s_eff / m", kind: "custom", formula: "2 * s_eff / m * 100", unit: "%", decimals: 4, formulaRevision: "BAL-Rev03 App.A" }),
          ],
          criteria: [crit("rep_lim", "rep", "Repeatability (2 × s_eff / m) × 100 ≤ 0.10 % — prior criterion, to be checked against the current official <41> during approval.", "<=", { upper: 0.1, unit: "%", ref: "@USP41", clause: "Rev.03 §9 T04", conflict: "Rev.03: 'The prior criterion ≤0.10% must be checked against the current official <41> during approval.' The historical 6-reading record cannot satisfy n ≥ 10 (gap B1)." })],
          notes: "Exactly 10 reading fields are configured (the minimum). d is entered from the verified nameplate/manual (no fixed 0.0001 g in the formula — Rev.03 'use verified d').",
        }),
        test({
          key: "T05", name: "T05 — Minimum weight / smallest net weight", stage: "OQ",
          procedure: "Calculate the minimum weight from actual repeatability data (T04); it is not interchangeable with the QC Owner's intended smallest net sample mass. Supplied extract: Mmin = 2000 × s_eff. For d = 0.0001 g the floor is 0.41d = 0.000041 g and the floor-only result is 0.082 g — NOT an approved minimum weight and not the actual result unless measured s ≤ floor and the current chapter's calculation is unchanged.",
          sourceAcceptance: "The measured/calculated minimum weight must be no greater than the intended smallest net sample mass m for each application, with the current official chapter and approved method controlling. If it is greater, restrict the balance's use or select a more suitable balance; do not waive the requirement.",
          refs: ["@USP41", "@USP1251", B3], clause: "Rev.03 §9 T05", dataType: "calculated", dependsOn: "T04",
          fields: [fNum("s", "Measured s (from T04)", "g"), fNum("d", "Verified scale interval d", "g"), fNum("m", "Intended smallest net sample mass m", "g"), fSelect("disposition", "Disposition", ["Suitable for the intended m", "Use restricted (m below Mmin for some applications)", "Select a more suitable balance"], false)],
          calculations: [
            calc({ key: "res_floor", label: "0.41d", kind: "custom", formula: "0.41 * d", unit: "g", formulaRevision: "BAL-Rev03 App.A" }),
            calc({ key: "s_eff", label: "s_eff = max(s, 0.41d)", kind: "custom", formula: "max(s, res_floor)", unit: "g", formulaRevision: "BAL-Rev03 App.A" }),
            calc({ key: "mmin", label: "Calculated Mmin = 2000 × s_eff", kind: "custom", formula: "2000 * s_eff", unit: "g", formulaRevision: "BAL-Rev03 §9 T05" }),
            calc({ key: "mw_margin", label: "m − Mmin", kind: "custom", formula: "m - mmin", unit: "g", decimals: 5 }),
          ],
          criteria: [crit("mw_lim", "mw_margin", "Calculated minimum weight ≤ intended smallest net sample mass m (m − Mmin ≥ 0); current official chapter and approved method controlling.", ">=", { lower: 0, unit: "g", ref: "@USP41", clause: "Rev.03 §9 T05" })],
        }),
        test({
          key: "T06", name: "T06 — Sensitivity (risk-based, optional)", stage: "PQ", required: false,
          procedure: "Perform only if justified by intended use and risk assessment. Apply a suitable certified load under the approved method; record the change in displayed value. Ratio = observed change / applied load; deviation from unity (%) = (ratio − 1) × 100.",
          sourceAcceptance: "The acceptance criterion and test load must be defined in the approved PQ method and supported by current USP guidance / manufacturer limits. Do not treat the earlier draft's generic tolerance as automatically mandatory.",
          refs: ["@USP1251", B3], clause: "Rev.03 §9 T06", dataType: "calculated",
          fields: [fText("justification", "Risk-assessment justification for performing the test", true), fCert("load_cert", "Certified load ID / certificate"), fNum("ref_load", "Applied certified load", "g"), fNum("ind_change", "Observed change in displayed value", "g")],
          calculations: [calc({ key: "ratio", label: "Ratio = observed change / applied load", kind: "custom", formula: "ind_change / ref_load" }), calc({ key: "sens_dev", label: "Deviation from unity = (ratio − 1) × 100", kind: "custom", formula: "(ratio - 1) * 100", unit: "%", decimals: 4, formulaRevision: "BAL-Rev03 §9 T06" })],
          criteria: [notSpecified("sens_lim", "Sensitivity acceptance criterion and test load — defined in the approved PQ method (Rev.01's 0.05 % not automatically mandatory — gap B9)", "@USP1251", "Rev.03 §9 T06")],
          notes: "Optional: when not performed the test is reported NOT APPLICABLE; record the risk-based justification either way.",
        }),
        test({
          key: "T07", name: "T07 — Linearity (pointwise deviation)", stage: "PQ",
          procedure: "Use a minimum of 3 and preferably 5–6 suitably distributed certified loads spanning the approved working range, as justified by the approved method. At each point record certified mass m_i and indication I_i. Calculation method selected before execution (proposed for site approval): e_i = I_i − m_i; report |e_i| and the maximum absolute deviation; relative error 100 × e_i / m_i only where a percentage is required. This pointwise method is not a regression model.",
          sourceAcceptance: "Acceptance limit: define from the current USP <1251> and the approved site method before execution. Do not copy an old criterion without verification.",
          refs: ["@USP1251", B3], clause: "Rev.03 §9 T07; App.A", dataType: "multi-level", unit: "g", readingsRequired: 1,
          levels: [1, 2, 3, 4, 5, 6].map(i => level(`P${i}`, `Point ${i}`, null, "g", "Certified mass m_i from the weight certificate")),
          fields: [fText("method_ref", "Approved linearity method / worksheet reference (selected before execution)", true)],
          calculations: [
            calc({ key: "e", label: "e_i = I_i − m_i", kind: "error", scope: "per-level", unit: "g", decimals: 5, formulaRevision: "BAL-Rev03 App.A" }),
            calc({ key: "abs_e", label: "|e_i|", kind: "abs-error", scope: "per-level", unit: "g", decimals: 5, formulaRevision: "BAL-Rev03 App.A" }),
            calc({ key: "rel_e", label: "Relative error 100 × e_i / m_i", kind: "pct-error", scope: "per-level", unit: "%", decimals: 4, formulaRevision: "BAL-Rev03 App.A" }),
            calc({ key: "max_abs_e", label: "Maximum |e_i| across the range", kind: "max-level-abs-error", unit: "g", decimals: 5, formulaRevision: "BAL-Rev03 App.A" }),
          ],
          criteria: [notSpecified("lin_lim", "Linearity acceptance limit — define from the current USP <1251> and the approved site method before execution (Rev.01's 0.05 % not carried over — gap B7)", "@USP1251", "Rev.03 §9 T07")],
          notes: "6 points configured (Rev.03 data sheet rows); the source minimum is 3 — remove points in the draft only with the approved-method justification.",
        }),
        test({
          key: "T08", name: "T08 — Eccentricity", stage: "PQ",
          procedure: "Select a test load appropriate to the balance and approved method; confirm the load is within the manufacturer's permitted range. Measure at the center and four defined off-center positions (or an equivalent approved pattern), same load and handling. Δ_j = I_j − I_center; report max|Δ|; if percentage reporting is required, 100 × Δ_j / m_ref with the certified test-load value (denominator approved in the method before testing).",
          sourceAcceptance: "Do not assume a generic 30 % load or 0.05 % criterion without confirmation against the current USP <1251>, manufacturer upper-load limit and risk-based application.",
          refs: ["@USP1251", "@SARTORIUS", B3], clause: "Rev.03 §9 T08; App.A", dataType: "calculated",
          fields: [
            fCert("load_cert", "Test load ID / certificate"),
            fNum("m_ref", "Certified test-load value m_ref", "g"),
            fBool("load_in_range", "Load within the manufacturer's permitted range (controlled manual)"),
            fText("pattern", "Position pattern / approved method reference", true),
            fNum("center", "Center indication", "g"),
            ...ECC_POS.map(([k, l]) => fNum(k, `${l} indication`, "g")),
          ],
          calculations: [
            ...ECC_POS.map(([k, l]) => calc({ key: `d_${k}`, label: `Δ ${l} = I − I_center`, kind: "custom", formula: `${k} - center`, unit: "g", decimals: 5, formulaRevision: "BAL-Rev03 App.A" })),
            calc({ key: "max_abs_d", label: "max|Δ|", kind: "custom", formula: `max(${ECC_POS.map(([k]) => `abs(${k} - center)`).join(", ")})`, unit: "g", decimals: 5, formulaRevision: "BAL-Rev03 App.A" }),
            ...ECC_POS.map(([k, l]) => calc({ key: `p_${k}`, label: `Deviation % ${l} = 100 × Δ / m_ref (if approved)`, kind: "custom", formula: `(${k} - center) / m_ref * 100`, unit: "%", decimals: 4, formulaRevision: "BAL-Rev03 App.A" })),
          ],
          criteria: [passFail("load_in_range", "Test load within the manufacturer's permitted range (Rev.03 T08).", "@SARTORIUS", "Rev.03 §9 T08"), notSpecified("ecc_lim", "Eccentricity positions, denominator and acceptance limit — approve before testing (generic 30 % load / 0.05 % not assumed — gap B8)", "@USP1251", "Rev.03 §9 T08")],
        }),
      ],
    },
  ],
  gaps: [
    gap("B1", "Historical balance record cannot substantiate USP <41> repeatability", "The historical record reportedly contains six readings only. It cannot retrospectively satisfy a requirement for not fewer than 10 replicate readings. Preserve the original record unchanged; perform a new repeatability test with at least 10 readings (Rev.03 §10).", [
      { label: "CAL-QC-BAL-001 Rev.03 T04", displayValue: "n ≥ 10 replicate weighings", ref: B3, clause: "§9 T04", sourceClass: "institutional" },
      { label: "Historical record QC-I-074", displayValue: "6 readings only", ref: B3, clause: "§10", sourceClass: "institutional" },
    ], "T04", "g"),
    gap("B2", "Intended smallest net sample mass m not set", "The QC Owner must set m from approved methods with a method-linked rationale before the repeatability and minimum-weight decisions (URS-03; Rev.03 §11 open item). No value was invented.", [
      { label: "CAL-QC-BAL-001 Rev.03", displayValue: "URS-03 OPEN", ref: B3, clause: "§5, §11", sourceClass: "institutional" },
    ], "T05", "g"),
    gap("B3", "Current official USP text not confirmed", "The supplied USP extracts were printed 05-Jan-2024. Public DOI previews identify 2025 versions of <41> (USPNF_M98780_05_01) and <1251> (USPNF_M99963_04_01); USP-NF 2026 Issue 5 is official from 01-Oct-2026 (Issue 6 from 01-Dec-2026, not yet effective on 21-Nov-2026). QA / Document Control must verify chapter revisions, revision bulletins and IRAs in the subscribed USP-NF on the approval date (Rev.03 §3).", [
      { label: "Supplied extracts", displayValue: "Printed 05-Jan-2024", ref: "@USP41", clause: "Rev.03 §3" },
      { label: "USP <41> DOI preview", displayValue: "USPNF_M98780_05_01 (2025)", ref: "@USP41", clause: "Rev.03 §3" },
      { label: "USP <1251> DOI preview", displayValue: "USPNF_M99963_04_01 (2025)", ref: "@USP1251", clause: "Rev.03 §3" },
    ]),
    gap("B4", "Manufacturer specifications unverified (exact ED224S variant)", "Rev.03 §4: capacity 220 g and d = 0.0001 g must be verified from nameplate and the controlled manual; previously transcribed repeatability / linearity / response time / pan size (Rev.01: ≤0.0001 g, ≤0.0002 g, ≤2.5 s, 90 mm, +10 to +30 °C) are unverified and must not be used as acceptance criteria. Equipment records populated from Rev.01 must be reviewed on the equipment data page.", [
      { label: "CAL-QC-BAL-001 Rev.03 §4", displayValue: "Capacity 220 g, d 0.0001 g — verify", ref: B3, clause: "§4", sourceClass: "institutional" },
      { label: "Rev.01 manufacturer table", displayValue: "Unverified — not used as criteria", ref: "@SARTORIUS", clause: "Rev.03 §4", sourceClass: "manufacturer" },
    ]),
    gap("B5", "Environmental operating window is a site proposal", "20–25 °C / 40–60 % RH are PROPOSED SITE CONTROL LIMITS for planning and initial monitoring, not confirmed manufacturer limits and not a USP range. QC, Engineering and QA must approve or replace them; the manufacturer requirement governs if narrower/different (Rev.03 §6).", [
      { label: "CAL-QC-BAL-001 Rev.03 §6", displayValue: "20–25 °C; 40–60 % RH (proposed)", ref: B3, clause: "§6", sourceClass: "institutional" },
      { label: "Rev.01 §4 (unverified manufacturer)", displayValue: "+10 to +30 °C", ref: "@SARTORIUS", clause: "Rev.01 §4", sourceClass: "manufacturer" },
    ], "T01", "°C"),
    gap("B6", "Reference-weight register empty", "No certificate identifiers, certified values or uncertainties were supplied; the register must be completed from original, current certificates before testing (Rev.03 §7).", [
      { label: "CAL-QC-BAL-001 Rev.03 §7", displayValue: "Register to be completed", ref: B3, clause: "§7", sourceClass: "institutional" },
    ], "T03", "g"),
    gap("B7", "Linearity method and limit not approved", "Rev.03 proposes a pointwise method (e_i = I_i − m_i); the method and the acceptance limit must be approved from the current USP <1251> and the site method before execution. Rev.01's 0.05 % is not carried over.", [
      { label: "CAL-QC-BAL-001 Rev.03 T07", displayValue: "Limit to be defined", ref: B3, clause: "§9 T07", sourceClass: "institutional" },
      { label: "Rev.01 (superseded)", displayValue: "NMT 0.05 %", ref: "@USP1251", clause: "Rev.01 T07" },
    ], "T07", "g"),
    gap("B8", "Eccentricity positions, denominator and limit not approved", "Positions, the % denominator (m_ref) and the limit must be approved before testing; a generic 30 % load / 0.05 % criterion is not assumed (Rev.03 T08).", [
      { label: "CAL-QC-BAL-001 Rev.03 T08", displayValue: "To be approved", ref: B3, clause: "§9 T08", sourceClass: "institutional" },
      { label: "Rev.01 (superseded)", displayValue: "≥30 % load; NMT 0.05 %", ref: "@USP1251", clause: "Rev.01 T08" },
    ], "T08", "g"),
    gap("B9", "Sensitivity criterion not defined", "Sensitivity is performed only if justified; its criterion and load are defined in the approved PQ method. Rev.01's 0.05 % is not automatically mandatory (Rev.03 T06).", [
      { label: "CAL-QC-BAL-001 Rev.03 T06", displayValue: "Method-defined", ref: B3, clause: "§9 T06", sourceClass: "institutional" },
      { label: "Rev.01 (superseded)", displayValue: "NMT 0.05 %", ref: "@USP1251", clause: "Rev.01 T06" },
    ], "T06", "%"),
    gap("B10", "Accuracy criterion and range to be confirmed against current <41>", "Rev.03 T03 states no numeric accuracy limit: the decision uses the absolute error and the currently official chapter's criterion. The 5–100 % range (11–220 g) is retained only pending confirmation. Rev.01's ≤ 0.10 % and one-third uncertainty rule are not carried over without verification.", [
      { label: "CAL-QC-BAL-001 Rev.03 T03", displayValue: "Current official <41> criterion", ref: B3, clause: "§9 T03", sourceClass: "institutional" },
      { label: "Rev.01 (superseded)", displayValue: "|error| ≤ 0.10 %; U ≤ 1/3 limit", ref: "@USP41", clause: "Rev.01 T03" },
    ], "T03", "%"),
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

/** The balance protocol as supplied in Rev.03 (replaces the Rev.01 content in an existing system). */
export const BAL_REV03 = BAL;
export const BAL_REV03_REASON =
  "Content replaced by CAL-QC-BAL-001 Rev.03 (CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf, 21-Nov-2026; source status DRAFT – TECHNICAL REVIEW / QA APPROVAL REQUIRED), superseding the Rev.01 content. Rev.03 removes previously assumed numeric limits (accuracy, sensitivity, linearity, eccentricity) pending the current official USP text and approved site methods. All criteria PENDING TECHNICAL VERIFICATION; loading the protocol does not imply that the instrument passed.";

const BAL_UNVERIFIED = "UNVERIFIED — transcribed in superseded CAL-QC-BAL-001 Rev.01 §4; Rev.03 §4: do not use as an acceptance criterion until the exact ED224S variant documentation (controlled manual) is attached";

/** Equipment created by the import (not part of the built-in device list). Identity per CAL-QC-BAL-001 Rev.03 §4. */
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
    source: "CAL-QC-BAL-001 Rev.03 §4 (Instrument Identification) and the supplied QC-I-074 validation record image",
    reference: "CAL-QC-BAL-001 Rev.03 §4",
    specifications: {
      capacity: { value: 220, unit: "g", source: "CAL-QC-BAL-001 Rev.03 §4 — verify from nameplate and controlled manual" },
      readability: { value: 0.0001, unit: "g", source: "CAL-QC-BAL-001 Rev.03 §4 — verify from nameplate/manual" },
      mfrRepeatability: { value: 0.0001, unit: "g", source: BAL_UNVERIFIED },
      mfrLinearity: { value: 0.0002, unit: "g", source: BAL_UNVERIFIED },
      responseTime: { value: 2.5, unit: "s", source: BAL_UNVERIFIED },
      panDiameter: { value: 90, unit: "mm", source: BAL_UNVERIFIED },
      envTempMin: { value: 10, unit: "°C", source: `${BAL_UNVERIFIED}. Rev.03 §6 proposes a site window of 20–25 °C / 40–60 %RH (pending approval)` },
      envTempMax: { value: 30, unit: "°C", source: `${BAL_UNVERIFIED}. Rev.03 §6 proposes a site window of 20–25 °C / 40–60 %RH (pending approval)` },
      calWeight: { value: "200 g, class E2 (verify current manual/configuration before use)", unit: "", source: BAL_UNVERIFIED },
    },
  },
] as const;

/**
 * Specification sources written by the superseded Rev.01 import. The Rev.03
 * replacement re-labels a stored value ONLY when it still carries exactly this
 * value + source (i.e. nobody has edited it since); user-entered data is never touched.
 */
export const BAL_REV01_SPEC_SOURCES: Record<string, { value: number | string; source: string }> = {
  capacity: { value: 220, source: "CAL-QC-BAL-001 Rev.01 §4" },
  readability: { value: 0.0001, source: "CAL-QC-BAL-001 Rev.01 §4" },
  mfrRepeatability: { value: 0.0001, source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer)" },
  mfrLinearity: { value: 0.0002, source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer)" },
  responseTime: { value: 2.5, source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer, typical)" },
  panDiameter: { value: 90, source: "CAL-QC-BAL-001 Rev.01 §4" },
  envTempMin: { value: 10, source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer operating range)" },
  envTempMax: { value: 30, source: "CAL-QC-BAL-001 Rev.01 §4 (manufacturer operating range)" },
  calWeight: { value: "200 g, class E2 (verify current manual/configuration before use)", source: "CAL-QC-BAL-001 Rev.01 §4" },
};
