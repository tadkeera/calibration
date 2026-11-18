export const POLARIMETER_PAYLOAD_VERSION = 2 as const;

export type ProtocolStatus = "pending-verification" | "approved";
export type RepeatabilityMethod =
  | "first-reading-deviation"
  | "reference-value-deviation"
  | "mean-deviation"
  | "maximum-range"
  | "sample-standard-deviation"
  | "rsd-percent";
export type RegressionMetric = "r" | "r2";
export type TestResultStatus = "pass" | "fail";

export interface PolarimeterProtocolSnapshot {
  protocolId: string;
  protocolVersion: string;
  protocolStatus: ProtocolStatus;
  effectiveDate: string | null;
  sopNumber: string;
  formNumber: string;
  accuracy: {
    formula: "100 * alpha / (tubeLengthDm * concentrationGPer100Ml)";
    lowerLimit: number;
    upperLimit: number;
    displayPrecision: number;
    unit: "°";
  };
  repeatability: {
    requiredReadings: number;
    method: RepeatabilityMethod;
    tolerance: number;
    referenceValue: number | null;
    unit: "°" | "%";
    displayPrecision: number;
  };
  linearity: {
    xAxis: "concentration";
    yAxis: "optical-rotation";
    nominalConcentrations: number[];
    concentrationUnit: "g/100ml";
    rotationUnit: "°";
    metric: RegressionMetric;
    minimumMetric: number;
    useActualConcentration: boolean;
    displayPrecision: number;
  };
  conditions: {
    tubeLengthDm: number;
    referenceTemperatureC: number;
    wavelengthLabel: string;
    wavelengthNm: number;
  };
  requiredFields: {
    measurementDateTime: boolean;
    temperature: boolean;
    referenceStandard: boolean;
  };
}

export interface PolarimeterEquipmentSnapshot {
  instrumentKey: "polarimeter";
  instrumentName: string;
  equipmentId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  sopNumber: string;
  formNumber: string;
  department: string | null;
  location: string | null;
  status: string | null;
}

export interface PolarimeterPointInput {
  pointNumber: number;
  nominalConcentration: number;
  actualConcentration: string | null;
  measuredOpticalRotation: string | null;
  notes: string;
}

export interface PolarimeterV2 {
  schemaVersion: typeof POLARIMETER_PAYLOAD_VERSION;
  equipmentSnapshot: PolarimeterEquipmentSnapshot;
  protocolSnapshot: PolarimeterProtocolSnapshot;
  accuracy: {
    opticalRotation: string | null;
    concentrationGPer100Ml: string | null;
    tubeLengthDm: string;
    temperatureC: string | null;
    wavelengthLabel: string;
    wavelengthNm: number;
    measurementDateTime: string;
    referenceStandardId: string;
    referenceStandardExpiryDate: string;
    referenceStandardCertificateNumber: string;
    analystNotes: string;
  };
  repeatability: {
    sampleId: string;
    sampleConcentration: string | null;
    concentrationUnit: "g/100ml";
    readings: string[];
    measurementConditions: string;
    analystNotes: string;
  };
  linearity: {
    points: PolarimeterPointInput[];
    measurementConditions: string;
    analystNotes: string;
  };
  calculatedMetrics: PolarimeterCalculatedMetrics;
  testResults: {
    accuracy: TestResultStatus;
    repeatability: TestResultStatus;
    linearity: TestResultStatus;
  };
  overallResult: TestResultStatus;
}

export interface PolarimeterCalculatedMetrics {
  specificRotation: number;
  repeatabilityMean: number;
  repeatabilityMinimum: number;
  repeatabilityMaximum: number;
  repeatabilityRange: number;
  repeatabilitySampleStandardDeviation: number | null;
  repeatabilityRsdPercent: number | null;
  repeatabilityDeviations: number[];
  regressionSlope: number;
  regressionIntercept: number;
  correlationCoefficient: number | null;
  coefficientOfDetermination: number | null;
  validLinearityPoints: number;
  overall: TestResultStatus;
}

export interface PolarimeterRegression {
  slope: number;
  intercept: number;
  r: number | null;
  r2: number | null;
  count: number;
}

export interface PolarimeterRepeatabilityStatistics {
  count: number;
  mean: number;
  minimum: number;
  maximum: number;
  range: number;
  sampleStandardDeviation: number | null;
  rsdPercent: number | null;
  deviations: number[];
  individualPasses: boolean[];
  overallPass: boolean;
}

export interface PolarimeterEvaluation {
  errors: {
    accuracy: string[];
    repeatability: string[];
    linearity: string[];
  };
  metrics: {
    specificRotation: number | null;
    repeatability: PolarimeterRepeatabilityStatistics | null;
    regression: PolarimeterRegression | null;
  };
  testResults: {
    accuracy: TestResultStatus | null;
    repeatability: TestResultStatus | null;
    linearity: TestResultStatus | null;
  };
  overallPass: boolean | null;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function versionPolarimeterSettings(input: {
  defaults: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  previousUpdatedByUserId: number | null;
  previousUpdatedAt: string | null;
  incoming: Record<string, unknown>;
  userId: number;
  timestamp: string;
}): Record<string, unknown> {
  const previous = { ...input.defaults, ...(input.previous ?? {}) };
  const incoming = { ...input.defaults, ...input.incoming };
  const stripVersionMetadata = (settings: Record<string, unknown>) => {
    const copy = { ...settings };
    delete copy.protocolVersion;
    delete copy.protocolStatus;
    delete copy.protocolEffectiveDate;
    delete copy.protocolHistory;
    return copy;
  };
  const changed =
    canonicalJson(stripVersionMetadata(previous)) !==
    canonicalJson(stripVersionMetadata(incoming));
  const previousVersion = Number.isInteger(previous.protocolVersion)
    ? Number(previous.protocolVersion)
    : 1;
  const incomingVersion = Number.isInteger(incoming.protocolVersion)
    ? Number(incoming.protocolVersion)
    : previousVersion;
  const history = Array.isArray(previous.protocolHistory)
    ? [...previous.protocolHistory]
    : [];
  if (changed) {
    const snapshot = { ...previous };
    delete snapshot.protocolHistory;
    history.push({
      protocolVersion: previousVersion,
      protocolStatus: previous.protocolStatus ?? "pending-verification",
      changedByUserId: input.previousUpdatedByUserId,
      changedAt: input.previousUpdatedAt ?? input.timestamp,
      snapshot,
    });
  }
  return {
    ...incoming,
    protocolVersion: changed
      ? Math.max(incomingVersion, previousVersion + 1)
      : Math.max(incomingVersion, previousVersion),
    protocolStatus: "pending-verification",
    protocolEffectiveDate: null,
    protocolHistory: history.slice(-30),
  };
}

function finiteSetting(settings: Record<string, unknown>, key: string): number {
  const value = settings[key];
  if (!isFiniteNumber(value))
    throw new Error(`Invalid Polarimeter protocol setting: ${key}`);
  return value;
}

function optionalPrecision(
  settings: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 12)
    throw new Error(`Invalid Polarimeter protocol display precision: ${key}`);
  return Number(value);
}

function optionalBoolean(
  settings: Record<string, unknown>,
  key: string,
  fallback: boolean
) {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new Error(`Invalid Polarimeter protocol flag: ${key}`);
  return value;
}

function optionalIdentifier(
  settings: Record<string, unknown>,
  key: string,
  fallback: string
) {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Invalid Polarimeter protocol identifier: ${key}`);
  return value.trim();
}

export function createPolarimeterProtocolSnapshot(
  settings: Record<string, unknown>
): PolarimeterProtocolSnapshot {
  const rawConcentrations = settings.linearityConcentrations;
  const concentrations =
    rawConcentrations === undefined ? [10, 20, 30, 40] : rawConcentrations;
  if (!Array.isArray(concentrations) || !concentrations.every(isFiniteNumber))
    throw new Error("Invalid Polarimeter linearity concentration points");
  const rawMethod = settings.repeatabilityMethod ?? "first-reading-deviation";
  if (!isRepeatabilityMethod(rawMethod))
    throw new Error("Invalid Polarimeter repeatability method");
  const rawMetric = settings.linearityMetric ?? "r";
  if (rawMetric !== "r" && rawMetric !== "r2")
    throw new Error("Invalid Polarimeter linearity metric");
  const rawStatus = settings.protocolStatus ?? "pending-verification";
  if (rawStatus !== "pending-verification" && rawStatus !== "approved")
    throw new Error("Invalid Polarimeter protocol status");
  const rawVersion = settings.protocolVersion ?? 1;
  if (!Number.isInteger(rawVersion) || Number(rawVersion) < 1)
    throw new Error("Invalid Polarimeter protocol version");
  const protocol: PolarimeterProtocolSnapshot = {
    protocolId: optionalIdentifier(settings, "protocolId", "POL-QC-032D"),
    protocolVersion: String(rawVersion),
    protocolStatus: rawStatus,
    effectiveDate:
      settings.protocolEffectiveDate === undefined ||
      settings.protocolEffectiveDate === null
        ? null
        : typeof settings.protocolEffectiveDate === "string" &&
            settings.protocolEffectiveDate.trim()
          ? settings.protocolEffectiveDate
          : (() => {
              throw new Error("Invalid Polarimeter protocol effective date");
            })(),
    sopNumber: optionalIdentifier(settings, "sopNumber", "QC-032D"),
    formNumber: optionalIdentifier(settings, "formNumber", "QC-032B-01"),
    accuracy: {
      formula: "100 * alpha / (tubeLengthDm * concentrationGPer100Ml)",
      lowerLimit: finiteSetting(settings, "specificMin"),
      upperLimit: finiteSetting(settings, "specificMax"),
      displayPrecision: optionalPrecision(settings, "specificPrecision", 4),
      unit: "°",
    },
    repeatability: {
      requiredReadings: finiteSetting(settings, "requiredReadings"),
      method: rawMethod,
      tolerance: finiteSetting(settings, "repeatTolerance"),
      referenceValue:
        settings.repeatReferenceValue === undefined ||
        settings.repeatReferenceValue === null
          ? null
          : finiteSetting(settings, "repeatReferenceValue"),
      unit: rawMethod === "rsd-percent" ? "%" : "°",
      displayPrecision: optionalPrecision(settings, "readingPrecision", 2),
    },
    linearity: {
      xAxis: "concentration",
      yAxis: "optical-rotation",
      nominalConcentrations: [...concentrations],
      concentrationUnit: "g/100ml",
      rotationUnit: "°",
      metric: rawMetric,
      minimumMetric: finiteSetting(settings, "rLimit"),
      useActualConcentration: optionalBoolean(
        settings,
        "linearityUsesActualConcentration",
        false
      ),
      displayPrecision: optionalPrecision(settings, "regressionPrecision", 6),
    },
    conditions: {
      tubeLengthDm: finiteSetting(settings, "tubeLength"),
      referenceTemperatureC: finiteSetting(settings, "referenceTemperatureC"),
      wavelengthLabel: optionalIdentifier(
        settings,
        "wavelengthLabel",
        "Sodium D"
      ),
      wavelengthNm: finiteSetting(settings, "wavelengthNm"),
    },
    requiredFields: {
      measurementDateTime: optionalBoolean(
        settings,
        "measurementDateTimeRequired",
        true
      ),
      temperature: optionalBoolean(settings, "temperatureRequired", false),
      referenceStandard: optionalBoolean(
        settings,
        "referenceStandardRequired",
        false
      ),
    },
  };
  const errors = validatePolarimeterProtocolSnapshot(protocol);
  if (errors.length) throw new Error(errors.join("; "));
  return protocol;
}

export function isRepeatabilityMethod(
  value: unknown
): value is RepeatabilityMethod {
  return (
    value === "first-reading-deviation" ||
    value === "reference-value-deviation" ||
    value === "mean-deviation" ||
    value === "maximum-range" ||
    value === "sample-standard-deviation" ||
    value === "rsd-percent"
  );
}

export function validatePolarimeterProtocolSnapshot(
  protocol: PolarimeterProtocolSnapshot
): string[] {
  const errors: string[] = [];
  if (!protocol.protocolId.trim()) errors.push("Protocol ID is required.");
  if (!protocol.protocolVersion.trim())
    errors.push("Protocol version is required.");
  if (
    protocol.effectiveDate !== null &&
    !isValidDateOnly(protocol.effectiveDate)
  )
    errors.push("Protocol effective date must be a valid calendar date.");
  if (!(protocol.accuracy.lowerLimit < protocol.accuracy.upperLimit))
    errors.push("Specific-rotation limits are invalid.");
  if (
    !Number.isInteger(protocol.repeatability.requiredReadings) ||
    protocol.repeatability.requiredReadings < 2 ||
    protocol.repeatability.requiredReadings > 50
  )
    errors.push("Repeatability reading count must be an integer from 2 to 50.");
  if (protocol.repeatability.tolerance < 0)
    errors.push("Repeatability tolerance cannot be negative.");
  if (
    protocol.repeatability.method === "reference-value-deviation" &&
    protocol.repeatability.referenceValue === null
  )
    errors.push("Reference-value repeatability requires a reference value.");
  if (
    !Number.isFinite(protocol.linearity.minimumMetric) ||
    protocol.linearity.minimumMetric < 0 ||
    protocol.linearity.minimumMetric > 1
  )
    errors.push("The configured linearity threshold must be between 0 and 1.");
  if (
    protocol.linearity.nominalConcentrations.length < 2 ||
    protocol.linearity.nominalConcentrations.length > 20
  )
    errors.push("Linearity requires between 2 and 20 protocol points.");
  if (
    protocol.linearity.nominalConcentrations.some(
      value => !Number.isFinite(value) || value <= 0
    )
  )
    errors.push(
      "Linearity concentrations must be finite and greater than zero."
    );
  if (
    new Set(protocol.linearity.nominalConcentrations).size !==
    protocol.linearity.nominalConcentrations.length
  )
    errors.push("Linearity concentrations must be unique.");
  if (protocol.conditions.tubeLengthDm <= 0)
    errors.push("Tube length must be greater than zero.");
  if (!Number.isFinite(protocol.conditions.referenceTemperatureC))
    errors.push("Reference temperature is invalid.");
  if (protocol.conditions.wavelengthNm <= 0)
    errors.push("Wavelength must be greater than zero.");
  if (
    ![
      protocol.accuracy.displayPrecision,
      protocol.repeatability.displayPrecision,
      protocol.linearity.displayPrecision,
    ].every(value => Number.isInteger(value) && value >= 0 && value <= 12)
  )
    errors.push("Display precision values must be integers from 0 to 12.");
  return errors;
}

export function parseMeasurement(
  value: string | null | undefined
): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCalendarDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return Boolean(
    match &&
      isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  );
}

function isValidMeasurementDateTime(value: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      value
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second = "0", , zone] = match;
  const dateValid = isValidCalendarDate(
    Number(year),
    Number(month),
    Number(day)
  );
  const timeValid =
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const parsed = Date.parse(value);
  if (!dateValid || !timeValid || !Number.isFinite(parsed)) return false;
  if (zone && zone.toUpperCase() !== "Z") {
    const offset = zone.match(/[+-](\d{2}):?(\d{2})$/);
    if (
      !offset ||
      Number(offset[1]) > 14 ||
      Number(offset[2]) > 59 ||
      (Number(offset[1]) === 14 && Number(offset[2]) !== 0)
    )
      return false;
  }
  return true;
}

export function calculateRepeatabilityStatistics(
  readings: number[],
  method: RepeatabilityMethod,
  tolerance: number,
  referenceValue: number | null
): PolarimeterRepeatabilityStatistics | null {
  if (readings.length < 2 || readings.some(value => !Number.isFinite(value)))
    return null;
  const count = readings.length;
  const average = readings.reduce((sum, value) => sum + value, 0) / count;
  const minimum = Math.min(...readings);
  const maximum = Math.max(...readings);
  const range = maximum - minimum;
  const sampleStandardDeviation = Math.sqrt(
    readings.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      (count - 1)
  );
  const rsdPercent =
    Math.abs(average) <= 1e-12
      ? null
      : (sampleStandardDeviation / Math.abs(average)) * 100;
  if (
    ![average, minimum, maximum, range, sampleStandardDeviation].every(
      Number.isFinite
    ) ||
    (rsdPercent !== null && !Number.isFinite(rsdPercent))
  )
    return null;

  let basis = average;
  if (method === "first-reading-deviation") basis = readings[0];
  if (method === "reference-value-deviation") {
    if (referenceValue === null || !Number.isFinite(referenceValue))
      return null;
    basis = referenceValue;
  }
  const deviations = readings.map(value => Math.abs(value - basis));
  if (deviations.some(value => !Number.isFinite(value))) return null;
  let overallPass: boolean;
  let individualPasses: boolean[];
  switch (method) {
    case "first-reading-deviation":
    case "reference-value-deviation":
    case "mean-deviation":
      individualPasses = deviations.map(value => value <= tolerance);
      overallPass = individualPasses.every(Boolean);
      break;
    case "maximum-range":
      overallPass = range <= tolerance;
      individualPasses = readings.map(() => overallPass);
      break;
    case "sample-standard-deviation":
      overallPass = sampleStandardDeviation <= tolerance;
      individualPasses = readings.map(() => overallPass);
      break;
    case "rsd-percent":
      if (rsdPercent === null) return null;
      overallPass = rsdPercent <= tolerance;
      individualPasses = readings.map(() => overallPass);
      break;
  }
  return {
    count,
    mean: average,
    minimum,
    maximum,
    range,
    sampleStandardDeviation,
    rsdPercent,
    deviations,
    individualPasses,
    overallPass,
  };
}

export function calculateRegression(
  x: number[],
  y: number[]
): PolarimeterRegression | null {
  if (
    x.length !== y.length ||
    x.length < 2 ||
    x.some(value => !Number.isFinite(value)) ||
    y.some(value => !Number.isFinite(value))
  )
    return null;
  const count = x.length;
  const meanX = x.reduce((sum, value) => sum + value, 0) / count;
  const meanY = y.reduce((sum, value) => sum + value, 0) / count;
  const centeredXX = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const centeredYY = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const centeredXY = x.reduce(
    (sum, value, index) => sum + (value - meanX) * (y[index] - meanY),
    0
  );
  if (
    ![meanX, meanY, centeredXX, centeredYY, centeredXY].every(
      Number.isFinite
    ) ||
    centeredXX <= 0
  )
    return null;
  const slope = centeredXY / centeredXX;
  const intercept = meanY - slope * meanX;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  const rawR =
    centeredYY <= 0 ? null : centeredXY / Math.sqrt(centeredXX * centeredYY);
  if (rawR !== null && !Number.isFinite(rawR)) return null;
  const r = rawR === null ? null : Math.max(-1, Math.min(1, rawR));
  return {
    slope,
    intercept,
    r,
    r2: r === null ? null : r * r,
    count,
  };
}

export function evaluatePolarimeterInputs(
  data: Pick<PolarimeterV2, "accuracy" | "repeatability" | "linearity">,
  protocol: PolarimeterProtocolSnapshot
): PolarimeterEvaluation {
  const errors = {
    accuracy: [] as string[],
    repeatability: [] as string[],
    linearity: [] as string[],
  };
  const alpha = parseMeasurement(data.accuracy.opticalRotation);
  const concentration = parseMeasurement(data.accuracy.concentrationGPer100Ml);
  const submittedTubeLength = parseMeasurement(data.accuracy.tubeLengthDm);
  const tubeLength = protocol.conditions.tubeLengthDm;
  const rawSpecificRotation =
    alpha !== null &&
    concentration !== null &&
    concentration > 0 &&
    tubeLength > 0
      ? (100 * alpha) / (tubeLength * concentration)
      : null;
  const specificRotation =
    rawSpecificRotation !== null && Number.isFinite(rawSpecificRotation)
      ? rawSpecificRotation
      : null;
  if (rawSpecificRotation !== null && specificRotation === null)
    errors.accuracy.push(
      "Specific-rotation calculation is outside the finite numeric range."
    );

  if (alpha === null)
    errors.accuracy.push("Enter the measured optical rotation.");
  if (concentration === null || concentration <= 0)
    errors.accuracy.push("Enter a concentration greater than zero.");
  if (submittedTubeLength === null || submittedTubeLength <= 0)
    errors.accuracy.push("Tube length must be greater than zero.");
  else if (
    Math.abs(submittedTubeLength - protocol.conditions.tubeLengthDm) > 1e-12
  )
    errors.accuracy.push(
      "Tube length does not match the controlled protocol snapshot."
    );
  if (
    !Number.isFinite(data.accuracy.wavelengthNm) ||
    data.accuracy.wavelengthLabel !== protocol.conditions.wavelengthLabel ||
    Math.abs(data.accuracy.wavelengthNm - protocol.conditions.wavelengthNm) >
      1e-12
  )
    errors.accuracy.push(
      "Wavelength does not match the controlled protocol snapshot."
    );
  if (
    protocol.requiredFields.measurementDateTime &&
    !isValidMeasurementDateTime(data.accuracy.measurementDateTime)
  )
    errors.accuracy.push("Enter a valid measurement date and time.");
  if (protocol.requiredFields.temperature) {
    const temperature = parseMeasurement(data.accuracy.temperatureC);
    if (temperature === null)
      errors.accuracy.push(
        "Enter the measured temperature required by the protocol."
      );
  } else if (
    data.accuracy.temperatureC !== null &&
    data.accuracy.temperatureC.trim() &&
    parseMeasurement(data.accuracy.temperatureC) === null
  ) {
    errors.accuracy.push("Temperature must be a valid number.");
  }
  if (
    !protocol.requiredFields.measurementDateTime &&
    data.accuracy.measurementDateTime.trim() &&
    !isValidMeasurementDateTime(data.accuracy.measurementDateTime)
  )
    errors.accuracy.push("Measurement date and time must be valid.");
  if (
    protocol.requiredFields.referenceStandard &&
    !data.accuracy.referenceStandardId.trim()
  )
    errors.accuracy.push("Enter the required reference-standard ID.");
  if (
    protocol.requiredFields.referenceStandard &&
    !data.accuracy.referenceStandardCertificateNumber.trim()
  )
    errors.accuracy.push(
      "Enter the required reference-standard certificate number."
    );
  const expiry = data.accuracy.referenceStandardExpiryDate;
  if (protocol.requiredFields.referenceStandard && !expiry.trim()) {
    errors.accuracy.push(
      "Enter an expiry date for the required reference standard."
    );
  }
  if (expiry.trim() && !isValidDateOnly(expiry)) {
    errors.accuracy.push("Enter a valid reference-standard expiry date.");
  } else if (
    expiry.trim() &&
    isValidDateOnly(expiry) &&
    isValidMeasurementDateTime(data.accuracy.measurementDateTime) &&
    expiry < data.accuracy.measurementDateTime.slice(0, 10)
  ) {
    errors.accuracy.push(
      "The reference-standard certificate is expired for the measurement date."
    );
  }

  const accuracyResult =
    errors.accuracy.length === 0 && specificRotation !== null
      ? specificRotation >= protocol.accuracy.lowerLimit &&
        specificRotation <= protocol.accuracy.upperLimit
        ? "pass"
        : "fail"
      : null;

  const readings = data.repeatability.readings.map(parseMeasurement);
  if (
    data.repeatability.readings.length !==
    protocol.repeatability.requiredReadings
  )
    errors.repeatability.push(
      `The protocol requires exactly ${protocol.repeatability.requiredReadings} readings.`
    );
  if (!data.repeatability.sampleId.trim())
    errors.repeatability.push("Enter a sample ID.");
  const repeatConcentration = parseMeasurement(
    data.repeatability.sampleConcentration
  );
  if (repeatConcentration === null || repeatConcentration <= 0)
    errors.repeatability.push(
      "Enter a sample concentration greater than zero."
    );
  if (readings.some(value => value === null))
    errors.repeatability.push("Enter every required optical-rotation reading.");
  const numericReadings = readings.filter(
    (value): value is number => value !== null
  );
  const statistics =
    numericReadings.length === protocol.repeatability.requiredReadings
      ? calculateRepeatabilityStatistics(
          numericReadings,
          protocol.repeatability.method,
          protocol.repeatability.tolerance,
          protocol.repeatability.referenceValue
        )
      : null;
  if (!statistics && errors.repeatability.length === 0)
    errors.repeatability.push(
      "Repeatability statistics are undefined for these inputs and protocol."
    );

  const repeatabilityResult =
    errors.repeatability.length === 0 && statistics
      ? statistics.overallPass
        ? "pass"
        : "fail"
      : null;

  const points = data.linearity.points;
  if (points.length !== protocol.linearity.nominalConcentrations.length)
    errors.linearity.push(
      `The protocol requires exactly ${protocol.linearity.nominalConcentrations.length} linearity points.`
    );
  const xValues: number[] = [];
  const yValues: number[] = [];
  points.forEach((point, index) => {
    const expectedConcentration =
      protocol.linearity.nominalConcentrations[index];
    if (point.pointNumber !== index + 1)
      errors.linearity.push(`Linearity point number ${index + 1} is invalid.`);
    if (
      expectedConcentration === undefined ||
      Math.abs(point.nominalConcentration - expectedConcentration) > 1e-12
    )
      errors.linearity.push(
        `Linearity point ${index + 1} does not match the protocol nominal concentration.`
      );
    const actualConcentration = parseMeasurement(point.actualConcentration);
    const rotation = parseMeasurement(point.measuredOpticalRotation);
    if (
      protocol.linearity.useActualConcentration &&
      (actualConcentration === null || actualConcentration <= 0)
    )
      errors.linearity.push(
        `Enter the actual concentration for linearity point ${index + 1}.`
      );
    else if (point.actualConcentration?.trim() && actualConcentration === null)
      errors.linearity.push(
        `Actual concentration for linearity point ${index + 1} must be a valid number.`
      );
    else if (actualConcentration !== null && actualConcentration <= 0)
      errors.linearity.push(
        `Actual concentration for linearity point ${index + 1} must be greater than zero.`
      );
    if (rotation === null)
      errors.linearity.push(
        `Enter the optical-rotation result for linearity point ${index + 1}.`
      );
    const x = protocol.linearity.useActualConcentration
      ? actualConcentration
      : expectedConcentration;
    if (x !== undefined && x !== null && rotation !== null) {
      xValues.push(x);
      yValues.push(rotation);
    }
  });
  const regression =
    xValues.length === protocol.linearity.nominalConcentrations.length
      ? calculateRegression(xValues, yValues)
      : null;
  if (!regression && errors.linearity.length === 0)
    errors.linearity.push(
      "Regression is undefined; provide at least two distinct concentration values and non-constant rotation readings."
    );
  const selectedMetric =
    protocol.linearity.metric === "r2" ? regression?.r2 : regression?.r;
  if (selectedMetric === null || selectedMetric === undefined) {
    if (!errors.linearity.length)
      errors.linearity.push(
        `The configured ${protocol.linearity.metric === "r2" ? "R²" : "r"} value is undefined.`
      );
  }
  const linearityResult =
    errors.linearity.length === 0 &&
    selectedMetric !== null &&
    selectedMetric !== undefined
      ? selectedMetric >= protocol.linearity.minimumMetric
        ? "pass"
        : "fail"
      : null;

  const overallPass =
    accuracyResult !== null &&
    repeatabilityResult !== null &&
    linearityResult !== null
      ? accuracyResult === "pass" &&
        repeatabilityResult === "pass" &&
        linearityResult === "pass"
      : null;
  return {
    errors,
    metrics: {
      specificRotation,
      repeatability: statistics,
      regression,
    },
    testResults: {
      accuracy: accuracyResult,
      repeatability: repeatabilityResult,
      linearity: linearityResult,
    },
    overallPass,
  };
}

export function toPolarimeterCalculatedMetrics(
  evaluation: PolarimeterEvaluation
): PolarimeterCalculatedMetrics {
  const statistics = evaluation.metrics.repeatability;
  const regression = evaluation.metrics.regression;
  if (
    evaluation.metrics.specificRotation === null ||
    !statistics ||
    !regression ||
    regression.r === null ||
    regression.r2 === null ||
    evaluation.overallPass === null
  ) {
    throw new Error(
      "Polarimeter inputs are incomplete or cannot be evaluated."
    );
  }
  return {
    specificRotation: evaluation.metrics.specificRotation,
    repeatabilityMean: statistics.mean,
    repeatabilityMinimum: statistics.minimum,
    repeatabilityMaximum: statistics.maximum,
    repeatabilityRange: statistics.range,
    repeatabilitySampleStandardDeviation: statistics.sampleStandardDeviation,
    repeatabilityRsdPercent: statistics.rsdPercent,
    repeatabilityDeviations: statistics.deviations,
    regressionSlope: regression.slope,
    regressionIntercept: regression.intercept,
    correlationCoefficient: regression.r,
    coefficientOfDetermination: regression.r2,
    validLinearityPoints: regression.count,
    overall: evaluation.overallPass ? "pass" : "fail",
  };
}
