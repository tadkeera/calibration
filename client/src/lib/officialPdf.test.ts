import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(import.meta.dirname, "officialPdf.ts");

describe("official PDF header policy", () => {
  it("uses only the exact official-header asset", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain('const officialHeaderProcedureUrl = "/api/trpc/assets.officialReportHeaderUrl"');
    expect(source).not.toContain("yemen-qc-official-report-header_4f137299.png");
  });

  it("refuses to create an official PDF without the original header image", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("لم يتم إنشاء PDF دونها");
    expect(source).not.toContain("function fallbackHeader");
    expect(source).toContain("const headerImage = await loadOfficialHeader()");
  });
});
