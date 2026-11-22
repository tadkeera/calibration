/**
 * Content validation, submission checks and approval blockers.
 * Shared so the builder shows exactly what the backend enforces.
 */
import { formulaVariables, CalcError, parseFormula } from "./calc";
import {
  JUSTIFICATION_REQUIRED_CLASSES,
  PENDING_LABEL,
  allCriteria,
  allTests,
  collectReferenceIds,
  type ProtocolContent,
  type ReferenceVerificationStatus,
} from "./model";

export type Issue = { severity: "error" | "warning"; path: string; message: string };

export type ReferenceLookup = Map<
  string,
  { id: string; code: string; title: string; verificationStatus: ReferenceVerificationStatus; expiryDate: string | null; reviewDate: string | null }
>;

function dupes(values: string[]) {
  const seen = new Set<string>();
  const out = new Set<string>();
  values.forEach(v => (seen.has(v) ? out.add(v) : seen.add(v)));
  return Array.from(out);
}

/** Structural integrity — errors here block saving a draft. */
export function structuralIssues(content: ProtocolContent): Issue[] {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: "error", path, message });
  dupes(content.sections.map(s => s.key)).forEach(k => err(`sections.${k}`, `Duplicate section key "${k}"`));
  const tests = allTests(content);
  dupes(tests.map(t => t.test.key)).forEach(k => err(`tests.${k}`, `Duplicate test key "${k}" (test keys must be unique in the protocol)`));
  dupes(content.intervals.map(i => i.key)).forEach(k => err(`intervals.${k}`, `Duplicate interval key "${k}"`));
  dupes(content.gaps.map(g => g.key)).forEach(k => err(`gaps.${k}`, `Duplicate gap key "${k}"`));
  const order = new Map(tests.map((t, i) => [t.test.key, i]));
  tests.forEach(({ test }, index) => {
    const p = `tests.${test.key}`;
    dupes(test.criteria.map(c => c.key)).forEach(k => err(p, `Duplicate criterion key "${k}"`));
    dupes(test.calculations.map(c => c.key)).forEach(k => err(p, `Duplicate calculation key "${k}"`));
    dupes(test.levels.map(c => c.key)).forEach(k => err(p, `Duplicate level key "${k}"`));
    dupes(test.fields.map(c => c.key)).forEach(k => err(p, `Duplicate field key "${k}"`));
    const levelKeys = new Set(test.levels.map(l => l.key));
    const calcKeys = new Set<string>();
    test.calculations.forEach(calc => {
      if (calc.kind === "custom") {
        try {
          parseFormula(calc.formula);
          const allowed = new Set(["n", "mean", "sd", "min", "max", "reference", "readings", ...test.fields.map(f => f.key), ...Array.from(calcKeys)]);
          formulaVariables(calc.formula)
            .filter(v => !allowed.has(v))
            .forEach(v => err(`${p}.calculations.${calc.key}`, `Formula variable "${v}" is not a field, built-in variable or earlier calculation`));
        } catch (error) {
          err(`${p}.calculations.${calc.key}`, `Invalid formula: ${error instanceof CalcError ? error.message : "parse error"}`);
        }
      }
      if (calc.scope === "per-level" && !test.levels.length) err(`${p}.calculations.${calc.key}`, "Per-level calculation requires configured levels");
      if (calc.kind.startsWith("linearity") || calc.kind === "max-level-abs-error") {
        if (test.levels.length < 2) err(`${p}.calculations.${calc.key}`, "Linearity calculations require at least 2 levels");
      }
      calcKeys.add(calc.key);
    });
    test.criteria.forEach(c => {
      if (c.levelKey && !levelKeys.has(c.levelKey)) err(`${p}.criteria.${c.key}`, `Unknown level "${c.levelKey}"`);
    });
    if (test.dependency.type !== "independent") {
      const target = test.dependency.testKey;
      if (!target) err(`${p}.dependency`, "Dependency type requires a predecessor test");
      else if (!order.has(target)) err(`${p}.dependency`, `Dependency refers to unknown test "${target}"`);
      else if ((order.get(target) as number) >= index) err(`${p}.dependency`, "A test may only depend on a test that appears earlier (prevents circular dependencies)");
    }
  });
  return issues;
}

/** Issues that block submission for technical review (plus warnings for the author). */
export function submissionIssues(content: ProtocolContent, references: ReferenceLookup): Issue[] {
  const issues = structuralIssues(content);
  const err = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });
  const id = content.identification;
  if (!content.stages.length) err("stages", "Select at least one applicable qualification stage");
  if (!content.sections.length) err("sections", "At least one section is required");
  if (!allTests(content).length) err("tests", "At least one test is required");
  if (!content.narrative.purpose.trim()) err("narrative.purpose", "Purpose is required");
  if (!content.narrative.scope.trim()) err("narrative.scope", "Scope is required");
  if (!id.manufacturer.trim() || !id.model.trim()) err("identification", "Manufacturer and model are required for equipment compatibility");
  if (id.associationType === "equipment" && !content.equipmentLinks.length) err("equipmentLinks", "Equipment-specific protocol requires at least one registered equipment link");
  collectReferenceIds(content).forEach(refId => {
    if (!references.has(refId)) err(`references.${refId}`, `Linked reference ${refId} does not exist in the Reference Library`);
  });
  allTests(content).forEach(({ test }) => {
    const p = `tests.${test.key}`;
    if (["numeric", "series", "reference-comparison", "multi-level"].includes(test.dataType) && test.readingsRequired < 1)
      err(p, `"${test.name}": configure the number of readings (≥ 1)`);
    if (test.dataType === "multi-level" && test.levels.length < 1) err(p, `"${test.name}": multi-level test requires levels`);
    if (test.dataType === "checklist" && !test.fields.some(f => f.type === "boolean")) err(p, `"${test.name}": checklist requires at least one boolean item`);
    if (!test.criteria.length) warn(p, `"${test.name}" has no acceptance criterion (results will require reviewer assessment)`);
    test.criteria.forEach(c => {
      const cp = `${p}.criteria.${c.key}`;
      if (!c.referenceId && !c.justification.trim()) err(cp, `Criterion ${c.key}: a traceable reference or a documented technical justification is required`);
      if (JUSTIFICATION_REQUIRED_CLASSES.includes(c.sourceClass) && !c.justification.trim())
        err(cp, `Criterion ${c.key}: institutional / risk-based criteria require a written justification`);
      const numeric = !["pass-fail", "record-only"].includes(c.comparison);
      const hasLimit =
        c.comparison === "between" ? c.lower !== null && c.upper !== null
        : c.comparison === "<=" || c.comparison === "<" ? c.upper !== null
        : c.comparison === ">=" || c.comparison === ">" ? c.lower !== null
        : c.comparison === "abs<=" ? (c.tolerance ?? c.upper) !== null
        : c.comparison === "target±tolerance" ? c.target !== null && c.tolerance !== null
        : true;
      if (numeric && !hasLimit && c.verificationStatus === "verified") err(cp, `Criterion ${c.key}: a verified criterion must have its numeric limit configured`);
      if (numeric && !hasLimit && c.verificationStatus !== "verified") warn(cp, `Criterion ${c.key}: limit not established — ${PENDING_LABEL}`);
      if (c.verificationStatus === "verified" && !c.verificationEvidence.trim()) err(cp, `Criterion ${c.key}: verification evidence must be documented`);
      if (c.comparison === "pass-fail" && !test.fields.some(f => f.key === c.parameter && f.type === "boolean"))
        err(cp, `Criterion ${c.key}: pass/fail criteria must reference a boolean field`);
      if (numeric && !c.parameter.trim()) err(cp, `Criterion ${c.key}: parameter (calculation key, field key or "reading") is required`);
    });
  });
  content.intervals.forEach(i => {
    if (i.unit === "event" ? !i.event.trim() : i.value === null) err(`intervals.${i.key}`, `Interval "${i.activity}" needs a value (or an event description)`);
    if (!i.justification.trim()) err(`intervals.${i.key}`, `Interval "${i.activity}" requires a technical justification`);
  });
  content.gaps.forEach(g => {
    if (!g.description.trim()) err(`gaps.${g.key}`, `Gap "${g.title}" must be described`);
  });
  return issues;
}

export type GapDecisionRecord = { gapKey: string; decision: string; rationale: string; reviewerName: string | null; createdAt: string };

export type ApprovalContext = {
  references: ReferenceLookup;
  gapDecisions: Map<string, GapDecisionRecord>;
  openCommentCount: number;
  today: string; // YYYY-MM-DD
};

/** Reasons QA approval is blocked. An empty list means the content may be approved. */
export function approvalBlockers(content: ProtocolContent, ctx: ApprovalContext): string[] {
  const blockers: string[] = [];
  const errors = submissionIssues(content, ctx.references).filter(i => i.severity === "error");
  if (errors.length) blockers.push(`${errors.length} content error(s) must be corrected (e.g. ${errors[0].message})`);
  const pendingCriteria = allCriteria(content).filter(({ criterion }) => criterion.verificationStatus !== "verified");
  if (pendingCriteria.length)
    blockers.push(`${pendingCriteria.length} acceptance criterion/criteria remain ${PENDING_LABEL}: ${pendingCriteria.slice(0, 6).map(x => `${x.test.key}/${x.criterion.key}`).join(", ")}${pendingCriteria.length > 6 ? ", …" : ""}`);
  const pendingIntervals = content.intervals.filter(i => i.verificationStatus !== "verified");
  if (pendingIntervals.length) blockers.push(`${pendingIntervals.length} interval(s) remain ${PENDING_LABEL}: ${pendingIntervals.map(i => i.activity).join(", ")}`);
  content.gaps.forEach(g => {
    const decision = ctx.gapDecisions.get(g.key);
    if (!g.assessment.trim()) blockers.push(`Technical gap "${g.title}" has no documented technical assessment`);
    if (!decision) blockers.push(`Technical gap "${g.title}" has no recorded technical reviewer decision`);
    else if (decision.decision === "additional-evidence-required" || decision.decision === "equipment-not-suitable")
      blockers.push(`Technical gap "${g.title}": reviewer decision "${decision.decision}" does not permit approval`);
  });
  if (ctx.openCommentCount > 0) blockers.push(`${ctx.openCommentCount} review comment(s) are not resolved`);
  collectReferenceIds(content).forEach(refId => {
    const ref = ctx.references.get(refId);
    if (!ref) return;
    if (ref.verificationStatus !== "verified") blockers.push(`Reference ${ref.code} is ${ref.verificationStatus} (edition/status must be verified)`);
    if (ref.expiryDate && ref.expiryDate < ctx.today) blockers.push(`Reference ${ref.code} expired on ${ref.expiryDate}`);
  });
  if (!content.risk.overall || !content.risk.justification.trim()) blockers.push("Risk assessment (overall level and justification) is not documented");
  return blockers;
}

/**
 * Blockers for the simplified Quality Manager approval (Draft → Approved).
 * Honest minimum: complete content, every acceptance criterion verified
 * against its source, every cited reference verified and not expired, and
 * every documented technical gap assessed. "Needs Source Verification" values
 * can therefore never be approved silently.
 */
export function qmApprovalBlockers(content: ProtocolContent, ctx: { references: ReferenceLookup; today: string }): string[] {
  const blockers: string[] = [];
  const errors = submissionIssues(content, ctx.references).filter(i => i.severity === "error");
  if (errors.length) blockers.push(`${errors.length} content error(s) must be corrected (e.g. ${errors[0].message})`);
  const tests = content.sections.flatMap(s => s.tests);
  if (!tests.length) blockers.push("The protocol has no tests");
  const pendingCriteria = allCriteria(content).filter(({ criterion }) => criterion.verificationStatus !== "verified");
  if (pendingCriteria.length)
    blockers.push(`${pendingCriteria.length} acceptance criterion/criteria are not verified against their source (${PENDING_LABEL}): ${pendingCriteria.slice(0, 6).map(x => `${x.test.key}/${x.criterion.key}`).join(", ")}${pendingCriteria.length > 6 ? ", …" : ""}`);
  content.gaps.forEach(g => {
    if (!g.assessment.trim()) blockers.push(`Technical gap "${g.title}" has no documented technical assessment`);
  });
  collectReferenceIds(content).forEach(refId => {
    const ref = ctx.references.get(refId);
    if (!ref) return;
    if (ref.verificationStatus !== "verified") blockers.push(`Reference ${ref.code} is ${ref.verificationStatus} (edition / chapter / section must be verified)`);
    if (ref.expiryDate && ref.expiryDate < ctx.today) blockers.push(`Reference ${ref.code} expired on ${ref.expiryDate}`);
  });
  return blockers;
}
