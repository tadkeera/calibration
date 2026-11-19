import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, devices } from "../client/src/lib/qc";
import type { PolarimeterV2 } from "../shared/polarimeter";
import { createPolarimeterProtocolSnapshot } from "../shared/polarimeter";
import { approveValidationRecord, createValidationRecord } from "./supabaseDb";
import { buildPolarimeterDerivedResult } from "./validationRecompute";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function syntheticRecord() {
  const device = devices.find(entry => entry.key === "polarimeter")!;
  const settings = structuredClone(defaultSettings.polarimeter);
  const protocol = createPolarimeterProtocolSnapshot(settings);
  const primaryInputs: Pick<
    PolarimeterV2,
    "accuracy" | "repeatability" | "linearity"
  > = {
    accuracy: {
      opticalRotation: "1.33",
      concentrationGPer100Ml: "1",
      tubeLengthDm: String(protocol.conditions.tubeLengthDm),
      temperatureC: "",
      wavelengthLabel: protocol.conditions.wavelengthLabel,
      wavelengthNm: protocol.conditions.wavelengthNm,
      measurementDateTime: "2025-01-02T10:00",
      referenceStandardId: "",
      referenceStandardExpiryDate: "",
      referenceStandardCertificateNumber: "",
      analystNotes:
        "Synthetic integration-test fixture only; not laboratory data.",
    },
    repeatability: {
      sampleId: "SUPABASE-TEST-ONLY",
      sampleConcentration: "1",
      concentrationUnit: "g/100ml",
      readings: ["1.00", "1.01", "0.99", "1.02", "0.98", "1.01"],
      measurementConditions: "Synthetic fixture.",
      analystNotes: "Not laboratory data.",
    },
    linearity: {
      points: protocol.linearity.nominalConcentrations.map(
        (nominalConcentration, index) => ({
          pointNumber: index + 1,
          nominalConcentration,
          actualConcentration: "",
          measuredOpticalRotation: String((index + 1) * 10),
          notes: "Synthetic fixture.",
        })
      ),
      measurementConditions: "Synthetic fixture.",
      analystNotes: "Not laboratory data.",
    },
  };
  const result = buildPolarimeterDerivedResult(
    {
      schemaVersion: 2,
      equipmentSnapshot: {
        instrumentKey: "polarimeter",
        instrumentName: device.english,
        equipmentId: device.id,
        manufacturer: device.manufacturer,
        model: device.model,
        serialNumber: device.serial,
        sopNumber: device.sop,
        formNumber: device.form,
        department: null,
        location: null,
        status: null,
      },
      protocolSnapshot: protocol,
      ...primaryInputs,
      calculatedMetrics: {
        specificRotation: 0,
        repeatabilityMean: 0,
        repeatabilityMinimum: 0,
        repeatabilityMaximum: 0,
        repeatabilityRange: 0,
        repeatabilitySampleStandardDeviation: null,
        repeatabilityRsdPercent: null,
        repeatabilityDeviations: [],
        regressionSlope: 0,
        regressionIntercept: 0,
        correlationCoefficient: null,
        coefficientOfDetermination: null,
        validLinearityPoints: 0,
        overall: "fail",
      },
      testResults: {
        accuracy: "fail",
        repeatability: "fail",
        linearity: "fail",
      },
      overallResult: "fail",
    },
    settings
  );
  result.controlledSettings = settings;
  return { device, settings, result };
}

function profileRow(device: (typeof devices)[number]) {
  return {
    id: 1,
    instrument_key: "polarimeter",
    name_ar: device.name,
    name_en: device.english,
    instrument_id: device.id,
    sop_number: device.sop,
    manufacturer: device.manufacturer,
    model: device.model,
    serial_number: device.serial,
    form_number: device.form,
    accent: device.accent,
    updated_by_user_id: null,
    updated_at: "2025-01-01T00:00:00.000Z",
  };
}

describe("[Supabase-mocked] Supabase Polarimeter record persistence (fetch stubbed)", () => {
  it("recomputes, matches the existing register, and persists normalized draft data", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const { device, settings, result } = syntheticRecord();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/rest/v1/validation_settings"))
          return new Response(JSON.stringify([{ settings }]), { status: 200 });
        if (url.includes("/rest/v1/instrument_profiles"))
          return new Response(JSON.stringify([profileRow(device)]), {
            status: 200,
          });
        if (
          url.endsWith("/rest/v1/validation_records") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(String(init.body)) as Record<string, any>;
          return new Response(
            JSON.stringify([
              {
                id: 451,
                ...body,
                lifecycle_status: "draft",
                approved_by_user_id: null,
                approved_at: null,
                created_at: "2025-01-02T10:00:00.000Z",
                updated_at: "2025-01-02T10:00:00.000Z",
              },
            ]),
            { status: 201 }
          );
        }
        if (url.endsWith("/rest/v1/audit_events"))
          return new Response("", { status: 201 });
        throw new Error(`Unexpected synthetic Supabase request: ${url}`);
      });

    const record = await createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: device.english,
      instrumentId: device.id,
      sopNumber: device.sop,
      formNumber: device.form,
      resultStatus: "pass",
      pharmacistName: "Synthetic Integration Analyst",
      resultData: result as unknown as Record<string, unknown>,
      userId: 9,
    });

    expect(record.id).toBe(451);
    expect(record.lifecycleStatus).toBe("draft");
    expect(record.resultStatus).toBe("pass");
    expect(
      (record.resultData.polarimeterData as PolarimeterV2).calculatedMetrics
        .specificRotation
    ).toBeCloseTo(66.5, 12);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/rest/v1/audit_events")
      )
    ).toBe(true);
  });

  it("creates failure cases idempotently without issuing a duplicate audit-event insert", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const { device, settings, result } = syntheticRecord();
    const source = structuredClone(result.polarimeterData!);
    source.accuracy.opticalRotation = "3.00";
    const failed = buildPolarimeterDerivedResult(source, settings);
    failed.controlledSettings = settings;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/rest/v1/validation_settings"))
          return new Response(JSON.stringify([{ settings }]), { status: 200 });
        if (url.includes("/rest/v1/instrument_profiles"))
          return new Response(JSON.stringify([profileRow(device)]), {
            status: 200,
          });
        if (
          url.endsWith("/rest/v1/validation_records") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(String(init.body)) as Record<string, any>;
          return new Response(
            JSON.stringify([
              {
                id: 452,
                ...body,
                lifecycle_status: "draft",
                record_version: 1,
                approved_by_user_id: null,
                approved_at: null,
                created_at: "2025-01-02T10:00:00.000Z",
                updated_at: "2025-01-02T10:00:00.000Z",
              },
            ]),
            { status: 201 }
          );
        }
        if (url.endsWith("/rest/v1/audit_events"))
          return new Response("", { status: 201 });
        if (url.includes("/rest/v1/validation_records?id=eq.452"))
          return new Response(
            JSON.stringify([
              {
                id: 452,
                instrument_key: "polarimeter",
                instrument_name: device.english,
                instrument_id: device.id,
                sop_number: device.sop,
                form_number: device.form,
                result_status: "fail",
                lifecycle_status: "draft",
                result_data: failed,
                pharmacist_name: "Synthetic Failure Analyst",
                validated_by_user_id: 9,
                approved_by_user_id: null,
                approved_at: null,
                created_at: "2025-01-02T10:00:00.000Z",
                updated_at: "2025-01-02T10:00:00.000Z",
                record_version: 1,
                retest_of_record_id: null,
                retest_reason: null,
              },
            ]),
            { status: 200 }
          );
        if (url.includes("/rest/v1/polarimeter_deviations"))
          return new Response(
            JSON.stringify([
              {
                id: 93,
                validation_record_id: 452,
                test_key: "accuracy",
                actual_result: "150 °",
                acceptance_limit: "66.3 to 67 ° specific rotation",
                protocol_status: "pending-verification",
              },
            ]),
            { status: 201 }
          );
        throw new Error(
          `Unexpected synthetic Supabase request: ${init?.method} ${url}`
        );
      });

    const record = await createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: device.english,
      instrumentId: device.id,
      sopNumber: device.sop,
      formNumber: device.form,
      resultStatus: "fail",
      pharmacistName: "Synthetic Failure Analyst",
      resultData: failed as unknown as Record<string, unknown>,
      userId: 9,
    });
    expect(record.resultStatus).toBe("fail");
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/rest/v1/polarimeter_deviation_events")
      ).length
    ).toBe(0);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/rest/v1/polarimeter_deviations")
      ).length
    ).toBe(1);
  });

  it("persists a retest link only to a failed record using the same equipment identity", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const { device, settings, result } = syntheticRecord();
    const failedSource = structuredClone(result.polarimeterData!);
    failedSource.accuracy.opticalRotation = "3.00";
    const failedResult = buildPolarimeterDerivedResult(failedSource, settings);
    failedResult.controlledSettings = settings;
    const existingRecordRow = {
      id: 450,
      instrument_key: "polarimeter",
      instrument_name: device.english,
      instrument_id: device.id,
      sop_number: device.sop,
      form_number: device.form,
      result_status: "fail",
      lifecycle_status: "draft",
      result_data: failedResult,
      pharmacist_name: "Synthetic Original Analyst",
      validated_by_user_id: 6,
      approved_by_user_id: null,
      approved_at: null,
      created_at: "2025-01-02T10:00:00.000Z",
      updated_at: "2025-01-02T10:00:00.000Z",
      record_version: 1,
      retest_of_record_id: null,
      retest_reason: null,
    };
    const calls: Array<{ url: string; method: string | undefined; body: any }> =
      [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, method: init?.method, body });
        if (url.includes("/rest/v1/validation_settings"))
          return new Response(JSON.stringify([{ settings }]), { status: 200 });
        if (url.includes("/rest/v1/instrument_profiles"))
          return new Response(JSON.stringify([profileRow(device)]), {
            status: 200,
          });
        if (url.includes("/rest/v1/validation_records?id=eq.450"))
          return new Response(JSON.stringify([existingRecordRow]), {
            status: 200,
          });
        if (
          url.endsWith("/rest/v1/validation_records") &&
          init?.method === "POST"
        )
          return new Response(
            JSON.stringify([
              {
                id: 452,
                ...body,
                lifecycle_status: "draft",
                record_version: 1,
                approved_by_user_id: null,
                approved_at: null,
                created_at: "2025-01-03T10:00:00.000Z",
                updated_at: "2025-01-03T10:00:00.000Z",
              },
            ]),
            { status: 201 }
          );
        if (url.endsWith("/rest/v1/audit_events"))
          return new Response("", { status: 201 });
        if (url.includes("/rest/v1/validation_records?id=eq.452"))
          return new Response(
            JSON.stringify([
              {
                ...existingRecordRow,
                id: 452,
                retest_of_record_id: 450,
                retest_reason:
                  "Synthetic controlled retest for provider-parity testing.",
                created_at: "2025-01-03T10:00:00.000Z",
              },
            ]),
            { status: 200 }
          );
        if (url.includes("/rest/v1/polarimeter_deviations"))
          return new Response("[]", { status: 201 });
        throw new Error(
          `Unexpected synthetic Supabase request: ${init?.method} ${url}`
        );
      });

    const retestReason =
      "Synthetic controlled retest for provider-parity testing.";
    const retest = await createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: device.english,
      instrumentId: device.id,
      sopNumber: device.sop,
      formNumber: device.form,
      resultStatus: "fail",
      pharmacistName: "Synthetic Retest Analyst",
      resultData: failedResult as unknown as Record<string, unknown>,
      userId: 9,
      retestOfRecordId: 450,
      retestReason,
    });
    const insert = calls.find(
      call =>
        call.url.endsWith("/rest/v1/validation_records") &&
        call.method === "POST"
    );
    expect(retest.retestOfRecordId).toBe(450);
    expect(retest.retestReason).toBe(retestReason);
    expect(insert?.body.retest_of_record_id).toBe(450);
    expect(insert?.body.retest_reason).toBe(retestReason);
    expect(fetchMock).toHaveBeenCalled();

    const mismatchRecord = { ...existingRecordRow, instrument_id: "QC-P-999" };
    const originalMock = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/v1/validation_records?id=eq.450"))
        return new Response(JSON.stringify([mismatchRecord]), { status: 200 });
      return originalMock!(input, init);
    });
    await expect(
      createValidationRecord({
        instrumentKey: "polarimeter",
        instrumentName: device.english,
        instrumentId: device.id,
        sopNumber: device.sop,
        formNumber: device.form,
        resultStatus: "fail",
        pharmacistName: "Synthetic Retest Analyst",
        resultData: failedResult as unknown as Record<string, unknown>,
        userId: 9,
        retestOfRecordId: 450,
        retestReason,
      })
    ).rejects.toThrow("same registered equipment identity");
    expect(
      calls.filter(
        call =>
          call.url.endsWith("/rest/v1/validation_records") &&
          call.method === "POST"
      )
    ).toHaveLength(1);
  });

  it("blocks successful approval of a passing record while its protocol is pending", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const { device, result } = syntheticRecord();
    const recordData = result as unknown as Record<string, unknown>;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async input => {
        const url = String(input);
        if (url.includes("/rest/v1/validation_records"))
          return new Response(
            JSON.stringify([
              {
                id: 451,
                instrument_key: "polarimeter",
                instrument_name: device.english,
                instrument_id: device.id,
                sop_number: device.sop,
                form_number: device.form,
                result_status: "pass",
                lifecycle_status: "draft",
                result_data: recordData,
                pharmacist_name: "Synthetic Integration Analyst",
                validated_by_user_id: 9,
                approved_by_user_id: null,
                approved_at: null,
                created_at: "2025-01-02T10:00:00.000Z",
                updated_at: "2025-01-02T10:00:00.000Z",
              },
            ]),
            { status: 200 }
          );
        throw new Error(`Unexpected request after blocked approval: ${url}`);
      });

    await expect(
      approveValidationRecord({
        id: 451,
        decision: "approved",
        userId: 3,
        expectedVersion: 1,
      })
    ).rejects.toThrow(
      "Polarimeter approval is blocked until the protocol is verified and approved"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects tampered metrics before the Supabase validation-record insert", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const { device, settings, result } = syntheticRecord();
    const tampered = structuredClone(result);
    tampered.polarimeterData!.calculatedMetrics.specificRotation = 999;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async input => {
        const url = String(input);
        if (url.includes("/rest/v1/validation_settings"))
          return new Response(JSON.stringify([{ settings }]), { status: 200 });
        if (url.includes("/rest/v1/instrument_profiles"))
          return new Response(JSON.stringify([profileRow(device)]), {
            status: 200,
          });
        throw new Error(
          `Unexpected request after failed server verification: ${url}`
        );
      });

    await expect(
      createValidationRecord({
        instrumentKey: "polarimeter",
        instrumentName: device.english,
        instrumentId: device.id,
        sopNumber: device.sop,
        formNumber: device.form,
        resultStatus: "pass",
        pharmacistName: "Synthetic Integration Analyst",
        resultData: tampered as unknown as Record<string, unknown>,
        userId: 9,
      })
    ).rejects.toThrow("Polarimeter result does not match server recomputation");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/rest/v1/validation_records")
      )
    ).toBe(false);
  });
});
