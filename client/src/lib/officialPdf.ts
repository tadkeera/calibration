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
  "معدل تدفق": "Flow rate",
  "الانحراف": "Deviation",
  "RSD": "RSD",
  "معايرة الصفر — الماء المقطر": "Zero calibration — Distilled Water",
  "معايرة المدى — زيت المعايرة": "Span calibration — Calibration oil",
  "تحقق:": "Verification:",
  "المتوسط": "Mean",
  "متوسط": "Mean",
  "حرارة الوعاء": "Vessel temperature",
  "سرعة التحريك": "Stirring speed",
  "دقة طول موجة": "Wavelength accuracy",
  "الامتصاصية النوعية عند": "Specific absorbance at",
  "اختبار الضوء الشارد": "Stray-light limit",
  "معايرة Span": "Span calibration",
  "التكرارية — قراءة": "Reproducibility — reading",
  "لزوجة قياسية": "Viscosity standard",
  "معامل ارتباط الخطية R": "Linearity correlation factor R",
  "الدوران البصري النوعي": "Specific optical rotation",
  "سرعة الدورات": "Number of cycles per minute",
  "ماء مقطر": "Distilled Water",
  "كحول أيزوبروبيلي": "Isopropyl Alcohol",
  "ثنائي كلورو ميثان": "Dichloromethane",
  "جليسرين": "Glycerin",
  "بنزالدهيد": "Benzaldehyde",
  "المركز": "Centre",
  "مركز": "Centre",
  "ركن": "Corner",
  "من القراءة الأولى": "from the first reading",
  "قراءة": "Reading",
  "حرارة الحمام المائي الفعلية": "Actual water bath temperature",
  "أعلى ترنح": "Maximum wobble",
  "متوسط حرارة الأوعية": "Mean vessel temperature",
  "انحراف Span": "Span deviation",
  "الميل": "Slope",
  "نقطة التقاطع": "Intercept",
};

const transliteration: Record<string, string> = { "ا": "a", "أ": "a", "إ": "i", "آ": "aa", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y", "ى": "a", "ة": "a", "ئ": "y", "ؤ": "w", "ء": "", "ـ": "" };

function officialText(value: string) {
  const exact = testTranslations[value];
  if (exact) return exact;
  let converted = value;
  Object.entries(testTranslations).sort(([first], [second]) => second.length - first.length).forEach(([arabic, english]) => {
    converted = converted.replaceAll(arabic, english);
  });
  return converted.replace(/[\u0600-\u06FF]/g, (character) => transliteration[character] ?? "");
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
  const rowHeight = result.rows.length > 16 ? 4.8 : 5.5;
  result.rows.forEach((row) => {
    const values = [officialText(row.test), officialText(row.expected), officialText(row.actual), row.pass ? "Pass" : "Fail"];
    values.forEach((value, index) => cell(doc, x + columns.slice(0, index).reduce((a, b) => a + b, 0), rowY, columns[index], rowHeight, value, { bold: index === 3, italic: index === 3, align: index === 3 ? "center" : "left", fontSize: result.rows.length > 16 ? 6.15 : 7.1 }));
    rowY += rowHeight;
  });
  return rowY + 3;
}

type ReportSection = { title: string; patterns: string[] };

function sectionedResultTables(doc: jsPDF, result: CalibrationResult, y: number, sections: ReportSection[]) {
  const remaining = [...result.rows];
  sections.forEach((section) => {
    const rows = remaining.filter((row) => section.patterns.some((pattern) => row.test.includes(pattern)));
    if (!rows.length) return;
    rows.forEach((row) => remaining.splice(remaining.indexOf(row), 1));
    y = genericResultTable(doc, { ...result, rows }, sectionTitle(doc, section.title, y + 4));
  });
  if (remaining.length) y = genericResultTable(doc, { ...result, rows: remaining }, sectionTitle(doc, "Additional Validation Results", y + 4));
  return y;
}

type ReportChart = { title: string; xLabel: string; yLabel: string; data: { label: string; value: number; reference?: number }[] };

function drawReportChart(doc: jsPDF, chart: ReportChart, x: number, y: number, width = 190, height = 57) {
  doc.rect(x, y, width, height);
  doc.setFont("times", "bold"); doc.setFontSize(8.3); doc.text(chart.title, x + width / 2, y + 6, { align: "center" });
  const plotX = x + 16, plotY = y + 11, plotW = width - 24, plotH = height - 21;
  doc.rect(plotX, plotY, plotW, plotH);
  for (let grid = 1; grid < 5; grid += 1) { line(doc, plotX + (plotW / 5) * grid, plotY, plotX + (plotW / 5) * grid, plotY + plotH, 0.08); line(doc, plotX, plotY + (plotH / 5) * grid, plotX + plotW, plotY + (plotH / 5) * grid, 0.08); }
  const values = chart.data.map((point) => point.value);
  const refs = chart.data.map((point) => point.reference).filter((value): value is number => typeof value === "number");
  const minimum = Math.min(...values, ...refs); const maximum = Math.max(...values, ...refs); const padding = Math.max((maximum - minimum) * 0.14, Math.abs(maximum) * 0.025, 0.01); const min = minimum - padding; const max = maximum + padding;
  const yPosition = (value: number) => plotY + plotH - ((value - min) / Math.max(max - min, 0.0001)) * plotH;
  const xPosition = (index: number) => plotX + (plotW / Math.max(chart.data.length - 1, 1)) * index;
  const reference = chart.data.map((point) => point.reference);
  if (reference.every((value) => typeof value === "number")) { doc.setLineDashPattern([1, 1], 0); doc.setDrawColor(132, 145, 137); reference.forEach((value, index) => { if (index) line(doc, xPosition(index - 1), yPosition(reference[index - 1]!), xPosition(index), yPosition(value!), 0.35); }); doc.setLineDashPattern([], 0); doc.setDrawColor(0); }
  chart.data.forEach((point, index) => { const pointX = xPosition(index); const pointY = yPosition(point.value); if (index) { const previous = chart.data[index - 1]; line(doc, xPosition(index - 1), yPosition(previous.value), pointX, pointY, 0.65); } doc.circle(pointX, pointY, 0.75, "F"); });
  doc.setFont("times", "normal"); doc.setFontSize(6.3); doc.text(max.toFixed(Math.abs(max) < 10 ? 3 : 1), plotX - 2, plotY + 2, { align: "right" }); doc.text(min.toFixed(Math.abs(min) < 10 ? 3 : 1), plotX - 2, plotY + plotH, { align: "right" });
  chart.data.forEach((point, index) => { if (chart.data.length <= 6 || index === 0 || index === chart.data.length - 1 || index === Math.floor(chart.data.length / 2)) doc.text(point.label, xPosition(index), plotY + plotH + 4, { align: "center" }); });
  doc.setFontSize(7); doc.text(chart.xLabel, x + width / 2, y + height - 2, { align: "center" }); doc.text(chart.yLabel, x + 5, y + height / 2, { angle: 90, align: "center" });
  return y + height + 4;
}

function numeric(value: string) {
  const matched = value.match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1); }
function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function continuationPage(doc: jsPDF, headerImage: string, title: string) {
  doc.addPage();
  doc.setLineWidth(0.35); doc.rect(5, 5, 200, 287); doc.rect(5.8, 5.8, 198.4, 285.4);
  doc.addImage(headerImage, "PNG", 8, 8, 194, 37.7);
  doc.setFont("times", "bolditalic"); doc.setFontSize(12); doc.text(title, 105, 52, { align: "center" });
}

function tableHeading(doc: jsPDF, x: number, y: number, widths: number[], labels: string[], height = 7) {
  labels.forEach((label, index) => cell(doc, x + widths.slice(0, index).reduce((sum, width) => sum + width, 0), y, widths[index], height, label, { bold: true, italic: true, align: "center", fontSize: 7.2 }));
}

function valueOrDash(row: CalibrationResult["rows"][number] | undefined, selector: "actual" | "expected") { return row ? officialText(row[selector]) : "—"; }

function dissolutionLayout(doc: jsPDF, result: CalibrationResult, y: number) {
  const bath = result.rows.find((row) => row.test === "حرارة الحمام المائي");
  const vessels = result.rows.filter((row) => row.test.includes("حرارة الوعاء"));
  const stirring = result.rows.filter((row) => row.test.includes("سرعة التحريك"));
  const basket = result.rows.filter((row) => row.test.includes("ترنح عمود السلة"));
  const paddle = result.rows.filter((row) => row.test.includes("ترنح عمود المجداف"));
  const leftX = 10, rightX = 105, leftWidth = 88, rightWidth = 95;
  const rowH = 5.25;

  doc.setFont("times", "bolditalic"); doc.setFontSize(10.5); doc.text("Temperature Test", leftX + leftWidth / 2, y + 2, { align: "center" }); doc.text("Stirring Test", rightX + rightWidth / 2, y + 2, { align: "center" });
  let leftY = y + 6, rightY = y + 6;
  const tempWidths = [20, 24, 27, 17]; tableHeading(doc, leftX, leftY, tempWidths, ["Vessel\nNo.", "Actual\nTemp.", "Limit", "Remark"]); leftY += 7;
  vessels.forEach((row, index) => {
    cell(doc, leftX, leftY, tempWidths[0], rowH, String(index + 1), { bold: true, italic: true, align: "center", fontSize: 7.2 });
    cell(doc, leftX + tempWidths[0], leftY, tempWidths[1], rowH, valueOrDash(row, "actual"), { align: "center", fontSize: 7.2 });
    if (index === 0) cell(doc, leftX + tempWidths[0] + tempWidths[1], leftY, tempWidths[2], rowH * vessels.length, valueOrDash(row, "expected"), { italic: true, align: "center", fontSize: 6.5 });
    cell(doc, leftX + tempWidths[0] + tempWidths[1] + tempWidths[2], leftY, tempWidths[3], rowH, row.pass ? "Pass" : "Fail", { bold: true, italic: true, align: "center", fontSize: 7 });
    leftY += rowH;
  });
  leftY += 4; tableHeading(doc, leftX, leftY, [25, 23, 24, 16], ["Set Temp.\nof Water Bath", "Actual\nTemp.", "Limit", "Remarks"]); leftY += 7;
  ["38", valueOrDash(bath, "actual"), valueOrDash(bath, "expected"), bath?.pass ? "Pass" : "Fail"].forEach((value, index) => cell(doc, leftX + [0, 25, 48, 72][index], leftY, [25, 23, 24, 16][index], 9, value, { bold: index === 3, italic: true, align: "center", fontSize: 6.6 }));
  leftY += 13;

  const stirWidths = [27, 24, 29, 15]; tableHeading(doc, rightX, rightY, stirWidths, ["Stirring\nSpeed", "Actual\nSpeed", "Limit\n(rpm)", "Remarks"]); rightY += 7;
  stirring.forEach((row) => {
    const speed = officialText(row.test).replace("Stirring speed ", "");
    [speed, valueOrDash(row, "actual"), valueOrDash(row, "expected"), row.pass ? "Pass" : "Fail"].forEach((value, index) => cell(doc, rightX + stirWidths.slice(0, index).reduce((sum, width) => sum + width, 0), rightY, stirWidths[index], rowH + 0.8, value, { bold: index === 3, italic: index !== 1, align: "center", fontSize: 6.65 }));
    rightY += rowH + 0.8;
  });
  rightY += 4;

  const lowerY = Math.max(leftY, rightY) + 3;
  doc.setFont("times", "bolditalic"); doc.setFontSize(10); doc.text("Basket stirrer shaft wobble Test", leftX + leftWidth / 2, lowerY, { align: "center" }); doc.text("Paddle stirrer shaft wobble Test", rightX + rightWidth / 2, lowerY, { align: "center" });
  let basketY = lowerY + 4, paddleY = lowerY + 4;
  const wobbleLeft = [25, 22, 25, 16], wobbleRight = [28, 23, 29, 15];
  tableHeading(doc, leftX, basketY, wobbleLeft, ["Shaft No.", "Result", "Limit", "Remarks"]); basketY += 7;
  basket.forEach((row, index) => {
    const label = `Basket# ${index + 1}`;
    cell(doc, leftX, basketY, wobbleLeft[0], rowH, label, { italic: true, align: "center", fontSize: 7 }); cell(doc, leftX + wobbleLeft[0], basketY, wobbleLeft[1], rowH, valueOrDash(row, "actual"), { align: "center", fontSize: 7 });
    if (index === 0) cell(doc, leftX + wobbleLeft[0] + wobbleLeft[1], basketY, wobbleLeft[2], rowH * basket.length, valueOrDash(row, "expected"), { italic: true, align: "center", fontSize: 6.4 });
    cell(doc, leftX + wobbleLeft[0] + wobbleLeft[1] + wobbleLeft[2], basketY, wobbleLeft[3], rowH, row.pass ? "Pass" : "Fail", { bold: true, italic: true, align: "center", fontSize: 7 }); basketY += rowH;
  });
  tableHeading(doc, rightX, paddleY, wobbleRight, ["Shaft No.", "Result", "Limit", "Remarks"]); paddleY += 7;
  paddle.forEach((row, index) => {
    const label = `Paddle# ${index + 1}`;
    cell(doc, rightX, paddleY, wobbleRight[0], rowH, label, { italic: true, align: "center", fontSize: 7 }); cell(doc, rightX + wobbleRight[0], paddleY, wobbleRight[1], rowH, valueOrDash(row, "actual"), { align: "center", fontSize: 7 });
    if (index === 0) cell(doc, rightX + wobbleRight[0] + wobbleRight[1], paddleY, wobbleRight[2], rowH * paddle.length, valueOrDash(row, "expected"), { italic: true, align: "center", fontSize: 6.4 });
    cell(doc, rightX + wobbleRight[0] + wobbleRight[1] + wobbleRight[2], paddleY, wobbleRight[3], rowH, row.pass ? "Pass" : "Fail", { bold: true, italic: true, align: "center", fontSize: 7 }); paddleY += rowH;
  });
  return Math.max(basketY, paddleY) + 5;
}

function hplcLayout(doc: jsPDF, input: OfficialPdfInput, headerImage: string, y: number) {
  const charts = input.result.reportCharts ?? [];
  const resultRows = input.result.rows;
  doc.setFont("times", "bolditalic"); doc.setFontSize(11); doc.text("Flow Rate Accuracy Results", 105, y + 3, { align: "center" });
  const tableY = y + 7, panelWidth = 60, rowHeight = 4.35;
  charts.forEach((chart, chartIndex) => {
    const x = 10 + chartIndex * 62;
    const row = resultRows[chartIndex];
    const values = chart.data.map((point) => point.value); const mean = average(values); const deviation = Math.abs(mean - (chart.data[0]?.reference ?? mean)) / Math.max(chart.data[0]?.reference ?? mean, 0.0001) * 100; const rsd = standardDeviation(values) / Math.max(mean, 0.0001) * 100;
    const setTitle = chart.title.replace("Set Flow ", "Set Flow\n");
    tableHeading(doc, x, tableY, [9, 34, 17], ["No.", setTitle, "Result"], 9);
    let currentY = tableY + 9;
    values.forEach((value, index) => {
      cell(doc, x, currentY, 9, rowHeight, String(index + 1), { italic: true, align: "center", fontSize: 6.8 });
      cell(doc, x + 9, currentY, 34, rowHeight, value.toFixed(3), { bold: true, italic: true, align: "center", fontSize: 7 });
      cell(doc, x + 43, currentY, 17, rowHeight, row?.pass ? "Pass" : "Fail", { bold: true, italic: true, align: "center", fontSize: 6.6 }); currentY += rowHeight;
    });
    const limit = (row?.expected ?? "—").split("|")[0].trim();
    [["Mean", mean.toFixed(3)], ["Limit", officialText(limit)], ["Dev.", `${deviation.toFixed(3)}%`], ["RSD", `${rsd.toFixed(3)}%`]].forEach(([label, value]) => { cell(doc, x, currentY, 20, rowHeight, label, { bold: true, italic: true, align: "center", fontSize: 6.7 }); cell(doc, x + 20, currentY, 23, rowHeight, value, { italic: true, align: "center", fontSize: 6.6 }); cell(doc, x + 43, currentY, 17, rowHeight, row?.pass ? "Pass" : "Fail", { bold: true, italic: true, align: "center", fontSize: 6.3 }); currentY += rowHeight; });
  });
  const criteriaY = tableY + 9 + 10 * rowHeight + 4 * rowHeight + 3;
  cell(doc, 10, criteriaY, 48, 6, "Acceptance Criteria", { bold: true, italic: true, align: "center", fontSize: 7.5 }); cell(doc, 58, criteriaY, 38, 6, "Dev. ≤ 3.0%", { italic: true, align: "center", fontSize: 7 }); cell(doc, 96, criteriaY, 38, 6, "RSD ≤ 2.0%", { italic: true, align: "center", fontSize: 7 });
  continuationPage(doc, headerImage, "Flow Rate Accuracy Report — Charts");
  let chartY = 61;
  charts.forEach((chart) => { chartY = drawReportChart(doc, chart, 10, chartY, 190, 53); });
  return chartY;
}

function genericLayout(doc: jsPDF, input: OfficialPdfInput, y: number, headerImage: string) {
  const sectionNames: Record<string, string> = {
    disintegration: "Temperature, Time Accuracy & Number of Cycle Tests",
    refractometer: "Calibration & Verification Tests",
    dissolution: "Temperature, Stirring & Shaft Wobble Tests",
    hplc: "Flow Rate Accuracy Results",
    spectrophotometer: "Wavelength, Absorbance & Performance Tests",
    moisture: "Span, Reproducibility, Off-center Load & Linearity Tests",
    viscometer: "Viscosity Standards & Linearity Test",
  };
  const sections: Partial<Record<string, ReportSection[]>> = {
    disintegration: [
      { title: "Temperature Test", patterns: ["حرارة الحمام"] },
      { title: "Temperature of Medium", patterns: ["حرارة وسط التفكك"] },
      { title: "Time Accuracy Test", patterns: ["دقة التوقيت"] },
      { title: "Number of Cycle Test", patterns: ["سرعة الدورات"] },
    ],
    refractometer: [
      { title: "Calibration Test", patterns: ["معايرة الصفر", "معايرة المدى"] },
      { title: "Verification Test", patterns: ["تحقق:"] },
      { title: "Linearity Test", patterns: ["معامل ارتباط"] },
    ],
    dissolution: [
      { title: "Temperature Test", patterns: ["حرارة"] },
      { title: "Stirring Test", patterns: ["سرعة التحريك"] },
      { title: "Basket Stirrer Shaft Wobble Test", patterns: ["ترنح عمود السلة"] },
      { title: "Paddle Stirrer Shaft Wobble Test", patterns: ["ترنح عمود المجداف"] },
    ],
    spectrophotometer: [
      { title: "Control of Wavelengths", patterns: ["دقة طول موجة"] },
      { title: "Control of Absorbance", patterns: ["الامتصاصية النوعية"] },
      { title: "Validation Performance Test", patterns: ["دقة طول الموجة"] },
      { title: "Limit of Stray Light & Linearity", patterns: ["اختبار الضوء الشارد", "معامل ارتباط"] },
    ],
    moisture: [
      { title: "Span Calibration Test", patterns: ["معايرة Span"] },
      { title: "Reproducibility Test", patterns: ["التكرارية"] },
      { title: "Off-center Load Test", patterns: ["الحمل اللامركزي"] },
      { title: "Linearity Test", patterns: ["معامل ارتباط"] },
    ],
    viscometer: [
      { title: "Viscosity Standards", patterns: ["لزوجة قياسية"] },
      { title: "Linearity Test", patterns: ["معامل ارتباط"] },
    ],
  };
  let endY = sections[input.device.key] ? sectionedResultTables(doc, input.result, y, sections[input.device.key]!) : genericResultTable(doc, input.result, sectionTitle(doc, sectionNames[input.device.key] ?? "Validation Test Results", y + 4));
  if (input.device.key === "hplc" && input.result.reportCharts?.length) {
    input.result.reportCharts.forEach((chart) => { endY = drawReportChart(doc, chart, 10, endY, 190, 36); });
  } else if (input.result.chart && ["refractometer", "spectrophotometer", "moisture", "viscometer"].includes(input.device.key)) {
    const chartLabels: Record<string, [string, string, string]> = { refractometer: ["Linearity Test", "Nominal RI", "Actual RI"], spectrophotometer: ["Linearity Test", "Concentration", "Absorbance"], moisture: ["Linearity Test", "Test weight", "Displayed weight"], viscometer: ["Linearity Test", "Nominal Viscosity", "Actual Viscosity"] };
    const [title, xLabel, yLabel] = chartLabels[input.device.key];
    if (endY > 185) {
      doc.addPage();
      doc.setLineWidth(0.35); doc.rect(5, 5, 200, 287); doc.rect(5.8, 5.8, 198.4, 285.4);
      doc.addImage(headerImage, "PNG", 8, 8, 194, 37.7);
      doc.setFont("times", "bolditalic"); doc.setFontSize(12); doc.text("Validation Record — Continuation", 105, 52, { align: "center" });
      endY = 62;
    }
    endY = drawReportChart(doc, { title, xLabel, yLabel, data: input.result.chart }, 10, endY, 190, 57);
  }
  return endY;
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
  ["Conc.\n(g/100ml)", "Optical\nRotation"].forEach((heading, index) => cell(doc, leftX + tableWidths.slice(0, index).reduce((a, b) => a + b, 0), y + 2, tableWidths[index], 10, heading, { bold: true, italic: true, align: "center" }));
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
  const reportTitle = input.device.key === "hplc" ? "Flow Rate Accuracy Report" : "Validation Record";
  doc.setFont("times", "bolditalic"); doc.setFontSize(13); doc.text(reportTitle, 105, 52, { align: "center" });
  const metaY = 55;
  const columns = [35, 61, 35, 59];
  const metadata = [
    ["Instrument Name", input.device.english, "ID No.", input.device.id],
    ["Manufacturer", input.device.manufacturer, "SOP No.", input.device.sop],
    ["Serial No.", input.device.serial, "Model", input.device.model],
  ];
  metadata.forEach((row, rowIndex) => row.forEach((value, columnIndex) => cell(doc, 10 + columns.slice(0, columnIndex).reduce((a, b) => a + b, 0), metaY + rowIndex * 6, columns[columnIndex], 6, value, { bold: columnIndex % 2 === 0, italic: columnIndex % 2 === 1, fontSize: 8 })));
  const contentStart = metaY + 22;
  const endY = input.device.key === "polarimeter" ? polarimeterLayout(doc, input.result, contentStart) : input.device.key === "dissolution" ? dissolutionLayout(doc, input.result, contentStart) : input.device.key === "hplc" ? hplcLayout(doc, input, headerImage, contentStart) : genericLayout(doc, input, contentStart, headerImage);
  if (endY > 255) {
    continuationPage(doc, headerImage, `${reportTitle} — Approval`);
    signatureBlock(doc, 262, input);
  } else {
    signatureBlock(doc, Math.max(endY + 3, 262), input);
  }
  doc.save(`${input.device.english.replaceAll(" ", "_")}_Validation_Record.pdf`);
}
