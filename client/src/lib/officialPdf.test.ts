import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(import.meta.dirname, "officialPdf.ts");
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const approvedHeaderKey = "yemen-qc-official-report-header_14217543.png";

function readRepositorySource(relativePath: string) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

describe("official PDF header policy", () => {
  it("requests the configured official-header endpoint without a fallback asset", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain(
      'const officialHeaderProcedureUrl = "/api/trpc/assets.officialReportHeaderUrl"'
    );
    expect(source).not.toContain("yemen-qc-official-report-header_4f137299.png");
    expect(source).not.toContain("fallbackHeader");
  });

  it("uses the canonical approved storage key across cloud and local asset routes", () => {
    expect(readRepositorySource("server/officialHeader.ts")).toContain(
      `OFFICIAL_REPORT_HEADER_KEY = "${approvedHeaderKey}"`
    );
    expect(readRepositorySource("server/_core/storageProxy.ts")).toContain(
      'import { OFFICIAL_REPORT_HEADER_KEY } from "../officialHeader"'
    );
    expect(readRepositorySource("server/_core/app.ts")).toContain(
      'import { OFFICIAL_REPORT_HEADER_KEY } from "../officialHeader"'
    );
    expect(readRepositorySource("server/_core/app.ts")).toContain(
      "url: `/manus-storage/${OFFICIAL_REPORT_HEADER_KEY}`"
    );
    expect(readRepositorySource("server/routers.ts")).toContain(
      "getOfficialReportHeaderUrl()"
    );
  });

  it("refuses to create an official PDF without the original header image", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("لم يتم إنشاء PDF دونها");
    expect(source).not.toContain("function fallbackHeader");
    expect(source).toContain("const headerImage = await loadOfficialHeader()");
  });

  it("renders Polarimeter PDF values from the saved versioned input and metric snapshot", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("result.polarimeterData");
    expect(source).toContain("accuracy.opticalRotation");
    expect(source).toContain("data.repeatability.readings");
    expect(source).toContain("data.linearity.points");
    expect(source).toContain("stats.regressionSlope");
    expect(source).toContain("stats.regressionIntercept");
    expect(source).toContain("stats.correlationCoefficient");
    expect(source).toContain("stats.coefficientOfDetermination");
    expect(source).toContain("Regression equation:");
    expect(source).toContain("Measured points");
    expect(source).toContain("Least-squares regression line");
    expect(source).toContain("Overall test state");
    expect(source).toContain('"Rotation (°)"');
    expect(source).toContain('"Conc. (g/100ml)"');
    expect(source).toContain('"[alpha] = 100 * rotation / (l * c)"');
    expect(source).not.toMatch(
      /26\.74|20\.0204|13\.37|53\.48|0\.99993|1\.33700/
    );
  });

  it("uses the saved equipment/lifecycle snapshot and never represents a Polarimeter draft as signed", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("input.result.polarimeterData?.equipmentSnapshot");
    expect(source).toContain("reportInput.lifecycleStatus.toUpperCase()");
    expect(source).toContain(
      "No secure electronic signature is captured by the current record system."
    );
    expect(source).toContain("function addPageNumbers");
    expect(source).toContain("Page ${page} of ${pageCount}");
    expect(source).toContain(
      "PROTOCOL PENDING VERIFICATION · NOT FORMALLY APPROVED"
    );
  });
});
