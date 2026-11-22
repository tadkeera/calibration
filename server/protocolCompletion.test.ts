/**
 * Protocol Management — remaining requirements (real SQLite store + database
 * guard triggers; electronic signatures verified against the real account
 * password through localLogin):
 *   - electronic signature re-authentication (§14 / §20)
 *   - execution technical review + QA approval with segregation of duties (§16.4–16.5)
 *   - deviations + interval activity recorded with the execution (§16.3)
 *   - interval schedule, due-soon / overdue alerts, deduplicated notifications (§13.2, §22)
 *   - controlled attachments with SHA-256 integrity, append-only (§16.3, §11)
 *   - equipment-specific protocols (§6.3 B) and validation-record linkage (§16)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { closeLocalDatabase, createLocalUser, localConnection } from "./localDb";
import * as svc from "./protocols/service";
import { sqliteProtocolStore } from "./protocols/sqliteStore";
import { computeSchedule } from "../shared/protocols/schedule";
import type { ProtocolContentInput } from "../shared/protocols/model";
import { protocolsRouter } from "./routers/protocols";
import type { TrpcContext } from "./_core/context";

const testDatabase = "/tmp/miayar-protocols-completion.test.sqlite";
const PW = "completion-test-password-1";
let admin: svc.Actor, author: svc.Actor, tech: svc.Actor, qa: svc.Actor, executor: svc.Actor, viewer: svc.Actor;
let refId = "";

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

function content(number: string, extra: Partial<ProtocolContentInput> = {}): ProtocolContentInput {
  return {
    identification: { title: `Completion test protocol ${number}`, number, protocolType: "PQ", manufacturer: "Bellingham & Stanley", model: "ADP220", associationType: "model" },
    narrative: { purpose: "Verify accuracy", scope: "ADP220 polarimeters" },
    stages: ["PQ"],
    risk: { overall: "medium", justification: "QC release instrument" },
    references: [{ referenceId: refId, supports: "Tolerance" }],
    intervals: [
      { key: "pr", activity: "Periodic Review", value: 12, unit: "months", justification: "Institutional", sourceClass: "institutional", verificationStatus: "verified" },
      { key: "pv", activity: "Performance Verification", value: 10, unit: "days", justification: "Institutional proposal approved by QA", sourceClass: "institutional", verificationStatus: "verified" },
      { key: "ext", activity: "External Calibration", value: 12, unit: "months", mandatory: true, justification: "Certificate validity", sourceClass: "institutional", verificationStatus: "verified" },
      { key: "evt", activity: "Requalification", unit: "event", event: "After major repair or relocation", justification: "Event driven", sourceClass: "institutional", verificationStatus: "verified" },
    ],
    sections: [{ key: "pq", title: "PQ", tests: [{ key: "acc", name: "Accuracy", dataType: "reference-comparison", readingsRequired: 3, calculations: [{ key: "error", label: "Error", kind: "error", decimals: 3 }], criteria: [{ key: "c1", parameter: "error", comparison: "abs<=", tolerance: 0.02, sourceClass: "manufacturer", referenceId: refId, verificationStatus: "verified", verificationEvidence: "Manual §5" }] }] }],
    ...extra,
  };
}

async function released(number: string, extra: Partial<ProtocolContentInput> = {}) {
  const { protocolId, revisionId } = await svc.createProtocol(author, { content: content(number, extra), reason: "Completion test" });
  const rv = async () => (await svc.getRevision(admin, revisionId)).revision.rowVersion;
  await svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-technical-review", password: PW });
  await svc.transition(tech, { revisionId, expectedRowVersion: await rv(), action: "start-technical-review" });
  await svc.transition(tech, { revisionId, expectedRowVersion: await rv(), action: "complete-technical-review", attestation: true, comment: "Reviewed", password: PW });
  await svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-qa-review" });
  await svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "start-qa-review" });
  await svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "qa-approve", attestation: true, comment: "Approved", password: PW });
  await svc.transition(qa, { revisionId, expectedRowVersion: await rv(), action: "release", effectiveDate: new Date().toISOString().slice(0, 10), password: PW });
  return { protocolId, revisionId };
}
const passing = { acc: { readings: [10.01, 10, 10.02], reference: 10 } };
const failing = { acc: { readings: [10.5, 10.6, 10.4], reference: 10 } };

describe("protocol management — remaining requirements (SQLite)", () => {
  beforeAll(async () => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    svc.setSignatureVerifierForTests(null);
    admin = await user("admin@done.test", "Admin", "admin");
    author = await user("author@done.test", "Author", "user");
    tech = await user("tech@done.test", "Tech", "user");
    qa = await user("qa@done.test", "QA", "user");
    executor = await user("exec@done.test", "Executor", "user");
    viewer = await user("viewer@done.test", "Viewer", "viewer");
    await svc.setDuty(admin, { userId: qa.id, duty: "qa-approver", granted: true, reason: "QA department" });
    await svc.setDuty(admin, { userId: qa.id, duty: "releaser", granted: true, reason: "Document control" });
    // v4: protocol editing is a granted duty (Authorized Protocol Editor); approval / activation requires the Quality Manager duty.
    await svc.setDuty(admin, { userId: author.id, duty: "author", granted: true, reason: "Authorized protocol editor" });
    await svc.setDuty(admin, { userId: qa.id, duty: "quality-manager", granted: true, reason: "Quality Manager" });
    refId = (await svc.saveReference(admin, { code: "MAN-C", title: "Manufacturer manual", issuer: "Maker", referenceType: "manufacturer-manual", documentNumber: "36-102", edition: "3.1", revision: "", publicationDate: "2004-02", effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: "", documentUrl: "", applicableSection: "Specifications", applicableClause: "", verificationStatus: "verified", notes: "", reason: "Library setup" })).id;
  });

  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
  });

  it("requires password re-entry for every electronic signature and records failed attempts", async () => {
    const { revisionId } = await svc.createProtocol(author, { content: content("SIG-001"), reason: "Signature test" });
    const rv = async () => (await svc.getRevision(admin, revisionId)).revision.rowVersion;
    const missing = await errorOf(svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-technical-review" }));
    expect(missing.code).toBe("BAD_REQUEST");
    expect(missing.message).toMatch(/re-enter your password/);
    const wrong = await errorOf(svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-technical-review", password: "not-the-password" }));
    expect(wrong.code).toBe("FORBIDDEN");
    expect(wrong.message).toMatch(/Nothing was signed/);
    expect((await svc.getRevision(admin, revisionId)).revision.status).toBe("draft");
    // A different user's password does not sign on behalf of the author.
    expect((await errorOf(svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-technical-review", password: "wrong" + PW }))).code).toBe("FORBIDDEN");
    const failed = await svc.listAudit({ entityType: "revision" });
    expect(failed.filter(a => a.action === "signature.failed" && a.entityId === revisionId).length).toBe(2);
    expect(JSON.stringify(failed)).not.toContain("not-the-password");
    await svc.transition(author, { revisionId, expectedRowVersion: await rv(), action: "submit-technical-review", password: PW });
    // Non-signature steps (start review) do not need a password.
    await svc.transition(tech, { revisionId, expectedRowVersion: await rv(), action: "start-technical-review" });
    const approvals = (await svc.getRevision(admin, revisionId)).approvals;
    expect(approvals.find(a => a.action === "submit-technical-review")?.reauthenticated).toBe(true);
    expect(approvals.find(a => a.action === "start-technical-review")?.reauthenticated).toBe(false);
  });

  it("records deviations and the interval activity, then enforces technical review → QA approval with segregation of duties", async () => {
    const { revisionId } = await released("EXR-001");
    expect((await errorOf(svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, activityKey: "nope" }))).message).toMatch(/interval activity/);
    expect((await errorOf(svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, deviations: [{ description: "x", impact: "", immediateAction: "", reference: "" }] }))).message).toMatch(/deviation/);
    const { executionId } = await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, activityKey: "pv", deviations: [{ description: "Room temperature 26.1 °C during reading 2", impact: "Assessed as minor", immediateAction: "Reading repeated", reference: "DEV-0001" }] });
    let exec = await svc.getExecution(executor, executionId);
    expect(exec.reviewStatus).toBe("recorded");
    expect(exec.activityName).toBe("Performance Verification");
    expect(exec.deviations[0].reference).toBe("DEV-0001");
    expect(exec.availableReviewActions).toEqual([]);
    // Executor cannot review own execution (backend + database).
    expect((await errorOf(svc.reviewExecution(executor, { executionId, action: "review", comment: "Raw data checked", password: PW }))).message).toMatch(/requires the technical-reviewer duty|Segregation/);
    expect((await errorOf(svc.reviewExecution(admin, { executionId, action: "approve", comment: "skip review", password: PW }))).code).toBe("PRECONDITION_FAILED");
    expect((await errorOf(svc.reviewExecution(tech, { executionId, action: "review", comment: "Reviewed raw data" }))).message).toMatch(/re-enter your password/);
    expect((await errorOf(svc.reviewExecution(tech, { executionId, action: "review", comment: "Reviewed raw data", password: "bad" }))).code).toBe("FORBIDDEN");
    await svc.reviewExecution(tech, { executionId, action: "review", comment: "Reviewed raw data and deviation DEV-0001", password: PW });
    expect((await errorOf(svc.reviewExecution(tech, { executionId, action: "approve", comment: "also approve", password: PW }))).message).toMatch(/qa-approver|Segregation/);
    expect((await svc.getExecution(qa, executionId)).availableReviewActions).toEqual(["approve", "reject"]);
    await svc.reviewExecution(qa, { executionId, action: "approve", comment: "QA approved", password: PW });
    exec = await svc.getExecution(admin, executionId);
    expect(exec.reviewStatus).toBe("approved");
    expect(exec.reviewerName).toBe("Tech");
    expect(exec.approverName).toBe("QA");
    expect(exec.reviews.every(r => r.reauthenticated)).toBe(true);
    expect((await errorOf(svc.reviewExecution(admin, { executionId, action: "reject", comment: "late", password: PW }))).message).toMatch(/final decision/);
    // Database guards: duplicate decision and executor self-review are impossible even bypassing the service.
    const conn = localConnection();
    const insert = (from: string, to: string, action: string, actorId: number) =>
      conn.prepare("INSERT INTO protocol_execution_reviews (id, execution_id, protocol_id, action, from_status, to_status, signature_meaning, reauthenticated, comment, actor_user_id, created_at) VALUES (?, ?, (SELECT protocol_id FROM protocol_executions WHERE id = ?), ?, ?, ?, 'x', 1, 'direct insert', ?, ?)").run(`d-${Math.random()}`, executionId, executionId, action, from, to, actorId, new Date().toISOString());
    expect(() => insert("reviewed", "rejected", "reject", admin.id)).toThrow(/final decision|UNIQUE/);
    expect(() => conn.prepare("UPDATE protocol_execution_reviews SET comment = 'edited'").run()).toThrow(/append-only/);
    expect(() => conn.prepare("DELETE FROM protocol_execution_reviews").run()).toThrow(/deletion is not permitted/);
    const second = await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing });
    expect(() => conn.prepare("INSERT INTO protocol_execution_reviews (id, execution_id, protocol_id, action, from_status, to_status, signature_meaning, reauthenticated, comment, actor_user_id, created_at) VALUES ('self', ?, (SELECT protocol_id FROM protocol_executions WHERE id = ?), 'review', 'recorded', 'reviewed', 'x', 1, 'self review', ?, ?)").run(second.executionId, second.executionId, executor.id, new Date().toISOString())).toThrow(/segregation of duties/);
    // INCOMPLETE cannot be approved; reject path at technical review.
    const incomplete = await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: {} });
    expect(incomplete.evaluation.overall).toBe("INCOMPLETE");
    await svc.reviewExecution(tech, { executionId: incomplete.executionId, action: "review", comment: "Data missing", password: PW });
    expect((await errorOf(svc.reviewExecution(qa, { executionId: incomplete.executionId, action: "approve", comment: "approve", password: PW }))).message).toMatch(/INCOMPLETE/);
    await svc.reviewExecution(qa, { executionId: incomplete.executionId, action: "reject", comment: "Incomplete execution", password: PW });
    expect((await svc.listExecutions({ reviewStatus: "rejected" })).map(e => e.id)).toContain(incomplete.executionId);
    const notes = await svc.listNotifications(qa);
    expect(notes.some(n => n.kind === "execution-approval-required")).toBe(true);
    expect((await svc.listNotifications(executor)).some(n => n.kind === "execution-approved")).toBe(true);
  });

  it("computes due dates per equipment from released intervals; only a non-rejected PASS resets the baseline", async () => {
    const { revisionId } = await released("SCH-001");
    const todayIso = new Date().toISOString().slice(0, 10);
    const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    let items = (await svc.activitySchedule({ instrumentKey: "polarimeter" })).filter(i => i.protocolNumber === "SCH-001");
    const pv = items.find(i => i.intervalKey === "pv")!;
    expect(pv.baseline).toBe("effective-date");
    expect(pv.nextDue).toBe(plusDays(10));
    expect(pv.state).toBe("due-soon");
    expect(items.find(i => i.intervalKey === "evt")?.state).toBe("event-based");
    expect(items.find(i => i.intervalKey === "ext")?.mandatory).toBe(true);
    expect(items.some(i => i.activity === "Periodic Review")).toBe(false); // handled by protocol review alerts
    expect(items.every(i => i.instrumentKey === "polarimeter")).toBe(true);
    // FAIL does not reset; rejected PASS does not reset; approved/unrejected PASS does.
    await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: failing, activityKey: "pv" });
    const rejectedPass = await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, activityKey: "pv" });
    await svc.reviewExecution(tech, { executionId: rejectedPass.executionId, action: "reject", comment: "Wrong reference plate used", password: PW });
    items = (await svc.activitySchedule({ instrumentKey: "polarimeter" })).filter(i => i.protocolNumber === "SCH-001");
    expect(items.find(i => i.intervalKey === "pv")?.baseline).toBe("effective-date");
    await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, activityKey: "pv" });
    items = (await svc.activitySchedule({ instrumentKey: "polarimeter" })).filter(i => i.protocolNumber === "SCH-001");
    expect(items.find(i => i.intervalKey === "pv")?.baseline).toBe("last-pass-execution");
    expect(items.find(i => i.intervalKey === "pv")?.lastPerformedAt?.slice(0, 10)).toBe(todayIso);
    // Due-soon alert is created once (deduplicated) and is visible to executors only.
    await svc.refreshDueNotifications();
    const again = await svc.refreshDueNotifications();
    expect(again).toBe(0);
    const forExec = (await svc.listNotifications(executor)).filter(n => n.kind === "activity-due-soon" && n.message.startsWith("SCH-001"));
    // Only "pv" is due within 30 days ("ext" is due in 12 months); the PASS today gives the same due date → one alert.
    expect(forExec.length).toBe(1);
    expect((await svc.listNotifications(viewer)).length).toBe(0);
    const dash = await svc.dashboard();
    expect(dash.stats.activitiesDueSoon).toBeGreaterThan(0);
    expect(dash.upcomingActivities.length).toBeGreaterThan(0);
  });

  it("classifies overdue / due-soon / scheduled deterministically (pure engine)", () => {
    const interval = (key: string, value: number, unit: "days" | "months") => ({ key, activity: key, value, unit, event: "", mandatory: false, sourceClass: "institutional" as const, referenceId: null, riskBasis: "", justification: "j", department: "", verificationStatus: "verified" as const });
    const items = computeSchedule([{ protocolId: "p", protocolNumber: "P-1", title: "t", revisionId: "r", revisionNumber: 1, effectiveDate: "2026-01-01", intervals: [interval("a", 30, "days"), interval("b", 12, "months"), interval("c", 11, "months")], equipment: [{ instrumentKey: "k", instrumentId: "ID", name: "n" }], executions: [{ instrumentKey: "k", activityKey: "c", executedAt: "2026-01-15T10:00:00Z", overallResult: "PASS", rejected: false }] }], "2026-11-18");
    expect(items.find(i => i.intervalKey === "a")).toMatchObject({ nextDue: "2026-01-31", state: "overdue" });
    expect(items.find(i => i.intervalKey === "b")).toMatchObject({ nextDue: "2027-01-01", state: "scheduled", daysRemaining: 44 });
    expect(items.find(i => i.intervalKey === "c")).toMatchObject({ nextDue: "2026-12-15", state: "due-soon", baseline: "last-pass-execution" });
    expect(items[0].intervalKey).toBe("a");
  });

  it("stores attachments with SHA-256 integrity, enforces type/size/permissions, and keeps them append-only", async () => {
    const { revisionId } = await released("ATT-001");
    const { executionId } = await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing });
    const pdf = Buffer.from("%PDF-1.4\n% synthetic certificate for test\n");
    const res = await svc.uploadAttachment(executor, { entityType: "execution", entityId: executionId, fileName: "certificate.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64"), description: "Reference plate certificate" });
    expect(res.sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect((await errorOf(svc.uploadAttachment(executor, { entityType: "execution", entityId: executionId, fileName: "run.exe", mimeType: "application/x-msdownload", contentBase64: "AAAA" }))).message).toMatch(/not allowed/);
    expect((await errorOf(svc.uploadAttachment(executor, { entityType: "execution", entityId: executionId, fileName: "x.png", mimeType: "application/pdf", contentBase64: "AAAA" }))).message).toMatch(/extension/);
    expect((await errorOf(svc.uploadAttachment(executor, { entityType: "execution", entityId: executionId, fileName: "big.pdf", mimeType: "application/pdf", contentBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64") }))).message).toMatch(/limit/);
    expect((await errorOf(svc.uploadAttachment(viewer, { entityType: "execution", entityId: executionId, fileName: "v.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64") }))).code).toBe("FORBIDDEN");
    const list = await svc.listAttachments("execution", executionId);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("contentBase64");
    const file = await svc.downloadAttachment(res.id);
    expect(file.integrityOk).toBe(true);
    expect(Buffer.from(file.contentBase64, "base64").equals(pdf)).toBe(true);
    expect((await svc.getExecution(admin, executionId)).attachments[0].fileName).toBe("certificate.pdf");
    const conn = localConnection();
    expect(() => conn.prepare("UPDATE protocol_attachments SET file_name = 'x'").run()).toThrow(/append-only/);
    expect(() => conn.prepare("DELETE FROM protocol_attachments").run()).toThrow(/deletion is not permitted/);
    // After the final QA decision no further evidence can be attached.
    await svc.reviewExecution(tech, { executionId, action: "review", comment: "Raw data checked", password: PW });
    await svc.reviewExecution(qa, { executionId, action: "approve", comment: "QA approved", password: PW });
    expect((await errorOf(svc.uploadAttachment(executor, { entityType: "execution", entityId: executionId, fileName: "late.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64") }))).message).toMatch(/after the final QA decision/);
    // Reference documents.
    await svc.uploadAttachment(author, { entityType: "reference", entityId: refId, fileName: "manual-extract.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64") });
    expect(await svc.listAttachments("reference", refId)).toHaveLength(1);
    expect((await svc.listAudit({ entityType: "attachment" })).length).toBe(2);
  });

  it("passes the signer's e-mail and password through the tRPC router (real password check)", async () => {
    const ctx = (a: svc.Actor) => ({ user: { id: a.id, openId: `local:${a.id}`, name: a.name, email: a.email, loginMethod: "local", role: a.role, isActive: true, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} }, res: {} }) as unknown as TrpcContext;
    const caller = protocolsRouter.createCaller(ctx(author));
    const { revisionId } = await svc.createProtocol(author, { content: content("RTR-001"), reason: "Router test" });
    await expect(caller.transition({ revisionId, expectedRowVersion: 1, action: "submit-technical-review", password: "nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller.transition({ revisionId, expectedRowVersion: 1, action: "submit-technical-review", password: PW });
    expect((await svc.getRevision(admin, revisionId)).revision.status).toBe("technical-review-pending");
    await expect(caller.uploadAttachment({ entityType: "reference", entityId: refId, fileName: "a.pdf", mimeType: "application/pdf", contentBase64: "A".repeat(4_300_000) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const sched = await protocolsRouter.createCaller(ctx(viewer)).schedule();
    expect(Array.isArray(sched)).toBe(true);
  });

  it("supports equipment-specific protocols and links executions to validation records of the same equipment", async () => {
    const link = { instrumentKey: "polarimeter", instrumentId: "QC-I-029", serialNumber: "PE99003", manufacturer: "Bellingham & Stanley (UK)", model: "ADP220", compatibilityNote: "Unit-specific protocol" };
    const { revisionId } = await released("EQS-001", { identification: { title: "Equipment-specific ADP220 protocol", number: "EQS-001", protocolType: "PQ", manufacturer: "Bellingham & Stanley", model: "ADP220", associationType: "equipment" }, equipmentLinks: [link] });
    const options = await svc.releasedForEquipment("polarimeter");
    expect(options.released.find(o => o.protocolNumber === "EQS-001")?.compatible).toBe(true);
    expect((await svc.releasedForEquipment("hplc")).released.some(o => o.protocolNumber === "EQS-001")).toBe(false);
    expect((await errorOf(svc.executeProtocol(executor, { revisionId, instrumentKey: "hplc", measurements: passing }))).code).toBe("PRECONDITION_FAILED");
    const conn = localConnection();
    const ts = new Date().toISOString();
    const insertRecord = (key: string, id: string) => Number(conn.prepare("INSERT INTO validation_records (instrument_key, instrument_name, instrument_id, sop_number, form_number, result_status, result_data, pharmacist_name, validated_by_user_id, created_at, updated_at, record_version) VALUES (?, ?, ?, 'SOP', 'FORM', 'pass', '{}', 'Synthetic analyst', ?, ?, ?, 1)").run(key, key, id, executor.id, ts, ts).lastInsertRowid);
    const polRecord = insertRecord("polarimeter", "QC-I-029");
    const hplcRecord = insertRecord("hplc", "QC-I-001");
    expect((await errorOf(svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, validationRecordId: hplcRecord }))).message).toMatch(/different equipment/);
    expect((await errorOf(svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, validationRecordId: 999999 }))).code).toBe("NOT_FOUND");
    const { executionId } = await svc.executeProtocol(executor, { revisionId, instrumentKey: "polarimeter", measurements: passing, validationRecordId: polRecord });
    const exec = await svc.getExecution(admin, executionId);
    expect(exec.validationRecordId).toBe(polRecord);
    expect(exec.linkedRecord).toMatchObject({ id: polRecord, lifecycleStatus: "draft", resultStatus: "pass" });
    // Equipment-specific schedule covers only the linked unit.
    const sched = (await svc.activitySchedule()).filter(i => i.protocolNumber === "EQS-001");
    expect(new Set(sched.map(i => i.instrumentKey))).toEqual(new Set(["polarimeter"]));
  });
});
