/**
 * Regression tests for the Polarimeter save failure
 *   "Could not find the 'retest_of_record_id' column of 'validation_records' in the schema cache"
 *
 * Test classes (kept explicit on purpose):
 *   [SQLite]           real node:sqlite database file — no mocks.
 *   [Supabase-mocked]  fetch() is stubbed with PostgREST-shaped responses; this
 *                      proves payloads and error handling, NOT the deployed database.
 *   [SQL-static]       inspects the migration file text.
 * Real-PostgreSQL migration testing lives in scripts/db-verify (embedded Postgres),
 * and the deployed database is checked with GET /api/health/schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { defaultSettings, devices } from "../client/src/lib/qc";
import {
  createPolarimeterProtocolSnapshot,
  type PolarimeterV2,
} from "../shared/polarimeter";
import * as local from "./localDb";
import * as supabase from "./supabaseDb";
import { REQUIRED_SCHEMA } from "./schemaRequirements";
import { buildPolarimeterDerivedResult } from "./validationRecompute";

type ProfileLike = {
  nameEn: string;
  instrumentId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  sopNumber: string;
  formNumber: string;
};

function syntheticPolarimeterInput(
  settings: Record<string, unknown>,
  profile: ProfileLike
): PolarimeterV2 {
  const protocol = createPolarimeterProtocolSnapshot(settings);
  return {
    schemaVersion: 2,
    equipmentSnapshot: {
      instrumentKey: "polarimeter",
      instrumentName: profile.nameEn,
      equipmentId: profile.instrumentId,
      manufacturer: profile.manufacturer,
      model: profile.model,
      serialNumber: profile.serialNumber,
      sopNumber: profile.sopNumber,
      formNumber: profile.formNumber,
      department: null,
      location: null,
      status: null,
    },
    protocolSnapshot: protocol,
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
      analystNotes: "Synthetic regression fixture only; not laboratory data.",
    },
    repeatability: {
      sampleId: "SYNTHETIC-ONLY",
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
    testResults: { accuracy: "fail", repeatability: "fail", linearity: "fail" },
    overallResult: "fail",
  };
}

const testDatabase = "/tmp/miayar-polarimeter-save-fix.test.sqlite";

describe("[SQLite] Polarimeter save operations and retest references", () => {
  beforeEach(() => {
    local.closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_INITIAL_ADMIN_PASSWORD = "offline-admin-test-password";
  });
  afterEach(() => {
    local.closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    delete process.env.QC_LOCAL_DB_PATH;
    delete process.env.QC_INITIAL_ADMIN_PASSWORD;
  });

  it("reports a healthy local schema including the retest column and parent index", async () => {
    const health = await local.checkSchemaHealth();
    expect(health.storage).toBe("local");
    expect(health.checks.every(check => check.ok)).toBe(true);
    expect(health.checks.map(check => check.table)).toEqual(
      REQUIRED_SCHEMA.map(requirement => requirement.table)
    );
    expect(health.polarimeterSettingsProvisioned).toBe(true);
    expect(health.ok).toBe(true);
  });

  it("saves empty, partial and completed drafts, updates them, and reopens records intact", async () => {
    const analyst = await local.createInitialAdmin();
    const settings = (await local.listValidationSettings()).find(
      entry => entry.deviceKey === "polarimeter"
    )!.settings;
    const profile = (await local.listInstrumentProfiles()).find(
      entry => entry.instrumentKey === "polarimeter"
    )!;
    const protocolVersion = String(settings.protocolVersion ?? 1);
    const input = syntheticPolarimeterInput(settings, profile);

    // 2. Empty draft (nothing measured yet).
    const empty = await local.savePolarimeterDraft({
      userId: analyst.id,
      draftKey: "active",
      protocolVersion,
      payload: { step: 0, savedAt: "2025-01-02T09:00:00.000Z", inputs: {} },
      expectedVersion: 0,
    });
    expect(empty.version).toBe(1);

    // 3. Partially completed draft (accuracy only) — 5. update existing draft.
    const partial = await local.savePolarimeterDraft({
      userId: analyst.id,
      draftKey: "active",
      protocolVersion,
      payload: {
        step: 2,
        savedAt: "2025-01-02T09:10:00.000Z",
        inputs: { accuracy: input.accuracy },
      },
      expectedVersion: empty.version,
    });
    expect(partial.version).toBe(2);

    // 4. Completed draft (all measurements entered).
    const completedPayload = {
      step: 5,
      savedAt: "2025-01-02T09:20:00.000Z",
      inputs: {
        accuracy: input.accuracy,
        repeatability: input.repeatability,
        linearity: input.linearity,
      },
    };
    const completed = await local.savePolarimeterDraft({
      userId: analyst.id,
      draftKey: "active",
      protocolVersion,
      payload: completedPayload,
      expectedVersion: partial.version,
    });
    expect(completed.version).toBe(3);
    // 6./7. Retrieve and reopen the draft: measurements preserved exactly.
    const reopenedDraft = await local.getPolarimeterDraft({
      userId: analyst.id,
      draftKey: "active",
    });
    expect(reopenedDraft?.payload).toEqual(completedPayload);

    // 1./10. Create a normal (non-retest) Polarimeter record → NULL reference.
    const result = buildPolarimeterDerivedResult(input, settings);
    const record = await local.createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: profile.nameEn,
      instrumentId: profile.instrumentId,
      sopNumber: profile.sopNumber,
      formNumber: profile.formNumber,
      resultStatus: "pass",
      pharmacistName: "Synthetic Test Analyst",
      resultData: result as unknown as Record<string, unknown>,
      userId: analyst.id,
    });
    expect(record.retestOfRecordId).toBeNull();
    expect(record.retestReason).toBeNull();
    expect(record.lifecycleStatus).toBe("draft");

    // 8./9. Reopen: measurements and protocol snapshot preserved.
    const reopened = await local.getValidationRecordById(record.id);
    const saved = reopened!.resultData.polarimeterData as PolarimeterV2;
    expect(saved.repeatability.readings).toEqual(input.repeatability.readings);
    expect(saved.accuracy.opticalRotation).toBe("1.33");
    expect(saved.linearity.points.map(point => point.measuredOpticalRotation)).toEqual(
      input.linearity.points.map(point => point.measuredOpticalRotation)
    );
    expect(saved.protocolSnapshot.protocolVersion).toBe(
      input.protocolSnapshot.protocolVersion
    );
    expect(saved.protocolSnapshot.protocolStatus).toBe(
      input.protocolSnapshot.protocolStatus
    );

    // Pending protocol: formal approval stays blocked server-side.
    await expect(
      local.approveValidationRecord({
        id: record.id,
        decision: "approved",
        userId: analyst.id,
        expectedVersion: record.recordVersion,
      })
    ).rejects.toThrow();
    expect((await local.getValidationRecordById(record.id))!.lifecycleStatus).toBe(
      "draft"
    );

    // 11. Retest reference: links to the failed original, which is preserved.
    const failedInput = structuredClone(input);
    failedInput.repeatability.readings[1] = "1.50";
    const failedResult = buildPolarimeterDerivedResult(failedInput, settings);
    const failed = await local.createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: profile.nameEn,
      instrumentId: profile.instrumentId,
      sopNumber: profile.sopNumber,
      formNumber: profile.formNumber,
      resultStatus: "fail",
      pharmacistName: "Synthetic Test Analyst",
      resultData: failedResult as unknown as Record<string, unknown>,
      userId: analyst.id,
    });
    const retest = await local.createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: profile.nameEn,
      instrumentId: profile.instrumentId,
      sopNumber: profile.sopNumber,
      formNumber: profile.formNumber,
      resultStatus: "pass",
      pharmacistName: "Synthetic Test Analyst",
      resultData: result as unknown as Record<string, unknown>,
      userId: analyst.id,
      retestOfRecordId: failed.id,
      retestReason: "Synthetic retest fixture; not laboratory data.",
    });
    expect(retest.retestOfRecordId).toBe(failed.id);
    const original = await local.getValidationRecordById(failed.id);
    expect(original!.resultStatus).toBe("fail");
    expect(original!.resultData).toEqual(failed.resultData);
    // A retest of a non-failed record is refused.
    await expect(
      local.createValidationRecord({
        instrumentKey: "polarimeter",
        instrumentName: profile.nameEn,
        instrumentId: profile.instrumentId,
        sopNumber: profile.sopNumber,
        formNumber: profile.formNumber,
        resultStatus: "pass",
        pharmacistName: "Synthetic Test Analyst",
        resultData: result as unknown as Record<string, unknown>,
        userId: analyst.id,
        retestOfRecordId: record.id,
        retestReason: "Synthetic retest fixture; not laboratory data.",
      })
    ).rejects.toThrow();
  });
});

describe("[Supabase-mocked] validation_records payload and schema-cache errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function stubConfig() {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
  }

  function syntheticCreateInput() {
    const device = devices.find(entry => entry.key === "polarimeter")!;
    const settings = structuredClone(defaultSettings.polarimeter) as Record<
      string,
      unknown
    >;
    const profile: ProfileLike = {
      nameEn: device.english,
      instrumentId: device.id,
      manufacturer: device.manufacturer,
      model: device.model,
      serialNumber: device.serial,
      sopNumber: device.sop,
      formNumber: device.form,
    };
    const result = buildPolarimeterDerivedResult(
      syntheticPolarimeterInput(settings, profile),
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

  it("always sends retest_of_record_id (NULL for ordinary records) instead of dropping it", async () => {
    stubConfig();
    const { device, settings, result } = syntheticCreateInput();
    let insertedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/v1/validation_settings"))
        return new Response(JSON.stringify([{ settings }]), { status: 200 });
      if (url.includes("/rest/v1/instrument_profiles"))
        return new Response(JSON.stringify([profileRow(device)]), { status: 200 });
      if (url.endsWith("/rest/v1/validation_records") && init?.method === "POST") {
        insertedBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify([
            {
              id: 501,
              ...insertedBody,
              lifecycle_status: "draft",
              approved_by_user_id: null,
              approved_at: null,
              record_version: 1,
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
    const record = await supabase.createValidationRecord({
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
    expect(insertedBody).not.toBeNull();
    expect(insertedBody!).toHaveProperty("retest_of_record_id", null);
    expect(insertedBody!).toHaveProperty("retest_reason", null);
    expect(record.retestOfRecordId).toBeNull();
  });

  it("surfaces the PGRST204 schema-cache error with migration guidance and writes no audit event", async () => {
    stubConfig();
    const { device, settings, result } = syntheticCreateInput();
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
        if (url.endsWith("/rest/v1/validation_records") && init?.method === "POST")
          return new Response(
            JSON.stringify({
              code: "PGRST204",
              details: null,
              hint: null,
              message:
                "Could not find the 'retest_of_record_id' column of 'validation_records' in the schema cache",
            }),
            { status: 400 }
          );
        throw new Error(`Unexpected synthetic Supabase request: ${url}`);
      });
    const attempt = supabase.createValidationRecord({
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
    await expect(attempt).rejects.toThrow(
      "Could not find the 'retest_of_record_id' column"
    );
    await expect(attempt).rejects.toThrow("polarimeter_workflow_migration.sql");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/rest/v1/audit_events"))
    ).toBe(false);
  });

  it("schema health check identifies exactly which columns the deployed schema cache is missing", async () => {
    stubConfig();
    const missingColumns = new Set(["retest_of_record_id", "retest_reason", "record_version"]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(String(input));
      const table = url.pathname.replace("/rest/v1/", "");
      if (table === "polarimeter_drafts")
        return new Response(
          JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.polarimeter_drafts' in the schema cache" }),
          { status: 404 }
        );
      if (table === "validation_settings" && url.searchParams.get("device_key"))
        return new Response(JSON.stringify([{ device_key: "polarimeter" }]), { status: 200 });
      const selected = (url.searchParams.get("select") ?? "").split(",");
      const unknown = table === "validation_records" ? selected.find(column => missingColumns.has(column)) : undefined;
      if (unknown)
        return new Response(
          JSON.stringify({ code: "PGRST204", message: `Could not find the '${unknown}' column of '${table}' in the schema cache` }),
          { status: 400 }
        );
      return new Response("[]", { status: 200 });
    });
    const health = await supabase.checkSchemaHealth();
    expect(health.ok).toBe(false);
    expect(health.storage).toBe("supabase");
    expect(health.projectRefHint).toBe("synthe");
    const records = health.checks.find(check => check.table === "validation_records")!;
    expect(records.ok).toBe(false);
    expect(records.missing?.sort()).toEqual([...missingColumns].sort());
    expect(health.checks.find(check => check.table === "polarimeter_drafts")!.ok).toBe(false);
    expect(health.checks.find(check => check.table === "record_approvals")!.ok).toBe(true);
    expect(health.polarimeterSettingsProvisioned).toBe(true);
  });

  it("schema health check is healthy once the migration and cache reload are applied", async () => {
    stubConfig();
    const methods: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      methods.push(init?.method ?? "GET");
      const url = new URL(String(input));
      if (url.searchParams.get("device_key"))
        return new Response(JSON.stringify([{ device_key: "polarimeter" }]), { status: 200 });
      return new Response("[]", { status: 200 });
    });
    const health = await supabase.checkSchemaHealth();
    expect(health.ok).toBe(true);
    expect(health.checks.every(check => check.ok)).toBe(true);
    // Strictly read-only.
    expect(methods.every(method => method === "GET")).toBe(true);
  });
});

describe("[SQLite] /api/health/schema route", () => {
  beforeEach(() => {
    local.closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_INITIAL_ADMIN_PASSWORD = "offline-admin-test-password";
    process.env.QC_STORAGE_MODE = "local";
  });
  afterEach(() => {
    local.closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    delete process.env.QC_LOCAL_DB_PATH;
    delete process.env.QC_INITIAL_ADMIN_PASSWORD;
    delete process.env.QC_STORAGE_MODE;
  });

  it("returns booleans only and never caches", async () => {
    const { createApp } = await import("./_core/app");
    const server = createApp().listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/api/health/schema`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.ok).toBe(true);
      expect(body.storage).toBe("local");
      expect(JSON.stringify(body)).not.toMatch(/password|key|token|secret/i);
    } finally {
      server.close();
    }
  });
});

describe("[SQL-static] Supabase migration safety", () => {
  const sql = readFileSync(
    path.resolve(import.meta.dirname, "sql", "polarimeter_workflow_migration.sql"),
    "utf8"
  );

  it("adds a NULLable bigint self-referencing retest column with an index", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS retest_of_record_id bigint REFERENCES public\.validation_records\(id\) ON DELETE RESTRICT/
    );
    expect(sql).not.toMatch(/retest_of_record_id\s+(uuid|text)/i);
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS retest_of_record_id[^,\n]*NOT NULL/i);
    expect(sql).toMatch(/validation_records_retest_parent_idx/);
  });

  it("is transactional, guards the primary-key type, and reloads the PostgREST schema cache", () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toMatch(/expected bigint/);
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/);
    expect(sql.search(/^NOTIFY pgrst/m)).toBeGreaterThan(sql.search(/^COMMIT;$/m));
  });

  it("never deletes or rewrites historical validation data", () => {
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.validation_records/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});
