import { describe, expect, it } from "vitest";
import {
  calculateRegression,
  calculateRepeatabilityStatistics,
  createPolarimeterProtocolSnapshot,
  evaluatePolarimeterInputs,
  versionPolarimeterSettings,
} from "../shared/polarimeter";

const syntheticProtocolSettings = {
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
    analystNotes: "Synthetic mathematical test fixture only.",
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

describe("Polarimeter v2 scientific calculations", () => {
  it("computes the specific rotation and separate repeatability and regression statistics", () => {
    const protocol = createPolarimeterProtocolSnapshot(
      syntheticProtocolSettings
    );
    const evaluation = evaluatePolarimeterInputs(syntheticInputs, protocol);

    expect(evaluation.metrics.specificRotation).toBeCloseTo(65, 12);
    expect(evaluation.metrics.repeatability?.range).toBeCloseTo(0.1, 12);
    expect(
      evaluation.metrics.repeatability?.sampleStandardDeviation
    ).toBeCloseTo(Math.sqrt(0.005), 12);
    expect(evaluation.metrics.regression?.slope).toBeCloseTo(2, 12);
    expect(evaluation.metrics.regression?.intercept).toBeCloseTo(0, 12);
    expect(evaluation.metrics.regression?.r).toBe(1);
    expect(evaluation.metrics.regression?.r2).toBe(1);
    expect(evaluation.overallPass).toBe(true);
  });

  it("keeps Pearson r distinct from the coefficient of determination R-squared", () => {
    const regression = calculateRegression([1, 2, 3], [1, 3, 2]);
    expect(regression?.r).toBeCloseTo(0.5, 12);
    expect(regression?.r2).toBeCloseTo(0.25, 12);
    expect(regression?.r2).not.toBe(regression?.r);
  });

  it("evaluates a configured range method as a range, not as reading-to-reading deviation", () => {
    const statistics = calculateRepeatabilityStatistics(
      [1, 1.1, 1.2],
      "maximum-range",
      0.2,
      null
    );
    expect(statistics?.range).toBeCloseTo(0.2, 12);
    expect(statistics?.overallPass).toBe(true);
  });

  it("rejects a client-supplied tube length that differs from the controlled protocol", () => {
    const protocol = createPolarimeterProtocolSnapshot(
      syntheticProtocolSettings
    );
    const inputs = {
      ...syntheticInputs,
      accuracy: { ...syntheticInputs.accuracy, tubeLengthDm: "1" },
    };
    const evaluation = evaluatePolarimeterInputs(inputs, protocol);
    expect(evaluation.errors.accuracy).toContain(
      "Tube length does not match the controlled protocol snapshot."
    );
    expect(evaluation.overallPass).toBeNull();
  });

  it("rejects zero concentration and does not silently round before acceptance", () => {
    const protocol = createPolarimeterProtocolSnapshot({
      ...syntheticProtocolSettings,
      specificMin: 66.50002,
      specificMax: 70,
    });
    const zeroConcentration = evaluatePolarimeterInputs(
      {
        ...syntheticInputs,
        accuracy: { ...syntheticInputs.accuracy, concentrationGPer100Ml: "0" },
      },
      protocol
    );
    const unroundedMeasurement = evaluatePolarimeterInputs(
      {
        ...syntheticInputs,
        accuracy: { ...syntheticInputs.accuracy, opticalRotation: "1.3300008" },
      },
      protocol
    );

    expect(zeroConcentration.errors.accuracy).toContain(
      "Enter a concentration greater than zero."
    );
    expect(zeroConcentration.overallPass).toBeNull();
    expect(unroundedMeasurement.metrics.specificRotation).toBeCloseTo(
      66.50004,
      10
    );
    expect(unroundedMeasurement.testResults.accuracy).toBe("pass");
  });

  it("supports a protocol-defined reading count and actual-concentration X-axis", () => {
    const protocol = createPolarimeterProtocolSnapshot({
      ...syntheticProtocolSettings,
      requiredReadings: 3,
      linearityUsesActualConcentration: true,
    });
    const inputs = {
      ...syntheticInputs,
      repeatability: {
        ...syntheticInputs.repeatability,
        readings: ["1", "1.1", "1.05"],
      },
      linearity: {
        ...syntheticInputs.linearity,
        points: [
          {
            pointNumber: 1,
            nominalConcentration: 1,
            actualConcentration: "1",
            measuredOpticalRotation: "2",
            notes: "",
          },
          {
            pointNumber: 2,
            nominalConcentration: 2,
            actualConcentration: "4",
            measuredOpticalRotation: "8",
            notes: "",
          },
          {
            pointNumber: 3,
            nominalConcentration: 3,
            actualConcentration: "5",
            measuredOpticalRotation: "10",
            notes: "",
          },
        ],
      },
    };
    const evaluation = evaluatePolarimeterInputs(inputs, protocol);

    expect(evaluation.errors.repeatability).toEqual([]);
    expect(evaluation.metrics.repeatability?.count).toBe(3);
    expect(evaluation.metrics.regression?.slope).toBeCloseTo(2, 12);
    expect(evaluation.metrics.regression?.intercept).toBeCloseTo(0, 12);
  });

  it("marks mathematically undefined RSD and rejects impossible dates", () => {
    expect(
      calculateRepeatabilityStatistics([-1, 1], "rsd-percent", 1, null)
    ).toBeNull();
    const protocol = createPolarimeterProtocolSnapshot(
      syntheticProtocolSettings
    );
    const evaluation = evaluatePolarimeterInputs(
      {
        ...syntheticInputs,
        accuracy: {
          ...syntheticInputs.accuracy,
          measurementDateTime: "2025-02-30T10:00",
          referenceStandardExpiryDate: "2025-02-31",
        },
      },
      protocol
    );
    expect(evaluation.errors.accuracy).toContain(
      "Enter a valid measurement date and time."
    );
    expect(evaluation.errors.accuracy).toContain(
      "Enter a valid reference-standard expiry date."
    );
  });

  it("rejects impossible protocol effective dates", () => {
    expect(() =>
      createPolarimeterProtocolSnapshot({
        ...syntheticProtocolSettings,
        protocolEffectiveDate: "2025-02-30",
      })
    ).toThrow("Protocol effective date must be a valid calendar date.");
  });

  it("increments and preserves pending protocol history when controlled settings change", () => {
    const updated = versionPolarimeterSettings({
      defaults: syntheticProtocolSettings,
      previous: syntheticProtocolSettings,
      previousUpdatedByUserId: 7,
      previousUpdatedAt: "2025-01-01T00:00:00.000Z",
      incoming: { ...syntheticProtocolSettings, repeatTolerance: 0.15 },
      userId: 9,
      timestamp: "2025-01-03T00:00:00.000Z",
    });
    expect(updated.protocolVersion).toBe(2);
    expect(updated.protocolStatus).toBe("pending-verification");
    expect(updated.protocolEffectiveDate).toBeNull();
    expect(updated.protocolHistory).toEqual([
      expect.objectContaining({
        protocolVersion: 1,
        changedByUserId: 7,
        changedAt: "2025-01-01T00:00:00.000Z",
        snapshot: expect.objectContaining({ repeatTolerance: 0.2 }),
      }),
    ]);
  });
});
