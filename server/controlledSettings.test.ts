import { describe, expect, it } from "vitest";
import { assertControlledSettingsMatch } from "./db";

describe("controlled Supabase settings guard", () => {
  const controlled = { bathSet: 38, cycleMin: 29, cycleMax: 32, nested: [{ nominal: 25, min: 24, max: 26 }] };

  it("allows a result calculated from the current settings despite object-key ordering", () => {
    expect(() => assertControlledSettingsMatch({ cycleMax: 32, nested: [{ max: 26, nominal: 25, min: 24 }], bathSet: 38, cycleMin: 29 }, controlled)).not.toThrow();
  });

  it("rejects a result whose limits differ from the current Supabase settings", () => {
    expect(() => assertControlledSettingsMatch({ ...controlled, cycleMax: 33 }, controlled)).toThrow("does not match");
  });
});
