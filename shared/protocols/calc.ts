/**
 * Generic, deterministic calculation engine for protocol executions.
 *
 * Integrity rules (Master prompt §9.3):
 *  - inputs are validated before calculation;
 *  - missing values are NEVER treated as zero (they make the result unavailable);
 *  - division by zero is reported, never coerced to Infinity/NaN;
 *  - custom formulas are parsed by a small recursive-descent parser (no eval);
 *  - every result records the formula text and the engine version.
 */
import type { CalcKind, Calculation } from "./model";

export const CALC_ENGINE_VERSION = "protocol-calc-engine/1.0.0";

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

export type CalcValue = number | number[];
export type CalcVariables = Record<string, CalcValue | null | undefined>;

/* ------------------------------------------------------------------ */
/* Statistics                                                           */
/* ------------------------------------------------------------------ */

function requireValues(values: ReadonlyArray<number | null | undefined>, min = 1, label = "values") {
  const missing = values.filter(v => v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)));
  if (missing.length)
    throw new CalcError(`${missing.length} missing or invalid ${label}; missing values are not treated as zero`);
  if (values.length < min) throw new CalcError(`At least ${min} ${label} required (got ${values.length})`);
  return values as number[];
}

export const stats = {
  mean(values: ReadonlyArray<number | null | undefined>) {
    const v = requireValues(values);
    return v.reduce((a, b) => a + b, 0) / v.length;
  },
  min(values: ReadonlyArray<number | null | undefined>) {
    return Math.min(...requireValues(values));
  },
  max(values: ReadonlyArray<number | null | undefined>) {
    return Math.max(...requireValues(values));
  },
  range(values: ReadonlyArray<number | null | undefined>) {
    const v = requireValues(values);
    return Math.max(...v) - Math.min(...v);
  },
  /** Sample standard deviation (n − 1). */
  sd(values: ReadonlyArray<number | null | undefined>) {
    const v = requireValues(values, 2);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  },
  rsd(values: ReadonlyArray<number | null | undefined>) {
    const m = stats.mean(values);
    if (m === 0) throw new CalcError("RSD undefined: mean is zero (division by zero prevented)");
    return (stats.sd(values) / Math.abs(m)) * 100;
  },
  regression(points: ReadonlyArray<{ x: number | null; y: number | null }>) {
    if (points.length < 2) throw new CalcError("Linearity requires at least 2 levels");
    const xs = requireValues(points.map(p => p.x), 2, "level reference values");
    const ys = requireValues(points.map(p => p.y), 2, "level results");
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const syy = ys.reduce((a, y) => a + (y - my) ** 2, 0);
    const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
    if (sxx === 0) throw new CalcError("Linearity undefined: all level reference values are identical");
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    if (syy === 0) throw new CalcError("Correlation undefined: all level results are identical");
    const r = sxy / Math.sqrt(sxx * syy);
    return { slope, intercept, r, r2: r * r };
  },
};

/* ------------------------------------------------------------------ */
/* Rounding                                                             */
/* ------------------------------------------------------------------ */

/** Round half away from zero (avoids binary floating artefacts such as 1.005 → 1.00). */
export function roundDecimals(value: number, decimals: number) {
  const factor = 10 ** decimals;
  const shifted = Number((Math.abs(value) * factor).toPrecision(15));
  return (Math.sign(value) * Math.round(shifted)) / factor;
}

export function roundSignificant(value: number, figures: number) {
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = figures - 1 - magnitude;
  if (decimals >= 0) return roundDecimals(value, decimals);
  const factor = 10 ** -decimals;
  return Math.sign(value) * Math.round(Math.abs(value) / factor) * factor;
}

export function applyRounding(
  value: number,
  rule: { decimals: number | null; significantFigures: number | null }
) {
  if (rule.significantFigures !== null && rule.significantFigures !== undefined)
    return roundSignificant(value, rule.significantFigures);
  if (rule.decimals !== null && rule.decimals !== undefined) return roundDecimals(value, rule.decimals);
  return value;
}

export function formatValue(value: number | null | undefined, rule?: { decimals: number | null; significantFigures: number | null }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (rule?.decimals !== null && rule?.decimals !== undefined && rule.significantFigures == null)
    return value.toFixed(rule.decimals);
  return String(Number(value.toPrecision(12)));
}

/* ------------------------------------------------------------------ */
/* Formula parser                                                       */
/* ------------------------------------------------------------------ */

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const numberMatch = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (numberMatch) {
      tokens.push({ t: "num", v: Number(numberMatch[0]) });
      i += numberMatch[0].length;
      continue;
    }
    const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (idMatch) {
      tokens.push({ t: "id", v: idMatch[0] });
      i += idMatch[0].length;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new CalcError(`Unexpected character "${c}" in formula`);
  }
  return tokens;
}

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; arg: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  ln: { min: 1, max: 1 },
  log10: { min: 1, max: 1 },
  pow: { min: 2, max: 2 },
  min: { min: 1, max: 50 },
  max: { min: 1, max: 50 },
  mean: { min: 1, max: 50 },
  sum: { min: 1, max: 50 },
  sd: { min: 1, max: 50 },
  rsd: { min: 1, max: 50 },
  count: { min: 1, max: 1 },
};

export function parseFormula(src: string): Node {
  if (!src.trim()) throw new CalcError("Formula is empty");
  if (src.length > 500) throw new CalcError("Formula is too long");
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v?: string) => {
    const tok = tokens[pos];
    if (!tok || (v !== undefined && !(tok.t === "op" && tok.v === v)))
      throw new CalcError(`Expected "${v ?? "token"}" in formula`);
    pos++;
    return tok;
  };
  function expr(): Node {
    let node = term();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = eat().v as string;
      node = { k: "bin", op, a: node, b: term() };
    }
    return node;
  }
  function term(): Node {
    let node = unary();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = eat().v as string;
      node = { k: "bin", op, a: node, b: unary() };
    }
    return node;
  }
  function unary(): Node {
    if (peek()?.t === "op" && peek()!.v === "-") {
      eat();
      return { k: "neg", arg: unary() };
    }
    if (peek()?.t === "op" && peek()!.v === "+") {
      eat();
      return unary();
    }
    return power();
  }
  function power(): Node {
    const base = primary();
    if (peek()?.t === "op" && peek()!.v === "^") {
      eat();
      return { k: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  }
  function primary(): Node {
    const tok = peek();
    if (!tok) throw new CalcError("Unexpected end of formula");
    if (tok.t === "num") {
      pos++;
      return { k: "num", v: tok.v };
    }
    if (tok.t === "id") {
      pos++;
      if (peek()?.t === "op" && peek()!.v === "(") {
        const spec = FUNCTIONS[tok.v];
        if (!spec) throw new CalcError(`Unknown function "${tok.v}"`);
        eat("(");
        const args: Node[] = [];
        if (!(peek()?.t === "op" && peek()!.v === ")")) {
          args.push(expr());
          while (peek()?.t === "op" && peek()!.v === ",") {
            eat(",");
            args.push(expr());
          }
        }
        eat(")");
        if (args.length < spec.min || args.length > spec.max)
          throw new CalcError(`Function ${tok.v} expects ${spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`} argument(s)`);
        return { k: "call", fn: tok.v, args };
      }
      return { k: "var", name: tok.v };
    }
    if (tok.v === "(") {
      eat("(");
      const node = expr();
      eat(")");
      return node;
    }
    throw new CalcError(`Unexpected "${tok.v}" in formula`);
  }
  const tree = expr();
  if (pos !== tokens.length) throw new CalcError(`Unexpected "${(tokens[pos] as Token).v}" in formula`);
  return tree;
}

export function formulaVariables(src: string): string[] {
  const names = new Set<string>();
  const walk = (node: Node) => {
    if (node.k === "var") names.add(node.name);
    if (node.k === "neg") walk(node.arg);
    if (node.k === "bin") {
      walk(node.a);
      walk(node.b);
    }
    if (node.k === "call") node.args.forEach(walk);
  };
  walk(parseFormula(src));
  return Array.from(names);
}

function evalNode(node: Node, vars: CalcVariables): CalcValue {
  switch (node.k) {
    case "num":
      return node.v;
    case "var": {
      const value = Object.prototype.hasOwnProperty.call(vars, node.name) ? vars[node.name] : undefined;
      if (value === undefined) throw new CalcError(`Unknown variable "${node.name}"`);
      if (value === null) throw new CalcError(`Input "${node.name}" is missing; missing values are not treated as zero`);
      if (Array.isArray(value)) requireValues(value, 1, `values in "${node.name}"`);
      else if (!Number.isFinite(value)) throw new CalcError(`Input "${node.name}" is not a finite number`);
      return value;
    }
    case "neg": {
      const v = scalar(evalNode(node.arg, vars), "negation");
      return -v;
    }
    case "bin": {
      const a = scalar(evalNode(node.a, vars), node.op);
      const b = scalar(evalNode(node.b, vars), node.op);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      if (node.op === "/") {
        if (b === 0) throw new CalcError("Division by zero prevented");
        return a / b;
      }
      const result = a ** b;
      if (!Number.isFinite(result)) throw new CalcError("Power operation produced a non-finite result");
      return result;
    }
    case "call": {
      const args = node.args.map(arg => evalNode(arg, vars));
      const flat = args.flatMap(a => (Array.isArray(a) ? a : [a]));
      switch (node.fn) {
        case "abs":
          return Math.abs(scalar(args[0], "abs"));
        case "sqrt": {
          const v = scalar(args[0], "sqrt");
          if (v < 0) throw new CalcError("Square root of a negative value");
          return Math.sqrt(v);
        }
        case "ln":
        case "log10": {
          const v = scalar(args[0], node.fn);
          if (v <= 0) throw new CalcError(`${node.fn} of a non-positive value`);
          return node.fn === "ln" ? Math.log(v) : Math.log10(v);
        }
        case "pow": {
          const r = scalar(args[0], "pow") ** scalar(args[1], "pow");
          if (!Number.isFinite(r)) throw new CalcError("pow produced a non-finite result");
          return r;
        }
        case "min":
          return stats.min(flat);
        case "max":
          return stats.max(flat);
        case "mean":
          return stats.mean(flat);
        case "sum":
          return requireValues(flat).reduce((x, y) => x + y, 0);
        case "sd":
          return stats.sd(flat);
        case "rsd":
          return stats.rsd(flat);
        case "count":
          return flat.length;
      }
      throw new CalcError(`Unknown function ${node.fn}`);
    }
  }
}

function scalar(value: CalcValue, context: string): number {
  if (Array.isArray(value)) throw new CalcError(`A series cannot be used directly with "${context}"; aggregate it first (e.g. mean(readings))`);
  return value;
}

export function evaluateFormula(src: string, vars: CalcVariables): number {
  const result = evalNode(parseFormula(src), vars);
  if (Array.isArray(result)) throw new CalcError("Formula must produce a single value; aggregate series with mean(), sd(), …");
  if (!Number.isFinite(result)) throw new CalcError("Formula produced a non-finite result");
  return result;
}

/* ------------------------------------------------------------------ */
/* Configured calculations                                              */
/* ------------------------------------------------------------------ */

/** Formula text stored with each result so executions remain reproducible. */
export const BUILTIN_FORMULA_TEXT: Record<Exclude<CalcKind, "custom">, string> = {
  mean: "mean = Σxᵢ / n",
  min: "min = min(xᵢ)",
  max: "max = max(xᵢ)",
  range: "range = max(xᵢ) − min(xᵢ)",
  sd: "s = √(Σ(xᵢ − x̄)² / (n − 1))",
  rsd: "RSD% = s / |x̄| × 100",
  repeatability: "repeatability s = √(Σ(xᵢ − x̄)² / (n − 1))",
  error: "difference = x̄ − reference",
  "abs-error": "absolute error = |x̄ − reference|",
  "pct-error": "error% = (x̄ − reference) / reference × 100",
  "pct-difference": "difference% = |x̄ − reference| / ((x̄ + reference) / 2) × 100",
  "max-abs-deviation": "max |xᵢ − reference|",
  "linearity-slope": "least-squares slope of level means vs level reference values",
  "linearity-intercept": "least-squares intercept of level means vs level reference values",
  "linearity-r": "Pearson r of level means vs level reference values",
  "linearity-r2": "r² of level means vs level reference values",
  "max-level-abs-error": "max over levels of |level mean − level reference|",
  "level-reference-at-max": "x at max(y): level reference value whose response (level mean) is the maximum; ties flagged for review",
};

/**
 * Level with the maximum response (level mean). Returns every tied level so a
 * tie is never resolved silently.
 */
export function levelArgMax(levels: ReadonlyArray<{ key: string; reference: number | null; values: ReadonlyArray<number | null> }>) {
  if (!levels.length) throw new CalcError("No levels configured");
  const rows = levels.map(l => {
    if (l.reference === null || l.reference === undefined || !Number.isFinite(l.reference)) throw new CalcError(`Level ${l.key} has no reference value`);
    return { key: l.key, reference: l.reference, value: stats.mean(l.values) };
  });
  const max = Math.max(...rows.map(r => r.value));
  const tied = rows.filter(r => r.value === max);
  return { max, reference: tied[0].reference, key: tied[0].key, ties: tied };
}

export type CalcInputs = {
  values: Array<number | null>;
  reference: number | null;
  levels?: Array<{ key: string; reference: number | null; values: Array<number | null> }>;
  variables?: CalcVariables;
};

export function runCalculation(calc: Pick<Calculation, "kind" | "formula">, input: CalcInputs): number {
  const needReference = () => {
    if (input.reference === null || input.reference === undefined || !Number.isFinite(input.reference))
      throw new CalcError("A reference / nominal value is required for this calculation");
    return input.reference;
  };
  switch (calc.kind) {
    case "mean":
      return stats.mean(input.values);
    case "min":
      return stats.min(input.values);
    case "max":
      return stats.max(input.values);
    case "range":
      return stats.range(input.values);
    case "sd":
    case "repeatability":
      return stats.sd(input.values);
    case "rsd":
      return stats.rsd(input.values);
    case "error":
      return stats.mean(input.values) - needReference();
    case "abs-error":
      return Math.abs(stats.mean(input.values) - needReference());
    case "pct-error": {
      const ref = needReference();
      if (ref === 0) throw new CalcError("Percentage error undefined: reference is zero (division by zero prevented)");
      return ((stats.mean(input.values) - ref) / ref) * 100;
    }
    case "pct-difference": {
      const ref = needReference();
      const m = stats.mean(input.values);
      const avg = (m + ref) / 2;
      if (avg === 0) throw new CalcError("Percentage difference undefined: average is zero");
      return (Math.abs(m - ref) / Math.abs(avg)) * 100;
    }
    case "max-abs-deviation": {
      const ref = needReference();
      return Math.max(...requireValues(input.values).map(v => Math.abs(v - ref)));
    }
    case "linearity-slope":
    case "linearity-intercept":
    case "linearity-r":
    case "linearity-r2": {
      const levels = input.levels ?? [];
      const reg = stats.regression(levels.map(l => ({ x: l.reference, y: l.values.length ? stats.mean(l.values) : null })));
      return calc.kind === "linearity-slope" ? reg.slope : calc.kind === "linearity-intercept" ? reg.intercept : calc.kind === "linearity-r" ? reg.r : reg.r2;
    }
    case "max-level-abs-error": {
      const levels = input.levels ?? [];
      if (!levels.length) throw new CalcError("No levels configured");
      return Math.max(
        ...levels.map(l => {
          if (l.reference === null) throw new CalcError(`Level ${l.key} has no reference value`);
          return Math.abs(stats.mean(l.values) - l.reference);
        })
      );
    }
    case "level-reference-at-max":
      return levelArgMax(input.levels ?? []).reference;
    case "custom":
      return evaluateFormula(calc.formula, input.variables ?? {});
  }
}
