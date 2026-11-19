/**
 * Universal protocol templates (Master prompt §23).
 * Templates are starting STRUCTURES only: they suggest sections, tests, data
 * fields, measurement structures and calculations. They never carry numeric
 * acceptance limits, and every suggested criterion is PENDING TECHNICAL
 * VERIFICATION with no source, so a template can never be submitted unchanged.
 */
import type { ProtocolContent, ProtocolContentInput, ProtocolTypeId } from "./model";
import { parseProtocolContent } from "./model";

export type BuiltinTemplate = {
  id: string;
  name: string;
  templateCategory: string;
  protocolType: ProtocolTypeId;
  description: string;
  structure: Omit<ProtocolContentInput, "identification">;
};

const check = (key: string, name: string, stage: string, items: string[]) => ({
  key,
  name,
  stage,
  dataType: "checklist" as const,
  fields: items.map((label, i) => ({ key: `item${i + 1}`, label, type: "boolean" as const })),
  criteria: items.map((label, i) => ({ key: `c${i + 1}`, parameter: `item${i + 1}`, requirement: label, comparison: "pass-fail" as const, sourceClass: "manufacturer" as const, verificationStatus: "pending-technical-verification" as const })),
});
const repeatability = (key: string, stage: string) => ({
  key,
  name: "Repeatability",
  stage,
  dataType: "series" as const,
  readingsRequired: 6,
  calculations: [
    { key: "mean", label: "Mean", kind: "mean" as const },
    { key: "sd", label: "SD", kind: "sd" as const },
    { key: "rsd", label: "RSD", kind: "rsd" as const, unit: "%" },
  ],
  notes: "Reading count is a suggestion — set per verified method. Acceptance limit must be added from a verified source.",
});
const accuracy = (key: string, stage: string) => ({
  key,
  name: "Accuracy against certified reference",
  stage,
  dataType: "reference-comparison" as const,
  readingsRequired: 3,
  fields: [{ key: "standardId", label: "Reference standard ID", type: "text" as const }, { key: "certificateNumber", label: "Certificate number", type: "text" as const }],
  calculations: [
    { key: "mean", label: "Mean", kind: "mean" as const },
    { key: "error", label: "Error (mean − reference)", kind: "error" as const },
  ],
});
const linearity = (key: string, stage: string) => ({
  key,
  name: "Linearity",
  stage,
  dataType: "multi-level" as const,
  readingsRequired: 3,
  levels: [{ key: "L1", label: "Level 1" }, { key: "L2", label: "Level 2" }, { key: "L3", label: "Level 3" }],
  calculations: [
    { key: "levelError", label: "Level error", kind: "error" as const, scope: "per-level" as const },
    { key: "slope", label: "Slope", kind: "linearity-slope" as const },
    { key: "intercept", label: "Intercept", kind: "linearity-intercept" as const },
    { key: "r2", label: "r²", kind: "linearity-r2" as const },
  ],
});
const iq = (stage = "IQ") => ({
  key: "iq",
  title: "Installation Qualification (IQ)",
  stage,
  tests: [
    check("iq-identity", "Equipment identification", stage, ["Equipment ID matches register", "Manufacturer and model confirmed", "Serial number confirmed"]),
    check("iq-docs", "Documentation verification", stage, ["Manual available", "Certificates available"]),
    check("iq-utilities", "Utilities and environment", stage, ["Power supply matches rating", "Environmental conditions within manufacturer's range"]),
  ],
});
const oq = (stage = "OQ") => ({
  key: "oq",
  title: "Operational Qualification (OQ)",
  stage,
  tests: [check("oq-functions", "Operational functions", stage, ["Startup completes without error", "Display and controls operate", "Alarms / interlocks operate (if fitted)"])],
});
const narrative = {
  purpose: "",
  scope: "",
  deviationManagement: "Failures and departures are recorded as deviations and handled through the deviation/CAPA procedure.",
};

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { id: "tpl-analytical", name: "Analytical instrument — IQ/OQ/PQ", templateCategory: "Analytical Instruments", protocolType: "IQ-OQ-PQ", description: "IQ checklists, OQ functions, PQ accuracy / repeatability / linearity structures.", structure: { narrative, stages: ["IQ", "OQ", "PQ"], sections: [iq(), oq(), { key: "pq", title: "Performance Qualification (PQ)", stage: "PQ", tests: [accuracy("pq-accuracy", "PQ"), repeatability("pq-repeatability", "PQ"), linearity("pq-linearity", "PQ")] }] } },
  { id: "tpl-physical", name: "Physical testing equipment — calibration", templateCategory: "Physical Testing Equipment", protocolType: "calibration", description: "Identification checks and multi-point calibration against certified standards.", structure: { narrative, stages: ["Calibration"], sections: [{ key: "cal", title: "Calibration", stage: "Calibration", tests: [check("cal-identity", "Identification", "Calibration", ["Equipment ID matches register"]), linearity("cal-points", "Calibration")] }] } },
  { id: "tpl-temperature", name: "Temperature monitoring equipment — verification", templateCategory: "Temperature Monitoring Equipment", protocolType: "performance-verification", description: "Comparison against a traceable reference thermometer at configured points.", structure: { narrative, stages: ["Performance Verification"], sections: [{ key: "pv", title: "Temperature verification", stage: "Performance Verification", tests: [{ key: "pv-points", name: "Indication vs reference thermometer", stage: "Performance Verification", dataType: "multi-level" as const, readingsRequired: 3, levels: [{ key: "T1", label: "Point 1" }, { key: "T2", label: "Point 2" }], fields: [{ key: "thermometerId", label: "Reference thermometer ID", type: "text" as const }, { key: "certificateNumber", label: "Certificate number", type: "text" as const }], calculations: [{ key: "pointError", label: "Error per point", kind: "error" as const, scope: "per-level" as const, unit: "°C" }] }] }] } },
  { id: "tpl-measuring", name: "Measuring instrument — calibration", templateCategory: "Measuring Instruments", protocolType: "calibration", description: "Repeatability and accuracy structures for balances, pipettes, gauges.", structure: { narrative, stages: ["Calibration"], sections: [{ key: "cal", title: "Calibration", stage: "Calibration", tests: [accuracy("cal-accuracy", "Calibration"), repeatability("cal-repeatability", "Calibration")] }] } },
  { id: "tpl-utility", name: "Laboratory utility equipment — IQ/OQ", templateCategory: "Laboratory Utility Equipment", protocolType: "IQ-OQ-PQ", description: "Installation and operational checks.", structure: { narrative, stages: ["IQ", "OQ"], sections: [iq(), oq()] } },
  { id: "tpl-production", name: "Production equipment — IQ/OQ/PQ", templateCategory: "Production Equipment", protocolType: "IQ-OQ-PQ", description: "Installation, operation and performance checks (structure only).", structure: { narrative, stages: ["IQ", "OQ", "PQ"], sections: [iq(), oq(), { key: "pq", title: "Performance Qualification (PQ)", stage: "PQ", tests: [{ key: "pq-run", name: "Performance run observations", stage: "PQ", dataType: "text" as const, fields: [{ key: "observation", label: "Observation", type: "text" as const }] }] }] } },
  { id: "tpl-csv", name: "Computerized system — validation", templateCategory: "Computerized Systems", protocolType: "csv", description: "Access control, audit trail and data integrity checks.", structure: { narrative, stages: ["IQ", "OQ"], sections: [{ key: "csv", title: "Computerized system checks", stage: "OQ", tests: [check("csv-access", "Access control", "OQ", ["Unique user accounts", "Role permissions enforced"]), check("csv-audit", "Audit trail", "OQ", ["Audit trail records who/what/when/why", "Audit trail cannot be edited"])] }] } },
  { id: "tpl-custom", name: "Custom (empty structure)", templateCategory: "Custom Equipment Categories", protocolType: "custom", description: "Start from an empty structure.", structure: { narrative, stages: [], sections: [] } },
];

/** Removes every numeric acceptance limit and verification claim (templates carry structure only). */
export function stripToStructure(content: ProtocolContent): Omit<ProtocolContent, "identification"> {
  const { identification: _ignored, ...rest } = content;
  const copy = JSON.parse(JSON.stringify(rest)) as Omit<ProtocolContent, "identification">;
  copy.sections.forEach(section =>
    section.tests.forEach(test => {
      test.nominal = null;
      test.levels.forEach(l => (l.nominal = null));
      test.criteria.forEach(c => {
        c.lower = c.upper = c.target = c.tolerance = null;
        c.verificationStatus = "pending-technical-verification";
        c.verificationEvidence = "";
        c.referenceId = null;
        c.justification = "";
      });
    })
  );
  copy.intervals = [];
  copy.gaps = [];
  copy.equipmentLinks = [];
  copy.references = [];
  return copy;
}

export function contentFromTemplate(structure: unknown, identification: ProtocolContentInput["identification"]): ProtocolContent {
  const base = parseProtocolContent({ ...(structure as object), identification });
  // Defence in depth: even stored templates are stripped of limits when instantiated.
  return parseProtocolContent({ ...stripToStructure(base), identification: base.identification });
}
