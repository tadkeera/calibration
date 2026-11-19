/**
 * [Supabase-mocked] Existing-draft update, retrieval and reopen through the
 * real Supabase adapter (server/supabaseDb.ts).
 *
 * fetch() is answered by a small STATEFUL in-memory PostgREST emulation
 * (eq filters, limit, POST/PATCH with return=representation), so version
 * guards and round-trips behave like a table. This proves the adapter's
 * requests and JSON round-trip — it is NOT the deployed database. The real
 * PostgreSQL behaviour is covered by scripts/db-verify (embedded Postgres) and
 * the deployed project by server/supabase.integration.test.ts (real creds only).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, devices } from "../client/src/lib/qc";
import { createPolarimeterProtocolSnapshot, type PolarimeterV2 } from "../shared/polarimeter";
import * as supabase from "./supabaseDb";
import { buildPolarimeterDerivedResult } from "./validationRecompute";

type Row = Record<string, unknown>;

function fakePostgrest(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  let nextId = 1000;
  const requests: Array<{ method: string; table: string; query: string }> = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const matches = (row: Row, params: URLSearchParams) => {
    for (const [key, value] of Array.from(params.entries())) {
      if (["select", "limit", "order", "offset"].includes(key)) continue;
      if (!value.startsWith("eq.")) throw new Error(`Unsupported filter in fake PostgREST: ${key}=${value}`);
      if (String(row[key] ?? "") !== decodeURIComponent(value.slice(3))) return false;
    }
    return true;
  };
  const handler = async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.replace("/rest/v1/", "");
    const method = init?.method ?? "GET";
    requests.push({ method, table, query: url.search });
    if (table === "audit_events") return new Response("", { status: 201 });
    const rows = (tables[table] ??= []);
    const now = new Date().toISOString();
    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? Infinity);
      return json(structuredClone(rows.filter(r => matches(r, url.searchParams)).slice(0, limit)));
    }
    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as Row;
      if (table === "polarimeter_drafts" && rows.some(r => r.user_id === body.user_id && r.draft_key === body.draft_key))
        return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
      const defaults: Row =
        table === "validation_records"
          ? { lifecycle_status: "draft", approved_by_user_id: null, approved_at: null, record_version: 1 }
          : table === "polarimeter_drafts"
            ? { version: 1 }
            : {};
      const row = { id: nextId++, ...defaults, ...body, created_at: now, updated_at: now };
      rows.push(row);
      return json([structuredClone(row)], 201);
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as Row;
      const hit = rows.filter(r => matches(r, url.searchParams));
      hit.forEach(r => Object.assign(r, body));
      return json(structuredClone(hit));
    }
    throw new Error(`Unexpected synthetic request ${method} ${url}`);
  };
  return { tables, requests, handler };
}

function fixture() {
  const device = devices.find(entry => entry.key === "polarimeter")!;
  const settings = structuredClone(defaultSettings.polarimeter) as Record<string, unknown>;
  const protocol = createPolarimeterProtocolSnapshot(settings);
  const input: PolarimeterV2 = {
    schemaVersion: 2,
    equipmentSnapshot: { instrumentKey: "polarimeter", instrumentName: device.english, equipmentId: device.id, manufacturer: device.manufacturer, model: device.model, serialNumber: device.serial, sopNumber: device.sop, formNumber: device.form, department: null, location: null, status: null },
    protocolSnapshot: protocol,
    accuracy: { opticalRotation: "1.33", concentrationGPer100Ml: "1", tubeLengthDm: String(protocol.conditions.tubeLengthDm), temperatureC: "", wavelengthLabel: protocol.conditions.wavelengthLabel, wavelengthNm: protocol.conditions.wavelengthNm, measurementDateTime: "2025-01-02T10:00", referenceStandardId: "", referenceStandardExpiryDate: "", referenceStandardCertificateNumber: "", analystNotes: "Synthetic fixture only; not laboratory data." },
    repeatability: { sampleId: "SYNTHETIC-ONLY", sampleConcentration: "1", concentrationUnit: "g/100ml", readings: ["1.00", "1.01", "0.99", "1.02", "0.98", "1.01"], measurementConditions: "Synthetic fixture.", analystNotes: "Not laboratory data." },
    linearity: { points: protocol.linearity.nominalConcentrations.map((nominalConcentration, index) => ({ pointNumber: index + 1, nominalConcentration, actualConcentration: "", measuredOpticalRotation: String((index + 1) * 10), notes: "Synthetic fixture." })), measurementConditions: "Synthetic fixture.", analystNotes: "Not laboratory data." },
    calculatedMetrics: { specificRotation: 0, repeatabilityMean: 0, repeatabilityMinimum: 0, repeatabilityMaximum: 0, repeatabilityRange: 0, repeatabilitySampleStandardDeviation: null, repeatabilityRsdPercent: null, repeatabilityDeviations: [], regressionSlope: 0, regressionIntercept: 0, correlationCoefficient: null, coefficientOfDetermination: null, validLinearityPoints: 0, overall: "fail" },
    testResults: { accuracy: "fail", repeatability: "fail", linearity: "fail" },
    overallResult: "fail",
  };
  const profile = { id: 1, instrument_key: "polarimeter", name_ar: device.name, name_en: device.english, instrument_id: device.id, sop_number: device.sop, manufacturer: device.manufacturer, model: device.model, serial_number: device.serial, form_number: device.form, accent: device.accent, updated_by_user_id: null, updated_at: "2025-01-01T00:00:00.000Z" };
  const result = (data: PolarimeterV2) => {
    const r = buildPolarimeterDerivedResult(data, settings);
    r.controlledSettings = settings;
    return r as unknown as Record<string, unknown>;
  };
  return { device, settings, input, profile, result };
}

describe("[Supabase-mocked] existing draft update, retrieval and reopen (stateful fake PostgREST)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("updates the server draft with a version guard and reopens the exact payload", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const { settings, input } = fixture();
    const fake = fakePostgrest({ validation_settings: [{ device_key: "polarimeter", settings }] });
    vi.spyOn(globalThis, "fetch").mockImplementation(fake.handler as typeof fetch);
    const protocolVersion = String(settings.protocolVersion ?? 1);

    const first = await supabase.savePolarimeterDraft({ userId: 7, draftKey: "active", protocolVersion, payload: { step: 1, inputs: { accuracy: input.accuracy } }, expectedVersion: 0 });
    expect(first.version).toBe(1);
    const fullPayload = { step: 5, inputs: { accuracy: input.accuracy, repeatability: input.repeatability, linearity: input.linearity }, protocolSnapshot: input.protocolSnapshot };
    const second = await supabase.savePolarimeterDraft({ userId: 7, draftKey: "active", protocolVersion, payload: fullPayload, expectedVersion: first.version });
    expect(second.version).toBe(2);
    // the update is a PATCH guarded by the previous version — never a blind overwrite
    expect(fake.requests.some(r => r.method === "PATCH" && r.table === "polarimeter_drafts" && r.query.includes("version=eq.1"))).toBe(true);
    // a stale save from another device is refused and the stored draft is preserved
    await expect(supabase.savePolarimeterDraft({ userId: 7, draftKey: "active", protocolVersion, payload: { step: 0, inputs: {} }, expectedVersion: 1 })).rejects.toThrow(/conflict/i);
    // creating a second draft for the same key is refused instead of overwriting
    await expect(supabase.savePolarimeterDraft({ userId: 7, draftKey: "active", protocolVersion, payload: {}, expectedVersion: 0 })).rejects.toThrow(/already exists/i);

    const reopened = await supabase.getPolarimeterDraft({ userId: 7, draftKey: "active" });
    expect(reopened?.version).toBe(2);
    expect(reopened?.payload).toEqual(fullPayload);
  });

  it("updates an existing draft record and reopens it with measurements and protocol snapshot preserved", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const { device, settings, input, profile, result } = fixture();
    const fake = fakePostgrest({ validation_settings: [{ device_key: "polarimeter", settings }], instrument_profiles: [profile] });
    vi.spyOn(globalThis, "fetch").mockImplementation(fake.handler as typeof fetch);
    const identity = { instrumentKey: "polarimeter", instrumentName: device.english, instrumentId: device.id, sopNumber: device.sop, formNumber: device.form, pharmacistName: "Synthetic Integration Analyst", userId: 9 };

    const created = await supabase.createValidationRecord({ ...identity, resultStatus: "pass", resultData: result(input) });
    expect(created.recordVersion).toBe(1);
    expect(fake.tables.validation_records[0]).toHaveProperty("retest_of_record_id", null);

    const corrected = structuredClone(input);
    corrected.repeatability.readings = ["1.00", "1.00", "1.01", "0.99", "1.00", "1.00"];
    const updated = await supabase.updateValidationRecord({ ...identity, id: created.id, expectedVersion: 1, resultStatus: "pass", resultData: result(corrected) });
    expect(updated.recordVersion).toBe(2);
    expect(fake.requests.some(r => r.method === "PATCH" && r.table === "validation_records" && r.query.includes("record_version=eq.1"))).toBe(true);

    await expect(supabase.updateValidationRecord({ ...identity, id: created.id, expectedVersion: 1, resultStatus: "pass", resultData: result(input) })).rejects.toThrow(/version conflict/i);

    const reopened = await supabase.getValidationRecordById(created.id);
    const saved = reopened!.resultData.polarimeterData as PolarimeterV2;
    expect(reopened!.recordVersion).toBe(2);
    expect(saved.repeatability.readings).toEqual(corrected.repeatability.readings);
    expect(saved.linearity.points.map(p => p.measuredOpticalRotation)).toEqual(input.linearity.points.map(p => p.measuredOpticalRotation));
    expect(saved.protocolSnapshot).toEqual(input.protocolSnapshot);
    expect(reopened!.retestOfRecordId).toBeNull();
  });
});
