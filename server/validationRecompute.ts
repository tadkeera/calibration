import type { CalibrationResult } from "../client/src/lib/qc";
import {
  createPolarimeterProtocolSnapshot,
  evaluatePolarimeterInputs,
  parseMeasurement,
  toPolarimeterCalculatedMetrics,
  type PolarimeterV2,
} from "../shared/polarimeter";

type ResultRow = { actual: string; pass: boolean };
type ResultPayload = Partial<CalibrationResult> & {
  rows?: CalibrationResult["rows"];
  overall?: boolean;
  chart?: { label?: string; value: number; reference?: number }[];
  reportCharts?: { data: { value: number }[] }[];
  polarimeterData?: PolarimeterV2;
};

const numeric = (value: string) =>
  Number.parseFloat(value.replace(/,/g, "").replace(/[^0-9.+-]/g, ""));
const timestampSeconds = (value: string) => {
  const match = value.trim().match(/^(\d{1,2})[.:](\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : numeric(value);
};
const between = (value: number, min: number, max: number) =>
  value >= min && value <= max;
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const sampleStd = (values: number[]) => {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      Math.max(1, values.length - 1)
  );
};
const correlation = (x: number[], y: number[]) => {
  const count = Math.min(x.length, y.length);
  if (count < 2) return 0;
  const avgX = mean(x.slice(0, count));
  const avgY = mean(y.slice(0, count));
  const numerator = x
    .slice(0, count)
    .reduce((sum, value, index) => sum + (value - avgX) * (y[index] - avgY), 0);
  const denominator = Math.sqrt(
    x.slice(0, count).reduce((sum, value) => sum + (value - avgX) ** 2, 0) *
      y.slice(0, count).reduce((sum, value) => sum + (value - avgY) ** 2, 0)
  );
  return denominator ? numerator / denominator : 0;
};
const actuals = (payload: ResultPayload) =>
  payload.rows?.map(row => numeric(row.actual)) ?? [];
const chartValues = (payload: ResultPayload) =>
  payload.chart?.map(point => point.value) ?? [];
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      )
      .join(",")}}`;
  return JSON.stringify(value);
};

export function recomputeValidationPasses(
  deviceKey: string,
  payload: ResultPayload,
  settings: Record<string, any>
) {
  const values = actuals(payload);
  let passes: boolean[] = [];
  if (deviceKey === "disintegration") {
    if (values.length !== 6)
      throw new Error("Incomplete disintegration readings");
    passes = [
      Math.abs(values[0] - settings.bathSet) <= settings.bathTolerance,
      between(values[1], settings.mediumMin, settings.mediumMax),
      between(
        timestampSeconds(payload.rows?.[2]?.actual ?? ""),
        settings.timeMin,
        settings.timeMax
      ),
      ...values
        .slice(3)
        .map(value => between(value, settings.cycleMin, settings.cycleMax)),
    ];
  } else if (deviceKey === "refractometer") {
    if (values.length !== settings.standards.length + 3)
      throw new Error("Incomplete refractometer readings");
    const standards = values.slice(2, 2 + settings.standards.length);
    passes = [
      between(values[0], settings.zeroMin, settings.zeroMax),
      between(values[1], settings.spanMin, settings.spanMax),
      ...standards.map((value: number, index: number) =>
        between(
          value,
          settings.standards[index].min,
          settings.standards[index].max
        )
      ),
      correlation(
        settings.standards.map((item: any) => item.nominal),
        standards
      ) >= settings.rLimit,
    ];
  } else if (deviceKey === "dissolution") {
    if (values.length !== 24)
      throw new Error("Incomplete dissolution readings");
    passes = [
      Math.abs(values[0] - settings.bathSet) <= settings.bathTolerance,
      ...values
        .slice(1, 7)
        .map(value => between(value, settings.vesselMin, settings.vesselMax)),
      ...values
        .slice(7, 12)
        .map((value, index) =>
          between(value, settings.speeds[index].min, settings.speeds[index].max)
        ),
      ...values.slice(12).map(value => value <= settings.wobbleMax),
    ];
  } else if (deviceKey === "hplc") {
    const sets =
      payload.reportCharts?.map(chart =>
        chart.data.map(point => point.value)
      ) ?? [];
    if (
      sets.length !== settings.flows.length ||
      sets.some(set => set.length !== 10)
    )
      throw new Error("Incomplete HPLC readings");
    passes = sets.map((set, index) => {
      const average = mean(set);
      const deviation =
        (Math.abs(average - settings.flows[index].nominal) /
          settings.flows[index].nominal) *
        100;
      const rsd = (sampleStd(set) / average) * 100;
      return (
        between(
          average,
          settings.flows[index].min,
          settings.flows[index].max
        ) &&
        deviation <= settings.devLimit &&
        rsd <= settings.rsdLimit
      );
    });
  } else if (deviceKey === "spectrophotometer") {
    if (values.length !== 17)
      throw new Error("Incomplete spectrophotometer readings");
    const waves = values.slice(0, 10);
    const absorbance = values.slice(10, 14);
    const line = chartValues(payload);
    passes = [
      ...waves.map((value, index) =>
        between(
          value,
          settings.wavelengths[index].min,
          settings.wavelengths[index].max
        )
      ),
      ...absorbance.map((value, index) =>
        between(
          value,
          settings.absorbance[index].min,
          settings.absorbance[index].max
        )
      ),
      Math.abs(values[14] - settings.wavelengthAccuracy) <=
        settings.wavelengthTolerance,
      values[15] >= settings.strayMin,
      correlation([20, 40, 60, 80, 100], line) >= settings.rLimit,
    ];
  } else if (deviceKey === "moisture") {
    if (values.length !== 15) throw new Error("Incomplete moisture readings");
    passes = [
      Math.abs(values[0] - settings.spanWeight) <= settings.spanTolerance,
      ...values
        .slice(1, 7)
        .map(
          value =>
            Math.abs(value - settings.reproducibilityWeight) <=
            settings.reproducibilityTolerance
        ),
      ...values
        .slice(7, 14)
        .map(
          value =>
            Math.abs(value - settings.offCenterWeight) <=
            settings.offCenterTolerance
        ),
      correlation([0, 5, 10, 20, 30], chartValues(payload)) >= settings.rLimit,
    ];
  } else if (deviceKey === "polarimeter") {
    throw new Error(
      "Polarimeter results must use the versioned primary-input validation path"
    );
  } else if (deviceKey === "viscometer") {
    if (values.length !== 4) throw new Error("Incomplete viscometer readings");
    passes = [
      ...values
        .slice(0, 3)
        .map((value, index) =>
          between(
            value,
            settings.standards[index].min,
            settings.standards[index].max
          )
        ),
      correlation([50, 1000, 5000, 12500], chartValues(payload)) >=
        settings.rLimit,
    ];
  } else {
    throw new Error("Unsupported validation instrument");
  }
  return passes;
}

function polarimeterDisplay(value: number | null | undefined, precision = 4) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "Not defined"
    : value.toFixed(precision);
}

export function buildPolarimeterDerivedResult(
  data: PolarimeterV2,
  controlledSettings: Record<string, any>
) {
  const protocol = createPolarimeterProtocolSnapshot(controlledSettings);
  if (
    data.schemaVersion !== 2 ||
    data.equipmentSnapshot?.instrumentKey !== "polarimeter"
  )
    throw new Error("Invalid Polarimeter v2 payload or equipment snapshot");
  if (canonicalJson(data.protocolSnapshot) !== canonicalJson(protocol))
    throw new Error(
      "The submitted Polarimeter protocol snapshot does not match the current server-controlled settings"
    );
  const evaluation = evaluatePolarimeterInputs(data, protocol);
  if (
    evaluation.overallPass === null ||
    !evaluation.metrics.repeatability ||
    !evaluation.metrics.regression ||
    !evaluation.testResults.accuracy ||
    !evaluation.testResults.repeatability ||
    !evaluation.testResults.linearity
  ) {
    throw new Error(
      "Polarimeter primary measurements are incomplete or undefined"
    );
  }
  const statistics = evaluation.metrics.repeatability;
  const regressionResult = evaluation.metrics.regression;
  const methodLabels: Record<string, string> = {
    "first-reading-deviation": "absolute deviation from first reading",
    "reference-value-deviation":
      "absolute deviation from protocol reference value",
    "mean-deviation": "absolute deviation from the mean",
    "maximum-range": "maximum permitted range",
    "sample-standard-deviation": "sample standard deviation",
    "rsd-percent": "relative standard deviation",
  };
  const repeatUnit = protocol.repeatability.unit === "%" ? "%" : "°";
  const perReadingMethods = new Set([
    "first-reading-deviation",
    "reference-value-deviation",
    "mean-deviation",
  ]);
  const rows: CalibrationResult["rows"] = [
    {
      test: "Accuracy — specific optical rotation",
      expected: `${protocol.accuracy.lowerLimit} to ${protocol.accuracy.upperLimit} °`,
      actual: `${polarimeterDisplay(evaluation.metrics.specificRotation, protocol.accuracy.displayPrecision)} °`,
      pass: evaluation.testResults.accuracy === "pass",
    },
    ...(perReadingMethods.has(protocol.repeatability.method)
      ? data.repeatability.readings.map((reading, index) => ({
          test: `Repeatability reading ${index + 1}`,
          expected: `${methodLabels[protocol.repeatability.method]} ≤ ${protocol.repeatability.tolerance} ${repeatUnit}`,
          actual: `${reading || "Not recorded"} °`,
          pass: statistics.individualPasses[index] ?? false,
        }))
      : []),
    {
      test: "Repeatability — overall result",
      expected: `${methodLabels[protocol.repeatability.method]} ≤ ${protocol.repeatability.tolerance} ${repeatUnit}`,
      actual: `Mean ${polarimeterDisplay(statistics.mean, 6)} °; range ${polarimeterDisplay(statistics.range, 6)} °; sample SD ${polarimeterDisplay(statistics.sampleStandardDeviation, 6)} °; RSD ${statistics.rsdPercent === null ? "Not defined" : `${polarimeterDisplay(statistics.rsdPercent, 4)}%`}`,
      pass: evaluation.testResults.repeatability === "pass",
    },
    {
      test: `Linearity — ${protocol.linearity.metric === "r2" ? "R²" : "correlation coefficient r"}`,
      expected: `${protocol.linearity.metric === "r2" ? "R²" : "r"} ≥ ${protocol.linearity.minimumMetric}`,
      actual: polarimeterDisplay(
        protocol.linearity.metric === "r2"
          ? regressionResult.r2
          : regressionResult.r,
        protocol.linearity.displayPrecision
      ),
      pass: evaluation.testResults.linearity === "pass",
    },
  ];
  const linearityValue =
    protocol.linearity.metric === "r2"
      ? regressionResult.r2
      : regressionResult.r;
  const metrics = [
    {
      label: "Specific rotation",
      value: `${polarimeterDisplay(evaluation.metrics.specificRotation, protocol.accuracy.displayPrecision)} °`,
      tone:
        evaluation.testResults.accuracy === "pass"
          ? ("success" as const)
          : ("warning" as const),
    },
    {
      label: "Mean",
      value: `${polarimeterDisplay(statistics.mean, 4)} °`,
      tone: "neutral" as const,
    },
    {
      label: "Range",
      value: `${polarimeterDisplay(statistics.range, 4)} °`,
      tone: "neutral" as const,
    },
    {
      label: "Sample standard deviation",
      value: `${polarimeterDisplay(statistics.sampleStandardDeviation, 6)} °`,
      tone: "neutral" as const,
    },
    {
      label: "RSD",
      value:
        statistics.rsdPercent === null
          ? "Not defined"
          : `${polarimeterDisplay(statistics.rsdPercent, 4)}%`,
      tone: "neutral" as const,
    },
    {
      label: "Slope",
      value: polarimeterDisplay(
        regressionResult.slope,
        protocol.linearity.displayPrecision
      ),
      tone: "neutral" as const,
    },
    {
      label: "Intercept",
      value: polarimeterDisplay(
        regressionResult.intercept,
        protocol.linearity.displayPrecision
      ),
      tone: "neutral" as const,
    },
    {
      label: "Correlation coefficient r",
      value: polarimeterDisplay(
        regressionResult.r,
        protocol.linearity.displayPrecision
      ),
      tone: "neutral" as const,
    },
    {
      label: "Coefficient of determination R²",
      value: polarimeterDisplay(
        regressionResult.r2,
        protocol.linearity.displayPrecision
      ),
      tone: "neutral" as const,
    },
    {
      label: "Configured linearity metric",
      value: `${protocol.linearity.metric === "r2" ? "R²" : "r"} = ${polarimeterDisplay(linearityValue, protocol.linearity.displayPrecision)}`,
      tone:
        evaluation.testResults.linearity === "pass"
          ? ("success" as const)
          : ("warning" as const),
    },
  ];
  const chart = data.linearity.points.map(point => {
    const x = protocol.linearity.useActualConcentration
      ? parseMeasurement(point.actualConcentration)
      : point.nominalConcentration;
    const y = parseMeasurement(point.measuredOpticalRotation);
    if (x === null || y === null)
      throw new Error(
        "A Polarimeter linearity point could not be reconstructed"
      );
    return {
      label: String(x),
      value: y,
      reference: regressionResult.slope * x + regressionResult.intercept,
    };
  });
  const calculatedMetrics = toPolarimeterCalculatedMetrics(evaluation);
  const polarimeterData: PolarimeterV2 = {
    ...data,
    protocolSnapshot: protocol,
    calculatedMetrics,
    testResults: {
      accuracy: evaluation.testResults.accuracy,
      repeatability: evaluation.testResults.repeatability,
      linearity: evaluation.testResults.linearity,
    },
    overallResult: evaluation.overallPass ? "pass" : "fail",
  };
  const note =
    protocol.protocolStatus === "pending-verification"
      ? `Protocol ${protocol.protocolId} v${protocol.protocolVersion} is Pending Verification against SOP ${protocol.sopNumber}. This result is a draft calculation and cannot be formally approved until the protocol is verified.`
      : undefined;
  const result: CalibrationResult = {
    deviceKey: "polarimeter",
    rows,
    metrics,
    chart,
    chartTitle: "Concentration vs. Optical Rotation",
    note,
    controlledSettings: JSON.parse(JSON.stringify(controlledSettings)),
    polarimeterData,
    overall: evaluation.overallPass,
    createdAt: "",
  };
  return result;
}

export function assertPolarimeterEquipmentSnapshot(
  inputData: unknown,
  record: {
    instrumentName: string;
    instrumentId: string;
    sopNumber: string;
    formNumber: string;
  },
  profile: {
    nameEn: string;
    instrumentId: string;
    sopNumber: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    formNumber: string;
  }
) {
  if (!inputData || typeof inputData !== "object")
    throw new Error("Missing Polarimeter equipment snapshot");
  const data = inputData as Partial<PolarimeterV2>;
  const equipment = data.equipmentSnapshot;
  const protocol = data.protocolSnapshot;
  if (!equipment || !protocol)
    throw new Error("Missing Polarimeter equipment or protocol snapshot");
  const expected: Array<[string, unknown, unknown]> = [
    ["instrument name", record.instrumentName, profile.nameEn],
    ["equipment ID", record.instrumentId, profile.instrumentId],
    ["manufacturer", equipment.manufacturer, profile.manufacturer],
    ["model", equipment.model, profile.model],
    ["serial number", equipment.serialNumber, profile.serialNumber],
    ["SOP number", record.sopNumber, profile.sopNumber],
    ["form number", record.formNumber, profile.formNumber],
    ["snapshot equipment name", equipment.instrumentName, profile.nameEn],
    ["snapshot equipment ID", equipment.equipmentId, profile.instrumentId],
    ["snapshot SOP number", equipment.sopNumber, profile.sopNumber],
    ["snapshot form number", equipment.formNumber, profile.formNumber],
    ["protocol SOP number", protocol.sopNumber, profile.sopNumber],
    ["protocol form number", protocol.formNumber, profile.formNumber],
  ];
  const mismatches = expected
    .filter(([, submitted, controlled]) => submitted !== controlled)
    .map(([label]) => label);
  if (mismatches.length)
    throw new Error(
      `Polarimeter equipment metadata does not match the existing equipment register: ${mismatches.join(", ")}`
    );
}

export function normalizeServerEvaluatedResult(
  deviceKey: string,
  payload: ResultPayload,
  settings: Record<string, any>,
  submittedStatus: "pass" | "fail"
): {
  resultData: Record<string, unknown>;
  resultStatus: "pass" | "fail";
  overall: boolean;
} {
  if (deviceKey === "polarimeter") {
    if (!payload.polarimeterData)
      throw new Error("Missing versioned Polarimeter primary inputs");
    const recomputed = buildPolarimeterDerivedResult(
      payload.polarimeterData,
      settings
    );
    recomputed.createdAt =
      typeof payload.createdAt === "string" ? payload.createdAt : "";
    const overall = recomputed.overall;
    const resultStatus = overall ? "pass" : "fail";
    const comparisons: [string, unknown, unknown][] = [
      ["rows", payload.rows, recomputed.rows],
      ["metrics", payload.metrics, recomputed.metrics],
      ["chart", payload.chart, recomputed.chart],
      ["chart title", payload.chartTitle, recomputed.chartTitle],
      ["overall status", payload.overall, recomputed.overall],
      [
        "Polarimeter calculated metrics",
        payload.polarimeterData.calculatedMetrics,
        recomputed.polarimeterData?.calculatedMetrics,
      ],
      [
        "Polarimeter individual statuses",
        payload.polarimeterData.testResults,
        recomputed.polarimeterData?.testResults,
      ],
      [
        "Polarimeter overall result",
        payload.polarimeterData.overallResult,
        recomputed.polarimeterData?.overallResult,
      ],
      ["result note", payload.note, recomputed.note],
    ];
    const mismatches = comparisons
      .filter(
        ([, actual, expected]) =>
          canonicalJson(actual) !== canonicalJson(expected)
      )
      .map(([label]) => label);
    if (mismatches.length || submittedStatus !== resultStatus) {
      throw new Error(
        `Polarimeter result does not match server recomputation${mismatches.length ? `: ${mismatches.join(", ")}` : ""}`
      );
    }
    return {
      resultData: recomputed as unknown as Record<string, unknown>,
      resultStatus,
      overall,
    };
  }
  const passes = recomputeValidationPasses(deviceKey, payload, settings);
  const rows = payload.rows ?? [];
  const overall = passes.every(Boolean);
  if (
    passes.length !== rows.length ||
    rows.some((row, index) => row.pass !== passes[index]) ||
    payload.overall !== overall ||
    submittedStatus !== (overall ? "pass" : "fail")
  ) {
    throw new Error(
      "Validation rows or result status do not match the server evaluation"
    );
  }
  return {
    resultData: payload as Record<string, unknown>,
    resultStatus: overall ? "pass" : "fail",
    overall,
  };
}

export function assertServerEvaluatedResult(
  deviceKey: string,
  payload: ResultPayload,
  settings: Record<string, any>,
  submittedStatus: "pass" | "fail"
) {
  return normalizeServerEvaluatedResult(
    deviceKey,
    payload,
    settings,
    submittedStatus
  ).overall;
}
