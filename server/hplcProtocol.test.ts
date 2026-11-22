/**
 * HPLC Calibration Protocol – Shimadzu LC 2030 PLUS (source: HPLC.pdf, Laboratory Calibration Reference).
 *
 *  1. Content: exactly 10 tests, stable keys, page references on every test / criterion, review notes A–G.
 *  2. Every test checked against INDEPENDENT arithmetic written in this file (not the engine's helpers),
 *     including boundaries, invalid input, missing data, ties and graphs.
 *  3. Real SQLite store: automatic idempotent registration (Draft, linked to QC-I-104, no duplicates),
 *     never auto-approved; QM approval → New Validation → stored immutable record → PDF (A tables, B graphs).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { closeLocalDatabase, createLocalUser } from "./localDb";
import * as svc from "./protocols/service";
import * as val from "./protocols/validationService";
import * as seed from "./protocols/hplcSeed";
import * as wf from "./protocols/workflowService";
import { sqliteProtocolStore } from "./protocols/sqliteStore";
import { evaluateExecution, type Measurements, type TestEvaluation } from "../shared/protocols/evaluate";
import { HPLC_PREVIOUS_SEED_VERSIONS, HPLC_PROTOCOL_NUMBER, HPLC_SEED_VERSION, HPLC_TEST_KEYS, HPLC_TEST_NAMES, hplcProtocolContent } from "../shared/protocols/hplcLc2030";
import { structuralIssues } from "../shared/protocols/validation";
import type { ProtocolContent } from "../shared/protocols/model";
import { buildValidationPdf } from "../client/src/components/protocols/validationPdf";

/* ---------------- independent arithmetic (deliberately not the engine's) ---------------- */
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const avg = (a: number[]) => sum(a) / a.length;
const sdev = (a: number[]) => Math.sqrt(sum(a.map(v => (v - avg(a)) ** 2)) / (a.length - 1));
function ols(x: number[], y: number[]) {
  const mx = avg(x), my = avg(y);
  const sxy = sum(x.map((v, i) => (v - mx) * (y[i] - my)));
  const sxx = sum(x.map(v => (v - mx) ** 2));
  const syy = sum(y.map(v => (v - my) ** 2));
  const m = sxy / sxx;
  const b = my - m * mx;
  const r = sxy / Math.sqrt(sxx * syy);
  const pred = x.map(v => m * v + b);
  const ssRes = sum(y.map((v, i) => (v - pred[i]) ** 2));
  return { m, b, r, r2: 1 - ssRes / syy, pred, resid: y.map((v, i) => v - pred[i]) };
}

const content: ProtocolContent = hplcProtocolContent({
  referenceId: "ref-hplc",
  equipment: { instrumentKey: "hplc", instrumentId: "QC-I-104", serialNumber: "L22146101115 AE", manufacturer: "Shimadzu Corporation (Japan)", model: "LC-40B XR" },
  equipmentDescription: "test",
});
const tests = content.sections.flatMap(s => s.tests);
const evalOne = (key: string, m: Measurements[string]): TestEvaluation => evaluateExecution(content, { [key]: m }).tests.find(t => t.testKey === key)!;
const calc = (r: TestEvaluation, key: string, level: string | null = null) => r.calculations.find(c => c.key === key && c.levelKey === level)!;

/* Example readings (synthetic — NOT the historical 2022 values). */
const READ = {
  flow: { F1: [10.05], F2: [6.68], F3: [4.98] },
  oven: { T25: [25.3, 25.1], T40: [40.4, 40.0], T50: [49.6, 50.1], T60: [60.9, 60.2] },
  prec: { rt: [5.112, 5.118, 5.109, 5.121, 5.115], area: [251234, 252010, 250876, 251880, 251502] },
  wl: [210, 225, 240, 252, 260, 266, 263, 255, 244, 230, 212],
  det: [101250, 202480, 304020, 404900, 507300],
  auto: [25210, 50380, 100950, 252400, 403100, 504700],
  gpv: { AB10: [1000, 2015, 11050], AB50: [1000, 6080, 11050], AB90: [1000, 10010, 11050], AC10: [990, 1980, 10995], AC50: [990, 6010, 10995], AC90: [990, 9990, 10995], AD10: [1005, 2010, 11020], AD50: [1005, 6020, 11020], AD90: [1005, 10050, 11020] },
};
const FULL: Measurements = {
  hplc_flow_rate: { levels: READ.flow },
  hplc_lamp_energy: { fields: { energy: 1517 } },
  hplc_uv_lamp_hours: { fields: { lamp_hours: 763 } },
  hplc_column_oven: { levels: READ.oven },
  hplc_precision: { levels: Object.fromEntries(READ.prec.rt.map((rt, i) => [`INJ${i + 1}`, [rt, READ.prec.area[i]]])) },
  hplc_wavelength: { levels: Object.fromEntries(READ.wl.map((a, i) => [`W${267 + i}`, [a]])) },
  hplc_detector_linearity: { levels: Object.fromEntries(READ.det.map((a, i) => [`C${(i + 1) * 10}`, [a]])) },
  hplc_autosampler_linearity: { levels: Object.fromEntries([5, 10, 20, 50, 80, 100].map((v, i) => [`V${v}`, [READ.auto[i]]])) },
  hplc_carryover: { fields: { blank_area: 406, carry_area: 165725685 } },
  hplc_gpv: { levels: READ.gpv },
};

describe("HPLC protocol content (HPLC.pdf)", () => {
  it("has exactly the 10 source tests with stable keys, page references and no USP system-suitability extras", () => {
    expect(tests.map(t => t.key)).toEqual([...HPLC_TEST_KEYS]);
    expect(tests.map(t => t.name)).toEqual([...HPLC_TEST_NAMES]);
    expect(content.identification).toMatchObject({ title: "HPLC Calibration Protocol – Shimadzu LC 2030 PLUS", number: HPLC_PROTOCOL_NUMBER, category: "HPLC" });
    expect(content.identification.description).toMatch(/Draft – Pending Quality Manager Approval/);
    expect(content.identification.description).toMatch(/Laboratory Calibration Reference/);
    // no USP system-suitability tests (the source is not a USP document; "USP" only appears in the "not a USP requirement" notice)
    const withoutEvidence = tests.map(t => ({ ...t, criteria: t.criteria.map(c => ({ ...c, verificationEvidence: "", conflictNote: "" })) }));
    // the only USP mention is the documented gap: the supplied USP extracts give no GPV limit
    expect(JSON.stringify(tests).match(/USP <\d+>[^"]*/g)!.every(m => /NOT SPECIFIED IN SUPPLIED USP SOURCE|specify no GPV limit/.test(m))).toBe(true);
    expect(JSON.stringify(withoutEvidence)).not.toMatch(/USP|system suitability|tailing|plate count|theoretical plates/i);
    tests.forEach(t => {
      expect(t.referenceClause, t.key).toMatch(/HPLC\.pdf p\.\d/);
      expect(t.referenceIds).toEqual(["ref-hplc"]);
      t.criteria.forEach(c => {
        expect(c.referenceId).toBe("ref-hplc");
        expect(c.referenceClause, `${t.key}/${c.key}`).toMatch(/p\.\d/);
        expect(c.sourceClass).toBe("laboratory-calibration-reference");
      });
    });
    expect(structuralIssues(content).filter(i => i.severity === "error")).toEqual([]);
  });

  it("preserves the source discrepancies as review notes; flow (note A) and GPV (note C) resolved by user decision — nothing pending", () => {
    expect(content.gaps.map(g => g.key)).toEqual(["noteA_flow_setpoints", "noteB_linearity_wording", "noteC_gpv_interpretation", "noteD_lamp_hours", "noteE_equipment_identity", "noteF_lamp_wavelength", "noteG_handwritten_details"]);
    const flowGap = content.gaps[0];
    expect(flowGap.specifications.map(s => s.displayValue)).toEqual(["1.0 / 1.5 / 2.0 mL/min", "0.5 / 1.5 / 2.5 mL/min"]);
    const pending = tests.flatMap(t => t.criteria.filter(c => c.verificationStatus !== "verified").map(c => c.key));
    expect(pending).toEqual([]);
    // resolved conflicts stay documented (never overwritten silently)
    const flowLimit = tests[0].criteria[0];
    expect(flowLimit).toMatchObject({ key: "flow_limit", comparison: "abs<=", tolerance: 1.0, unit: "%" });
    expect(flowLimit.conflictNote).toMatch(/Review note A \(resolved\).*0\.5 \/ 1\.5 \/ 2\.5/);
    expect(flowLimit.verificationEvidence).toMatch(/1\.0 \/ 1\.5 \/ 2\.0 mL\/min \(HPLC\.pdf p\.1\)/);
    const gpvLimit = tests[9].criteria[0];
    expect(gpvLimit).toMatchObject({ key: "gpv_limit", parameter: "rel_dev", comparison: "abs<=", tolerance: 2.0, unit: "%" });
    expect(gpvLimit.verificationEvidence).toMatch(/RELATIVE to the setting value/);
    expect(gpvLimit.verificationEvidence).toMatch(/NOT SPECIFIED IN SUPPLIED USP SOURCE/);
    expect(gpvLimit.conflictNote).toMatch(/Review note C \(resolved\)/);
    const noteC = content.gaps.find(g => g.key === "noteC_gpv_interpretation")!;
    expect(noteC.assessment).toMatch(/^RESOLVED/);
    expect(noteC.specifications.some(sp => sp.sourceClass === "pharmacopoeial" && /NOT SPECIFIED IN SUPPLIED USP SOURCE/.test(sp.displayValue + sp.label + sp.clause))).toBe(true);
    expect(content.gaps.find(g => g.key === "noteA_flow_setpoints")!.assessment).toMatch(/^RESOLVED/);
    tests.flatMap(t => t.criteria).filter(c => c.verificationStatus === "verified").forEach(c => expect(c.verificationEvidence).toMatch(/HPLC\.pdf p\.\d/));
    // flow setpoints 1.0 / 1.5 / 2.0 (HPLC.txt), V = 10.0 mL source default; no historical dates anywhere
    const flow = tests[0];
    expect(flow.levels.map(l => l.nominal)).toEqual([1.0, 1.5, 2.0]);
    expect(flow.fields[0]).toMatchObject({ key: "volume", defaultValue: 10.0, gt: 0 });
    expect(JSON.stringify(content)).not.toMatch(/2023|"20\/08\/2022"/);
  });
});

describe("HPLC calculations vs independent arithmetic", () => {
  it("1 — flow rate accuracy: actual = V/t, dev % = (actual − set)/set × 100, |dev %| ≤ 1.0", () => {
    const r = evalOne("hplc_flow_rate", { levels: READ.flow });
    [["F1", 1.0], ["F2", 1.5], ["F3", 2.0]].forEach(([k, set]) => {
      const t = READ.flow[k as keyof typeof READ.flow][0];
      const actual = 10.0 / t;
      expect(calc(r, "actual", k as string).raw).toBeCloseTo(actual, 12);
      expect(calc(r, "dev", k as string).raw).toBeCloseTo(actual - (set as number), 12);
      expect(calc(r, "dev_pct", k as string).raw).toBeCloseTo(((actual - (set as number)) / (set as number)) * 100, 10);
      expect(calc(r, "abs_err_pct", k as string).raw).toBeCloseTo(Math.abs(((actual - (set as number)) / (set as number)) * 100), 10);
    });
    // criterion verified (p.1 setpoints confirmed) → decisional
    expect(r.status).toBe("PASS");
    expect(r.criteria).toHaveLength(3);
    expect(r.criteria.every(c => c.status === "PASS")).toBe(true);
    const fail = evalOne("hplc_flow_rate", { levels: { ...READ.flow, F2: [6.5] } }); // 1.538 → +2.56 %
    expect(fail.status).toBe("FAIL");
    expect(fail.criteria.find(c => c.levelKey === "F2")!.status).toBe("FAIL");
    // just inside the limit: 1.009 mL/min at 1.0 → +0.9 %
    const edge = evalOne("hplc_flow_rate", { levels: { ...READ.flow, F1: [10 / 1.009] } });
    expect(edge.criteria.find(c => c.levelKey === "F1")!.status).toBe("PASS");
    // invalid time: never calculated, never a pass
    const bad = evalOne("hplc_flow_rate", { levels: { ...READ.flow, F1: [0] } });
    expect(bad.status).toBe("INCOMPLETE");
    expect(calc(bad, "actual", "F1").raw).toBeNull();
    const badV = evalOne("hplc_flow_rate", { levels: READ.flow, fields: { volume: -1 } });
    expect(badV.status).toBe("INCOMPLETE");
    expect(evalOne("hplc_flow_rate", {}).status).toBe("INCOMPLETE");
  });

  it("2 — lamp reference energy: NLT 400 mV (boundary inclusive)", () => {
    expect(evalOne("hplc_lamp_energy", { fields: { energy: 400 } }).status).toBe("PASS");
    expect(evalOne("hplc_lamp_energy", { fields: { energy: 399.99 } }).status).toBe("FAIL");
    expect(evalOne("hplc_lamp_energy", { fields: {} }).status).toBe("INCOMPLETE");
  });

  it("3 — UV lamp hours: maintenance alert at ≥ 2000 h, never PASS/FAIL, never changes the overall result", () => {
    const low = evalOne("hplc_uv_lamp_hours", { fields: { lamp_hours: 1999 } });
    expect(low.status).toBe("RECORDED");
    expect(low.advisories![0].triggered).toBe(false);
    const high = evalOne("hplc_uv_lamp_hours", { fields: { lamp_hours: 2000 } });
    expect(high.status).toBe("RECORDED");
    expect(high.advisories![0].triggered).toBe(true);
    expect(high.advisories![0].message).toMatch(/lamp replacement \/ maintenance review required/);
    const withAlert = evaluateExecution(content, { ...FULL, hplc_uv_lamp_hours: { fields: { lamp_hours: 2500 } } });
    const without = evaluateExecution(content, FULL);
    expect(withAlert.overall).toBe(without.overall);
    expect(evalOne("hplc_uv_lamp_hours", {}).status).toBe("INCOMPLETE");
  });

  it("4 — column oven: |thermometer − set| ≤ 2.0 and |display − set| ≤ 2.0; display − thermometer informative", () => {
    const r = evalOne("hplc_column_oven", { levels: READ.oven });
    Object.entries(READ.oven).forEach(([k, [th, disp]]) => {
      const set = Number(k.slice(1));
      expect(calc(r, "th_dev", k).raw).toBeCloseTo(th - set, 12);
      expect(calc(r, "disp_dev", k).raw).toBeCloseTo(disp - set, 12);
      expect(calc(r, "diff", k).raw).toBeCloseTo(disp - th, 12);
    });
    expect(r.status).toBe("PASS");
    expect(r.criteria).toHaveLength(8);
    expect(evalOne("hplc_column_oven", { levels: { ...READ.oven, T60: [62.0, 60.0] } }).status).toBe("PASS"); // boundary 2.0
    expect(evalOne("hplc_column_oven", { levels: { ...READ.oven, T60: [62.01, 60.0] } }).status).toBe("FAIL");
    expect(evalOne("hplc_column_oven", { levels: { ...READ.oven, T25: [25.0, 27.5] } }).status).toBe("FAIL"); // display
  });

  it("5 — precision: RSD (n − 1) of RT ≤ 1.0 % and of area ≤ 2.0 %; deviations per injection", () => {
    const r = evalOne("hplc_precision", FULL.hplc_precision);
    const { rt, area } = READ.prec;
    expect(calc(r, "rt_mean").raw).toBeCloseTo(avg(rt), 12);
    expect(calc(r, "rt_sd").raw).toBeCloseTo(sdev(rt), 12);
    expect(calc(r, "rt_rsd").raw).toBeCloseTo((sdev(rt) / avg(rt)) * 100, 10);
    expect(calc(r, "area_rsd").raw).toBeCloseTo((sdev(area) / avg(area)) * 100, 10);
    rt.forEach((v, i) => expect(calc(r, "rt_dev", `INJ${i + 1}`).raw).toBeCloseTo(v - avg(rt), 12));
    area.forEach((v, i) => expect(calc(r, "area_abs_dev", `INJ${i + 1}`).raw).toBeCloseTo(Math.abs(v - avg(area)), 6));
    expect(r.status).toBe("PASS");
    const wide = { ...FULL.hplc_precision.levels!, INJ5: [5.115, 270000] };
    const f = evalOne("hplc_precision", { levels: wide });
    expect(f.criteria.find(c => c.key === "area_rsd_lim")!.status).toBe("FAIL");
    expect(f.criteria.find(c => c.key === "rt_rsd_lim")!.status).toBe("PASS");
    expect(f.status).toBe("FAIL");
    expect(evalOne("hplc_precision", { levels: { ...FULL.hplc_precision.levels!, INJ3: [5.1, null] } }).status).toBe("INCOMPLETE");
  });

  it("6 — wavelength accuracy: λmax in 270–274 nm; ties are flagged for review, never chosen silently", () => {
    const r = evalOne("hplc_wavelength", FULL.hplc_wavelength);
    const idx = READ.wl.indexOf(Math.max(...READ.wl));
    expect(calc(r, "lambda_max").raw).toBe(267 + idx);
    expect(calc(r, "max_response").raw).toBe(Math.max(...READ.wl));
    expect(r.status).toBe("PASS");
    const shifted = [...READ.wl];
    shifted[9] = 300; // 276 nm
    expect(evalOne("hplc_wavelength", { levels: Object.fromEntries(shifted.map((a, i) => [`W${267 + i}`, [a]])) }).status).toBe("FAIL");
    const tie = [...READ.wl];
    tie[4] = tie[5]; // 271 and 272 equal
    const t = evalOne("hplc_wavelength", { levels: Object.fromEntries(tie.map((a, i) => [`W${267 + i}`, [a]])) });
    expect(t.status).toBe("UNDER REVIEW");
    expect(t.notes.join(" ")).toMatch(/Tie: .*271, 272/);
    expect(t.graphs[0].series.find(s => s.name.startsWith("Maximum"))!.points.map(p => p.x)).toEqual([271, 272]);
  });

  it("7/8 — detector and autosampler linearity: r, slope, intercept, R² = 1 − SSres/SStot, predicted, residuals; r ≥ 0.99", () => {
    const cases: Array<[string, number[], number[], string[]]> = [
      ["hplc_detector_linearity", [10, 20, 30, 40, 50], READ.det, ["C10", "C20", "C30", "C40", "C50"]],
      ["hplc_autosampler_linearity", [5, 10, 20, 50, 80, 100], READ.auto, ["V5", "V10", "V20", "V50", "V80", "V100"]],
    ];
    for (const [key, x, y, levels] of cases) {
      const r = evalOne(key, FULL[key]);
      const o = ols(x, y);
      expect(calc(r, "slope").raw).toBeCloseTo(o.m, 8);
      expect(calc(r, "intercept").raw).toBeCloseTo(o.b, 6);
      expect(calc(r, "r").raw).toBeCloseTo(o.r, 12);
      expect(calc(r, "r2").raw).toBeCloseTo(o.r2, 12);
      levels.forEach((l, i) => {
        expect(calc(r, "predicted", l).raw).toBeCloseTo(o.pred[i], 6);
        expect(calc(r, "residual", l).raw).toBeCloseTo(o.resid[i], 6);
      });
      expect(r.status).toBe("PASS");
      expect(r.notes.join(" ")).toMatch(/Regression equation: y = /);
      const g = r.graphs[0];
      expect(g.regression!.n).toBe(x.length);
      expect(g.notes.join(" ")).toMatch(/r = .*R² = /);
    }
    const scattered = evalOne("hplc_detector_linearity", { levels: { C10: [100000], C20: [400000], C30: [150000], C40: [450000], C50: [200000] } });
    expect(scattered.status).toBe("FAIL");
    expect(evalOne("hplc_detector_linearity", { levels: { C10: [100000] } }).status).toBe("INCOMPLETE");
  });

  it("9 — carryover % = blank / carryover × 100 ≤ 0.01; carryover area must be > 0", () => {
    const r = evalOne("hplc_carryover", FULL.hplc_carryover);
    expect(calc(r, "carry_pct").raw).toBeCloseTo((406 / 165725685) * 100, 15);
    expect(r.status).toBe("PASS");
    expect(evalOne("hplc_carryover", { fields: { blank_area: 1, carry_area: 10000 } }).status).toBe("PASS"); // exactly 0.01
    expect(evalOne("hplc_carryover", { fields: { blank_area: 1.01, carry_area: 10000 } }).status).toBe("FAIL");
    const zero = evalOne("hplc_carryover", { fields: { blank_area: 1, carry_area: 0 } });
    expect(zero.status).toBe("INCOMPLETE");
    expect(calc(zero, "carry_pct").raw).toBeNull();
  });

  it("10 — GPV: actual % = (Hset − H0)/(H100 − H0) × 100; |actual − set| / set × 100 ≤ 2.0 % (relative); H100 = H0 is not calculated", () => {
    const r = evalOne("hplc_gpv", FULL.hplc_gpv);
    Object.entries(READ.gpv).forEach(([k, [h0, hs, h100]]) => {
      const set = Number(k.slice(2));
      const actual = ((hs - h0) / (h100 - h0)) * 100;
      expect(calc(r, "actual", k).raw).toBeCloseTo(actual, 10);
      expect(calc(r, "dev", k).raw).toBeCloseTo(actual - set, 10);
      expect(calc(r, "rel_dev", k).raw).toBeCloseTo(((actual - set) / set) * 100, 10);
    });
    expect(r.status).toBe("PASS");
    expect(r.criteria).toHaveLength(9);
    // relative, not percentage points: 10 % setting → 9.8–10.2 %; 50 % → 49–51 %; 90 % → 88.2–91.8 %
    const gpv = (lv: Record<string, number[]>) => evalOne("hplc_gpv", { levels: { ...READ.gpv, ...lv } });
    const st = (r2: TestEvaluation, k: string) => r2.criteria.find(c => c.levelKey === k)!.status;
    expect(st(gpv({ AB10: [0, 102, 1000] }), "AB10")).toBe("PASS"); // 10.2 % → +2.0 %
    expect(st(gpv({ AB10: [0, 98, 1000] }), "AB10")).toBe("PASS"); // 9.8 % → −2.0 %
    expect(st(gpv({ AB10: [0, 103, 1000] }), "AB10")).toBe("FAIL"); // 10.3 % → +3.0 % (would pass as ± 2.0 pp)
    expect(st(gpv({ AC10: [0, 105, 1000] }), "AC10")).toBe("FAIL"); // historical-style 10.5 % → +5.0 %
    expect(st(gpv({ AB50: [0, 510, 1000] }), "AB50")).toBe("PASS"); // 51.0 % → +2.0 %
    expect(st(gpv({ AB50: [0, 512, 1000] }), "AB50")).toBe("FAIL"); // 51.2 % → +2.4 %
    expect(st(gpv({ AD90: [0, 918, 1000] }), "AD90")).toBe("PASS"); // 91.8 % → +2.0 %
    expect(st(gpv({ AD90: [0, 919, 1000] }), "AD90")).toBe("FAIL"); // 91.9 % → +2.11 %
    expect(gpv({ AB10: [0, 103, 1000] }).status).toBe("FAIL");
    const div0 = evalOne("hplc_gpv", { levels: { ...READ.gpv, AB10: [1000, 2000, 1000] } });
    expect(div0.status).toBe("INCOMPLETE");
    expect(calc(div0, "actual", "AB10").raw).toBeNull();
    const g = r.graphs[0];
    expect(g.series.filter(s => s.kind === "points").map(s => s.name)).toEqual(["Pump A & B", "Pump A & C", "Pump A & D"]);
  });

  it("graphs: the 10 required graphs from real data only, none from missing data", () => {
    const e = evaluateExecution(content, FULL);
    const graphs = e.tests.flatMap(t => t.graphs);
    expect(graphs.map(g => `${g.testKey}:${g.title}`)).toHaveLength(10);
    const byTest = (k: string) => graphs.filter(g => g.testKey === k).map(g => g.title);
    expect(byTest("hplc_flow_rate")).toEqual(["Flow rate accuracy — set flow vs actual flow", "Flow rate accuracy — deviation % by set flow"]);
    expect(byTest("hplc_column_oven")).toHaveLength(2);
    expect(byTest("hplc_precision")).toHaveLength(2);
    const rtGraph = graphs.find(g => g.title.includes("retention time"))!;
    expect(rtGraph.series[0].points.map(p => p.y)).toEqual(READ.prec.rt);
    expect(rtGraph.guides.find(gd => gd.name === "Mean")!.y).toBeCloseTo(avg(READ.prec.rt), 12);
    expect(byTest("hplc_lamp_energy")).toEqual([]);
    expect(byTest("hplc_carryover")).toEqual([]);
    expect(evaluateExecution(content, {}).tests.flatMap(t => t.graphs)).toEqual([]);
    expect(e.overall).toBe("PASS"); // content-level evaluation; New Validation still requires an approved revision
  });
});

/* ------------------------------ database ------------------------------ */
/** The content as registered by the earlier seed v1 (PR #9): flow / GPV criteria pending, GPV limit in percentage points. */
function seedV1Content(v2: ProtocolContent): ProtocolContent {
  const v1 = structuredClone(v2);
  v1.identification.description = v1.identification.description.replace(HPLC_SEED_VERSION, HPLC_PREVIOUS_SEED_VERSIONS[0]);
  const t1 = v1.sections.flatMap(sx => sx.tests);
  Object.assign(t1[0].criteria[0], { verificationStatus: "pending-technical-verification", verificationEvidence: "", conflictNote: "PENDING QUALITY REVIEW: setpoints 1.0 / 1.5 / 2.0 vs 0.5 / 1.5 / 2.5" });
  const g = t1[9];
  g.calculations = g.calculations.filter(cx => cx.key !== "rel_dev");
  Object.assign(g.criteria[0], { parameter: "abs_dev", unit: "percentage points", verificationStatus: "pending-technical-verification", verificationEvidence: "", conflictNote: "PENDING QUALITY REVIEW: interpretation of \"Setting value ± 2.0\"" });
  return v1;
}
/** Writes a DRAFT revision directly in the store (simulates the database state left by an earlier deployment). */
async function writeRawDraft(revId: string, content: ProtocolContent) {
  const [row] = await svc.protocolStore().select<Record<string, any>>("protocol_revisions", { where: { id: revId } });
  const [prow] = await svc.protocolStore().select<Record<string, any>>("protocols", { where: { id: row.protocol_id } });
  await svc.protocolStore().apply([
    { op: "update", table: "protocol_revisions", id: revId, set: { content, row_version: row.row_version + 1 }, expect: { row_version: row.row_version } },
    { op: "update", table: "protocols", id: prow.id, set: { description: content.identification.description, row_version: prow.row_version + 1 }, expect: { row_version: prow.row_version } },
  ]);
}

const testDatabase = "/tmp/miayar-hplc.test.sqlite";
const PW = "hplc-test-password-1";
let admin: svc.Actor, editor: svc.Actor, qm: svc.Actor, normal: svc.Actor;
async function user(email: string, name: string, role: "admin" | "user"): Promise<svc.Actor> {
  const u = await createLocalUser({ email, password: PW, name, role });
  return { id: u.id, name: u.name, role, email };
}
const count = async (table: string, where?: Record<string, unknown>) => (await svc.protocolStore().select(table, where ? { where } : undefined)).length;

describe("HPLC protocol registration, approval, New Validation and PDF (SQLite)", () => {
  beforeAll(async () => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    admin = await user("admin@hplc.test", "Admin", "admin");
    editor = await user("editor@hplc.test", "Editor", "user");
    qm = await user("qm@hplc.test", "Quality Manager", "user");
    normal = await user("normal@hplc.test", "Analyst", "user");
    await svc.setDuty(admin, { userId: editor.id, duty: "author", granted: true, reason: "Authorized protocol editor" });
    await svc.setDuty(admin, { userId: qm.id, duty: "quality-manager", granted: true, reason: "Quality Manager" });
  });
  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    delete process.env.QC_STORAGE_MODE;
  });

  it("is registered automatically (Draft Rev.01, linked to the existing HPLC record) and idempotently", async () => {
    // a normal user opening the Protocol page cannot write anything
    await val.protocolBoard(normal);
    expect(await count("protocols")).toBe(0);
    const board = await val.protocolBoard(editor);
    const card = board.cards.find(c => c.cardKey === "hplc")!;
    expect(card.protocol).toMatchObject({ number: HPLC_PROTOCOL_NUMBER, activeRevision: null, draftRevision: { revisionNumber: 1 }, revisionCount: 1 });
    expect(card.equipment!.identity).toMatchObject({ instrumentId: "QC-I-104", model: "LC-40B XR" });
    const again = await seed.seedHplcProtocol(qm);
    expect(again.outcome).toBe("already-current");
    await val.protocolBoard(editor);
    expect(await count("protocols")).toBe(1);
    expect(await count("protocol_revisions")).toBe(1);
    expect(await count("protocol_references", { code: "HPLC-CAL-RECORD-LC2030" })).toBe(1);
    const detail = await val.protocolForEquipment(editor, "hplc");
    const rev = await svc.getRevision(editor, detail.protocol!.draftRevision!.id);
    expect(rev.revision.status).toBe("draft");
    expect(rev.revision.content.sections.flatMap(s => s.tests).map(t => t.key)).toEqual([...HPLC_TEST_KEYS]);
    expect(rev.revision.content.equipmentLinks).toMatchObject([{ instrumentKey: "hplc", instrumentId: "QC-I-104", serialNumber: "L22146101115 AE" }]);
    // equipment specifications documented in HPLC.pdf recorded on the Equipment Master (empty fields only, with source page)
    expect(rev.revision.content.narrative.equipmentDescription).toMatch(/Pump Configuration: Four solvent channels/);
    expect(rev.revision.content.narrative.equipmentDescription).toMatch(/Software Name: Needs Equipment Information/);
    const eq = await wf.getEquipmentData("hplc");
    expect(eq.equipment.specs.injectorCapacity).toMatchObject({ value: 100, unit: "µL" });
    expect(eq.equipment.specs.columnDimensions.source).toMatch(/HPLC\.pdf p\.4/);
    expect(eq.equipment.specs.lampHours).toBeUndefined(); // 2022 "as found" value never used
    expect(eq.equipment.specs.lastCalibration).toBeUndefined(); // historical dates never used
    expect(eq.changes.every(c => c.reference === "HPLC.pdf (RLS/QC/HPLC/02)")).toBe(true);
    expect(await seed.seedHplcEquipmentSpecs(editor)).toEqual([]); // idempotent, never overwrites
    // never auto-approved: New Validation has no approved protocol yet
    expect((await val.activeProtocolForEquipment("hplc")).available).toBe(false);
  });

  it("upgrades a draft registered by the earlier seed (v1: flow / GPV pending, GPV in pp) to the current content — audited, and never over user edits", async () => {
    const detail = await val.protocolForEquipment(editor, "hplc");
    const revId = detail.protocol!.draftRevision!.id;
    const current = await svc.getRevision(editor, revId);
    const v2 = current.revision.content;
    expect(v2.identification.description).toContain(HPLC_SEED_VERSION);
    // Simulate the database state left by seed v1 (what PR #9 registered).
    const v1 = seedV1Content(v2);
    const writeRaw = (c: ProtocolContent) => writeRawDraft(revId, c);
    await writeRaw(v1);
    // Opening the Protocol page (author) upgrades it automatically.
    await val.protocolBoard(editor);
    let rev = await svc.getRevision(editor, revId);
    expect(rev.revision.revisionNumber).toBe(1);
    expect(rev.revision.status).toBe("draft");
    expect(rev.revision.content.identification.description).toContain(HPLC_SEED_VERSION);
    expect(rev.revision.content.sections).toEqual(v2.sections);
    expect(await count("protocol_revisions")).toBe(1);
    const audits = await svc.protocolStore().select<Record<string, any>>("protocol_audit_events", { where: { revision_id: revId, action: "revision.content-updated" } });
    expect(audits.map(a => a.reason)).toContain(seed.HPLC_UPGRADE_REASON);
    expect((await val.activeProtocolForEquipment("hplc")).available).toBe(false); // never approved automatically

    // A v1 draft that a user edited is NOT overwritten.
    await writeRaw(v1);
    rev = await svc.getRevision(editor, revId);
    const edited = structuredClone(rev.revision.content);
    edited.narrative.scope = `${edited.narrative.scope} (local note by editor)`;
    await svc.saveDraft(editor, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, content: edited, reason: "Editor change (test)" });
    const blocked = await seed.seedHplcProtocol(editor);
    expect(blocked.outcome).toBe("blocked");
    expect(blocked.notes.join(" ")).toMatch(/NOT overwritten/);
    rev = await svc.getRevision(editor, revId);
    expect(rev.revision.content.narrative.scope).toContain("(local note by editor)");
    expect(rev.revision.content.sections.flatMap(sx => sx.tests)[9].criteria[0].parameter).toBe("abs_dev");
    // The user applies the update deliberately (restoring the current seed content).
    await svc.saveDraft(editor, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, content: v2, reason: "Apply updated HPLC.pdf content (test)" });
    expect((await seed.seedHplcProtocol(editor)).outcome).toBe("already-current");
  });

  it("QM approval requires the reference and the pending criteria to be verified; then New Validation runs all 10 tests and stores an immutable record + PDF", async () => {
    const detail = await val.protocolForEquipment(editor, "hplc");
    const revId = detail.protocol!.draftRevision!.id;
    let rev = await svc.getRevision(qm, revId);
    expect((await (async () => { try { await svc.transition(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, action: "approve", password: PW }); } catch (e) { return e as Error; } })())!.message).toMatch(/Approval is blocked/);

    expect(rev.qmApprovalBlockers.join(" ")).toMatch(/Reference HPLC-CAL-RECORD-LC2030 is pending-verification/);
    expect(rev.qmApprovalBlockers.join(" ")).not.toMatch(/criterion/); // flow / GPV resolved — no pending criteria

    // "Verified" button: Quality Manager only, password-signed, written statement; values never change.
    const statement = "Criteria, limits and reference checked against HPLC.pdf pages 1-9 (test)";
    const errOf = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { return e as Error; } return null; };
    expect((await errOf(() => svc.verifyForApproval(editor, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, statement, password: PW })))!.message).toMatch(/quality-manager|not permitted|requires/i);
    expect((await errOf(() => svc.verifyForApproval(normal, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, statement, password: PW })))).not.toBeNull();
    expect((await errOf(() => svc.verifyForApproval(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, statement, password: "wrong-password" })))!.message).toMatch(/signature failed/);
    expect((await errOf(() => svc.verifyForApproval(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, statement: "ok" , password: PW })))!.message).toMatch(/verification statement/);
    const before = rev.revision.content;
    const verified = await svc.verifyForApproval(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, statement, password: PW });
    expect(verified.verifiedReferences).toEqual(["HPLC-CAL-RECORD-LC2030"]);
    expect(verified.verifiedCriteria).toEqual([]);
    expect(verified.remainingBlockers).toEqual([]);
    const [refRow] = await svc.protocolStore().select<Record<string, any>>("protocol_references", { where: { code: "HPLC-CAL-RECORD-LC2030" } });
    expect(refRow).toMatchObject({ verification_status: "verified", verified_by_name: "Quality Manager" });
    expect(refRow.notes).toContain(statement);
    const audits = await svc.protocolStore().select<Record<string, any>>("protocol_audit_events", { where: { revision_id: revId } });
    expect(audits.map(a => a.action)).toEqual(expect.arrayContaining(["reference.verified", "revision.sources-verified"]));
    rev = await svc.getRevision(qm, revId);
    expect(rev.qmApprovalBlockers).toEqual([]);
    expect(rev.revision.content.sections).toEqual(before.sections); // nothing in the protocol content changed
    expect(rev.revision.status).toBe("draft"); // verification never approves
    expect((await val.activeProtocolForEquipment("hplc")).available).toBe(false);
    rev = await svc.getRevision(qm, revId);
    await svc.transition(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, action: "approve", password: PW });

    const active = (await val.activeProtocolForEquipment("hplc")) as Extract<Awaited<ReturnType<typeof val.activeProtocolForEquipment>>, { available: true }>;
    expect(active.available).toBe(true);
    const evaluation = await val.calculateValidation({ instrumentKey: "hplc", revisionId: active.revision.id, measurements: FULL });
    expect(evaluation.tests).toHaveLength(10);
    expect(evaluation.overall).toBe("PASS");
    expect(evaluation.tests.find(t => t.testKey === "hplc_uv_lamp_hours")!.status).toBe("RECORDED");

    const rec = await val.recordValidation(normal, { instrumentKey: "hplc", revisionId: active.revision.id, measurements: FULL });
    const stored = await val.getValidation(rec.runId);
    expect(stored.overall ?? stored.evaluation.overall).toBe("PASS");
    expect(stored.revisionNumber).toBe(1);
    expect(stored.content.sections.flatMap(s => s.tests)).toHaveLength(10);
    expect(stored.measurements.hplc_flow_rate.levels!.F1).toEqual([10.05]);
    expect(stored.evaluation.tests.flatMap(t => t.graphs)).toHaveLength(10);
    // reseeding after approval never touches the approved revision
    expect((await seed.seedHplcProtocol(editor)).outcome).toBe("already-current");
    expect(await count("protocol_revisions")).toBe(1);

    const { doc, tablePages, graphPages } = buildValidationPdf({
      organization: "National Drug Quality Control Laboratory", runNumber: stored.runNumber, protocolNumber: stored.protocolNumber, protocolTitle: stored.protocolTitle,
      revisionNumber: stored.revisionNumber, revisionApprovedBy: stored.revisionApprovedBy, revisionApprovedAt: stored.revisionApprovedAt, contentHash: stored.contentHash,
      content: stored.content, equipment: stored.equipment, measurements: stored.measurements, evaluation: stored.evaluation, referenceSnapshot: stored.referenceSnapshot,
      recordedBy: stored.recordedBy, recordedAt: stored.recordedAt, generatedBy: "Analyst", generatedAt: new Date("2026-11-18T10:00:00Z"),
    });
    expect(graphPages).toHaveLength(10);
    expect(graphPages[0]).toBe(tablePages + 1);
    expect(doc.getNumberOfPages()).toBe(tablePages + 10);
    const text = Buffer.from(doc.output("arraybuffer")).toString("latin1");
    expect(text).toContain("Needs Equipment Information");
    expect(text).toContain("HPLC.pdf p.");
    expect(text).toContain("Review notes");
    expect(text).toContain("Maintenance status");
    if (process.env.HPLC_PDF_OUT) writeFileSync(process.env.HPLC_PDF_OUT, Buffer.from(doc.output("arraybuffer")));
  });
});

describe("HPLC seed upgrade over an APPROVED earlier-seed revision (SQLite)", () => {
  const db2 = "/tmp/miayar-hplc-upgrade.test.sqlite";
  beforeAll(async () => {
    closeLocalDatabase();
    if (existsSync(db2)) rmSync(db2);
    process.env.QC_LOCAL_DB_PATH = db2;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    admin = await user("admin@hplc2.test", "Admin", "admin");
    editor = await user("editor@hplc2.test", "Editor", "user");
    qm = await user("qm@hplc2.test", "Quality Manager", "user");
    await svc.setDuty(admin, { userId: editor.id, duty: "author", granted: true, reason: "Authorized protocol editor" });
    await svc.setDuty(admin, { userId: qm.id, duty: "quality-manager", granted: true, reason: "Quality Manager" });
  });
  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(db2)) rmSync(db2);
    delete process.env.QC_STORAGE_MODE;
  });

  it("QM verifies the v1 pending criteria with the Verified step (values unchanged), approves; the upgrade then creates a NEW draft and never edits the approved revision", async () => {
    const created = await seed.seedHplcProtocol(editor);
    expect(created.outcome).toBe("created");
    expect(created.equipmentSpecsFilled.length).toBeGreaterThan(0);
    const revId = created.revisionId!;
    const v2 = (await svc.getRevision(editor, revId)).revision.content;
    await writeRawDraft(revId, seedV1Content(v2)); // database state of a v1 deployment
    let rev = await svc.getRevision(qm, revId);
    expect(rev.qmApprovalBlockers.join(" ")).toMatch(/hplc_flow_rate\/flow_limit, hplc_gpv\/gpv_limit/);
    const v1Sections = rev.revision.content.sections;

    const res = await svc.verifyForApproval(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, statement: "Flow setpoints and GPV interpretation checked against HPLC.pdf p.1-9 (test)", password: PW });
    expect(res.verifiedCriteria).toEqual(["hplc_flow_rate/flow_limit", "hplc_gpv/gpv_limit"]);
    expect(res.verifiedReferences).toEqual(["HPLC-CAL-RECORD-LC2030"]);
    expect(res.remainingBlockers).toEqual([]);
    rev = await svc.getRevision(qm, revId);
    const crits = rev.revision.content.sections.flatMap(sx => sx.tests).flatMap(t => t.criteria);
    const v1Crits = v1Sections.flatMap(sx => sx.tests).flatMap(t => t.criteria);
    crits.forEach((c, i) => {
      // only status / evidence change — limits, units, parameters never change
      expect({ ...c, verificationStatus: v1Crits[i].verificationStatus, verificationEvidence: v1Crits[i].verificationEvidence }).toEqual(v1Crits[i]);
      expect(c.verificationStatus).toBe("verified");
    });
    expect(crits.find(c => c.key === "gpv_limit")!.verificationEvidence).toMatch(/Verified against source by Quality Manager Quality Manager \(\d{4}-\d{2}-\d{2}\)/);
    // a criterion without a numeric limit is never "verified"
    const noLimit = structuredClone(rev.revision.content);
    Object.assign(noLimit.sections.flatMap(sx => sx.tests)[1].criteria[0], { lower: null, verificationStatus: "pending-technical-verification", verificationEvidence: "" });
    await svc.saveDraft(editor, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, content: noLimit, reason: "test: limit removed" });
    rev = await svc.getRevision(qm, revId);
    const skip = await svc.verifyForApproval(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, statement: "Second verification pass (test)", password: PW });
    expect(skip.verifiedCriteria).toEqual([]);
    expect(skip.skipped.join(" ")).toMatch(/hplc_lamp_energy\/energy_min: numeric limit not configured/);
    expect(skip.remainingBlockers.join(" ")).toMatch(/not verified/);
    rev = await svc.getRevision(qm, revId);
    const restored = structuredClone(rev.revision.content);
    Object.assign(restored.sections.flatMap(sx => sx.tests)[1].criteria[0], crits.find(c => c.key === "energy_min"));
    await svc.saveDraft(editor, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, content: restored, reason: "test: limit restored" });
    rev = await svc.getRevision(qm, revId);
    expect(rev.qmApprovalBlockers).toEqual([]);
    await svc.transition(qm, { revisionId: revId, expectedRowVersion: rev.revision.rowVersion, action: "approve", password: PW });
    const approvedContent = (await svc.getRevision(editor, revId)).revision.content;
    expect(approvedContent.identification.description).toContain(HPLC_PREVIOUS_SEED_VERSIONS[0]);

    // Upgrade: approved revisions are never edited — a new Draft revision carries the current content.
    const up = await seed.seedHplcProtocol(editor);
    expect(up.outcome).toBe("new-revision");
    expect(up.revisionNumber).toBe(2);
    const after = await svc.getRevision(editor, revId);
    expect(after.revision.status).toBe("released");
    expect(after.revision.content).toEqual(approvedContent);
    const draft = await svc.getRevision(editor, up.revisionId!);
    expect(draft.revision.status).toBe("draft");
    expect(draft.revision.content.identification.description).toContain(HPLC_SEED_VERSION);
    expect(draft.revision.content.sections.flatMap(sx => sx.tests)[9].criteria[0]).toMatchObject({ parameter: "rel_dev", unit: "%", tolerance: 2.0 });
    const active = await val.activeProtocolForEquipment("hplc");
    expect(active.available && active.revision.revisionNumber).toBe(1); // New Validation keeps the approved revision until the QM approves Rev.02
    expect((await seed.seedHplcProtocol(editor)).outcome).toBe("already-current");
  });
});
