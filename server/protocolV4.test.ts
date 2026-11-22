/**
 * v4 integration tests (real SQLite store + DB guards):
 *  - Protocol page (nine equipment cards linked to the Equipment Master, no duplicates)
 *  - roles: Normal User / Authorized Protocol Editor / Quality Manager (backend-enforced)
 *  - simplified approval Draft → Approved (active) → Superseded; approved revisions immutable
 *  - protocol-driven New Validation (dynamic tests, calculations, PASS/FAIL, graphs, immutable snapshot)
 *  - backup-first reset of experimental protocol data (users, duties, equipment kept)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync, statSync } from "node:fs";
import { closeLocalDatabase, createLocalUser, localConnection } from "./localDb";
import * as svc from "./protocols/service";
import * as wf from "./protocols/workflowService";
import * as val from "./protocols/validationService";
import { resetProtocolDataSqlite, sqliteProtocolStore } from "./protocols/sqliteStore";
import { PROTOCOL_EQUIPMENT_CARDS, NO_APPROVED_PROTOCOL } from "../shared/protocols/protocolCards";
import { stats } from "../shared/protocols/calc";
import type { ProtocolContentInput } from "../shared/protocols/model";

const testDatabase = "/tmp/miayar-v4.test.sqlite";
const backupFile = "/tmp/miayar-v4.backup.sqlite";
const PW = "v4-test-password-1";
let admin: svc.Actor, editor: svc.Actor, qm: svc.Actor, normal: svc.Actor, viewer: svc.Actor;

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

/** A protocol entered "manually" by the editor: accuracy (multi-level, regression) + repeatability (10 readings). */
function polarimeterContent(base: any, opts: { verified: boolean; rsdLimit: number }): ProtocolContentInput {
  const vs = opts.verified ? "verified" : "pending-technical-verification";
  return {
    ...base,
    stages: ["Calibration"],
    narrative: { ...base.narrative, purpose: "Calibration of the polarimeter (test fixture)", scope: "Polarimeter QC-I-029 (test fixture)" },
    sections: [
      {
        key: "tests",
        title: "Tests",
        tests: [
          {
            key: "accuracy",
            name: "Accuracy / linearity with certified quartz plates",
            dataType: "multi-level",
            unit: "°",
            readingsRequired: 3,
            levels: [
              { key: "L1", label: "-17°", nominal: -17.0, unit: "°" },
              { key: "L2", label: "+8.7°", nominal: 8.7, unit: "°" },
              { key: "L3", label: "+17°", nominal: 17.0, unit: "°" },
              { key: "L4", label: "+34°", nominal: 34.0, unit: "°" },
            ],
            calculations: [
              { key: "lvl_err", label: "Error per level", kind: "error", scope: "per-level", unit: "°" },
              { key: "max_err", label: "Max |level error|", kind: "max-level-abs-error", unit: "°" },
              { key: "slope", label: "Slope", kind: "linearity-slope" },
              { key: "r2", label: "r²", kind: "linearity-r2" },
            ],
            criteria: [
              { key: "acc", parameter: "max_err", requirement: "Max |error| ≤ 0.02°", comparison: "<=", upper: 0.02, unit: "°", sourceClass: "manufacturer", verificationStatus: vs, verificationEvidence: opts.verified ? "Checked against the controlled source (test fixture)" : "", justification: "Entered by the editor from the controlled manual (test fixture)" },
              { key: "lin", parameter: "r2", requirement: "r² ≥ 0.999", comparison: ">=", lower: 0.999, sourceClass: "institutional", verificationStatus: vs, verificationEvidence: opts.verified ? "Checked against the controlled source (test fixture)" : "", justification: "Laboratory limit (test fixture)" },
            ],
            graphs: [{ type: "calibration-curve" }, { type: "measured-vs-reference" }, { type: "error" }],
          },
          {
            key: "repeat",
            name: "Repeatability (10 readings)",
            dataType: "series",
            unit: "°",
            readingsRequired: 10,
            calculations: [
              { key: "mean", label: "Mean", kind: "mean", unit: "°" },
              { key: "sd", label: "SD", kind: "sd", unit: "°" },
              { key: "rsd", label: "RSD", kind: "rsd", unit: "%" },
            ],
            criteria: [{ key: "rsd_lim", parameter: "rsd", requirement: `RSD ≤ ${opts.rsdLimit} %`, comparison: "<=", upper: opts.rsdLimit, unit: "%", sourceClass: "institutional", verificationStatus: vs, verificationEvidence: opts.verified ? "Checked against the controlled source (test fixture)" : "", justification: "Laboratory limit (test fixture)" }],
            graphs: [{ type: "repeatability" }],
          },
        ],
      },
    ],
  } as ProtocolContentInput;
}

const READINGS = {
  accuracy: { levels: { L1: [-17.004, -17.006, -17.005], L2: [8.702, 8.703, 8.701], L3: [17.006, 17.004, 17.005], L4: [34.008, 34.01, 34.009] } },
  repeat: { readings: [17.004, 17.006, 17.005, 17.003, 17.007, 17.005, 17.004, 17.006, 17.005, 17.005] },
};

describe("v4 Protocol page, simplified approval and protocol-driven validation", () => {
  let protocolId = "";
  let rev1 = "";
  let rev2 = "";
  let runId = "";

  beforeAll(async () => {
    closeLocalDatabase();
    for (const f of [testDatabase, backupFile]) if (existsSync(f)) rmSync(f);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
    admin = await user("admin@v4.test", "Admin", "admin");
    editor = await user("editor@v4.test", "Editor", "user");
    qm = await user("qm@v4.test", "Quality Manager", "user");
    normal = await user("normal@v4.test", "Normal User", "user");
    viewer = await user("viewer@v4.test", "Viewer", "viewer");
    await svc.setDuty(admin, { userId: editor.id, duty: "author", granted: true, reason: "Authorized protocol editor" });
    await svc.setDuty(admin, { userId: qm.id, duty: "quality-manager", granted: true, reason: "Quality Manager" });
  });

  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    for (const f of [testDatabase, backupFile]) if (existsSync(f)) rmSync(f);
    delete process.env.QC_STORAGE_MODE;
  });

  it("shows the nine equipment cards in the required order, linked to existing equipment without duplicates", async () => {
    const before = await wf.listEquipmentData();
    const board = await val.protocolBoard(normal);
    expect(board.cards.map(c => c.title)).toEqual(["Disintegration Tester", "Refractometer", "Dissolution Tester", "Shimadzu HPLC2 Pump", "Spectrophotometer", "Moisture Analyzer", "Polarimeter", "Rotational Viscometer", "Analytical Balance"]);
    expect(board.cards.slice(0, 8).every(c => c.equipment)).toBe(true);
    expect(board.cards.find(c => c.cardKey === "polarimeter")!.equipment!.identity.instrumentId).toBe("QC-I-029");
    expect(board.cards.find(c => c.cardKey === "hplc")!.equipment!.identity.instrumentId).toBe("QC-I-104");
    // Analytical balance is registered once from the supplied package data (never duplicated).
    expect(board.cards[8].equipment).toBeNull();
    await wf.registerPackageEquipment(admin);
    await wf.registerPackageEquipment(admin);
    const after = await wf.listEquipmentData();
    expect(after.length).toBe(before.length + 1);
    expect(after.filter(e => e.identity.instrumentId === "QC-I-074").length).toBe(1);
    const board2 = await val.protocolBoard(normal);
    expect(board2.cards[8].equipment!.identity.instrumentId).toBe("QC-I-074");
    expect(new Set(board2.cards.map(c => c.equipment!.instrumentKey)).size).toBe(9);
    expect(board2.permissions).toEqual({ canEdit: false, canApprove: false, canExecute: true });
    expect(PROTOCOL_EQUIPMENT_CARDS.length).toBe(9);
  });

  it("enforces roles on the backend (normal user / viewer cannot create, edit or approve)", async () => {
    expect((await errorOf(val.createProtocolForEquipment(normal, { instrumentKey: "polarimeter", number: "CAL-QC-POL-002", title: "Polarimeter calibration", reason: "x" }))).code).toBe("FORBIDDEN");
    expect((await errorOf(val.createProtocolForEquipment(viewer, { instrumentKey: "polarimeter", number: "CAL-QC-POL-002", title: "Polarimeter calibration", reason: "x" }))).code).toBe("FORBIDDEN");
    const created = await val.createProtocolForEquipment(editor, { instrumentKey: "polarimeter", number: "CAL-QC-POL-002", title: "Polarimeter calibration", reason: "Entered manually from the approved source" });
    protocolId = created.protocolId;
    rev1 = created.revisionId;
    expect((await errorOf(val.createProtocolForEquipment(editor, { instrumentKey: "polarimeter", number: "CAL-QC-POL-003", title: "Second", reason: "dup" }))).message).toMatch(/already has protocol/);
    const detail = await val.protocolForEquipment(editor, "polarimeter");
    expect(detail.protocol!.number).toBe("CAL-QC-POL-002");
    expect(detail.revisions.map(r => r.status)).toEqual(["draft"]);
    expect(detail.permissions.canEdit).toBe(true);
    expect(detail.permissions.canApprove).toBe(false);
  });

  it("editor adds tests, criteria, formulas and graphs to the draft; Normal User cannot", async () => {
    const r = await svc.getRevision(editor, rev1);
    const content = polarimeterContent(r.revision.content, { verified: false, rsdLimit: 0.05 });
    expect((await errorOf(svc.saveDraft(normal, { revisionId: rev1, expectedRowVersion: r.revision.rowVersion, content, reason: "x" }))).code).toBe("FORBIDDEN");
    await svc.saveDraft(editor, { revisionId: rev1, expectedRowVersion: r.revision.rowVersion, content, reason: "Tests entered" });
    const saved = await svc.getRevision(editor, rev1);
    expect(saved.revision.content.sections[0].tests.map(t => t.key)).toEqual(["accuracy", "repeat"]);
    expect(saved.revision.content.sections[0].tests[0].graphs.map(g => g.type)).toEqual(["calibration-curve", "measured-vs-reference", "error"]);
    expect(saved.qmApprovalBlockers.join(" ")).toMatch(/not verified/);
  });

  it("only a Quality Manager can approve; unverified criteria block approval; no approved protocol → message", async () => {
    const r = await svc.getRevision(qm, rev1);
    expect((await val.activeProtocolForEquipment("polarimeter")).available).toBe(false);
    expect((await val.activeProtocolForEquipment("polarimeter") as { message: string }).message).toBe(NO_APPROVED_PROTOCOL);
    expect((await errorOf(svc.transition(editor, { revisionId: rev1, expectedRowVersion: r.revision.rowVersion, action: "approve", password: PW }))).code).toBe("FORBIDDEN");
    expect((await errorOf(svc.transition(normal, { revisionId: rev1, expectedRowVersion: r.revision.rowVersion, action: "approve", password: PW }))).code).toBe("FORBIDDEN");
    expect((await errorOf(svc.transition(qm, { revisionId: rev1, expectedRowVersion: r.revision.rowVersion, action: "approve", password: PW }))).message).toMatch(/Approval is blocked/);
    // Editor verifies the criteria against their sources, then the QM approves (signature = password).
    const content = polarimeterContent(r.revision.content, { verified: true, rsdLimit: 0.05 });
    await svc.saveDraft(editor, { revisionId: rev1, expectedRowVersion: r.revision.rowVersion, content, reason: "Criteria verified against the sources" });
    const v = (await svc.getRevision(qm, rev1)).revision.rowVersion;
    expect((await errorOf(svc.transition(qm, { revisionId: rev1, expectedRowVersion: v, action: "approve" }))).message).toMatch(/password/);
    await svc.transition(qm, { revisionId: rev1, expectedRowVersion: v, action: "approve", password: PW });
    const approved = await svc.getRevision(qm, rev1);
    expect(approved.revision.status).toBe("released");
    expect(approved.revision.locked).toBe(true);
    expect(approved.revision.qaApproverName).toBe("Quality Manager");
    expect(approved.revision.approvedAt).toBeTruthy();
    const approval = approved.approvals.find(a => a.action === "approve")!;
    expect(approval).toMatchObject({ fromStatus: "draft", toStatus: "released", actorName: "Quality Manager", revisionNumber: 1, reauthenticated: true });
    const active = await val.activeProtocolForEquipment("polarimeter");
    expect(active.available).toBe(true);
  });

  it("approved revisions are immutable (service + database trigger)", async () => {
    const r = await svc.getRevision(editor, rev1);
    expect((await errorOf(svc.saveDraft(editor, { revisionId: rev1, expectedRowVersion: r.revision.rowVersion, content: r.revision.content, reason: "try" }))).code).toBe("PRECONDITION_FAILED");
    expect(() => localConnection().prepare("UPDATE protocol_revisions SET content = '{}' WHERE id = ?").run(rev1)).toThrow(/immutable|editable/);
    expect(() => localConnection().prepare("DELETE FROM protocol_revisions WHERE id = ?").run(rev1)).toThrow(/deletion is not permitted/);
  });

  it("New Validation: dynamic tests from the approved revision, correct calculations, PASS/FAIL and graphs", async () => {
    const active = (await val.activeProtocolForEquipment("polarimeter")) as Extract<Awaited<ReturnType<typeof val.activeProtocolForEquipment>>, { available: true }>;
    expect(active.content.sections[0].tests.map(t => t.name)).toEqual(["Accuracy / linearity with certified quartz plates", "Repeatability (10 readings)"]);
    expect(active.content.sections[0].tests[1].readingsRequired).toBe(10);
    // Incomplete data cannot be saved.
    expect((await errorOf(val.recordValidation(normal, { instrumentKey: "polarimeter", revisionId: active.revision.id, measurements: { repeat: READINGS.repeat } }))).message).toMatch(/Required readings are missing/);
    const evaluation = await val.calculateValidation({ instrumentKey: "polarimeter", revisionId: active.revision.id, measurements: READINGS });
    const rep = evaluation.tests.find(t => t.testKey === "repeat")!;
    const mean = stats.mean(READINGS.repeat.readings);
    const sd = stats.sd(READINGS.repeat.readings);
    expect(rep.calculations.find(c => c.key === "mean")!.raw).toBeCloseTo(mean, 12);
    expect(rep.calculations.find(c => c.key === "sd")!.raw).toBeCloseTo(sd, 12);
    expect(rep.calculations.find(c => c.key === "rsd")!.raw).toBeCloseTo((sd / mean) * 100, 10);
    expect(rep.status).toBe("PASS");
    const acc = evaluation.tests.find(t => t.testKey === "accuracy")!;
    expect(acc.calculations.find(c => c.key === "max_err")!.raw).toBeCloseTo(0.009, 9);
    expect(acc.status).toBe("PASS");
    expect(evaluation.overall).toBe("PASS");
    // Graphs from real data only.
    const curve = acc.graphs.find(g => g.type === "calibration-curve")!;
    expect(curve.series[0].points.map(p => p.x)).toEqual([-17, 8.7, 17, 34]);
    expect(curve.series[0].points[0].y).toBeCloseTo(-17.005, 9);
    expect(curve.regression!.slope).toBeCloseTo(acc.calculations.find(c => c.key === "slope")!.raw as number, 12);
    expect(curve.regression!.r2).toBeCloseTo(acc.calculations.find(c => c.key === "r2")!.raw as number, 12);
    expect(curve.xLabel).toMatch(/Reference/);
    expect(acc.graphs.find(g => g.type === "error")!.series[0].points.map(p => Number(p.y.toFixed(6)))).toEqual([-0.005, 0.002, 0.005, 0.009]);
    expect(rep.graphs[0].series[0].points.length).toBe(10);
    // FAIL determination with the same engine (one level out of limit).
    const failing = await val.calculateValidation({ instrumentKey: "polarimeter", revisionId: active.revision.id, measurements: { ...READINGS, accuracy: { levels: { ...READINGS.accuracy.levels, L4: [34.05, 34.06, 34.05] } } } });
    expect(failing.tests.find(t => t.testKey === "accuracy")!.status).toBe("FAIL");
    expect(failing.overall).toBe("FAIL");
    // A test without configured graphs and a test with insufficient data produce no graph.
    const partial = await val.calculateValidation({ instrumentKey: "polarimeter", revisionId: active.revision.id, measurements: { repeat: { readings: [17.0] } } });
    expect(partial.tests.find(t => t.testKey === "repeat")!.graphs).toEqual([]);
    expect(partial.tests.find(t => t.testKey === "accuracy")!.graphs).toEqual([]);
  });

  it("saves an immutable validation snapshot tied to the protocol revision", async () => {
    const res = await val.recordValidation(normal, { instrumentKey: "polarimeter", revisionId: rev1, measurements: READINGS, comments: "Routine calibration" });
    runId = res.runId;
    expect(res.evaluation.overall).toBe("PASS");
    const stored = await val.getValidation(runId);
    expect(stored).toMatchObject({ protocolNumber: "CAL-QC-POL-002", revisionNumber: 1, revisionId: rev1, overall: "PASS" });
    expect(stored.equipment.identity.instrumentId).toBe("QC-I-029");
    expect(stored.content.sections[0].tests[0].criteria[0].upper).toBe(0.02);
    expect(stored.measurements).toEqual(READINGS);
    expect(stored.evaluation.tests[0].graphs.length).toBe(3);
    expect((stored.referenceSnapshot as { references: unknown[] }).references).toEqual([]);
    expect(() => localConnection().prepare("UPDATE protocol_runs SET overall_result = 'FAIL' WHERE id = ?").run(runId)).toThrow(/immutable/);
    expect(() => localConnection().prepare("UPDATE protocol_executions SET overall_result = 'FAIL' WHERE id = ?").run(res.executionId)).toThrow(/append-only/);
    expect((await val.listValidations({ instrumentKey: "polarimeter" })).map(v => v.id)).toEqual([runId]);
  });

  it("Edit creates a new Draft copied from the approved revision; approval supersedes the previous one; history is kept", async () => {
    expect((await errorOf(val.editProtocol(normal, { protocolId, reason: "change" }))).code).toBe("FORBIDDEN");
    const e = await val.editProtocol(editor, { protocolId, reason: "Tighten repeatability limit" });
    expect(e).toMatchObject({ created: true, revisionNumber: 2 });
    rev2 = e.revisionId;
    expect((await val.editProtocol(editor, { protocolId, reason: "again" })).revisionId).toBe(rev2); // the open draft is reused
    const draft = await svc.getRevision(editor, rev2);
    const approvedContent = (await svc.getRevision(editor, rev1)).revision.content;
    expect(draft.revision.content).toEqual(approvedContent);
    await svc.saveDraft(editor, { revisionId: rev2, expectedRowVersion: draft.revision.rowVersion, content: polarimeterContent(draft.revision.content, { verified: true, rsdLimit: 0.001 }), reason: "Tighten repeatability limit" });
    // Rev 1 stays active and unchanged while Rev 2 is a draft.
    expect(((await val.activeProtocolForEquipment("polarimeter")) as { revision: { revisionNumber: number } }).revision.revisionNumber).toBe(1);
    const v = (await svc.getRevision(qm, rev2)).revision.rowVersion;
    await svc.transition(qm, { revisionId: rev2, expectedRowVersion: v, action: "approve", password: PW });
    const detail = await val.protocolForEquipment(normal, "polarimeter");
    expect(detail.revisions.map(r => [r.revisionNumber, r.status])).toEqual([[2, "released"], [1, "superseded"]]);
    expect(detail.revisions[0].qaApproverName).toBe("Quality Manager");
    expect(detail.revisions[1].modifiedBy).toBe("Editor");
    expect(((await val.activeProtocolForEquipment("polarimeter")) as { revision: { revisionNumber: number } }).revision.revisionNumber).toBe(2);
    // A stale client that still holds Rev 1 cannot save against it.
    expect((await errorOf(val.recordValidation(normal, { instrumentKey: "polarimeter", revisionId: rev1, measurements: READINGS }))).message).toMatch(/active approved protocol changed/);
    // The historical validation keeps its own revision and result.
    const stored = await val.getValidation(runId);
    expect(stored.revisionNumber).toBe(1);
    expect(stored.overall).toBe("PASS");
    expect(stored.content.sections[0].tests[1].criteria[0].upper).toBe(0.05);
    expect(stored.revisionStatusNow).toBe("superseded");
    // Under Rev 2 (RSD ≤ 0.001 %) the same readings fail.
    const rerun = await val.recordValidation(normal, { instrumentKey: "polarimeter", revisionId: rev2, measurements: READINGS });
    expect(rerun.evaluation.overall).toBe("FAIL");
  });

  it("only one active protocol per equipment", async () => {
    // A second protocol linked to the same equipment through the legacy builder cannot become active.
    const base = (await svc.getRevision(editor, rev2)).revision.content;
    const other = await svc.createProtocol(editor, { content: { ...base, identification: { ...base.identification, number: "CAL-QC-POL-099", title: "Duplicate polarimeter protocol" } }, reason: "dup" });
    const v = (await svc.getRevision(qm, other.revisionId)).revision.rowVersion;
    expect((await errorOf(svc.transition(qm, { revisionId: other.revisionId, expectedRowVersion: v, action: "approve", password: PW }))).message).toMatch(/already has an active approved protocol/);
  });

  it("reset: backup first, removes all protocol data, keeps users, duties, equipment and validation history tables", async () => {
    const conn = localConnection();
    const count = (t: string) => Number((conn.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
    const users = count("app_users");
    const duties = count("protocol_duty_assignments");
    const equipmentSpecs = count("protocol_equipment_specs");
    const equipmentChanges = count("protocol_equipment_changes");
    const profiles = count("instrument_profiles");
    expect(count("protocols")).toBeGreaterThan(0);
    const result = await resetProtocolDataSqlite({ backupPath: backupFile, actor: { id: admin.id, name: "Admin" } });
    expect(existsSync(backupFile) && statSync(backupFile).size > 0).toBe(true);
    expect(result.deleted.protocols).toBe(2);
    for (const t of ["protocols", "protocol_revisions", "protocol_runs", "protocol_executions", "protocol_approvals", "protocol_references", "protocol_run_snapshots"]) expect(count(t)).toBe(0);
    expect(count("app_users")).toBe(users);
    expect(count("protocol_duty_assignments")).toBe(duties);
    expect(count("protocol_equipment_specs")).toBe(equipmentSpecs);
    expect(count("protocol_equipment_changes")).toBe(equipmentChanges);
    expect(count("instrument_profiles")).toBe(profiles);
    expect(count("protocol_audit_events")).toBeGreaterThan(0);
    // Guards are back after the reset.
    expect((conn.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='protocol_revisions_no_delete'").get() as { n: number }).n).toBe(1);
    // Roles still effective; board shows nine cards with no protocols.
    const board = await val.protocolBoard(qm);
    expect(board.permissions).toEqual({ canEdit: true, canApprove: true, canExecute: true });
    // Only the HPLC protocol transcribed from HPLC.pdf is re-registered automatically — as a Draft, never approved.
    expect(board.cards.filter(c => c.cardKey !== "hplc").every(c => c.protocol === null)).toBe(true);
    const hplcCard = board.cards.find(c => c.cardKey === "hplc")!;
    expect(hplcCard.protocol).toMatchObject({ number: "CAL-QC-HPLC-001", activeRevision: null, draftRevision: { revisionNumber: 1 } });
    expect((await val.activeProtocolForEquipment("hplc")).available).toBe(false);
    expect((await val.activeProtocolForEquipment("polarimeter")).available).toBe(false);
  });
});
