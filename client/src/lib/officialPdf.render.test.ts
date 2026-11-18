import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { defaultSettings, devices, type CalibrationResult } from "@/lib/qc";
import {
  createPolarimeterProtocolSnapshot,
  evaluatePolarimeterInputs,
  toPolarimeterCalculatedMetrics,
  type PolarimeterV2,
} from "@shared/polarimeter";
import { downloadOfficialPdf } from "./officialPdf";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture({ readingCount = 6, pointCount = 4 } = {}) {
  const device = devices.find(entry => entry.key === "polarimeter")!;
  const settings = structuredClone(defaultSettings.polarimeter);
  settings.requiredReadings = readingCount;
  settings.linearityConcentrations = Array.from(
    { length: pointCount },
    (_, index) => (index + 1) * 10
  );
  const protocol = createPolarimeterProtocolSnapshot(settings);
  const inputs = {
    accuracy: {
      opticalRotation: "1.33",
      concentrationGPer100Ml: "1",
      tubeLengthDm: String(protocol.conditions.tubeLengthDm),
      temperatureC: "",
      wavelengthLabel: protocol.conditions.wavelengthLabel,
      wavelengthNm: protocol.conditions.wavelengthNm,
      measurementDateTime: "2025-01-02T10:00",
      referenceStandardId: "",
      referenceStandardExpiryDate: "",
      referenceStandardCertificateNumber: "",
      analystNotes: "Synthetic PDF fixture only; not laboratory data.",
    },
    repeatability: {
      sampleId: "PDF-TEST-ONLY",
      sampleConcentration: "1",
      concentrationUnit: "g/100ml" as const,
      readings: Array.from({ length: readingCount }, () => "1.00"),
      measurementConditions: "Synthetic fixture.",
      analystNotes: "Not laboratory data.",
    },
    linearity: {
      points: protocol.linearity.nominalConcentrations.map(
        (nominalConcentration, index) => ({
          pointNumber: index + 1,
          nominalConcentration,
          actualConcentration: "",
          measuredOpticalRotation: String((index + 1) * 10),
          notes: "Synthetic fixture.",
        })
      ),
      measurementConditions: "Synthetic fixture.",
      analystNotes: "Not laboratory data.",
    },
  };
  const evaluation = evaluatePolarimeterInputs(inputs, protocol);
  const polarimeterData: PolarimeterV2 = {
    schemaVersion: 2,
    equipmentSnapshot: {
      instrumentKey: "polarimeter",
      instrumentName: device.english,
      equipmentId: device.id,
      manufacturer: device.manufacturer,
      model: device.model,
      serialNumber: device.serial,
      sopNumber: device.sop,
      formNumber: device.form,
      department: null,
      location: null,
      status: null,
    },
    protocolSnapshot: protocol,
    ...inputs,
    calculatedMetrics: toPolarimeterCalculatedMetrics(evaluation),
    testResults: {
      accuracy: evaluation.testResults.accuracy!,
      repeatability: evaluation.testResults.repeatability!,
      linearity: evaluation.testResults.linearity!,
    },
    overallResult: "pass",
  };
  const result: CalibrationResult = {
    deviceKey: "polarimeter",
    overall: true,
    rows: [],
    metrics: [],
    chartTitle: "Concentration vs. Optical Rotation",
    controlledSettings: settings,
    polarimeterData,
    createdAt: "2025-01-02T10:00:00.000Z",
  };
  return { device, result };
}

describe("Polarimeter official PDF rendering", () => {
  it("fails closed without creating a PDF when the configured official header cannot be loaded", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Official asset unavailable", { status: 404 }));
    const { device, result } = fixture();

    await expect(
      downloadOfficialPdf({
        device,
        result,
        pharmacistName: "Synthetic Fail-Closed Fixture",
        lifecycleStatus: "draft",
        recordId: 451,
        language: "en",
      })
    ).rejects.toThrow("لم يتم إنشاء PDF دونها");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates an A4 draft report from saved fixture values with its fit equation and lifecycle warning", async () => {
    // Synthetic header bytes are used only in this PDF unit test, never in the production asset path.

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQAAAABazTCJAAAADElEQVQI12M4wHAAAAMEAYHFO6KpAAAAAElFTkSuQmCC",
      "base64"
    );
    class TestFileReader {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      onerror: ((error: unknown) => void) | null = null;
      readAsDataURL(blob: Blob) {
        void blob
          .arrayBuffer()
          .then(buffer => {
            this.result = `data:${blob.type || "image/png"};base64,${Buffer.from(buffer).toString("base64")}`;
            this.onloadend?.();
          })
          .catch(error => this.onerror?.(error));
      }
    }
    vi.stubGlobal("FileReader", TestFileReader);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              data: {
                json: { url: "https://synthetic-assets.invalid/header.png" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(png, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      );
    const { device, result } = fixture();
    let filename: string | null = null;
    try {
      filename = await downloadOfficialPdf({
        device,
        result,
        pharmacistName: "Synthetic PDF Analyst",
        lifecycleStatus: "draft",
        validatedByUserId: 9,
        recordCreatedAt: "2025-01-02T10:00:00.000Z",
        technicalReview: {
          reviewerUserId: 12,
          reviewerName: "Synthetic Reviewer",
          decision: "rejected",
          recordVersion: 1,
          comments: "Synthetic review comment only.",
          rejectionReason: "Synthetic pending-SOP reason.",
          outstandingIssues: ["Verify SOP QC-032D"],
          createdAt: "2025-01-03T10:00:00.000Z",
        },
        retestOfRecordId: 440,
        retestReason: "Synthetic linked retest reason, not laboratory data.",
        recordId: 451,
        language: "en",
      });
      const pdfPath = path.resolve(filename);
      const pdfOutput = readFileSync(pdfPath).toString("latin1");
      const pageCount = [...pdfOutput.matchAll(/\/Type \/Page\b/g)].length;

      expect(filename).toBe("Polarimeter_Validation_Record.pdf");
      expect(pdfOutput.startsWith("%PDF-")).toBe(true);
      expect(pdfOutput).toMatch(/MediaBox \[0 0 595\.27\d+ 841\.88\d+\]/);
      expect(pageCount).toBeGreaterThanOrEqual(2);
      expect(pdfOutput).toContain("66.5000");
      expect(pdfOutput).toContain("Linearity Test");
      expect(pdfOutput).toContain("Repeatability");
      expect(pdfOutput).toContain("Regression equation:");
      expect(pdfOutput).toContain("DRAFT");
      expect(pdfOutput).toContain("Analyst account");
      expect(pdfOutput).toContain("User ID 9");
      expect(pdfOutput).toContain("Saved at");
      expect(pdfOutput).toContain("Synthetic Reviewer");
      expect(pdfOutput).toContain("Synthetic review comment only");
      expect(pdfOutput).toContain("Synthetic pending-SOP reason");
      expect(pdfOutput).toContain("Verify SOP QC-032D");
      expect(pdfOutput).toContain("Retest of record");
      expect(pdfOutput).toContain("Synthetic linked retest reason");
      expect(pdfOutput).toContain(`Page 1 of ${pageCount}`);
      expect(pdfOutput).toContain(`Page ${pageCount} of ${pageCount}`);
      expect(pdfOutput).toContain("Electronic signature");
      expect(pdfOutput).not.toContain("26.74");
      expect(pdfOutput).not.toContain("20.0204");
      expect(pdfOutput).not.toContain("1.33700");
    } finally {
      if (filename) {
        const pdfPath = path.resolve(filename);
        if (existsSync(pdfPath)) unlinkSync(pdfPath);
      }
    }
  });

  it("paginates the maximum configured Polarimeter reading and linearity-point tables", async () => {
    // Synthetic header bytes are test-only; the app never uses them as a fallback.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQAAAABazTCJAAAADElEQVQI12M4wHAAAAMEAYHFO6KpAAAAAElFTkSuQmCC",
      "base64"
    );
    class TestFileReader {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      onerror: ((error: unknown) => void) | null = null;
      readAsDataURL(blob: Blob) {
        void blob
          .arrayBuffer()
          .then(buffer => {
            this.result = `data:${blob.type || "image/png"};base64,${Buffer.from(buffer).toString("base64")}`;
            this.onloadend?.();
          })
          .catch(error => this.onerror?.(error));
      }
    }
    vi.stubGlobal("FileReader", TestFileReader);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              data: {
                json: { url: "https://synthetic-assets.invalid/header.png" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(png, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      );
    const { device, result } = fixture({ readingCount: 50, pointCount: 20 });
    let filename: string | null = null;
    try {
      filename = await downloadOfficialPdf({
        device,
        result,
        pharmacistName: "Synthetic Max-Table Fixture",
        lifecycleStatus: "draft",
        recordId: 452,
        recordCreatedAt: "2025-01-02T10:00:00.000Z",
        language: "en",
      });
      const pdfOutput = readFileSync(path.resolve(filename)).toString("latin1");
      const pageCount = [...pdfOutput.matchAll(/\/Type \/Page\b/g)].length;
      expect(pageCount).toBeGreaterThanOrEqual(3);
      expect(pdfOutput).toContain("Reading");
      expect(pdfOutput).toContain("Point");
      expect(pdfOutput).toContain(`Page 1 of ${pageCount}`);
      expect(pdfOutput).toContain(`Page ${pageCount} of ${pageCount}`);
    } finally {
      if (filename) {
        const pdfPath = path.resolve(filename);
        if (existsSync(pdfPath)) unlinkSync(pdfPath);
      }
    }
  });
});
