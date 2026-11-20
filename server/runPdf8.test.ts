/**
 * End-to-end evidence for the 8 imported protocols: import → equipment link →
 * calibration run (dynamic steps) → save → PDF report generated from the run
 * snapshot (watermarked, page-numbered, unique document ID) → audit entry.
 *
 * The generated PDFs are written to docs/test-evidence/run-pdfs/ as review
 * evidence. They are TRIAL runs on DRAFT protocol revisions and therefore
 * carry the "TRIAL RUN – NOT APPROVED" watermark. Input values are test
 * fixtures (HPLC T01 uses the handwritten HPLC.pdf p.2 values; the rest are
 * synthetic) — they are NOT calibration results for any instrument.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeLocalDatabase, createLocalUser } from "./localDb";
import * as svc from "./protocols/service";
import * as wf from "./protocols/workflowService";
import { sqliteProtocolStore } from "./protocols/sqliteStore";
import { PACKAGE_PROTOCOLS } from "../shared/protocols/package8";
import type { Measurements } from "../shared/protocols/evaluate";
import type { EquipmentSnapshot } from "../shared/protocols/equipment";
import { buildRunPdf } from "../client/src/components/protocols/runPdf";

const testDatabase = "/tmp/miayar-runpdf.test.sqlite";
const OUT = path.resolve(import.meta.dirname, "..", "docs", "test-evidence", "run-pdfs");
const PW = "runpdf-test-password-1";
let author: svc.Actor;

/** Fixture inputs per protocol (see file header). */
const FIXTURES: Record<string, Measurements> = {
  "CAL-QC-HPLC-001": { T01: { fields: { set_1: 0.5, vol_1: 10, time_1: 20, set_2: 1.5, vol_2: 10, time_2: 6.6, set_3: 2.5, vol_3: 10, time_3: 4 }, comment: "Fixture: HPLC.pdf p.2 handwritten values" } },
  "CAL-QC-BAL-001": { T04: { readings: Array(10).fill(100.0001), fields: { m: 0.1 }, comment: "Synthetic fixture" } },
  "CAL-QC-UV-001": { T02: { fields: { instrument_type: "non-diode-array", wl_standard: "Holmium oxide", wl_cert: "FIXTURE" }, levelReferences: { UVL: 361.5, VISL: 536.4 }, levels: { UVL: [361.6, 361.5, 361.7, 361.6, 361.5, 361.6], VISL: [537.9, 538.0, 537.8, 538.1, 537.9, 538.0] } } },
  "CAL-QC-POL-001": { T06: { notApplicable: true, naJustification: "Fixture: demonstrates a justified NOT APPLICABLE entry" } },
};

const pdfText = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("latin1");

describe("8 protocols → calibration runs → PDF reports", () => {
  beforeAll(async () => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    const u = await createLocalUser({ email: "author@pdf.test", password: PW, name: "Author", role: "user" });
    author = { id: u.id, name: u.name, role: "user", email: "author@pdf.test" };
    mkdirSync(OUT, { recursive: true });
  });

  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    delete process.env.QC_STORAGE_MODE;
  });

  it("imports the package, runs every protocol with its own step count and produces a watermarked PDF per run", async () => {
    const imp = await wf.importCalibrationPackage(author);
    expect(imp.created).toBe(8);
    // HPLC.pdf documents an LC-2030 PLUS that is not in the Equipment Library: register a clearly-labelled TEST FIXTURE instrument for the trial run.
    await wf.createEquipmentData(author, { instrumentKey: "hplc-lc2030-fixture", equipmentType: "hplc", identity: { instrumentId: "TEST-FIXTURE-HPLC", manufacturer: "Shimadzu", model: "LC-2030 PLUS", serialNumber: "TEST-FIXTURE", nameEn: "HPLC (test fixture)", nameAr: "جهاز اختبار", sopNumber: "", formNumber: "" }, specs: {}, reason: "Automated test fixture", reference: "server/runPdf8.test.ts" });

    const catalog = await wf.runCatalog();
    const summary: Array<Record<string, unknown>> = [];
    for (const p of PACKAGE_PROTOCOLS) {
      const entry = catalog.find(c => c.protocolNumber === p.number)!;
      expect(entry, p.number).toBeTruthy();
      const equipment = entry.equipment.find(e => e.status === "active")!;
      expect(equipment, `${p.number} has applicable equipment`).toBeTruthy();
      const { runId } = await wf.createRun(author, { protocolId: entry.protocolId, instrumentKey: equipment.instrumentKey });
      const fixture = FIXTURES[p.number] ?? {};
      if (Object.keys(fixture).length) await wf.saveRun(author, { runId, expectedRowVersion: 1, measurements: fixture, currentStep: "results" });
      const d = await wf.getRun(author, runId);

      // dynamic steps: 6 frame steps + one per test of THIS protocol
      const tests = d.content.sections.flatMap(s => s.tests).length;
      expect(d.steps.length).toBe(tests + 6);
      expect(d.steps.filter(s => s.kind === "test").map(s => s.testKey)).toEqual(d.content.sections.flatMap(s => s.tests.map(t => t.key)));
      // loading/executing never implies PASS; pending criteria block approval
      expect(d.evaluation.overall).not.toBe("PASS");
      expect(d.blockers.some(b => b.code === "pending-verification" && b.blocksApproval)).toBe(true);
      expect(d.blockers.some(b => b.code === "revision-not-released" && b.blocksRecording)).toBe(true);

      const { doc, documentId, status } = buildRunPdf({
        organization: "National Drug Quality Control Laboratory — Supreme Board of Drugs",
        runNumber: d.run.runNumber, runStatus: d.run.status, rowVersion: d.run.rowVersion, protocolNumber: d.run.protocolNumber, revisionNumber: d.run.revisionNumber,
        revisionStatus: d.revision.status, contentHash: d.run.contentHash, content: d.content, equipment: d.run.equipmentSnapshot as EquipmentSnapshot,
        newerEquipmentData: d.newerEquipmentData, measurements: d.run.measurements, evaluation: d.evaluation, blockers: d.blockers, executionReviewStatus: null,
        createdBy: d.run.createdBy, createdAt: d.run.createdAt, updatedBy: d.run.updatedBy, updatedAt: d.run.updatedAt, history: d.history,
        signatures: [{ role: "Executed / recorded by", name: null, date: null, meaning: null }, { role: "Technical reviewer", name: null, date: null, meaning: null }, { role: "QA approver", name: null, date: null, meaning: null }],
        generatedBy: "automated test", generatedAt: new Date("2026-11-18T09:00:00Z"),
      });
      expect(status.watermark).toBe("TRIAL RUN – NOT APPROVED");
      expect(documentId).toMatch(new RegExp(`^${d.run.runNumber}-V${d.run.rowVersion}-[0-9A-F]{8}$`));
      const pages = doc.getNumberOfPages();
      expect(pages).toBeGreaterThanOrEqual(2);
      const bytes = doc.output("arraybuffer");
      const text = pdfText(bytes);
      expect(text).toContain("NOT APPROVED");
      expect(text).toContain(`Page ${pages} of ${pages}`);
      expect(text).toContain(documentId);
      expect(text).toContain("PENDING TECHNICAL VERIFICATION");
      expect(text).toContain("Not signed in the system");
      if (!Object.keys((d.run.equipmentSnapshot as EquipmentSnapshot).specs).length) expect(text).toMatch(/Not available in/); // wraps inside table cells
      const file = `${p.number}.pdf`;
      writeFileSync(path.join(OUT, file), Buffer.from(bytes));
      await wf.logRunPdf(author, { runId, documentStatus: status.label.slice(0, 60), documentId });
      summary.push({ protocol: p.number, equipment: equipment.instrumentId, tests, steps: d.steps.length, overall: d.evaluation.overall, counts: d.evaluation.counts, pages, documentId, file });
    }
    writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    expect(summary.map(s => s.steps)).toEqual([16, 12, 14, 12, 13, 13, 12, 14]);
    // audit: one run.pdf entry per protocol
    const audit = await sqliteProtocolStore.select<{ action: string }>("protocol_audit_events", { where: { action: "run.pdf-generated" } });
    expect(audit.length).toBe(8);
  });
});
