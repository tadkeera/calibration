/**
 * PDF tests for the protocol-driven validation report (Master prompt §20, items 26–33):
 * the report is generated from a REAL stored validation (protocol approved by the
 * Quality Manager → validation recorded → read back), never from fixtures in the UI.
 *   Section A: numerical tables only → page break → Section B: one graph per page.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { closeLocalDatabase, createLocalUser } from "./localDb";
import * as svc from "./protocols/service";
import * as val from "./protocols/validationService";
import { sqliteProtocolStore } from "./protocols/sqliteStore";
import { stats } from "../shared/protocols/calc";
import { fmt } from "../shared/protocols/graphs";
import { pdfSafe } from "../client/src/components/protocols/protocolPdf";
import type { ProtocolContentInput } from "../shared/protocols/model";
import { buildValidationPdf, niceTicks, type ValidationPdfInput } from "../client/src/components/protocols/validationPdf";

const testDatabase = "/tmp/miayar-v4-pdf.test.sqlite";
const PW = "v4-pdf-password-1";
let admin: svc.Actor, editor: svc.Actor, qm: svc.Actor, normal: svc.Actor;

async function user(email: string, name: string, role: "admin" | "user"): Promise<svc.Actor> {
  const u = await createLocalUser({ email, password: PW, name, role });
  return { id: u.id, name: u.name, role, email };
}

const ev = { verificationStatus: "verified", verificationEvidence: "Checked against the controlled source (test fixture)" } as const;
function content(base: any): ProtocolContentInput {
  return {
    ...base,
    stages: ["Calibration"],
    narrative: { ...base.narrative, purpose: "Refractometer calibration (PDF test fixture)", scope: "Refractometer QC-I-030 (PDF test fixture)" },
    sections: [
      {
        key: "tests",
        title: "Tests",
        tests: [
          {
            key: "accuracy",
            name: "Accuracy with certified standards",
            dataType: "multi-level",
            unit: "nD",
            readingsRequired: 3,
            levels: [
              { key: "W", label: "Water", nominal: 1.333, unit: "nD" },
              { key: "S1", label: "Std 1", nominal: 1.4, unit: "nD" },
              { key: "S2", label: "Std 2", nominal: 1.47, unit: "nD" },
              { key: "S3", label: "Std 3", nominal: 1.52, unit: "nD" },
            ],
            calculations: [
              { key: "max_err", label: "Max |level error|", kind: "max-level-abs-error", unit: "nD" },
              { key: "r2", label: "r²", kind: "linearity-r2" },
            ],
            criteria: [
              { key: "acc", parameter: "max_err", requirement: "Max |error| ≤ 0.0002", comparison: "<=", upper: 0.0002, unit: "nD", sourceClass: "manufacturer", justification: "Entered by the editor (test fixture)", ...ev },
              { key: "lin", parameter: "r2", requirement: "r² ≥ 0.999", comparison: ">=", lower: 0.999, sourceClass: "institutional", justification: "Laboratory limit (test fixture)", ...ev },
            ],
            graphs: [{ type: "calibration-curve" }, { type: "measured-vs-reference" }, { type: "error" }, { type: "deviation" }],
          },
          {
            key: "repeat",
            name: "Repeatability (10 readings)",
            dataType: "series",
            unit: "nD",
            readingsRequired: 10,
            calculations: [
              { key: "mean", label: "Mean", kind: "mean", unit: "nD" },
              { key: "sd", label: "SD", kind: "sd", unit: "nD" },
              { key: "rsd", label: "RSD", kind: "rsd", unit: "%" },
            ],
            criteria: [{ key: "rsd_lim", parameter: "rsd", requirement: "RSD ≤ 0.05 %", comparison: "<=", upper: 0.05, unit: "%", sourceClass: "institutional", justification: "Laboratory limit (test fixture)", ...ev }],
            graphs: [{ type: "repeatability" }],
          },
          {
            key: "temp",
            name: "Prism temperature",
            dataType: "numeric",
            unit: "°C",
            readingsRequired: 1,
            calculations: [{ key: "t", label: "Temperature", kind: "mean", unit: "°C" }],
            criteria: [{ key: "t_lim", parameter: "t", requirement: "20.0 ± 0.5 °C", comparison: "target±tolerance", target: 20, tolerance: 0.5, unit: "°C", sourceClass: "manufacturer", justification: "Manual (test fixture)", ...ev }],
          },
        ],
      },
    ],
  } as ProtocolContentInput;
}

const READINGS = {
  accuracy: { levels: { W: [1.33301, 1.33302, 1.333], S1: [1.40001, 1.4, 1.40002], S2: [1.47003, 1.47001, 1.47002], S3: [1.52001, 1.52002, 1.52] } },
  repeat: { readings: [1.33301, 1.33302, 1.333, 1.33301, 1.33303, 1.333, 1.33302, 1.33301, 1.33301, 1.33302] },
  temp: { readings: [20.1] },
};

type Doc = ReturnType<typeof buildValidationPdf>["doc"];
/** Text and raw drawing operators of one page (jsPDF keeps uncompressed page streams in memory). */
function pageOps(doc: Doc, page: number): string {
  return ((doc as unknown as { internal: { pages: string[][] } }).internal.pages[page] ?? []).join("\n");
}
function pageText(doc: Doc, page: number): string {
  return Array.from(pageOps(doc, page).matchAll(/\((.*?)\) Tj/g), m => m[1].replace(/\\([()\\])/g, "$1")).join(" ").replace(/\u0097/g, "—").replace(/\u0096/g, "–");
}

describe("validation report PDF (Section A tables, Section B graphs)", () => {
  let input: ValidationPdfInput;
  let stored: Awaited<ReturnType<typeof val.getValidation>>;

  beforeAll(async () => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    admin = await user("admin@pdf.test", "Admin", "admin");
    editor = await user("editor@pdf.test", "Editor", "user");
    qm = await user("qm@pdf.test", "Quality Manager", "user");
    normal = await user("normal@pdf.test", "Normal User", "user");
    await svc.setDuty(admin, { userId: editor.id, duty: "author", granted: true, reason: "Authorized protocol editor" });
    await svc.setDuty(admin, { userId: qm.id, duty: "quality-manager", granted: true, reason: "Quality Manager" });
    const created = await val.createProtocolForEquipment(editor, { instrumentKey: "refractometer", number: "CAL-QC-REF-T01", title: "Refractometer calibration (test)", reason: "Entered manually" });
    const r = await svc.getRevision(editor, created.revisionId);
    await svc.saveDraft(editor, { revisionId: created.revisionId, expectedRowVersion: r.revision.rowVersion, content: content(r.revision.content), reason: "Tests entered" });
    const v = (await svc.getRevision(qm, created.revisionId)).revision.rowVersion;
    await svc.transition(qm, { revisionId: created.revisionId, expectedRowVersion: v, action: "approve", password: PW });
    const rec = await val.recordValidation(normal, { instrumentKey: "refractometer", revisionId: created.revisionId, measurements: READINGS });
    stored = await val.getValidation(rec.runId);
    input = {
      organization: "National Drug Quality Control Laboratory — Supreme Board of Drugs",
      runNumber: stored.runNumber,
      protocolNumber: stored.protocolNumber,
      protocolTitle: stored.protocolTitle,
      revisionNumber: stored.revisionNumber,
      revisionApprovedBy: stored.revisionApprovedBy,
      revisionApprovedAt: stored.revisionApprovedAt,
      contentHash: stored.contentHash,
      content: stored.content,
      equipment: stored.equipment,
      measurements: stored.measurements,
      evaluation: stored.evaluation,
      referenceSnapshot: stored.referenceSnapshot,
      recordedBy: stored.recordedBy,
      recordedAt: stored.recordedAt,
      generatedBy: "Normal User",
      generatedAt: new Date("2026-11-18T10:00:00Z"),
    };
  });

  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    delete process.env.QC_STORAGE_MODE;
  });

  it("26 — Section A holds the numerical results tables of the stored record", () => {
    const { doc, tablePages } = buildValidationPdf(input);
    const a = Array.from({ length: tablePages }, (_, i) => pageText(doc, i + 1)).join(" ");
    expect(a).toContain("SECTION A");
    for (const h of ["A1. Validation record", "A2. Equipment", "A3. Results summary", "A4. Test data, calculations and acceptance criteria", "A5. References", "A6. Signatures"]) expect(a).toContain(h);
    expect(a).toContain(stored.runNumber);
    expect(a).toContain("CAL-QC-REF-T01");
    expect(a).toContain("QC-I-030");
    expect(a).toContain("Acceptance limit");
    expect(a).toContain(`OVERALL RESULT`);
    expect(a).toContain(stored.evaluation.overall);
    // The numbers in the table are the calculation-engine results of the stored readings.
    const rsd = stored.evaluation.tests.find(t => t.testKey === "repeat")!.calculations.find(c => c.key === "rsd")!;
    expect(rsd.raw).toBeCloseTo((stats.sd(READINGS.repeat.readings) / stats.mean(READINGS.repeat.readings)) * 100, 10);
    expect(a).toContain(`RSD — ${fmt(rsd.value as number)} %`);
    // Formulas are printed legibly (no "?" substitution of Σ, x̄, subscripts).
    expect(a).toContain("s = sqrt(sum(xi - xbar)² / (n - 1))");
    expect(a).not.toMatch(/\?x\?/);
  });

  it("27 — a page break separates Section A from Section B", () => {
    const { doc, tablePages, graphPages } = buildValidationPdf(input);
    expect(graphPages[0]).toBe(tablePages + 1);
    expect(pageText(doc, tablePages + 1)).toContain("SECTION B");
    expect(pageText(doc, tablePages)).not.toContain("SECTION B");
  });

  it("28 — every graph is on its own page, in test order", () => {
    const { doc, graphPages, graphs, tablePages } = buildValidationPdf(input);
    expect(graphs.map(g => g.type)).toEqual(["calibration-curve", "measured-vs-reference", "error", "deviation", "repeatability"]);
    expect(graphPages).toEqual(graphs.map((_, i) => tablePages + 1 + i));
    graphPages.forEach((p, i) => {
      const t = pageText(doc, p);
      expect(t).toContain(`B${i + 1}. ${graphs[i].title}`);
      expect((t.match(/\bB\d+\. /g) ?? []).length).toBe(1);
      // 29 — titles and axis labels are printed on the graph page.
      expect(graphs[i].xLabel.length).toBeGreaterThan(0);
      expect(t).toContain(pdfSafe(graphs[i].xLabel));
      expect(t).toContain(pdfSafe(graphs[i].yLabel));
    });
  });

  it("29 — no empty graph pages: each graph page draws real recorded points", () => {
    const { doc, graphPages, graphs, tablePages } = buildValidationPdf(input);
    expect(doc.getNumberOfPages()).toBe(tablePages + graphs.length);
    graphs.forEach((g, i) => {
      const pts = g.series.flatMap(s => s.points);
      expect(pts.length).toBeGreaterThan(0);
      // Drawing operators (paths) exist on the page.
      expect((pageOps(doc, graphPages[i]).match(/ (l|re|c)\n/g) ?? []).length).toBeGreaterThan(10);
    });
    // Calibration-curve points are exactly (reference, mean of recorded level readings).
    const cc = graphs.find(g => g.type === "calibration-curve")!;
    const measured = cc.series.find(s => s.kind === "points")!.points;
    expect(measured.map(p => p.x)).toEqual([1.333, 1.4, 1.47, 1.52]);
    expect(measured[0].y).toBeCloseTo(stats.mean(READINGS.accuracy.levels.W), 12);
    expect(cc.regression!.n).toBe(4);
    const rep = graphs.find(g => g.type === "repeatability")!;
    expect(rep.series.find(s => s.kind === "points")!.points.map(p => p.y)).toEqual(READINGS.repeat.readings);
  });

  it("30 — graphs never appear inside the tables, and graph pages contain no result tables", () => {
    const { doc, tablePages, graphPages } = buildValidationPdf(input);
    for (let p = 1; p <= tablePages; p++) expect(pageText(doc, p)).not.toMatch(/\bB\d+\. /);
    graphPages.forEach(p => {
      const t = pageText(doc, p);
      expect(t).not.toContain("Acceptance limit");
      expect(t).not.toContain("Recorded data");
    });
  });

  it("31 — every page is numbered 'Page x of y' and carries the record ID", () => {
    const { doc } = buildValidationPdf(input);
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      const t = pageText(doc, p);
      expect(t).toContain(`Page ${p} of ${n}`);
      expect(t).toContain(stored.runNumber);
      expect(t).toContain(p <= buildValidationPdf(input).tablePages ? "Section A" : "Section B");
    }
  });

  it("32 — the report reproduces the stored record and the protocol revision used", () => {
    const { doc, tablePages } = buildValidationPdf(input);
    const a = Array.from({ length: tablePages }, (_, i) => pageText(doc, i + 1)).join(" ");
    expect(a).toContain("Rev.01");
    expect(a).toContain("Quality Manager");
    expect(a).toContain(stored.contentHash);
    expect(a).toContain("Normal User");
    for (const t of stored.evaluation.tests) expect(a).toContain(t.name);
    expect(stored.revisionStatusAtRecording).toBe("released");
    const bytes = doc.output("arraybuffer");
    if (process.env.VALIDATION_PDF_OUT) writeFileSync(process.env.VALIDATION_PDF_OUT, Buffer.from(bytes));
    expect(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5))).toBe("%PDF-");
  });

  it("33 — a record without graphs produces no Section B pages (and says so)", () => {
    const noGraphs: ValidationPdfInput = { ...input, evaluation: { ...input.evaluation, tests: input.evaluation.tests.map(t => ({ ...t, graphs: [] })) } };
    const { doc, tablePages, graphPages } = buildValidationPdf(noGraphs);
    expect(graphPages).toEqual([]);
    expect(doc.getNumberOfPages()).toBe(tablePages);
    expect(pageText(doc, tablePages)).toContain("no graph pages are produced");
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    // Axis range always covers the data (regression: 1.333–1.52 used to stop at 1.5).
    for (const [lo, hi] of [[1.333, 1.52], [-17.004, 34.01], [0.00012, 0.00981], [5, 5]] as const) {
      const t = niceTicks(lo, hi);
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi);
    }
  });
});
