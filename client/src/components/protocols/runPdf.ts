/**
 * Calibration-run PDF report. Generated ONLY from the run's frozen snapshots
 * (protocol snapshot + equipment snapshot + saved raw data + engine evaluation).
 *
 *  - unique document ID (run number + saved version + data fingerprint);
 *  - page "x of y" numbering, header and footer on every page;
 *  - watermark unless the formal execution is APPROVED:
 *      draft run on a non-released protocol → "TRIAL RUN – NOT APPROVED"
 *      draft run                            → "DRAFT – NOT APPROVED"
 *      recorded, review pending             → "RECORDED – NOT APPROVED"
 *  - signature blocks show ONLY names recorded by the system (never simulated);
 *  - missing equipment data is printed as "Not available in the current equipment profile".
 */
import { jsPDF } from "jspdf";
import type { ExecutionEvaluation, Measurements } from "@shared/protocols/evaluate";
import { canonicalJson, PENDING_LABEL, type ProtocolContent } from "@shared/protocols/model";
import { NOT_AVAILABLE, SPEC_GROUPS, specDefinitions, type EquipmentSnapshot } from "@shared/protocols/equipment";
import {
  CANONICAL_STEP_KEYS,
  CANONICAL_STEP_LABELS,
  NA_CONFIRMATION_FIELD,
  mapTestsToSteps,
  naMeasurementKey,
  type RunBlocker,
} from "@shared/protocols/runWorkflow";
import { pdfSafe } from "./protocolPdf";

export type RunPdfInput = {
  organization: string;
  runNumber: string;
  runStatus: "draft" | "recorded" | "abandoned";
  rowVersion: number;
  protocolNumber: string;
  revisionNumber: number;
  revisionStatus: string;
  contentHash: string;
  content: ProtocolContent;
  equipment: EquipmentSnapshot;
  newerEquipmentData: boolean;
  measurements: Measurements;
  evaluation: ExecutionEvaluation;
  blockers: RunBlocker[];
  executionReviewStatus: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  history: Array<{ rowVersion: number; action: string; actorName: string | null; createdAt: string; reason: string | null }>;
  signatures: Array<{ role: string; name: string | null; date: string | null; meaning: string | null }>;
  generatedBy: string;
  generatedAt: Date;
};

export function runDocumentStatus(input: Pick<RunPdfInput, "runStatus" | "revisionStatus" | "executionReviewStatus">): { label: string; watermark: string | null } {
  if (input.runStatus === "abandoned") return { label: "ABANDONED RUN – NOT FOR USE", watermark: "ABANDONED – NOT FOR USE" };
  if (input.runStatus === "recorded") {
    if (input.executionReviewStatus === "approved") return { label: "EXECUTION APPROVED", watermark: null };
    if (input.executionReviewStatus === "rejected") return { label: "EXECUTION REJECTED – NOT APPROVED", watermark: "REJECTED – NOT APPROVED" };
    return { label: `RECORDED – ${String(input.executionReviewStatus ?? "recorded").toUpperCase()} – NOT APPROVED`, watermark: "RECORDED – NOT APPROVED" };
  }
  if (input.revisionStatus !== "released") return { label: `TRIAL RUN – PROTOCOL ${input.revisionStatus.toUpperCase()} – NOT APPROVED`, watermark: "TRIAL RUN – NOT APPROVED" };
  return { label: "DRAFT RUN – NOT APPROVED", watermark: "DRAFT – NOT APPROVED" };
}

/** Deterministic fingerprint of the run data (FNV-1a) for the document ID. */
export function runFingerprint(measurements: Measurements, contentHash: string, equipmentVersion: string) {
  const s = canonicalJson({ measurements, contentHash, equipmentVersion });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").toUpperCase();
}

const fmtVal = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v));

export function buildRunPdf(input: RunPdfInput): { doc: jsPDF; documentId: string; status: ReturnType<typeof runDocumentStatus> } {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 16, CW = W - 2 * M, TOP = 34, BOTTOM = H - 20;
  const status = runDocumentStatus(input);
  const documentId = `${input.runNumber}-V${input.rowVersion}-${runFingerprint(input.measurements, input.contentHash, input.equipment.specsRowVersion + ":" + JSON.stringify(input.equipment.identity))}`;
  let y = TOP;
  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = TOP;
    }
  };
  const para = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
    const t = pdfSafe(text).trim();
    if (!t) return;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 9);
    doc.setTextColor(...(opts.color ?? [30, 45, 40]));
    const lh = (opts.size ?? 9) * 0.42;
    (doc.splitTextToSize(t, CW) as string[]).forEach(line => {
      ensure(lh);
      doc.text(line, M, y);
      y += lh;
    });
    y += opts.gap ?? 1.4;
  };
  const heading = (text: string, level: 1 | 2 = 1) => {
    ensure(level === 1 ? 14 : 10);
    y += level === 1 ? 3 : 1.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(level === 1 ? 11.5 : 10);
    doc.setTextColor(12, 90, 76);
    doc.text(pdfSafe(text), M, y);
    if (level === 1) {
      doc.setDrawColor(12, 90, 76);
      doc.setLineWidth(0.3);
      doc.line(M, y + 1.4, M + CW, y + 1.4);
    }
    y += level === 1 ? 6 : 5;
  };
  const table = (headers: string[], rows: string[][], widths: number[]) => {
    const total = widths.reduce((a, b) => a + b, 0);
    const cols = widths.map(w => (w / total) * CW);
    const pad = 1.3, fs = 7.6, lh = fs * 0.4;
    const drawRow = (cells: string[], header: boolean) => {
      doc.setFont("helvetica", header ? "bold" : "normal");
      doc.setFontSize(fs);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfSafe(c) || " ", cols[i] - 2 * pad) as string[]);
      const height = Math.max(...wrapped.map(w => w.length)) * lh + 2 * pad + 0.6;
      if (y + height > BOTTOM) {
        doc.addPage();
        y = TOP;
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
        lines.forEach((line, li) => doc.text(line, x + pad, y + pad + lh * (li + 0.8)));
        x += cols[i];
      });
      y += height;
    };
    drawRow(headers, true);
    rows.forEach(r => drawRow(r, false));
    y += 2.5;
  };
  const kv = (rows: Array<[string, string]>) => table(["Item", "Value"], rows, [1.2, 3]);

  // 1. Identification
  heading("1. Calibration run identification");
  kv([
    ["Document ID", documentId],
    ["Document status", status.label],
    ["Run number / saved version", `${input.runNumber} / v${input.rowVersion}`],
    ["Protocol / revision", `${input.protocolNumber} Rev ${input.revisionNumber} — ${input.content.identification.title}`],
    ["Protocol revision status", input.revisionStatus.toUpperCase()],
    ["Protocol content hash (snapshot)", input.contentHash],
    ["Run created", `${input.createdAt.slice(0, 16).replace("T", " ")} UTC by ${input.createdBy ?? "—"}`],
    ["Last saved", `${input.updatedAt.slice(0, 16).replace("T", " ")} UTC by ${input.updatedBy ?? "—"}`],
    ["Workflow", "Unified nine-step controlled workflow: 1 Equipment Selection, 2 Protocol, 3 Accuracy, 4 Repeatability, 5 Linearity, 6 Results, 7 Review, 8 Approval, 9 PDF"],
  ]);
  para("Loading or executing a protocol does not imply that the instrument passed. Calculated outcomes are technical results only; they are not an approval.", { size: 8, color: [163, 60, 48] });

  // 2. Equipment snapshot
  heading("2. Equipment data (snapshot frozen at run creation)");
  const idn = input.equipment.identity;
  kv([
    ["Equipment ID", idn.instrumentId || NOT_AVAILABLE],
    ["Name", idn.nameEn || NOT_AVAILABLE],
    ["Manufacturer / model", `${idn.manufacturer || NOT_AVAILABLE} / ${idn.model || NOT_AVAILABLE}`],
    ["Serial number", idn.serialNumber || NOT_AVAILABLE],
    ["SOP / form", `${idn.sopNumber || NOT_AVAILABLE} / ${idn.formNumber || NOT_AVAILABLE}`],
    ["Equipment status at run creation", input.equipment.status.toUpperCase()],
    ["Snapshot captured", input.equipment.capturedAt.slice(0, 16).replace("T", " ") + " UTC"],
  ]);
  if (input.newerEquipmentData) para("NOTICE: newer equipment data exists in the equipment profile. This report uses the snapshot above (historical data are never altered).", { size: 8, bold: true, color: [163, 90, 20] });
  const defs = specDefinitions(input.equipment.equipmentType);
  const specRows = SPEC_GROUPS.flatMap(g =>
    defs.filter(d => d.group === g.key).map(d => {
      const v = input.equipment.specs[d.key];
      return [g.label, d.label, v && v.value !== null && v.value !== "" ? `${v.value}${v.unit ? ` ${v.unit}` : ""}` : NOT_AVAILABLE, v?.source || "—"];
    })
  );
  const extra = Object.entries(input.equipment.specs).filter(([k]) => !defs.some(d => d.key === k)).map(([k, v]) => ["Other", k, `${v.value ?? "—"} ${v.unit}`.trim(), v.source || "—"]);
  table(["Group", "Specification", "Value (unit as recorded)", "Source"], [...specRows, ...extra], [1.3, 1.8, 1.4, 2]);
  para("Specification values are informational. They never change protocol acceptance criteria and are not converted between units.", { size: 7.6, color: [100, 115, 108] });

  // 3. Protocol summary
  heading("3. Protocol snapshot");
  const pending = input.content.sections.flatMap(s => s.tests.flatMap(t => t.criteria)).filter(c => c.verificationStatus !== "verified").length;
  kv([
    ["Stages", input.content.stages.join(", ") || "—"],
    ["Tests", String(input.content.sections.reduce((n, s) => n + s.tests.length, 0))],
    ["Criteria pending technical verification", `${pending}${pending ? ` — ${PENDING_LABEL}: no compliance conclusion` : ""}`],
    ["Open technical gaps", input.content.gaps.length ? input.content.gaps.map(g => `${g.key}: ${g.title}`).join("; ") : "None"],
  ]);

  // 3b. Canonical nine-step workflow and protocol-test mapping (snapshot based)
  heading("3b. Nine-step controlled workflow and test mapping");
  const wfMapping = mapTestsToSteps(input.content);
  const wfRows: string[][] = CANONICAL_STEP_KEYS.map((key, i) => {
    let detail = "—";
    if (key === "accuracy" || key === "repeatability" || key === "linearity") {
      const tests = wfMapping[key];
      detail = tests.length ? tests.map(t => `${t.key} ${t.name}`).join("; ") : "Not Applicable — documented in the run";
    } else if (key === "results") {
      detail = wfMapping.results.length ? wfMapping.results.map(t => `${t.key} ${t.name}`).join("; ") : "Consolidated outcome of every protocol test";
    }
    return [`${i + 1}`, CANONICAL_STEP_LABELS[key].label, detail];
  });
  table(["#", "Controlled step", "Protocol tests mapped / disposition"], wfRows, [0.4, 1.4, 4]);
  const naRows: string[][] = (["accuracy", "repeatability", "linearity"] as const).flatMap(step => {
    const m = input.measurements[naMeasurementKey(step)];
    if (!m?.notApplicable) return [];
    return [[CANONICAL_STEP_LABELS[step].label, m.naJustification || "—", m.fields?.[NA_CONFIRMATION_FIELD] === true ? "Confirmed" : "NOT CONFIRMED"]];
  });
  if (naRows.length) {
    para("Not-Applicable test steps (recorded, never silently skipped):", { bold: true, size: 8 });
    table(["Step", "Documented justification", "Reviewer confirmation"], naRows, [1.1, 3.3, 1]);
  }

  // 4. Results summary
  heading("4. Results summary (calculation engine " + input.evaluation.engineVersion + ")");
  const c = input.evaluation.counts;
  kv([
    ["Overall calculated outcome", input.evaluation.overall],
    ["PASS / FAIL / UNDER REVIEW", `${c.PASS} / ${c.FAIL} / ${c["UNDER REVIEW"]}`],
    ["INCOMPLETE / NOT APPLICABLE", `${c.INCOMPLETE} / ${c["NOT APPLICABLE"]}`],
  ]);
  table(["Test", "Stage", "Outcome", "Notes"], input.evaluation.tests.map(t => [t.name, t.stage || "—", t.status, t.notes.join(" ")]), [2.4, 0.6, 1, 2.6]);

  // 5. Per-test raw data, calculations and criteria
  heading("5. Test data, calculations and acceptance criteria");
  input.content.sections.forEach(section =>
    section.tests.forEach(test => {
      const m = input.measurements[test.key] ?? {};
      const r = input.evaluation.tests.find(x => x.testKey === test.key);
      heading(`${test.name} — ${r?.status ?? "INCOMPLETE"}`, 2);
      const raw: Array<[string, string]> = [];
      if (m.notApplicable) raw.push(["NOT APPLICABLE — justification", m.naJustification || "—"]);
      if (m.readings?.length) raw.push([`Readings${test.unit ? ` (${test.unit})` : ""}`, m.readings.map(fmtVal).join("; ")]);
      if (m.reference !== undefined && m.reference !== null) raw.push(["Reference value", String(m.reference)]);
      test.levels.forEach(l => {
        const vals = m.levels?.[l.key];
        const ref = l.nominal ?? m.levelReferences?.[l.key];
        if (vals?.length || ref !== undefined) raw.push([`${l.label || l.key}`, `readings: ${(vals ?? []).map(fmtVal).join("; ") || "—"} | reference: ${fmtVal(ref)} ${l.unit}`]);
      });
      test.fields.forEach(f => {
        const v = m.fields?.[f.key];
        if (v !== undefined && v !== null && v !== "") raw.push([`${f.label}${f.unit ? ` (${f.unit})` : ""}`, fmtVal(v)]);
      });
      if (m.comment) raw.push(["Comment", m.comment]);
      if (raw.length) table(["Raw data item", "Recorded value"], raw, [1.6, 3]);
      else para("No raw data recorded.", { size: 8, color: [100, 115, 108] });
      if (r?.calculations.length)
        table(["Calculation", "Level", "Result", "Formula / revision"], r.calculations.map(k => [k.label, k.levelKey ?? "—", k.error ? `ERROR: ${k.error}` : `${fmtVal(k.value)} ${k.unit}`.trim(), `${k.formula}${k.formulaRevision ? ` [${k.formulaRevision}]` : ""}`]), [1.6, 0.6, 1, 2.6]);
      if (r?.criteria.length)
        table(["Criterion", "Limit", "Value", "Outcome / verification"], r.criteria.map(k => [`${k.key}${k.levelKey ? ` @${k.levelKey}` : ""}`, k.limit, fmtVal(k.value), `${k.status} — ${k.verificationStatus === "verified" ? "verified" : PENDING_LABEL}`]), [1, 1.6, 0.8, 2.2]);
    })
  );

  // 6. Blockers
  heading("6. Review / approval status and open conditions");
  if (input.blockers.length) table(["Condition", "Blocks recording", "Blocks approval"], input.blockers.map(b => [b.message, b.blocksRecording ? "Yes" : "No", b.blocksApproval ? "Yes" : "No"]), [4, 0.8, 0.8]);
  else para("No open conditions recorded by the system.");
  if (input.executionReviewStatus) para(`Formal execution review status: ${input.executionReviewStatus.toUpperCase()}.`, { bold: true });

  // 7. History
  heading("7. Saved versions (immutable history)");
  table(["Version", "Action", "By", "Date (UTC)", "Reason"], input.history.map(h => [`v${h.rowVersion}`, h.action, h.actorName ?? "—", h.createdAt.slice(0, 16).replace("T", " "), h.reason ?? ""]), [0.6, 0.9, 1.2, 1.2, 2.2]);

  // 8. Signatures (system records only)
  heading("8. Signatures");
  table(["Role", "Name (system record)", "Date", "Meaning"], input.signatures.map(s => [s.role, s.name ?? "Not signed in the system", s.date ? s.date.slice(0, 16).replace("T", " ") : "—", s.meaning ?? "—"]), [1.2, 1.6, 1, 2]);
  para("Electronic signatures are applied only through the system's review / approval workflow with password re-authentication. Blank entries have not been signed. This document does not contain simulated signatures.", { size: 7.6, color: [100, 115, 108] });
  para(input.evaluation.disclaimer, { size: 7.6, color: [100, 115, 108] });

  // header / footer / watermark on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (status.watermark) {
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: 0.13 }));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(40);
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
    doc.text(pdfSafe(`Calibration run report · ${input.protocolNumber} Rev ${input.revisionNumber} · ${idn.instrumentId} ${idn.model}`).slice(0, 110), M, 18.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(status.watermark ? 163 : 35, status.watermark ? 60 : 116, status.watermark ? 48 : 66);
    doc.text(pdfSafe(status.label).slice(0, 62), W - M, 13, { align: "right" });
    doc.setDrawColor(190, 205, 195);
    doc.setLineWidth(0.2);
    doc.line(M, H - 14, W - M, H - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(100, 115, 108);
    doc.text(pdfSafe(`Doc ID ${documentId} · generated ${input.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC by ${input.generatedBy}`).slice(0, 120), M, H - 9);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 9, { align: "right" });
  }
  return { doc, documentId, status };
}
