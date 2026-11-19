/**
 * Integration tests for the Protocol Management backend authority using the
 * real SQLite store (same change-set semantics as the Supabase RPC) and the
 * database-level guard triggers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { closeLocalDatabase, createLocalUser, localConnection } from "./localDb";
import * as svc from "./protocols/service";
import { sqliteProtocolStore } from "./protocols/sqliteStore";
import { ADP220_PROTOCOL_NUMBER } from "../shared/protocols/adp220";
import { PENDING_LABEL, allCriteria, type ProtocolContentInput } from "../shared/protocols/model";

const testDatabase = "/tmp/miayar-protocols.test.sqlite";
let admin: svc.Actor, author: svc.Actor, tech: svc.Actor, qa: svc.Actor, viewer: svc.Actor, other: svc.Actor;

async function user(email: string, name: string, role: "admin" | "user" | "viewer"): Promise<svc.Actor> {
  const u = await createLocalUser({ email, password: "protocol-test-password-1", name, role });
  return { id: u.id, name: u.name, role };
}

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string; details?: unknown };
  }
  throw new Error("expected rejection");
};

let refId = "";
function genericContent(number = "GEN-POL-001"): ProtocolContentInput {
  return {
    identification: { title: "Generic polarimeter performance check", number, protocolType: "PQ", manufacturer: "Bellingham & Stanley", model: "ADP220", equipmentCategory: "Optical", associationType: "model" },
    narrative: { purpose: "Verify optical rotation accuracy", scope: "Polarimeters of model ADP220" },
    stages: ["PQ"],
    risk: { overall: "medium", justification: "Quantitative release testing instrument" },
    references: [{ referenceId: refId, supports: "Accuracy tolerance" }],
    intervals: [{ key: "pr", activity: "Periodic Review", value: 12, unit: "months", justification: "Institutional periodic review", sourceClass: "institutional", verificationStatus: "verified" }],
    sections: [
      {
        key: "pq",
        title: "Performance Qualification",
        tests: [
          {
            key: "acc",
            name: "Accuracy against reference plate",
            dataType: "reference-comparison",
            readingsRequired: 3,
            calculations: [{ key: "error", label: "Error", kind: "error", decimals: 3 }],
            criteria: [{ key: "c1", parameter: "error", comparison: "abs<=", tolerance: 0.02, sourceClass: "manufacturer", referenceId: refId, verificationStatus: "verified", verificationEvidence: "Verified against manual §5" }],
          },
        ],
      },
    ],
  };
}

describe("protocol management service (SQLite store)", () => {
  beforeAll(async () => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    admin = await user("admin@proto.test", "Admin", "admin");
    author = await user("author@proto.test", "Author", "user");
    tech = await user("tech@proto.test", "Tech", "user");
    qa = await user("qa@proto.test", "QA", "user");
    other = await user("other@proto.test", "Other", "user");
    viewer = await user("viewer@proto.test", "Viewer", "viewer");
    await svc.setDuty(admin, { userId: qa.id, duty: "qa-approver", granted: true, reason: "QA department" });
    await svc.setDuty(admin, { userId: qa.id, duty: "releaser", granted: true, reason: "Document control" });
    const res = await svc.saveReference(admin, { code: "MAN-1", title: "Manufacturer manual", issuer: "Maker", referenceType: "manufacturer-manual", documentNumber: "36-102", edition: "3.1", revision: "", publicationDate: "2004-02", effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: "", documentUrl: "", applicableSection: "Specifications", applicableClause: "", verificationStatus: "verified", notes: "", reason: "Library setup" });
    refId = res.id;
  });

  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    delete process.env.QC_STORAGE_MODE;
  });

  it("reports the module schema as provisioned", async () => {
    const status = await svc.moduleStatus();
    expect(status.ok).toBe(true);
  });

  it("enforces RBAC: viewers cannot author and duty grants require settings-admin", async () => {
    expect((await errorOf(svc.createProtocol(viewer, { content: genericContent("V-1"), reason: "x" }))).code).toBe("FORBIDDEN");
    expect((await errorOf(svc.setDuty(author, { userId: author.id, duty: "qa-approver", granted: true, reason: "self grant" }))).code).toBe("FORBIDDEN");
    expect((await svc.getMe(qa)).duties).toContain("qa-approver");
  });

  let protocolId = "";
  let revisionId = "";
  const rv = async () => (await svc.getRevision(admin, revisionId)).revision.rowVersion;

  it("creates a draft, saves changes with audit and rejects stale row versions", async () => {
    const created = await svc.createProtocol(author, { content: genericContent(), reason: "New protocol" });
    protocolId = created.protocolId;
    revisionId = created.revisionId;
    expect((await errorOf(svc.createProtocol(author, { content: genericContent(), reason: "dup" }))).message).toMatch(/already/i);
    const content = genericContent();
    content.narrative = { purpose: "Verify optical rotation accuracy and repeatability", scope: "Polarimeters of model ADP220" };
    const saved = await svc.saveDraft(author, { revisionId, expectedRowVersion: 1, content, reason: "Clarify purpose" });
    expect(saved.rowVersion).toBe(2);
    expect((await errorOf(svc.saveDraft(author, { revisionId, expectedRowVersion: 1, content, reason: "stale" }))).code).toBe("PRECONDITION_FAILED");
    const audit = await svc.listAudit({ protocolId });
    const update = audit.find(a => a.action === "revision.content-updated");
    expect(update).toBeTruthy();
    expect(JSON.stringify(update?.previousValue)).toMatch(/Verify optical rotation accuracy/);
    expect(update?.reason).toBe("Clarify purpose");
  });

  it("blocks execution of non-released revisions", async () => {
    const e = await errorOf(svc.executeProtocol(author, { revisionId, instrumentKey: "polarimeter", measurements: { acc: { readings: [1, 1, 1], reference: 1 } } }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toMatch(/Only RELEASED/);
  });

  it("enforces segregation of duties and the full review → approval → release workflow", async () => {
    await svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-technical-review" });
    // duplicate submission with the stale version is rejected
    expect((await errorOf(svc.transition(author, { revisionId, expectedRowVersion: 2, action: "submit-technical-review" }))).code).toBe("PRECONDITION_FAILED");
    // the author cannot review their own revision
    expect((await errorOf(svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "start-technical-review" }))).message).toMatch(/Segregation of duties/);
    // drafts under review cannot be edited
    expect((await errorOf(svc.saveDraft(author, { revisionId, expectedRowVersion: await rv(), content: genericContent(), reason: "edit" }))).code).toBe("PRECONDITION_FAILED");
    await svc.transition(tech, { revisionId, expectedRowVersion: await rv(), action: "start-technical-review" });
    expect((await errorOf(svc.transition(other, { revisionId, expectedRowVersion: await rv(), action: "complete-technical-review", attestation: true, comment: "Technical review complete" }))).message).toMatch(/Only the technical specialist/);
    expect((await errorOf(svc.transition(tech, { revisionId, expectedRowVersion: await rv(), action: "complete-technical-review", comment: "Reviewed" }))).message).toMatch(/attestation/);
    await svc.transition(tech, { revisionId, expectedRowVersion: await rv(), action: "complete-technical-review", attestation: true, comment: "Technical review complete" });
    await svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-qa-review" });
    expect((await errorOf(svc.transition(tech, { revisionId, expectedRowVersion: await rv(), action: "start-qa-review" }))).message).toMatch(/requires the qa-approver duty|Segregation/);
    await svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "start-qa-review" });
    expect((await errorOf(svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "qa-approve", attestation: true }))).message).toMatch(/requires a comment/);
    await svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "qa-approve", attestation: true, comment: "Approved after review" });
    const approved = await svc.getRevision(admin, revisionId);
    expect(approved.revision.status).toBe("approved");
    expect(approved.revision.locked).toBe(true);
    // approved-but-not-released cannot be executed
    expect((await errorOf(svc.executeProtocol(author, { revisionId, instrumentKey: "polarimeter", measurements: {} }))).message).toMatch(/Only RELEASED/);
    expect((await errorOf(svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "release" }))).message).toMatch(/effective date/);
    await svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "release", effectiveDate: new Date().toISOString().slice(0, 10) });
    const detail = await svc.getProtocolDetail(protocolId);
    expect(detail.protocol.status).toBe("released");
    expect(detail.revisions[0].nextReviewDate).toBeTruthy();
    expect(detail.approvals.map(a => a.action)).toEqual(expect.arrayContaining(["submit-technical-review", "start-technical-review", "complete-technical-review", "qa-approve", "release"]));
  });

  it("keeps approved revisions immutable at the service and database level", async () => {
    expect((await errorOf(svc.saveDraft(author, { revisionId, expectedRowVersion: await rv(), content: genericContent(), reason: "edit" }))).code).toBe("PRECONDITION_FAILED");
    const db = localConnection();
    expect(() => db.prepare("UPDATE protocol_revisions SET content = '{}' WHERE id = ?").run(revisionId)).toThrow(/immutable|locked|editable/i);
    expect(() => db.prepare("DELETE FROM protocol_audit_events").run()).toThrow(/append-only|deletion is not permitted/i);
    expect(() => db.prepare("DELETE FROM protocols").run()).toThrow(/cannot be deleted|not permitted|append-only/i);
    expect(() => db.prepare("UPDATE protocol_revisions SET status = 'draft' WHERE id = ?").run(revisionId)).toThrow();
  });

  it("executes only released, compatible revisions and stores snapshots without auto-approval", async () => {
    const options = await svc.releasedForEquipment("polarimeter");
    expect(options.released.some(r => r.revisionId === revisionId && r.compatible)).toBe(true);
    expect((await errorOf(svc.executeProtocol(author, { revisionId, instrumentKey: "uv-vis", measurements: {} }))).message).toMatch(/not compatible|not found/);
    const res = await svc.executeProtocol(author, { revisionId, instrumentKey: "polarimeter", measurements: { acc: { readings: [10.01, 10.0, 10.02], reference: 10 } } });
    expect(res.evaluation.overall).toBe("PASS");
    expect(res.evaluation.disclaimer).toMatch(/not an approval/);
    const stored = await svc.getExecution(res.executionId);
    expect(stored.protocolSnapshot.identification.number).toBe("GEN-POL-001");
    expect(stored.contentHash).toBeTruthy();
    expect((await errorOf(svc.executeProtocol(viewer, { revisionId, instrumentKey: "polarimeter", measurements: {} }))).code).toBe("FORBIDDEN");
  });

  it("requires a reason for a new revision, allows one open revision, and supersedes on release", async () => {
    expect((await errorOf(svc.createRevision(author, { protocolId, reason: " ", description: "x" }))).code).toBe("BAD_REQUEST");
    const r2 = await svc.createRevision(author, { protocolId, reason: "Add repeatability test", description: "Rev 2" });
    expect((await errorOf(svc.createRevision(author, { protocolId, reason: "Another", description: "x" }))).message).toMatch(/still open/);
    const rev2 = await svc.getRevision(admin, r2.revisionId);
    expect(rev2.revision.revisionNumber).toBe(2);
    const content = genericContent();
    content.sections![0].tests!.push({ key: "rep", name: "Repeatability", dataType: "series", readingsRequired: 5, calculations: [{ key: "rsd", label: "RSD", kind: "rsd" }], criteria: [] });
    await svc.saveDraft(author, { revisionId: r2.revisionId, expectedRowVersion: rev2.revision.rowVersion, content, reason: "Add repeatability" });
    const diff = await svc.compareRevisions(revisionId, r2.revisionId);
    expect(diff.entries.some(e => e.entity === "test" && e.change === "added")).toBe(true);
    // original approved content is unchanged
    const original = await svc.getRevision(admin, revisionId);
    expect(original.revision.content.sections[0].tests).toHaveLength(1);
  });

  it("flags affected protocols when a linked reference changes, without altering approved content", async () => {
    const refs = await svc.listReferences();
    const ref = refs.find(r => r.id === refId)!;
    const res = await svc.saveReference(admin, { code: ref.code, title: ref.title, issuer: ref.issuer, referenceType: ref.referenceType, documentNumber: ref.documentNumber, edition: "3.2", revision: ref.revision, publicationDate: ref.publicationDate ?? "", effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: "", documentUrl: "", applicableSection: ref.applicableSection, applicableClause: "", verificationStatus: "verified", notes: "", expectedRowVersion: ref.rowVersion, id: ref.id, reason: "New edition" });
    expect(res.affectedProtocols).toContain("GEN-POL-001");
    const detail = await svc.getProtocolDetail(protocolId);
    expect(detail.protocol.reviewFlag).toBe(true);
    const snapshot = (await svc.getRevision(admin, revisionId)).revision.referenceSnapshot as { references: Array<{ edition: string }> };
    expect(snapshot.references[0].edition).toBe("3.1");
    const notes = await svc.listNotifications(author);
    expect(notes.some(n => n.kind === "protocol-affected-by-reference-change")).toBe(true);
  });

  it("configures POL-QC-032D as a DRAFT on the existing equipment with pending criteria and the accuracy gap", async () => {
    const first = await svc.configureAdp220Draft(author);
    expect(first.created).toBe(true);
    const again = await svc.configureAdp220Draft(author);
    expect(again.created).toBe(false);
    const detail = await svc.getProtocolDetail(first.protocolId);
    expect(detail.protocol.protocolNumber).toBe(ADP220_PROTOCOL_NUMBER);
    expect(detail.protocol.status).toBe("draft");
    const rev = await svc.getRevision(admin, first.revisionId as string);
    const content = rev.revision.content;
    expect(content.equipmentLinks[0]).toMatchObject({ instrumentKey: "polarimeter", instrumentId: "QC-I-029", serialNumber: "PE99003" });
    expect(allCriteria(content).every(c => c.criterion.verificationStatus !== "verified")).toBe(true);
    const gap = content.gaps[0];
    expect(gap.specifications.map(s => s.value).join(" ")).toMatch(/0\.02.*0\.01|0\.01.*0\.02/);
    const refs = await svc.listReferences();
    expect(refs.map(r => r.code)).toEqual(expect.arrayContaining(["USP-781", "USP-1058", "BS-36-102", "POL-CERT-REGISTER"]));
    expect(refs.find(r => r.code === "USP-781")?.sourceUrl).toBe("https://doi.org/10.31003/USPNF_M99570_02_01");
    expect(refs.every(r => r.code === "MAN-1" || r.verificationStatus !== "verified")).toBe(true);
    // registered equipment is unchanged — no duplicate equipment record
    const eq = (await svc.equipmentRegistry()).filter(e => e.serialNumber === "PE99003");
    expect(eq).toHaveLength(1);
    expect(PENDING_LABEL).toBe("PENDING TECHNICAL VERIFICATION");
  });

  it("blocks approval of POL-QC-032D while criteria are pending and the gap is undecided", async () => {
    const [p] = (await svc.listProtocols({ search: ADP220_PROTOCOL_NUMBER })).rows;
    const revId = p.currentRevisionId as string;
    const ver = async () => (await svc.getRevision(admin, revId)).revision.rowVersion;
    // the author documents the technical assessment of the accuracy gap (required before a reviewer decision)
    const draft = (await svc.getRevision(admin, revId)).revision.content;
    draft.gaps[0].assessment = "Instrument accuracy specification (±0.02°) is wider than the USP <781> tolerance (±0.01°); suitability must be demonstrated.";
    await svc.saveDraft(author, { revisionId: revId, expectedRowVersion: await ver(), content: draft, reason: "Document gap assessment" });
    await svc.transition(author, { revisionId: revId, expectedRowVersion: await ver(), action: "submit-technical-review" });
    await svc.transition(tech, { revisionId: revId, expectedRowVersion: await ver(), action: "start-technical-review" });
    expect((await errorOf(svc.transition(tech, { revisionId: revId, expectedRowVersion: await ver(), action: "complete-technical-review", attestation: true, comment: "Technical review complete" }))).message).toMatch(/gap/i);
    const rev = await svc.getRevision(admin, revId);
    await svc.recordGapDecision(tech, { revisionId: revId, gapKey: rev.revision.content.gaps[0].key, decision: "additional-evidence-required", rationale: "Instrument specification exceeds the USP tolerance; evidence needed" });
    await svc.transition(tech, { revisionId: revId, expectedRowVersion: await ver(), action: "complete-technical-review", attestation: true, comment: "Technical review complete" });
    await svc.transition(author, { revisionId: revId, expectedRowVersion: await ver(), action: "submit-qa-review" });
    await svc.transition(qa, { revisionId: revId, expectedRowVersion: await ver(), action: "start-qa-review" });
    const blocked = await errorOf(svc.transition(qa, { revisionId: revId, expectedRowVersion: await ver(), action: "qa-approve", attestation: true, comment: "try" }));
    expect(blocked.message).toMatch(/QA approval is blocked/);
    expect(JSON.stringify(blocked.details)).toMatch(/PENDING TECHNICAL VERIFICATION/);
    expect(JSON.stringify(blocked.details)).toMatch(/does not permit approval/);
    expect((await svc.getRevision(admin, revId)).revision.status).toBe("qa-review-in-progress");
  });

  it("serves dashboard counts from the database", async () => {
    const d = await svc.dashboard();
    expect(d.stats.total).toBe(2);
    expect(d.stats.released).toBe(1);
    expect(d.stats.pendingVerification).toBeGreaterThan(0);
    expect(d.stats.openGaps).toBe(0); // the POL-QC-032D gap now has a recorded reviewer decision
    expect(d.unresolvedIssues.some(i => /PENDING TECHNICAL VERIFICATION/.test(i.issue))).toBe(true);
  });

  it("returns for correction, accepts resubmission, notifies by duty and retires only with a reason", async () => {
    const created = await svc.createProtocol(author, { content: genericContent("GEN-POL-003"), reason: "Correction cycle test" });
    const rid = created.revisionId;
    const ver = async () => (await svc.getRevision(admin, rid)).revision.rowVersion;
    await svc.transition(author, { revisionId: rid, expectedRowVersion: await ver(), action: "submit-technical-review" });
    // technical reviewers are notified; the viewer (no duties) is not
    expect((await svc.listNotifications(tech)).some(n => n.revisionId === rid)).toBe(true);
    expect((await svc.listNotifications(viewer)).some(n => n.revisionId === rid)).toBe(false);
    await svc.transition(tech, { revisionId: rid, expectedRowVersion: await ver(), action: "start-technical-review" });
    expect((await errorOf(svc.transition(tech, { revisionId: rid, expectedRowVersion: await ver(), action: "request-technical-changes" }))).message).toMatch(/comment/i);
    await svc.transition(tech, { revisionId: rid, expectedRowVersion: await ver(), action: "request-technical-changes", comment: "Add the replicate count to the accuracy test" });
    expect((await svc.getRevision(admin, rid)).revision.status).toBe("technical-changes-required");
    // the author is notified and can edit again
    expect((await svc.listNotifications(author)).some(n => n.revisionId === rid)).toBe(true);
    const content = genericContent("GEN-POL-003");
    content.sections![0].tests![0].replicates = 2;
    await svc.saveDraft(author, { revisionId: rid, expectedRowVersion: await ver(), content, reason: "Address technical review comment" });
    await svc.transition(author, { revisionId: rid, expectedRowVersion: await ver(), action: "submit-technical-review" });
    await svc.transition(tech, { revisionId: rid, expectedRowVersion: await ver(), action: "start-technical-review" });
    await svc.transition(tech, { revisionId: rid, expectedRowVersion: await ver(), action: "complete-technical-review", attestation: true, comment: "Correction verified" });
    await svc.transition(author, { revisionId: rid, expectedRowVersion: await ver(), action: "submit-qa-review" });
    await svc.transition(qa, { revisionId: rid, expectedRowVersion: await ver(), action: "start-qa-review" });
    await svc.transition(qa, { revisionId: rid, expectedRowVersion: await ver(), action: "qa-approve", attestation: true, comment: "Approved after correction" });
    await svc.transition(qa, { revisionId: rid, expectedRowVersion: await ver(), action: "release", effectiveDate: new Date().toISOString().slice(0, 10) });
    // a non-releaser cannot retire; retirement needs a reason
    expect((await errorOf(svc.transition(tech, { revisionId: rid, expectedRowVersion: await ver(), action: "retire", comment: "Equipment decommissioned" }))).code).toBe("FORBIDDEN");
    expect((await errorOf(svc.transition(qa, { revisionId: rid, expectedRowVersion: await ver(), action: "retire" }))).message).toMatch(/comment/i);
    await svc.transition(qa, { revisionId: rid, expectedRowVersion: await ver(), action: "retire", comment: "Equipment decommissioned" });
    expect((await svc.getRevision(admin, rid)).revision.status).toBe("retired");
    // retired revisions cannot be executed and the history stays accessible
    expect((await errorOf(svc.executeProtocol(author, { revisionId: rid, instrumentKey: "polarimeter", measurements: {} }))).message).toMatch(/Only RELEASED/);
    const detail = await svc.getProtocolDetail(created.protocolId);
    expect(detail.approvals.map(a => a.action)).toEqual(expect.arrayContaining(["request-technical-changes", "release", "retire"]));
    // PDF generation is recorded in the audit trail
    await svc.logPdfGenerated(author, { revisionId: rid, documentStatus: "RETIRED" });
    expect((await svc.listAudit({ protocolId: created.protocolId })).some(a => a.action === "pdf.generated")).toBe(true);
  });
});
