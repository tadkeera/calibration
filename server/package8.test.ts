/**
 * 8-protocol package: structural validity, source-rule compliance and formula
 * checks. Fixtures come only from values printed in the supplied sources
 * (docs/HPLC.pdf, CAL-QC-BAL-001 Rev.01) or are labelled synthetic.
 * Historical values are never stored as results.
 */
import { describe, expect, it } from "vitest";
import { NOT_SPECIFIED, PACKAGE_NEW_EQUIPMENT, PACKAGE_PROTOCOLS, PACKAGE_REFERENCES } from "../shared/protocols/package8";
import { allCriteria, parseProtocolContent } from "../shared/protocols/model";
import { structuralIssues } from "../shared/protocols/validation";
import { evaluateExecution, type Measurements } from "../shared/protocols/evaluate";
import { buildRunSteps, measurementConflicts, mergeMeasurements, runApprovalBlockers } from "../shared/protocols/runWorkflow";
import { diffEquipment, equipmentVersion, specIssues } from "../shared/protocols/equipment";

const content = (n: string) => parseProtocolContent(PACKAGE_PROTOCOLS.find(p => p.number === n)!.content);
const testResult = (n: string, testKey: string, m: Measurements) => evaluateExecution(content(n), m).tests.find(t => t.testKey === testKey)!;
const calcValue = (r: ReturnType<typeof testResult>, key: string, level?: string) => r.calculations.find(c => c.key === key && (level ? c.levelKey === level : true))?.value;

describe("8-protocol package definitions", () => {
  it("parses all 8 protocols without structural issues and with device-specific test counts", () => {
    const counts = PACKAGE_PROTOCOLS.map(p => {
      const c = parseProtocolContent(p.content);
      expect(structuralIssues(c)).toEqual([]);
      return [p.number, c.sections.flatMap(s => s.tests).length, buildRunSteps(c).length];
    });
    expect(counts).toEqual([
      ["CAL-QC-HPLC-001", 10, 16], ["CAL-QC-POL-001", 6, 12], ["CAL-QC-BAL-001", 8, 14], ["CAL-QC-MOA-001", 6, 12],
      ["CAL-QC-DIS-001", 7, 13], ["CAL-QC-DISINT-001", 7, 13], ["CAL-QC-REF-001", 6, 12], ["CAL-QC-UV-001", 8, 14],
    ]);
  });

  it("never pre-verifies a criterion; every criterion is traceable; unstated limits are record-only NOT SPECIFIED", () => {
    const placeholders = new Set(PACKAGE_REFERENCES.map(r => r.placeholder));
    PACKAGE_PROTOCOLS.forEach(p => {
      const c = parseProtocolContent(p.content);
      allCriteria(c).forEach(({ criterion }) => {
        expect(criterion.verificationStatus).toBe("pending-technical-verification");
        expect(criterion.referenceId && placeholders.has(criterion.referenceId)).toBe(true);
        if (criterion.comparison === "record-only") expect(criterion.requirement).toContain(NOT_SPECIFIED);
      });
      expect(c.identification.description).toMatch(/does not imply that the instrument passed/);
    });
  });

  it("does not substitute USP <921> for the moisture analyzer and keeps the balance at Rev.01 / QA pending with ≥10 readings", () => {
    const moa = content("CAL-QC-MOA-001");
    expect(JSON.stringify(moa.references)).not.toMatch(/921/);
    expect(allCriteria(moa).every(c => ["@USP731", "@USP1058"].includes(c.criterion.referenceId ?? ""))).toBe(true);
    expect(allCriteria(moa).filter(c => c.test.key !== "T01").every(c => c.criterion.referenceId === "@USP731")).toBe(true);
    const bal = PACKAGE_PROTOCOLS.find(p => p.number === "CAL-QC-BAL-001")!;
    expect(bal.sourceRevision).toBe("01");
    expect(bal.sourceStatus).toMatch(/QA APPROVAL PENDING/);
    expect(content("CAL-QC-BAL-001").sections[0].tests.find(t => t.key === "T04")!.readingsRequired).toBe(10);
    expect(PACKAGE_NEW_EQUIPMENT[0]).toMatchObject({ instrumentId: "QC-I-074", model: "ED224S", serialNumber: "23304057" });
  });

  it("records the HPLC source conflicts as technical gaps instead of resolving them silently", () => {
    const hplc = content("CAL-QC-HPLC-001");
    expect(hplc.gaps.map(g => g.key)).toEqual(["H1", "H2", "H3", "H4"]);
    expect(hplc.gaps[0].specifications.map(s => s.displayValue).join(" | ")).toMatch(/1\.0 \/ 1\.5 \/ 2\.0.*0\.5 \/ 1\.5 \/ 2\.5.*1\.0 \/ 1\.5 \/ 2\.5/);
    expect(hplc.identification.model).toBe("LC-2030 PLUS");
    expect(hplc.equipmentLinks).toEqual([]);
  });
});

describe("package formulas (engine reproduces the source calculations; pending criteria never give PASS)", () => {
  it("HPLC T01 flow: actual = volume / time; % error vs set (HPLC.pdf p.2 handwritten values)", () => {
    // p.2: 10/20 = 0.5 mL/min; 10/6.6 at 1.5 mL/min; 10/4 = 2.5 mL/min.
    const r = testResult("CAL-QC-HPLC-001", "T01", { T01: { fields: { set_1: 0.5, vol_1: 10, time_1: 20, set_2: 1.5, vol_2: 10, time_2: 6.6, set_3: 2.5, vol_3: 10, time_3: 4 } } });
    expect(calcValue(r, "flow_1")).toBe(0.5);
    expect(calcValue(r, "err_1")).toBe(0);
    expect(calcValue(r, "flow_2")).toBeCloseTo(1.515, 3);
    // Unrounded intermediate: 10/6.6 = 1.51515… → +1.0101 % (indicatively outside ±1.0 %; rounding the flow first would hide this).
    expect(calcValue(r, "err_2")).toBe(1.01);
    expect(r.criteria.find(c => c.key === "err_2_lim")!.message).toMatch(/Indicative FAIL; criterion is PENDING/);
    expect(r.status).toBe("UNDER REVIEW");
  });

  it("HPLC T09 carryover and T10 gradient formulas (synthetic inputs)", () => {
    const c = testResult("CAL-QC-HPLC-001", "T09", { T09: { fields: { blank_area: 2, carry_area: 1_000_000 } } });
    expect(calcValue(c, "carryover")).toBeCloseTo(0.0002, 6);
    const fields: Record<string, number> = {};
    ["AB", "AC", "AD"].forEach(p => Object.assign(fields, { [`h0_${p}`]: 0, [`h100_${p}`]: 1000, [`h10_${p}`]: 105, [`h50_${p}`]: 511, [`h90_${p}`]: 908 }));
    const g = testResult("CAL-QC-HPLC-001", "T10", { T10: { fields } });
    expect(calcValue(g, "act10_AB")).toBe(10.5);
    expect(calcValue(g, "act50_AB")).toBe(51.1);
    expect(g.criteria.every(x => x.status === "UNDER REVIEW")).toBe(true);
  });

  it("HPLC T07 detector linearity r from 10–50 ppm levels (synthetic proportional areas)", () => {
    const levels = Object.fromEntries([10, 20, 30, 40, 50].map(ppm => [`P${ppm}`, [ppm * 10000]]));
    const r = testResult("CAL-QC-HPLC-001", "T07", { T07: { levels } });
    expect(calcValue(r, "r")).toBe(1);
  });

  it("Balance T04/T05: s_eff floor 0.41d = 0.000041 g and floor-based Mmin = 0.082 g (CAL-QC-BAL-001 Rev.01 T05)", () => {
    const r = testResult("CAL-QC-BAL-001", "T04", { T04: { readings: Array(10).fill(100.0001), fields: { m: 0.1 } } });
    expect(calcValue(r, "s")!).toBeLessThan(1e-12); // floating-point noise of identical readings
    expect(calcValue(r, "s_eff")).toBeCloseTo(0.000041, 12);
    expect(calcValue(r, "rep")).toBeCloseTo(0.082, 4);
    const nine = testResult("CAL-QC-BAL-001", "T04", { T04: { readings: Array(9).fill(100.0001), fields: { m: 0.1 } } });
    expect(nine.status).toBe("INCOMPLETE"); // 6 (or 9) historical readings can never satisfy the ≥10 requirement
    const mw = evaluateExecution(content("CAL-QC-BAL-001"), { T04: { readings: Array(10).fill(100.0001), fields: { m: 0.1 } }, T05: { fields: { s: 0, m: 0.1 } } }).tests.find(t => t.testKey === "T05")!;
    expect(calcValue(mw, "mmin")).toBeCloseTo(0.082, 12);
    expect(calcValue(mw, "mw_margin")).toBeCloseTo(0.018, 4);
  });

  it("Balance T03 accuracy: error % and the one-third-of-limit weight uncertainty rule", () => {
    const fields = { w1_cert: "W-200", ref_1: 200, ind_1: 200.0004, u_1: 0.0003, w2_cert: "W-100", ref_2: 100, ind_2: 99.9998, u_2: 0.00015, w3_cert: "W-20", ref_3: 20, ind_3: 20.0001, u_3: 0.00003 };
    const r = testResult("CAL-QC-BAL-001", "T03", { T03: { fields } });
    expect(calcValue(r, "err_1")).toBeCloseTo(0.0002, 6);
    expect(calcValue(r, "umargin_1")).toBeCloseTo(200 * 0.001 / 3 - 0.0003, 6);
    expect(r.status).toBe("UNDER REVIEW");
  });

  it("UV T02 applies ±1 nm (UV) and ±2 nm (visible) per level", () => {
    const r = testResult("CAL-QC-UV-001", "T02", { T02: { fields: { instrument_type: "non-diode-array", wl_standard: "Holmium oxide", wl_cert: "C-1" }, levelReferences: { UVL: 361.5, VISL: 536.4 }, levels: { UVL: [361.6, 361.5, 361.7, 361.6, 361.5, 361.6], VISL: [537.9, 538.0, 537.8, 538.1, 537.9, 538.0] } } });
    const uv = r.criteria.find(c => c.key === "uv_acc")!;
    const vis = r.criteria.find(c => c.key === "vis_acc")!;
    expect(uv.message).toMatch(/Indicative PASS/);
    expect(vis.message).toMatch(/Indicative PASS/);
    expect(r.status).toBe("UNDER REVIEW");
  });

  it("checklist tests need every item answered; NOT APPLICABLE requires a justification", () => {
    const iq = testResult("CAL-QC-POL-001", "T01", { T01: { fields: { identity_ok: true } } });
    expect(iq.status).toBe("INCOMPLETE");
    const na = testResult("CAL-QC-POL-001", "T06", { T06: { notApplicable: true } });
    expect(na.status).toBe("INCOMPLETE");
    const na2 = testResult("CAL-QC-POL-001", "T06", { T06: { notApplicable: true, naJustification: "Not used for quantitative enantiomer measurement" } });
    expect(na2.status).toBe("NOT APPLICABLE");
  });
});

describe("workflow helpers", () => {
  it("blocks recording of non-released revisions and approval while criteria are pending, without blocking saves", () => {
    const c = content("CAL-QC-POL-001");
    const blockers = runApprovalBlockers({ revisionStatus: "draft", protocolChanged: false, evaluation: evaluateExecution(c, {}), content: c, equipmentRetired: false, identityChanged: false, compatibility: [] });
    expect(blockers.find(b => b.code === "revision-not-released")!.blocksRecording).toBe(true);
    expect(blockers.find(b => b.code === "pending-verification")!).toMatchObject({ blocksRecording: false, blocksApproval: true });
  });

  it("detects per-test draft conflicts and merges only non-conflicting changes automatically", () => {
    const base = { T01: { readings: [1] }, T02: { readings: [2] } };
    const mine = { T01: { readings: [1.1] }, T02: { readings: [2] }, T03: { readings: [3] } };
    const theirs = { T01: { readings: [1.2] }, T02: { readings: [2.2] } };
    expect(measurementConflicts(mine, theirs, base)).toEqual([{ testKey: "T01", kind: "conflict" }, { testKey: "T02", kind: "theirs" }, { testKey: "T03", kind: "mine" }]);
    expect(mergeMeasurements(mine, theirs, base)).toEqual({ T01: { readings: [1.2] }, T02: { readings: [2.2] }, T03: { readings: [3] } });
    expect(mergeMeasurements(mine, theirs, base, { T01: "mine" }).T01).toEqual({ readings: [1.1] });
  });

  it("treats unit changes as critical and never converts units silently", () => {
    const identity = { instrumentId: "X", manufacturer: "M", model: "A", serialNumber: "S", nameEn: "B", nameAr: "ب", sopNumber: "", formNumber: "" };
    const changes = diffEquipment("balance", { identity, specs: { panDiameter: { value: 90, unit: "mm", source: "" } } }, { identity, specs: { panDiameter: { value: 9, unit: "cm", source: "" } } });
    expect(changes[0].critical).toBe(true);
    expect(specIssues("balance", { panDiameter: { value: 9, unit: "cm", source: "" } })[0].message).toMatch(/no automatic unit conversion/);
    expect(equipmentVersion(identity, {})).not.toBe(equipmentVersion({ ...identity, serialNumber: "S2" }, {}));
  });
});
