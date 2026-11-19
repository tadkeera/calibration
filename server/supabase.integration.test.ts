/**
 * [REAL Supabase] integration checks against the configured live project.
 *
 * Runs only with real credentials (see server/testSupport/realSupabase.ts);
 * otherwise every test is reported as SKIPPED. Run explicitly with
 *   pnpm test:integration      (fails if credentials are missing)
 *
 * Default checks are READ-ONLY (PostgREST `select … limit=0/1` probes and the
 * protocol module schema probe). The draft write round-trip below runs only
 * when SUPABASE_INTEGRATION_WRITE=1: it creates a uniquely keyed Polarimeter
 * server draft for an existing administrator, updates it, reopens it and then
 * removes that draft again. It never touches validation records, approvals,
 * audit history or protocol data.
 */
import { describe, expect, it } from "vitest";
import { REAL_SUPABASE_LABEL, runRealSupabase } from "./testSupport/realSupabase";
import * as supabase from "./supabaseDb";
import { supabaseProtocolStore } from "./protocols/supabaseStore";

const writeEnabled = process.env.SUPABASE_INTEGRATION_WRITE === "1";

describe.skipIf(!runRealSupabase)(`${REAL_SUPABASE_LABEL} deployed schema and persistence`, () => {
  it("validation workflow schema (polarimeter_workflow_migration.sql) is applied and visible to PostgREST", async () => {
    const health = await supabase.checkSchemaHealth();
    expect(health.checks.filter(c => !c.ok)).toEqual([]);
    expect(health.ok).toBe(true);
  }, 30_000);

  it("Protocol Management schema (protocol_management_migration.sql) is applied", async () => {
    const status = await supabaseProtocolStore.schemaStatus();
    expect(status.missing).toEqual([]);
    expect(status.ok).toBe(true);
  }, 30_000);

  it("controlled Polarimeter settings and the existing equipment record are provisioned (no duplicate PE99003)", async () => {
    const settings = await supabase.listValidationSettings();
    expect(settings.find(s => s.deviceKey === "polarimeter")).toBeTruthy();
    const profiles = await supabase.listInstrumentProfiles();
    expect(profiles.filter(p => p.serialNumber === "PE99003").length).toBeLessThanOrEqual(1);
  }, 30_000);

  it.skipIf(!writeEnabled)("updates an existing server draft, then retrieves and reopens it intact (opt-in write)", async () => {
    const admin = (await supabase.listUsers()).find(u => u.role === "admin" && u.isActive);
    expect(admin, "an active administrator account is required").toBeTruthy();
    const polarimeter = (await supabase.listValidationSettings()).find(s => s.deviceKey === "polarimeter")!;
    const protocolVersion = String((polarimeter.settings as Record<string, unknown>).protocolVersion ?? 1);
    const draftKey = `integration-test-${Date.now()}`;
    const snapshot = { protocolVersion, note: "integration-test fixture, not laboratory data" };
    let version = 0;
    try {
      const first = await supabase.savePolarimeterDraft({ userId: admin!.id, draftKey, protocolVersion, payload: { step: 1, inputs: { accuracy: { opticalRotation: "1.33" } }, protocolSnapshot: snapshot }, expectedVersion: 0 });
      version = first.version;
      const payload = { step: 5, inputs: { accuracy: { opticalRotation: "1.33" }, repeatability: { readings: ["1.00", "", "0.99"] } }, protocolSnapshot: snapshot };
      const second = await supabase.savePolarimeterDraft({ userId: admin!.id, draftKey, protocolVersion, payload, expectedVersion: first.version });
      version = second.version;
      expect(second.version).toBe(first.version + 1);
      await expect(supabase.savePolarimeterDraft({ userId: admin!.id, draftKey, protocolVersion, payload: {}, expectedVersion: first.version })).rejects.toThrow(/conflict/i);
      const reopened = await supabase.getPolarimeterDraft({ userId: admin!.id, draftKey });
      expect(reopened?.payload).toEqual(payload);
    } finally {
      if (version) await supabase.clearPolarimeterDraft({ userId: admin!.id, draftKey, expectedVersion: version });
    }
  }, 60_000);
});
