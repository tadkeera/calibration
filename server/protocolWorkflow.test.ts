/**
 * v3 integration tests: 8-protocol package import, equipment data &
 * specifications (field-level audit, propagation), dynamic calibration runs
 * (snapshots, draft conflicts, version history) — real SQLite store + guards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { closeLocalDatabase, createLocalUser, localConnection } from "./localDb";
import * as svc from "./protocols/service";
import * as wf from "./protocols/workflowService";
import { sqliteProtocolStore } from "./protocols/sqliteStore";
import { BAL_REV01_SPEC_SOURCES, PACKAGE_PROTOCOLS, PACKAGE_REFERENCES } from "../shared/protocols/package8";
import { remapReferencePlaceholders } from "../shared/protocols/adp220";
import { readFileSync } from "node:fs";
import { ALLOWED_STATUS_CHANGES } from "../shared/protocols/model";

const balRev01 = JSON.parse(readFileSync(new URL("./fixtures/bal-rev01-content.json", import.meta.url), "utf8")) as { sourceRevision: string; content: unknown };
import { allCriteria, type ProtocolContentInput } from "../shared/protocols/model";
import type { EquipmentIdentity } from "../shared/protocols/equipment";

const testDatabase = "/tmp/miayar-workflow.test.sqlite";
const PW = "workflow-test-password-1";
let admin: svc.Actor, author: svc.Actor, tech: svc.Actor, qa: svc.Actor, executor2: svc.Actor, viewer: svc.Actor;

async function user(email: string, name: string, role: "admin" | "user" | "viewer"): Promise<svc.Actor> {
  const u = await createLocalUser({ email, password: PW, name, role });
  return { id: u.id, name: u.name, role, email };
}
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error("expected rejection");
};
const protocolByNumber = async (n: string) => (await svc.listProtocols({ search: n })).rows.find(r => r.protocolNumber === n)!;

describe("calibration workflow v3 (SQLite store)", () => {
  beforeAll(async () => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    admin = await user("admin@wf.test", "Admin", "admin");
    author = await user("author@wf.test", "Author", "user");
    tech = await user("tech@wf.test", "Tech", "user");
    qa = await user("qa@wf.test", "QA", "user");
    executor2 = await user("exec2@wf.test", "Executor Two", "user");
    viewer = await user("viewer@wf.test", "Viewer", "viewer");
    await svc.setDuty(admin, { userId: qa.id, duty: "qa-approver", granted: true, reason: "QA department" });
    await svc.setDuty(admin, { userId: qa.id, duty: "releaser", granted: true, reason: "Document control" });
  });

  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    delete process.env.QC_STORAGE_MODE;
  });

  it("reports core and workflow schema as provisioned", async () => {
    const status = await svc.moduleStatus();
    expect(status.ok).toBe(true);
    expect(status.workflowOk).toBe(true);
  });

  it("imports the 8 protocols as DRAFTS with pending criteria, links equipment, creates the balance, and is idempotent", async () => {
    expect((await errorOf(wf.importCalibrationPackage(viewer))).code).toBe("FORBIDDEN");
    const first = await wf.importCalibrationPackage(author);
    expect(first.failed).toBe(0);
    expect(first.created).toBe(8);
    expect(first.lines.map(l => [l.protocolNumber, l.tests])).toEqual([
      ["CAL-QC-HPLC-001", 10], ["CAL-QC-POL-001", 6], ["CAL-QC-BAL-001", 9], ["CAL-QC-MOA-001", 6],
      ["CAL-QC-DIS-001", 7], ["CAL-QC-DISINT-001", 7], ["CAL-QC-REF-001", 6], ["CAL-QC-UV-001", 8],
    ]);
    // HPLC.pdf documents an LC-2030 PLUS; the registered HPLC is LC-40B XR → not linked (conflict preserved as a gap).
    expect(first.lines.find(l => l.protocolNumber === "CAL-QC-HPLC-001")!.linkedEquipment).toBeNull();
    expect(first.lines.find(l => l.protocolNumber === "CAL-QC-BAL-001")!.linkedEquipment).toMatch(/QC-I-074.*ED224S.*23304057/);
    expect(first.lines.filter(l => l.linkedEquipment).length).toBe(7);
    const balance = (await wf.listEquipmentData()).find(e => e.instrumentKey === "balance")!;
    expect(balance.identity).toMatchObject({ instrumentId: "QC-I-074", model: "ED224S", serialNumber: "23304057" });
    expect(balance.specs.capacity).toMatchObject({ value: 220, unit: "g" });
    expect(balance.specs.readability).toMatchObject({ value: 0.0001, unit: "g" });
    for (const line of first.lines) {
      const rev = await svc.getRevision(admin, line.revisionId!);
      expect(rev.revision.status).toBe("draft");
      expect(allCriteria(rev.revision.content).every(c => c.criterion.verificationStatus === "pending-technical-verification")).toBe(true);
    }
    const bal = await svc.getRevision(admin, first.lines[2].revisionId!);
    expect(bal.revision.content.gaps.map(g => g.key)).toEqual(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10"]);
    expect(balance.specs.mfrRepeatability.source).toMatch(/^UNVERIFIED/);
    const t04 = bal.revision.content.sections[1].tests.find(t => t.key === "T04")!;
    expect(t04.readingsRequired).toBe(10);
    // POL-QC-032D is not touched; a second import never overwrites.
    const again = await wf.importCalibrationPackage(author);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(8);
    expect(again.referencesCreated).toEqual([]);
    expect(again.notes.join(" ")).toMatch(/QC-I-074: already registered/);
  });

  it("validates equipment edits: reason for critical fields, duplicates, units — and logs every field", async () => {
    const eq = (await wf.listEquipmentData()).find(e => e.instrumentKey === "refractometer")!;
    const base = { instrumentKey: "refractometer", expectedSpecsRowVersion: eq.specsRowVersion, identity: { ...eq.identity }, specs: { ...eq.specs }, reason: "", reference: "" };
    expect((await errorOf(wf.updateEquipmentData(viewer, base))).code).toBe("FORBIDDEN");
    expect((await errorOf(wf.updateEquipmentData(author, { ...base, specs: { resolution: { value: 0.0001, unit: "nD", source: "manual" } } }))).message).toMatch(/reason/);
    expect((await errorOf(wf.updateEquipmentData(author, { ...base, identity: { ...eq.identity, instrumentId: "QC-I-029" }, reason: "typo fix" }))).message).toMatch(/already used/);
    expect((await errorOf(wf.updateEquipmentData(author, { ...base, specs: { rangeMax: { value: 1.7, unit: "%", source: "" } } }))).message).toMatch(/unit must be one of/);
    const ok = await wf.updateEquipmentData(author, { ...base, specs: { rangeMin: { value: 1.3, unit: "nD", source: "Manufacturer data sheet" }, location: { value: "QC lab 2", unit: "", source: "" } } });
    expect(ok.changed).toBe(2);
    const detail = await wf.getEquipmentData("refractometer");
    expect(detail.changes.map(c => c.field).sort()).toEqual(["spec.location", "spec.rangeMin"]);
    expect(detail.changes[0]).toMatchObject({ actorName: "Author" });
    // stale version → conflict, nothing overwritten
    expect((await errorOf(wf.updateEquipmentData(author, { ...base, specs: { rangeMin: { value: 1.2, unit: "nD", source: "" } } }))).message).toMatch(/changed by another user/);
    // the change log is immutable
    expect(() => localConnection().prepare("UPDATE protocol_equipment_changes SET reason = 'x'").run()).toThrow(/append-only/);
    expect(() => localConnection().prepare("DELETE FROM protocol_equipment_specs").run()).toThrow(/not permitted/);
  });

  let runId = "";
  it("creates a run with the canonical nine-step workflow and a frozen equipment snapshot", async () => {
    const catalog = await wf.runCatalog();
    const steps = Object.fromEntries(catalog.map(c => [c.protocolNumber, c.stepCount]));
    expect(steps["CAL-QC-HPLC-001"]).toBe(9);
    expect(steps["CAL-QC-POL-001"]).toBe(9);
    expect(steps["CAL-QC-BAL-001"]).toBe(9);
    const ref = await protocolByNumber("CAL-QC-REF-001");
    expect((await errorOf(wf.createRun(viewer, { protocolId: ref.id, instrumentKey: "refractometer" }))).code).toBe("FORBIDDEN");
    expect((await errorOf(wf.createRun(author, { protocolId: ref.id, instrumentKey: "polarimeter" }))).message).toMatch(/not linked/);
    const created = await wf.createRun(author, { protocolId: ref.id, instrumentKey: "refractometer" });
    runId = created.runId;
    const run = await wf.getRun(author, runId);
    expect(run.steps.map(s => s.key)).toEqual(["equipment", "protocol", "accuracy", "repeatability", "linearity", "results", "review", "approval", "pdf"]);
    expect(run.run.equipmentSnapshot.specs.rangeMin).toMatchObject({ value: 1.3 });
    expect(run.blockers.map(b => b.code)).toEqual(expect.arrayContaining(["revision-not-released", "pending-verification", "incomplete"]));
    expect(run.evaluation.overall).toBe("INCOMPLETE");
  });

  it("saves drafts with version history, rejects stale saves (both versions kept) and never yields PASS on pending criteria", async () => {
    const run = await wf.getRun(author, runId);
    const m1 = { T05: { fields: { resolution: 0.0001, zero_cert: 1.333, zero_read: 1.3331, range_ok: true } } };
    const s1 = await wf.saveRun(author, { runId, expectedRowVersion: run.run.rowVersion, measurements: m1, currentStep: "test:T05" });
    expect(s1.rowVersion).toBe(2);
    const t05 = s1.evaluation.tests.find(t => t.testKey === "T05")!;
    expect(t05.status).toBe("UNDER REVIEW");
    expect(t05.calculations.find(c => c.key === "zero_dev")!.value).toBeCloseTo(0.0001, 6);
    // A second executor working from version 1 cannot overwrite version 2.
    // executor2 is a "user": the executor duty is derived from the base role.
    const stale = await errorOf(wf.saveRun(executor2, { runId, expectedRowVersion: 1, measurements: { T02: { fields: { setpoint: 20, actual: 20.1, thermo_cert: "TH-1" } } } }));
    expect(stale.message).toMatch(/DRAFT_CONFLICT/);
    const merged = await wf.saveRun(executor2, { runId, expectedRowVersion: 2, measurements: { ...m1, T02: { fields: { setpoint: 20, actual: 20.1, thermo_cert: "TH-1" } } }, reason: "Merged after draft conflict" });
    expect(merged.rowVersion).toBe(3);
    const detail = await wf.getRun(author, runId);
    expect(detail.history.map(h => h.action)).toEqual(["merged", "saved", "created"]);
    expect((await wf.runVersion(runId, 2)).measurements).toEqual(m1);
    expect(() => localConnection().prepare("UPDATE protocol_run_snapshots SET reason = 'x'").run()).toThrow(/append-only/);
    expect(() => localConnection().prepare("UPDATE protocol_runs SET equipment_snapshot = '{}' WHERE id = ?").run(runId)).toThrow(/immutable/);
    // Unknown tests are rejected; draft (non-released) runs cannot be formally recorded.
    expect((await errorOf(wf.saveRun(author, { runId, expectedRowVersion: 3, measurements: { X99: {} } }))).message).toMatch(/not part of this protocol/);
    expect((await errorOf(wf.recordRun(author, { runId, expectedRowVersion: 3 }))).message).toMatch(/RELEASED/);
  });

  it("propagates identity changes to linked drafts (audited), keeps run snapshots and shows a newer-data notice", async () => {
    const eq = (await wf.listEquipmentData()).find(e => e.instrumentKey === "refractometer")!;
    const identity: EquipmentIdentity = { ...eq.identity, serialNumber: "BT98350-R" };
    expect((await errorOf(wf.updateEquipmentData(author, { instrumentKey: "refractometer", expectedSpecsRowVersion: eq.specsRowVersion, identity, specs: eq.specs, reason: "", reference: "" }))).message).toMatch(/reason/);
    const res = await wf.updateEquipmentData(author, { instrumentKey: "refractometer", expectedSpecsRowVersion: eq.specsRowVersion, identity, specs: eq.specs, reason: "Nameplate re-read after service", reference: "Service report SR-12" });
    expect(res.propagated).toEqual(["CAL-QC-REF-001 rev 1"]);
    expect(res.outdatedRuns).toBe(1);
    const ref = await protocolByNumber("CAL-QC-REF-001");
    const detail = await svc.getProtocolDetail(ref.id);
    const rev = await svc.getRevision(admin, detail.protocol.currentRevisionId!);
    expect(rev.revision.content.equipmentLinks[0].serialNumber).toBe("BT98350-R");
    const audit = await svc.listAudit({ protocolId: ref.id });
    expect(audit.some(a => a.action === "equipment.link-synced")).toBe(true);
    const run = await wf.getRun(author, runId);
    expect(run.run.equipmentSnapshot.identity.serialNumber).toBe("BT98350");
    expect(run.newerEquipmentData).toBe(true);
    expect(run.blockers.map(b => b.code)).toContain("equipment-identity-changed");
    const log = await wf.getEquipmentData("refractometer");
    expect(log.changes[0]).toMatchObject({ field: "serialNumber", previous: "BT98350", next: "BT98350-R", critical: true, reason: "Nameplate re-read after service", reference: "Service report SR-12" });
    // restore the identity so later tests use the registered data
    const eq2 = (await wf.listEquipmentData()).find(e => e.instrumentKey === "refractometer")!;
    await wf.updateEquipmentData(author, { instrumentKey: "refractometer", expectedSpecsRowVersion: eq2.specsRowVersion, identity: { ...eq2.identity, serialNumber: "BT98350" }, specs: eq2.specs, reason: "Revert test change", reference: "" });
  });

  it("abandons runs with a reason and retires (never deletes) equipment", async () => {
    const run = await wf.getRun(author, runId);
    expect((await errorOf(wf.abandonRun(author, { runId, expectedRowVersion: run.run.rowVersion, reason: "" }))).message).toMatch(/reason/);
    await wf.abandonRun(author, { runId, expectedRowVersion: run.run.rowVersion, reason: "Training run" });
    expect((await errorOf(wf.saveRun(author, { runId, expectedRowVersion: run.run.rowVersion + 1, measurements: {} }))).message).toMatch(/abandoned/);
    const created = await wf.createEquipmentData(author, { instrumentKey: "spare-balance", equipmentType: "balance", identity: { instrumentId: "QC-I-999", manufacturer: "Maker", model: "M1", serialNumber: "S1", nameEn: "Spare balance", nameAr: "ميزان احتياطي", sopNumber: "", formNumber: "" }, specs: { capacity: { value: 100, unit: "g", source: "test" } }, reason: "Test equipment", reference: "" });
    expect(created.instrumentKey).toBe("spare-balance");
    const spare = (await wf.listEquipmentData()).find(e => e.instrumentKey === "spare-balance")!;
    await wf.retireEquipmentData(author, { instrumentKey: "spare-balance", expectedSpecsRowVersion: spare.specsRowVersion, reason: "Out of service" });
    const retired = (await wf.listEquipmentData()).find(e => e.instrumentKey === "spare-balance")!;
    expect(retired.status).toBe("retired");
    expect((await errorOf(wf.updateEquipmentData(author, { instrumentKey: "spare-balance", expectedSpecsRowVersion: retired.specsRowVersion, identity: retired.identity, specs: {}, reason: "x", reference: "" }))).message).toMatch(/Retired/);
  });

  it("records a run on a RELEASED, verified protocol through the existing execution review workflow", async () => {
    const res = await svc.saveReference(admin, { code: "MAN-WF", title: "Manufacturer manual", issuer: "Maker", referenceType: "manufacturer-manual", documentNumber: "1", edition: "1", revision: "", publicationDate: "", effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: "", documentUrl: "", applicableSection: "", applicableClause: "", verificationStatus: "verified", notes: "", reason: "setup" });
    const content: ProtocolContentInput = {
      identification: { title: "Generic released polarimeter check", number: "GEN-RUN-001", protocolType: "PQ", manufacturer: "Bellingham & Stanley", model: "ADP220", associationType: "model" },
      narrative: { purpose: "Verify", scope: "ADP220" },
      stages: ["PQ"],
      risk: { overall: "medium", justification: "Quantitative release testing instrument" },
      references: [{ referenceId: res.id, supports: "Tolerance" }],
      sections: [{ key: "pq", title: "PQ", tests: [{ key: "acc", name: "Accuracy", dataType: "reference-comparison", readingsRequired: 3, calculations: [{ key: "error", label: "Error", kind: "error", decimals: 3 }], criteria: [{ key: "c1", parameter: "error", comparison: "abs<=", tolerance: 0.02, sourceClass: "manufacturer", referenceId: res.id, verificationStatus: "verified", verificationEvidence: "Manual §5" }] }] }],
    };
    const { protocolId, revisionId } = await svc.createProtocol(author, { content, reason: "test" });
    const rv = async () => (await svc.getRevision(admin, revisionId)).revision.rowVersion;
    await svc.transition(author, { password: PW, revisionId, expectedRowVersion: await rv(), action: "submit-technical-review" });
    await svc.transition(tech, { password: PW, revisionId, expectedRowVersion: await rv(), action: "start-technical-review" });
    await svc.transition(tech, { password: PW, revisionId, expectedRowVersion: await rv(), action: "complete-technical-review", attestation: true, comment: "Technical review complete" });
    await svc.transition(author, { password: PW, revisionId, expectedRowVersion: await rv(), action: "submit-qa-review" });
    await svc.transition(qa, { password: PW, revisionId, expectedRowVersion: await rv(), action: "start-qa-review" });
    await svc.transition(qa, { password: PW, revisionId, expectedRowVersion: await rv(), action: "qa-approve", attestation: true, comment: "Approved after review" });
    await svc.transition(qa, { password: PW, revisionId, expectedRowVersion: await rv(), action: "release", effectiveDate: new Date().toISOString().slice(0, 10) });
    const { runId: rid } = await wf.createRun(author, { protocolId, instrumentKey: "polarimeter" });
    // Canonical nine-step rule: steps without a configured test must be documented, never silently skipped.
    const undocumented = await wf.getRun(author, rid);
    expect(undocumented.blockers.filter(b => b.blocksRecording).map(b => b.code)).toEqual(expect.arrayContaining(["na-step-repeatability", "na-step-linearity"]));
    const na = (why: string) => ({ notApplicable: true, naJustification: why, fields: { reviewerConfirmed: true } });
    const saved = await wf.saveRun(author, { runId: rid, expectedRowVersion: 1, measurements: {
      acc: { readings: [10.01, 10.0, 10.02], reference: 10 },
      "_na:repeatability": na("This released check protocol defines no repeatability test; repeatability is covered by the site qualification SOP."),
      "_na:linearity": na("This released check protocol defines no linearity test; the intended use of this check is identification only."),
    } });
    expect(saved.evaluation.overall).toBe("PASS");
    const before = await wf.getRun(author, rid);
    expect(before.blockers.filter(b => b.blocksRecording)).toEqual([]);
    const rec = await wf.recordRun(author, { runId: rid, expectedRowVersion: saved.rowVersion, comments: "Routine" });
    const exec = await svc.getExecution(admin, rec.executionId);
    expect(exec.reviewStatus).toBe("recorded");
    const after = await wf.getRun(author, rid);
    expect(after.run.status).toBe("recorded");
    expect(after.execution?.reviewStatus).toBe("recorded");
    expect((await errorOf(wf.saveRun(author, { runId: rid, expectedRowVersion: after.run.rowVersion, measurements: {} }))).message).toMatch(/immutable/);
    expect(() => localConnection().prepare("UPDATE protocol_runs SET measurements = '{}' WHERE id = ?").run(rid)).toThrow(/immutable/);
    // segregation of duties remains enforced by the existing execution review
    expect((await errorOf(svc.reviewExecution(author, { executionId: rec.executionId, action: "review", comment: "Self review", password: PW }))).message).toMatch(/segregation|own execution|executor/i);
  });

  it("adopts CAL-QC-BAL-001 Rev.03 over an existing Rev.01 draft and over a released Rev.01, preserving history", async () => {
    // Recreate the state left by PR #6: BAL revision 1 holds the Rev.01 content; balance specs carry the Rev.01 sources.
    const { rows: refRows } = await svc.internals.referenceLookup();
    const map = Object.fromEntries(PACKAGE_REFERENCES.map(r => [r.placeholder, refRows.find(x => x.code === r.code)?.id]).filter(([, v]) => v)) as Record<string, string>;
    const balRow = await protocolByNumber("CAL-QC-BAL-001");
    const detail0 = await svc.getProtocolDetail(balRow.id);
    const rev1 = await svc.getRevision(admin, detail0.protocol.currentRevisionId!);
    const rev01Content = remapReferencePlaceholders(balRev01.content as never, map) as ProtocolContentInput;
    (rev01Content as { equipmentLinks: unknown }).equipmentLinks = rev1.revision.content.equipmentLinks;
    await svc.saveDraft(author, { revisionId: rev1.revision.id, expectedRowVersion: rev1.revision.rowVersion, content: rev01Content, reason: "Test fixture: Rev.01 content as imported by PR #6" });
    const eq0 = (await wf.listEquipmentData()).find(e => e.instrumentKey === "balance")!;
    const rev01Specs = Object.fromEntries(Object.entries(eq0.specs).map(([k, v]) => [k, BAL_REV01_SPEC_SOURCES[k] ? { ...v, source: BAL_REV01_SPEC_SOURCES[k].source } : v]));
    rev01Specs.panDiameter = { value: 80, unit: "mm", source: "Nameplate read by user" }; // a user edit that must be left alone
    await wf.updateEquipmentData(author, { instrumentKey: "balance", expectedSpecsRowVersion: eq0.specsRowVersion, identity: eq0.identity, specs: rev01Specs, reason: "Test fixture: Rev.01 sources", reference: "" });
    const before = await svc.getRevision(admin, rev1.revision.id);
    expect(before.revision.content.gaps.map(g => g.key)).toEqual(["B1", "B2"]);

    expect((await errorOf(wf.adoptBalanceRev03(viewer))).code).toBe("FORBIDDEN");
    // 1) Open draft → content replaced in place through the audited draft save.
    const a = await wf.adoptBalanceRev03(author);
    expect(a).toMatchObject({ outcome: "updated-draft", revisionNumber: 1, linkedEquipment: expect.stringMatching(/QC-I-074/) });
    expect(a.referencesCreated).toEqual([]); // already seeded by the package import
    expect(a.equipmentSpecsRelabelled.sort()).toEqual(Object.keys(BAL_REV01_SPEC_SOURCES).filter(k => k !== "panDiameter").sort());
    const after = await svc.getRevision(admin, rev1.revision.id);
    expect(after.revision.content.sections.flatMap(x => x.tests).map(t => t.key)).toEqual(["DQ", "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"]);
    expect(after.revision.content.identification.description).toMatch(/CAL-QC-BAL-001_Rev03_DRAFT_Expanded\.pdf/);
    expect(after.revision.content.equipmentLinks).toEqual(rev1.revision.content.equipmentLinks);
    expect(after.revision.status).toBe("draft");
    const audit = await svc.listAudit({ protocolId: balRow.id });
    expect(audit.find(x => x.action === "revision.content-updated" && /Rev\.03/.test(x.reason ?? ""))).toBeTruthy();
    const eq1 = (await wf.listEquipmentData()).find(e => e.instrumentKey === "balance")!;
    expect(eq1.specs.mfrRepeatability).toMatchObject({ value: 0.0001, source: expect.stringMatching(/^UNVERIFIED/) });
    expect(eq1.specs.panDiameter).toEqual({ value: 80, unit: "mm", source: "Nameplate read by user" });
    // Idempotent.
    expect((await wf.adoptBalanceRev03(author)).outcome).toBe("already-current");

    // 2) Released Rev.01 → kept unchanged; Rev.03 goes into a NEW draft revision.
    //    Fixture: put Rev.01 back, then walk revision 1 through the allowed status chain to "released".
    const cur = await svc.getRevision(admin, rev1.revision.id);
    await svc.saveDraft(author, { revisionId: rev1.revision.id, expectedRowVersion: cur.revision.rowVersion, content: rev01Content, reason: "Test fixture: back to Rev.01" });
    const db = localConnection();
    const chain = ["draft", "technical-review-pending", "technical-review-in-progress", "technically-reviewed", "qa-review-pending", "qa-review-in-progress", "approved", "released"];
    chain.slice(1).forEach((to, i) => {
      expect(ALLOWED_STATUS_CHANGES.some(([x, y]) => x === chain[i] && y === to)).toBe(true);
      db.prepare(`UPDATE protocol_revisions SET status = ?, locked = ? WHERE id = ?`).run(to, ["approved", "released"].includes(to) ? 1 : 0, rev1.revision.id);
    });
    db.prepare(`UPDATE protocols SET status = 'released', released_revision_id = ?, released_revision_number = 1 WHERE id = ?`).run(rev1.revision.id, balRow.id);
    const releasedHash = (await svc.getRevision(admin, rev1.revision.id)).revision.contentHash;
    const b = await wf.adoptBalanceRev03(author);
    expect(b).toMatchObject({ outcome: "new-revision", revisionNumber: 2, previousRevisionNumber: 1 });
    const old = await svc.getRevision(admin, rev1.revision.id);
    expect(old.revision.status).toBe("released");
    expect(old.revision.contentHash).toBe(releasedHash);
    expect(old.revision.content.gaps.map(g => g.key)).toEqual(["B1", "B2"]);
    const r2 = await svc.getRevision(admin, b.revisionId);
    expect(r2.revision.status).toBe("draft");
    expect(r2.revision.content.gaps.map(g => g.key)).toContain("B10");
    expect(r2.revision.content.equipmentLinks).toEqual(rev1.revision.content.equipmentLinks);
    expect((await wf.adoptBalanceRev03(author)).outcome).toBe("already-current");
    expect(balRev01.sourceRevision).toBe("01");
  });

  it("keeps the package definitions in register order", () => {
    expect(PACKAGE_PROTOCOLS.map(p => p.number)).toEqual(["CAL-QC-HPLC-001", "CAL-QC-POL-001", "CAL-QC-BAL-001", "CAL-QC-MOA-001", "CAL-QC-DIS-001", "CAL-QC-DISINT-001", "CAL-QC-REF-001", "CAL-QC-UV-001"]);
  });
});
