import { describe, expect, it } from "vitest";
import { ADP220_REFERENCES, adp220DraftContent, remapReferencePlaceholders } from "@shared/protocols/adp220";
import { parseProtocolContent, type RevisionStatus } from "@shared/protocols/model";
import { buildProtocolPdf, documentStatus, pdfSafe, type ProtocolPdfInput } from "./protocolPdf";

const content = parseProtocolContent(
  remapReferencePlaceholders(adp220DraftContent({ manufacturer: "Bellingham & Stanley (UK)", model: "ADP220", instrumentId: "QC-I-029", serialNumber: "PE99003" }), Object.fromEntries(ADP220_REFERENCES.map(r => [r.placeholder, `ref-${r.code}`])))
);
const input = (status: RevisionStatus): ProtocolPdfInput => ({
  organization: "National Drug Quality Control Laboratory",
  content,
  revisionNumber: 1,
  status,
  contentHash: "a".repeat(64),
  effectiveDate: status === "released" ? "2026-12-01" : null,
  nextReviewDate: null,
  approvedAt: null,
  authorName: "Author",
  technicalReviewerName: null,
  technicalReviewedAt: null,
  qaApproverName: null,
  releasedByName: null,
  releasedAt: null,
  changeReason: "Initial draft",
  references: ADP220_REFERENCES.map(r => ({ id: `ref-${r.code}`, code: r.code, title: r.title, edition: r.edition, revision: r.revision, documentNumber: r.documentNumber, verificationStatus: "pending-verification", sourceUrl: r.sourceUrl })),
  approvals: [],
  gapDecisions: [],
  generatedBy: "Tester",
  generatedAt: new Date("2026-11-18T10:00:00Z"),
});

/** jsPDF compresses nothing by default, so the page content streams contain the drawn text. */
const pdfText = (status: RevisionStatus) => buildProtocolPdf(input(status)).output();

describe("protocol PDF generator", () => {
  it("watermarks drafts as DRAFT – NOT APPROVED and lists the protocol identity", () => {
    expect(documentStatus("draft").watermark).toBe("DRAFT – NOT APPROVED");
    const out = pdfText("draft");
    expect(out).toMatch(/DRAFT/);
    expect(out).toMatch(/NOT APPROVED/);
    expect(out).toMatch(/POL-QC-032D/);
    expect(out).toMatch(/PENDING TECHNICAL VERIFICATION/);
    expect(out).toMatch(/Page 1 of \d+/);
  });

  it("distinguishes approved-but-unreleased from released controlled documents", () => {
    expect(documentStatus("approved").label).toMatch(/NOT YET RELEASED/);
    expect(documentStatus("released")).toEqual({ label: "CONTROLLED DOCUMENT – RELEASED", watermark: null });
    expect(pdfText("released")).toMatch(/CONTROLLED DOCUMENT/);
    expect(documentStatus("superseded").watermark).toMatch(/NOT FOR USE/);
  });

  it("produces a multi-page A4 document with all mandatory sections", () => {
    const doc = buildProtocolPdf(input("draft"));
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
    const size = doc.internal.pageSize;
    expect(Math.round(size.getWidth())).toBe(210);
    expect(Math.round(size.getHeight())).toBe(297);
    const out = doc.output();
    ["Purpose", "Scope", "Responsibilities", "References", "Acceptance criteria", "Calculation methods", "Technical Specialist Review", "QA Approval", "Document Control Information", "Technical Gaps and Conflicts"].forEach(h => expect(out).toContain(h));
  });

  it("maps unsupported glyphs to WinAnsi-safe text", () => {
    expect(pdfSafe("≤ 0.02 ° − x → y")).toBe("<= 0.02 ° - x -> y");
    expect(pdfSafe("مرحبا")).toBe("?????");
  });
});
