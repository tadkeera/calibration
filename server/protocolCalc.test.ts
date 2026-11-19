import { describe, expect, it } from "vitest";
import { CalcError, applyRounding, evaluateFormula, formulaVariables, roundDecimals, roundSignificant, runCalculation, stats } from "../shared/protocols/calc";
import { evaluateExecution } from "../shared/protocols/evaluate";
import { parseProtocolContent } from "../shared/protocols/model";

describe("protocol calculation engine", () => {
  it("computes descriptive statistics", () => {
    const v = [10.01, 10.03, 9.99, 10.02, 10.0];
    expect(stats.mean(v)).toBeCloseTo(10.01, 10);
    expect(stats.min(v)).toBe(9.99);
    expect(stats.max(v)).toBe(10.03);
    expect(stats.range(v)).toBeCloseTo(0.04, 10);
    expect(stats.sd(v)).toBeCloseTo(0.0158113883, 8);
    expect(stats.rsd(v)).toBeCloseTo((0.0158113883 / 10.01) * 100, 6);
  });

  it("never treats missing values as zero", () => {
    expect(() => stats.mean([1, null, 3])).toThrow(/missing values are not treated as zero/);
    expect(() => runCalculation({ kind: "sd", formula: "" }, { values: [1, null], reference: null })).toThrow(CalcError);
    expect(() => evaluateFormula("a + 1", { a: null })).toThrow(/missing/);
  });

  it("prevents division by zero", () => {
    expect(() => evaluateFormula("1 / (a - a)", { a: 2 })).toThrow(/Division by zero/);
    expect(() => stats.rsd([0, 0])).toThrow(/mean is zero/);
    expect(() => runCalculation({ kind: "pct-error", formula: "" }, { values: [1], reference: 0 })).toThrow(/reference is zero/);
  });

  it("evaluates custom formulas safely without eval", () => {
    expect(evaluateFormula("(instrumentTemp - referenceTemp)", { instrumentTemp: 25.08, referenceTemp: 25.0 })).toBeCloseTo(0.08, 10);
    expect(evaluateFormula("abs(mean(readings) - 5) / 5 * 100", { readings: [5.1, 4.9, 5.2] })).toBeCloseTo((Math.abs(15.2 / 3 - 5) / 5) * 100, 10);
    expect(evaluateFormula("2 ^ 3 + -1", {})).toBe(7);
    expect(() => evaluateFormula("process.exit()", {})).toThrow(CalcError);
    expect(() => evaluateFormula("constructor", {})).toThrow(/Unknown variable/);
    expect(formulaVariables("a * b + sqrt(c)").sort()).toEqual(["a", "b", "c"]);
  });

  it("supports linearity regression across levels", () => {
    const levels = [
      { key: "L1", reference: 1, values: [1.01, 0.99] },
      { key: "L2", reference: 2, values: [2.02, 1.98] },
      { key: "L3", reference: 3, values: [3.0, 3.02] },
    ];
    const slope = runCalculation({ kind: "linearity-slope", formula: "" }, { values: [], reference: null, levels });
    const r2 = runCalculation({ kind: "linearity-r2", formula: "" }, { values: [], reference: null, levels });
    expect(slope).toBeCloseTo(1.005, 6);
    expect(r2).toBeGreaterThan(0.999);
    expect(runCalculation({ kind: "max-level-abs-error", formula: "" }, { values: [], reference: null, levels })).toBeCloseTo(0.01, 10);
  });

  it("applies rounding rules and significant figures", () => {
    expect(roundDecimals(1.005, 2)).toBe(1.01);
    expect(roundDecimals(-2.345, 2)).toBe(-2.35);
    expect(roundSignificant(0.0123456, 3)).toBe(0.0123);
    expect(roundSignificant(12345, 2)).toBe(12000);
    expect(applyRounding(3.14159, { decimals: 2, significantFigures: null })).toBe(3.14);
  });
});

describe("generic execution evaluator", () => {
  const content = parseProtocolContent({
    identification: { title: "Generic", number: "GEN-1", protocolType: "PQ" },
    sections: [
      {
        key: "pq",
        title: "PQ",
        tests: [
          {
            key: "acc",
            name: "Accuracy",
            dataType: "reference-comparison",
            readingsRequired: 3,
            calculations: [{ key: "error", label: "Error", kind: "error", decimals: 3 }],
            criteria: [{ key: "c1", parameter: "error", comparison: "abs<=", tolerance: 0.02, sourceClass: "manufacturer", referenceId: "r1", verificationStatus: "verified", verificationEvidence: "Checked against manual" }],
          },
          {
            key: "rep",
            name: "Repeatability",
            dataType: "series",
            readingsRequired: 5,
            calculations: [{ key: "rsd", label: "RSD", kind: "rsd" }],
            criteria: [{ key: "c1", parameter: "rsd", comparison: "<=", sourceClass: "institutional", justification: "pending", verificationStatus: "pending-technical-verification" }],
          },
          { key: "dep", name: "Conditional", dataType: "numeric", readingsRequired: 1, dependency: { type: "conditional", testKey: "acc" }, criteria: [] },
        ],
      },
    ],
  });

  it("evaluates PASS/FAIL against verified criteria with execution-recorded reference values", () => {
    const pass = evaluateExecution(content, { acc: { readings: [10.01, 10.02, 10.0], reference: 10.0 } });
    expect(pass.tests[0].status).toBe("PASS");
    const fail = evaluateExecution(content, { acc: { readings: [10.05, 10.04, 10.06], reference: 10.0 } });
    expect(fail.tests[0].status).toBe("FAIL");
    expect(fail.overall).toBe("FAIL");
  });

  it("marks incomplete readings as INCOMPLETE instead of computing with zeros", () => {
    const r = evaluateExecution(content, { acc: { readings: [10.01, null, 10.0], reference: 10.0 } });
    expect(r.tests[0].status).toBe("INCOMPLETE");
    expect(r.tests[0].calculations[0].value).toBeNull();
  });

  it("never concludes compliance for criteria pending technical verification", () => {
    const r = evaluateExecution(content, { acc: { readings: [10, 10, 10], reference: 10 }, rep: { readings: [1, 1.01, 0.99, 1, 1] } });
    expect(r.tests[1].status).toBe("UNDER REVIEW");
    expect(r.tests[1].criteria[0].message).toMatch(/PENDING TECHNICAL VERIFICATION|not established/);
    expect(r.disclaimer).toMatch(/not an approval/);
  });

  it("applies conditional dependencies explicitly", () => {
    const r = evaluateExecution(content, { acc: { readings: [10.5, 10.5, 10.5], reference: 10 }, dep: { readings: [1] } });
    expect(r.tests[2].status).toBe("NOT APPLICABLE");
    expect(r.tests[2].notes[0]).toMatch(/condition/);
  });
});
