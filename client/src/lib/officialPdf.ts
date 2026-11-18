/** Official A4 record renderer. Production generation requires the configured original approved header and fails closed if it cannot be loaded. */
import { jsPDF } from "jspdf";
import type { CalibrationResult, Device } from "@/lib/qc";

const officialHeaderProcedureUrl = "/api/trpc/assets.officialReportHeaderUrl";

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
  التكرارية: "Repeatability",
  "معامل الارتباط": "Correlation factor",
  "الوزن المرجعي": "Reference weight",
  "الحمل اللامركزي": "Off-center load",
  الخطية: "Linearity",
  "الطول الموجي": "Wavelength accuracy",
  "الضوء الشارد": "Stray light",
  الامتصاصية: "Absorbance",
  "معدل التدفق": "Flow rate",
  "معدل تدفق": "Flow rate",
  الانحراف: "Deviation",
  RSD: "RSD",
  "معايرة الصفر — الماء المقطر": "Zero calibration — Distilled Water",
  "معايرة المدى — زيت المعايرة": "Span calibration — Calibration oil",
  "تحقق:": "Verification:",
  المتوسط: "Mean",
  متوسط: "Mean",
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
  جليسرين: "Glycerin",
  بنزالدهيد: "Benzaldehyde",
  المركز: "Centre",
  مركز: "Centre",
  ركن: "Corner",
  "من القراءة الأولى": "from the first reading",
  قراءة: "Reading",
  "حرارة الحمام المائي الفعلية": "Actual water bath temperature",
  "أعلى ترنح": "Maximum wobble",
  "متوسط حرارة الأوعية": "Mean vessel temperature",
  "انحراف Span": "Span deviation",
  الميل: "Slope",
  "نقطة التقاطع": "Intercept",
};

const transliteration: Record<string, string> = {
  ا: "a",
  أ: "a",
  إ: "i",
  آ: "aa",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ى: "a",
  ة: "a",
  ئ: "y",
  ؤ: "w",
  ء: "",
  ـ: "",
};

function officialText(value: string) {
  const exact = testTranslations[value];
  if (exact) return exact;
  let converted = value;
  Object.entries(testTranslations)
    .sort(([first], [second]) => second.length - first.length)
    .forEach(([arabic, english]) => {
      converted = converted.replaceAll(arabic, english);
    });
  return converted.replace(
    /[\u0600-\u06FF]/g,
    character => transliteration[character] ?? ""
  );
}

type OfficialPdfInput = {
  device: Device;
  result: CalibrationResult;
  pharmacistName: string;
  lifecycleStatus: "draft" | "approved" | "rejected";
  approvedByName?: string | null;
  approvedByUserId?: number | null;
  approvedAt?: Date | string | null;
  lifecycleDecisionReason?: string | null;
  validatedByUserId?: number | null;
  recordCreatedAt?: Date | string | null;
  technicalReview?: {
    reviewerUserId: number;
    reviewerName?: string | null;
    decision: "accepted" | "rejected";
    recordVersion: number;
    comments: string;
    rejectionReason: string | null;
    outstandingIssues: string[];
    createdAt: Date | string;
  } | null;
  retestOfRecordId?: number | null;
  retestReason?: string | null;
  recordId?: number;
  language: "ar" | "en";
};

const toDataUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `Unable to load the official report header (${response.status}).`
    );
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

async function loadOfficialHeader() {
  try {
    const response = await fetch(officialHeaderProcedureUrl);
    if (!response.ok)
      throw new Error(
        `Unable to obtain the official report header URL (${response.status}).`
      );
    const payload = (await response.json()) as {
      result?: { data?: { json?: { url?: string } } };
    };
    const url = payload.result?.data?.json?.url;
    if (!url) throw new Error("The official report header URL is empty.");
    return await toDataUrl(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `تعذر تحميل الأكليشة الرسمية الأصلية. لم يتم إنشاء PDF دونها. ${reason}`
    );
  }
}

function line(
  doc: jsPDF,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 0.22
) {
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
}

function cell(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  value: string,
  options: {
    bold?: boolean;
    italic?: boolean;
    align?: "left" | "center" | "right";
    fontSize?: number;
  } = {}
) {
  doc.setFont(
    "times",
    options.bold ? "bold" : options.italic ? "italic" : "normal"
  );
  doc.setFontSize(options.fontSize ?? 8.2);
  doc.rect(x, y, width, height);
  doc.text(
    value,
    x +
      (options.align === "center"
        ? width / 2
        : options.align === "right"
          ? width - 2
          : 2),
    y + height / 2 + 1.4,
    { align: options.align ?? "left", maxWidth: width - 3 }
  );
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
  ["Test", "Limit", "Actual", "Remarks"].forEach((head, index) =>
    cell(
      doc,
      x + columns.slice(0, index).reduce((a, b) => a + b, 0),
      y,
      columns[index],
      6,
      head,
      { bold: true, italic: true, align: "center", fontSize: 8 }
    )
  );
  let rowY = y + 6;
  const rowHeight = result.rows.length > 16 ? 4.8 : 5.5;
  result.rows.forEach(row => {
    const values = [
      officialText(row.test),
      officialText(row.expected),
      officialText(row.actual),
      row.pass ? "Pass" : "Fail",
    ];
    values.forEach((value, index) =>
      cell(
        doc,
        x + columns.slice(0, index).reduce((a, b) => a + b, 0),
        rowY,
        columns[index],
        rowHeight,
        value,
        {
          bold: index === 3,
          italic: index === 3,
          align: index === 3 ? "center" : "left",
          fontSize: result.rows.length > 16 ? 6.15 : 7.1,
        }
      )
    );
    rowY += rowHeight;
  });
  return rowY + 3;
}

type ReportSection = { title: string; patterns: string[] };

function sectionedResultTables(
  doc: jsPDF,
  result: CalibrationResult,
  y: number,
  sections: ReportSection[],
  headerImage: string,
  reportTitle: string
) {
  const remaining = [...result.rows];
  sections.forEach(section => {
    const rows = remaining.filter(row =>
      section.patterns.some(pattern => row.test.includes(pattern))
    );
    if (!rows.length) return;
    rows.forEach(row => remaining.splice(remaining.indexOf(row), 1));
    const estimatedHeight = 10 + rows.length * (rows.length > 16 ? 4.8 : 5.5);
    if (y + estimatedHeight > 246) {
      continuationPage(doc, headerImage, `${reportTitle} — Continuation`);
      y = 60;
    }
    y = genericResultTable(
      doc,
      { ...result, rows },
      sectionTitle(doc, section.title, y + 4)
    );
  });
  if (remaining.length) {
    const estimatedHeight =
      10 + remaining.length * (remaining.length > 16 ? 4.8 : 5.5);
    if (y + estimatedHeight > 246) {
      continuationPage(doc, headerImage, `${reportTitle} — Continuation`);
      y = 60;
    }
    y = genericResultTable(
      doc,
      { ...result, rows: remaining },
      sectionTitle(doc, "Additional Validation Results", y + 4)
    );
  }
  return y;
}

/** A formal, five-column section table used where the paper form assigns an independent table to each test. */
function detailedSectionTable(
  doc: jsPDF,
  title: string,
  rows: CalibrationResult["rows"],
  y: number
) {
  y = sectionTitle(doc, title, y + 4);
  const x = 10;
  const widths = [13, 69, 47, 36, 25];
  tableHeading(
    doc,
    x,
    y,
    widths,
    ["No.", "Test / standard", "Acceptance limit", "Actual reading", "Remarks"],
    6.5
  );
  let rowY = y + 6.5;
  rows.forEach((row, index) => {
    const values = [
      String(index + 1),
      officialText(row.test),
      officialText(row.expected),
      officialText(row.actual),
      row.pass ? "Pass" : "Fail",
    ];
    values.forEach((value, columnIndex) => {
      cell(
        doc,
        x + widths.slice(0, columnIndex).reduce((sum, width) => sum + width, 0),
        rowY,
        widths[columnIndex],
        6.2,
        value,
        {
          bold: columnIndex === 0 || columnIndex === 4,
          italic: columnIndex === 4,
          align: columnIndex === 0 || columnIndex === 4 ? "center" : "left",
          fontSize: columnIndex === 1 ? 6.25 : 6.65,
        }
      );
    });
    rowY += 6.2;
  });
  return rowY + 3;
}

function detailedSectionTables(
  doc: jsPDF,
  result: CalibrationResult,
  y: number,
  sections: ReportSection[],
  headerImage: string,
  reportTitle: string
) {
  const remaining = [...result.rows];
  sections.forEach(section => {
    const rows = remaining.filter(row =>
      section.patterns.some(pattern => row.test.includes(pattern))
    );
    if (!rows.length) return;
    rows.forEach(row => remaining.splice(remaining.indexOf(row), 1));
    const requiredHeight = 18 + rows.length * 6.2;
    if (y + requiredHeight > 246) {
      continuationPage(doc, headerImage, `${reportTitle} — Continuation`);
      y = 60;
    }
    y = detailedSectionTable(doc, section.title, rows, y);
  });
  if (remaining.length) {
    const requiredHeight = 18 + remaining.length * 6.2;
    if (y + requiredHeight > 246) {
      continuationPage(doc, headerImage, `${reportTitle} — Continuation`);
      y = 60;
    }
    y = detailedSectionTable(
      doc,
      "Additional Validation Results",
      remaining,
      y
    );
  }
  return y;
}

type ReportChart = {
  title: string;
  xLabel: string;
  yLabel: string;
  data: { label: string; value: number; reference?: number }[];
};

function drawReportChart(
  doc: jsPDF,
  chart: ReportChart,
  x: number,
  y: number,
  width = 190,
  height = 57
) {
  doc.rect(x, y, width, height);
  doc.setFont("times", "bold");
  doc.setFontSize(8.3);
  doc.text(chart.title, x + width / 2, y + 6, { align: "center" });
  const plotX = x + 16,
    plotY = y + 11,
    plotW = width - 24,
    plotH = height - 21;
  doc.rect(plotX, plotY, plotW, plotH);
  for (let grid = 1; grid < 5; grid += 1) {
    line(
      doc,
      plotX + (plotW / 5) * grid,
      plotY,
      plotX + (plotW / 5) * grid,
      plotY + plotH,
      0.08
    );
    line(
      doc,
      plotX,
      plotY + (plotH / 5) * grid,
      plotX + plotW,
      plotY + (plotH / 5) * grid,
      0.08
    );
  }
  const values = chart.data.map(point => point.value);
  const refs = chart.data
    .map(point => point.reference)
    .filter((value): value is number => typeof value === "number");
  const minimum = Math.min(...values, ...refs);
  const maximum = Math.max(...values, ...refs);
  const padding = Math.max(
    (maximum - minimum) * 0.14,
    Math.abs(maximum) * 0.025,
    0.01
  );
  const min = minimum - padding;
  const max = maximum + padding;
  const yPosition = (value: number) =>
    plotY + plotH - ((value - min) / Math.max(max - min, 0.0001)) * plotH;
  const xPosition = (index: number) =>
    plotX + (plotW / Math.max(chart.data.length - 1, 1)) * index;
  const reference = chart.data.map(point => point.reference);
  if (reference.every(value => typeof value === "number")) {
    doc.setLineDashPattern([1, 1], 0);
    doc.setDrawColor(132, 145, 137);
    reference.forEach((value, index) => {
      if (index)
        line(
          doc,
          xPosition(index - 1),
          yPosition(reference[index - 1]!),
          xPosition(index),
          yPosition(value!),
          0.35
        );
    });
    doc.setLineDashPattern([], 0);
    doc.setDrawColor(0);
  }
  chart.data.forEach((point, index) => {
    const pointX = xPosition(index);
    const pointY = yPosition(point.value);
    if (index) {
      const previous = chart.data[index - 1];
      line(
        doc,
        xPosition(index - 1),
        yPosition(previous.value),
        pointX,
        pointY,
        0.65
      );
    }
    doc.circle(pointX, pointY, 0.75, "F");
  });
  doc.setFont("times", "normal");
  doc.setFontSize(6.3);
  doc.text(max.toFixed(Math.abs(max) < 10 ? 3 : 1), plotX - 2, plotY + 2, {
    align: "right",
  });
  doc.text(min.toFixed(Math.abs(min) < 10 ? 3 : 1), plotX - 2, plotY + plotH, {
    align: "right",
  });
  chart.data.forEach((point, index) => {
    if (
      chart.data.length <= 6 ||
      index === 0 ||
      index === chart.data.length - 1 ||
      index === Math.floor(chart.data.length / 2)
    )
      doc.text(point.label, xPosition(index), plotY + plotH + 4, {
        align: "center",
      });
  });
  doc.setFontSize(7);
  doc.text(chart.xLabel, x + width / 2, y + height - 2, { align: "center" });
  doc.text(chart.yLabel, x + 5, y + height / 2, { angle: 90, align: "center" });
  return y + height + 4;
}

function numeric(value: string) {
  const matched = value.match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

function average(values: number[]) {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  );
}
function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1)
  );
}

function continuationPage(doc: jsPDF, headerImage: string, title: string) {
  doc.addPage();
  doc.setLineWidth(0.35);
  doc.rect(5, 5, 200, 287);
  doc.rect(5.8, 5.8, 198.4, 285.4);
  doc.addImage(headerImage, "PNG", 8, 8, 194, 37.7);
  doc.setFont("times", "bolditalic");
  doc.setFontSize(12);
  doc.text(title, 105, 52, { align: "center" });
}

function tableHeading(
  doc: jsPDF,
  x: number,
  y: number,
  widths: number[],
  labels: string[],
  height = 7
) {
  labels.forEach((label, index) =>
    cell(
      doc,
      x + widths.slice(0, index).reduce((sum, width) => sum + width, 0),
      y,
      widths[index],
      height,
      label,
      { bold: true, italic: true, align: "center", fontSize: 7.2 }
    )
  );
}

function valueOrDash(
  row: CalibrationResult["rows"][number] | undefined,
  selector: "actual" | "expected"
) {
  return row ? officialText(row[selector]) : "—";
}

function dissolutionLayout(doc: jsPDF, result: CalibrationResult, y: number) {
  const bath = result.rows.find(row => row.test === "حرارة الحمام المائي");
  const vessels = result.rows.filter(row => row.test.includes("حرارة الوعاء"));
  const stirring = result.rows.filter(row => row.test.includes("سرعة التحريك"));
  const basket = result.rows.filter(row =>
    row.test.includes("ترنح عمود السلة")
  );
  const paddle = result.rows.filter(row =>
    row.test.includes("ترنح عمود المجداف")
  );
  const leftX = 10,
    rightX = 105,
    leftWidth = 88,
    rightWidth = 95;
  const rowH = 5.25;

  doc.setFont("times", "bolditalic");
  doc.setFontSize(10.5);
  doc.text("Temperature Test", leftX + leftWidth / 2, y + 2, {
    align: "center",
  });
  doc.text("Stirring Test", rightX + rightWidth / 2, y + 2, {
    align: "center",
  });
  let leftY = y + 6,
    rightY = y + 6;
  const tempWidths = [20, 24, 27, 17];
  tableHeading(doc, leftX, leftY, tempWidths, [
    "Vessel\nNo.",
    "Actual\nTemp.",
    "Limit",
    "Remark",
  ]);
  leftY += 7;
  vessels.forEach((row, index) => {
    cell(doc, leftX, leftY, tempWidths[0], rowH, String(index + 1), {
      bold: true,
      italic: true,
      align: "center",
      fontSize: 7.2,
    });
    cell(
      doc,
      leftX + tempWidths[0],
      leftY,
      tempWidths[1],
      rowH,
      valueOrDash(row, "actual"),
      { align: "center", fontSize: 7.2 }
    );
    if (index === 0)
      cell(
        doc,
        leftX + tempWidths[0] + tempWidths[1],
        leftY,
        tempWidths[2],
        rowH * vessels.length,
        valueOrDash(row, "expected"),
        { italic: true, align: "center", fontSize: 6.5 }
      );
    cell(
      doc,
      leftX + tempWidths[0] + tempWidths[1] + tempWidths[2],
      leftY,
      tempWidths[3],
      rowH,
      row.pass ? "Pass" : "Fail",
      { bold: true, italic: true, align: "center", fontSize: 7 }
    );
    leftY += rowH;
  });
  leftY += 4;
  tableHeading(
    doc,
    leftX,
    leftY,
    [25, 23, 24, 16],
    ["Set Temp.\nof Water Bath", "Actual\nTemp.", "Limit", "Remarks"]
  );
  leftY += 7;
  [
    "38",
    valueOrDash(bath, "actual"),
    valueOrDash(bath, "expected"),
    bath?.pass ? "Pass" : "Fail",
  ].forEach((value, index) =>
    cell(
      doc,
      leftX + [0, 25, 48, 72][index],
      leftY,
      [25, 23, 24, 16][index],
      9,
      value,
      { bold: index === 3, italic: true, align: "center", fontSize: 6.6 }
    )
  );
  leftY += 13;

  const stirWidths = [27, 24, 29, 15];
  tableHeading(doc, rightX, rightY, stirWidths, [
    "Stirring\nSpeed",
    "Actual\nSpeed",
    "Limit\n(rpm)",
    "Remarks",
  ]);
  rightY += 7;
  stirring.forEach(row => {
    const speed = officialText(row.test).replace("Stirring speed ", "");
    [
      speed,
      valueOrDash(row, "actual"),
      valueOrDash(row, "expected"),
      row.pass ? "Pass" : "Fail",
    ].forEach((value, index) =>
      cell(
        doc,
        rightX +
          stirWidths.slice(0, index).reduce((sum, width) => sum + width, 0),
        rightY,
        stirWidths[index],
        rowH + 0.8,
        value,
        {
          bold: index === 3,
          italic: index !== 1,
          align: "center",
          fontSize: 6.65,
        }
      )
    );
    rightY += rowH + 0.8;
  });
  rightY += 4;

  const lowerY = Math.max(leftY, rightY) + 3;
  doc.setFont("times", "bolditalic");
  doc.setFontSize(10);
  doc.text("Basket stirrer shaft wobble Test", leftX + leftWidth / 2, lowerY, {
    align: "center",
  });
  doc.text(
    "Paddle stirrer shaft wobble Test",
    rightX + rightWidth / 2,
    lowerY,
    { align: "center" }
  );
  let basketY = lowerY + 4,
    paddleY = lowerY + 4;
  const wobbleLeft = [25, 22, 25, 16],
    wobbleRight = [28, 23, 29, 15];
  tableHeading(doc, leftX, basketY, wobbleLeft, [
    "Shaft No.",
    "Result",
    "Limit",
    "Remarks",
  ]);
  basketY += 7;
  basket.forEach((row, index) => {
    const label = `Basket# ${index + 1}`;
    cell(doc, leftX, basketY, wobbleLeft[0], rowH, label, {
      italic: true,
      align: "center",
      fontSize: 7,
    });
    cell(
      doc,
      leftX + wobbleLeft[0],
      basketY,
      wobbleLeft[1],
      rowH,
      valueOrDash(row, "actual"),
      { align: "center", fontSize: 7 }
    );
    if (index === 0)
      cell(
        doc,
        leftX + wobbleLeft[0] + wobbleLeft[1],
        basketY,
        wobbleLeft[2],
        rowH * basket.length,
        valueOrDash(row, "expected"),
        { italic: true, align: "center", fontSize: 6.4 }
      );
    cell(
      doc,
      leftX + wobbleLeft[0] + wobbleLeft[1] + wobbleLeft[2],
      basketY,
      wobbleLeft[3],
      rowH,
      row.pass ? "Pass" : "Fail",
      { bold: true, italic: true, align: "center", fontSize: 7 }
    );
    basketY += rowH;
  });
  tableHeading(doc, rightX, paddleY, wobbleRight, [
    "Shaft No.",
    "Result",
    "Limit",
    "Remarks",
  ]);
  paddleY += 7;
  paddle.forEach((row, index) => {
    const label = `Paddle# ${index + 1}`;
    cell(doc, rightX, paddleY, wobbleRight[0], rowH, label, {
      italic: true,
      align: "center",
      fontSize: 7,
    });
    cell(
      doc,
      rightX + wobbleRight[0],
      paddleY,
      wobbleRight[1],
      rowH,
      valueOrDash(row, "actual"),
      { align: "center", fontSize: 7 }
    );
    if (index === 0)
      cell(
        doc,
        rightX + wobbleRight[0] + wobbleRight[1],
        paddleY,
        wobbleRight[2],
        rowH * paddle.length,
        valueOrDash(row, "expected"),
        { italic: true, align: "center", fontSize: 6.4 }
      );
    cell(
      doc,
      rightX + wobbleRight[0] + wobbleRight[1] + wobbleRight[2],
      paddleY,
      wobbleRight[3],
      rowH,
      row.pass ? "Pass" : "Fail",
      { bold: true, italic: true, align: "center", fontSize: 7 }
    );
    paddleY += rowH;
  });
  return Math.max(basketY, paddleY) + 5;
}

function hplcLayout(
  doc: jsPDF,
  input: OfficialPdfInput,
  headerImage: string,
  y: number
) {
  const charts = input.result.reportCharts ?? [];
  const resultRows = input.result.rows;
  doc.setFont("times", "bolditalic");
  doc.setFontSize(11);
  doc.text("Flow Rate Accuracy Results", 105, y + 3, { align: "center" });
  const tableY = y + 7,
    panelWidth = 60,
    rowHeight = 4.35;
  charts.forEach((chart, chartIndex) => {
    const x = 10 + chartIndex * 62;
    const row = resultRows[chartIndex];
    const values = chart.data.map(point => point.value);
    const mean = average(values);
    const deviation =
      (Math.abs(mean - (chart.data[0]?.reference ?? mean)) /
        Math.max(chart.data[0]?.reference ?? mean, 0.0001)) *
      100;
    const rsd = (standardDeviation(values) / Math.max(mean, 0.0001)) * 100;
    const setTitle = chart.title.replace("Set Flow ", "Set Flow\n");
    tableHeading(doc, x, tableY, [9, 34, 17], ["No.", setTitle, "Result"], 9);
    let currentY = tableY + 9;
    values.forEach((value, index) => {
      cell(doc, x, currentY, 9, rowHeight, String(index + 1), {
        italic: true,
        align: "center",
        fontSize: 6.8,
      });
      cell(doc, x + 9, currentY, 34, rowHeight, value.toFixed(3), {
        bold: true,
        italic: true,
        align: "center",
        fontSize: 7,
      });
      cell(doc, x + 43, currentY, 17, rowHeight, row?.pass ? "Pass" : "Fail", {
        bold: true,
        italic: true,
        align: "center",
        fontSize: 6.6,
      });
      currentY += rowHeight;
    });
    const limit = (row?.expected ?? "—").split("|")[0].trim();
    [
      ["Mean", mean.toFixed(3)],
      ["Limit", officialText(limit)],
      ["Dev.", `${deviation.toFixed(3)}%`],
      ["RSD", `${rsd.toFixed(3)}%`],
    ].forEach(([label, value]) => {
      cell(doc, x, currentY, 20, rowHeight, label, {
        bold: true,
        italic: true,
        align: "center",
        fontSize: 6.7,
      });
      cell(doc, x + 20, currentY, 23, rowHeight, value, {
        italic: true,
        align: "center",
        fontSize: 6.6,
      });
      cell(doc, x + 43, currentY, 17, rowHeight, row?.pass ? "Pass" : "Fail", {
        bold: true,
        italic: true,
        align: "center",
        fontSize: 6.3,
      });
      currentY += rowHeight;
    });
  });
  const criteriaY = tableY + 9 + 10 * rowHeight + 4 * rowHeight + 3;
  cell(doc, 10, criteriaY, 48, 6, "Acceptance Criteria", {
    bold: true,
    italic: true,
    align: "center",
    fontSize: 7.5,
  });
  cell(doc, 58, criteriaY, 38, 6, "Dev. ≤ 3.0%", {
    italic: true,
    align: "center",
    fontSize: 7,
  });
  cell(doc, 96, criteriaY, 38, 6, "RSD ≤ 2.0%", {
    italic: true,
    align: "center",
    fontSize: 7,
  });
  continuationPage(doc, headerImage, "Flow Rate Accuracy Report — Charts");
  let chartY = 61;
  charts.forEach(chart => {
    chartY = drawReportChart(doc, chart, 10, chartY, 190, 53);
  });
  return chartY;
}

function genericLayout(
  doc: jsPDF,
  input: OfficialPdfInput,
  y: number,
  headerImage: string,
  reportTitle: string
) {
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
      {
        title: "Basket Stirrer Shaft Wobble Test",
        patterns: ["ترنح عمود السلة"],
      },
      {
        title: "Paddle Stirrer Shaft Wobble Test",
        patterns: ["ترنح عمود المجداف"],
      },
    ],
    spectrophotometer: [
      { title: "Control of Wavelengths", patterns: ["دقة طول موجة"] },
      { title: "Control of Absorbance", patterns: ["الامتصاصية النوعية"] },
      { title: "Validation Performance Test", patterns: ["دقة طول الموجة"] },
      { title: "Limit of Stray Light", patterns: ["اختبار الضوء الشارد"] },
      { title: "Linearity Test", patterns: ["معامل ارتباط"] },
    ],
    moisture: [
      { title: "Span Calibration Test", patterns: ["معايرة Span"] },
      { title: "Reproducibility Test", patterns: ["التكرارية"] },
      { title: "Off-center Load Test", patterns: ["الحمل اللامركزي"] },
      { title: "Linearity Test", patterns: ["معامل ارتباط"] },
    ],
    viscometer: [
      { title: "Viscosity Standard 1", patterns: ["لزوجة قياسية 50 cP"] },
      { title: "Viscosity Standard 2", patterns: ["لزوجة قياسية 1000 cP"] },
      { title: "Viscosity Standard 3", patterns: ["لزوجة قياسية 12500 cP"] },
      { title: "Linearity Test", patterns: ["معامل ارتباط"] },
    ],
  };
  const detailedKeys = ["disintegration", "refractometer", "moisture"];
  let endY = sections[input.device.key]
    ? detailedKeys.includes(input.device.key)
      ? detailedSectionTables(
          doc,
          input.result,
          y,
          sections[input.device.key]!,
          headerImage,
          reportTitle
        )
      : sectionedResultTables(
          doc,
          input.result,
          y,
          sections[input.device.key]!,
          headerImage,
          reportTitle
        )
    : genericResultTable(
        doc,
        input.result,
        sectionTitle(
          doc,
          sectionNames[input.device.key] ?? "Validation Test Results",
          y + 4
        )
      );
  if (input.device.key === "hplc" && input.result.reportCharts?.length) {
    input.result.reportCharts.forEach(chart => {
      endY = drawReportChart(doc, chart, 10, endY, 190, 36);
    });
  } else if (
    input.result.chart &&
    ["refractometer", "spectrophotometer", "moisture", "viscometer"].includes(
      input.device.key
    )
  ) {
    const chartLabels: Record<string, [string, string, string]> = {
      refractometer: ["Linearity Test", "Nominal RI", "Actual RI"],
      spectrophotometer: ["Linearity Test", "Concentration", "Absorbance"],
      moisture: ["Linearity Test", "Test weight", "Displayed weight"],
      viscometer: ["Linearity Test", "Nominal Viscosity", "Actual Viscosity"],
    };
    const [title, xLabel, yLabel] = chartLabels[input.device.key];
    if (endY > 185) {
      doc.addPage();
      doc.setLineWidth(0.35);
      doc.rect(5, 5, 200, 287);
      doc.rect(5.8, 5.8, 198.4, 285.4);
      doc.addImage(headerImage, "PNG", 8, 8, 194, 37.7);
      doc.setFont("times", "bolditalic");
      doc.setFontSize(12);
      doc.text("Validation Record — Continuation", 105, 52, {
        align: "center",
      });
      endY = 62;
    }
    endY = drawReportChart(
      doc,
      { title, xLabel, yLabel, data: input.result.chart },
      10,
      endY,
      190,
      57
    );
  }
  return endY;
}

function polarimeterPage(
  doc: jsPDF,
  y: number,
  requiredHeight: number,
  headerImage: string
) {
  if (y + requiredHeight <= 253) return y;
  continuationPage(
    doc,
    headerImage,
    "Polarimeter Validation Record — Continuation"
  );
  return 62;
}

function polarimeterLayout(
  doc: jsPDF,
  input: OfficialPdfInput,
  startY: number,
  headerImage: string
) {
  const result = input.result;
  const data = result.polarimeterData;
  if (!data)
    return genericLayout(
      doc,
      input,
      startY,
      headerImage,
      "Polarimeter Validation Record"
    );

  const protocol = data.protocolSnapshot;
  const accuracy = data.accuracy;
  const stats = data.calculatedMetrics;
  const protocolPending = protocol.protocolStatus !== "approved";
  const statusText = (status: string) => status.toUpperCase();
  const valueText = (value: string | null | undefined) =>
    value?.trim() ? value : "Not recorded";
  const numberText = (value: number | null | undefined, precision = 6) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? "Not defined"
      : value.toFixed(precision);
  const dateText = (value: Date | string | null | undefined) => {
    if (!value) return "Not recorded";
    if (typeof value === "string" && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value))
      return `${value.replace("T", " ")} (local; zone not recorded)`;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime())
      ? date
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d{3}Z$/, " UTC")
      : "Not recorded";
  };
  const methodLabels: Record<string, string> = {
    "first-reading-deviation": "Absolute deviation from first reading",
    "reference-value-deviation":
      "Absolute deviation from protocol reference value",
    "mean-deviation": "Absolute deviation from mean",
    "maximum-range": "Maximum permitted range",
    "sample-standard-deviation": "Sample standard deviation",
    "rsd-percent": "Relative standard deviation (RSD)",
  };
  const deviationMethods = new Set([
    "first-reading-deviation",
    "reference-value-deviation",
    "mean-deviation",
  ]);
  const keyValue = (
    y: number,
    leftLabel: string,
    leftValue: string,
    rightLabel: string,
    rightValue: string
  ) => {
    const widths = [34, 61, 34, 61];
    const values = [leftLabel, leftValue, rightLabel, rightValue];
    values.forEach((value, index) =>
      cell(
        doc,
        10 + widths.slice(0, index).reduce((a, b) => a + b, 0),
        y,
        widths[index],
        6,
        value,
        {
          bold: index % 2 === 0,
          italic: index % 2 === 1,
          align: index % 2 === 0 ? "left" : "center",
          fontSize: index % 2 === 0 ? 6.8 : 6.6,
        }
      )
    );
  };
  const tableHeader = (
    y: number,
    widths: number[],
    labels: string[],
    height = 7
  ) => {
    labels.forEach((label, index) =>
      cell(
        doc,
        10 + widths.slice(0, index).reduce((a, b) => a + b, 0),
        y,
        widths[index],
        height,
        label,
        { bold: true, italic: true, align: "center", fontSize: 6.5 }
      )
    );
  };
  const tableRow = (
    y: number,
    widths: number[],
    values: string[],
    height = 5.5,
    statusIndex = -1
  ) => {
    values.forEach((value, index) =>
      cell(
        doc,
        10 + widths.slice(0, index).reduce((a, b) => a + b, 0),
        y,
        widths[index],
        height,
        value,
        {
          bold: index === statusIndex,
          italic: index === statusIndex,
          align: index === statusIndex || index > 0 ? "center" : "left",
          fontSize: 6.35,
        }
      )
    );
  };

  let y = polarimeterPage(doc, startY, 48, headerImage);
  y = sectionTitle(doc, "Protocol, Conditions & Traceability", y + 1);
  keyValue(
    y,
    "Protocol",
    `${protocol.protocolId} · v${protocol.protocolVersion}`,
    "Protocol state",
    statusText(protocol.protocolStatus)
  );
  y += 6;
  keyValue(
    y,
    "SOP / Form",
    `${protocol.sopNumber} / ${protocol.formNumber}`,
    "Effective date",
    protocol.effectiveDate ?? "Not set"
  );
  y += 6;
  keyValue(
    y,
    "Tube length",
    `${protocol.conditions.tubeLengthDm} dm`,
    "Reference temperature",
    `${protocol.conditions.referenceTemperatureC} °C`
  );
  y += 6;
  keyValue(
    y,
    "Wavelength",
    `${protocol.conditions.wavelengthLabel} · ${protocol.conditions.wavelengthNm} nm`,
    "Record ID",
    input.recordId === undefined ? "Not provided" : String(input.recordId)
  );
  y += 8;
  if (protocolPending) {
    cell(
      doc,
      10,
      y,
      190,
      10,
      "PENDING VERIFICATION — Acceptance criteria and method have not been verified against the approved SOP. This report records a draft technical calculation and is not a formal approval.",
      { bold: true, italic: true, align: "center", fontSize: 6.6 }
    );
    y += 12;
  }

  y = polarimeterPage(doc, y, 37, headerImage);
  y = sectionTitle(doc, "Accuracy Test — Specific Optical Rotation", y + 1);
  const accuracyWidths = [25, 35, 22, 39, 43, 26];
  tableHeader(
    y,
    accuracyWidths,
    [
      "Rotation (°)",
      "Conc. (g/100ml)",
      "Tube (dm)",
      "Specific rotation (°)",
      "Acceptance limits (°)",
      "Result",
    ],
    8
  );
  y += 8;
  tableRow(
    y,
    accuracyWidths,
    [
      valueText(accuracy.opticalRotation),
      valueText(accuracy.concentrationGPer100Ml),
      valueText(accuracy.tubeLengthDm),
      numberText(stats.specificRotation, protocol.accuracy.displayPrecision),
      `${protocol.accuracy.lowerLimit} to ${protocol.accuracy.upperLimit}`,
      statusText(data.testResults.accuracy),
    ],
    7,
    5
  );
  y += 7;
  keyValue(
    y,
    "Formula",
    "[alpha] = 100 * rotation / (l * c)",
    "Measurement time",
    dateText(accuracy.measurementDateTime)
  );
  y += 6;
  keyValue(
    y,
    "Measured temperature",
    accuracy.temperatureC?.trim()
      ? `${accuracy.temperatureC} °C`
      : "Not recorded",
    "Reference standard ID",
    valueText(accuracy.referenceStandardId)
  );
  y += 6;
  keyValue(
    y,
    "Certificate number",
    valueText(accuracy.referenceStandardCertificateNumber),
    "Standard expiry",
    valueText(accuracy.referenceStandardExpiryDate)
  );
  y += 6;
  keyValue(
    y,
    "Accuracy analyst notes",
    valueText(accuracy.analystNotes),
    "",
    ""
  );
  y += 7;

  const repeatRows = data.repeatability.readings;
  const repeatSectionHeight = 35 + repeatRows.length * 5.5;
  y = polarimeterPage(doc, y, Math.min(repeatSectionHeight, 190), headerImage);
  y = sectionTitle(doc, "Repeatability Test", y + 3);
  keyValue(
    y,
    "Sample ID",
    valueText(data.repeatability.sampleId),
    "Sample concentration",
    `${valueText(data.repeatability.sampleConcentration)} g/100ml`
  );
  y += 6;
  const repeatMethod =
    methodLabels[protocol.repeatability.method] ??
    protocol.repeatability.method;
  const referenceLabel =
    protocol.repeatability.method === "reference-value-deviation"
      ? ` · reference ${protocol.repeatability.referenceValue} °`
      : "";
  keyValue(
    y,
    "Protocol method",
    `${repeatMethod}${referenceLabel}`,
    "Acceptance limit",
    `${protocol.repeatability.tolerance} ${protocol.repeatability.unit}`
  );
  y += 6;
  keyValue(
    y,
    "Measurement conditions",
    valueText(data.repeatability.measurementConditions),
    "Analyst notes",
    valueText(data.repeatability.analystNotes)
  );
  y += 6;
  keyValue(
    y,
    "Mean",
    `${numberText(stats.repeatabilityMean, 6)} °`,
    "Minimum / maximum",
    `${numberText(stats.repeatabilityMinimum, 6)} / ${numberText(stats.repeatabilityMaximum, 6)} °`
  );
  y += 6;
  keyValue(
    y,
    "Range",
    `${numberText(stats.repeatabilityRange, 6)} °`,
    "Sample SD / RSD",
    `${numberText(stats.repeatabilitySampleStandardDeviation, 6)} ° / ${stats.repeatabilityRsdPercent === null ? "Not defined" : `${numberText(stats.repeatabilityRsdPercent, 4)}%`}`
  );
  y += 7;
  const repeatWidths = [22, 55, 75, 38];
  const repeatHeaders = deviationMethods.has(protocol.repeatability.method)
    ? [
        "Reading",
        "Optical rotation (°)",
        "Absolute deviation (°)",
        "Overall test state",
      ]
    : [
        "Reading",
        "Optical rotation (°)",
        "Per-reading deviation",
        "Overall test state",
      ];
  tableHeader(y, repeatWidths, repeatHeaders);
  y += 7;
  repeatRows.forEach((reading, index) => {
    y = polarimeterPage(doc, y, 6, headerImage);
    if (y === 62) {
      y = sectionTitle(doc, "Repeatability Test — Continued", y);
      tableHeader(y, repeatWidths, repeatHeaders);
      y += 7;
    }
    const deviation = deviationMethods.has(protocol.repeatability.method)
      ? `${numberText(stats.repeatabilityDeviations[index], 6)} °`
      : "Not applicable";
    tableRow(
      y,
      repeatWidths,
      [
        String(index + 1),
        `${reading} °`,
        deviation,
        statusText(data.testResults.repeatability),
      ],
      5.5,
      3
    );
    y += 5.5;
  });
  y += 6;

  const points = data.linearity.points;
  y = polarimeterPage(doc, y, 23, headerImage);
  y = sectionTitle(
    doc,
    "Linearity Test — Concentration vs. Optical Rotation",
    y + 1
  );
  const pointWidths = [15, 35, 37, 37, 66];
  const pointHeaders = [
    "Point",
    "Nominal concentration",
    "Actual concentration",
    "Optical rotation (°)",
    "Notes",
  ];
  tableHeader(y, pointWidths, pointHeaders);
  y += 7;
  points.forEach((point, index) => {
    y = polarimeterPage(doc, y, 6, headerImage);
    if (y === 62) {
      y = sectionTitle(doc, "Linearity Test — Continued", y);
      tableHeader(y, pointWidths, pointHeaders);
      y += 7;
    }
    tableRow(
      y,
      pointWidths,
      [
        String(point.pointNumber),
        `${point.nominalConcentration} g/100ml`,
        point.actualConcentration?.trim()
          ? `${point.actualConcentration} g/100ml`
          : "Not recorded",
        point.measuredOpticalRotation?.trim()
          ? `${point.measuredOpticalRotation} °`
          : "Not recorded",
        point.notes?.trim() || "—",
      ],
      5.5
    );
    y += 5.5;
  });
  y = polarimeterPage(doc, y, 7, headerImage);
  keyValue(
    y,
    "Linearity conditions",
    valueText(data.linearity.measurementConditions),
    "Analyst notes",
    valueText(data.linearity.analystNotes)
  );
  y += 8;
  const metricName = protocol.linearity.metric === "r2" ? "R²" : "r";
  const metricWidths = [47.5, 47.5, 47.5, 47.5];
  tableHeader(y, metricWidths, [
    "Slope",
    "Intercept",
    "Correlation coefficient r",
    "Coefficient of determination R²",
  ]);
  y += 7;
  tableRow(y, metricWidths, [
    numberText(stats.regressionSlope, protocol.linearity.displayPrecision),
    numberText(stats.regressionIntercept, protocol.linearity.displayPrecision),
    numberText(
      stats.correlationCoefficient,
      protocol.linearity.displayPrecision
    ),
    numberText(
      stats.coefficientOfDetermination,
      protocol.linearity.displayPrecision
    ),
  ]);
  y += 5.5;
  keyValue(
    y,
    "Configured acceptance",
    `${metricName} ≥ ${protocol.linearity.minimumMetric}`,
    "Server result",
    statusText(data.testResults.linearity)
  );
  y += 7;

  const chartPoints = points
    .map(point => ({
      x: protocol.linearity.useActualConcentration
        ? Number(point.actualConcentration)
        : point.nominalConcentration,
      y: Number(point.measuredOpticalRotation),
    }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (chartPoints.length >= 2) {
    y = polarimeterPage(doc, y, 70, headerImage);
    const x = 10,
      width = 190,
      height = 66;
    cell(doc, x, y, width, height, "", {});
    doc.setFont("times", "bold");
    doc.setFontSize(7.5);
    doc.text("Least-squares fit and measured points", 105, y + 4.5, {
      align: "center",
    });
    doc.setFont("times", "normal");
    doc.setFontSize(5.8);
    doc.circle(x + 52, y + 8, 0.75, "F");
    doc.text("Measured points", x + 55, y + 9, { align: "left" });
    line(doc, x + 103, y + 8, x + 112, y + 8, 0.6);
    doc.text("Least-squares regression line", x + 114, y + 9, {
      align: "left",
    });
    const equationSign = stats.regressionIntercept < 0 ? "−" : "+";
    doc.setFontSize(5.8);
    doc.text(
      `Regression equation: y = ${numberText(stats.regressionSlope, protocol.linearity.displayPrecision)}x ${equationSign} ${numberText(Math.abs(stats.regressionIntercept), protocol.linearity.displayPrecision)}`,
      105,
      y + 13,
      { align: "center" }
    );
    const plotX = x + 18,
      plotY = y + 16,
      plotW = width - 27,
      plotH = height - 26;
    doc.rect(plotX, plotY, plotW, plotH);
    for (let grid = 1; grid < 5; grid += 1) {
      line(
        doc,
        plotX + (plotW * grid) / 5,
        plotY,
        plotX + (plotW * grid) / 5,
        plotY + plotH,
        0.08
      );
      line(
        doc,
        plotX,
        plotY + (plotH * grid) / 5,
        plotX + plotW,
        plotY + (plotH * grid) / 5,
        0.08
      );
    }
    const minX = Math.min(...chartPoints.map(point => point.x));
    const maxX = Math.max(...chartPoints.map(point => point.x));
    const fittedY = [
      stats.regressionSlope * minX + stats.regressionIntercept,
      stats.regressionSlope * maxX + stats.regressionIntercept,
    ];
    const minDataY = Math.min(...chartPoints.map(point => point.y), ...fittedY);
    const maxDataY = Math.max(...chartPoints.map(point => point.y), ...fittedY);
    const xPadding = Math.max(
      (maxX - minX) * 0.08,
      Math.abs(maxX) * 0.02,
      0.0001
    );
    const yPadding = Math.max(
      (maxDataY - minDataY) * 0.12,
      Math.abs(maxDataY) * 0.02,
      0.0001
    );
    const x0 = minX - xPadding,
      x1 = maxX + xPadding,
      y0 = minDataY - yPadding,
      y1 = maxDataY + yPadding;
    const px = (value: number) => plotX + ((value - x0) / (x1 - x0)) * plotW;
    const py = (value: number) =>
      plotY + plotH - ((value - y0) / (y1 - y0)) * plotH;
    line(doc, px(minX), py(fittedY[0]), px(maxX), py(fittedY[1]), 0.65);
    chartPoints.forEach(point =>
      doc.circle(px(point.x), py(point.y), 0.9, "F")
    );
    doc.setFont("times", "normal");
    doc.setFontSize(6.3);
    doc.text(numberText(y1, 3), plotX - 2, plotY + 2, { align: "right" });
    doc.text(numberText(y0, 3), plotX - 2, plotY + plotH, { align: "right" });
    doc.text(numberText(minX, 3), px(minX), plotY + plotH + 3.3, {
      align: "center",
    });
    doc.text(numberText(maxX, 3), px(maxX), plotY + plotH + 3.3, {
      align: "center",
    });
    doc.setFontSize(7);
    doc.text(
      protocol.linearity.useActualConcentration
        ? "Actual concentration (g/100ml)"
        : "Nominal concentration (g/100ml)",
      105,
      y + height - 1,
      { align: "center" }
    );
    doc.text("Optical rotation (°)", x + 9, y + height / 2, {
      angle: 90,
      align: "center",
    });
    y += height + 4;
  } else {
    cell(
      doc,
      10,
      y,
      190,
      8,
      "Linearity chart unavailable: the saved measurements do not define at least two distinct numeric points.",
      { italic: true, align: "center", fontSize: 7 }
    );
    y += 10;
  }
  return y;
}

function wrappedBlockHeight(lineCount: number, fontSize = 6.5) {
  return Math.max(7, lineCount * Math.max(2.4, fontSize * 0.36) + 3);
}

function polarimeterLifecycleBlock(
  doc: jsPDF,
  startY: number,
  input: OfficialPdfInput,
  headerImage: string
) {
  let y = startY;
  const keepRoom = (height: number, title = "Polarimeter Record Status") => {
    if (y + height > 280) {
      continuationPage(doc, headerImage, `${title} — Continued`);
      y = 62;
    }
  };
  const appendParagraph = (label: string, value: string) => {
    const text = `${label}: ${officialText(value)}`;
    doc.setFont("times", "normal");
    doc.setFontSize(6.5);
    const split = doc.splitTextToSize(text, 186);
    const lines = Array.isArray(split) ? split : [split];
    let offset = 0;
    while (offset < lines.length) {
      let count = Math.floor((280 - y - 4) / 2.8);
      if (count < 1 || y + wrappedBlockHeight(1) > 280) {
        continuationPage(
          doc,
          headerImage,
          "Polarimeter Record Status — Continued"
        );
        y = 62;
        count = Math.floor((280 - y - 4) / 2.8);
      }
      count = Math.max(1, count);
      const chunk = lines.slice(offset, offset + count);
      const height = wrappedBlockHeight(chunk.length);
      doc.rect(10, y, 190, height);
      doc.setFont("times", "normal");
      doc.setFontSize(6.5);
      doc.text(chunk, 12, y + 3.2);
      y += height + 2;
      offset += chunk.length;
      if (offset < lines.length) {
        continuationPage(
          doc,
          headerImage,
          "Polarimeter Record Status — Continued"
        );
        y = 62;
      }
    }
  };

  const data = input.result.polarimeterData;
  const pending = data?.protocolSnapshot.protocolStatus !== "approved";
  const technical = input.result.overall
    ? "PASS under configured criteria"
    : "FAIL under configured criteria";
  const conclusion = pending
    ? `TECHNICAL CALCULATION: ${technical} · PROTOCOL PENDING VERIFICATION · NOT FORMALLY APPROVED`
    : `SERVER-RECOMPUTED TECHNICAL RESULT: ${technical}`;
  keepRoom(10);
  cell(doc, 10, y, 190, 8, conclusion, {
    bold: true,
    italic: true,
    align: "center",
    fontSize: 7.1,
  });
  y += 10;

  const lifecycle =
    input.lifecycleStatus === "approved"
      ? "APPROVED"
      : input.lifecycleStatus === "rejected"
        ? "REJECTED"
        : "DRAFT — PENDING DECISION";
  const identity = (name?: string | null, id?: number | null) =>
    name
      ? `${officialText(name)} (user ${id ?? "ID not provided"})`
      : id
        ? `User ID ${id}`
        : "Not recorded";
  const at = (value?: Date | string | null) =>
    value
      ? value instanceof Date
        ? dateString(value.toISOString())
        : dateString(value)
      : "Not recorded";
  const widths = [34, 61, 34, 61];
  const row = (values: string[]) => {
    keepRoom(7);
    values.forEach((value, index) =>
      cell(
        doc,
        10 + widths.slice(0, index).reduce((a, b) => a + b, 0),
        y,
        widths[index],
        6,
        value,
        {
          bold: index % 2 === 0,
          italic: index % 2 === 1,
          align: index % 2 ? "center" : "left",
          fontSize: 6.25,
        }
      )
    );
    y += 6;
  };
  row([
    "Lifecycle",
    lifecycle,
    "Record ID",
    input.recordId === undefined ? "Not provided" : String(input.recordId),
  ]);
  row([
    "Analyst account",
    identity(null, input.validatedByUserId),
    "Saved at",
    at(input.recordCreatedAt),
  ]);

  const review = input.technicalReview;
  row([
    "Technical review",
    review ? review.decision.toUpperCase() : "Not recorded",
    "Reviewer",
    review
      ? identity(review.reviewerName, review.reviewerUserId)
      : "Not recorded",
  ]);
  if (review) {
    row([
      "Review version",
      String(review.recordVersion),
      "Review time",
      at(review.createdAt),
    ]);
    appendParagraph(
      "Technical review comments",
      review.comments || "Not recorded"
    );
    if (review.rejectionReason)
      appendParagraph(
        "Technical review rejection reason",
        review.rejectionReason
      );
    if (review.outstandingIssues.length)
      appendParagraph(
        "Outstanding review issues",
        review.outstandingIssues.join("; ")
      );
  }

  row([
    "Lifecycle decision by",
    identity(input.approvedByName, input.approvedByUserId),
    "Decision time",
    at(input.approvedAt),
  ]);
  if (input.lifecycleDecisionReason)
    appendParagraph("Lifecycle decision reason", input.lifecycleDecisionReason);
  if (input.retestOfRecordId) {
    row([
      "Retest of record",
      String(input.retestOfRecordId),
      "Retest reason",
      "See linked reason below",
    ]);
    appendParagraph(
      "Controlled retest reason",
      input.retestReason || "Not recorded"
    );
  }

  const generatedAt = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
  appendParagraph("PDF generated at (client clock)", generatedAt);
  appendParagraph(
    "Analyst name (entered in record)",
    `${officialText(input.pharmacistName)}. This is a recorded name, not a secure electronic signature.`
  );
  appendParagraph(
    "Electronic signature status",
    "No secure electronic signature is captured by the current record system. The saved server lifecycle state is authoritative."
  );
  return y + 2;
}

function dateString(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")
    : "Not recorded";
}

function signatureBlock(doc: jsPDF, y: number, input: OfficialPdfInput) {
  const conclusion = input.result.overall
    ? "The Instrument validation within the tolerance"
    : "The Instrument validation FAILED";
  cell(doc, 10, y, 190, 6, conclusion, {
    bold: true,
    italic: true,
    align: "center",
    fontSize: 9,
  });
  y += 8;
  const decisionText =
    input.lifecycleStatus === "approved"
      ? "Approved"
      : input.lifecycleStatus === "rejected"
        ? "Rejected"
        : "Pending approval";
  const decisionBy = input.approvedByName
    ? `${officialText(input.approvedByName)} (user ${input.approvedByUserId ?? "ID not provided"})`
    : input.approvedByUserId
      ? `User ID ${input.approvedByUserId}`
      : "Not recorded";
  const recordDate = input.recordCreatedAt
    ? input.recordCreatedAt instanceof Date
      ? dateString(input.recordCreatedAt.toISOString())
      : dateString(input.recordCreatedAt)
    : "Not recorded";
  const decisionTime = input.approvedAt
    ? input.approvedAt instanceof Date
      ? dateString(input.approvedAt.toISOString())
      : dateString(input.approvedAt)
    : "Not recorded";
  cell(doc, 10, y, 30, 6, "Validated by", { bold: true, italic: true });
  cell(doc, 40, y, 92, 6, officialText(input.pharmacistName), { italic: true });
  cell(
    doc,
    132,
    y,
    68,
    18,
    `${decisionText} by: ${decisionBy}\\n${decisionTime}`,
    {
      bold: true,
      italic: true,
      align: "center",
      fontSize: 6.1,
    }
  );
  cell(doc, 10, y + 6, 30, 6, "Record created", { bold: true, italic: true });
  cell(doc, 40, y + 6, 92, 6, recordDate, { italic: true, fontSize: 7.2 });
  cell(doc, 10, y + 12, 30, 6, "Signature", { bold: true, italic: true });
  cell(doc, 40, y + 12, 92, 6, "No secure electronic signature captured", {
    italic: true,
    fontSize: 6.8,
  });
  doc.setFont("times", "italic");
  doc.setFontSize(6.1);
  doc.text(
    "A typed name and stored account decision are not an electronic signature.",
    166,
    y + 16,
    { align: "center", maxWidth: 62 }
  );
  doc.setFont("times", "bolditalic");
  doc.setFontSize(8);
  doc.text(`Form# ${input.device.form}`, 198, 289, { align: "right" });
}

function addPageNumbers(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("times", "italic");
    doc.setFontSize(7);
    doc.text(`Page ${page} of ${pageCount}`, 105, 286, { align: "center" });
  }
}

export async function downloadOfficialPdf(input: OfficialPdfInput) {
  const polarimeterSnapshot =
    input.device.key === "polarimeter"
      ? input.result.polarimeterData?.equipmentSnapshot
      : undefined;
  const device = polarimeterSnapshot
    ? {
        ...input.device,
        english: polarimeterSnapshot.instrumentName,
        id: polarimeterSnapshot.equipmentId,
        manufacturer: polarimeterSnapshot.manufacturer,
        model: polarimeterSnapshot.model,
        serial: polarimeterSnapshot.serialNumber,
        sop: polarimeterSnapshot.sopNumber,
        form: polarimeterSnapshot.formNumber,
      }
    : input.device;
  const reportInput: OfficialPdfInput = { ...input, device };
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const headerImage = await loadOfficialHeader();
  doc.setLineWidth(0.35);
  doc.rect(5, 5, 200, 287);
  doc.rect(5.8, 5.8, 198.4, 285.4);
  doc.addImage(headerImage, "PNG", 8, 8, 194, 37.7);
  const reportTitle =
    device.key === "hplc"
      ? "Flow Rate Accuracy Report"
      : device.key === "polarimeter"
        ? "Polarimeter Validation Record"
        : "Validation Record";
  doc.setFont("times", "bolditalic");
  doc.setFontSize(13);
  doc.text(reportTitle, 105, 52, { align: "center" });
  const metaY = 55;
  const columns = [35, 61, 35, 59];
  const metadata = [
    ["Instrument Name", device.english, "ID No.", device.id],
    ["Manufacturer", device.manufacturer, "SOP No.", device.sop],
    ["Serial No.", device.serial, "Model", device.model],
  ];
  metadata.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) =>
      cell(
        doc,
        10 + columns.slice(0, columnIndex).reduce((a, b) => a + b, 0),
        metaY + rowIndex * 6,
        columns[columnIndex],
        6,
        value,
        {
          bold: columnIndex % 2 === 0,
          italic: columnIndex % 2 === 1,
          fontSize: 8,
        }
      )
    )
  );
  let contentStart = metaY + 22;
  if (reportInput.recordId !== undefined) {
    const recordInfo = [
      [
        "Record ID",
        String(reportInput.recordId),
        "Lifecycle status",
        reportInput.lifecycleStatus.toUpperCase(),
      ],
    ];
    recordInfo[0].forEach((value, columnIndex) =>
      cell(
        doc,
        10 + columns.slice(0, columnIndex).reduce((a, b) => a + b, 0),
        metaY + 18,
        columns[columnIndex],
        6,
        value,
        {
          bold: columnIndex % 2 === 0,
          italic: columnIndex % 2 === 1,
          fontSize: 7.5,
        }
      )
    );
    contentStart += 6;
  }
  const endY =
    device.key === "polarimeter"
      ? polarimeterLayout(doc, reportInput, contentStart, headerImage)
      : device.key === "dissolution"
        ? dissolutionLayout(doc, reportInput.result, contentStart)
        : device.key === "hplc"
          ? hplcLayout(doc, reportInput, headerImage, contentStart)
          : genericLayout(
              doc,
              reportInput,
              contentStart,
              headerImage,
              reportTitle
            );
  if (device.key === "polarimeter" && reportInput.result.polarimeterData) {
    polarimeterLifecycleBlock(
      doc,
      Math.max(endY + 3, 65),
      reportInput,
      headerImage
    );
  } else if (endY > 255) {
    continuationPage(doc, headerImage, `${reportTitle} — Approval`);
    signatureBlock(doc, 262, reportInput);
  } else {
    signatureBlock(doc, Math.max(endY + 3, 262), reportInput);
  }
  addPageNumbers(doc);
  const filename = `${device.english.replaceAll(" ", "_")}_Validation_Record.pdf`;
  doc.save(filename);
  return filename;
}
