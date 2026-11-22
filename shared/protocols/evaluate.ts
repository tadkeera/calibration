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
  runCalculation,
  stats,
  type CalcVariables,
} from "./calc";
import type { Calculation, Criterion, ProtocolContent, ProtocolTest } from "./model";
import { buildTestGraphs, type GraphData } from "./graphs";

export const EXECUTION_STATUSES = ["PASS", "FAIL", "INCOMPLETE", "NOT APPLICABLE", "UNDER REVIEW"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

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
};
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
};
export type ExecutionEvaluation = {
  engineVersion: string;
  calculatedAt: string;
  overall: ExecutionStatus;
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

function fieldNumber(m: TestMeasurement | undefined, key: string) {
  const v = m?.fields?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isBlank(v: unknown) {
  return v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
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
    if (field.required && field.type !== "boolean" && isBlank(m?.fields?.[field.key])) missing(`Required field "${field.label || field.key}" not recorded.`);
    if (field.required && field.type === "boolean" && typeof m?.fields?.[field.key] !== "boolean") missing(`Checklist item "${field.label || field.key}" not answered.`);
  });

  // Calculations.
  const vars: CalcVariables = {};
  test.fields.forEach(f => {
    if (f.type === "number") vars[f.key] = fieldNumber(m, f.key);
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
  const levelsInput = test.levels.map(l => ({ key: l.key, reference: levelReference(l.key, l.nominal), values: levelValues.get(l.key) ?? [] }));
  const calcByKey = new Map<string, CalcResult[]>();
  const runOne = (calc: Calculation, levelKey: string | null, values: Array<number | null>, reference: number | null, extra: CalcVariables) => {
    const formula = calc.kind === "custom" ? calc.formula : BUILTIN_FORMULA_TEXT[calc.kind];
    const out: CalcResult = { key: calc.key, label: calc.label || calc.key, levelKey, raw: null, value: null, unit: calc.unit, formula, formulaRevision: calc.formulaRevision, error: null };
    try {
      const raw = runCalculation(calc, { values, reference, levels: levelsInput, variables: { ...vars, ...extra } });
      out.raw = raw;
      out.value = applyRounding(raw, calc);
    } catch (error) {
      out.error = error instanceof CalcError ? error.message : "Calculation failed";
    }
    result.calculations.push(out);
    calcByKey.set(calc.key, [...(calcByKey.get(calc.key) ?? []), out]);
    return out;
  };
  for (const calc of test.calculations) {
    if (calc.scope === "per-level" && test.levels.length) {
      test.levels.forEach(level => {
        const values = levelValues.get(level.key) ?? [];
        const ref = levelReference(level.key, level.nominal);
        runOne(calc, level.key, values, ref, {
          readings: values.every(v => v !== null) && values.length ? (values as number[]) : null,
          reference: ref,
          n: values.length,
          mean: safe(() => stats.mean(values)),
          sd: safe(() => stats.sd(values)),
        });
      });
    } else {
      const out = runOne(calc, null, base, testReference, {});
      if (out.value !== null) vars[calc.key] = out.value;
      else vars[calc.key] = null;
    }
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
    const evaluateNumber = (levelKey: string | null, value: number | null, error: string | null) => {
      if (value === null) {
        record(levelKey, null, "INCOMPLETE", error ?? `Value for "${c.parameter}" not available.`);
        return;
      }
      const ok = compareValue(value, c);
      if (ok === null) record(levelKey, value, "UNDER REVIEW", "Acceptance limit not established (PENDING TECHNICAL VERIFICATION).");
      else record(levelKey, value, ok ? "PASS" : "FAIL", `Value ${value} vs ${describeLimit(c)}.`);
    };
    const calcResults = calcByKey.get(c.parameter);
    if (calcResults) {
      const targets = c.levelKey ? calcResults.filter(r => r.levelKey === c.levelKey) : calcResults;
      if (!targets.length) record(c.levelKey, null, "INCOMPLETE", `No result for level ${c.levelKey}.`);
      targets.forEach(r => evaluateNumber(r.levelKey, r.value, r.error));
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
      evaluateNumber(null, fieldNumber(m, field.key), `Field "${field.label || field.key}" not recorded.`);
      continue;
    }
    record(c.levelKey, null, "INCOMPLETE", `Parameter "${c.parameter}" is not a configured calculation, field or "reading".`);
  }

  // Graphs (only those configured for the test, from the actual readings).
  try {
    result.graphs = buildTestGraphs(test, {
      readings: base,
      reference: testReference,
      levels: test.levels.map(l => ({ key: l.key, label: l.label, reference: levelReference(l.key, l.nominal), values: levelValues.get(l.key) ?? [] })),
    });
  } catch {
    result.graphs = [];
  }

  // Aggregate.
  const statuses = result.criteria.map(c => c.status);
  if (statuses.includes("FAIL")) result.status = "FAIL";
  else if (!complete || statuses.includes("INCOMPLETE")) result.status = "INCOMPLETE";
  else if (statuses.includes("UNDER REVIEW") || !statuses.length) {
    result.status = "UNDER REVIEW";
    if (!statuses.length) result.notes.push("No acceptance criterion configured — reviewer assessment required.");
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
  const counts = Object.fromEntries(["PASS", "FAIL", "INCOMPLETE", "NOT APPLICABLE", "UNDER REVIEW"].map(s => [s, 0])) as Record<ExecutionStatus, number>;
  tests.forEach(t => counts[t.status]++);
  let overall: ExecutionStatus;
  if (counts.FAIL) overall = "FAIL";
  else if (counts.INCOMPLETE) overall = "INCOMPLETE";
  else if (counts["UNDER REVIEW"]) overall = "UNDER REVIEW";
  else if (counts.PASS) overall = "PASS";
  else overall = "NOT APPLICABLE";
  return { engineVersion: CALC_ENGINE_VERSION, calculatedAt: now.toISOString(), overall, counts, tests, disclaimer: CALCULATED_PASS_DISCLAIMER };
}
