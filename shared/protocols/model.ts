/**
 * Centralized Equipment Protocol Management — shared domain model.
 *
 * One generic data structure for every equipment category. Nothing in this
 * file is specific to a single instrument: the Polarimeter ADP220 protocol
 * (POL-QC-032D) is only a configuration expressed with these types.
 */
import { z } from "zod";

export const PROTOCOL_CONTENT_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export const REVISION_STATUSES = [
  "draft",
  "technical-review-pending",
  "technical-review-in-progress",
  "technical-changes-required",
  "technically-reviewed",
  "qa-review-pending",
  "qa-review-in-progress",
  "qa-changes-required",
  "approved",
  "rejected",
  "released",
  "superseded",
  "retired",
] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const STATUS_LABELS: Record<RevisionStatus, string> = {
  draft: "Draft",
  "technical-review-pending": "Pending Technical Review",
  "technical-review-in-progress": "Technical Review in Progress",
  "technical-changes-required": "Technical Changes Required",
  "technically-reviewed": "Technically Reviewed",
  "qa-review-pending": "Pending QA Approval",
  "qa-review-in-progress": "QA Review in Progress",
  "qa-changes-required": "QA Changes Required",
  approved: "QA Approved (not released)",
  rejected: "QA Rejected",
  released: "Released",
  superseded: "Superseded",
  retired: "Retired",
};

/** Statuses in which the author may modify revision content. */
export const EDITABLE_STATUSES: readonly RevisionStatus[] = [
  "draft",
  "technical-changes-required",
  "qa-changes-required",
];
/** Terminal statuses: a new revision is required for any further change. */
export const TERMINAL_STATUSES: readonly RevisionStatus[] = [
  "rejected",
  "superseded",
  "retired",
];
/** Statuses whose content is frozen (approval signatures depend on it). */
export const LOCKED_STATUSES: readonly RevisionStatus[] = [
  "approved",
  "released",
  "superseded",
  "retired",
];

/** Allowed status changes. Mirrored by database triggers on both backends. */
export const ALLOWED_STATUS_CHANGES: ReadonlyArray<[RevisionStatus, RevisionStatus]> = [
  ["draft", "technical-review-pending"],
  ["technical-changes-required", "technical-review-pending"],
  ["qa-changes-required", "technical-review-pending"],
  ["technical-review-pending", "technical-review-in-progress"],
  ["technical-review-in-progress", "technical-changes-required"],
  ["technical-review-in-progress", "technically-reviewed"],
  ["technically-reviewed", "qa-review-pending"],
  ["qa-review-pending", "qa-review-in-progress"],
  ["qa-review-in-progress", "qa-changes-required"],
  ["qa-review-in-progress", "approved"],
  ["qa-review-in-progress", "rejected"],
  ["approved", "released"],
  ["released", "superseded"],
  ["released", "retired"],
];

/* ------------------------------------------------------------------ */
/* Vocabularies                                                         */
/* ------------------------------------------------------------------ */

export const PROTOCOL_TYPES = [
  { id: "DQ", label: "Design Qualification (DQ)" },
  { id: "IQ", label: "Installation Qualification (IQ)" },
  { id: "OQ", label: "Operational Qualification (OQ)" },
  { id: "PQ", label: "Performance Qualification (PQ)" },
  { id: "IQ-OQ-PQ", label: "Combined Qualification (IQ/OQ/PQ)" },
  { id: "calibration", label: "Calibration Protocol" },
  { id: "performance-verification", label: "Performance Verification Protocol" },
  { id: "periodic-verification", label: "Periodic Verification Protocol" },
  { id: "requalification", label: "Requalification Protocol" },
  { id: "cleaning-validation", label: "Cleaning Validation Protocol" },
  { id: "process-validation", label: "Process Validation Protocol" },
  { id: "csv", label: "Computerized System Validation Protocol" },
  { id: "custom", label: "Custom Protocol" },
] as const;
export type ProtocolTypeId = (typeof PROTOCOL_TYPES)[number]["id"];
export const PROTOCOL_TYPE_IDS = PROTOCOL_TYPES.map(t => t.id) as [
  ProtocolTypeId,
  ...ProtocolTypeId[],
];

export const QUALIFICATION_STAGES = [
  "General",
  "DQ",
  "IQ",
  "OQ",
  "PQ",
  "Calibration",
  "Performance Verification",
  "Periodic Verification",
  "Requalification",
] as const;

/** Standard protocol sections (§7.3). Not all are mandatory; authors configure the structure per equipment type. */
export const STANDARD_SECTIONS = [
  { key: "purpose", title: "Purpose", stage: "General", required: true },
  { key: "scope", title: "Scope", stage: "General", required: true },
  { key: "responsibilities", title: "Responsibilities", stage: "General", required: true },
  { key: "references", title: "References", stage: "General", required: true },
  { key: "definitions", title: "Definitions and Abbreviations", stage: "General", required: false },
  { key: "equipment-description", title: "Equipment Description", stage: "General", required: true },
  { key: "materials", title: "Required Materials and Standards", stage: "General", required: false },
  { key: "environment", title: "Environmental Conditions", stage: "General", required: false },
  { key: "safety", title: "Safety Requirements", stage: "General", required: false },
  { key: "dq", title: "Design Qualification", stage: "DQ", required: false },
  { key: "iq", title: "Installation Qualification", stage: "IQ", required: false },
  { key: "oq", title: "Operational Qualification", stage: "OQ", required: false },
  { key: "pq", title: "Performance Qualification", stage: "PQ", required: false },
  { key: "calibration", title: "Calibration Tests", stage: "Calibration", required: false },
  { key: "performance-verification", title: "Performance Verification", stage: "Performance Verification", required: false },
  { key: "validation", title: "Validation Activities", stage: "General", required: false },
  { key: "acceptance-criteria", title: "Acceptance Criteria", stage: "General", required: false },
  { key: "deviations", title: "Deviation Management", stage: "General", required: true },
  { key: "final-assessment", title: "Final Assessment", stage: "General", required: true },
  { key: "attachments", title: "Attachments", stage: "General", required: false },
  { key: "signatures", title: "Approval Signatures", stage: "General", required: true },
] as const;

export const DATA_TYPES = [
  { id: "numeric", label: "Numeric values" },
  { id: "series", label: "Measurement series" },
  { id: "multi-level", label: "Multi-level measurements" },
  { id: "checklist", label: "Checklist (boolean items)" },
  { id: "text", label: "Text / observation" },
  { id: "calculated", label: "Calculated from fields" },
  { id: "reference-comparison", label: "Reference comparison" },
  { id: "documentary", label: "Documentary evidence" },
] as const;
export type TestDataType = (typeof DATA_TYPES)[number]["id"];
export const DATA_TYPE_IDS = DATA_TYPES.map(t => t.id) as [
  TestDataType,
  ...TestDataType[],
];

export const FIELD_TYPES = [
  "number",
  "text",
  "boolean",
  "date",
  "time",
  "single-select",
  "multi-select",
  "attachment",
  "image",
  "certificate",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SOURCE_CLASSES = [
  { id: "regulatory", label: "Regulatory Requirement" },
  { id: "pharmacopoeial", label: "Pharmacopoeial Requirement" },
  { id: "international-standard", label: "International Standard" },
  { id: "manufacturer", label: "Manufacturer Specification" },
  { id: "reference-material", label: "Reference Material Specification" },
  { id: "external-calibration", label: "External Calibration Requirement" },
  { id: "institutional", label: "Institutional Requirement" },
  { id: "validated-method", label: "Validated Technical Method" },
  { id: "risk-based-proposal", label: "Risk-Based Proposal" },
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number]["id"];
export const SOURCE_CLASS_IDS = SOURCE_CLASSES.map(s => s.id) as [
  SourceClass,
  ...SourceClass[],
];
/** Source classes that are internal proposals and always need a written justification. */
export const JUSTIFICATION_REQUIRED_CLASSES: readonly SourceClass[] = [
  "institutional",
  "risk-based-proposal",
];

export const VERIFICATION_STATUSES = [
  "pending-technical-verification",
  "verified",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const PENDING_LABEL = "PENDING TECHNICAL VERIFICATION";

export const COMPARISONS = [
  { id: "between", label: "Within lower–upper limits" },
  { id: "<=", label: "≤ upper limit" },
  { id: "<", label: "< upper limit" },
  { id: ">=", label: "≥ lower limit" },
  { id: ">", label: "> lower limit" },
  { id: "abs<=", label: "|value| ≤ tolerance" },
  { id: "target±tolerance", label: "Target ± tolerance" },
  { id: "pass-fail", label: "Boolean item must be confirmed" },
  { id: "record-only", label: "Record only (no numeric limit)" },
] as const;
export type Comparison = (typeof COMPARISONS)[number]["id"];
export const COMPARISON_IDS = COMPARISONS.map(c => c.id) as [
  Comparison,
  ...Comparison[],
];

export const CALC_KINDS = [
  { id: "mean", label: "Average", scope: "values" },
  { id: "min", label: "Minimum", scope: "values" },
  { id: "max", label: "Maximum", scope: "values" },
  { id: "range", label: "Range", scope: "values" },
  { id: "sd", label: "Standard deviation (n−1)", scope: "values" },
  { id: "rsd", label: "Relative standard deviation (%)", scope: "values" },
  { id: "repeatability", label: "Repeatability (SD of replicates)", scope: "values" },
  { id: "error", label: "Measurement difference / bias (mean − reference)", scope: "values" },
  { id: "abs-error", label: "Absolute error |mean − reference|", scope: "values" },
  { id: "pct-error", label: "Percentage error (%)", scope: "values" },
  { id: "pct-difference", label: "Percentage difference (%)", scope: "values" },
  { id: "max-abs-deviation", label: "Max |reading − reference|", scope: "values" },
  { id: "linearity-slope", label: "Linearity — slope", scope: "levels" },
  { id: "linearity-intercept", label: "Linearity — intercept", scope: "levels" },
  { id: "linearity-r", label: "Linearity — correlation coefficient r", scope: "levels" },
  { id: "linearity-r2", label: "Linearity — coefficient of determination r²", scope: "levels" },
  { id: "max-level-abs-error", label: "Max |level mean − level reference|", scope: "levels" },
  { id: "custom", label: "Custom formula", scope: "formula" },
] as const;
export type CalcKind = (typeof CALC_KINDS)[number]["id"];
export const CALC_KIND_IDS = CALC_KINDS.map(c => c.id) as [
  CalcKind,
  ...CalcKind[],
];

export const REFERENCE_TYPES = [
  { id: "pharmacopoeia", label: "Pharmacopoeia" },
  { id: "international-standard", label: "International Standard" },
  { id: "manufacturer-manual", label: "Manufacturer Manual" },
  { id: "manufacturer-specification", label: "Manufacturer Technical Specification" },
  { id: "calibration-certificate", label: "Calibration Certificate" },
  { id: "reference-material-certificate", label: "Reference Material Certificate" },
  { id: "internal-sop", label: "Internal SOP" },
  { id: "institutional-procedure", label: "Institutional Procedure" },
  { id: "regulatory-guidance", label: "Regulatory Guidance" },
  { id: "technical-publication", label: "Technical Publication" },
  { id: "validated-method", label: "Validated Method" },
  { id: "other", label: "Other Controlled Document" },
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number]["id"];
export const REFERENCE_TYPE_IDS = REFERENCE_TYPES.map(r => r.id) as [
  ReferenceType,
  ...ReferenceType[],
];
export const REFERENCE_VERIFICATION_STATUSES = [
  "pending-verification",
  "verified",
  "superseded",
  "withdrawn",
] as const;
export type ReferenceVerificationStatus =
  (typeof REFERENCE_VERIFICATION_STATUSES)[number];

export const INTERVAL_UNITS = ["days", "weeks", "months", "years", "event"] as const;
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];
export const INTERVAL_ACTIVITIES = [
  "External Calibration",
  "Internal Calibration",
  "Performance Verification",
  "PQ",
  "Requalification",
  "Periodic Review",
  "Reference Standard Verification",
  "Linearity Review",
] as const;

export const RISK_LEVELS = ["", "low", "medium", "high"] as const;
export const RISK_FACTORS = [
  { id: "productQualityImpact", label: "Product quality impact" },
  { id: "patientSafetyImpact", label: "Patient safety impact" },
  { id: "measurementCriticality", label: "Measurement criticality" },
  { id: "equipmentComplexity", label: "Equipment complexity" },
  { id: "failureProbability", label: "Failure probability" },
  { id: "historicalPerformance", label: "Historical performance" },
  { id: "maintenanceHistory", label: "Maintenance history" },
  { id: "intendedUseRisk", label: "Intended use" },
  { id: "regulatoryImpact", label: "Regulatory impact" },
] as const;

export const GAP_DECISIONS = [
  { id: "accept-with-restricted-claim", label: "Accept with restricted claim (no full compliance claim)" },
  { id: "additional-evidence-required", label: "Additional evidence required before approval" },
  { id: "equipment-not-suitable", label: "Equipment not suitable for the stated claim" },
  { id: "resolved-by-verified-source", label: "Resolved by a verified source" },
] as const;
export type GapDecision = (typeof GAP_DECISIONS)[number]["id"];
export const GAP_DECISION_IDS = GAP_DECISIONS.map(g => g.id) as [
  GapDecision,
  ...GapDecision[],
];

/* ------------------------------------------------------------------ */
/* Content schema (one immutable document per revision)                */
/* ------------------------------------------------------------------ */

const text = (max = 4000) => z.string().max(max).default("");
const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "Keys must start with a letter and contain only letters, digits, - or _");
const num = z.number().finite().nullable().default(null);

export const criterionSchema = z.object({
  key,
  parameter: text(120),
  requirement: text(1000),
  comparison: z.enum(COMPARISON_IDS).default("record-only"),
  lower: num,
  upper: num,
  target: num,
  tolerance: num,
  unit: text(40),
  levelKey: z.string().max(64).nullable().default(null),
  sourceClass: z.enum(SOURCE_CLASS_IDS),
  referenceId: z.string().max(64).nullable().default(null),
  referenceClause: text(300),
  justification: text(3000),
  verificationStatus: z.enum(VERIFICATION_STATUSES).default("pending-technical-verification"),
  verificationEvidence: text(2000),
  conflictNote: text(2000),
});
export type Criterion = z.infer<typeof criterionSchema>;

export const levelSchema = z.object({
  key,
  label: text(120),
  nominal: num,
  unit: text(40),
  referenceNote: text(500),
});
export type TestLevel = z.infer<typeof levelSchema>;

export const fieldSchema = z.object({
  key,
  label: text(200),
  type: z.enum(FIELD_TYPES).default("text"),
  unit: text(40),
  required: z.boolean().default(true),
  options: z.array(z.string().max(200)).max(50).default([]),
});
export type TestField = z.infer<typeof fieldSchema>;

export const calculationSchema = z.object({
  key,
  label: text(200),
  kind: z.enum(CALC_KIND_IDS),
  /** Custom formula (kind = custom). Variables: n, mean, sd, min, max, reference, field keys, earlier calculation keys. */
  formula: text(500),
  /** "test" = once over all readings; "per-level" = once per configured level. */
  scope: z.enum(["test", "per-level"]).default("test"),
  unit: text(40),
  decimals: z.number().int().min(0).max(10).nullable().default(null),
  significantFigures: z.number().int().min(1).max(15).nullable().default(null),
  formulaRevision: text(40),
  justification: text(1000),
});
export type Calculation = z.infer<typeof calculationSchema>;

export const testSchema = z.object({
  key,
  name: z.string().min(1).max(200),
  description: text(2000),
  objective: text(1000),
  category: text(120),
  stage: text(60),
  method: text(2000),
  procedure: text(6000),
  referenceIds: z.array(z.string().max(64)).max(30).default([]),
  referenceClause: text(300),
  requiredMaterials: text(1000),
  requiredInstruments: text(1000),
  requiredReferenceStandards: text(1000),
  parameter: text(200),
  unit: text(40),
  nominal: num,
  dataType: z.enum(DATA_TYPE_IDS).default("numeric"),
  readingsRequired: z.number().int().min(0).max(100).default(0),
  replicates: z.number().int().min(1).max(50).default(1),
  levels: z.array(levelSchema).max(30).default([]),
  conditions: text(1000),
  fields: z.array(fieldSchema).max(60).default([]),
  calculations: z.array(calculationSchema).max(30).default([]),
  criteria: z.array(criterionSchema).max(40).default([]),
  requiredEvidence: text(1000),
  attachmentsRequired: z.boolean().default(false),
  notes: text(2000),
  required: z.boolean().default(true),
  dependency: z
    .object({
      type: z.enum(["independent", "sequential", "conditional"]).default("independent"),
      testKey: z.string().max(64).nullable().default(null),
      note: text(500),
    })
    .default({ type: "independent", testKey: null, note: "" }),
});
export type ProtocolTest = z.infer<typeof testSchema>;

export const sectionSchema = z.object({
  key,
  title: z.string().min(1).max(200),
  description: text(2000),
  body: text(10000),
  required: z.boolean().default(true),
  stage: text(60),
  referenceIds: z.array(z.string().max(64)).max(30).default([]),
  attachments: text(1000),
  tests: z.array(testSchema).max(80).default([]),
});
export type ProtocolSection = z.infer<typeof sectionSchema>;

export const intervalSchema = z.object({
  key,
  activity: z.string().min(1).max(120),
  value: z.number().int().min(1).max(1200).nullable().default(null),
  unit: z.enum(INTERVAL_UNITS).default("months"),
  event: text(300),
  mandatory: z.boolean().default(false),
  sourceClass: z.enum(SOURCE_CLASS_IDS).default("institutional"),
  referenceId: z.string().max(64).nullable().default(null),
  riskBasis: text(1000),
  justification: text(2000),
  department: text(120),
  verificationStatus: z.enum(VERIFICATION_STATUSES).default("pending-technical-verification"),
});
export type ProtocolInterval = z.infer<typeof intervalSchema>;

export const gapSpecSchema = z.object({
  label: z.string().min(1).max(200),
  value: num,
  displayValue: text(120),
  sourceClass: z.enum(SOURCE_CLASS_IDS),
  referenceId: z.string().max(64).nullable().default(null),
  clause: text(300),
});
export const gapSchema = z.object({
  key,
  title: z.string().min(1).max(200),
  description: text(3000),
  testKey: z.string().max(64).nullable().default(null),
  specifications: z.array(gapSpecSchema).min(1).max(6),
  unit: text(40),
  /** Author's documented technical assessment. Reviewer decisions are separate immutable records. */
  assessment: text(4000),
  claimRestriction: text(1000),
});
export type TechnicalGap = z.infer<typeof gapSchema>;

export const equipmentLinkSchema = z.object({
  instrumentKey: z.string().min(1).max(64),
  instrumentId: text(64),
  serialNumber: text(128),
  manufacturer: text(255),
  model: text(128),
  compatibilityNote: text(1000),
});
export type EquipmentLink = z.infer<typeof equipmentLinkSchema>;

export const protocolContentSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_CONTENT_SCHEMA_VERSION).default(PROTOCOL_CONTENT_SCHEMA_VERSION),
  identification: z.object({
    title: z.string().min(3).max(255),
    number: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Protocol number may contain letters, digits, . _ / -"),
    description: text(2000),
    category: text(120),
    equipmentCategory: text(120),
    equipmentType: text(120),
    manufacturer: text(255),
    model: text(128),
    associationType: z.enum(["model", "equipment"]).default("model"),
    intendedUse: text(200),
    protocolType: z.enum(PROTOCOL_TYPE_IDS),
    department: text(200),
    applicableStandards: text(1000),
    applicableSops: text(1000),
    relatedForm: text(64),
  }),
  narrative: z
    .object({
      purpose: text(6000),
      scope: text(6000),
      responsibilities: text(6000),
      definitions: text(6000),
      abbreviations: text(4000),
      equipmentDescription: text(6000),
      intendedApplication: text(4000),
      requiredQualifications: text(4000),
      requiredMaterials: text(4000),
      requiredReferenceStandards: text(4000),
      environmentalConditions: text(4000),
      safetyRequirements: text(4000),
      deviationManagement: text(6000),
      finalAssessment: text(6000),
    })
    .prefault({}),
  stages: z.array(z.string().max(60)).max(12).default([]),
  risk: z
    .object({
      productQualityImpact: z.enum(RISK_LEVELS).default(""),
      patientSafetyImpact: z.enum(RISK_LEVELS).default(""),
      measurementCriticality: z.enum(RISK_LEVELS).default(""),
      equipmentComplexity: z.enum(RISK_LEVELS).default(""),
      failureProbability: z.enum(RISK_LEVELS).default(""),
      historicalPerformance: z.enum(RISK_LEVELS).default(""),
      maintenanceHistory: z.enum(RISK_LEVELS).default(""),
      intendedUseRisk: z.enum(RISK_LEVELS).default(""),
      regulatoryImpact: z.enum(RISK_LEVELS).default(""),
      overall: z.enum(RISK_LEVELS).default(""),
      justification: text(4000),
    })
    .prefault({}),
  equipmentLinks: z.array(equipmentLinkSchema).max(50).default([]),
  /** Protocol-level reference links (each must state what it supports). */
  references: z
    .array(
      z.object({
        referenceId: z.string().min(1).max(64),
        supports: z.string().min(1).max(500),
        clause: text(300),
      })
    )
    .max(60)
    .default([]),
  intervals: z.array(intervalSchema).max(20).default([]),
  sections: z.array(sectionSchema).max(40).default([]),
  gaps: z.array(gapSchema).max(30).default([]),
});
export type ProtocolContent = z.infer<typeof protocolContentSchema>;
export type ProtocolContentInput = z.input<typeof protocolContentSchema>;

export function parseProtocolContent(value: unknown): ProtocolContent {
  return protocolContentSchema.parse(value);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

export function allTests(content: Pick<ProtocolContent, "sections">) {
  return content.sections.flatMap(section =>
    section.tests.map(test => ({ section, test }))
  );
}

export function allCriteria(content: Pick<ProtocolContent, "sections">) {
  return allTests(content).flatMap(({ section, test }) =>
    test.criteria.map(criterion => ({ section, test, criterion }))
  );
}

/** Every reference id used anywhere in the content (protocol, sections, tests, criteria, intervals, gaps). */
export function collectReferenceIds(content: ProtocolContent): string[] {
  const ids = new Set<string>();
  content.references.forEach(r => ids.add(r.referenceId));
  content.intervals.forEach(i => i.referenceId && ids.add(i.referenceId));
  content.gaps.forEach(g => g.specifications.forEach(s => s.referenceId && ids.add(s.referenceId)));
  content.sections.forEach(section => {
    section.referenceIds.forEach(id => ids.add(id));
    section.tests.forEach(test => {
      test.referenceIds.forEach(id => ids.add(id));
      test.criteria.forEach(c => c.referenceId && ids.add(c.referenceId));
    });
  });
  return Array.from(ids).sort();
}

export function countPendingVerification(content: ProtocolContent) {
  return (
    allCriteria(content).filter(
      ({ criterion }) => criterion.verificationStatus !== "verified"
    ).length +
    content.intervals.filter(i => i.verificationStatus !== "verified").length
  );
}

/** Deterministic JSON (sorted keys) used for content hashing on both server and client. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function emptyProtocolContent(
  overrides: Partial<ProtocolContentInput["identification"]> = {}
): ProtocolContent {
  return parseProtocolContent({
    identification: {
      title: "New equipment protocol",
      number: "NEW-PROTOCOL",
      protocolType: "custom",
      ...overrides,
    },
    narrative: {},
    risk: {},
  });
}

export function addInterval(start: Date, value: number, unit: IntervalUnit) {
  if (unit === "event") return null;
  const date = new Date(start.getTime());
  if (unit === "days") date.setUTCDate(date.getUTCDate() + value);
  if (unit === "weeks") date.setUTCDate(date.getUTCDate() + value * 7);
  if (unit === "months") date.setUTCMonth(date.getUTCMonth() + value);
  if (unit === "years") date.setUTCFullYear(date.getUTCFullYear() + value);
  return date;
}
