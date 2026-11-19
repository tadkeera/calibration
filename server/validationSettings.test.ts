import { describe, expect, it } from "vitest";
import { REAL_SUPABASE_LABEL, runRealSupabase } from "./testSupport/realSupabase";
import { listValidationSettings } from "./db";

describe.skipIf(!runRealSupabase)(`${REAL_SUPABASE_LABEL} controlled validation settings`, () => {
  it("loads one Supabase settings profile for each supported instrument", async () => {
    const settings = await listValidationSettings();
    expect(settings).toHaveLength(8);
    expect(settings.find((entry) => entry.deviceKey === "disintegration")?.settings).toMatchObject({ bathSet: 38, cycleMin: 29, cycleMax: 32 });
  });
});
