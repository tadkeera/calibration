import { describe, expect, it } from "vitest";
import { assertServerEvaluatedResult } from "./validationRecompute";

const settings = { bathSet: 38, bathTolerance: 2, mediumMin: 35, mediumMax: 39, timeMin: 239, timeMax: 241, cycleMin: 29, cycleMax: 32 };
const matchingPayload = { overall: true, rows: [{ actual: "37.5 °C", pass: true }, { actual: "37.3 °C", pass: true }, { actual: "4.00", pass: true }, { actual: "31.0 rpm", pass: true }, { actual: "30.0 rpm", pass: true }, { actual: "29.9 rpm", pass: true }] };

describe("server validation re-evaluation", () => {
  it("accepts a disintegration result that matches the controlled settings", () => {
    expect(assertServerEvaluatedResult("disintegration", matchingPayload, settings, "pass")).toBe(true);
  });
  it("rejects a tampered PASS result even when settings are unchanged", () => {
    const tampered = { ...matchingPayload, rows: matchingPayload.rows.map((row, index) => index === 3 ? { actual: "40.0 rpm", pass: true } : row) };
    expect(() => assertServerEvaluatedResult("disintegration", tampered, settings, "pass")).toThrow("do not match");
  });
});
