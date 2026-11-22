/**
 * Protocol-driven validation report (New Validation), generated ONLY from the
 * stored, immutable validation record (protocol snapshot, equipment snapshot,
 * readings, stored evaluation and graph data).
 *
 *   Section A — numerical tables: identification, equipment, protocol revision,
 *               per-test readings / calculations / acceptance criteria / decisions,
 *               overall result, references, signatures (system records only).
 *   page break
 *   Section B — graphs: one graph per page (title, axis labels, legend,
 *               regression equation). Pages exist only for graphs that exist —
 *               no empty graph pages, graphs never inside the numerical tables.
 *   "Page x of y" on every page.
 */
import { jsPDF } from "jspdf";
import type { ExecutionEvaluation, Measurements } from "@shared/protocols/evaluate";
import type { EquipmentSnapshot } from "@shared/protocols/equipment";
import { fmt, type GraphData } from "@shared/protocols/graphs";
import { PENDING_LABEL, type ProtocolContent } from "@shared/protocols/model";
import { pdfSafe } from "./protocolPdf";

export type ValidationPdfInput = {
  organization: string;
  runNumber: string;
  protocolNumber: string;
  protocolTitle: string;
  revisionNumber: number;
  revisionApprovedBy: string | null;
  revisionApprovedAt: string | null;
  contentHash: string;
  content: ProtocolContent;
  equipment: EquipmentSnapshot;
  measurements: Measurements;
  evaluation: ExecutionEvaluation;
  referenceSnapshot: unknown;
  recordedBy: string | null;
  recordedAt: string;
  generatedBy: string;
  generatedAt: Date;
};

export type ValidationPdfResult = { doc: jsPDF; documentId: string; tablePages: number; graphPages: number[]; graphs: GraphData[] };

const fmtVal = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.map(x => (typeof x === "number" ? fmt(x) : String(x ?? "—"))).join("; ") : typeof v === "number" ? fmt(v) : String(v));
const dt = (v: string | null | undefined) => (v ? `${v.slice(0, 16).replace("T", " ")} UTC` : "—");

type RefSnap = { code?: string; title?: string; edition?: string; revision?: string; applicableSection?: string; applicableClause?: string; verificationStatus?: string; referenceType?: string };

export function buildValidationPdf(input: ValidationPdfInput): ValidationPdfResult {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 16, CW = W - 2 * M, TOP = 32, BOTTOM = H - 20;
  const documentId = input.runNumber;
  let y = TOP;
  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = TOP;
    }
  };
  const para = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
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
    y += 1.4;
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
  const kv = (rows: Array<[string, string]>) => table(["Item", "Value"], rows, [1.3, 3]);

  const graphs = input.evaluation.tests.flatMap(t => t.graphs ?? []);
  const ev = input.evaluation;
  const idn = input.equipment.identity;

  /* ----------------------------- Section A ----------------------------- */
  heading("SECTION A — NUMERICAL RESULTS");
  heading("A1. Validation record", 2);
  kv([
    ["Document / record ID", documentId],
    ["Protocol", `${input.protocolNumber} — ${input.protocolTitle}`],
    ["Protocol revision used", `Rev.${String(input.revisionNumber).padStart(2, "0")} (approved ${dt(input.revisionApprovedAt)} by ${input.revisionApprovedBy ?? "—"})`],
    ["Protocol content hash (snapshot)", input.contentHash],
    ["Recorded", `${dt(input.recordedAt)} by ${input.recordedBy ?? "—"}`],
    ["Calculation engine", ev.engineVersion],
    ["OVERALL RESULT", ev.overall],
  ]);
  heading("A2. Equipment (snapshot at recording)", 2);
  kv([
    ["Equipment ID", idn.instrumentId || "—"],
    ["Name", idn.nameEn || "—"],
    ["Manufacturer / model", `${idn.manufacturer || "—"} / ${idn.model || "—"}`],
    ["Serial number", idn.serialNumber || "—"],
    ["SOP / form", `${idn.sopNumber || "—"} / ${idn.formNumber || "—"}`],
  ]);
  heading("A3. Results summary", 2);
  table(["Test", "Result", "Notes"], ev.tests.map(t => [t.name, t.status, t.notes.join(" ") || "—"]), [2.4, 0.9, 3]);
  const c = ev.counts;
  para(`PASS ${c.PASS} · FAIL ${c.FAIL} · UNDER REVIEW ${c["UNDER REVIEW"]} · INCOMPLETE ${c.INCOMPLETE} · NOT APPLICABLE ${c["NOT APPLICABLE"]}`, { size: 8 });

  heading("A4. Test data, calculations and acceptance criteria", 2);
  input.content.sections.forEach(section =>
    section.tests.forEach(test => {
      const m = input.measurements[test.key] ?? {};
      const r = ev.tests.find(x => x.testKey === test.key);
      para(`${test.name} — ${r?.status ?? "—"}`, { bold: true, size: 9.5, color: [12, 90, 76] });
      const raw: string[][] = [];
      if (m.notApplicable) raw.push(["NOT APPLICABLE — justification", m.naJustification || "—"]);
      if (m.readings?.length) raw.push([`Readings${test.unit ? ` (${test.unit})` : ""}`, fmtVal(m.readings)]);
      const ref = test.nominal ?? m.reference;
      if (ref !== undefined && ref !== null) raw.push(["Reference value", fmtVal(ref)]);
      test.levels.forEach(l => {
        const vals = m.levels?.[l.key];
        const lref = l.nominal ?? m.levelReferences?.[l.key];
        if (vals?.length || (lref !== undefined && lref !== null)) raw.push([l.label || l.key, `readings: ${fmtVal(vals ?? [])} | reference: ${fmtVal(lref)} ${l.unit}`.trim()]);
      });
      test.fields.forEach(f => {
        const v = m.fields?.[f.key];
        if (v !== undefined && v !== null && v !== "") raw.push([`${f.label || f.key}${f.unit ? ` (${f.unit})` : ""}`, fmtVal(v)]);
      });
      if (raw.length) table(["Recorded data", "Value"], raw, [1.5, 3.4]);
      if (r?.calculations.length)
        table(["Calculation", "Level", "Result", "Formula (rev.)"], r.calculations.map(k => [k.label, k.levelKey ?? "—", k.error ? `ERROR: ${k.error}` : `${fmtVal(k.value)} ${k.unit}`.trim(), `${k.formula}${k.formulaRevision ? ` [${k.formulaRevision}]` : ""}`]), [1.5, 0.6, 1.1, 2.6]);
      if (r?.criteria.length)
        table(["Criterion", "Acceptance limit", "Value", "Decision", "Source / verification"], r.criteria.map(k => [`${k.parameter}${k.levelKey ? ` @${k.levelKey}` : ""}`, k.limit, fmtVal(k.value), k.status, `${k.sourceClass} — ${k.verificationStatus === "verified" ? "verified" : PENDING_LABEL}`]), [1.1, 1.4, 0.9, 0.9, 1.6]);
      if (r?.graphs?.length) para(`Graphs for this test: ${r.graphs.map(g => g.title).join("; ")} — see Section B.`, { size: 7.6, color: [100, 115, 108] });
    })
  );

  heading("A5. References (snapshot frozen at protocol approval)", 2);
  const refs = ((input.referenceSnapshot as { references?: RefSnap[] } | null)?.references ?? []) as RefSnap[];
  if (refs.length)
    table(["Code", "Title", "Edition / revision", "Section / clause", "Type", "Verification"], refs.map(r => [r.code ?? "—", r.title ?? "—", [r.edition, r.revision].filter(Boolean).join(" / ") || "—", [r.applicableSection, r.applicableClause].filter(Boolean).join(" / ") || "—", r.referenceType ?? "—", r.verificationStatus ?? "—"]), [1, 2.2, 1, 1.2, 0.9, 0.9]);
  else para("No references are linked to this protocol revision.", { size: 8, color: [100, 115, 108] });

  heading("A6. Signatures (system records only)", 2);
  table(["Role", "Name (system record)", "Date"], [["Validation recorded by", input.recordedBy ?? "Not recorded", dt(input.recordedAt)], ["Protocol revision approved by (Quality Manager)", input.revisionApprovedBy ?? "Not recorded", dt(input.revisionApprovedAt)]], [2, 2, 1.2]);
  para(ev.disclaimer, { size: 7.4, color: [100, 115, 108] });
  para(graphs.length ? `Section B contains ${graphs.length} graph(s), one per page.` : "Section B — Graphs: no graph is configured for the tests of this protocol revision (or the recorded data are insufficient); no graph pages are produced.", { size: 8, bold: true });
  const tablePages = doc.getNumberOfPages();

  /* ----------------------------- Section B ----------------------------- */
  const graphPages: number[] = [];
  graphs.forEach((g, gi) => {
    doc.addPage();
    graphPages.push(doc.getNumberOfPages());
    y = TOP;
    if (gi === 0) heading("SECTION B — GRAPHS");
    heading(`B${gi + 1}. ${g.title}`, 2);
    const box = { x: M + 14, y: y + 4, w: CW - 18, h: 150 };
    drawGraph(doc, g, box);
    y = box.y + box.h + 15 + 4.2 * g.series.length + 4;
    para(`Test: ${g.testName}`, { size: 8 });
    if (g.notes.length) para(g.notes.join(" · "), { size: 8 });
    para("Plotted values are the recorded readings / reference values of this validation record; lines are the identity line or the least-squares regression of the same points.", { size: 7.4, color: [100, 115, 108] });
  });

  /* ----------------------- header / footer ----------------------- */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(12, 90, 76);
    doc.setLineWidth(0.5);
    doc.line(M, 22, W - M, 22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 61, 51);
    doc.text(pdfSafe(input.organization), M, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(pdfSafe(`Validation report · ${input.protocolNumber} Rev.${String(input.revisionNumber).padStart(2, "0")} · ${idn.instrumentId} ${idn.model}`).slice(0, 110), M, 17.5);
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafe(`${p <= tablePages ? "Section A" : "Section B"} · Result: ${ev.overall}`), W - M, 12, { align: "right" });
    doc.setDrawColor(190, 205, 195);
    doc.setLineWidth(0.2);
    doc.line(M, H - 14, W - M, H - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(100, 115, 108);
    doc.text(pdfSafe(`Record ${documentId} · generated ${input.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC by ${input.generatedBy}`).slice(0, 120), M, H - 9);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 9, { align: "right" });
  }
  return { doc, documentId, tablePages, graphPages, graphs };
}

/** Axis ticks ("nice" numbers) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const d = Math.abs(min) * 0.05 || 1;
    min -= d;
    max += d;
  }
  const span = max - min;
  const step0 = span / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  // Always cover the full data range: the last tick is >= max (no point may fall outside the frame).
  for (let i = 0; i < 40; i++) {
    const v = Number((start + i * step).toPrecision(12));
    ticks.push(v);
    if (v >= max - step * 1e-9 && ticks.length >= 2) break;
  }
  return ticks;
}

function drawGraph(doc: jsPDF, g: GraphData, box: { x: number; y: number; w: number; h: number }) {
  const pts = g.series.flatMap(s => s.points);
  const xs = pts.map(p => p.x);
  const ys = [...pts.map(p => p.y), ...g.guides.map(gd => gd.y)];
  const xt = niceTicks(Math.min(...xs), Math.max(...xs));
  const yt = niceTicks(Math.min(...ys), Math.max(...ys));
  const x0 = xt[0], x1 = xt[xt.length - 1], y0 = yt[0], y1 = yt[yt.length - 1];
  const X = (v: number) => box.x + ((v - x0) / (x1 - x0 || 1)) * box.w;
  const Y = (v: number) => box.y + box.h - ((v - y0) / (y1 - y0 || 1)) * box.h;
  // grid + ticks
  doc.setDrawColor(225, 230, 228);
  doc.setLineWidth(0.15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(70, 80, 76);
  xt.forEach(v => {
    doc.line(X(v), box.y, X(v), box.y + box.h);
    doc.text(pdfSafe(fmt(v)), X(v), box.y + box.h + 4, { align: "center" });
  });
  yt.forEach(v => {
    doc.line(box.x, Y(v), box.x + box.w, Y(v));
    doc.text(pdfSafe(fmt(v)), box.x - 1.5, Y(v) + 1, { align: "right" });
  });
  doc.setDrawColor(40, 50, 46);
  doc.setLineWidth(0.4);
  doc.rect(box.x, box.y, box.w, box.h);
  // axis labels
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20, 40, 34);
  doc.text(pdfSafe(g.xLabel), box.x + box.w / 2, box.y + box.h + 10, { align: "center" });
  // Rotated text: jsPDF's align option does not centre along the rotated axis, so centre it manually.
  const yLabel = pdfSafe(g.yLabel);
  doc.text(yLabel, box.x - 13, box.y + box.h / 2 + doc.getTextWidth(yLabel) / 2, { angle: 90 });
  // guides
  g.guides.forEach(gd => {
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1.5, 1.2], 0);
    doc.line(box.x, Y(gd.y), box.x + box.w, Y(gd.y));
    doc.setLineDashPattern([], 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    doc.text(pdfSafe(`${gd.name} ${fmt(gd.y)}`), box.x + box.w - 1, Y(gd.y) - 0.8, { align: "right" });
  });
  // series
  const colors: Array<[number, number, number]> = [[12, 90, 76], [180, 83, 42], [59, 91, 140], [122, 78, 156]];
  g.series.forEach((s, i) => {
    const col = colors[i % colors.length];
    doc.setDrawColor(...col);
    doc.setFillColor(...col);
    if (s.kind === "line") {
      doc.setLineWidth(0.5);
      for (let k = 1; k < s.points.length; k++) doc.line(X(s.points[k - 1].x), Y(s.points[k - 1].y), X(s.points[k].x), Y(s.points[k].y));
    } else s.points.forEach(p => doc.circle(X(p.x), Y(p.y), 1.1, "F"));
  });
  // legend
  let ly = box.y + box.h + 15;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  g.series.forEach((s, i) => {
    const col = colors[i % colors.length];
    doc.setDrawColor(...col);
    doc.setFillColor(...col);
    if (s.kind === "line") {
      doc.setLineWidth(0.6);
      doc.line(box.x, ly - 1, box.x + 6, ly - 1);
    } else doc.circle(box.x + 3, ly - 1, 1.1, "F");
    doc.setTextColor(30, 45, 40);
    doc.text(pdfSafe(s.name), box.x + 8, ly);
    ly += 4.2;
  });
}
