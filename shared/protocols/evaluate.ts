/**
 * Generic execution evaluator: turns a released protocol revision + original
 * measurements into calculated values and per-criterion outcomes.
 *
 * A calculated PASS is a technical outcome only — it never approves a record.
 * The existing authorised approval workflow stays in control.
 */
import { z } from "zod";
import {
  CALC_ENGINE_VERSION,
  BUILTIN_FORMULA_TEXT,
  CalcError,
  applyRounding,
  levelArgMax,
  runCalculation,
  stats,
  type CalcVariables,
} from "./calc";
import type { Calculation, Criterion, ProtocolContent, ProtocolTest } from "./model";
import { buildTestGraphs, type GraphData } from "./graphs";

/**
 * PASS / FAIL — decision; INCOMPLETE — "Pending" (required input missing or invalid);
 * NOT APPLICABLE; UNDER REVIEW — pending acceptance criteria / reviewer assessment;
 * RECORDED — informational test (recorded + advisories only), never part of the overall decision.
 */
export const EXECUTION_STATUSES = ["PASS", "FAIL", "INCOMPLETE", "NOT APPLICABLE", "UNDER REVIEW", "RECORDED"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
/** Overall statuses (RECORDED is test-level only). */
export type OverallStatus = Exclude<ExecutionStatus, "RECORDED">;
/** User-facing wording of the statuses. */
export const STATUS_DISPLAY: Record<ExecutionStatus, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  INCOMPLETE: "Pending",
  "NOT APPLICABLE": "Not Applicable",
  "UNDER REVIEW": "Pending Acceptance Criteria / Review",
  RECORDED: "Recorded (informational)",
};
export const PENDING_ACCEPTANCE_CRITERIA = "Pending Acceptance Criteria";

export const CALCULATED_PASS_DISCLAIMER =
  "Calculated outcomes are technical results only. A calculated PASS is not an approval; the authorised review and approval workflow remains in control.";

const reading = z.number().finite().nullable();
export const testMeasurementSchema = z.object({
  readings: z.array(reading).max(200).optional(),
  /** Reference value recorded at execution (e.g. from a certificate) when the protocol does not fix a nominal value. */
  reference: reading.optional(),
  levelReferences: z.record(z.string().max(64), reading).optional(),
  levels: z.record(z.string().max(64), z.array(reading).max(200)).optional(),
  fields: z.record(z.string().max(64), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()])).optional(),
  notApplicable: z.boolean().optional(),
  naJustification: z.string().max(1000).optional(),
  comment: z.string().max(2000).optional(),
});
export const measurementsSchema = z.record(z.string().max(64), testMeasurementSchema);
export type TestMeasurement = z.infer<typeof testMeasurementSchema>;
export type Measurements = z.infer<typeof measurementsSchema>;

export type CalcResult = {
  key: string;
  label: string;
  levelKey: string | null;
  raw: number | null;
  value: number | null;
  unit: string;
  formula: string;
  formulaRevision: string;
  error: string | null;
  /** Level label (display only). */
  levelLabel?: string | null;
  /** Set when the value needs reviewer attention (e.g. tied maxima); criteria using it are not decided automatically. */
  review?: string | null;
};
export type AdvisoryResult = { key: string; parameter: string; value: number | null; limit: string; triggered: boolean | null; message: string; referenceClause: string };
export type CriterionResult = {
  key: string;
  levelKey: string | null;
  parameter: string;
  value: number | boolean | null;
  status: ExecutionStatus;
  limit: string;
  sourceClass: string;
  referenceId: string | null;
  verificationStatus: string;
  message: string;
};
export type TestResult = {
  sectionKey: string;
  testKey: string;
  name: string;
  stage: string;
  status: ExecutionStatus;
  notes: string[];
  calculations: CalcResult[];
  criteria: CriterionResult[];
  /** Graphs configured for the test, built from the actual readings (empty when not configured / data insufficient). */
  graphs: GraphData[];
  /** Non-decisional advisories (maintenance alerts) — never change PASS / FAIL. */
  advisories?: AdvisoryResult[];
  informational?: boolean;
};
export type ExecutionEvaluation = {
  engineVersion: string;
  calculatedAt: string;
  overall: OverallStatus;
  counts: Record<ExecutionStatus, number>;
  tests: TestResult[];
  disclaimer: string;
};

export function describeLimit(c: Pick<Criterion, "comparison" | "lower" | "upper" | "target" | "tolerance" | "unit">) {
  const u = c.unit ? ` ${c.unit}` : "";
  const v = (x: number | null) => (x === null ? "?" : String(x));
  switch (c.comparison) {
    case "between":
      return `${v(c.lower)} to ${v(c.upper)}${u}`;
    case "<=":
      return `≤ ${v(c.upper)}${u}`;
    case "<":
      return `< ${v(c.upper)}${u}`;
    case ">=":
      return `≥ ${v(c.lower)}${u}`;
    case ">":
      return `> ${v(c.lower)}${u}`;
    case "abs<=":
      return `|value| ≤ ${v(c.tolerance ?? c.upper)}${u}`;
    case "target±tolerance":
      return `${v(c.target)} ± ${v(c.tolerance)}${u}`;
    case "pass-fail":
      return "Confirmed (Yes)";
    case "record-only":
      return "Recorded — reviewer assessment";
  }
}

/** Returns true/false for a numeric comparison, or null when a required limit is not configured. */
export function compareValue(value: number, c: Criterion): boolean | null {
  const need = (...xs: Array<number | null>) => xs.every(x => x !== null && Number.isFinite(x));
  switch (c.comparison) {
    case "between":
      return need(c.lower, c.upper) ? value >= (c.lower as number) && value <= (c.upper as number) : null;
    case "<=":
      return need(c.upper) ? value <= (c.upper as number) : null;
    case "<":
      return need(c.upper) ? value < (c.upper as number) : null;
    case ">=":
      return need(c.lower) ? value >= (c.lower as number) : null;
    case ">":
      return need(c.lower) ? value > (c.lower as number) : null;
    case "abs<=": {
      const tol = c.tolerance ?? c.upper;
      return need(tol) ? Math.abs(value) <= (tol as number) : null;
    }
    case "target±tolerance":
      return need(c.target, c.tolerance) ? Math.abs(value - (c.target as number)) <= (c.tolerance as number) : null;
    default:
      return null;
  }
}

function numericReadings(test: ProtocolTest) {
  return ["numeric", "series", "reference-comparison"].includes(test.dataType);
}

function expectedReadings(test: ProtocolTest) {
  return Math.max(1, test.readingsRequired || 0);
}

function isBlank(v: unknown) {
  return v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
}

/** Recorded field value, or the source-defined default when nothing was recorded. */
function fieldValue(m: TestMeasurement | undefined, field: { key: string; defaultValue?: number | string }) {
  const v = m?.fields?.[field.key];
  if (isBlank(v) && field.defaultValue !== undefined) return field.defaultValue;
  return v;
}

function fieldNumber(m: TestMeasurement | undefined, field: { key: string; defaultValue?: number | string }) {
  const v = fieldValue(m, field);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Input-range validation (e.g. time, volume and areas must be > 0). Returns an error text or null. */
function rangeProblem(value: number, rule: { gt?: number; gte?: number }) {
  if (rule.gt !== undefined && !(value > rule.gt)) return `must be greater than ${rule.gt}`;
  if (rule.gte !== undefined && !(value >= rule.gte)) return `must be at least ${rule.gte}`;
  return null;
}

function evaluateTest(sectionKey: string, test: ProtocolTest, m: TestMeasurement | undefined, prior: Map<string, ExecutionStatus>): TestResult {
  const result: TestResult = {
    sectionKey,
    testKey: test.key,
    name: test.name,
    stage: test.stage,
    status: "INCOMPLETE",
    notes: [],
    calculations: [],
    criteria: [],
    graphs: [],
  };
  // Dependencies (explicitly configured, evaluated in protocol order).
  if (test.dependency.type !== "independent" && test.dependency.testKey) {
    const predecessor = prior.get(test.dependency.testKey);
    if (test.dependency.type === "conditional" && predecessor !== "PASS") {
      result.status = "NOT APPLICABLE";
      result.notes.push(`Not performed: condition "${test.dependency.testKey} = PASS" not met (got ${predecessor ?? "not evaluated"}).`);
      return result;
    }
    if (test.dependency.type === "sequential" && (predecessor === undefined || predecessor === "INCOMPLETE")) {
      result.notes.push(`Sequential dependency: ${test.dependency.testKey} must be completed first.`);
      return result;
    }
  }
  if (m?.notApplicable) {
    if (!m.naJustification?.trim()) {
      result.notes.push("NOT APPLICABLE requires a written justification.");
      return result;
    }
    result.status = "NOT APPLICABLE";
    result.notes.push(`Not applicable: ${m.naJustification.trim()}`);
    return result;
  }

  let complete = true;
  const missing = (msg: string) => {
    complete = false;
    result.notes.push(msg);
  };
  // Required data collection.
  const readings = (m?.readings ?? []).slice();
  if (numericReadings(test)) {
    const n = expectedReadings(test);
    const provided = readings.slice(0, n);
    const count = provided.filter(v => v !== null && v !== undefined).length;
    if (count < n) missing(`${n - count} of ${n} required readings missing.`);
  }
  const levelValues = new Map<string, Array<number | null>>();
  if (test.dataType === "multi-level") {
    const n = expectedReadings(test);
    if (!test.levels.length) missing("No levels configured.");
    test.levels.forEach(level => {
      const values = (m?.levels?.[level.key] ?? []).slice(0, n);
      levelValues.set(level.key, values);
      const count = values.filter(v => v !== null && v !== undefined).length;
      if (count < n) missing(`Level ${level.label || level.key}: ${n - count} of ${n} readings missing.`);
    });
  }
  const testReference = test.nominal ?? m?.reference ?? null;
  if (test.dataType === "reference-comparison" && testReference === null) missing("Reference value not recorded (enter the certified value from the certificate).");
  const levelReference = (key: string, nominal: number | null) => nominal ?? m?.levelReferences?.[key] ?? null;
  if (test.dataType === "multi-level")
    test.levels.forEach(level => {
      if (levelReference(level.key, level.nominal) === null) missing(`Level ${level.label || level.key}: reference value not recorded.`);
    });
  test.fields.forEach(field => {
    if (field.required && field.type !== "boolean" && isBlank(fieldValue(m, field))) missing(`Required field "${field.label || field.key}" not recorded.`);
    if (field.required && field.type === "boolean" && typeof m?.fields?.[field.key] !== "boolean") missing(`Checklist item "${field.label || field.key}" not answered.`);
    if (field.defaultValue !== undefined && isBlank(m?.fields?.[field.key])) result.notes.push(`${field.label || field.key}: source-defined value ${field.defaultValue}${field.unit ? ` ${field.unit}` : ""} used.`);
  });
  // Input validation — an invalid value is treated like a missing one (never calculated, never a pass).
  const invalid = new Set<string>();
  test.fields.forEach(field => {
    const v = fieldNumber(m, field);
    const problem = field.type === "number" && v !== null ? rangeProblem(v, field) : null;
    if (problem) {
      invalid.add(field.key);
      missing(`${field.label || field.key} = ${v} is invalid: ${problem}.`);
    }
  });
  const readingKeys = test.readingKeys ?? [];
  const checkReadingSet = (values: Array<number | null>, where: string) =>
    values.map((v, i) => {
      const rk = readingKeys[i];
      if (!rk || v === null || v === undefined) return v;
      const problem = rangeProblem(v, rk);
      if (!problem) return v;
      missing(`${where}${rk.label || rk.key} = ${v} is invalid: ${problem}.`);
      return null;
    });
  levelValues.forEach((values, key) => {
    const level = test.levels.find(l => l.key === key);
    levelValues.set(key, checkReadingSet(values, `${level?.label || key}: `));
  });
  if (numericReadings(test) && readingKeys.length) {
    const checked = checkReadingSet(readings.slice(0, expectedReadings(test)), "");
    checked.forEach((v, i) => (readings[i] = v));
  }

  // Calculations (full precision; rounding is applied to the displayed value only).
  const vars: CalcVariables = {};
  test.fields.forEach(f => {
    if (f.type === "number") vars[f.key] = invalid.has(f.key) ? null : fieldNumber(m, f);
  });
  const base = numericReadings(test) ? readings.slice(0, expectedReadings(test)) : test.dataType === "multi-level" ? Array.from(levelValues.values()).flat() : [];
  const safe = (fn: () => number) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  if (base.length) {
    vars.readings = base.every(v => v !== null) ? (base as number[]) : null;
    vars.n = base.length;
    vars.mean = safe(() => stats.mean(base));
    vars.sd = safe(() => stats.sd(base));
    vars.min = safe(() => stats.min(base));
    vars.max = safe(() => stats.max(base));
  }
  vars.reference = testReference;
  // Named readings: per test (numeric / series) or as series over the levels (multi-level).
  if (readingKeys.length) {
    if (test.dataType === "multi-level")
      readingKeys.forEach((rk, i) => {
        const series = test.levels.map(l => (levelValues.get(l.key) ?? [])[i] ?? null);
        vars[rk.key] = series.length && series.every(v => v !== null) ? (series as number[]) : null;
      });
    else readingKeys.forEach((rk, i) => (vars[rk.key] = readings[i] ?? null));
  }
  const levelsInput = test.levels.map(l => ({ key: l.key, reference: levelReference(l.key, l.nominal), values: levelValues.get(l.key) ?? [] }));
  const levelLabel = (key: string | null) => (key ? test.levels.find(l => l.key === key)?.label || key : null);
  const calcByKey = new Map<string, CalcResult[]>();
  const runOne = (calc: Calculation, levelKey: string | null, values: Array<number | null>, reference: number | null, extra: CalcVariables) => {
    const formula = calc.kind === "custom" ? calc.formula : BUILTIN_FORMULA_TEXT[calc.kind];
    const out: CalcResult = { key: calc.key, label: calc.label || calc.key, levelKey, levelLabel: levelLabel(levelKey), raw: null, value: null, unit: calc.unit, formula, formulaRevision: calc.formulaRevision, error: null, review: null };
    try {
      const raw = runCalculation(calc, { values, reference, levels: levelsInput, variables: { ...vars, ...extra } });
      out.raw = raw;
      out.value = applyRounding(raw, calc);
      if (calc.kind === "level-reference-at-max") {
        const arg = levelArgMax(levelsInput);
        if (arg.ties.length > 1) {
          out.review = `Tie: the maximum response ${arg.max} occurs at ${arg.ties.map(t => t.reference).join(", ")} — flagged for review (no level is selected silently).`;
          result.notes.push(out.review);
        }
      }
    } catch (error) {
      out.error = error instanceof CalcError ? error.message : "Calculation failed";
    }
    result.calculations.push(out);
    calcByKey.set(calc.key, [...(calcByKey.get(calc.key) ?? []), out]);
    return out;
  };
  /** Earlier per-level results of the same level (unrounded) — lets per-level formulas build on each other. */
  const levelChain = new Map<string, CalcVariables>();
  for (const calc of test.calculations) {
    if (calc.scope === "per-level" && test.levels.length) {
      test.levels.forEach(level => {
        const values = levelValues.get(level.key) ?? [];
        const ref = levelReference(level.key, level.nominal);
        const named: CalcVariables = {};
        readingKeys.forEach((rk, i) => (named[rk.key] = values[i] ?? null));
        const chain = levelChain.get(level.key) ?? {};
        const out = runOne(calc, level.key, values, ref, {
          ...chain,
          ...named,
          readings: values.every(v => v !== null) && values.length ? (values as number[]) : null,
          reference: ref,
          n: values.length,
          mean: safe(() => stats.mean(values)),
          sd: safe(() => stats.sd(values)),
        });
        levelChain.set(level.key, { ...chain, [calc.key]: out.raw });
      });
    } else {
      const out = runOne(calc, null, base, testReference, {});
      vars[calc.key] = out.raw;
    }
  }

  // Regression equation (when the test calculates both slope and intercept).
  const slopeCalc = test.calculations.find(c => c.kind === "linearity-slope" && c.scope === "test");
  const interceptCalc = test.calculations.find(c => c.kind === "linearity-intercept" && c.scope === "test");
  if (slopeCalc && interceptCalc) {
    const m = calcByKey.get(slopeCalc.key)?.[0]?.raw;
    const b = calcByKey.get(interceptCalc.key)?.[0]?.raw;
    if (typeof m === "number" && typeof b === "number") result.notes.push(`Regression equation: y = ${fmtNum(m)}·x ${b < 0 ? "−" : "+"} ${fmtNum(Math.abs(b))}`);
  }

  // Criteria.
  for (const c of test.criteria) {
    const pending = c.verificationStatus !== "verified";
    const record = (levelKey: string | null, value: number | boolean | null, technical: ExecutionStatus, message: string) => {
      let status = technical;
      let msg = message;
      if (pending && (technical === "PASS" || technical === "FAIL")) {
        status = "UNDER REVIEW";
        msg = `${message} Indicative ${technical}; criterion is PENDING TECHNICAL VERIFICATION — no compliance conclusion.`;
      }
      result.criteria.push({ key: c.key, levelKey, parameter: c.parameter, value, status, limit: describeLimit(c), sourceClass: c.sourceClass, referenceId: c.referenceId, verificationStatus: c.verificationStatus, message: msg.trim() });
    };
    if (c.comparison === "record-only") {
      record(null, null, "UNDER REVIEW", "Recorded value requires reviewer assessment.");
      continue;
    }
    if (c.comparison === "pass-fail") {
      const v = m?.fields?.[c.parameter];
      if (typeof v !== "boolean") record(null, null, "INCOMPLETE", `Item "${c.parameter}" not answered.`);
      else record(null, v, v ? "PASS" : "FAIL", v ? "Confirmed." : "Not confirmed.");
      continue;
    }
    const evaluateNumber = (levelKey: string | null, value: number | null, error: string | null, raw: number | null = value, review: string | null = null) => {
      if (value === null || raw === null) {
        record(levelKey, null, "INCOMPLETE", error ?? `Value for "${c.parameter}" not available.`);
        return;
      }
      // Compared with the value after the protocol's own rounding rule (none configured = full precision).
      const ok = compareValue(value, c);
      if (ok === null) record(levelKey, value, "UNDER REVIEW", `${PENDING_ACCEPTANCE_CRITERIA}: acceptance limit not established (PENDING TECHNICAL VERIFICATION).`);
      else if (review) record(levelKey, value, "UNDER REVIEW", `${review} Indicative ${ok ? "PASS" : "FAIL"} vs ${describeLimit(c)}.`);
      else record(levelKey, value, ok ? "PASS" : "FAIL", `Value ${fmtNum(value)} vs ${describeLimit(c)}.`);
    };
    const calcResults = calcByKey.get(c.parameter);
    if (calcResults) {
      const targets = c.levelKey ? calcResults.filter(r => r.levelKey === c.levelKey) : calcResults;
      if (!targets.length) record(c.levelKey, null, "INCOMPLETE", `No result for level ${c.levelKey}.`);
      targets.forEach(r => evaluateNumber(r.levelKey, r.value, r.error, r.raw, r.review ?? null));
      continue;
    }
    if (c.parameter === "reading" || c.parameter === "each-reading") {
      const values = c.levelKey ? levelValues.get(c.levelKey) ?? [] : base;
      if (!values.length || values.some(v => v === null)) record(c.levelKey, null, "INCOMPLETE", "Readings incomplete.");
      else values.forEach(v => evaluateNumber(c.levelKey, v, null));
      continue;
    }
    const field = test.fields.find(f => f.key === c.parameter);
    if (field) {
      evaluateNumber(null, invalid.has(field.key) ? null : fieldNumber(m, field), `Field "${field.label || field.key}" not recorded or invalid.`);
      continue;
    }
    record(c.levelKey, null, "INCOMPLETE", `Parameter "${c.parameter}" is not a configured calculation, field or "reading".`);
  }

  // Advisories (maintenance / replacement alerts) — informative only.
  if (test.advisories?.length) {
    result.advisories = test.advisories.map(a => {
      const calcValue = calcByKey.get(a.parameter)?.find(r => r.levelKey === null);
      const field = test.fields.find(f => f.key === a.parameter);
      const value = calcValue ? calcValue.raw : field && !invalid.has(field.key) ? fieldNumber(m, field) : null;
      const limit = `${a.comparison} ${a.limit}${a.unit ? ` ${a.unit}` : ""}`;
      if (value === null) return { key: a.key, parameter: a.parameter, value: null, limit, triggered: null, message: "Not evaluated — value not recorded.", referenceClause: a.referenceClause };
      const triggered = a.comparison === ">=" ? value >= a.limit : a.comparison === ">" ? value > a.limit : a.comparison === "<=" ? value <= a.limit : value < a.limit;
      return { key: a.key, parameter: a.parameter, value, limit, triggered, message: triggered ? a.alertMessage : a.okMessage, referenceClause: a.referenceClause };
    });
    result.advisories.forEach(a => a.triggered && result.notes.push(`ALERT: ${a.message}`));
  }

  // Graphs (only those configured for the test, from the actual readings and calculated values).
  try {
    const levelCalcs: Record<string, Record<string, number | null>> = {};
    result.calculations.forEach(r => {
      if (!r.levelKey) return;
      (levelCalcs[r.levelKey] ??= {})[r.key] = r.raw;
    });
    result.graphs = buildTestGraphs(test, {
      readings: base,
      reference: testReference,
      levels: test.levels.map(l => ({ key: l.key, label: l.label, group: l.group, reference: levelReference(l.key, l.nominal), values: levelValues.get(l.key) ?? [] })),
      readingKeys: readingKeys.map(r => ({ key: r.key, label: r.label, unit: r.unit })),
      levelCalcs,
      calcUnits: Object.fromEntries(test.calculations.map(c => [c.key, { label: c.label || c.key, unit: c.unit }])),
    });
  } catch {
    result.graphs = [];
  }

  // Aggregate.
  const statuses = result.criteria.map(c => c.status);
  if (test.decisionRole === "informational") {
    result.informational = true;
    result.status = !complete ? "INCOMPLETE" : statuses.includes("FAIL") ? "FAIL" : "RECORDED";
    if (result.status === "RECORDED") result.notes.push("Informational test — recorded and assessed by advisories only; not part of the PASS / FAIL decision.");
    return result;
  }
  if (statuses.includes("FAIL")) result.status = "FAIL";
  else if (!complete || statuses.includes("INCOMPLETE")) result.status = "INCOMPLETE";
  else if (statuses.includes("UNDER REVIEW") || !statuses.length) {
    result.status = "UNDER REVIEW";
    if (!statuses.length) result.notes.push(`${PENDING_ACCEPTANCE_CRITERIA}: no acceptance criterion configured — reviewer assessment required.`);
  } else result.status = "PASS";
  return result;
}

export function evaluateExecution(content: ProtocolContent, measurements: Measurements, now = new Date()): ExecutionEvaluation {
  const prior = new Map<string, ExecutionStatus>();
  const tests: TestResult[] = [];
  for (const section of content.sections) {
    for (const test of section.tests) {
      const r = evaluateTest(section.key, test, measurements[test.key], prior);
      if (!test.required && r.status === "INCOMPLETE" && !measurements[test.key]) {
        r.status = "NOT APPLICABLE";
        r.notes.push("Optional test not performed.");
      }
      prior.set(test.key, r.status);
      tests.push(r);
    }
  }
  const counts = Object.fromEntries(EXECUTION_STATUSES.map(s => [s, 0])) as Record<ExecutionStatus, number>;
  tests.forEach(t => counts[t.status]++);
  let overall: OverallStatus;
  if (counts.FAIL) overall = "FAIL";
  else if (counts.INCOMPLETE) overall = "INCOMPLETE";
  else if (counts["UNDER REVIEW"]) overall = "UNDER REVIEW";
  else if (counts.PASS) overall = "PASS";
  else overall = "NOT APPLICABLE";
  return { engineVersion: CALC_ENGINE_VERSION, calculatedAt: now.toISOString(), overall, counts, tests, disclaimer: CALCULATED_PASS_DISCLAIMER };
}

function fmtNum(v: number) {
  return String(Number(v.toPrecision(12)));
}
