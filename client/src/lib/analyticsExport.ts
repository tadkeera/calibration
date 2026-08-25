import { jsPDF } from "jspdf";
import { findDevice } from "@/lib/qc";

export type AnalyticsFilters = { instrumentKey?: string; resultStatus?: "pass" | "fail"; lifecycleStatus?: "draft" | "approved" | "rejected"; dateFrom?: string; dateTo?: string };
export type AnalyticsRecord = { instrumentKey: string; instrumentName: string; instrumentId: string; sopNumber: string; resultStatus: "pass" | "fail"; lifecycleStatus: "draft" | "approved" | "rejected"; pharmacistName: string; createdAt: Date | string };
export type AnalyticsSummary = { total: number; pass: number; fail: number; draft: number; approved: number; rejected: number; passRate: number; approvalRate: number; instruments: Array<{ instrumentKey: string; instrumentName: string; total: number; pass: number; fail: number }> };

const headerUrl = "/manus-storage/yemen-qc-official-report-header_4f137299.png";
const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
const download = (content: BlobPart, type: string, fileName: string) => { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); };
const englishInstrument = (key: string, fallback: string) => { try { return findDevice(key as Parameters<typeof findDevice>[0]).english; } catch { return fallback; } };
const englishState = (value: AnalyticsRecord["lifecycleStatus"]) => value === "approved" ? "Approved" : value === "rejected" ? "Rejected" : "Draft";
const safeText = (value: string) => value.replace(/[\u0600-\u06FF]/g, "-");

function filterDescription(filters: AnalyticsFilters) { return [filters.instrumentKey ? `Instrument: ${englishInstrument(filters.instrumentKey, filters.instrumentKey)}` : "Instrument: All", filters.resultStatus ? `Result: ${filters.resultStatus.toUpperCase()}` : "Result: All", filters.lifecycleStatus ? `Approval: ${englishState(filters.lifecycleStatus)}` : "Approval: All", filters.dateFrom ? `From: ${filters.dateFrom}` : "", filters.dateTo ? `To: ${filters.dateTo}` : ""].filter(Boolean).join(" | "); }

export function exportAnalyticsCsv(records: AnalyticsRecord[], summary: AnalyticsSummary, filters: AnalyticsFilters) {
  const rows: unknown[][] = [
    ["National Quality Control Laboratory — Filtered Validation Analytics"],
    ["Applied filters", filterDescription(filters)],
    ["Generated at", new Date().toISOString()],
    [],
    ["Metric", "Value"],
    ["Total records", summary.total], ["Pass", summary.pass], ["Fail", summary.fail], ["Pass rate", `${summary.passRate}%`], ["Approved", summary.approved], ["Rejected", summary.rejected], ["Open drafts", summary.draft], ["Approval rate", `${summary.approvalRate}%`],
    [],
    ["Instrument", "Total", "Pass", "Fail"],
    ...summary.instruments.map((instrument) => [englishInstrument(instrument.instrumentKey, instrument.instrumentName), instrument.total, instrument.pass, instrument.fail]),
    [],
    ["Instrument", "Instrument ID", "SOP", "Result", "Approval state", "Validated by", "Created at"],
    ...records.map((record) => [englishInstrument(record.instrumentKey, record.instrumentName), record.instrumentId, record.sopNumber, record.resultStatus.toUpperCase(), englishState(record.lifecycleStatus), record.pharmacistName, new Date(record.createdAt).toISOString()]),
  ];
  download(`\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`, "text/csv;charset=utf-8", `validation-analytics-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function dataUrl(url: string) { const response = await fetch(url); const blob = await response.blob(); return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); }); }
function pageHeader(doc: jsPDF, title: string) { doc.setFillColor(255, 254, 250); doc.rect(0, 0, 210, 297, "F"); doc.setFont("times", "bold"); doc.setTextColor(23, 63, 53); doc.setFontSize(15); doc.text(title, 105, 42, { align: "center" }); doc.setDrawColor(12, 90, 76); doc.setLineWidth(.7); doc.line(14, 47, 196, 47); }
function metricCell(doc: jsPDF, x: number, y: number, label: string, value: string) { doc.setDrawColor(215, 226, 215); doc.rect(x, y, 42, 23); doc.setFont("times", "normal"); doc.setTextColor(93, 116, 105); doc.setFontSize(7.4); doc.text(label, x + 21, y + 7, { align: "center" }); doc.setFont("times", "bold"); doc.setTextColor(23, 63, 53); doc.setFontSize(13); doc.text(value, x + 21, y + 16, { align: "center" }); }
function drawTableHeader(doc: jsPDF, y: number) { doc.setFillColor(244, 248, 242); doc.rect(14, y, 182, 7, "F"); doc.setTextColor(42, 76, 65); doc.setFont("times", "bold"); doc.setFontSize(7.1); ["Instrument", "ID", "Result", "State", "Validated by", "Date"].forEach((heading, index) => doc.text(heading, [16, 62, 84, 105, 130, 171][index], y + 4.5)); }

export async function exportAnalyticsPdf(records: AnalyticsRecord[], summary: AnalyticsSummary, filters: AnalyticsFilters) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  pageHeader(doc, "FILTERED VALIDATION ANALYTICS REPORT");
  try { doc.addImage(await dataUrl(headerUrl), "PNG", 12, 10, 186, 25); } catch { /* The official report remains usable if the header asset is unavailable. */ }
  doc.setFont("times", "normal"); doc.setTextColor(82, 103, 93); doc.setFontSize(7.8); doc.text(filterDescription(filters), 105, 53, { align: "center", maxWidth: 180 });
  [["Total records", String(summary.total)], ["Pass rate", `${summary.passRate}%`], ["Approval rate", `${summary.approvalRate}%`], ["Open drafts", String(summary.draft)]].forEach(([label, value], index) => metricCell(doc, 14 + (index * 46), 61, label, value));
  let y = 93;
  doc.setFont("times", "bold"); doc.setTextColor(42, 76, 65); doc.setFontSize(10); doc.text("Performance by instrument", 14, y); y += 6;
  summary.instruments.forEach((instrument) => { doc.setDrawColor(224, 233, 224); doc.rect(14, y, 182, 7); doc.setFont("times", "normal"); doc.setFontSize(7.6); doc.setTextColor(54, 84, 72); doc.text(englishInstrument(instrument.instrumentKey, instrument.instrumentName), 16, y + 4.5); doc.text(`${instrument.total} records | ${instrument.pass} pass | ${instrument.fail} fail`, 194, y + 4.5, { align: "right" }); y += 7; });
  y += 9; doc.setFont("times", "bold"); doc.setFontSize(10); doc.text("Filtered record register", 14, y); y += 5; drawTableHeader(doc, y); y += 7;
  records.forEach((record, index) => { if (y > 274) { doc.addPage(); pageHeader(doc, "FILTERED VALIDATION ANALYTICS REPORT"); y = 56; drawTableHeader(doc, y); y += 7; } doc.setDrawColor(231, 237, 230); doc.rect(14, y, 182, 7); doc.setFont("times", "normal"); doc.setTextColor(45, 73, 63); doc.setFontSize(6.8); const cells = [englishInstrument(record.instrumentKey, record.instrumentName), record.instrumentId, record.resultStatus.toUpperCase(), englishState(record.lifecycleStatus), safeText(record.pharmacistName), new Date(record.createdAt).toLocaleDateString("en-GB")]; cells.forEach((cell, cellIndex) => doc.text(cell, [16, 62, 84, 105, 130, 171][cellIndex], y + 4.5, { maxWidth: cellIndex === 0 ? 43 : cellIndex === 4 ? 38 : 22 })); y += 7; });
  doc.setFont("times", "italic"); doc.setTextColor(104, 123, 113); doc.setFontSize(6.5); doc.text(`Generated ${new Date().toLocaleString("en-GB")} | National Quality Control Laboratory`, 105, 287, { align: "center" });
  doc.save(`validation-analytics-${new Date().toISOString().slice(0, 10)}.pdf`);
}
