type ResultRow = { actual: string; pass: boolean };
type ResultPayload = { rows?: ResultRow[]; overall?: boolean; chart?: { value: number }[]; reportCharts?: { data: { value: number }[] }[] };

const numeric = (value: string) => Number.parseFloat(value.replace(/,/g, "").replace(/[^0-9.+-]/g, ""));
const timestampSeconds = (value: string) => { const match = value.trim().match(/^(\d{1,2})[.:](\d{2})$/); return match ? Number(match[1]) * 60 + Number(match[2]) : numeric(value); };
const between = (value: number, min: number, max: number) => value >= min && value <= max;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sampleStd = (values: number[]) => { const average = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length - 1)); };
const correlation = (x: number[], y: number[]) => {
  const count = Math.min(x.length, y.length); if (count < 2) return 0;
  const avgX = mean(x.slice(0, count)); const avgY = mean(y.slice(0, count));
  const numerator = x.slice(0, count).reduce((sum, value, index) => sum + (value - avgX) * (y[index] - avgY), 0);
  const denominator = Math.sqrt(x.slice(0, count).reduce((sum, value) => sum + (value - avgX) ** 2, 0) * y.slice(0, count).reduce((sum, value) => sum + (value - avgY) ** 2, 0));
  return denominator ? numerator / denominator : 0;
};
const actuals = (payload: ResultPayload) => payload.rows?.map((row) => numeric(row.actual)) ?? [];
const chartValues = (payload: ResultPayload) => payload.chart?.map((point) => point.value) ?? [];

export function recomputeValidationPasses(deviceKey: string, payload: ResultPayload, settings: Record<string, any>) {
  const values = actuals(payload);
  let passes: boolean[] = [];
  if (deviceKey === "disintegration") {
    if (values.length !== 6) throw new Error("Incomplete disintegration readings");
    passes = [Math.abs(values[0] - settings.bathSet) <= settings.bathTolerance, between(values[1], settings.mediumMin, settings.mediumMax), between(timestampSeconds(payload.rows?.[2]?.actual ?? ""), settings.timeMin, settings.timeMax), ...values.slice(3).map((value) => between(value, settings.cycleMin, settings.cycleMax))];
  } else if (deviceKey === "refractometer") {
    if (values.length !== settings.standards.length + 3) throw new Error("Incomplete refractometer readings");
    const standards = values.slice(2, 2 + settings.standards.length);
    passes = [between(values[0], settings.zeroMin, settings.zeroMax), between(values[1], settings.spanMin, settings.spanMax), ...standards.map((value: number, index: number) => between(value, settings.standards[index].min, settings.standards[index].max)), correlation(settings.standards.map((item: any) => item.nominal), standards) >= settings.rLimit];
  } else if (deviceKey === "dissolution") {
    if (values.length !== 24) throw new Error("Incomplete dissolution readings");
    passes = [Math.abs(values[0] - settings.bathSet) <= settings.bathTolerance, ...values.slice(1, 7).map((value) => between(value, settings.vesselMin, settings.vesselMax)), ...values.slice(7, 12).map((value, index) => between(value, settings.speeds[index].min, settings.speeds[index].max)), ...values.slice(12).map((value) => value <= settings.wobbleMax)];
  } else if (deviceKey === "hplc") {
    const sets = payload.reportCharts?.map((chart) => chart.data.map((point) => point.value)) ?? [];
    if (sets.length !== settings.flows.length || sets.some((set) => set.length !== 10)) throw new Error("Incomplete HPLC readings");
    passes = sets.map((set, index) => { const average = mean(set); const deviation = Math.abs(average - settings.flows[index].nominal) / settings.flows[index].nominal * 100; const rsd = sampleStd(set) / average * 100; return between(average, settings.flows[index].min, settings.flows[index].max) && deviation <= settings.devLimit && rsd <= settings.rsdLimit; });
  } else if (deviceKey === "spectrophotometer") {
    if (values.length !== 17) throw new Error("Incomplete spectrophotometer readings");
    const waves = values.slice(0, 10); const absorbance = values.slice(10, 14);
    const line = chartValues(payload);
    passes = [...waves.map((value, index) => between(value, settings.wavelengths[index].min, settings.wavelengths[index].max)), ...absorbance.map((value, index) => between(value, settings.absorbance[index].min, settings.absorbance[index].max)), Math.abs(values[14] - settings.wavelengthAccuracy) <= settings.wavelengthTolerance, values[15] >= settings.strayMin, correlation([20, 40, 60, 80, 100], line) >= settings.rLimit];
  } else if (deviceKey === "moisture") {
    if (values.length !== 15) throw new Error("Incomplete moisture readings");
    passes = [Math.abs(values[0] - settings.spanWeight) <= settings.spanTolerance, ...values.slice(1, 7).map((value) => Math.abs(value - settings.reproducibilityWeight) <= settings.reproducibilityTolerance), ...values.slice(7, 14).map((value) => Math.abs(value - settings.offCenterWeight) <= settings.offCenterTolerance), correlation([0, 5, 10, 20, 30], chartValues(payload)) >= settings.rLimit];
  } else if (deviceKey === "polarimeter") {
    if (values.length !== 8) throw new Error("Incomplete polarimeter readings");
    const repeats = values.slice(1, 7);
    passes = [between(values[0], settings.specificMin, settings.specificMax), ...repeats.map((value) => Math.abs(value - repeats[0]) <= settings.repeatTolerance), correlation([10, 20, 30, 40], chartValues(payload)) >= settings.rLimit];
  } else if (deviceKey === "viscometer") {
    if (values.length !== 4) throw new Error("Incomplete viscometer readings");
    passes = [...values.slice(0, 3).map((value, index) => between(value, settings.standards[index].min, settings.standards[index].max)), correlation([50, 1000, 5000, 12500], chartValues(payload)) >= settings.rLimit];
  } else {
    throw new Error("Unsupported validation instrument");
  }
  return passes;
}

export function assertServerEvaluatedResult(deviceKey: string, payload: ResultPayload, settings: Record<string, any>, submittedStatus: "pass" | "fail") {
  const passes = recomputeValidationPasses(deviceKey, payload, settings);
  const rows = payload.rows ?? [];
  const overall = passes.every(Boolean);
  if (passes.length !== rows.length || rows.some((row, index) => row.pass !== passes[index]) || payload.overall !== overall || submittedStatus !== (overall ? "pass" : "fail")) {
    throw new Error("Validation rows or result status do not match the server evaluation");
  }
  return overall;
}
