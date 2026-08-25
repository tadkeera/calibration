import { describe, expect, it } from "vitest";
import { summarizeValidationRecords } from "./db";

describe("record analytics", () => {
  it("calculates outcome, approval, and instrument statistics from filtered records", () => {
    const summary = summarizeValidationRecords([
      { instrumentKey: "hplc", instrumentName: "HPLC Pump", resultStatus: "pass", lifecycleStatus: "approved" },
      { instrumentKey: "hplc", instrumentName: "HPLC Pump", resultStatus: "fail", lifecycleStatus: "rejected" },
      { instrumentKey: "moisture", instrumentName: "Moisture Analyzer", resultStatus: "pass", lifecycleStatus: "draft" },
    ]);
    expect(summary).toMatchObject({ total: 3, pass: 2, fail: 1, approved: 1, rejected: 1, draft: 1, passRate: 66.7, approvalRate: 33.3 });
    expect(summary.instruments).toEqual([{ instrumentKey: "hplc", instrumentName: "HPLC Pump", total: 2, pass: 1, fail: 1 }, { instrumentKey: "moisture", instrumentName: "Moisture Analyzer", total: 1, pass: 1, fail: 0 }]);
  });
});
