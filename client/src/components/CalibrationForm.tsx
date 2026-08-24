/** Design reminder: each form expresses the "دفتر المختبر الأخضر" style with local acceptance limits, calm hierarchy, and paper-like precision. */
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, Beaker, Calculator, FlaskConical, Gauge, RotateCcw, Thermometer, Waves } from "lucide-react";
import { CalibrationResult, Device, DeviceKey, ResultRow, mean, parseTime, regression, sampleStd } from "@/lib/qc";

type Props = { device: Device; config: Record<string, any>; onComplete: (result: CalibrationResult) => void };

const runLabel = "تنفيذ فحص التحقق";

const englishLabels: Record<string, string> = {
  "تنفيذ فحص التحقق": "Run validation test",
  "فحص جهاز اختبار التفكك": "Disintegration tester validation",
  "أدخل القياسات الفعلية، ثم يقارن النظام كل قراءة بحدود SOP.": "Enter the actual readings; the system compares every value against the applicable SOP limits.",
  "حرارة الحمام المائي": "Water-bath temperature",
  "حرارة وسط التفكك": "Disintegration medium temperature",
  "الوقت المسجل": "Recorded time",
  "عدد الدورات في الدقيقة": "Cycles per minute",
  "فحص جهاز قياس معامل الانكسار": "Refractometer validation",
  "يتحقق السجل من الصفر والمدى ثم يثبت الخطية عبر خمسة محاليل قياسية.": "Checks zero and span calibration, then verifies linearity through five standard liquids.",
  "محاليل التحقق القياسية": "Verification standards",
  "فحص جهاز اختبار الذوبان": "Dissolution tester validation",
  "يختبر درجة الحرارة، وسرعة التحريك، وترنح المحاور للأوعية الستة.": "Checks temperature, stirring accuracy, and shaft wobble across six vessels.",
  "حرارة الأوعية الستة": "Six vessel temperatures",
  "دقة سرعة التحريك": "Stirring-speed accuracy",
  "ترنح أعمدة السلال": "Basket shaft wobble",
  "ترنح أعمدة المجاديف": "Paddle shaft wobble",
  "فحص مضخة HPLC": "HPLC pump validation",
  "سجّل عشر قراءات عند كل معدل تدفق، وسيُحسب المتوسط والانحراف وRSD تلقائياً.": "Enter ten readings at each flow rate; mean, deviation and RSD are calculated automatically.",
  "فحص المطياف الضوئي UV-Vis": "UV-Vis spectrophotometer validation",
  "يشمل التحكم بأطوال الموجات، الامتصاصية النوعية، الضوء الشارد، وخطية الامتصاص.": "Covers wavelength control, specific absorbance, stray light and absorbance linearity.",
  "أطوال الموجات": "Wavelengths",
  "الامتصاصية المقاسة": "Measured absorbance",
  "خطية الامتصاص": "Absorbance linearity",
  "فحص جهاز قياس الرطوبة": "Moisture analyzer validation",
  "يوثق دقة الوزن والتكرارية والحمل اللامركزي وخطية الجهاز.": "Documents weight accuracy, repeatability, off-center loading and balance linearity.",
  "فحص التكرارية — 20 g": "Repeatability test — 20 g",
  "الحمل اللامركزي — 20 g": "Off-center load — 20 g",
  "اختبار الخطية": "Linearity test",
  "فحص جهاز الاستقطاب البصري": "Polarimeter validation",
  "يحسب النظام الدوران النوعي ويتحقق من التكرارية والخطية حسب التركيز.": "Calculates specific rotation and verifies repeatability and concentration linearity.",
  "قراءات التكرارية": "Repeatability readings",
  "خطية الدوران البصري": "Optical-rotation linearity",
  "فحص جهاز قياس اللزوجة الدوار": "Rotational viscometer validation",
  "تحقق من ثلاث لزوجات معيارية ثم ثبّت خطية الجهاز عبر أربعة مستويات.": "Check three viscosity standards, then establish instrument linearity across four levels.",
  "معايير اللزوجة عند 25°C": "Viscosity standards at 25°C",
  "دقائق.ثوانٍ": "Minutes.seconds",
  "النطاق المعتمد": "Approved range",
  "القراءات عند 20°C.": "Readings at 20°C.",
  "الحد المعتمد": "Approved limit",
  "قراءة واحدة لكل معدل معتمد.": "One reading at each approved rate.",
  "الحدود تعرض في نتائج الفحص.": "Limits are shown in the validation results.",
  "10 عينات متتالية": "10 consecutive samples",
  "عشر قراءات فعلية بالنانومتر.": "Ten actual readings in nanometres.",
  "محلول Potassium Dichromate 0.006 g/100 ml.": "Potassium Dichromate solution 0.006 g/100 ml.",
  "التركيزات: 20، 40، 60، 80، 100 ppm": "Concentrations: 20, 40, 60, 80, 100 ppm",
  "الأوزان النظرية: 0، 5، 10، 20، 30 g": "Nominal weights: 0, 5, 10, 20, 30 g",
  "ست قراءات متتابعة لعينة 20% w/v.": "Six consecutive readings for the 20% w/v sample.",
  "التركيزات: 10، 20، 30، 40% w/v": "Concentrations: 10, 20, 30, 40% w/v",
  "المغزل والسرعة موثقان في حد القبول.": "Spindle and speed are documented in the acceptance limit.",
  "مستويات اللزوجة: 50، 1,000، 5,000، 12,500 cP": "Viscosity levels: 50, 1,000, 5,000, 12,500 cP",
  "قراءة الماء المقطر — Zero": "Distilled-water reading — Zero",
  "قراءة زيت المعايرة — Span": "Calibration-oil reading — Span",
  "حرارة الحمام المائي الفعلية": "Actual water-bath temperature",
  "قراءة كفاءة الطول الموجي": "Wavelength efficiency reading",
  "امتصاصية الضوء الشارد": "Stray-light absorbance",
  "وزن المعايرة المقاس — Span": "Measured calibration weight — Span",
  "الدوران البصري المقاس": "Measured optical rotation",
  "طول الأنبوب": "Tube length",
  "تركيز المحلول": "Solution concentration",
};

function uiText(value: string) {
  if (typeof document === "undefined" || document.documentElement.lang !== "en") return value;
  if (englishLabels[value]) return englishLabels[value];
  const trial = value.match(/^المحاولة (\d+)$/); if (trial) return `Attempt ${trial[1]}`;
  const vessel = value.match(/^وعاء (\d+)$/); if (vessel) return `Vessel ${vessel[1]}`;
  const basket = value.match(/^سلة (\d+)$/); if (basket) return `Basket ${basket[1]}`;
  const paddle = value.match(/^مجداف (\d+)$/); if (paddle) return `Paddle ${paddle[1]}`;
  const sample = value.match(/^ع(\d+)$/); if (sample) return `Sample ${sample[1]}`;
  const reading = value.match(/^قراءة (\d+)$/); if (reading) return `Reading ${reading[1]}`;
  const position = value.match(/^موضع (\d+)$/); if (position) return `Position ${position[1]}`;
  return value;
}

function translateInlineText(value: string) {
  if (typeof document === "undefined" || document.documentElement.lang !== "en") return value;
  let translated = value;
  Object.entries(englishLabels).sort(([first], [second]) => second.length - first.length).forEach(([arabic, english]) => { translated = translated.replaceAll(arabic, english); });
  return translated
    .replace(/المحاولة\s*(\d+)/g, "Attempt $1")
    .replace(/وعاء\s*(\d+)/g, "Vessel $1")
    .replace(/سلة\s*(\d+)/g, "Basket $1")
    .replace(/مجداف\s*(\d+)/g, "Paddle $1")
    .replace(/قراءة\s*(\d+)/g, "Reading $1")
    .replace(/موضع\s*(\d+)/g, "Position $1")
    .replace(/ع(\d+)/g, "Sample $1");
}

function NumberField({ label, value, onChange, step = 0.1, compact = false, hint }: { label: string; value: number; onChange: (value: number) => void; step?: number; compact?: boolean; hint?: string }) {
  return <label className={compact ? "field field-compact" : "field"}><span>{uiText(label)}</span>{hint && <small>{hint}</small>}<input type="number" inputMode="decimal" value={Number.isFinite(value) ? value : 0} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function FormHeader({ icon: Icon, title, description }: { icon: typeof Beaker; title: string; description: string }) {
  return <header className="form-header"><div className="form-icon"><Icon size={22} /></div><div><span className="eyebrow">{typeof document !== "undefined" && document.documentElement.lang === "en" ? "ACTUAL READINGS" : "قراءات فعلية"}</span><h2>{uiText(title)}</h2><p>{uiText(description)}</p></div></header>;
}

function Submit({ onClick }: { onClick: () => void }) {
  return <button type="button" className="run-button" onClick={onClick}><Calculator size={18} /> {uiText(runLabel)}<ArrowLeft size={16} /></button>;
}

function makeResult(deviceKey: DeviceKey, rows: ResultRow[], metrics: CalibrationResult["metrics"], chart?: CalibrationResult["chart"], chartTitle?: string, note?: string, reportCharts?: CalibrationResult["reportCharts"]): CalibrationResult {
  return { deviceKey, rows, metrics, chart, chartTitle, note, reportCharts, overall: rows.every((row) => row.pass), createdAt: new Date().toISOString() };
}

function Disintegration({ config, onComplete }: Omit<Props, "device">) {
  const [bath, setBath] = useState(37.5); const [medium, setMedium] = useState(37.3); const [time, setTime] = useState("4.00"); const [cycles, setCycles] = useState([31, 30, 29.9]);
  const run = () => {
    const seconds = parseTime(time); const cycleRows = cycles.map((value, index) => ({ test: `سرعة الدورات — المحاولة ${index + 1}`, expected: `${config.cycleMin}–${config.cycleMax} rpm`, actual: `${value.toFixed(1)} rpm`, pass: value >= config.cycleMin && value <= config.cycleMax }));
    const rows: ResultRow[] = [{ test: "حرارة الحمام المائي", expected: `${config.bathSet} ± ${config.bathTolerance} °C`, actual: `${bath.toFixed(1)} °C`, pass: Math.abs(bath - config.bathSet) <= config.bathTolerance }, { test: "حرارة وسط التفكك", expected: `${config.mediumMin}–${config.mediumMax} °C`, actual: `${medium.toFixed(1)} °C`, pass: medium >= config.mediumMin && medium <= config.mediumMax }, { test: "دقة التوقيت", expected: "03:59–04:01", actual: time, pass: seconds >= config.timeMin && seconds <= config.timeMax }, ...cycleRows];
    onComplete(makeResult("disintegration", rows, [{ label: "متوسط الدورات", value: `${mean(cycles).toFixed(2)} rpm`, tone: "neutral" }, { label: "حد القبول", value: `${config.cycleMin}–${config.cycleMax} rpm`, tone: "neutral" }], cycles.map((value, index) => ({ label: `#${index + 1}`, value, reference: config.bathSet - 8 })), "استقرار عدد الدورات في الدقيقة"));
  };
  return <div className="form-stack"><FormHeader icon={RotateCcw} title="فحص جهاز اختبار التفكك" description="أدخل القياسات الفعلية، ثم يقارن النظام كل قراءة بحدود SOP." /><div className="field-grid three"><NumberField label="حرارة الحمام المائي" value={bath} onChange={setBath} hint="°C" /><NumberField label="حرارة وسط التفكك" value={medium} onChange={setMedium} hint="°C" /><label className="field"><span>الوقت المسجل</span><small>دقائق.ثوانٍ</small><input value={time} onChange={(event) => setTime(event.target.value)} /></label></div><section className="measure-group"><div className="group-title"><RotateCcw size={17} /><div><h3>عدد الدورات في الدقيقة</h3><p>النطاق المعتمد: {config.cycleMin}–{config.cycleMax} rpm</p></div></div><div className="field-grid three">{cycles.map((value, index) => <NumberField key={index} label={`المحاولة ${index + 1}`} value={value} onChange={(next) => setCycles(cycles.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><Submit onClick={run} /></div>;
}

function Refractometer({ config, onComplete }: Omit<Props, "device">) {
  const [zero, setZero] = useState(1.33298); const [span, setSpan] = useState(1.51819); const [values, setValues] = useState<number[]>(config.standards.map((standard: any) => standard.nominal));
  const run = () => { const line = regression(config.standards.map((standard: any) => standard.nominal), values); const rows: ResultRow[] = [{ test: "معايرة الصفر — الماء المقطر", expected: `${config.zeroMin}–${config.zeroMax}`, actual: zero.toFixed(5), pass: zero >= config.zeroMin && zero <= config.zeroMax }, { test: "معايرة المدى — زيت المعايرة", expected: `${config.spanMin}–${config.spanMax}`, actual: span.toFixed(5), pass: span >= config.spanMin && span <= config.spanMax }, ...config.standards.map((standard: any, index: number) => ({ test: `تحقق: ${standard.name}`, expected: `${standard.min}–${standard.max}`, actual: values[index].toFixed(4), pass: values[index] >= standard.min && values[index] <= standard.max })), { test: "معامل ارتباط الخطية R", expected: `≥ ${config.rLimit}`, actual: line.r.toFixed(6), pass: line.r >= config.rLimit }]; onComplete(makeResult("refractometer", rows, [{ label: "معامل R", value: line.r.toFixed(7), tone: line.r >= config.rLimit ? "success" : "warning" }, { label: "الميل", value: line.slope.toFixed(6), tone: "neutral" }, { label: "نقطة التقاطع", value: line.intercept.toFixed(6), tone: "neutral" }], values.map((value, index) => ({ label: String(index + 1), value, reference: config.standards[index].nominal })), "خطية معامل الانكسار", "تمت مقارنة نقطة الصفر والمدى وخمسة محاليل قياسية.")); };
  return <div className="form-stack"><FormHeader icon={Waves} title="فحص جهاز قياس معامل الانكسار" description="يتحقق السجل من الصفر والمدى ثم يثبت الخطية عبر خمسة محاليل قياسية." /><div className="field-grid two"><NumberField label="قراءة الماء المقطر — Zero" value={zero} onChange={setZero} step={0.00001} /><NumberField label="قراءة زيت المعايرة — Span" value={span} onChange={setSpan} step={0.00001} /></div><section className="measure-group"><div className="group-title"><FlaskConical size={17} /><div><h3>محاليل التحقق القياسية</h3><p>القراءات عند 20°C.</p></div></div><div className="field-grid five">{config.standards.map((standard: any, index: number) => <NumberField key={standard.name} compact label={standard.name} value={values[index]} onChange={(next) => setValues(values.map((item, itemIndex) => itemIndex === index ? next : item))} step={0.0001} />)}</div></section><Submit onClick={run} /></div>;
}

function Dissolution({ config, onComplete }: Omit<Props, "device">) {
  const [bath, setBath] = useState(37.9); const [vessels, setVessels] = useState([37.2, 37.1, 37.2, 37.3, 37.2, 37.1]); const [speeds, setSpeeds] = useState<number[]>(config.speeds.map((test: any) => test.nominal)); const [basket, setBasket] = useState([0.04, 0.03, 0.02, 0.04, 0.03, 0.03]); const [paddle, setPaddle] = useState([0.04, 0.02, 0.04, 0.03, 0.04, 0.02]);
  const run = () => { const rows: ResultRow[] = [{ test: "حرارة الحمام المائي", expected: `${config.bathSet} ± ${config.bathTolerance} °C`, actual: `${bath.toFixed(1)} °C`, pass: Math.abs(bath - config.bathSet) <= config.bathTolerance }, ...vessels.map((value, index) => ({ test: `حرارة الوعاء ${index + 1}`, expected: `${config.vesselMin}–${config.vesselMax} °C`, actual: `${value.toFixed(1)} °C`, pass: value >= config.vesselMin && value <= config.vesselMax })), ...speeds.map((value, index) => ({ test: `سرعة التحريك ${config.speeds[index].nominal} rpm`, expected: `${config.speeds[index].min}–${config.speeds[index].max} rpm`, actual: `${value.toFixed(1)} rpm`, pass: value >= config.speeds[index].min && value <= config.speeds[index].max })), ...basket.map((value, index) => ({ test: `ترنح عمود السلة ${index + 1}`, expected: `≤ ${config.wobbleMax} mm`, actual: `${value.toFixed(2)} mm`, pass: value <= config.wobbleMax })), ...paddle.map((value, index) => ({ test: `ترنح عمود المجداف ${index + 1}`, expected: `≤ ${config.wobbleMax} mm`, actual: `${value.toFixed(2)} mm`, pass: value <= config.wobbleMax }))]; onComplete(makeResult("dissolution", rows, [{ label: "متوسط حرارة الأوعية", value: `${mean(vessels).toFixed(2)} °C`, tone: "neutral" }, { label: "أعلى ترنح", value: `${Math.max(...basket, ...paddle).toFixed(2)} mm`, tone: "neutral" }], vessels.map((value, index) => ({ label: `و${index + 1}`, value, reference: 37 })), "توزيع حرارة الأوعية")); };
  return <div className="form-stack"><FormHeader icon={Thermometer} title="فحص جهاز اختبار الذوبان" description="يختبر درجة الحرارة، وسرعة التحريك، وترنح المحاور للأوعية الستة." /><div className="field-grid one"><NumberField label="حرارة الحمام المائي الفعلية" value={bath} onChange={setBath} /></div><section className="measure-group"><div className="group-title"><Thermometer size={17} /><div><h3>حرارة الأوعية الستة</h3><p>الحد المعتمد: {config.vesselMin}–{config.vesselMax} °C</p></div></div><div className="field-grid six">{vessels.map((value, index) => <NumberField compact key={index} label={`وعاء ${index + 1}`} value={value} onChange={(next) => setVessels(vessels.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><section className="measure-group"><div className="group-title"><Gauge size={17} /><div><h3>دقة سرعة التحريك</h3><p>قراءة واحدة لكل معدل معتمد.</p></div></div><div className="field-grid five">{speeds.map((value, index) => <NumberField compact key={index} label={`${config.speeds[index].nominal} rpm`} value={value} onChange={(next) => setSpeeds(speeds.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><section className="split-measure"><ArrayInputs title="ترنح أعمدة السلال" values={basket} setValues={setBasket} prefix="سلة" step={0.01} /><ArrayInputs title="ترنح أعمدة المجاديف" values={paddle} setValues={setPaddle} prefix="مجداف" step={0.01} /></section><Submit onClick={run} /></div>;
}

function ArrayInputs({ title, values, setValues, prefix, step = 0.1 }: { title: string; values: number[]; setValues: (values: number[]) => void; prefix: string; step?: number }) { return <section className="measure-group"><div className="group-title"><Activity size={17} /><div><h3>{title}</h3><p>الحدود تعرض في نتائج الفحص.</p></div></div><div className="field-grid six">{values.map((value, index) => <NumberField compact key={index} label={`${prefix} ${index + 1}`} value={value} step={step} onChange={(next) => setValues(values.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section>; }

function Hplc({ config, onComplete }: Omit<Props, "device">) {
  const [sets, setSets] = useState<number[][]>([[0.994, 0.993, 0.995, 0.993, 0.992, 0.992, 0.99, 0.99, 0.991, 0.991], [1.488, 1.487, 1.487, 1.486, 1.487, 1.485, 1.486, 1.486, 1.485, 1.486], [1.987, 1.984, 1.984, 1.984, 1.984, 1.984, 1.985, 1.987, 1.984, 1.984]]);
  const run = () => { const stats = sets.map((values, index) => { const average = mean(values); const deviation = Math.abs(average - config.flows[index].nominal) / config.flows[index].nominal * 100; const rsd = sampleStd(values) / average * 100; const pass = average >= config.flows[index].min && average <= config.flows[index].max && deviation <= config.devLimit && rsd <= config.rsdLimit; return { average, deviation, rsd, pass }; }); const rows = stats.map((stat, index) => ({ test: `معدل تدفق ${config.flows[index].nominal.toFixed(3)} ml/min`, expected: `${config.flows[index].min}–${config.flows[index].max} | Dev ≤ ${config.devLimit}% | RSD ≤ ${config.rsdLimit}%`, actual: `المتوسط ${stat.average.toFixed(3)} | Dev ${stat.deviation.toFixed(3)}% | RSD ${stat.rsd.toFixed(3)}%`, pass: stat.pass })); const reportCharts = sets.map((values, index) => ({ title: `Set Flow ${config.flows[index].nominal.toFixed(3)} ml/min`, xLabel: "Sample", yLabel: "Flow Rate", data: values.map((value, sampleIndex) => ({ label: String(sampleIndex + 1), value, reference: config.flows[index].nominal })) })); onComplete(makeResult("hplc", rows, stats.map((stat, index) => ({ label: `متوسط ${config.flows[index].nominal.toFixed(1)}`, value: `${stat.average.toFixed(3)} ml/min`, tone: stat.pass ? "success" : "warning" })), stats.map((stat, index) => ({ label: `${config.flows[index].nominal.toFixed(1)}`, value: stat.average, reference: config.flows[index].nominal })), "دقة معدل التدفق", undefined, reportCharts)); };
  return <div className="form-stack"><FormHeader icon={Gauge} title="فحص مضخة HPLC" description="سجّل عشر قراءات عند كل معدل تدفق، وسيُحسب المتوسط والانحراف وRSD تلقائياً." /><div className="hplc-columns">{sets.map((values, setIndex) => <section className="measure-group" key={setIndex}><div className="group-title"><Gauge size={17} /><div><h3>{config.flows[setIndex].nominal.toFixed(3)} ml/min</h3><p>10 عينات متتالية</p></div></div><div className="sample-grid">{values.map((value, index) => <NumberField compact key={index} label={`ع${index + 1}`} value={value} step={0.001} onChange={(next) => setSets(sets.map((set, outerIndex) => outerIndex === setIndex ? set.map((item, innerIndex) => innerIndex === index ? next : item) : set))} />)}</div></section>)}</div><Submit onClick={run} /></div>;
}

function Spectrophotometer({ config, onComplete }: Omit<Props, "device">) {
  const [waves, setWaves] = useState<number[]>(config.wavelengths.map((w: any) => w.nominal)); const [absorbance, setAbsorbance] = useState([0.748, 0.8656, 0.2903, 0.6397]); const [accuracy, setAccuracy] = useState(656.1); const [stray, setStray] = useState(2.775); const [linearity, setLinearity] = useState([0.201, 0.405, 0.598, 0.801, 0.999]);
  const run = () => { const calculated = absorbance.map((value) => value / 0.006 * 1000); const line = regression([20, 40, 60, 80, 100], linearity); const rows: ResultRow[] = [...waves.map((value, index) => ({ test: `دقة طول موجة ${config.wavelengths[index].nominal} nm`, expected: `${config.wavelengths[index].min}–${config.wavelengths[index].max} nm`, actual: `${value.toFixed(1)} nm`, pass: value >= config.wavelengths[index].min && value <= config.wavelengths[index].max })), ...calculated.map((value, index) => ({ test: `الامتصاصية النوعية عند ${config.absorbance[index].wave} nm`, expected: `${config.absorbance[index].min}–${config.absorbance[index].max}`, actual: value.toFixed(2), pass: value >= config.absorbance[index].min && value <= config.absorbance[index].max })), { test: "دقة طول الموجة 656.1 nm", expected: `${config.wavelengthAccuracy} ± ${config.wavelengthTolerance} nm`, actual: `${accuracy.toFixed(1)} nm`, pass: Math.abs(accuracy - config.wavelengthAccuracy) <= config.wavelengthTolerance }, { test: "اختبار الضوء الشارد", expected: `≥ ${config.strayMin}`, actual: stray.toFixed(4), pass: stray >= config.strayMin }, { test: "معامل ارتباط الخطية R", expected: `≥ ${config.rLimit}`, actual: line.r.toFixed(6), pass: line.r >= config.rLimit }]; onComplete(makeResult("spectrophotometer", rows, [{ label: "معامل R", value: line.r.toFixed(7), tone: line.r >= config.rLimit ? "success" : "warning" }, { label: "الضوء الشارد", value: stray.toFixed(4), tone: "neutral" }], linearity.map((value, index) => ({ label: String((index + 1) * 20), value, reference: (index + 1) / 5 })), "خطية الامتصاص مقابل التركيز")); };
  return <div className="form-stack"><FormHeader icon={Waves} title="فحص المطياف الضوئي UV-Vis" description="يشمل التحكم بأطوال الموجات، الامتصاصية النوعية، الضوء الشارد، وخطية الامتصاص." /><section className="measure-group"><div className="group-title"><Waves size={17} /><div><h3>أطوال الموجات</h3><p>عشر قراءات فعلية بالنانومتر.</p></div></div><div className="field-grid five">{waves.map((value, index) => <NumberField compact key={index} label={`${config.wavelengths[index].nominal} nm`} value={value} onChange={(next) => setWaves(waves.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><section className="measure-group"><div className="group-title"><Beaker size={17} /><div><h3>الامتصاصية المقاسة</h3><p>محلول Potassium Dichromate 0.006 g/100 ml.</p></div></div><div className="field-grid four">{absorbance.map((value, index) => <NumberField compact key={index} label={`${config.absorbance[index].wave} nm`} value={value} step={0.0001} onChange={(next) => setAbsorbance(absorbance.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><div className="field-grid two"><NumberField label="قراءة كفاءة الطول الموجي" value={accuracy} onChange={setAccuracy} /><NumberField label="امتصاصية الضوء الشارد" value={stray} onChange={setStray} step={0.0001} /></div><section className="measure-group"><div className="group-title"><Activity size={17} /><div><h3>خطية الامتصاص</h3><p>التركيزات: 20، 40، 60، 80، 100 ppm</p></div></div><div className="field-grid five">{linearity.map((value, index) => <NumberField compact key={index} label={`${(index + 1) * 20} ppm`} value={value} step={0.001} onChange={(next) => setLinearity(linearity.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><Submit onClick={run} /></div>;
}

function Moisture({ config, onComplete }: Omit<Props, "device">) {
  const [span, setSpan] = useState(30); const [repeat, setRepeat] = useState([20, 20, 20, 20, 20, 20]); const [offcenter, setOffcenter] = useState([20, 20, 19.999, 19.999, 20.001, 20, 20]); const [linearity, setLinearity] = useState([0, 5, 10, 20, 30]);
  const run = () => { const line = regression([0, 5, 10, 20, 30], linearity); const positions = ["المركز", "مركز 1", "ركن 1", "ركن 2", "ركن 3", "ركن 4", "مركز 2"]; const rows: ResultRow[] = [{ test: "معايرة Span", expected: `${config.spanWeight} ± ${config.spanTolerance} g`, actual: `${span.toFixed(3)} g`, pass: Math.abs(span - config.spanWeight) <= config.spanTolerance }, ...repeat.map((value, index) => ({ test: `التكرارية — قراءة ${index + 1}`, expected: `${config.reproducibilityWeight} ± ${config.reproducibilityTolerance} g`, actual: `${value.toFixed(3)} g`, pass: Math.abs(value - config.reproducibilityWeight) <= config.reproducibilityTolerance })), ...offcenter.map((value, index) => ({ test: `الحمل اللامركزي — ${positions[index]}`, expected: `${config.offCenterWeight} ± ${config.offCenterTolerance} g`, actual: `${value.toFixed(3)} g`, pass: Math.abs(value - config.offCenterWeight) <= config.offCenterTolerance })), { test: "معامل ارتباط الخطية R", expected: `≥ ${config.rLimit}`, actual: line.r.toFixed(6), pass: line.r >= config.rLimit }]; onComplete(makeResult("moisture", rows, [{ label: "معامل R", value: line.r.toFixed(7), tone: line.r >= config.rLimit ? "success" : "warning" }, { label: "انحراف Span", value: `${Math.abs(span - config.spanWeight).toFixed(3)} g`, tone: "neutral" }], linearity.map((value, index) => ({ label: [0, 5, 10, 20, 30][index].toString(), value, reference: [0, 5, 10, 20, 30][index] })), "خطية الوزن")); };
  return <div className="form-stack"><FormHeader icon={Gauge} title="فحص جهاز قياس الرطوبة" description="يوثق دقة الوزن والتكرارية والحمل اللامركزي وخطية الجهاز." /><div className="field-grid one"><NumberField label="وزن المعايرة المقاس — Span" value={span} step={0.001} onChange={setSpan} /></div><div className="split-measure"><ArrayInputs title="فحص التكرارية — 20 g" values={repeat} setValues={setRepeat} prefix="قراءة" step={0.001} /><ArrayInputs title="الحمل اللامركزي — 20 g" values={offcenter} setValues={setOffcenter} prefix="موضع" step={0.001} /></div><section className="measure-group"><div className="group-title"><Activity size={17} /><div><h3>اختبار الخطية</h3><p>الأوزان النظرية: 0، 5، 10، 20، 30 g</p></div></div><div className="field-grid five">{linearity.map((value, index) => <NumberField compact key={index} label={`${[0, 5, 10, 20, 30][index]} g`} value={value} step={0.001} onChange={(next) => setLinearity(linearity.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><Submit onClick={run} /></div>;
}

function Polarimeter({ config, onComplete }: Omit<Props, "device">) {
  const [rotation, setRotation] = useState(26.74); const [length, setLength] = useState(config.tubeLength); const [concentration, setConcentration] = useState(20.0204); const [repeat, setRepeat] = useState([26.74, 26.76, 26.74, 26.74, 26.75, 26.74]); const [linearity, setLinearity] = useState([13.37, 26.74, 40.11, 53.48]);
  const run = () => { const specific = length * concentration ? 100 * rotation / (length * concentration) : 0; const line = regression([10, 20, 30, 40], linearity); const rows: ResultRow[] = [{ test: "الدوران البصري النوعي", expected: `${config.specificMin}–${config.specificMax}°`, actual: `${specific.toFixed(4)}°`, pass: specific >= config.specificMin && specific <= config.specificMax }, ...repeat.map((value, index) => ({ test: `التكرارية — قراءة ${index + 1}`, expected: `± ${config.repeatTolerance}° من القراءة الأولى`, actual: `${value.toFixed(2)}°`, pass: Math.abs(value - repeat[0]) <= config.repeatTolerance })), { test: "معامل ارتباط الخطية R", expected: `≥ ${config.rLimit}`, actual: line.r.toFixed(6), pass: line.r >= config.rLimit }]; onComplete(makeResult("polarimeter", rows, [{ label: "الدوران النوعي", value: `${specific.toFixed(3)}°`, tone: specific >= config.specificMin && specific <= config.specificMax ? "success" : "warning" }, { label: "معامل R", value: line.r.toFixed(7), tone: "neutral" }], linearity.map((value, index) => ({ label: String((index + 1) * 10), value, reference: (index + 1) * 13.37 })), "خطية الدوران البصري")); };
  return <div className="form-stack"><FormHeader icon={RotateCcw} title="فحص جهاز الاستقطاب البصري" description="يحسب النظام الدوران النوعي ويتحقق من التكرارية والخطية حسب التركيز." /><div className="field-grid three"><NumberField label="الدوران البصري المقاس" value={rotation} step={0.01} onChange={setRotation} /><NumberField label="طول الأنبوب" value={length} step={0.1} onChange={setLength} hint="dm" /><NumberField label="تركيز المحلول" value={concentration} step={0.0001} onChange={setConcentration} hint="g/100 ml" /></div><section className="measure-group"><div className="group-title"><RotateCcw size={17} /><div><h3>قراءات التكرارية</h3><p>ست قراءات متتابعة لعينة 20% w/v.</p></div></div><div className="field-grid six">{repeat.map((value, index) => <NumberField compact key={index} label={`قراءة ${index + 1}`} value={value} step={0.01} onChange={(next) => setRepeat(repeat.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><section className="measure-group"><div className="group-title"><Activity size={17} /><div><h3>خطية الدوران البصري</h3><p>التركيزات: 10، 20، 30، 40% w/v</p></div></div><div className="field-grid four">{linearity.map((value, index) => <NumberField compact key={index} label={`${(index + 1) * 10}%`} value={value} step={0.01} onChange={(next) => setLinearity(linearity.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><Submit onClick={run} /></div>;
}

function Viscometer({ config, onComplete }: Omit<Props, "device">) {
  const [values, setValues] = useState([49, 1009, 12150]); const [linearity, setLinearity] = useState([49, 1009, 5130, 12150]);
  const run = () => { const line = regression([50, 1000, 5000, 12500], linearity); const rows: ResultRow[] = [...config.standards.map((standard: any, index: number) => ({ test: `لزوجة قياسية ${standard.nominal} cP`, expected: `${standard.min}–${standard.max} cP | ${standard.spindle}/${standard.speed} rpm`, actual: `${values[index].toFixed(1)} cP`, pass: values[index] >= standard.min && values[index] <= standard.max })), { test: "معامل ارتباط الخطية R", expected: `≥ ${config.rLimit}`, actual: line.r.toFixed(6), pass: line.r >= config.rLimit }]; onComplete(makeResult("viscometer", rows, [{ label: "معامل R", value: line.r.toFixed(7), tone: line.r >= config.rLimit ? "success" : "warning" }, { label: "الميل", value: line.slope.toFixed(4), tone: "neutral" }], linearity.map((value, index) => ({ label: [50, 1000, 5000, 12500][index].toString(), value, reference: [50, 1000, 5000, 12500][index] })), "خطية اللزوجة")); };
  return <div className="form-stack"><FormHeader icon={FlaskConical} title="فحص جهاز قياس اللزوجة الدوار" description="تحقق من ثلاث لزوجات معيارية ثم ثبّت خطية الجهاز عبر أربعة مستويات." /><section className="measure-group"><div className="group-title"><FlaskConical size={17} /><div><h3>معايير اللزوجة عند 25°C</h3><p>المغزل والسرعة موثقان في حد القبول.</p></div></div><div className="field-grid three">{values.map((value, index) => <NumberField key={index} label={`${config.standards[index].nominal} cP`} value={value} step={0.1} onChange={(next) => setValues(values.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><section className="measure-group"><div className="group-title"><Activity size={17} /><div><h3>اختبار الخطية</h3><p>مستويات اللزوجة: 50، 1,000، 5,000، 12,500 cP</p></div></div><div className="field-grid four">{linearity.map((value, index) => <NumberField compact key={index} label={`${[50, 1000, 5000, 12500][index]} cP`} value={value} step={0.1} onChange={(next) => setLinearity(linearity.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div></section><Submit onClick={run} /></div>;
}

export function CalibrationForm({ device, config, onComplete }: Props) {
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = formRef.current;
    if (!root || document.documentElement.lang !== "en") return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node = walker.nextNode();
    while (node) { nodes.push(node as Text); node = walker.nextNode(); }
    nodes.forEach((textNode) => { textNode.nodeValue = translateInlineText(textNode.nodeValue ?? ""); });
  });
  const props = { config, onComplete };
  const form = device.key === "disintegration" ? <Disintegration {...props} /> : device.key === "refractometer" ? <Refractometer {...props} /> : device.key === "dissolution" ? <Dissolution {...props} /> : device.key === "hplc" ? <Hplc {...props} /> : device.key === "spectrophotometer" ? <Spectrophotometer {...props} /> : device.key === "moisture" ? <Moisture {...props} /> : device.key === "polarimeter" ? <Polarimeter {...props} /> : <Viscometer {...props} />;
  return <div ref={formRef}>{form}</div>;
}
