/**
 * Canonical nine-step workflow integration checks (master prompt §3, §7, §10).
 *
 * Verifies that every supplied device exposes the SAME nine labelled steps,
 * that no protocol test is omitted from the mapping, that inapplicable test
 * steps are never silently skipped, and that the Arabic equipment page title
 * is exactly the required string.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PACKAGE_PROTOCOLS } from "../shared/protocols/package8";
import { parseProtocolContent } from "../shared/protocols/model";
import {
  CANONICAL_STEP_KEYS,
  CANONICAL_STEP_LABELS,
  mapTestsToSteps,
  buildRunSteps,
  canonicalStepBlockers,
  isStepNotApplicable,
  naMeasurementKey,
} from "../shared/protocols/runWorkflow";

const root = fileURLToPath(new URL("..", import.meta.url));
const contents = PACKAGE_PROTOCOLS.map(p => ({ number: p.number, content: parseProtocolContent(p.content) }));

describe("unified nine-step controlled workflow", () => {
  it("uses the exact nine step numbers, labels and order for all eight devices", () => {
    expect(CANONICAL_STEP_KEYS).toEqual(["equipment", "protocol", "accuracy", "repeatability", "linearity", "results", "review", "approval", "pdf"]);
    const labels = CANONICAL_STEP_KEYS.map(k => CANONICAL_STEP_LABELS[k].label);
    expect(labels).toEqual(["Equipment Selection", "Protocol", "Accuracy", "Repeatability", "Linearity", "Results", "Review", "Approval", "PDF"]);
    for (const { number, content } of contents) {
      const steps = buildRunSteps(content);
      expect(steps.map(s => s.key), number).toEqual(CANONICAL_STEP_KEYS);
      expect(steps.map(s => s.label), number).toEqual(labels);
      expect(steps.map(s => s.labelAr).every(Boolean), number).toBe(true);
    }
  });

  it("maps every protocol test exactly once — no test, formula or criterion is omitted", () => {
    for (const { number, content } of contents) {
      const all = content.sections.flatMap(s => s.tests);
      const m = mapTestsToSteps(content);
      const mapped = [...m.accuracy, ...m.repeatability, ...m.linearity, ...m.results];
      expect(mapped.length, number).toBe(all.length);
      expect(new Set(mapped.map(t => t.key)).size, number).toBe(all.length);
      expect(mapped.map(t => t.key).sort(), number).toEqual(all.map(t => t.key).sort());
      // Criteria are the same objects — the mapping never rewrites acceptance limits.
      mapped.forEach(t => {
        const original = all.find(x => x.key === t.key)!;
        expect(t.criteria, `${number}/${t.key}`).toEqual(original.criteria);
        expect(t.calculations, `${number}/${t.key}`).toEqual(original.calculations);
      });
      const stepKeys = buildRunSteps(content).flatMap(s => s.testKeys);
      expect(stepKeys.sort(), number).toEqual(all.map(t => t.key).sort());
    }
  });

  it("assigns device-specific tests to the correct common step", () => {
    const byNumber = (n: string) => mapTestsToSteps(contents.find(c => c.number === n)!.content);
    expect(byNumber("CAL-QC-POL-001").accuracy.map(t => t.key)).toEqual(["T04"]);
    expect(byNumber("CAL-QC-POL-001").repeatability.map(t => t.key)).toEqual(["T05"]);
    expect(byNumber("CAL-QC-POL-001").linearity.map(t => t.key)).toEqual(["T06"]);
    expect(byNumber("CAL-QC-HPLC-001").accuracy.map(t => t.key)).toEqual(["T01", "T06"]);
    expect(byNumber("CAL-QC-HPLC-001").repeatability.map(t => t.key)).toEqual(["T05"]);
    expect(byNumber("CAL-QC-HPLC-001").linearity.map(t => t.key)).toEqual(["T07", "T08"]);
    expect(byNumber("CAL-QC-BAL-001").accuracy.map(t => t.key)).toEqual(["T03"]);
    expect(byNumber("CAL-QC-BAL-001").repeatability.map(t => t.key)).toEqual(["T04"]);
    expect(byNumber("CAL-QC-BAL-001").linearity.map(t => t.key)).toEqual(["T07"]);
  });

  it("never silently skips an inapplicable Accuracy / Repeatability / Linearity step", () => {
    const moa = contents.find(c => c.number === "CAL-QC-MOA-001")!.content;
    // MOA has neither an accuracy nor a linearity test.
    expect(mapTestsToSteps(moa).accuracy).toHaveLength(0);
    expect(mapTestsToSteps(moa).linearity).toHaveLength(0);
    const empty = canonicalStepBlockers(moa, {});
    expect(empty.map(b => b.code)).toEqual(expect.arrayContaining(["na-step-accuracy", "na-step-linearity"]));
    expect(empty.every(b => b.blocksRecording && b.blocksApproval)).toBe(true);

    const documented = {
      [naMeasurementKey("accuracy")]: { notApplicable: true, naJustification: "The supplied protocol defines no accuracy test for this device.", fields: { reviewerConfirmed: true } },
      [naMeasurementKey("linearity")]: { notApplicable: true, naJustification: "The supplied protocol defines no linearity test for this device.", fields: { reviewerConfirmed: true } },
    };
    expect(isStepNotApplicable(documented, "accuracy")).toBe(true);
    expect(isStepNotApplicable(documented, "linearity")).toBe(true);
    expect(canonicalStepBlockers(moa, documented).map(b => b.code)).not.toContain("na-step-accuracy");
    expect(canonicalStepBlockers(moa, documented).map(b => b.code)).not.toContain("na-step-linearity");
    // A justification alone is not enough — reviewer confirmation is mandatory.
    const unconfirmed = { [naMeasurementKey("accuracy")]: { notApplicable: true, naJustification: "No accuracy test in the supplied protocol." } };
    expect(canonicalStepBlockers(moa, unconfirmed).map(b => b.code)).toContain("na-step-accuracy");
  });

  it("uses the exact equipment page title (English: Equipment Settings) in navigation and on the page", () => {
    const home = readFileSync(`${root}client/src/pages/Home.tsx`, "utf8");
    const page = readFileSync(`${root}client/src/components/protocols/EquipmentDataPage.tsx`, "utf8");
    const exact = "Equipment Settings";
    expect(home).toContain(exact);
    expect(page).toContain(exact);
    expect(page).toContain(`export const EQUIPMENT_PAGE_TITLE = "${exact}"`);
    expect(home).not.toContain("تعديل بيانات المعدات والمواصفات");
  });
});
