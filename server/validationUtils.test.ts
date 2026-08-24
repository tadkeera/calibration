import { describe, expect, it } from "vitest";
import { createRecordSummary, decisionSummary, exportRecordSummary, updateRecordSummary } from "./validationUtils";

describe("validation audit summaries", () => {
  it("creates a deterministic creation event", () => {
    expect(createRecordSummary("QC-I-029", "pass")).toBe("Created validation record for QC-I-029 with PASS result.");
  });

  it("describes draft updates with the final result state", () => {
    expect(updateRecordSummary("QC-I-104", "fail")).toContain("QC-I-104");
    expect(updateRecordSummary("QC-I-104", "fail")).toContain("FAIL");
  });

  it("preserves an explicit approval or rejection decision", () => {
    expect(decisionSummary("QC-I-008", "approved")).toBe("Approved validation record for QC-I-008.");
    expect(decisionSummary("QC-I-008", "rejected")).toBe("Rejected validation record for QC-I-008.");
  });

  it("records the official report generation action", () => {
    expect(exportRecordSummary("QC-I-030")).toBe("Generated official PDF report for QC-I-030.");
  });
});
