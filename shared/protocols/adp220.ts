/**
 * FIRST CONFIGURED PROTOCOL — POL-QC-032D (Polarimeter ADP220).
 *
 * This is configuration data for the generic Protocol Builder, not a separate
 * software module. Rules applied (Master prompt §18):
 *  - every acceptance value keeps its source classification and is
 *    PENDING TECHNICAL VERIFICATION (nothing is pre-verified or approved);
 *  - no RSD, zero, linearity or R² limit is invented — where no verified
 *    numerical limit exists the limit is left empty and flagged;
 *  - no certificate value is invented — reference values are recorded at
 *    execution from the actual certificates;
 *  - the ±0.02° (manual) vs ±0.01° (USP <781>) accuracy gap is documented and
 *    requires a technical assessment and a reviewer decision;
 *  - intervals are institutional proposals, never presented as USP requirements.
 *
 * Reference ids are placeholders ("@KEY") remapped to Reference Library ids at seeding.
 */
import type { ProtocolContentInput, ReferenceType } from "./model";

export const ADP220_PROTOCOL_NUMBER = "POL-QC-032D";

export const ADP220_EXPECTED_EQUIPMENT = {
  instrumentKey: "polarimeter",
  instrumentId: "QC-I-029",
  serialNumber: "PE99003",
  manufacturerPattern: /bellingham\s*(\+|&|and)\s*stanley/i,
  model: "ADP220",
} as const;

export type SeedReference = {
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

export const ADP220_REFERENCES: SeedReference[] = [
  {
    placeholder: "@USP781",
    code: "USP-781",
    title: "USP General Chapter <781> Optical Rotation",
    issuer: "United States Pharmacopeia (USP)",
    referenceType: "pharmacopoeia",
    documentNumber: "<781>",
    edition: "",
    revision: "",
    publicationDate: "",
    sourceUrl: "https://doi.org/10.31003/USPNF_M99570_02_01",
    applicableSection: "",
    notes: "Initial reference framework for POL-QC-032D. Official edition, effective date and applicable requirements (including the ±0.01° accuracy capability and temperature requirements) must be verified against the current official USP–NF text before approval.",
  },
  {
    placeholder: "@USP1058",
    code: "USP-1058",
    title: "USP General Chapter <1058> Analytical Instrument Qualification",
    issuer: "United States Pharmacopeia (USP)",
    referenceType: "pharmacopoeia",
    documentNumber: "<1058>",
    edition: "",
    revision: "",
    publicationDate: "",
    sourceUrl: "https://doi.org/10.31003/USPNF_M1124_01_01",
    applicableSection: "",
    notes: "Qualification framework (DQ/IQ/OQ/PQ). Official edition and effective date must be verified before approval.",
  },
  {
    placeholder: "@MANUAL",
    code: "BS-36-102",
    title: "Bellingham + Stanley ADP220/ADS220 Operator's Manual",
    issuer: "Bellingham + Stanley Ltd",
    referenceType: "manufacturer-manual",
    documentNumber: "36-102",
    edition: "",
    revision: "Issue 3.1",
    publicationDate: "2004-02",
    sourceUrl: "",
    applicableSection: "",
    notes: "Code 36-102, Issue 3.1, February 2004. Specifications quoted in POL-QC-032D (589 nm, ±0.02° accuracy, 0.01° resolution) are from the previously reviewed manual and must be re-verified against the controlled copy, including whether this issue applies to the installed unit.",
  },
  {
    placeholder: "@CERTS",
    code: "POL-CERT-REGISTER",
    title: "Polarimeter reference material, quartz control plate, CRM and external calibration certificates",
    issuer: "Various (to be registered individually)",
    referenceType: "reference-material-certificate",
    documentNumber: "",
    edition: "",
    revision: "",
    publicationDate: "",
    sourceUrl: "",
    applicableSection: "",
    notes: "Placeholder register entry. Each certificate (quartz control plate, CRM, reference thermometer, external calibration) must be registered individually with its number, issuer and validity. NO certificate values have been entered — actual values must be taken from the verified documents.",
  },
];

const pending = "pending-technical-verification" as const;

const confirm = (key: string, label: string) => ({ key, label, type: "boolean" as const, required: true });
const textField = (key: string, label: string, required = true) => ({ key, label, type: "text" as const, required });
const passFail = (key: string, parameter: string, requirement: string, sourceClass: "pharmacopoeial" | "manufacturer" | "institutional", referenceId: string | null, justification = "") => ({
  key,
  parameter,
  requirement,
  comparison: "pass-fail" as const,
  sourceClass,
  referenceId,
  justification,
  verificationStatus: pending,
});

const checklistTest = (
  key: string,
  name: string,
  stage: string,
  objective: string,
  items: Array<{ key: string; label: string }>,
  extraFields: Array<ReturnType<typeof textField>>,
  sourceClass: "pharmacopoeial" | "manufacturer" | "institutional",
  referenceId: string | null,
  justification = ""
) => ({
  key,
  name,
  stage,
  objective,
  category: "Checklist",
  dataType: "checklist" as const,
  referenceIds: referenceId ? [referenceId] : [],
  fields: [...items.map(i => confirm(i.key, i.label)), ...extraFields],
  criteria: items.map((i, index) => passFail(`c${index + 1}`, i.key, i.label, sourceClass, referenceId, justification)),
  requiredEvidence: "Signed checklist; supporting records attached where applicable.",
});

const thermometerFields = [
  { key: "instrumentTemp", label: "Instrument temperature", type: "number" as const, unit: "°C", required: true },
  { key: "referenceTemp", label: "Reference thermometer temperature", type: "number" as const, unit: "°C", required: true },
  textField("thermometerId", "Reference thermometer ID"),
  textField("certificateNumber", "Thermometer calibration certificate number"),
  { key: "certificateValidUntil", label: "Certificate valid until", type: "date" as const, required: true },
  { key: "measurementDate", label: "Measurement date", type: "date" as const, required: true },
  textField("conditions", "Measurement conditions"),
];

export function adp220DraftContent(equipment: { manufacturer: string; model: string; instrumentId: string; serialNumber: string }): ProtocolContentInput {
  return {
    identification: {
      title: "Polarimeter Qualification and Performance Verification Protocol",
      number: ADP220_PROTOCOL_NUMBER,
      description: "Qualification (IQ/OQ/PQ) and periodic performance verification of the Bellingham + Stanley ADP220 automatic polarimeter. Configured with the generic Protocol Builder; first configured example of the centralized Protocol Management module.",
      category: "Equipment Qualification",
      equipmentCategory: "Analytical Instruments",
      equipmentType: "Polarimeter (automatic)",
      manufacturer: equipment.manufacturer,
      model: equipment.model,
      associationType: "equipment",
      intendedUse: "Both — Identification and Quantitative",
      protocolType: "IQ-OQ-PQ",
      department: "Quality Control Laboratory",
      applicableStandards: "USP <781> Optical Rotation; USP <1058> Analytical Instrument Qualification (editions PENDING TECHNICAL VERIFICATION)",
      applicableSops: "QC-032D",
      relatedForm: "QC-032B-01",
    },
    narrative: {
      purpose: "To define the qualification and performance verification of the ADP220 polarimeter so that it is demonstrated, with documented evidence, to be suitable for its intended use (identification and quantitative optical rotation measurements).",
      scope: `Applies to polarimeter ${equipment.instrumentId} (S/N ${equipment.serialNumber}), ${equipment.manufacturer} ${equipment.model}, installed in the Quality Control Laboratory. Covers IQ, OQ and PQ. It does not establish compliance with any pharmacopoeial chapter by itself; applicability of every requirement is subject to technical verification.`,
      responsibilities: "Protocol Author: prepares and maintains the protocol draft.\nTechnical Specialist: verifies methods, references, acceptance criteria and calculations; records gap decisions.\nQuality Assurance: final review and approval.\nDocument Control: controlled release.\nCalibration/Validation personnel: execute only the released revision.",
      definitions: "Optical rotation: angle through which the plane of polarized light is rotated by an optically active substance.\nQuartz control plate: certified optical rotation standard.",
      abbreviations: "IQ – Installation Qualification; OQ – Operational Qualification; PQ – Performance Qualification; CRM – Certified Reference Material; SD – standard deviation; RSD – relative standard deviation.",
      equipmentDescription: `Automatic polarimeter ${equipment.manufacturer} ${equipment.model}. Nominal wavelength 589 nm and angular resolution 0.01° per the reviewed manufacturer manual (PENDING TECHNICAL VERIFICATION).`,
      intendedApplication: "Identification and quantitative determinations based on optical rotation / specific rotation.",
      requiredQualifications: "Personnel trained on the ADP220 operating procedure and on this protocol.",
      requiredMaterials: "Certified quartz control plate(s) and/or CRMs with valid certificates; polarimeter tube(s); blank solvent; traceable reference thermometer with valid calibration certificate.",
      requiredReferenceStandards: "Certificate values must be taken from the verified certificates at execution. No certificate values are stored in this draft.",
      environmentalConditions: "Per manufacturer's operating conditions (manual 36-102 — PENDING TECHNICAL VERIFICATION). Record ambient temperature and humidity at execution.",
      safetyRequirements: "Follow laboratory electrical and chemical safety rules; handle quartz plates and tubes per manufacturer instructions.",
      deviationManagement: "Any failure, incomplete result or departure from this protocol is recorded as a deviation and handled through the laboratory's deviation/CAPA procedure. Failed results are never overwritten; retests are linked to the original record.",
      finalAssessment: "The final assessment is made by the technical specialist and approved by QA. Calculated PASS outcomes are not approvals. No statement of full USP <781> compliance may be made while the accuracy compatibility gap is unresolved.",
    },
    stages: ["IQ", "OQ", "PQ"],
    risk: {
      measurementCriticality: "high",
      intendedUseRisk: "high",
      productQualityImpact: "high",
      overall: "",
      justification: "",
    },
    equipmentLinks: [
      {
        instrumentKey: "polarimeter",
        instrumentId: equipment.instrumentId,
        serialNumber: equipment.serialNumber,
        manufacturer: equipment.manufacturer,
        model: equipment.model,
        compatibilityNote: "Linked to the existing registered equipment record (no duplicate created). Manufacturer, model, ID and serial verified against the Equipment Library at configuration time.",
      },
    ],
    references: [
      { referenceId: "@USP781", supports: "Optical rotation measurement requirements: accuracy capability, wavelength and temperature conditions (PQ accuracy, OQ temperature tests)", clause: "" },
      { referenceId: "@USP1058", supports: "Qualification framework and stage structure (IQ/OQ/PQ)", clause: "" },
      { referenceId: "@MANUAL", supports: "Manufacturer specifications (589 nm, ±0.02° accuracy, 0.01° resolution), installation, operation and zero procedure", clause: "" },
      { referenceId: "@CERTS", supports: "Reference values for accuracy, linearity and temperature verification (entered at execution from verified certificates)", clause: "" },
    ],
    intervals: [
      { key: "pq", activity: "PQ", value: 6, unit: "months", mandatory: false, sourceClass: "risk-based-proposal", riskBasis: "High measurement criticality (identification and quantitative use).", justification: "Initial institutional risk-based proposal (POL-QC-032D draft). Not a USP requirement. Requires documented risk-based review and approval.", department: "Quality Control", verificationStatus: pending },
      { key: "external-calibration", activity: "External Calibration", value: 12, unit: "months", mandatory: false, sourceClass: "institutional", justification: "Initial institutional proposal. Not a USP requirement. Requires documented review and approval.", department: "Quality Control", verificationStatus: pending },
      { key: "linearity-review", activity: "Linearity Review", value: 12, unit: "months", event: "or after any significant change (repair, lamp/optics replacement, relocation)", mandatory: false, sourceClass: "institutional", justification: "Initial institutional proposal. Not a USP requirement. Requires documented review and approval.", department: "Quality Control", verificationStatus: pending },
    ],
    sections: [
      {
        key: "iq",
        title: "Installation Qualification (IQ)",
        stage: "IQ",
        description: "Documented verification that the ADP220 is delivered and installed as specified.",
        referenceIds: ["@USP1058", "@MANUAL"],
        tests: [
          checklistTest("iq-identification", "Equipment Identification", "IQ", "Confirm the instrument is the registered equipment item.", [{ key: "idMatches", label: `Equipment ID label reads ${equipment.instrumentId} and matches the equipment register` }], [textField("idObserved", "Equipment ID as observed")], "institutional", "@USP1058", "Identification against the laboratory's own equipment register (institutional requirement)."),
          checklistTest("iq-manufacturer-model", "Manufacturer and Model Verification", "IQ", "Confirm manufacturer and model.", [{ key: "mfgModelMatch", label: `Manufacturer ${equipment.manufacturer} and model ${equipment.model} confirmed on rating plate` }], [textField("manufacturerObserved", "Manufacturer as observed"), textField("modelObserved", "Model as observed")], "institutional", "@USP1058", "Verification against purchase/register records (institutional requirement)."),
          checklistTest("iq-serial", "Serial Number Verification", "IQ", "Confirm the serial number.", [{ key: "serialMatch", label: `Serial number ${equipment.serialNumber} confirmed on rating plate` }], [textField("serialObserved", "Serial number as observed")], "institutional", "@USP1058", "Verification against the equipment register (institutional requirement)."),
          checklistTest("iq-installation", "Installation Conditions", "IQ", "Confirm installation per manufacturer instructions.", [{ key: "installedPerManual", label: "Installed according to the manufacturer's installation instructions (bench, ventilation, clearance)" }], [textField("location", "Installation location")], "manufacturer", "@MANUAL"),
          {
            ...checklistTest("iq-environment", "Environmental Conditions", "IQ", "Record ambient conditions and confirm they are within the manufacturer's stated operating conditions.", [{ key: "envWithinSpec", label: "Ambient conditions within manufacturer's stated operating range (range PENDING TECHNICAL VERIFICATION from manual)" }], [], "manufacturer", "@MANUAL"),
            fields: [
              confirm("envWithinSpec", "Ambient conditions within manufacturer's stated operating range"),
              { key: "ambientTemp", label: "Ambient temperature", type: "number" as const, unit: "°C", required: true },
              { key: "humidity", label: "Relative humidity", type: "number" as const, unit: "%RH", required: false },
            ],
          },
          checklistTest("iq-accessories", "Required Accessories", "IQ", "Confirm required accessories are present.", [{ key: "accessoriesPresent", label: "Accessories present per manufacturer's packing list (tubes, power cord, manual, interface cable as applicable)" }], [textField("accessoriesList", "Accessories found")], "manufacturer", "@MANUAL"),
          checklistTest("iq-documentation", "Documentation Verification", "IQ", "Confirm required documentation is available.", [{ key: "manualAvailable", label: "Operator's manual (code 36-102) available as a controlled copy" }, { key: "certificatesAvailable", label: "Valid certificates for reference standards available" }], [], "institutional", "@USP1058", "Documentation requirements for qualification records (institutional requirement)."),
          checklistTest("iq-power", "Power Supply Verification", "IQ", "Confirm the supply matches the instrument rating.", [{ key: "powerMatches", label: "Mains supply matches the rating on the instrument plate" }], [textField("supplyObserved", "Supply voltage / frequency observed")], "manufacturer", "@MANUAL"),
          checklistTest("iq-records", "Installation Records", "IQ", "Confirm installation records are completed.", [{ key: "recordsComplete", label: "Installation record completed, signed and filed" }], [], "institutional", "@USP1058", "Record keeping (institutional requirement)."),
        ],
      },
      {
        key: "oq",
        title: "Operational Qualification (OQ)",
        stage: "OQ",
        description: "Documented verification that the ADP220 operates as intended across its operating functions.",
        referenceIds: ["@USP1058", "@MANUAL", "@USP781"],
        tests: [
          checklistTest("oq-power-on", "Power-On and Startup", "OQ", "Confirm startup completes normally.", [{ key: "startupOk", label: "Power-on self-test / startup completes without error messages" }], [], "manufacturer", "@MANUAL"),
          {
            ...checklistTest("oq-display", "Display and Controls", "OQ", "Confirm display and keypad operate; confirm display resolution.", [{ key: "displayOk", label: "Display legible and all keys respond" }, { key: "resolutionOk", label: "Angular display resolution 0.01° (manufacturer manual — PENDING TECHNICAL VERIFICATION)" }], [], "manufacturer", "@MANUAL"),
          },
          checklistTest("oq-modes", "Measurement Modes", "OQ", "Confirm measurement modes needed for the intended use operate.", [{ key: "modesOk", label: "Measurement modes required for intended use (optical rotation and any derived modes used) operate" }], [textField("modesVerified", "Modes verified")], "manufacturer", "@MANUAL"),
          {
            key: "oq-zero",
            name: "Zero Verification",
            stage: "OQ",
            objective: "Verify the zero according to the manufacturer's instructions.",
            category: "Measurement",
            dataType: "numeric" as const,
            parameter: "Optical rotation (blank)",
            unit: "°",
            readingsRequired: 3,
            procedure: "Perform zero per manufacturer's instructions with empty/blank tube; record readings.",
            referenceIds: ["@MANUAL"],
            calculations: [{ key: "mean", label: "Mean zero reading", kind: "mean" as const, unit: "°", decimals: 3, formulaRevision: "1" }],
            criteria: [
              { key: "c1", parameter: "mean", requirement: "Zero reading within the manufacturer's stated zero tolerance. No numerical tolerance has been verified — limit intentionally left empty.", comparison: "abs<=" as const, unit: "°", sourceClass: "manufacturer" as const, referenceId: "@MANUAL", justification: "", verificationStatus: pending },
            ],
            notes: "Number of readings (3) is an initial proposed design — PENDING TECHNICAL VERIFICATION.",
          },
          checklistTest("oq-wavelength", "Wavelength Verification", "OQ", "Confirm the measurement wavelength.", [{ key: "wavelength589", label: "Instrument operating wavelength is 589 nm (manufacturer documentation — PENDING TECHNICAL VERIFICATION)" }], [], "manufacturer", "@MANUAL"),
          {
            key: "oq-temp-indication",
            name: "Temperature Indication",
            stage: "OQ",
            objective: "Compare the instrument temperature indication with a traceable reference thermometer.",
            category: "Temperature",
            dataType: "calculated" as const,
            unit: "°C",
            referenceIds: ["@USP781"],
            fields: thermometerFields,
            calculations: [{ key: "difference", label: "Difference (instrument − reference)", kind: "custom" as const, formula: "instrumentTemp - referenceTemp", unit: "°C", decimals: 2, formulaRevision: "1" }],
            criteria: [
              { key: "c1", parameter: "difference", requirement: "Temperature indication within ±0.1 °C or better, subject to applicable requirements.", comparison: "abs<=" as const, tolerance: 0.1, unit: "°C", sourceClass: "pharmacopoeial" as const, referenceId: "@USP781", justification: "", verificationStatus: pending },
            ],
          },
          {
            key: "oq-temp-control",
            name: "Temperature Control",
            stage: "OQ",
            objective: "Verify the sample temperature is controlled at the reference temperature.",
            category: "Temperature",
            dataType: "series" as const,
            parameter: "Controlled temperature (reference thermometer)",
            unit: "°C",
            nominal: 25,
            readingsRequired: 5,
            referenceIds: ["@USP781"],
            conditions: "Set point 25 °C where applicable (pharmacopoeial conditions — PENDING TECHNICAL VERIFICATION).",
            fields: [textField("thermometerId", "Reference thermometer ID"), textField("certificateNumber", "Thermometer certificate number")],
            calculations: [
              { key: "mean", label: "Mean temperature", kind: "mean" as const, unit: "°C", decimals: 2, formulaRevision: "1" },
              { key: "maxDeviation", label: "Max deviation from set point", kind: "max-abs-deviation" as const, unit: "°C", decimals: 2, formulaRevision: "1" },
            ],
            criteria: [
              { key: "c1", parameter: "maxDeviation", requirement: "Temperature control within ±0.5 °C of the reference temperature, subject to applicable requirements.", comparison: "abs<=" as const, tolerance: 0.5, unit: "°C", sourceClass: "pharmacopoeial" as const, referenceId: "@USP781", justification: "", verificationStatus: pending },
            ],
            notes: "Number of readings (5) is an initial proposed design — PENDING TECHNICAL VERIFICATION.",
          },
          checklistTest("oq-data-output", "Data Output", "OQ", "Confirm data output functions (as fitted).", [{ key: "dataOutputOk", label: "Data output interface transmits results correctly (if used)" }], [], "manufacturer", "@MANUAL"),
          checklistTest("oq-print", "Print Output", "OQ", "Confirm print output (as fitted).", [{ key: "printOk", label: "Printed output is complete and legible (if used)" }], [], "manufacturer", "@MANUAL"),
          checklistTest("oq-functions", "Operational Functions", "OQ", "Confirm other operational functions used in routine work.", [{ key: "functionsOk", label: "Operational functions used in routine work operate per manual" }], [textField("functionsVerified", "Functions verified")], "manufacturer", "@MANUAL"),
        ],
      },
      {
        key: "pq",
        title: "Performance Qualification (PQ)",
        stage: "PQ",
        description: "Documented verification that the ADP220 performs consistently for its intended use.",
        referenceIds: ["@USP781", "@CERTS"],
        tests: [
          {
            key: "pq-accuracy",
            name: "Accuracy of Optical Rotation",
            stage: "PQ",
            objective: "Compare the measured optical rotation of a certified quartz control plate / CRM with its certified value.",
            category: "Measurement",
            dataType: "reference-comparison" as const,
            parameter: "Optical rotation",
            unit: "°",
            readingsRequired: 3,
            referenceIds: ["@USP781", "@MANUAL", "@CERTS"],
            requiredReferenceStandards: "Certified quartz control plate or CRM with valid certificate. Certified value entered at execution from the certificate.",
            fields: [textField("standardId", "Reference standard ID"), textField("certificateNumber", "Certificate number"), { key: "certificateValidUntil", label: "Certificate valid until", type: "date" as const, required: true }],
            calculations: [
              { key: "mean", label: "Mean reading", kind: "mean" as const, unit: "°", decimals: 3, formulaRevision: "1" },
              { key: "error", label: "Error (mean − certified value)", kind: "error" as const, unit: "°", decimals: 3, formulaRevision: "1" },
            ],
            criteria: [
              { key: "c-manufacturer", parameter: "error", requirement: "ADP220 angular accuracy ±0.02° (reviewed manufacturer manual).", comparison: "abs<=" as const, tolerance: 0.02, unit: "°", sourceClass: "manufacturer" as const, referenceId: "@MANUAL", justification: "", verificationStatus: pending, conflictNote: "CONFLICT with USP <781> ±0.01° — see technical gap 'accuracy-usp781'." },
              { key: "c-usp781", parameter: "error", requirement: "Accuracy capability ±0.01° or better (previously reviewed USP <781> requirement).", comparison: "abs<=" as const, tolerance: 0.01, unit: "°", sourceClass: "pharmacopoeial" as const, referenceId: "@USP781", justification: "", verificationStatus: pending, conflictNote: "CONFLICT with manufacturer ±0.02° — see technical gap 'accuracy-usp781'." },
            ],
            notes: "Reference value is taken from the certificate at execution (no certificate value stored). Number of readings (3) is an initial proposed design — PENDING TECHNICAL VERIFICATION.",
          },
          {
            key: "pq-repeatability",
            name: "Repeatability",
            stage: "PQ",
            objective: "Assess the precision of replicate measurements of the same standard.",
            category: "Measurement",
            dataType: "series" as const,
            parameter: "Optical rotation",
            unit: "°",
            readingsRequired: 5,
            referenceIds: ["@USP781"],
            fields: [textField("standardId", "Standard / sample ID")],
            calculations: [
              { key: "mean", label: "Mean", kind: "mean" as const, unit: "°", decimals: 3, formulaRevision: "1" },
              { key: "sd", label: "Standard deviation", kind: "sd" as const, unit: "°", decimals: 4, formulaRevision: "1" },
              { key: "rsd", label: "RSD", kind: "rsd" as const, unit: "%", decimals: 2, formulaRevision: "1" },
            ],
            criteria: [
              { key: "c1", parameter: "rsd", requirement: "Repeatability limit — no verified numerical limit available. Must be based on a verified applicable source or an approved institutional justification.", comparison: "<=" as const, unit: "%", sourceClass: "institutional" as const, referenceId: null, justification: "No verified numerical RSD limit exists for this instrument in the reviewed references. The limit is intentionally left empty and must be established by the technical specialist before approval.", verificationStatus: pending },
            ],
            notes: "At least five replicate readings — initial proposed test design.",
          },
          {
            key: "pq-linearity",
            name: "Linearity",
            stage: "PQ",
            objective: "Verify the response over the working range (quantitative use).",
            category: "Measurement",
            dataType: "multi-level" as const,
            parameter: "Optical rotation",
            unit: "°",
            readingsRequired: 3,
            levels: [
              { key: "L1", label: "Level 1 (low)", unit: "°", referenceNote: "Certified value entered at execution" },
              { key: "L2", label: "Level 2 (mid)", unit: "°", referenceNote: "Certified value entered at execution" },
              { key: "L3", label: "Level 3 (high)", unit: "°", referenceNote: "Certified value entered at execution" },
            ],
            referenceIds: ["@USP781", "@CERTS"],
            calculations: [
              { key: "levelError", label: "Level error (mean − reference)", kind: "error" as const, scope: "per-level" as const, unit: "°", decimals: 3, formulaRevision: "1" },
              { key: "slope", label: "Slope", kind: "linearity-slope" as const, unit: "", decimals: 4, formulaRevision: "1" },
              { key: "intercept", label: "Intercept", kind: "linearity-intercept" as const, unit: "°", decimals: 4, formulaRevision: "1" },
              { key: "r2", label: "r²", kind: "linearity-r2" as const, unit: "", decimals: 5, formulaRevision: "1" },
              { key: "maxError", label: "Max level error", kind: "max-level-abs-error" as const, unit: "°", decimals: 3, formulaRevision: "1" },
            ],
            criteria: [
              { key: "c1", parameter: "maxError", requirement: "Maximum level error — limit not established (relates to the accuracy compatibility gap).", comparison: "abs<=" as const, unit: "°", sourceClass: "institutional" as const, referenceId: null, justification: "No verified numerical linearity limit. To be established from verified sources / approved institutional justification.", verificationStatus: pending },
              { key: "c2", parameter: "r2", requirement: "r² recorded for information. No universal R² limit is imposed without a verified applicable source.", comparison: "record-only" as const, sourceClass: "institutional" as const, referenceId: null, justification: "Recorded only — no verified source for an R² limit.", verificationStatus: pending },
            ],
            notes: "Three or more levels; readings per level is an initial proposed design. Reference values are recorded from certificates at execution.",
          },
          {
            key: "pq-temperature",
            name: "Temperature Performance",
            stage: "PQ",
            objective: "Verify sample temperature during measurement against a traceable reference thermometer.",
            category: "Temperature",
            dataType: "calculated" as const,
            unit: "°C",
            referenceIds: ["@USP781", "@CERTS"],
            fields: thermometerFields,
            calculations: [{ key: "difference", label: "Difference (instrument − reference)", kind: "custom" as const, formula: "instrumentTemp - referenceTemp", unit: "°C", decimals: 2, formulaRevision: "1" }],
            criteria: [
              { key: "c1", parameter: "difference", requirement: "Temperature within ±0.5 °C of the reference temperature during measurement, subject to applicable requirements.", comparison: "abs<=" as const, tolerance: 0.5, unit: "°C", sourceClass: "pharmacopoeial" as const, referenceId: "@USP781", justification: "", verificationStatus: pending },
            ],
          },
          {
            key: "pq-zero",
            name: "Zero Verification (PQ)",
            stage: "PQ",
            objective: "Verify zero at the time of PQ per manufacturer's instructions.",
            category: "Measurement",
            dataType: "numeric" as const,
            unit: "°",
            readingsRequired: 3,
            referenceIds: ["@MANUAL"],
            calculations: [{ key: "mean", label: "Mean zero reading", kind: "mean" as const, unit: "°", decimals: 3, formulaRevision: "1" }],
            criteria: [
              { key: "c1", parameter: "mean", requirement: "Zero within the manufacturer's stated tolerance — no numerical tolerance verified; limit intentionally left empty.", comparison: "abs<=" as const, unit: "°", sourceClass: "manufacturer" as const, referenceId: "@MANUAL", justification: "", verificationStatus: pending },
            ],
          },
          {
            key: "pq-intended-use",
            name: "Measurement Performance Under Intended Conditions",
            stage: "PQ",
            objective: "Record performance on a representative measurement under routine conditions.",
            category: "Observation",
            dataType: "text" as const,
            referenceIds: ["@USP1058"],
            fields: [textField("sample", "Sample / standard measured"), textField("result", "Observed result"), textField("conditions", "Conditions (temperature, tube length, wavelength)")],
            criteria: [
              { key: "c1", parameter: "result", requirement: "Result recorded and assessed by the technical specialist against the applicable monograph/method.", comparison: "record-only" as const, sourceClass: "institutional" as const, referenceId: "@USP1058", justification: "Assessment against the applicable method by the technical specialist.", verificationStatus: pending },
            ],
          },
        ],
      },
    ],
    gaps: [
      {
        key: "accuracy-usp781",
        title: "Angular accuracy: manufacturer ±0.02° vs USP <781> ±0.01°",
        description: "The reviewed ADP220 manual specifies angular accuracy of ±0.02°. The previously reviewed USP <781> requirement indicates an accuracy capability of ±0.01° or better. The manufacturer specification is wider than the pharmacopoeial requirement by 0.01°. A documented technical assessment and a technical reviewer decision are required. Full USP <781> compliance must not be claimed unless the assessment and applicable requirements support it.",
        testKey: "pq-accuracy",
        unit: "°",
        specifications: [
          { label: "ADP220 manufacturer specification", value: 0.02, displayValue: "±0.02°", sourceClass: "manufacturer", referenceId: "@MANUAL", clause: "" },
          { label: "USP <781> accuracy capability", value: 0.01, displayValue: "±0.01° or better", sourceClass: "pharmacopoeial", referenceId: "@USP781", clause: "" },
        ],
        assessment: "",
        claimRestriction: "No claim of full USP <781> compliance may be made for this instrument until the gap is assessed and a reviewer decision supports it.",
      },
    ],
  };
}

/** Replace "@KEY" placeholders with Reference Library ids. */
export function remapReferencePlaceholders<T>(value: T, map: Record<string, string>): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "string" && v.startsWith("@") && map[v] ? map[v] : v))
  ) as T;
}
