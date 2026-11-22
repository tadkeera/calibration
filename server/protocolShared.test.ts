import { describe, expect, it } from "vitest";
import { ADP220_EXPECTED_EQUIPMENT, ADP220_PROTOCOL_NUMBER, ADP220_REFERENCES, adp220DraftContent, remapReferencePlaceholders } from "../shared/protocols/adp220";
import { compareContents, summarizeDiff } from "../shared/protocols/compare";
import { ALLOWED_STATUS_CHANGES, PENDING_LABEL, allCriteria, allTests, canonicalJson, collectReferenceIds, parseProtocolContent, type ProtocolContent } from "../shared/protocols/model";
import { BUILTIN_TEMPLATES, contentFromTemplate } from "../shared/protocols/templates";
import { approvalBlockers, structuralIssues, submissionIssues, type ReferenceLookup } from "../shared/protocols/validation";
import { DEFAULT_DUTIES, TRANSITIONS, availableActions, effectiveDuties, transitionDenial } from "../shared/protocols/workflow";

const equipment = { manufacturer: "Bellingham & Stanley (UK)", model: "ADP220", instrumentId: "QC-I-029", serialNumber: "PE99003" };
const refMap = Object.fromEntries(ADP220_REFERENCES.map(r => [r.placeholder, `ref-${r.code}`]));
const adp = () => parseProtocolContent(remapReferencePlaceholders(adp220DraftContent(equipment), refMap));
const lookup = (status: "verified" | "pending-verification"): ReferenceLookup =>
  new Map(ADP220_REFERENCES.map(r => [`ref-${r.code}`, { id: `ref-${r.code}`, code: r.code, title: r.title, verificationStatus: status, expiryDate: null, reviewDate: null }]));

describe("workflow rules", () => {
  it("maps existing roles to duties", () => {
    expect(DEFAULT_DUTIES.viewer).toEqual([]);
    expect(DEFAULT_DUTIES.user).toEqual(expect.arrayContaining(["technical-reviewer", "executor"]));
    // v4: Authorized Protocol Editor and Quality Manager are granted duties, never automatic for normal users.
    expect(DEFAULT_DUTIES.user).not.toContain("author");
    expect(DEFAULT_DUTIES.user).not.toContain("quality-manager");
    expect(effectiveDuties("user", ["author"])).toContain("author");
    expect(effectiveDuties("user", ["quality-manager"])).toEqual(expect.arrayContaining(["quality-manager", "author"]));
    expect(effectiveDuties("viewer", ["quality-manager"])).toEqual([]);
    expect(DEFAULT_DUTIES.admin).toContain("quality-manager");
    expect(DEFAULT_DUTIES.user).not.toContain("qa-approver");
    expect(effectiveDuties("user", ["qa-approver"])).toContain("qa-approver");
    expect(effectiveDuties("viewer", ["qa-approver"])).toEqual([]);
  });

  it("only defines transitions that the database also allows", () => {
    const allowed = new Set(ALLOWED_STATUS_CHANGES.map(([a, b]) => `${a}>${b}`));
    Object.values(TRANSITIONS).forEach(rule => rule.from.forEach(from => expect(allowed.has(`${from}>${rule.to}`)).toBe(true)));
  });

  it("enforces segregation of duties", () => {
    const rev = { status: "technical-review-pending" as const, authorUserId: 1, technicalReviewerUserId: null, qaApproverUserId: null };
    expect(transitionDenial("start-technical-review", rev, { id: 1, duties: ["author", "technical-reviewer"] })).toMatch(/Segregation/);
    expect(transitionDenial("start-technical-review", rev, { id: 2, duties: ["technical-reviewer"] })).toBeNull();
    const qa = { status: "qa-review-pending" as const, authorUserId: 1, technicalReviewerUserId: 2, qaApproverUserId: null };
    expect(transitionDenial("start-qa-review", qa, { id: 2, duties: ["qa-approver"] })).toMatch(/technical reviewer cannot/);
    expect(transitionDenial("start-qa-review", qa, { id: 3, duties: ["executor"] })).toMatch(/requires the qa-approver/);
    expect(transitionDenial("qa-approve", { ...qa, status: "draft" }, { id: 3, duties: ["qa-approver"] })).toMatch(/not allowed/);
    expect(availableActions({ status: "released", authorUserId: 1, technicalReviewerUserId: 2, qaApproverUserId: 3 }, { id: 4, duties: ["releaser"] })).toEqual(["retire"]);
  });
});

describe("validation", () => {
  it("detects duplicate keys, invalid formulas and circular/forward dependencies", () => {
    const c = parseProtocolContent({
      identification: { title: "X protocol", number: "X-1", protocolType: "custom" },
      sections: [
        { key: "s", title: "S", tests: [
          { key: "a", name: "A", dependency: { type: "sequential", testKey: "b" }, calculations: [{ key: "k", label: "K", kind: "custom", formula: "foo + (" }] },
          { key: "b", name: "B", calculations: [{ key: "k2", label: "K2", kind: "custom", formula: "unknownVar * 2" }] },
          { key: "b", name: "B again" },
        ] },
      ],
    });
    const msgs = structuralIssues(c).map(i => i.message).join("\n");
    expect(msgs).toMatch(/Duplicate test key "b"/);
    expect(msgs).toMatch(/Invalid formula/);
    expect(msgs).toMatch(/unknownVar/);
    expect(msgs).toMatch(/only depend on a test that appears earlier/);
  });

  it("requires a source or justification for every criterion and verification evidence when verified", () => {
    const c = parseProtocolContent({
      identification: { title: "X protocol", number: "X-1", protocolType: "custom", manufacturer: "M", model: "N" },
      narrative: { purpose: "p", scope: "s" },
      stages: ["OQ"],
      sections: [{ key: "s", title: "S", tests: [{ key: "a", name: "A", readingsRequired: 1, criteria: [{ key: "c", parameter: "reading", comparison: "<=", upper: 1, sourceClass: "manufacturer", verificationStatus: "verified" }] }] }],
    });
    const msgs = submissionIssues(c, new Map()).map(i => i.message).join("\n");
    expect(msgs).toMatch(/traceable reference or a documented technical justification/);
    expect(msgs).toMatch(/verification evidence must be documented/);
  });
});

describe("POL-QC-032D configuration (data, not code)", () => {
  it("matches §18 identification and uses the existing equipment record", () => {
    const c = adp();
    expect(c.identification).toMatchObject({ number: ADP220_PROTOCOL_NUMBER, title: "Polarimeter Qualification and Performance Verification Protocol", relatedForm: "QC-032B-01", model: "ADP220" });
    expect(c.equipmentLinks[0]).toMatchObject({ instrumentKey: ADP220_EXPECTED_EQUIPMENT.instrumentKey, instrumentId: "QC-I-029", serialNumber: "PE99003" });
    expect(c.stages).toEqual(expect.arrayContaining(["IQ", "OQ", "PQ"]));
  });

  it("contains the required IQ/OQ/PQ tests with no invented limits", () => {
    const c = adp();
    const keys = allTests(c).map(t => t.test.key);
    expect(keys).toEqual(expect.arrayContaining(["oq-zero", "oq-wavelength", "oq-temp-indication", "oq-temp-control", "pq-accuracy", "pq-repeatability", "pq-linearity"]));
    const test = (k: string) => allTests(c).find(t => t.test.key === k)!.test;
    expect(test("pq-repeatability").readingsRequired).toBeGreaterThanOrEqual(5);
    expect(test("pq-repeatability").criteria[0]).toMatchObject({ upper: null, lower: null, tolerance: null });
    expect(test("pq-linearity").levels.length).toBeGreaterThanOrEqual(3);
    test("pq-linearity").criteria.filter(cr => cr.parameter === "r2").forEach(cr => expect(cr).toMatchObject({ comparison: "record-only", lower: null, upper: null, tolerance: null }));
    expect(test("oq-zero").criteria[0].tolerance).toBeNull();
    expect(test("oq-temp-indication").fields.map(f => f.key)).toEqual(expect.arrayContaining(["thermometerId", "certificateNumber"]));
    expect(allCriteria(c).every(x => x.criterion.verificationStatus === "pending-technical-verification")).toBe(true);
    expect(c.intervals.every(i => i.verificationStatus !== "verified")).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/fully compliant|complies with USP/i);
  });

  it("documents the mandatory accuracy gap with both specifications and sources", () => {
    const gap = adp().gaps[0];
    expect(gap.specifications).toHaveLength(2);
    const text = JSON.stringify(gap);
    expect(text).toMatch(/0\.02/);
    expect(text).toMatch(/0\.01/);
    expect(gap.specifications.map(s => s.referenceId)).toEqual(expect.arrayContaining(["ref-BS-36-102", "ref-USP-781"]));
  });

  it("is submittable for technical review but cannot be approved while pending", () => {
    const c = adp();
    expect(submissionIssues(c, lookup("pending-verification")).filter(i => i.severity === "error")).toEqual([]);
    const blockers = approvalBlockers(c, { references: lookup("pending-verification"), gapDecisions: new Map(), openCommentCount: 0, today: "2026-11-18" }).join("\n");
    expect(blockers).toMatch(new RegExp(PENDING_LABEL));
    expect(blockers).toMatch(/no recorded technical reviewer decision/);
    expect(blockers).toMatch(/USP-781 is pending-verification/);
  });

  it("links every reference placeholder to the library", () => {
    const ids = collectReferenceIds(adp());
    expect(ids.every(id => id.startsWith("ref-"))).toBe(true);
    expect(JSON.stringify(adp())).not.toMatch(/"@(USP781|USP1058|MANUAL|CERTS)"/);
  });
});

describe("templates and comparison", () => {
  it("templates contain structure only — no limits, references or verification claims", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    BUILTIN_TEMPLATES.forEach(t => {
      const c = contentFromTemplate(t.structure, { title: "From template", number: "TPL-1", protocolType: "custom" });
      allCriteria(c).forEach(({ criterion }) => {
        expect([criterion.lower, criterion.upper, criterion.target, criterion.tolerance]).toEqual([null, null, null, null]);
        expect(criterion.verificationStatus).not.toBe("verified");
      });
      expect(c.intervals).toEqual([]);
      expect(collectReferenceIds(c)).toEqual([]);
    });
  });

  it("strips limits even when a stored template contains them", () => {
    const c = contentFromTemplate({ sections: [{ key: "s", title: "S", tests: [{ key: "t", name: "T", criteria: [{ key: "c", parameter: "reading", comparison: "<=", upper: 5, sourceClass: "manufacturer", verificationStatus: "verified" }] }] }] }, { title: "From template", number: "TPL-2", protocolType: "custom" });
    expect(allCriteria(c)[0].criterion.upper).toBeNull();
  });

  it("produces a structured diff between revisions", () => {
    const a = adp();
    const b: ProtocolContent = JSON.parse(JSON.stringify(a));
    b.sections[2].tests[1].readingsRequired = 10;
    b.sections[2].tests[0].criteria[0].tolerance = 0.015;
    b.intervals[0].value = 3;
    const diff = compareContents(a, b);
    expect(diff.some(d => d.entity === "reading-count")).toBe(true);
    expect(diff.some(d => d.entity === "criterion" && d.change === "modified")).toBe(true);
    expect(diff.some(d => d.entity === "interval")).toBe(true);
    expect(Object.values(summarizeDiff(diff)).reduce((a, b) => a + b, 0)).toBe(diff.length);
    expect(compareContents(a, JSON.parse(canonicalJson(a)))).toEqual([]);
  });
});
