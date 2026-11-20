/**
 * Canonical nine-step calibration-run workflow — ONE workflow for every device.
 *
 * The application's controlled validation workflow always shows the same nine
 * steps, in the same order, for all eight protocols:
 *
 *   1. Equipment Selection
 *   2. Protocol
 *   3. Accuracy
 *   4. Repeatability
 *   5. Linearity
 *   6. Results
 *   7. Review
 *   8. Approval
 *   9. PDF
 *
 * The protocol still decides WHICH tests are performed. Its device-specific
 * tests are mapped into Accuracy / Repeatability / Linearity by their
 * controlled name, and every remaining test is preserved unchanged in the
 * Results step as a clearly labelled sub-test. No test, field, formula,
 * criterion or acceptance limit is deleted, renamed destructively or changed.
 *
 * Safety properties preserved from the previous implementation:
 *  - equipment and protocol snapshots are immutable;
 *  - every save is versioned and draft conflicts keep BOTH copies;
 *  - verification / completeness / failure blockers stop formal recording and
 *    approval (draft saving always remains available);
 *  - a test step that is not applicable requires a written justification and a
 *    recorded confirmation — it is never silently skipped.
 */
import type { ExecutionEvaluation, Measurements, TestMeasurement } from "./evaluate";
import { allTests, type ProtocolContent, type ProtocolTest } from "./model";

/* ------------------------------------------------------------------ */
/* Canonical nine-step definition                                      */
/* ------------------------------------------------------------------ */

export const CANONICAL_STEP_KEYS = [
  "equipment",
  "protocol",
  "accuracy",
  "repeatability",
  "linearity",
  "results",
  "review",
  "approval",
  "pdf",
] as const;

export type CanonicalStepKey = (typeof CANONICAL_STEP_KEYS)[number];

/** Exact step numbers and labels required by the controlled validation workflow. */
export const CANONICAL_STEP_LABELS: Record<CanonicalStepKey, { label: string; labelAr: string }> = {
  equipment: { label: "Equipment Selection", labelAr: "اختيار الجهاز" },
  protocol: { label: "Protocol", labelAr: "البروتوكول" },
  accuracy: { label: "Accuracy", labelAr: "الدقة" },
  repeatability: { label: "Repeatability", labelAr: "التكرارية" },
  linearity: { label: "Linearity", labelAr: "الخطية" },
  results: { label: "Results", labelAr: "النتائج" },
  review: { label: "Review", labelAr: "المراجعة" },
  approval: { label: "Approval", labelAr: "الاعتماد" },
  pdf: { label: "PDF", labelAr: "PDF التقرير" },
};

/** Steps that must either contain tests or carry an approved "Not Applicable" record. */
export const NA_STEP_KEYS = ["accuracy", "repeatability", "linearity"] as const;
export type NaStepKey = (typeof NA_STEP_KEYS)[number];

export type RunStep = {
  key: string;
  kind: "frame" | "test";
  label: string;
  labelAr: string;
  /** Device-specific tests displayed in this step (empty for frame steps). */
  testKeys: string[];
  /** Kept for compatibility with older saved runs that used test:<key> steps. */
  testKey?: string;
  sectionKey?: string;
  stage?: string;
};

/* ------------------------------------------------------------------ */
/* Protocol test → step mapping                                        */
/* ------------------------------------------------------------------ */

export type CanonicalTestMapping = {
  accuracy: ProtocolTest[];
  repeatability: ProtocolTest[];
  linearity: ProtocolTest[];
  /** Every other protocol test — still recorded, still evaluated, unchanged. */
  results: ProtocolTest[];
};

const nameOf = (t: ProtocolTest) => `${t.key} ${t.name}`.toLowerCase();
const isAccuracy = (t: ProtocolTest) => /\baccuracy\b/.test(nameOf(t));
const isRepeatability = (t: ProtocolTest) => /repeatab|\bprecision\b/.test(nameOf(t));
const isLinearity = (t: ProtocolTest) => /linearity/.test(nameOf(t));

/**
 * Group the protocol's own tests into the three common test steps. This is a
 * VIEW mapping only: evaluation and PDF still use the full protocol content,
 * so no criterion or acceptance limit is changed.
 */
export function mapTestsToSteps(content: ProtocolContent): CanonicalTestMapping {
  const tests = allTests(content).map(x => x.test);
  const out: CanonicalTestMapping = { accuracy: [], repeatability: [], linearity: [], results: [] };
  for (const t of tests) {
    if (isAccuracy(t)) out.accuracy.push(t);
    else if (isRepeatability(t)) out.repeatability.push(t);
    else if (isLinearity(t)) out.linearity.push(t);
    else out.results.push(t);
  }
  return out;
}

/** The nine steps, always identical for every protocol. */
export function buildRunSteps(content: ProtocolContent): RunStep[] {
  const mapping = mapTestsToSteps(content);
  const step = (key: CanonicalStepKey, testKeys: string[] = []): RunStep => ({
    key,
    kind: "frame",
    label: CANONICAL_STEP_LABELS[key].label,
    labelAr: CANONICAL_STEP_LABELS[key].labelAr,
    testKeys,
  });
  return [
    step("equipment"),
    step("protocol"),
    step("accuracy", mapping.accuracy.map(t => t.key)),
    step("repeatability", mapping.repeatability.map(t => t.key)),
    step("linearity", mapping.linearity.map(t => t.key)),
    step("results", mapping.results.map(t => t.key)),
    step("review"),
    step("approval"),
    step("pdf"),
  ];
}

/* ------------------------------------------------------------------ */
/* "Not Applicable" documentation for empty test steps                 */
/* ------------------------------------------------------------------ */

export const NA_MEASUREMENT_PREFIX = "_na:";
export const NA_CONFIRMATION_FIELD = "reviewerConfirmed";

export function naMeasurementKey(step: NaStepKey | string): string {
  return `${NA_MEASUREMENT_PREFIX}${step}`;
}

function naMeasurement(measurements: Measurements, step: NaStepKey): TestMeasurement | undefined {
  return measurements[naMeasurementKey(step)];
}

/** A step is properly documented as N/A only with a written reason AND a recorded confirmation. */
export function isStepNotApplicable(measurements: Measurements, step: NaStepKey): boolean {
  const m = naMeasurement(measurements, step);
  return !!m?.notApplicable && (m.naJustification?.trim().length ?? 0) >= 10 && m.fields?.[NA_CONFIRMATION_FIELD] === true;
}

/**
 * Extra blockers for the canonical test steps. They prevent formal recording
 * and approval, never draft saving. They are added to runApprovalBlockers by
 * the service layer on both read and record paths.
 */
export function canonicalStepBlockers(content: ProtocolContent, measurements: Measurements): RunBlocker[] {
  const mapping = mapTestsToSteps(content);
  const out: RunBlocker[] = [];
  (NA_STEP_KEYS as readonly NaStepKey[]).forEach(step => {
    if (mapping[step].length > 0) return;
    const m = naMeasurement(measurements, step);
    if (isStepNotApplicable(measurements, step)) return;
    const written = !!m?.notApplicable && (m.naJustification?.trim().length ?? 0) >= 10;
    const confirmed = m?.fields?.[NA_CONFIRMATION_FIELD] === true;
    out.push({
      code: `na-step-${step}`,
      message: written && !confirmed
        ? `The ${CANONICAL_STEP_LABELS[step].label} step is marked Not Applicable but reviewer confirmation has not been recorded.`
        : `The ${CANONICAL_STEP_LABELS[step].label} step has no protocol test and is not documented as Not Applicable with a written justification and confirmation. Document the reason in the step instead of leaving it silent.`,
      blocksRecording: true,
      blocksApproval: true,
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Approval / recording blockers (existing behaviour preserved)         */
/* ------------------------------------------------------------------ */

export type RunBlocker = { code: string; message: string; blocksRecording: boolean; blocksApproval: boolean };

/**
 * Conditions preventing formal recording / approval of a run. "Pending
 * verification" blocks approval (and a compliance conclusion) but never
 * blocks saving draft data.
 */
export function runApprovalBlockers(input: {
  revisionStatus: string;
  protocolChanged: boolean;
  evaluation: ExecutionEvaluation;
  content: ProtocolContent;
  equipmentRetired: boolean;
  identityChanged: boolean;
  compatibility: string[];
}): RunBlocker[] {
  const out: RunBlocker[] = [];
  const add = (code: string, message: string, blocksRecording: boolean, blocksApproval = true) => out.push({ code, message, blocksRecording, blocksApproval });
  if (input.revisionStatus !== "released")
    add("revision-not-released", `The protocol revision is ${input.revisionStatus.toUpperCase()} — only RELEASED revisions can be formally executed. This run is a draft / trial run and cannot be approved.`, true);
  if (input.protocolChanged) add("protocol-changed", "The protocol revision content changed after this run was created. The run keeps its own protocol snapshot; start a new run to use the current content.", true);
  if (input.equipmentRetired) add("equipment-retired", "The equipment has been retired.", true);
  if (input.identityChanged) add("equipment-identity-changed", "Equipment identity (ID / serial / manufacturer / model) changed after the run was created. The run keeps its snapshot; start a new run to use the new identity.", true);
  input.compatibility.forEach(p => add("compatibility", `Equipment compatibility: ${p}`, true));
  const pending = input.content.sections.flatMap(s => s.tests.flatMap(t => t.criteria)).filter(c => c.verificationStatus !== "verified").length;
  if (pending) add("pending-verification", `${pending} acceptance criteria are PENDING TECHNICAL VERIFICATION — no PASS/FAIL compliance conclusion and no approval are possible.`, false);
  if (input.evaluation.counts.INCOMPLETE) add("incomplete", `${input.evaluation.counts.INCOMPLETE} test(s) incomplete.`, false);
  if (input.evaluation.counts.FAIL) add("failures", `${input.evaluation.counts.FAIL} test(s) failed — a deviation must be recorded and investigated.`, false);
  return out;
}

/** Per-test difference between two measurement sets (used to resolve draft conflicts without silent overwrite). */
export function measurementConflicts(mine: Record<string, unknown>, theirs: Record<string, unknown>, base: Record<string, unknown>) {
  const keys = Array.from(new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])).sort();
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return keys
    .map(k => {
      const changedMine = !same(mine[k], base[k]);
      const changedTheirs = !same(theirs[k], base[k]);
      const kind: "none" | "mine" | "theirs" | "both-same" | "conflict" =
        !changedMine && !changedTheirs ? "none" : changedMine && !changedTheirs ? "mine" : !changedMine && changedTheirs ? "theirs" : same(mine[k], theirs[k]) ? "both-same" : "conflict";
      return { testKey: k, kind };
    })
    .filter(x => x.kind !== "none");
}

/** Automatic merge: take each side's non-conflicting changes; conflicts default to the server version until the user chooses. */
export function mergeMeasurements(mine: Record<string, unknown>, theirs: Record<string, unknown>, base: Record<string, unknown>, choices: Record<string, "mine" | "theirs"> = {}) {
  const out: Record<string, unknown> = { ...theirs };
  measurementConflicts(mine, theirs, base).forEach(({ testKey, kind }) => {
    if (kind === "mine" || (kind === "conflict" && choices[testKey] === "mine")) {
      if (mine[testKey] === undefined) delete out[testKey];
      else out[testKey] = mine[testKey];
    }
  });
  return out;
}
