/**
 * Protocol page + protocol-driven New Validation (v4).
 *
 *  - Protocol board: the nine equipment cards linked to existing Equipment
 *    Master records, each with its protocol (active approved revision + open draft).
 *  - Simplified revision handling: "Edit" always works on a Draft; when the
 *    protocol only has an approved revision, a new Draft is created as a copy of
 *    the active approved revision (the approved revision is never modified).
 *  - New Validation: the backend resolves the ACTIVE APPROVED revision for the
 *    selected equipment; readings are evaluated with the shared calculation
 *    engine (recomputed on the server — the client result is never trusted) and
 *    stored as an immutable record (recorded run + execution) holding the
 *    equipment snapshot, protocol ID / number / revision / content hash, the
 *    protocol content (tests, criteria, formulas), the reference snapshot, raw
 *    readings, calculated results, decisions and graph data.
 */
import { evaluateExecution, type ExecutionEvaluation, type Measurements } from "../../shared/protocols/evaluate";
import { PROTOCOL_EQUIPMENT_CARDS, NO_APPROVED_PROTOCOL, matchCardEquipment } from "../../shared/protocols/protocolCards";
import { parseProtocolContent, type ProtocolContent, type ProtocolContentInput } from "../../shared/protocols/model";
import type { EquipmentSnapshot } from "../../shared/protocols/equipment";
import { ProtocolError, createProtocol, createRevision, internals, prepareExecution, protocolStore, type Actor, type ProtocolRow, type RevisionRow } from "./service";
import { listEquipmentData, snapshotOf, type EquipmentView } from "./workflowService";

const { requireDuty, dutiesOf, audit, id, now, loadProtocol, loadRevision, revisionSummaries, mapRevisionSummary } = internals;

type RevisionSummaryRow = Awaited<ReturnType<typeof revisionSummaries>>[number];

function equipmentDto(e: EquipmentView | null) {
  if (!e) return null;
  return { instrumentKey: e.instrumentKey, equipmentType: e.equipmentType, identity: e.identity, status: e.status, accent: e.accent, version: e.version };
}

/** Protocols linked to an equipment record (by equipment link of the current revision or header instrument key). */
async function protocolsForEquipment(instrumentKey: string): Promise<ProtocolRow[]> {
  const rows = await protocolStore().select<ProtocolRow>("protocols", { order: [{ column: "protocol_number" }] });
  const out: ProtocolRow[] = [];
  for (const p of rows) {
    if (p.instrument_key === instrumentKey) {
      out.push(p);
      continue;
    }
    const revId = p.released_revision_id ?? p.current_revision_id;
    if (!revId) continue;
    const rev = await loadRevision(revId);
    if (rev.content.equipmentLinks.some(l => l.instrumentKey === instrumentKey)) out.push(p);
  }
  return out;
}

function protocolSummary(p: ProtocolRow, revisions: RevisionSummaryRow[]) {
  const active = revisions.find(r => r.status === "released") ?? null;
  const draft = revisions.find(r => r.status === "draft") ?? null;
  return {
    id: p.id,
    number: p.protocol_number,
    title: p.title,
    activeRevision: active ? { id: active.id, revisionNumber: active.revision_number, approvedAt: active.approved_at ?? active.released_at, approvedBy: active.qa_approver_name ?? active.released_by_name } : null,
    draftRevision: draft ? { id: draft.id, revisionNumber: draft.revision_number, updatedAt: draft.updated_at, authorName: draft.author_name } : null,
    revisionCount: revisions.length,
  };
}

export async function protocolBoard(actor: Actor) {
  const [equipment, duties] = await Promise.all([listEquipmentData(), dutiesOf(actor)]);
  const cards = [];
  for (const card of PROTOCOL_EQUIPMENT_CARDS) {
    const eq = matchCardEquipment(card, equipment);
    let protocol: ReturnType<typeof protocolSummary> | null = null;
    if (eq) {
      const [p] = await protocolsForEquipment(eq.instrumentKey);
      if (p) protocol = protocolSummary(p, await revisionSummaries(p.id));
    }
    cards.push({ cardKey: card.cardKey, title: card.title, titleAr: card.titleAr, equipment: equipmentDto(eq), protocol });
  }
  return { cards, permissions: permissionsOf(duties), duties };
}

function permissionsOf(duties: readonly string[]) {
  return { canEdit: duties.includes("author"), canApprove: duties.includes("quality-manager"), canExecute: duties.includes("executor") };
}

/** Protocol Details page data for one equipment card. */
export async function protocolForEquipment(actor: Actor, instrumentKey: string) {
  const equipment = (await listEquipmentData()).find(e => e.instrumentKey === instrumentKey) ?? null;
  if (!equipment) throw new ProtocolError("NOT_FOUND", `Equipment ${instrumentKey} is not registered in the Equipment Master`);
  const duties = await dutiesOf(actor);
  const card = PROTOCOL_EQUIPMENT_CARDS.find(c => matchCardEquipment(c, [equipment]));
  const [p] = await protocolsForEquipment(instrumentKey);
  if (!p) return { equipment: equipmentDto(equipment), card: card ? { cardKey: card.cardKey, title: card.title, titleAr: card.titleAr } : null, protocol: null, revisions: [], permissions: permissionsOf(duties) };
  const revisions = await revisionSummaries(p.id);
  // "Modified by": last content update recorded in the audit trail of each revision.
  const auditRows = await protocolStore().select<Record<string, unknown>>("protocol_audit_events", { where: { protocol_id: p.id }, columns: ["revision_id", "action", "actor_name", "created_at"], order: [{ column: "created_at", desc: true }], limit: 1000 });
  const lastModified = new Map<string, { by: string | null; at: string }>();
  auditRows.forEach(a => {
    const rid = a.revision_id as string | null;
    if (!rid || lastModified.has(rid)) return;
    if (["revision.content-updated", "revision.created", "protocol.created"].includes(String(a.action))) lastModified.set(rid, { by: (a.actor_name as string | null) ?? null, at: String(a.created_at) });
  });
  return {
    equipment: equipmentDto(equipment),
    card: card ? { cardKey: card.cardKey, title: card.title, titleAr: card.titleAr } : null,
    protocol: protocolSummary(p, revisions),
    revisions: revisions.map(r => ({ ...mapRevisionSummary(r), modifiedBy: lastModified.get(r.id)?.by ?? r.author_name, modifiedAt: lastModified.get(r.id)?.at ?? r.updated_at })),
    permissions: permissionsOf(duties),
  };
}

/** Creates the (empty) protocol of an equipment record — editor only; one protocol per equipment. */
export async function createProtocolForEquipment(actor: Actor, input: { instrumentKey: string; number: string; title: string; protocolType?: ProtocolContentInput["identification"]["protocolType"]; reason: string }) {
  await requireDuty(actor, "author");
  const equipment = (await listEquipmentData()).find(e => e.instrumentKey === input.instrumentKey);
  if (!equipment) throw new ProtocolError("NOT_FOUND", `Equipment ${input.instrumentKey} is not registered in the Equipment Master`);
  if (equipment.status === "retired") throw new ProtocolError("PRECONDITION_FAILED", "Retired equipment cannot receive a new protocol");
  const existing = await protocolsForEquipment(input.instrumentKey);
  if (existing.length) throw new ProtocolError("PRECONDITION_FAILED", `Equipment ${equipment.identity.instrumentId} already has protocol ${existing[0].protocol_number}; edit it (a new revision is created) instead of creating another one`);
  const idn = equipment.identity;
  const content: ProtocolContentInput = {
    identification: {
      title: input.title.trim(),
      number: input.number.trim(),
      protocolType: input.protocolType ?? "calibration",
      associationType: "equipment",
      equipmentType: equipment.equipmentType,
      equipmentCategory: equipment.equipmentType,
      manufacturer: idn.manufacturer,
      model: idn.model,
      relatedForm: idn.formNumber,
      applicableSops: idn.sopNumber,
    },
    equipmentLinks: [{ instrumentKey: equipment.instrumentKey, instrumentId: idn.instrumentId, serialNumber: idn.serialNumber, manufacturer: idn.manufacturer, model: idn.model, compatibilityNote: "" }],
    sections: [{ key: "tests", title: "Tests", tests: [] }],
  } as ProtocolContentInput;
  return createProtocol(actor, { content, reason: input.reason.trim() || "Protocol created from the Protocol page" });
}

/**
 * "Edit" button: returns the open Draft of the protocol, or creates a new Draft
 * revision copied from the active approved revision. The approved revision is
 * never modified.
 */
export async function editProtocol(actor: Actor, input: { protocolId: string; reason: string }) {
  await requireDuty(actor, "author");
  const revisions = await revisionSummaries(input.protocolId);
  const draft = revisions.find(r => r.status === "draft");
  if (draft) return { revisionId: draft.id, revisionNumber: draft.revision_number, created: false };
  const open = revisions.find(r => !["released", "superseded", "retired", "rejected"].includes(r.status));
  if (open) throw new ProtocolError("PRECONDITION_FAILED", `Revision ${open.revision_number} is in the legacy review workflow (${open.status}); it must be completed or retired before a new draft can be created`);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ProtocolError("BAD_REQUEST", "A reason for the new revision is required");
  const res = await createRevision(actor, { protocolId: input.protocolId, reason, description: reason });
  return { revisionId: res.revisionId, revisionNumber: res.revisionNumber, created: true };
}

/* ------------------------------------------------------------------ */
/* New Validation                                                       */
/* ------------------------------------------------------------------ */

async function resolveActive(instrumentKey: string) {
  const equipment = (await listEquipmentData()).find(e => e.instrumentKey === instrumentKey);
  if (!equipment) throw new ProtocolError("NOT_FOUND", `Equipment ${instrumentKey} is not registered in the Equipment Master`);
  const protocols = (await protocolsForEquipment(instrumentKey)).filter(p => p.released_revision_id);
  for (const p of protocols) {
    const revision = await loadRevision(p.released_revision_id as string);
    if (revision.status === "released") return { equipment, protocol: p, revision };
  }
  return { equipment, protocol: null, revision: null };
}

/** Active approved protocol for New Validation (null + message when none is approved). */
export async function activeProtocolForEquipment(instrumentKey: string) {
  const { equipment, protocol, revision } = await resolveActive(instrumentKey);
  if (!protocol || !revision) return { equipment: equipmentDto(equipment), available: false as const, message: NO_APPROVED_PROTOCOL };
  return {
    equipment: equipmentDto(equipment),
    available: true as const,
    protocol: { id: protocol.id, number: protocol.protocol_number, title: protocol.title },
    revision: { id: revision.id, revisionNumber: revision.revision_number, approvedAt: revision.approved_at ?? revision.released_at, approvedBy: revision.qa_approver_name ?? revision.released_by_name, effectiveDate: revision.effective_date, contentHash: revision.content_hash },
    content: revision.content,
    referenceSnapshot: revision.reference_snapshot ?? null,
  };
}

/** Recomputes the result for display ("Calibration" button) — no data stored. */
export async function calculateValidation(input: { instrumentKey: string; revisionId: string; measurements: Measurements }) {
  const { revision } = await resolveActive(input.instrumentKey);
  if (!revision) throw new ProtocolError("PRECONDITION_FAILED", NO_APPROVED_PROTOCOL);
  if (revision.id !== input.revisionId) throw new ProtocolError("PRECONDITION_FAILED", `The active approved protocol changed (Rev ${revision.revision_number} is now active); reload New Validation`);
  return evaluateExecution(revision.content, input.measurements);
}

function assertKnownMeasurements(content: ProtocolContent, measurements: Measurements) {
  const known = new Set(content.sections.flatMap(s => s.tests.map(t => t.key)));
  const unknown = Object.keys(measurements).filter(k => !known.has(k));
  if (unknown.length) throw new ProtocolError("BAD_REQUEST", "Readings reference tests that are not part of the approved protocol revision", unknown);
  if (JSON.stringify(measurements).length > 900_000) throw new ProtocolError("BAD_REQUEST", "Validation data too large");
}

/** Saves a validation as an immutable record tied to the protocol revision used. */
export async function recordValidation(actor: Actor, input: { instrumentKey: string; revisionId: string; measurements: Measurements; comments?: string }) {
  const duties = await requireDuty(actor, "executor");
  const { equipment, protocol, revision } = await resolveActive(input.instrumentKey);
  if (!protocol || !revision) throw new ProtocolError("PRECONDITION_FAILED", NO_APPROVED_PROTOCOL);
  if (revision.id !== input.revisionId) throw new ProtocolError("PRECONDITION_FAILED", `The active approved protocol changed (Rev ${revision.revision_number} is now active); reload New Validation and re-enter the readings`);
  if (equipment.status === "retired") throw new ProtocolError("PRECONDITION_FAILED", "Retired equipment cannot be validated");
  assertKnownMeasurements(revision.content, input.measurements);
  const check = evaluateExecution(revision.content, input.measurements);
  const incomplete = check.tests.filter(t => t.status === "INCOMPLETE");
  if (incomplete.length) throw new ProtocolError("PRECONDITION_FAILED", "Required readings are missing — complete every test and press Calibration before saving", incomplete.slice(0, 10).map(t => `${t.name}: ${t.notes.join(" ") || "incomplete"}`));
  const prepared = await prepareExecution(actor, { revisionId: revision.id, instrumentKey: equipment.instrumentKey, measurements: input.measurements, comments: input.comments?.trim() || undefined });
  const evaluation: ExecutionEvaluation = prepared.evaluation;
  const t = now();
  const runId = id();
  const runNumber = `VAL-${protocol.protocol_number}-R${String(revision.revision_number).padStart(2, "0")}-${t.slice(0, 10).replace(/-/g, "")}-${runId.slice(0, 6).toUpperCase()}`;
  const snapshot: EquipmentSnapshot = snapshotOf(equipment);
  await protocolStore().apply([
    ...prepared.changes,
    { op: "insert", table: "protocol_runs", row: { id: runId, run_number: runNumber, protocol_id: protocol.id, revision_id: revision.id, protocol_number: protocol.protocol_number, revision_number: revision.revision_number, revision_status: revision.status, content_hash: revision.content_hash, protocol_snapshot: revision.content, instrument_key: equipment.instrumentKey, equipment_snapshot: snapshot, equipment_version: equipment.version, measurements: input.measurements, evaluation, overall_result: evaluation.overall, current_step: "recorded", status: "recorded", execution_id: prepared.executionId, created_by_user_id: actor.id, created_by_name: actor.name, created_at: t, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: 1 } },
    { op: "insert", table: "protocol_run_snapshots", row: { id: id(), run_id: runId, row_version: 1, action: "recorded", measurements: input.measurements, evaluation, overall_result: evaluation.overall, equipment_version: equipment.version, reason: `New Validation — execution ${prepared.executionId}`, actor_user_id: actor.id, actor_name: actor.name, created_at: t } },
    audit(actor, duties, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "run", entityId: runId, action: "validation.recorded", next: { runNumber, executionId: prepared.executionId, instrumentKey: equipment.instrumentKey, equipmentId: equipment.identity.instrumentId, overall: evaluation.overall, contentHash: revision.content_hash } }),
  ]);
  return { runId, runNumber, executionId: prepared.executionId, evaluation };
}

type StoredRun = {
  id: string; run_number: string; protocol_id: string; revision_id: string; protocol_number: string; revision_number: number; revision_status: string; content_hash: string;
  protocol_snapshot: ProtocolContent; instrument_key: string; equipment_snapshot: EquipmentSnapshot; equipment_version: string; measurements: Measurements; evaluation: ExecutionEvaluation | null;
  overall_result: string | null; status: string; execution_id: string | null; created_by_name: string | null; created_at: string;
};

export async function listValidations(filter: { instrumentKey?: string } = {}) {
  const where: Record<string, string> = { status: "recorded" };
  if (filter.instrumentKey) where.instrument_key = filter.instrumentKey;
  const rows = await protocolStore().select<StoredRun>("protocol_runs", { where, columns: ["id", "run_number", "protocol_id", "protocol_number", "revision_number", "instrument_key", "equipment_snapshot", "overall_result", "execution_id", "created_by_name", "created_at"], order: [{ column: "created_at", desc: true }], limit: 300 });
  return rows.map(r => ({ id: r.id, runNumber: r.run_number, protocolId: r.protocol_id, protocolNumber: r.protocol_number, revisionNumber: r.revision_number, instrumentKey: r.instrument_key, equipmentId: r.equipment_snapshot?.identity?.instrumentId ?? "", equipmentName: r.equipment_snapshot?.identity?.nameEn ?? "", overall: r.overall_result, executionId: r.execution_id, recordedBy: r.created_by_name, recordedAt: r.created_at }));
}

/** A stored validation exactly as recorded (stored evaluation — never recomputed with newer protocol revisions). */
export async function getValidation(runId: string) {
  const [run] = await protocolStore().select<StoredRun>("protocol_runs", { where: { id: runId }, limit: 1 });
  if (!run || run.status !== "recorded") throw new ProtocolError("NOT_FOUND", "Validation record not found");
  let referenceSnapshot: unknown = null;
  let executionReviewStatus: string | null = null;
  let approvedBy: string | null = null;
  if (run.execution_id) {
    const [exec] = await protocolStore().select<Record<string, unknown>>("protocol_executions", { where: { id: run.execution_id }, columns: ["reference_snapshot"], limit: 1 });
    referenceSnapshot = exec?.reference_snapshot ?? null;
    const reviews = await protocolStore().select<{ to_status: string }>("protocol_execution_reviews", { where: { execution_id: run.execution_id }, columns: ["to_status"], order: [{ column: "created_at" }] });
    executionReviewStatus = reviews.length ? reviews[reviews.length - 1].to_status : "recorded";
  }
  const revision: RevisionRow | null = await loadRevision(run.revision_id).catch(() => null);
  if (revision) approvedBy = revision.qa_approver_name ?? revision.released_by_name;
  const protocol = await loadProtocol(run.protocol_id).catch(() => null);
  const content = parseProtocolContent(run.protocol_snapshot);
  return {
    id: run.id,
    runNumber: run.run_number,
    protocolId: run.protocol_id,
    protocolNumber: run.protocol_number,
    protocolTitle: protocol?.title ?? content.identification.title,
    revisionId: run.revision_id,
    revisionNumber: run.revision_number,
    revisionStatusAtRecording: run.revision_status,
    revisionStatusNow: revision?.status ?? null,
    revisionApprovedAt: revision?.approved_at ?? revision?.released_at ?? null,
    revisionApprovedBy: approvedBy,
    contentHash: run.content_hash,
    content,
    referenceSnapshot,
    equipment: run.equipment_snapshot,
    measurements: run.measurements ?? {},
    evaluation: run.evaluation ?? evaluateExecution(content, run.measurements ?? {}),
    overall: run.overall_result,
    executionId: run.execution_id,
    executionReviewStatus,
    recordedBy: run.created_by_name,
    recordedAt: run.created_at,
  };
}
