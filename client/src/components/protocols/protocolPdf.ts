/**
 * Universal protocol PDF generator (§17). Renders the EXACT content of one
 * protocol revision on A4 with header, footer, page numbering, document
 * status, signature areas and document-control information.
 *
 * Status handling:
 *   draft / review states → watermark "DRAFT – NOT APPROVED"
 *   approved (unreleased) → watermark "APPROVED – NOT RELEASED – NOT FOR USE"
 *   released              → "CONTROLLED DOCUMENT – RELEASED" (no watermark)
 *   superseded / retired / rejected → watermark stating the document is not for use
 */
import { jsPDF } from "jspdf";
import {
  CALC_KINDS,
  COMPARISONS,
  PENDING_LABEL,
  PROTOCOL_TYPES,
  SOURCE_CLASSES,
  STATUS_LABELS,
  type Criterion,
  type ProtocolContent,
  type RevisionStatus,
} from "@shared/protocols/model";

export type PdfReference = { id: string; code: string; title: string; edition: string; revision: string; documentNumber: string; verificationStatus: string; sourceUrl: string };
export type PdfApproval = { action: string; actorName: string | null; signatureMeaning: string | null; createdAt: string; comment: string | null };
export type ProtocolPdfInput = {
  organization: string;
  content: ProtocolContent;
  revisionNumber: number;
  status: RevisionStatus;
  contentHash: string;
  effectiveDate: string | null;
  nextReviewDate: string | null;
  approvedAt: string | null;
  authorName: string | null;
  technicalReviewerName: string | null;
  technicalReviewedAt: string | null;
  qaApproverName: string | null;
  releasedByName: string | null;
  releasedAt: string | null;
  changeReason: string;
  references: PdfReference[];
  approvals: PdfApproval[];
  gapDecisions: Array<{ gapKey: string; decision: string; rationale: string; reviewerName: string | null; createdAt: string }>;
  generatedBy: string;
  generatedAt: Date;
};

const DRAFT_STATUSES: RevisionStatus[] = ["draft", "technical-review-pending", "technical-review-in-progress", "technical-changes-required", "technically-reviewed", "qa-review-pending", "qa-review-in-progress", "qa-changes-required"];

export function documentStatus(status: RevisionStatus): { label: string; watermark: string | null } {
  if (DRAFT_STATUSES.includes(status)) return { label: `DRAFT – NOT APPROVED (${STATUS_LABELS[status]})`, watermark: "DRAFT – NOT APPROVED" };
  if (status === "approved") return { label: "APPROVED – NOT YET RELEASED – NOT FOR USE", watermark: "APPROVED – NOT RELEASED" };
  if (status === "released") return { label: "CONTROLLED DOCUMENT – RELEASED", watermark: null };
  if (status === "superseded") return { label: "SUPERSEDED – NOT FOR USE", watermark: "SUPERSEDED – NOT FOR USE" };
  if (status === "retired") return { label: "RETIRED – NOT FOR USE", watermark: "RETIRED – NOT FOR USE" };
  return { label: "REJECTED – NOT APPROVED", watermark: "REJECTED – NOT APPROVED" };
}

/** jsPDF standard fonts use WinAnsi; map common scientific symbols and drop unsupported characters. */
export function pdfSafe(value: unknown): string {
  return String(value ?? "")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[−‐‑‒]/g, "-")
    .replace(/→/g, "->")
    .replace(/≠/g, "!=")
    .replace(/×/g, "x")
    .replace(/√/g, "sqrt")
    .replace(/[^\n\r\t\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u2030\u20AC]/g, "?");
}

const label = <T extends { id: string; label: string }>(list: readonly T[], id: string) => list.find(x => x.id === id)?.label ?? id;

function criterionLimit(c: Criterion) {
  const u = c.unit ? ` ${c.unit}` : "";
  const n = (v: number | null) => (v === null ? "—" : String(v));
  switch (c.comparison) {
    case "between": return `${n(c.lower)} to ${n(c.upper)}${u}`;
    case "<=": return `<= ${n(c.upper)}${u}`;
    case "<": return `< ${n(c.upper)}${u}`;
    case ">=": return `>= ${n(c.lower)}${u}`;
    case ">": return `> ${n(c.lower)}${u}`;
    case "abs<=": return `|x| <= ${n(c.tolerance ?? c.upper)}${u}`;
    case "target±tolerance": return `${n(c.target)} ± ${n(c.tolerance)}${u}`;
    case "pass-fail": return "Confirmed (Yes)";
    default: return "Record only";
  }
}
const limitMissing = (c: Criterion) => !["pass-fail", "record-only"].includes(c.comparison) && /—/.test(criterionLimit(c));

export function buildProtocolPdf(input: ProtocolPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 16, CW = W - 2 * M, TOP = 34, BOTTOM = H - 20;
  const { content } = input;
  const id = content.identification;
  const status = documentStatus(input.status);
  const refById = new Map(input.references.map(r => [r.id, r]));
  const refCode = (rid: string | null) => (rid ? refById.get(rid)?.code ?? `Unresolved reference ${rid.slice(0, 8)}` : "");
  let y = TOP;

  const newPage = () => {
    doc.addPage();
    y = TOP;
  };
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };
  const para = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) => {
    const t = pdfSafe(text).trim();
    if (!t) return;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 9.5);
    doc.setTextColor(...(opts.color ?? [30, 45, 40]));
    const lh = (opts.size ?? 9.5) * 0.42;
    const lines = doc.splitTextToSize(t, CW - (opts.indent ?? 0)) as string[];
    lines.forEach(line => {
      ensure(lh);
      doc.text(line, M + (opts.indent ?? 0), y);
      y += lh;
    });
    y += opts.gap ?? 1.6;
  };
  const heading = (text: string, level: 1 | 2 | 3 = 1) => {
    ensure(level === 1 ? 14 : 10);
    y += level === 1 ? 3 : 1.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(level === 1 ? 12 : level === 2 ? 10.5 : 9.8);
    doc.setTextColor(12, 90, 76);
    doc.text(pdfSafe(text), M, y);
    if (level === 1) {
      doc.setDrawColor(12, 90, 76);
      doc.setLineWidth(0.3);
      doc.line(M, y + 1.4, M + CW, y + 1.4);
    }
    y += level === 1 ? 6 : 5;
  };
  /** Table with wrapped cells, repeated header on page break and no clipping. */
  const table = (headers: string[], rows: string[][], widths: number[]) => {
    const total = widths.reduce((a, b) => a + b, 0);
    const cols = widths.map(w => (w / total) * CW);
    const pad = 1.4, fs = 8, lh = fs * 0.4;
    const drawRow = (cells: string[], header: boolean) => {
      doc.setFont("helvetica", header ? "bold" : "normal");
      doc.setFontSize(fs);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfSafe(c) || " ", cols[i] - 2 * pad) as string[]);
      const height = Math.max(...wrapped.map(w => w.length)) * lh + 2 * pad + 0.6;
      if (y + height > BOTTOM) {
        newPage();
        if (!header) drawRow(headers, true);
      }
      doc.setFont("helvetica", header ? "bold" : "normal");
      doc.setFontSize(fs);
      let x = M;
      wrapped.forEach((lines, i) => {
        if (header) {
          doc.setFillColor(228, 237, 228);
          doc.rect(x, y, cols[i], height, "F");
        }
        doc.setDrawColor(190, 205, 195);
        doc.setLineWidth(0.15);
        doc.rect(x, y, cols[i], height);
        doc.setTextColor(30, 45, 40);
        lines.forEach((line, li) => doc.text(line, x + pad, y + pad + lh * (li + 1) - 0.6));
        x += cols[i];
      });
      y += height;
    };
    ensure(12);
    drawRow(headers, true);
    rows.forEach(r => drawRow(r, false));
    y += 3;
  };
  const kv = (rows: Array<[string, string]>) => table(["Item", "Value"], rows.map(([k, v]) => [k, v || "—"]), [1, 2.2]);

  // ---------------- 1–5: identification ----------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20, 61, 51);
  (doc.splitTextToSize(pdfSafe(id.title), CW) as string[]).forEach(line => {
    doc.text(line, M, y);
    y += 7;
  });
  doc.setFontSize(10.5);
  doc.setTextColor(152, 112, 58);
  doc.text(pdfSafe(`${id.number}  ·  Revision ${input.revisionNumber}  ·  ${label(PROTOCOL_TYPES, id.protocolType)}`), M, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.setTextColor(input.status === "released" ? 35 : 163, input.status === "released" ? 116 : 60, input.status === "released" ? 66 : 48);
  doc.text(pdfSafe(`Document status: ${status.label}`), M, y);
  y += 7;
  heading("Equipment Information", 2);
  kv([
    ["Equipment category / type", [id.equipmentCategory, id.equipmentType].filter(Boolean).join(" / ")],
    ["Manufacturer / model", `${id.manufacturer} ${id.model}`.trim()],
    ["Association", id.associationType === "equipment" ? "Equipment-specific" : "Model-level"],
    ...content.equipmentLinks.map(l => [`Linked equipment (${l.instrumentKey})`, `ID ${l.instrumentId || "—"} · S/N ${l.serialNumber || "—"} · ${l.manufacturer} ${l.model}`] as [string, string]),
    ["Intended use", id.intendedUse],
    ["Department", id.department],
    ["Related form / SOPs", [id.relatedForm, id.applicableSops].filter(Boolean).join(" · ")],
    ["Applicable stages", content.stages.join(", ")],
  ]);

  // ---------------- 6–12: narrative ----------------
  const n = content.narrative;
  const narrativeBlock = (title: string, text: string) => {
    if (!text.trim()) return;
    heading(title);
    para(text);
  };
  narrativeBlock("Purpose", n.purpose);
  narrativeBlock("Scope", n.scope);
  narrativeBlock("Responsibilities", n.responsibilities);
  narrativeBlock("Definitions", [n.definitions, n.abbreviations].filter(Boolean).join("\n\n"));
  heading("References");
  if (input.references.length)
    table(
      ["Code", "Title", "Edition / revision", "Status"],
      input.references.map(r => [r.code, `${r.title}${r.documentNumber ? ` (${r.documentNumber})` : ""}${r.sourceUrl ? `\n${r.sourceUrl}` : ""}`, [r.edition, r.revision].filter(Boolean).join(" / ") || "—", r.verificationStatus === "verified" ? "Verified" : r.verificationStatus.replace(/-/g, " ").toUpperCase()]),
      [0.9, 2.6, 1.1, 1]
    );
  else para("No references linked.");
  content.references.forEach(r => para(`${refCode(r.referenceId)} supports: ${r.supports}${r.clause ? ` (${r.clause})` : ""}`, { size: 8.5, indent: 2, gap: 0.6 }));
  narrativeBlock("Equipment Description", n.equipmentDescription);
  narrativeBlock("Required Materials and Reference Standards", [n.requiredMaterials, n.requiredReferenceStandards].filter(Boolean).join("\n\n"));
  narrativeBlock("Environmental Conditions", n.environmentalConditions);
  narrativeBlock("Safety Requirements", n.safetyRequirements);
  if (content.risk.overall || content.risk.justification) {
    heading("Risk Assessment");
    para(`Overall risk: ${content.risk.overall || "not assessed"}. ${content.risk.justification}`);
  }

  // ---------------- 13–17: sections, procedures, tables, criteria, calculations ----------------
  content.sections.forEach((section, si) => {
    heading(`${si + 1}. ${section.title}${section.stage ? ` (${section.stage})` : ""}${section.required ? "" : " — optional"}`);
    para(section.description);
    para(section.body);
    if (section.referenceIds.length) para(`References: ${section.referenceIds.map(refCode).join(", ")}`, { size: 8.5 });
    section.tests.forEach((test, ti) => {
      heading(`${si + 1}.${ti + 1} ${test.name}`, 2);
      para([test.objective && `Objective: ${test.objective}`, test.description].filter(Boolean).join("\n"));
      if (test.method || test.procedure) {
        heading("Test procedure", 3);
        para([test.method, test.procedure].filter(Boolean).join("\n"));
      }
      const req = [test.requiredMaterials && `Materials: ${test.requiredMaterials}`, test.requiredInstruments && `Instruments: ${test.requiredInstruments}`, test.requiredReferenceStandards && `Reference standards: ${test.requiredReferenceStandards}`, test.conditions && `Conditions: ${test.conditions}`].filter(Boolean).join("\n");
      para(req, { size: 8.8 });
      if (test.dependency.type !== "independent") para(`Dependency: ${test.dependency.type} on test ${test.dependency.testKey}${test.dependency.note ? ` — ${test.dependency.note}` : ""}`, { size: 8.5 });
      // Measurement table
      const readings = Math.max(test.readingsRequired, 0);
      if (test.levels.length) {
        heading("Measurement table", 3);
        table(["Level", "Reference / nominal", ...Array.from({ length: Math.min(readings, 6) }, (_, i) => `Reading ${i + 1}`)], test.levels.map(l => [l.label || l.key, l.nominal !== null ? `${l.nominal} ${l.unit}` : l.referenceNote || "Certified value at execution", ...Array.from({ length: Math.min(readings, 6) }, () => "")]), [1.2, 1.6, ...Array.from({ length: Math.min(readings, 6) }, () => 1)]);
      } else if (readings > 0) {
        heading("Measurement table", 3);
        const perRow = Math.min(readings, 6);
        const rowCount = Math.ceil(readings / perRow);
        table(Array.from({ length: perRow }, (_, i) => `Reading ${i + 1}${rowCount > 1 ? `…` : ""}${test.unit ? ` (${test.unit})` : ""}`), Array.from({ length: rowCount }, () => Array.from({ length: perRow }, () => "")), Array.from({ length: perRow }, () => 1));
        if (test.nominal !== null) para(`Nominal / reference value: ${test.nominal} ${test.unit}`, { size: 8.5 });
      }
      if (test.fields.length) table(["Record", "Type", "Value"], test.fields.map(f => [`${f.label || f.key}${f.required ? " *" : ""}`, f.type + (f.unit ? ` (${f.unit})` : ""), f.type === "boolean" ? "[ ] Yes   [ ] No" : ""]), [2.4, 1, 1.6]);
      if (test.calculations.length) {
        heading("Calculation methods", 3);
        table(["Result", "Method / formula", "Rounding"], test.calculations.map(c => [`${c.label || c.key}${c.unit ? ` (${c.unit})` : ""}`, c.kind === "custom" ? `${c.formula}` : label(CALC_KINDS, c.kind), c.significantFigures ? `${c.significantFigures} significant figures` : c.decimals !== null ? `${c.decimals} decimals` : "Not rounded"]), [1.4, 2.4, 1]);
      }
      if (test.criteria.length) {
        heading("Acceptance criteria", 3);
        table(
          ["Parameter", "Requirement / limit", "Source", "Status"],
          test.criteria.map(c => [
            `${c.parameter}${c.levelKey ? ` [${c.levelKey}]` : ""}`,
            `${c.requirement ? `${c.requirement}\n` : ""}Limit: ${limitMissing(c) ? "NOT ESTABLISHED" : criterionLimit(c)} (${label(COMPARISONS, c.comparison)})${c.conflictNote ? `\nCONFLICT: ${c.conflictNote}` : ""}`,
            `${label(SOURCE_CLASSES, c.sourceClass)}${c.referenceId ? `\n${refCode(c.referenceId)}${c.referenceClause ? ` ${c.referenceClause}` : ""}` : ""}${c.justification ? `\nJustification: ${c.justification}` : ""}`,
            c.verificationStatus === "verified" ? "Verified" : PENDING_LABEL,
          ]),
          [1, 2.6, 1.8, 1.1]
        );
      }
      if (test.requiredEvidence || test.attachmentsRequired) para(`Required evidence: ${test.requiredEvidence || "Attachments required"}`, { size: 8.5 });
      para(test.notes, { size: 8.5, color: [100, 115, 108] });
    });
  });

  if (content.intervals.length) {
    heading("Calibration / Verification Intervals");
    table(["Activity", "Interval", "Source / justification", "Status"], content.intervals.map(i => [i.activity, i.unit === "event" ? `Event: ${i.event}` : `${i.value ?? "—"} ${i.unit}`, `${label(SOURCE_CLASSES, i.sourceClass)}${i.referenceId ? ` (${refCode(i.referenceId)})` : ""}\n${i.justification}`, i.verificationStatus === "verified" ? "Verified" : PENDING_LABEL]), [1.3, 1, 2.6, 1.1]);
  }
  if (content.gaps.length) {
    heading("Technical Gaps and Conflicts");
    content.gaps.forEach(g => {
      heading(g.title, 3);
      para(g.description);
      table(["Specification", "Value", "Source"], g.specifications.map(s => [s.label, s.displayValue || (s.value !== null ? `${s.value} ${g.unit}` : "—"), `${label(SOURCE_CLASSES, s.sourceClass)}${s.referenceId ? ` — ${refCode(s.referenceId)}` : ""}${s.clause ? ` ${s.clause}` : ""}`]), [2, 1, 2]);
      para(`Technical assessment: ${g.assessment || "NOT DOCUMENTED"}`, { size: 9 });
      if (g.claimRestriction) para(`Claim restriction: ${g.claimRestriction}`, { size: 9 });
      const d = input.gapDecisions.find(x => x.gapKey === g.key);
      para(`Technical reviewer decision: ${d ? `${d.decision} — ${d.rationale} (${d.reviewerName ?? ""}, ${d.createdAt.slice(0, 10)})` : "NOT RECORDED"}`, { size: 9, bold: true });
    });
  }

  narrativeBlock("Deviation Management", n.deviationManagement);
  narrativeBlock("Final Assessment", n.finalAssessment);

  // ---------------- 20–22: review, approval, document control ----------------
  const sig = (title: string, name: string | null, when: string | null, meaning: string) => {
    ensure(22);
    doc.setDrawColor(150, 170, 160);
    doc.setLineWidth(0.2);
    doc.rect(M, y, CW, 19);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 45, 40);
    doc.text(pdfSafe(title), M + 3, y + 5);
    doc.setFont("helvetica", "normal");
    doc.text(pdfSafe(`Name: ${name ?? "________________________"}`), M + 3, y + 11);
    doc.text(pdfSafe(`Date: ${when ? when.slice(0, 10) : "______________"}`), M + 95, y + 11);
    doc.setFontSize(7.8);
    doc.setTextColor(100, 115, 108);
    doc.text(pdfSafe(`Meaning: ${meaning}${name ? " (electronic record in the Protocol Management audit trail)" : ""}`), M + 3, y + 16.5);
    y += 22;
  };
  heading("Technical Specialist Review");
  sig("Technical Specialist", input.technicalReviewerName, input.technicalReviewedAt, "Technical content, references, criteria and calculations reviewed");
  heading("QA Approval");
  sig("Quality Assurance", input.status === "approved" || input.status === "released" || input.status === "superseded" || input.status === "retired" ? input.qaApproverName : null, input.approvedAt, "Approved by Quality Assurance");
  sig("Document Control (release)", input.releasedByName, input.releasedAt, "Released for use");
  heading("Document Control Information");
  kv([
    ["Protocol number / revision", `${id.number} / Rev ${input.revisionNumber}`],
    ["Document status", status.label],
    ["Effective date", input.effectiveDate ?? "Not released"],
    ["Next periodic review", input.nextReviewDate ?? "—"],
    ["Author", input.authorName ?? "—"],
    ["Reason for this revision", input.changeReason],
    ["Content hash (SHA-256)", input.contentHash],
    ["Generated", `${input.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC by ${input.generatedBy}`],
  ]);
  if (input.approvals.length)
    table(["Date", "Action", "By", "Signature meaning / comment"], input.approvals.map(a => [a.createdAt.slice(0, 16).replace("T", " "), a.action, a.actorName ?? "", [a.signatureMeaning, a.comment].filter(Boolean).join(" — ")]), [1.1, 1.3, 1, 2.6]);
  para("This document was generated from the exact protocol revision identified above. Calculated results produced during execution are technical outcomes only and do not constitute approval. No statement in this protocol claims regulatory or pharmacopoeial compliance unless the corresponding criterion is marked Verified.", { size: 7.8, color: [100, 115, 108] });

  // ---------------- header / footer / watermark on every page ----------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (status.watermark) {
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: 0.13 }));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(44);
      doc.setTextColor(163, 60, 48);
      doc.text(pdfSafe(status.watermark), W / 2, H / 2, { align: "center", angle: 35 });
      doc.restoreGraphicsState();
    }
    doc.setDrawColor(12, 90, 76);
    doc.setLineWidth(0.5);
    doc.line(M, 24, W - M, 24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 61, 51);
    doc.text(pdfSafe(input.organization), M, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(pdfSafe(`${id.number} · Rev ${input.revisionNumber} · ${id.title}`).slice(0, 110), M, 18.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(input.status === "released" ? 35 : 163, input.status === "released" ? 116 : 60, input.status === "released" ? 66 : 48);
    doc.text(pdfSafe(status.label).slice(0, 60), W - M, 13, { align: "right" });
    doc.setDrawColor(190, 205, 195);
    doc.setLineWidth(0.2);
    doc.line(M, H - 14, W - M, H - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 115, 108);
    doc.text(pdfSafe(`${id.number} Rev ${input.revisionNumber} · ${input.effectiveDate ? `Effective ${input.effectiveDate}` : "Not effective"} · hash ${input.contentHash.slice(0, 12)}`), M, H - 9);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 9, { align: "right" });
  }
  return doc;
}
