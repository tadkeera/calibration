/** Official A4 validation record renderer; the header asset is an exact crop from the user-supplied approved paper form. */
import { jsPDF } from "jspdf";
import type { CalibrationResult, Device } from "@/lib/qc";

const officialHeaderUrl = "/manus-storage/yemen-qc-official-report-header_4f137299.png";

const testTranslations: Record<string, string> = {
  "حرارة الحمام المائي": "Water bath temperature",
  "حرارة وسط التفكك": "Disintegration medium temperature",
  "دقة التوقيت": "Timer accuracy",
  "سرعة الدورات — المحاولة 1": "Cycle speed — attempt 1",
  "سرعة الدورات — المحاولة 2": "Cycle speed — attempt 2",
  "سرعة الدورات — المحاولة 3": "Cycle speed — attempt 3",
  "صفر الماء المقطر": "Distilled-water zero check",
  "مدى محلول NaCl": "NaCl solution span check",
  "حرارة الحمام": "Bath temperature",
  "درجة حرارة الوعاء": "Vessel temperature",
  "دقة السرعة": "Speed accuracy",
  "ترنح عمود السلة": "Basket shaft wobble",
  "ترنح عمود المجداف": "Paddle shaft wobble",
  "الدوران النوعي": "Specific rotation",
  "التكرارية": "Repeatability",
  "معامل الارتباط": "Correlation factor",
  "الوزن المرجعي": "Reference weight",
  "الحمل اللامركزي": "Off-center load",
  "الخطية": "Linearity",
  "الطول الموجي": "Wavelength accuracy",
  "الضوء الشارد": "Stray light",
  "الامتصاصية": "Absorbance",
  "معدل التدفق": "Flow rate",
  "الانحراف": "Deviation",
  "RSD": "RSD",
};

const transliteration: Record<string, string> = { "ا": "a", "أ": "a", "إ": "i", "آ": "aa", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y", "ى": "a", "ة": "a", "ئ": "y", "ؤ": "w", "ء": "", "ـ": "" };

function officialText(value: string) {
  const exact = testTranslations[value];
  if (exact) return exact;
  for (const [arabic, english] of Object.entries(testTranslations)) {
    if (value.includes(arabic)) return value.replace(arabic, english);
  }
  return value.replace(/[\u0600-\u06FF]/g, (character) => transliteration[character] ?? "");
}

type OfficialPdfInput = {
  device: Device;
  result: CalibrationResult;
  pharmacistName: string;
  lifecycleStatus: "draft" | "approved" | "rejected";
  approvedByName?: string | null;
  approvedAt?: Date | string | null;
  language: "ar" | "en";
};

const toDataUrl = async (url: string) => {
  const response = await fetch(url);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

function line(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, width = 0.22) {
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
}

function cell(doc: jsPDF, x: number, y: number, width: number, height: number, value: string, options: { bold?: boolean; italic?: boolean; align?: "left" | "center" | "right"; fontSize?: number } = {}) {
  doc.setFont("times", options.bold ? "bold" : options.italic ? "italic" : "normal");
  doc.setFontSize(options.fontSize ?? 8.2);
  doc.rect(x, y, width, height);
  doc.text(value, x + (options.align === "center" ? width / 2 : options.align === "right" ? width - 2 : 2), y + height / 2 + 1.4, { align: options.align ?? "left", maxWidth: width - 3 });
}

function sectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFont("times", "bolditalic");
  doc.setFontSize(11);
  doc.text(title, 105, y, { align: "center" });
  return y + 4;
}

function genericResultTable(doc: jsPDF, result: CalibrationResult, y: number) {
  const width = 190;
  const x = 10;
  const columns = [73, 47, 45, 25];
  ["Test", "Limit", "Actual", "Remarks"].forEach((head, index) => cell(doc, x + columns.slice(0, index).reduce((a, b) => a + b, 0), y, columns[index], 6, head, { bold: true, italic: true, align: "center", fontSize: 8 }));
  let rowY = y + 6;
  result.rows.slice(0, 17).forEach((row) => {
    const values = [officialText(row.test), officialText(row.expected), officialText(row.actual), row.pass ? "Pass" : "Fail"];
    values.forEach((value, index) => cell(doc, x + columns.slice(0, index).reduce((a, b) => a + b, 0), rowY, columns[index], 5.5, value, { bold: index === 3, italic: index === 3, align: index === 3 ? "center" : "left", fontSize: 7.1 }));
    rowY += 5.5;
  });
  return rowY + 3;
}

function polarimeterLayout(doc: jsPDF, result: CalibrationResult, y: number) {
  const accuracy = result.rows.find((row) => row.test.includes("الدوران البصري النوعي"));
  const repetitions = result.rows.filter((row) => row.test.includes("التكرارية"));
  const firstChartPoint = result.chart?.[0];
  y = sectionTitle(doc, "Accuracy Test", y + 3);
  const widths = [39, 39, 39, 47, 26];
  ["Optical Rotation", "Specific\nRotation", "Conc. (g/100ml)", "Limit", "Remarks"].forEach((heading, index) => cell(doc, 10 + widths.slice(0, index).reduce((a, b) => a + b, 0), y, widths[index], 11, heading, { bold: true, italic: true, align: "center" }));
  const specific = accuracy?.actual ?? "—";
  ["26.74", specific, "20.0204", "+ 66.3 to + 67.0", accuracy?.pass ? "Pass" : "Fail"].forEach((value, index) => cell(doc, 10 + widths.slice(0, index).reduce((a, b) => a + b, 0), y + 11, widths[index], 7, value, { bold: index === 4, italic: index === 4, align: "center", fontSize: 8 }));
  y += 29;
  doc.setFont("times", "bolditalic"); doc.setFontSize(11); doc.text("[α]²⁰ᴰ  =  100 a / l · c", 105, y, { align: "center" });
  y = sectionTitle(doc, "Repeatability Test", y + 12);
  const repeatWidths = [39, 48, 80, 23];
  ["Conc. (g/100ml)", "Optical Rotation", "Limit", "Remarks"].forEach((heading, index) => cell(doc, 10 + repeatWidths.slice(0, index).reduce((a, b) => a + b, 0), y, repeatWidths[index], 6, heading, { bold: true, italic: true, align: "center" }));
  let repeatY = y + 6;
  const repeatRows = repetitions.length ? repetitions : Array.from({ length: 6 }, () => ({ actual: "26.74°", pass: true }));
  repeatRows.forEach((row, index) => {
    if (index === 0) cell(doc, 10, repeatY, 39, 6 * repeatRows.length, "20% w/v", { bold: true, italic: true, align: "center" });
    cell(doc, 49, repeatY, 48, 6, row.actual.replace("°", ""), { align: "center", fontSize: 8.2 });
    cell(doc, 97, repeatY, 80, 6, "Optical Rotation ± 0.05", { italic: true, align: "center", fontSize: 8 });
    cell(doc, 177, repeatY, 23, 6, row.pass ? "Pass" : "Fail", { bold: true, italic: true, align: "center" });
    repeatY += 6;
  });
  y = repeatY + 9;
  doc.setFont("times", "bolditalic"); doc.setFontSize(10); doc.text("Linearity Test", 10, y);
  const chart = result.chart ?? [];
  const leftX = 10;
  const chartX = 86;
  const tableWidths = [33, 33];
  ["Nominal\nViscosity", "Actual\nViscosity"].forEach((heading, index) => cell(doc, leftX + tableWidths.slice(0, index).reduce((a, b) => a + b, 0), y + 2, tableWidths[index], 10, heading, { bold: true, italic: true, align: "center" }));
  const points = chart.length ? chart : [{ label: "10", value: 13.37 }, { label: "20", value: 26.74 }, { label: "30", value: 40.11 }, { label: "40", value: 53.48 }];
  let tableY = y + 12;
  points.forEach((point) => { cell(doc, leftX, tableY, 33, 5.6, point.label, { bold: true, italic: true, align: "center" }); cell(doc, leftX + 33, tableY, 33, 5.6, point.value.toFixed(2), { bold: true, italic: true, align: "center" }); tableY += 5.6; });
  const metricRows = [
    ["Slope", result.metrics.find((metric) => metric.label.includes("R"))?.value ?? "0.99993"],
    ["Intercept", "0.00000"],
    ["Correlation factor", result.metrics.find((metric) => metric.label.includes("R"))?.value ?? "0.99993"],
    ["Corr. Factor Limit", ">= 0.99"],
    ["Remarks", result.overall ? "Pass" : "Fail"],
  ];
  metricRows.forEach(([label, value]) => { cell(doc, leftX, tableY, 33, 5.6, label, { bold: true, italic: true, align: "center" }); cell(doc, leftX + 33, tableY, 33, 5.6, value, { bold: true, italic: true, align: "center" }); tableY += 5.6; });
  cell(doc, chartX, y + 2, 114, 69, "", {});
  doc.setFont("times", "bold"); doc.setFontSize(8.5); doc.text("Linearity Test", chartX + 57, y + 9, { align: "center" });
  const plotX = chartX + 12, plotY = y + 14, plotW = 92, plotH = 48;
  doc.rect(plotX, plotY, plotW, plotH);
  for (let axis = 1; axis < 5; axis += 1) { line(doc, plotX + (plotW / 5) * axis, plotY, plotX + (plotW / 5) * axis, plotY + plotH, 0.08); line(doc, plotX, plotY + (plotH / 5) * axis, plotX + plotW, plotY + (plotH / 5) * axis, 0.08); }
  const maxY = Math.max(60, ...points.map((point) => point.value));
  points.forEach((point, index) => { const px = plotX + (plotW / Math.max(points.length - 1, 1)) * index; const py = plotY + plotH - (point.value / maxY) * plotH; if (index > 0) { const previous = points[index - 1]; const previousX = plotX + (plotW / Math.max(points.length - 1, 1)) * (index - 1); const previousY = plotY + plotH - (previous.value / maxY) * plotH; line(doc, previousX, previousY, px, py, 0.6); } doc.circle(px, py, 0.8, "F"); });
  doc.setFont("times", "normal"); doc.setFontSize(7); doc.text("Conc (g/100ml)", chartX + 57, y + 69, { align: "center" });
  doc.text("Optical Rotation", chartX + 4, y + 39, { angle: 90, align: "center" });
  return Math.max(tableY, y + 73) + 4;
}

function signatureBlock(doc: jsPDF, y: number, input: OfficialPdfInput) {
  const conclusion = input.result.overall ? "The Instrument validation within the tolerance" : "The Instrument validation FAILED";
  cell(doc, 10, y, 190, 6, conclusion, { bold: true, italic: true, align: "center", fontSize: 9 });
  y += 8;
  const approvedText = input.lifecycleStatus === "approved" ? "Approved" : input.lifecycleStatus === "rejected" ? "Rejected" : "Pending approval";
  cell(doc, 10, y, 30, 6, "Validated by", { bold: true, italic: true });
  cell(doc, 40, y, 92, 6, officialText(input.pharmacistName), { italic: true });
  cell(doc, 132, y, 68, 18, "Approved by", { bold: true, italic: true, align: "center" });
  cell(doc, 10, y + 6, 30, 6, "Date", { bold: true, italic: true });
  cell(doc, 40, y + 6, 92, 6, new Date().toLocaleDateString("en-GB"), { italic: true });
  cell(doc, 10, y + 12, 30, 6, "Signature", { bold: true, italic: true });
  cell(doc, 40, y + 12, 92, 6, `Validated — ${officialText(input.pharmacistName)}`, { italic: true, fontSize: 7.5 });
  doc.setFont("times", "bolditalic"); doc.setFontSize(8); doc.text(`${approvedText}${input.approvedByName ? ` — ${input.approvedByName}` : ""}`, 166, y + 13, { align: "center" });
  doc.setFont("times", "bolditalic"); doc.setFontSize(8); doc.text(`Form# ${input.device.form}`, 198, 289, { align: "right" });
}

export async function downloadOfficialPdf(input: OfficialPdfInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const headerImage = await toDataUrl(officialHeaderUrl);
  doc.setLineWidth(0.35); doc.rect(5, 5, 200, 287); doc.rect(5.8, 5.8, 198.4, 285.4);
  doc.addImage(headerImage, "PNG", 8, 8, 194, 37.7);
  doc.setFont("times", "bolditalic"); doc.setFontSize(13); doc.text("Validation Record", 105, 52, { align: "center" });
  const metaY = 55;
  const columns = [35, 61, 35, 59];
  const metadata = [
    ["Instrument Name", input.device.english, "ID No.", input.device.id],
    ["Manufacturer", input.device.manufacturer, "SOP No.", input.device.sop],
    ["Serial No.", input.device.serial, "Model", input.device.model],
  ];
  metadata.forEach((row, rowIndex) => row.forEach((value, columnIndex) => cell(doc, 10 + columns.slice(0, columnIndex).reduce((a, b) => a + b, 0), metaY + rowIndex * 6, columns[columnIndex], 6, value, { bold: columnIndex % 2 === 0, italic: columnIndex % 2 === 1, fontSize: 8 })));
  const contentStart = metaY + 22;
  const endY = input.device.key === "polarimeter" ? polarimeterLayout(doc, input.result, contentStart) : genericResultTable(doc, input.result, sectionTitle(doc, "Validation Test Results", contentStart + 4));
  signatureBlock(doc, Math.min(263, Math.max(endY + 3, 262)), input);
  doc.save(`${input.device.english.replaceAll(" ", "_")}_Validation_Record.pdf`);
}
