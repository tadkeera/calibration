import { describe, expect, it } from "vitest";
import type { PolarimeterV2 } from "../shared/polarimeter";
import {
  createPolarimeterProtocolSnapshot,
  evaluatePolarimeterInputs,
  toPolarimeterCalculatedMetrics,
} from "../shared/polarimeter";
import {
  assertServerEvaluatedResult,
  buildPolarimeterDerivedResult,
  normalizeServerEvaluatedResult,
} from "./validationRecompute";

const settings = {
  bathSet: 38,
  bathTolerance: 2,
  mediumMin: 35,
  mediumMax: 39,
  timeMin: 239,
  timeMax: 241,
  cycleMin: 29,
  cycleMax: 32,
};
const matchingPayload = {
  overall: true,
  rows: [
    { actual: "37.5 °C", pass: true },
    { actual: "37.3 °C", pass: true },
    { actual: "4.00", pass: true },
    { actual: "31.0 rpm", pass: true },
    { actual: "30.0 rpm", pass: true },
    { actual: "29.9 rpm", pass: true },
  ],
};

const syntheticPolarimeterSettings = {
  tubeLength: 2,
  specificMin: 60,
  specificMax: 70,
  specificPrecision: 4,
  repeatTolerance: 0.2,
  readingPrecision: 4,
  rLimit: 0.99,
  protocolId: "TEST-ONLY",
  protocolVersion: 1,
  protocolStatus: "pending-verification",
  protocolEffectiveDate: null,
  requiredReadings: 2,
  repeatabilityMethod: "sample-standard-deviation",
  repeatReferenceValue: null,
  referenceTemperatureC: 20,
  wavelengthLabel: "Test wavelength",
  wavelengthNm: 589.3,
  measurementDateTimeRequired: true,
  temperatureRequired: false,
  referenceStandardRequired: false,
  linearityConcentrations: [1, 2, 3],
  linearityMetric: "r",
  linearityUsesActualConcentration: false,
  regressionPrecision: 6,
};

const protocol = createPolarimeterProtocolSnapshot(
  syntheticPolarimeterSettings
);
const syntheticInputs = {
  accuracy: {
    opticalRotation: "1.3",
    concentrationGPer100Ml: "1",
    tubeLengthDm: "2",
    temperatureC: "20",
    wavelengthLabel: "Test wavelength",
    wavelengthNm: 589.3,
    measurementDateTime: "2025-01-02T10:00",
    referenceStandardId: "",
    referenceStandardExpiryDate: "",
    referenceStandardCertificateNumber: "",
    analystNotes: "Synthetic test fixture only; not laboratory data.",
  },
  repeatability: {
    sampleId: "SYNTHETIC-ONLY",
    sampleConcentration: "1",
    concentrationUnit: "g/100ml" as const,
    readings: ["1", "1.1"],
    measurementConditions: "Synthetic fixture.",
    analystNotes: "Not laboratory data.",
  },
  linearity: {
    points: [1, 2, 3].map((nominalConcentration, index) => ({
      pointNumber: index + 1,
      nominalConcentration,
      actualConcentration: "",
      measuredOpticalRotation: String(2 * nominalConcentration),
      notes: "Synthetic fixture.",
    })),
    measurementConditions: "Synthetic fixture.",
    analystNotes: "Not laboratory data.",
  },
};
const syntheticEvaluation = evaluatePolarimeterInputs(
  syntheticInputs,
  protocol
);
const syntheticPolarimeterData: PolarimeterV2 = {
  schemaVersion: 2,
  equipmentSnapshot: {
    instrumentKey: "polarimeter",
    instrumentName: "Synthetic test equipment",
    equipmentId: "TEST-ID",
    manufacturer: "Test only",
    model: "Test model",
    serialNumber: "TEST-SERIAL",
    sopNumber: "TEST-SOP",
    formNumber: "TEST-FORM",
    department: null,
    location: null,
    status: null,
  },
  protocolSnapshot: protocol,
  ...syntheticInputs,
  calculatedMetrics: toPolarimeterCalculatedMetrics(syntheticEvaluation),
  testResults: {
    accuracy: "pass",
    repeatability: "pass",
    linearity: "pass",
  },
  overallResult: "pass",
};

describe("server validation re-evaluation", () => {
  it("accepts a disintegration result that matches the controlled settings", () => {
    expect(
      assertServerEvaluatedResult(
        "disintegration",
        matchingPayload,
        settings,
        "pass"
      )
    ).toBe(true);
  });
  it("rejects a tampered PASS result even when settings are unchanged", () => {
    const tampered = {
      ...matchingPayload,
      rows: matchingPayload.rows.map((row, index) =>
        index === 3 ? { actual: "40.0 rpm", pass: true } : row
      ),
    };
    expect(() =>
      assertServerEvaluatedResult("disintegration", tampered, settings, "pass")
    ).toThrow("do not match");
  });
  it("recomputes Polarimeter metrics and presentation rows from primary inputs", () => {
    const derived = buildPolarimeterDerivedResult(
      syntheticPolarimeterData,
      syntheticPolarimeterSettings
    );
    const normalized = normalizeServerEvaluatedResult(
      "polarimeter",
      derived,
      syntheticPolarimeterSettings,
      "pass"
    );
    expect(normalized.overall).toBe(true);
    expect(
      (normalized.resultData.polarimeterData as PolarimeterV2).calculatedMetrics
        .specificRotation
    ).toBeCloseTo(65, 12);
    expect(
      (normalized.resultData.polarimeterData as PolarimeterV2).calculatedMetrics
        .correlationCoefficient
    ).toBe(1);
    expect(derived.rows.map(row => row.test)).toEqual([
      "Accuracy — specific optical rotation",
      "Repeatability — overall result",
      "Linearity — correlation coefficient r",
    ]);
  });
  it("rejects a client-submitted Polarimeter result row that differs from recomputation", () => {
    const derived = buildPolarimeterDerivedResult(
      syntheticPolarimeterData,
      syntheticPolarimeterSettings
    );
    const tampered = {
      ...derived,
      rows: derived.rows.map((row, index) =>
        index === 0 ? { ...row, actual: "fabricated" } : row
      ),
    };
    expect(() =>
      normalizeServerEvaluatedResult(
        "polarimeter",
        tampered,
        syntheticPolarimeterSettings,
        "pass"
      )
    ).toThrow("rows");
  });
  it("includes per-reading PASS/FAIL rows only when the configured rule evaluates individual readings", () => {
    const firstReadingSettings = {
      ...syntheticPolarimeterSettings,
      repeatabilityMethod: "first-reading-deviation",
    };
    const firstReadingProtocol =
      createPolarimeterProtocolSnapshot(firstReadingSettings);
    const input = {
      ...syntheticPolarimeterData,
      protocolSnapshot: firstReadingProtocol,
    };
    const derived = buildPolarimeterDerivedResult(input, firstReadingSettings);
    expect(derived.rows.map(row => row.test)).toContain(
      "Repeatability reading 1"
    );
    expect(
      derived.rows.filter(row => row.test.startsWith("Repeatability reading"))
    ).toHaveLength(2);
    expect(
      derived.rows.some(row => row.test === "Repeatability — overall result")
    ).toBe(true);
  });
});
