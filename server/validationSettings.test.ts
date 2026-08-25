import { describe, expect, it } from "vitest";
import { listValidationSettings } from "./db";

describe("controlled validation settings", () => {
  it("loads one Supabase settings profile for each supported instrument", async () => {
    const settings = await listValidationSettings();
    expect(settings).toHaveLength(8);
    expect(settings.find((entry) => entry.deviceKey === "disintegration")?.settings).toMatchObject({ bathSet: 38, cycleMin: 29, cycleMax: 32 });
  });
});
