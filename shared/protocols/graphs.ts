/**
 * Graph data for protocol tests, derived ONLY from the readings and reference
 * values actually recorded for a test. A graph is produced only when the test
 * definition asks for it AND the required data exist — no decorative or
 * fabricated curves. The data are stored with the evaluation (and therefore
 * with every recorded validation), so a report regenerated later shows exactly
 * the graph of the readings used at the time.
 */
import type { GraphSpec, GraphType, ProtocolTest } from "./model";
import { GRAPH_TYPES } from "./model";
import { stats } from "./calc";

export type GraphPoint = { x: number; y: number; label: string };
export type GraphSeries = { name: string; kind: "points" | "line"; points: GraphPoint[] };
export type GraphData = {
  key: string;
  testKey: string;
  testName: string;
  type: GraphType;
  title: string;
  xLabel: string;
  yLabel: string;
  series: GraphSeries[];
  /** Linear regression of the measured points (calibration-curve only). */
  regression: { slope: number; intercept: number; r: number; r2: number; n: number } | null;
  /** Horizontal reference lines (e.g. zero error, mean, mean ± SD). */
  guides: Array<{ name: string; y: number }>;
  notes: string[];
};

export type GraphInput = {
  readings: Array<number | null>;
  reference: number | null;
  levels: Array<{ key: string; label: string; group?: string; reference: number | null; values: Array<number | null> }>;
  /** Named readings of each level (reading i ↔ readingKeys[i]). */
  readingKeys?: Array<{ key: string; label: string; unit: string }>;
  /** Unrounded per-level calculation results: levelKey → calcKey → value. */
  levelCalcs?: Record<string, Record<string, number | null>>;
  calcUnits?: Record<string, { label: string; unit: string }>;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const unitText = (u: string) => (u ? ` (${u})` : "");

function levelPoints(input: GraphInput) {
  return input.levels
    .map(l => {
      const vals = l.values.filter(finite);
      return vals.length && finite(l.reference) ? { label: l.label || l.key, x: l.reference, y: stats.mean(vals) } : null;
    })
    .filter((p): p is { label: string; x: number; y: number } => p !== null);
}

function regression(points: Array<{ x: number; y: number }>) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const syy = points.reduce((a, p) => a + (p.y - my) ** 2, 0);
  const sxy = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = syy === 0 ? 1 : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, r, r2: r * r, n };
}

function defaultTitle(type: GraphType, testName: string) {
  return `${GRAPH_TYPES.find(g => g.id === type)?.label.split(" (")[0] ?? type} — ${testName}`;
}

/** Builds the configured graphs of one test. Returns [] when no graph is configured or data are insufficient. */
export function buildTestGraphs(test: Pick<ProtocolTest, "key" | "name" | "unit" | "dataType" | "graphs"> & { levelName?: string }, input: GraphInput): GraphData[] {
  const out: GraphData[] = [];
  const u = test.unit ?? "";
  (test.graphs ?? []).forEach((spec: GraphSpec, index) => {
    const base = {
      key: `${test.key}:${spec.type}:${index}`,
      testKey: test.key,
      testName: test.name,
      type: spec.type,
      title: spec.title.trim() || defaultTitle(spec.type, test.name),
      regression: null,
      guides: [] as GraphData["guides"],
      notes: [] as string[],
    };
    const lp = levelPoints(input);
    const seriesReadings = input.readings.filter(finite);
    const seriesRef = finite(input.reference) ? input.reference : null;
    switch (spec.type) {
      case "measured-vs-reference": {
        if (lp.length < 2) return;
        const lo = Math.min(...lp.map(p => p.x));
        const hi = Math.max(...lp.map(p => p.x));
        out.push({
          ...base,
          xLabel: spec.xLabel.trim() || `Reference value${unitText(u)}`,
          yLabel: spec.yLabel.trim() || `Measured value (mean)${unitText(u)}`,
          series: [
            { name: "Measured (level mean)", kind: "points", points: lp.map(p => ({ x: p.x, y: p.y, label: p.label })) },
            { name: "Ideal (measured = reference)", kind: "line", points: [{ x: lo, y: lo, label: "" }, { x: hi, y: hi, label: "" }] },
          ],
        });
        return;
      }
      case "calibration-curve": {
        const reg = regression(lp);
        if (!reg || lp.length < 3) return;
        const lo = Math.min(...lp.map(p => p.x));
        const hi = Math.max(...lp.map(p => p.x));
        out.push({
          ...base,
          xLabel: spec.xLabel.trim() || `Reference value${unitText(u)}`,
          yLabel: spec.yLabel.trim() || `Measured response${unitText(u)}`,
          series: [
            { name: "Measured (level mean)", kind: "points", points: lp.map(p => ({ x: p.x, y: p.y, label: p.label })) },
            { name: `Regression y = ${fmt(reg.intercept)} + ${fmt(reg.slope)}·x`, kind: "line", points: [lo, hi].map(x => ({ x, y: reg.intercept + reg.slope * x, label: "" })) },
          ],
          regression: reg,
          notes: [`n = ${reg.n}; slope = ${fmt(reg.slope)}; intercept = ${fmt(reg.intercept)}; r = ${fmt(reg.r)}; r² = ${fmt(reg.r2)}`],
        });
        return;
      }
      case "error":
      case "deviation": {
        const pct = spec.type === "deviation";
        let points: GraphPoint[] = [];
        let xLabel = "";
        if (lp.length) {
          points = lp.map(p => ({ x: p.x, y: pct ? ((p.y - p.x) / p.x) * 100 : p.y - p.x, label: p.label })).filter(p => finite(p.y));
          xLabel = `Reference value${unitText(u)}`;
        } else if (seriesReadings.length && seriesRef !== null) {
          points = seriesReadings.map((v, i) => ({ x: i + 1, y: pct ? ((v - seriesRef) / seriesRef) * 100 : v - seriesRef, label: `#${i + 1}` })).filter(p => finite(p.y));
          xLabel = "Reading number";
        }
        if (points.length < 1) return;
        out.push({
          ...base,
          xLabel: spec.xLabel.trim() || xLabel,
          yLabel: spec.yLabel.trim() || (pct ? "Deviation (%)" : `Error (measured − reference)${unitText(u)}`),
          series: [{ name: pct ? "Deviation (%)" : "Error", kind: "points", points }],
          guides: [{ name: "Zero", y: 0 }],
        });
        return;
      }
      case "level-xy": {
        const g = levelXY(test, spec, input);
        if (g) out.push({ ...base, ...g, title: base.title });
        return;
      }
      case "repeatability": {
        if (seriesReadings.length < 2) return;
        const m = stats.mean(seriesReadings);
        const sd = stats.sd(seriesReadings);
        out.push({
          ...base,
          xLabel: spec.xLabel.trim() || "Reading number",
          yLabel: spec.yLabel.trim() || `Reading${unitText(u)}`,
          series: [{ name: "Readings", kind: "points", points: seriesReadings.map((v, i) => ({ x: i + 1, y: v, label: `#${i + 1}` })) }],
          guides: [{ name: "Mean", y: m }, { name: "Mean + SD", y: m + sd }, { name: "Mean − SD", y: m - sd }, ...(seriesRef !== null ? [{ name: "Reference", y: seriesRef }] : [])],
          notes: [`n = ${seriesReadings.length}; mean = ${fmt(m)}; SD = ${fmt(sd)}`],
        });
        return;
      }
    }
  });
  return out;
}

export function fmt(v: number) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e7)) return v.toExponential(4);
  return String(Number(v.toPrecision(7)));
}

/**
 * Per-level values: x = level reference (set value), y = a named reading or a
 * per-level calculation of that level. Levels with a missing / invalid y are
 * left out; the graph is not drawn when fewer than 2 points exist (or 3 for a
 * regression line). One series per level group.
 */
function levelXY(test: { unit: string; levelName?: string }, spec: GraphSpec, input: GraphInput): Omit<GraphData, "key" | "testKey" | "testName" | "type" | "title"> | null {
  const yKey = spec.y?.trim();
  if (!yKey) return null;
  const readingIndex = (input.readingKeys ?? []).findIndex(r => r.key === yKey);
  const reading = readingIndex >= 0 ? input.readingKeys![readingIndex] : null;
  const calc = input.calcUnits?.[yKey] ?? null;
  if (!reading && !calc) return null;
  const pts = input.levels
    .map(l => {
      const y = reading ? l.values[readingIndex] : input.levelCalcs?.[l.key]?.[yKey];
      return finite(l.reference) && finite(y) ? { x: l.reference, y, label: l.label || l.key, group: l.group ?? "" } : null;
    })
    .filter((p): p is { x: number; y: number; label: string; group: string } => p !== null);
  if (pts.length < 2) return null;
  const line = spec.line ?? "none";
  const yName = reading ? reading.label || reading.key : calc!.label;
  const yUnit = reading ? reading.unit : calc!.unit;
  const groups = Array.from(new Set(pts.map(p => p.group)));
  const series: GraphSeries[] = [];
  groups.forEach(gname => {
    const gp = pts.filter(p => p.group === gname).sort((a, b) => a.x - b.x);
    const name = gname || yName;
    series.push({ name, kind: "points", points: gp.map(p => ({ x: p.x, y: p.y, label: p.label })) });
    if (line === "connect" && gp.length >= 2) series.push({ name: `${name} (connected)`, kind: "line", points: gp.map(p => ({ x: p.x, y: p.y, label: "" })) });
  });
  const lo = Math.min(...pts.map(p => p.x));
  const hi = Math.max(...pts.map(p => p.x));
  let reg: GraphData["regression"] = null;
  const notes: string[] = [];
  if (line === "identity") series.push({ name: "Ideal (y = x)", kind: "line", points: [{ x: lo, y: lo, label: "" }, { x: hi, y: hi, label: "" }] });
  if (line === "regression") {
    reg = regression(pts);
    if (!reg || pts.length < 3) return null;
    const r = reg;
    series.push({ name: `Regression y = ${fmt(r.slope)}·x ${r.intercept < 0 ? "−" : "+"} ${fmt(Math.abs(r.intercept))}`, kind: "line", points: [lo, hi].map(x => ({ x, y: r.intercept + r.slope * x, label: "" })) });
    notes.push(`y = ${fmt(r.slope)}·x ${r.intercept < 0 ? "−" : "+"} ${fmt(Math.abs(r.intercept))}; r = ${fmt(r.r)}; R² = ${fmt(r.r2)}; n = ${r.n}`);
  }
  if (spec.markMax) {
    const max = Math.max(...pts.map(p => p.y));
    const tied = pts.filter(p => p.y === max);
    series.push({ name: `Maximum ${fmt(max)} at ${tied.map(p => fmt(p.x)).join(", ")}${tied.length > 1 ? " (tie — review)" : ""}`, kind: "points", points: tied.map(p => ({ x: p.x, y: p.y, label: "max" })) });
    notes.push(`Maximum response ${fmt(max)} at x = ${tied.map(p => fmt(p.x)).join(", ")}${tied.length > 1 ? " — tie flagged for review" : ""}`);
  }
  const guides: GraphData["guides"] = [];
  if (spec.meanGuide) {
    const m = stats.mean(pts.map(p => p.y));
    guides.push({ name: "Mean", y: m });
    notes.push(`n = ${pts.length}; mean = ${fmt(m)}`);
  }
  (spec.guideLines ?? []).forEach(g => guides.push({ name: g.name, y: g.y }));
  const levelUnit = test.unit ? ` (${test.unit})` : "";
  return {
    xLabel: spec.xLabel.trim() || `${test.levelName || "Level value"}${levelUnit}`,
    yLabel: spec.yLabel.trim() || `${yName}${unitText(yUnit)}`,
    series,
    regression: reg,
    guides,
    notes,
  };
}
