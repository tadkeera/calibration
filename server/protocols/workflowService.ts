/**
 * Calibration workflow services (v3):
 *  - Equipment data & specifications («تعديل بيانات المعدات والمواصفات») with
 *    field-level immutable audit and controlled propagation to protocols;
 *  - Calibration runs: dynamic per-protocol workflow (one step per test) with
 *    frozen equipment + protocol snapshots, versioned drafts and optimistic
 *    concurrency (conflicting edits are never overwritten silently);
 *  - Import of the supplied 8-protocol package (idempotent, never overwrites).
 *
 * Identity data stays in the existing Equipment Library (instrument_profiles).
 * Formal execution / review / approval reuse the existing execution workflow.
 */
import { devices } from "../../client/src/lib/qc";
import { listInstrumentProfiles, upsertInstrumentProfile } from "../db";
import {
  IDENTITY_FIELDS,
  diffEquipment,
  equipmentVersion,
  specDefinitions,
  specIssues,
  type EquipmentIdentity,
  type EquipmentSnapshot,
  type SpecMap,
} from "../../shared/protocols/equipment";
import { evaluateExecution, type Measurements } from "../../shared/protocols/evaluate";
import type { ExecutionDeviation } from "../../shared/protocols/executionReview";
import { EDITABLE_STATUSES, LOCKED_STATUSES, parseProtocolContent, type ProtocolContent } from "../../shared/protocols/model";
import { BAL_REV01_SPEC_SOURCES, BAL_REV03, BAL_REV03_REASON, PACKAGE_IMPORT_REASON, PACKAGE_NEW_EQUIPMENT, PACKAGE_PROTOCOLS, PACKAGE_REFERENCES } from "../../shared/protocols/package8";
import { remapReferencePlaceholders } from "../../shared/protocols/adp220";
import { buildRunSteps, canonicalStepBlockers, naMeasurementKey, runApprovalBlockers } from "../../shared/protocols/runWorkflow";
import {
  ProtocolError,
  compatibilityProblems,
  createProtocol,
  createRevision,
  equipmentRegistry,
  saveDraft,

  internals,
  normalizeMaker,
  prepareExecution,
  protocolStore,
  saveReference,
  type Actor,
  type EquipmentEntry,
  type ProtocolRow,
  type RevisionRow,
} from "./service";
import type { Change } from "./tables";

const { requireDuty, audit, notify, id, now, loadProtocol, loadRevision, referenceLookup, actorRole, dutiesOf } = internals;

/* ------------------------------------------------------------------ */
/* Schema readiness                                                     */
/* ------------------------------------------------------------------ */

async function requireWorkflowSchema() {
  const status = await protocolStore().schemaStatus();
  if (!status.ok || !status.workflowOk)
    throw new ProtocolError(
      "PRECONDITION_FAILED",
      "The calibration-workflow tables are not installed. Re-run server/sql/protocol_management_migration.sql in the Supabase SQL Editor (it is additive and idempotent)",
      [...status.missing, ...status.workflowMissing].slice(0, 10)
    );
}

/* ------------------------------------------------------------------ */
/* Equipment                                                            */
/* ------------------------------------------------------------------ */

type SpecsRow = {
  id: string; instrument_key: string; equipment_type: string | null; status: "active" | "retired"; specs: SpecMap; retired_reason: string | null; retired_at: string | null;
  created_by_user_id: number; created_by_name: string | null; created_at: string; updated_by_user_id: number | null; updated_by_name: string | null; updated_at: string; row_version: number;
};

const requireEditor = (actor: Actor) => {
  if (actor.role === "viewer") throw new ProtocolError("FORBIDDEN", "Viewers cannot change equipment data");
};

async function profileExtras() {
  try {
    return new Map((await listInstrumentProfiles()).map(p => [p.instrumentKey, p]));
  } catch {
    return new Map();
  }
}

function identityOf(entry: EquipmentEntry, nameAr: string): EquipmentIdentity {
  return { instrumentId: entry.instrumentId, manufacturer: entry.manufacturer, model: entry.model, serialNumber: entry.serialNumber, nameEn: entry.name, nameAr, sopNumber: entry.sopNumber, formNumber: entry.formNumber };
}

async function specsRows() {
  try {
    return await protocolStore().select<SpecsRow>("protocol_equipment_specs");
  } catch {
    return [] as SpecsRow[];
  }
}

export type EquipmentView = {
  instrumentKey: string; equipmentType: string; identity: EquipmentIdentity; accent: string; specs: SpecMap; status: "active" | "retired"; retiredReason: string | null;
  specsRowVersion: number; version: string; source: EquipmentEntry["source"]; updatedAt: string | null; updatedBy: string | null;
};

export async function listEquipmentData(): Promise<EquipmentView[]> {
  const [registry, extras, specs] = await Promise.all([equipmentRegistry(), profileExtras(), specsRows()]);
  const byKey = new Map(specs.map(s => [s.instrument_key, s]));
  return registry.map(entry => {
    const device = devices.find(d => d.key === entry.instrumentKey);
    const profile = extras.get(entry.instrumentKey) as { nameAr?: string; accent?: string } | undefined;
    const row = byKey.get(entry.instrumentKey);
    const identity = identityOf(entry, profile?.nameAr ?? device?.name ?? entry.name);
    const specMap = (row?.specs ?? {}) as SpecMap;
    return {
      instrumentKey: entry.instrumentKey,
      equipmentType: row?.equipment_type ?? device?.key ?? entry.instrumentKey,
      identity,
      accent: profile?.accent ?? device?.accent ?? "#0C5A4C",
      specs: specMap,
      status: row?.status ?? "active",
      retiredReason: row?.retired_reason ?? null,
      specsRowVersion: row?.row_version ?? 0,
      version: equipmentVersion(identity, specMap),
      source: entry.source,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by_name ?? null,
    };
  });
}

async function equipmentOrThrow(instrumentKey: string) {
  const all = await listEquipmentData();
  const item = all.find(e => e.instrumentKey === instrumentKey);
  if (!item) throw new ProtocolError("NOT_FOUND", `Equipment ${instrumentKey} not found in the Equipment Library`);
  return { item, all };
}

export async function getEquipmentData(instrumentKey: string) {
  const { item } = await equipmentOrThrow(instrumentKey);
  let changes: Array<Record<string, unknown>> = [];
  let runs: Array<Record<string, unknown>> = [];
  try {
    changes = await protocolStore().select("protocol_equipment_changes", { where: { instrument_key: instrumentKey }, order: [{ column: "created_at", desc: true }], limit: 300 });
    runs = await protocolStore().select("protocol_runs", { where: { instrument_key: instrumentKey }, columns: ["id", "run_number", "protocol_number", "revision_number", "status", "equipment_version", "updated_at"], order: [{ column: "updated_at", desc: true }], limit: 100 });
  } catch {
    /* workflow tables not installed — read-only view of identity */
  }
  const protocols = await linkedProtocols(instrumentKey, item.identity);
  return {
    equipment: item,
    definitions: specDefinitions(item.equipmentType),
    changes: changes.map(c => ({ id: c.id as string, changeSetId: c.change_set_id as string, group: c.field_group as string, field: c.field as string, label: c.label as string, previous: c.previous_value, next: c.new_value, unit: c.unit as string, critical: !!c.critical, reason: c.reason as string | null, reference: c.reference as string | null, actorName: c.actor_name as string | null, actorRole: c.actor_role as string | null, createdAt: c.created_at as string })),
    runs: runs.map(r => ({ id: r.id as string, runNumber: r.run_number as string, protocolNumber: r.protocol_number as string, revisionNumber: r.revision_number as number, status: r.status as string, outdated: r.status === "draft" && r.equipment_version !== item.version, updatedAt: r.updated_at as string })),
    protocols,
  };
}

/** Protocols whose current or released revision references this equipment (link or model association). */
async function linkedProtocols(instrumentKey: string, identity: EquipmentIdentity) {
  const protocols = await protocolStore().select<ProtocolRow>("protocols", { order: [{ column: "protocol_number" }] });
  const out: Array<{ protocolId: string; protocolNumber: string; title: string; status: string; association: "link" | "model"; revisionStatus: string }> = [];
  for (const p of protocols) {
    if (!p.current_revision_id) continue;
    const revision = await loadRevision(p.current_revision_id);
    const linked = revision.content.equipmentLinks.some(l => l.instrumentKey === instrumentKey);
    const modelMatch = revision.content.identification.associationType === "model" && normalizeMaker(revision.content.identification.model) === normalizeMaker(identity.model);
    if (linked || modelMatch) out.push({ protocolId: p.id, protocolNumber: p.protocol_number, title: p.title, status: p.status, association: linked ? "link" : "model", revisionStatus: revision.status });
  }
  return out;
}

export type EquipmentUpdateInput = {
  instrumentKey: string;
  expectedSpecsRowVersion: number;
  identity: EquipmentIdentity;
  specs: SpecMap;
  equipmentType?: string;
  reason: string;
  reference: string;
};

function assertIdentity(identity: EquipmentIdentity) {
  const missing = IDENTITY_FIELDS.filter(f => f.key !== "formNumber" && f.key !== "sopNumber" && !String(identity[f.key] ?? "").trim()).map(f => f.label);
  if (missing.length) throw new ProtocolError("BAD_REQUEST", "Required equipment fields are empty", missing);
  const tooLong = IDENTITY_FIELDS.filter(f => String(identity[f.key] ?? "").length > 255).map(f => f.label);
  if (tooLong.length) throw new ProtocolError("BAD_REQUEST", "Equipment fields too long", tooLong);
}

function assertNoDuplicates(all: EquipmentView[], instrumentKey: string, identity: EquipmentIdentity) {
  const others = all.filter(e => e.instrumentKey !== instrumentKey);
  const problems: string[] = [];
  const norm = (v: string) => v.trim().toUpperCase();
  const dupId = others.find(e => norm(e.identity.instrumentId) === norm(identity.instrumentId));
  if (dupId) problems.push(`Equipment ID ${identity.instrumentId} is already used by ${dupId.identity.nameEn} (${dupId.instrumentKey})`);
  const dupSerial = others.find(e => norm(e.identity.serialNumber) === norm(identity.serialNumber) && normalizeMaker(e.identity.manufacturer) === normalizeMaker(identity.manufacturer));
  if (dupSerial) problems.push(`Serial number ${identity.serialNumber} (${identity.manufacturer}) is already registered for ${dupSerial.identity.nameEn} (${dupSerial.instrumentKey})`);
  if (problems.length) throw new ProtocolError("PRECONDITION_FAILED", "Duplicate equipment identity", problems);
}

/**
 * Saves equipment identity + specifications. Every changed field is logged
 * (old, new, user, time, reason, reference). Propagation:
 *  - editable protocol drafts linked to the equipment: equipment link updated automatically (audited);
 *  - approved / released protocols: flagged — a new revision is required (never modified);
 *  - calibration runs keep their frozen snapshot (they show a "newer data" notice);
 *  - acceptance criteria are never changed by specification changes.
 */
export async function updateEquipmentData(actor: Actor, input: EquipmentUpdateInput) {
  requireEditor(actor);
  await requireWorkflowSchema();
  const duties = await dutiesOf(actor);
  const { item, all } = await equipmentOrThrow(input.instrumentKey);
  if (item.status === "retired") throw new ProtocolError("PRECONDITION_FAILED", "Retired equipment cannot be edited");
  if (item.specsRowVersion !== input.expectedSpecsRowVersion)
    throw new ProtocolError("PRECONDITION_FAILED", "The equipment data was changed by another user. Reload to compare both versions; your edits are kept on screen");
  const identity = Object.fromEntries(IDENTITY_FIELDS.map(f => [f.key, String(input.identity[f.key] ?? "").trim()])) as EquipmentIdentity;
  assertIdentity(identity);
  assertNoDuplicates(all, input.instrumentKey, identity);
  const equipmentType = input.equipmentType?.trim() || item.equipmentType;
  const issues = specIssues(equipmentType, input.specs);
  if (issues.length) throw new ProtocolError("BAD_REQUEST", "Invalid specification values", issues.map(i => `${i.field}: ${i.message}`));
  const changes = diffEquipment(equipmentType, { identity: item.identity, specs: item.specs }, { identity, specs: input.specs });
  if (!changes.length) return { changed: 0, propagated: [] as string[], flagged: [] as string[], outdatedRuns: 0 };
  const critical = changes.filter(c => c.critical);
  if (critical.length && input.reason.trim().length < 3)
    throw new ProtocolError("BAD_REQUEST", "A reason (at least 3 characters) is required for critical equipment changes", critical.map(c => c.label));

  const t = now();
  const changeSetId = id();
  const role = actorRole(actor, duties);
  const writes: Change[] = changes.map(c => ({
    op: "insert",
    table: "protocol_equipment_changes",
    row: { id: id(), change_set_id: changeSetId, instrument_key: input.instrumentKey, field_group: c.group, field: c.field, label: c.label, previous_value: c.previous ?? null, new_value: c.next ?? null, unit: c.unit, critical: c.critical, reason: input.reason.trim() || null, reference: input.reference.trim() || null, actor_user_id: actor.id, actor_name: actor.name, actor_role: role, created_at: t },
  }));
  const specChanged = changes.some(c => c.field.startsWith("spec.")) || equipmentType !== item.equipmentType;
  if (specChanged || item.specsRowVersion === 0) {
    if (item.specsRowVersion === 0)
      writes.push({ op: "insert", table: "protocol_equipment_specs", row: { id: id(), instrument_key: input.instrumentKey, equipment_type: equipmentType, status: "active", specs: input.specs, created_by_user_id: actor.id, created_by_name: actor.name, created_at: t, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: 1 } });
    else {
      const [row] = await protocolStore().select<SpecsRow>("protocol_equipment_specs", { where: { instrument_key: input.instrumentKey }, limit: 1 });
      writes.push({ op: "update", table: "protocol_equipment_specs", id: row.id, set: { equipment_type: equipmentType, specs: input.specs, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: row.row_version + 1 }, expect: { row_version: row.row_version } });
    }
  } else {
    // Identity-only change: bump the specs row version so concurrent editors detect it.
    const [row] = await protocolStore().select<SpecsRow>("protocol_equipment_specs", { where: { instrument_key: input.instrumentKey }, limit: 1 });
    if (row) writes.push({ op: "update", table: "protocol_equipment_specs", id: row.id, set: { updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: row.row_version + 1 }, expect: { row_version: row.row_version } });
  }

  // Propagation to protocols (identity changes only — specifications never alter protocol content or criteria).
  const identityChanged = changes.some(c => c.group === "identity" && ["instrumentId", "serialNumber", "manufacturer", "model"].includes(c.field));
  const propagated: string[] = [];
  const flagged: string[] = [];
  if (identityChanged) {
    const protocols = await protocolStore().select<ProtocolRow>("protocols");
    for (const p of protocols) {
      const revisions = await protocolStore().select<RevisionRow>("protocol_revisions", { where: { protocol_id: p.id } });
      const linkedRevs = revisions.filter(r => r.content.equipmentLinks.some(l => l.instrumentKey === input.instrumentKey) && !["superseded", "retired", "rejected"].includes(r.status));
      if (!linkedRevs.length) continue;
      let flag: string | null = null;
      for (const r of linkedRevs) {
        if (EDITABLE_STATUSES.includes(r.status)) {
          const content: ProtocolContent = {
            ...r.content,
            equipmentLinks: r.content.equipmentLinks.map(l => (l.instrumentKey === input.instrumentKey ? { ...l, instrumentId: identity.instrumentId, serialNumber: identity.serialNumber, manufacturer: identity.manufacturer, model: identity.model } : l)),
          };
          const parsed = parseProtocolContent(content);
          writes.push({ op: "update", table: "protocol_revisions", id: r.id, set: { content: parsed, ...internals.revisionDerived(parsed), updated_at: t, row_version: r.row_version + 1 }, expect: { row_version: r.row_version } });
          writes.push(audit(actor, duties, { protocolId: p.id, revisionId: r.id, revisionNumber: r.revision_number, entityType: "equipment-association", entityId: p.id, action: "equipment.link-synced", previous: r.content.equipmentLinks.filter(l => l.instrumentKey === input.instrumentKey), next: parsed.equipmentLinks.filter(l => l.instrumentKey === input.instrumentKey), reason: `Equipment data changed (change set ${changeSetId}): ${input.reason || "no reason given"}` }));
          propagated.push(`${p.protocol_number} rev ${r.revision_number}`);
          if (changes.some(c => c.field === "manufacturer" || c.field === "model")) flag = `Equipment ${input.instrumentKey} manufacturer/model changed — verify protocol identification and compatibility (draft link updated automatically).`;
        } else if (LOCKED_STATUSES.includes(r.status) || r.status.includes("review")) {
          flag = `Equipment ${input.instrumentKey} data changed (${changes.filter(c => c.group === "identity").map(c => c.label).join(", ")}). Revision ${r.revision_number} (${r.status}) is not modified — create a new revision to adopt the new equipment data.`;
          flagged.push(`${p.protocol_number} rev ${r.revision_number}`);
        }
      }
      if (flag) {
        writes.push({ op: "update", table: "protocols", id: p.id, set: { review_flag: true, review_flag_reason: flag.slice(0, 900), equipment_id: p.instrument_key === input.instrumentKey ? identity.instrumentId : p.equipment_id, updated_at: t, row_version: p.row_version + 1 }, expect: { row_version: p.row_version } });
        writes.push(notify("equipment-data-changed", null, p.created_by_user_id, p.id, null, `${p.protocol_number}: ${flag}`.slice(0, 900), `eqchange:${changeSetId}:${p.id}`));
      }
    }
  }

  // Identity is written to the existing Equipment Library (keeps the legacy calibration screens in sync).
  const identityDiff = changes.filter(c => c.group === "identity");
  if (identityDiff.length) {
    await upsertInstrumentProfile({ instrumentKey: input.instrumentKey, nameAr: identity.nameAr, nameEn: identity.nameEn, instrumentId: identity.instrumentId, sopNumber: identity.sopNumber, manufacturer: identity.manufacturer, model: identity.model, serialNumber: identity.serialNumber, formNumber: identity.formNumber, accent: item.accent, userId: actor.id });
  }
  await protocolStore().apply(writes);
  const runs = await protocolStore().select<{ id: string; status: string }>("protocol_runs", { where: { instrument_key: input.instrumentKey, status: "draft" }, columns: ["id", "status"] });
  return { changed: changes.length, changeSetId, propagated, flagged, outdatedRuns: runs.length };
}

/** Creates a new equipment record (e.g. the analytical balance defined by CAL-QC-BAL-001 Rev.01). */
export async function createEquipmentData(actor: Actor, input: { instrumentKey: string; equipmentType: string; identity: EquipmentIdentity; specs: SpecMap; accent?: string; reason: string; reference: string }) {
  requireEditor(actor);
  await requireWorkflowSchema();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(input.instrumentKey)) throw new ProtocolError("BAD_REQUEST", "Equipment key: lowercase letters, digits and - (2–64 characters)");
  if (input.reason.trim().length < 3) throw new ProtocolError("BAD_REQUEST", "A reason is required to register new equipment");
  const all = await listEquipmentData();
  if (all.some(e => e.instrumentKey === input.instrumentKey)) throw new ProtocolError("PRECONDITION_FAILED", `Equipment key ${input.instrumentKey} already exists`);
  const identity = Object.fromEntries(IDENTITY_FIELDS.map(f => [f.key, String(input.identity[f.key] ?? "").trim()])) as EquipmentIdentity;
  assertIdentity(identity);
  assertNoDuplicates(all, input.instrumentKey, identity);
  const issues = specIssues(input.equipmentType, input.specs);
  if (issues.length) throw new ProtocolError("BAD_REQUEST", "Invalid specification values", issues.map(i => `${i.field}: ${i.message}`));
  const duties = await dutiesOf(actor);
  const t = now();
  const changeSetId = id();
  const role = actorRole(actor, duties);
  const empty = Object.fromEntries(IDENTITY_FIELDS.map(f => [f.key, ""])) as EquipmentIdentity;
  const changes = diffEquipment(input.equipmentType, { identity: empty, specs: {} }, { identity, specs: input.specs });
  const writes: Change[] = [
    { op: "insert", table: "protocol_equipment_specs", row: { id: id(), instrument_key: input.instrumentKey, equipment_type: input.equipmentType, status: "active", specs: input.specs, created_by_user_id: actor.id, created_by_name: actor.name, created_at: t, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: 1 } },
    ...changes.map<Change>(c => ({ op: "insert", table: "protocol_equipment_changes", row: { id: id(), change_set_id: changeSetId, instrument_key: input.instrumentKey, field_group: c.group, field: c.field, label: c.label, previous_value: null, new_value: c.next ?? null, unit: c.unit, critical: c.critical, reason: input.reason.trim(), reference: input.reference.trim() || null, actor_user_id: actor.id, actor_name: actor.name, actor_role: role, created_at: t } })),
    { op: "insert", table: "protocol_equipment_changes", row: { id: id(), change_set_id: changeSetId, instrument_key: input.instrumentKey, field_group: "status", field: "status", label: "Equipment registered", previous_value: null, new_value: "active", unit: "", critical: true, reason: input.reason.trim(), reference: input.reference.trim() || null, actor_user_id: actor.id, actor_name: actor.name, actor_role: role, created_at: t } },
  ];
  await upsertInstrumentProfile({ instrumentKey: input.instrumentKey, nameAr: identity.nameAr, nameEn: identity.nameEn, instrumentId: identity.instrumentId, sopNumber: identity.sopNumber, manufacturer: identity.manufacturer, model: identity.model, serialNumber: identity.serialNumber, formNumber: identity.formNumber, accent: input.accent ?? "#3B5B8C", userId: actor.id });
  await protocolStore().apply(writes);
  return { instrumentKey: input.instrumentKey, changeSetId };
}

/** Retire instead of delete: the record, its history and all linked records are preserved. */
export async function retireEquipmentData(actor: Actor, input: { instrumentKey: string; expectedSpecsRowVersion: number; reason: string }) {
  requireEditor(actor);
  await requireWorkflowSchema();
  if (input.reason.trim().length < 3) throw new ProtocolError("BAD_REQUEST", "A reason is required to retire equipment");
  const { item } = await equipmentOrThrow(input.instrumentKey);
  if (item.status === "retired") return { retired: false };
  if (item.specsRowVersion !== input.expectedSpecsRowVersion) throw new ProtocolError("PRECONDITION_FAILED", "The equipment data was changed by another user; reload and retry");
  const duties = await dutiesOf(actor);
  const t = now();
  const writes: Change[] = [];
  if (item.specsRowVersion === 0)
    writes.push({ op: "insert", table: "protocol_equipment_specs", row: { id: id(), instrument_key: input.instrumentKey, equipment_type: item.equipmentType, status: "retired", specs: item.specs, retired_reason: input.reason.trim(), retired_at: t, created_by_user_id: actor.id, created_by_name: actor.name, created_at: t, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: 1 } });
  else {
    const [row] = await protocolStore().select<SpecsRow>("protocol_equipment_specs", { where: { instrument_key: input.instrumentKey }, limit: 1 });
    writes.push({ op: "update", table: "protocol_equipment_specs", id: row.id, set: { status: "retired", retired_reason: input.reason.trim(), retired_at: t, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: row.row_version + 1 }, expect: { row_version: row.row_version } });
  }
  writes.push({ op: "insert", table: "protocol_equipment_changes", row: { id: id(), change_set_id: id(), instrument_key: input.instrumentKey, field_group: "status", field: "status", label: "Equipment status", previous_value: "active", new_value: "retired", unit: "", critical: true, reason: input.reason.trim(), reference: null, actor_user_id: actor.id, actor_name: actor.name, actor_role: actorRole(actor, duties), created_at: t } });
  await protocolStore().apply(writes);
  return { retired: true };
}

/* ------------------------------------------------------------------ */
/* Calibration runs                                                     */
/* ------------------------------------------------------------------ */

type RunRow = {
  id: string; run_number: string; protocol_id: string; revision_id: string; protocol_number: string; revision_number: number; revision_status: string; content_hash: string;
  protocol_snapshot: ProtocolContent; instrument_key: string; equipment_snapshot: EquipmentSnapshot; equipment_version: string; measurements: Measurements; evaluation: ReturnType<typeof evaluateExecution> | null;
  overall_result: string | null; current_step: string | null; status: "draft" | "recorded" | "abandoned"; execution_id: string | null; abandon_reason: string | null;
  created_by_user_id: number; created_by_name: string | null; created_at: string; updated_by_user_id: number | null; updated_by_name: string | null; updated_at: string; row_version: number;
};

async function loadRun(runId: string) {
  const [row] = await protocolStore().select<RunRow>("protocol_runs", { where: { id: runId }, limit: 1 });
  if (!row) throw new ProtocolError("NOT_FOUND", "Calibration run not found");
  return row;
}

/** Equipment applicable to a protocol revision: its explicit links, or registry items matching a model-associated protocol. */
function candidateEquipment(content: ProtocolContent, all: EquipmentView[]) {
  if (content.equipmentLinks.length) return all.filter(e => content.equipmentLinks.some(l => l.instrumentKey === e.instrumentKey));
  return all.filter(e => normalizeMaker(e.identity.model) === normalizeMaker(content.identification.model));
}

/** Protocols available for a calibration run, with their applicable equipment and the canonical nine-step workflow. */
export async function runCatalog() {
  const all = await listEquipmentData();
  const protocols = await protocolStore().select<ProtocolRow>("protocols", { order: [{ column: "protocol_number" }] });
  const out = [];
  for (const p of protocols) {
    const revisionId = p.released_revision_id ?? p.current_revision_id;
    if (!revisionId) continue;
    const revision = await loadRevision(revisionId);
    if (["retired", "rejected", "superseded"].includes(revision.status)) continue;
    const steps = buildRunSteps(revision.content);
    const equipment = candidateEquipment(revision.content, all);
    out.push({
      protocolId: p.id, protocolNumber: p.protocol_number, title: p.title, revisionId: revision.id, revisionNumber: revision.revision_number, revisionStatus: revision.status,
      testCount: revision.content.sections.flatMap(s => s.tests).length, stepCount: steps.length, pendingVerification: revision.pending_verification_count, openGaps: revision.open_gap_count,
      equipment: equipment.map(e => ({ instrumentKey: e.instrumentKey, name: e.identity.nameEn, instrumentId: e.identity.instrumentId, status: e.status })),
      allEquipment: revision.content.equipmentLinks.length ? null : "model",
    });
  }
  return out;
}

function snapshotOf(e: EquipmentView): EquipmentSnapshot {
  return { instrumentKey: e.instrumentKey, equipmentType: e.equipmentType, identity: e.identity, specs: e.specs, status: e.status, specsRowVersion: e.specsRowVersion, capturedAt: now() };
}

export async function createRun(actor: Actor, input: { protocolId: string; instrumentKey: string }) {
  await requireWorkflowSchema();
  const duties = await requireDuty(actor, "executor");
  const protocol = await loadProtocol(input.protocolId);
  const revisionId = protocol.released_revision_id ?? protocol.current_revision_id;
  if (!revisionId) throw new ProtocolError("PRECONDITION_FAILED", "The protocol has no revision");
  const revision = await loadRevision(revisionId);
  if (["retired", "rejected", "superseded"].includes(revision.status)) throw new ProtocolError("PRECONDITION_FAILED", `Revision ${revision.revision_number} is ${revision.status}`);
  const { item } = await equipmentOrThrow(input.instrumentKey);
  if (item.status === "retired") throw new ProtocolError("PRECONDITION_FAILED", "Retired equipment cannot be used for new calibration runs");
  if (!candidateEquipment(revision.content, [item]).length)
    throw new ProtocolError("PRECONDITION_FAILED", `${item.identity.nameEn} (${item.identity.instrumentId}) is not linked to / compatible with ${protocol.protocol_number}`);
  const t = now();
  const runId = id();
  const runNumber = `RUN-${protocol.protocol_number}-${t.slice(0, 10).replace(/-/g, "")}-${runId.slice(0, 6).toUpperCase()}`;
  const snapshot = snapshotOf(item);
  const evaluation = evaluateExecution(revision.content, {});
  await protocolStore().apply([
    { op: "insert", table: "protocol_runs", row: { id: runId, run_number: runNumber, protocol_id: protocol.id, revision_id: revision.id, protocol_number: protocol.protocol_number, revision_number: revision.revision_number, revision_status: revision.status, content_hash: revision.content_hash, protocol_snapshot: revision.content, instrument_key: item.instrumentKey, equipment_snapshot: snapshot, equipment_version: item.version, measurements: {}, evaluation, overall_result: evaluation.overall, current_step: "equipment", status: "draft", created_by_user_id: actor.id, created_by_name: actor.name, created_at: t, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: 1 } },
    { op: "insert", table: "protocol_run_snapshots", row: { id: id(), run_id: runId, row_version: 1, action: "created", measurements: {}, evaluation, overall_result: evaluation.overall, equipment_version: item.version, reason: null, actor_user_id: actor.id, actor_name: actor.name, created_at: t } },
    audit(actor, duties, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "run", entityId: runId, action: "run.created", next: { runNumber, instrumentKey: item.instrumentKey, equipmentId: item.identity.instrumentId, equipmentVersion: item.version, revisionStatus: revision.status, contentHash: revision.content_hash } }),
  ]);
  return { runId, runNumber };
}

export async function listRuns(filter: { protocolId?: string; instrumentKey?: string; status?: string } = {}) {
  await requireWorkflowSchema();
  const where: Record<string, string> = {};
  if (filter.protocolId) where.protocol_id = filter.protocolId;
  if (filter.instrumentKey) where.instrument_key = filter.instrumentKey;
  if (filter.status) where.status = filter.status;
  const rows = await protocolStore().select<RunRow>("protocol_runs", { where, columns: ["id", "run_number", "protocol_id", "protocol_number", "revision_number", "revision_status", "instrument_key", "equipment_snapshot", "equipment_version", "overall_result", "status", "execution_id", "created_by_name", "created_at", "updated_by_name", "updated_at", "row_version"], order: [{ column: "updated_at", desc: true }], limit: 200 });
  const current = new Map((await listEquipmentData()).map(e => [e.instrumentKey, e.version]));
  return rows.map(r => ({ id: r.id, runNumber: r.run_number, protocolId: r.protocol_id, protocolNumber: r.protocol_number, revisionNumber: r.revision_number, revisionStatus: r.revision_status, instrumentKey: r.instrument_key, equipmentId: r.equipment_snapshot?.identity?.instrumentId ?? "", overall: r.overall_result, status: r.status, executionId: r.execution_id, createdBy: r.created_by_name, createdAt: r.created_at, updatedBy: r.updated_by_name, updatedAt: r.updated_at, rowVersion: r.row_version, newerEquipmentData: r.status === "draft" && current.get(r.instrument_key) !== r.equipment_version }));
}

export async function getRun(actor: Actor, runId: string) {
  await requireWorkflowSchema();
  const run = await loadRun(runId);
  const revision = await loadRevision(run.revision_id);
  const protocol = await loadProtocol(run.protocol_id);
  const all = await listEquipmentData();
  const currentEquipment = all.find(e => e.instrumentKey === run.instrument_key) ?? null;
  const history = await protocolStore().select<Record<string, unknown>>("protocol_run_snapshots", { where: { run_id: runId }, columns: ["id", "row_version", "action", "overall_result", "equipment_version", "reason", "actor_name", "created_at"], order: [{ column: "row_version", desc: true }] });
  const content = parseProtocolContent(run.protocol_snapshot);
  const evaluation = evaluateExecution(content, run.measurements ?? {});
  const registryEntry = (await equipmentRegistry()).find(e => e.instrumentKey === run.instrument_key);
  const compatibility = registryEntry ? compatibilityProblems(content, registryEntry) : ["Equipment no longer in the Equipment Library"];
  const duties = await dutiesOf(actor);
  const blockers = [
    ...runApprovalBlockers({
      revisionStatus: revision.status,
      protocolChanged: revision.content_hash !== run.content_hash,
      evaluation,
      content,
      equipmentRetired: currentEquipment?.status === "retired",
      identityChanged: !!currentEquipment && ["instrumentId", "serialNumber", "manufacturer", "model"].some(k => currentEquipment.identity[k as keyof EquipmentIdentity] !== run.equipment_snapshot.identity[k as keyof EquipmentIdentity]),
      compatibility,
    }),
    ...canonicalStepBlockers(content, run.measurements ?? {}),
  ];
  let execution: { id: string; reviewStatus: string } | null = null;
  if (run.execution_id) {
    const reviews = await protocolStore().select<{ to_status: string; created_at: string }>("protocol_execution_reviews", { where: { execution_id: run.execution_id }, columns: ["to_status", "created_at"], order: [{ column: "created_at" }] });
    execution = { id: run.execution_id, reviewStatus: reviews.length ? reviews[reviews.length - 1].to_status : "recorded" };
  }
  return {
    run: { id: run.id, runNumber: run.run_number, protocolId: run.protocol_id, protocolNumber: run.protocol_number, revisionId: run.revision_id, revisionNumber: run.revision_number, revisionStatusAtCreation: run.revision_status, contentHash: run.content_hash, instrumentKey: run.instrument_key, equipmentSnapshot: run.equipment_snapshot, equipmentVersion: run.equipment_version, measurements: run.measurements ?? {}, currentStep: run.current_step, status: run.status, executionId: run.execution_id, abandonReason: run.abandon_reason, createdBy: run.created_by_name, createdByUserId: run.created_by_user_id, createdAt: run.created_at, updatedBy: run.updated_by_name, updatedAt: run.updated_at, rowVersion: run.row_version },
    protocol: { id: protocol.id, title: protocol.title, status: protocol.status, reviewFlag: protocol.review_flag, reviewFlagReason: protocol.review_flag_reason },
    revision: { id: revision.id, status: revision.status, revisionNumber: revision.revision_number, contentHash: revision.content_hash, pendingVerification: revision.pending_verification_count, openGaps: revision.open_gap_count, effectiveDate: revision.effective_date },
    content,
    steps: buildRunSteps(content),
    evaluation,
    currentEquipment,
    newerEquipmentData: !!currentEquipment && currentEquipment.version !== run.equipment_version,
    protocolChangedSinceRun: revision.content_hash !== run.content_hash,
    compatibility,
    blockers,
    execution,
    history: history.map(h => ({ id: h.id as string, rowVersion: h.row_version as number, action: h.action as string, overall: h.overall_result as string | null, equipmentVersion: h.equipment_version as string | null, reason: h.reason as string | null, actorName: h.actor_name as string | null, createdAt: h.created_at as string })),
    canRecord: duties.includes("executor"),
  };
}

function assertMeasurements(content: ProtocolContent, measurements: Measurements) {
  const known = new Set(content.sections.flatMap(s => s.tests.map(t => t.key)));
  // Reserved keys document an intentionally Not-Applicable canonical step; they
  // are part of the controlled run record, not protocol tests.
  const reserved = new Set(["accuracy", "repeatability", "linearity"].map(naMeasurementKey));
  const unknown = Object.keys(measurements).filter(k => !known.has(k) && !reserved.has(k));
  if (unknown.length) throw new ProtocolError("BAD_REQUEST", "Measurements reference tests / reserved keys that are not part of this protocol revision", unknown);
  if (JSON.stringify(measurements).length > 900_000) throw new ProtocolError("BAD_REQUEST", "Run data too large");
}

/**
 * Saves a run draft. Optimistic concurrency: when another user saved first the
 * save is rejected and the client keeps both versions (choose / merge per test).
 * Every saved version is preserved in protocol_run_snapshots.
 */
export async function saveRun(actor: Actor, input: { runId: string; expectedRowVersion: number; measurements: Measurements; currentStep?: string | null; reason?: string }) {
  await requireWorkflowSchema();
  const duties = await requireDuty(actor, "executor");
  const run = await loadRun(input.runId);
  if (run.status !== "draft") throw new ProtocolError("PRECONDITION_FAILED", `Run ${run.run_number} is ${run.status}; recorded data is immutable`);
  if (run.row_version !== input.expectedRowVersion)
    throw new ProtocolError("PRECONDITION_FAILED", `DRAFT_CONFLICT: run ${run.run_number} was saved by ${run.updated_by_name ?? "another user"} at ${run.updated_at} (version ${run.row_version}). Both versions are kept — compare and choose before saving`);
  const content = parseProtocolContent(run.protocol_snapshot);
  assertMeasurements(content, input.measurements);
  const evaluation = evaluateExecution(content, input.measurements);
  const t = now();
  const version = run.row_version + 1;
  await protocolStore().apply([
    { op: "update", table: "protocol_runs", id: run.id, set: { measurements: input.measurements, evaluation, overall_result: evaluation.overall, current_step: input.currentStep ?? run.current_step, updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: version }, expect: { row_version: run.row_version, status: "draft" } },
    { op: "insert", table: "protocol_run_snapshots", row: { id: id(), run_id: run.id, row_version: version, action: input.reason ? "merged" : "saved", measurements: input.measurements, evaluation, overall_result: evaluation.overall, equipment_version: run.equipment_version, reason: input.reason ?? null, actor_user_id: actor.id, actor_name: actor.name, created_at: t } },
  ]);
  void duties;
  return { rowVersion: version, evaluation };
}

export async function runVersion(runId: string, rowVersion: number) {
  await requireWorkflowSchema();
  const [row] = await protocolStore().select<Record<string, unknown>>("protocol_run_snapshots", { where: { run_id: runId, row_version: rowVersion }, limit: 1 });
  if (!row) throw new ProtocolError("NOT_FOUND", "Run version not found");
  return { rowVersion: row.row_version as number, action: row.action as string, measurements: (row.measurements ?? {}) as Measurements, overall: row.overall_result as string | null, actorName: row.actor_name as string | null, createdAt: row.created_at as string };
}

/** Formal recording: creates an execution through the existing execution workflow (review → approval with segregation of duties). */
export async function recordRun(actor: Actor, input: { runId: string; expectedRowVersion: number; comments?: string; deviations?: ExecutionDeviation[]; stage?: string }) {
  await requireWorkflowSchema();
  const run = await loadRun(input.runId);
  if (run.status !== "draft") throw new ProtocolError("PRECONDITION_FAILED", `Run ${run.run_number} is already ${run.status}`);
  if (run.row_version !== input.expectedRowVersion) throw new ProtocolError("PRECONDITION_FAILED", "DRAFT_CONFLICT: the run was changed by another user; reload before recording");
  const revision = await loadRevision(run.revision_id);
  const content = parseProtocolContent(run.protocol_snapshot);
  const all = await listEquipmentData();
  const current = all.find(e => e.instrumentKey === run.instrument_key);
  const evaluation = evaluateExecution(content, run.measurements ?? {});
  const registryEntry = (await equipmentRegistry()).find(e => e.instrumentKey === run.instrument_key);
  const blockers = [
    ...runApprovalBlockers({
      revisionStatus: revision.status,
      protocolChanged: revision.content_hash !== run.content_hash,
      evaluation,
      content,
      equipmentRetired: current?.status === "retired",
      identityChanged: !current || ["instrumentId", "serialNumber", "manufacturer", "model"].some(k => current.identity[k as keyof EquipmentIdentity] !== run.equipment_snapshot.identity[k as keyof EquipmentIdentity]),
      compatibility: registryEntry ? compatibilityProblems(content, registryEntry) : ["Equipment no longer in the Equipment Library"],
    }),
    ...canonicalStepBlockers(content, run.measurements ?? {}),
  ].filter(b => b.blocksRecording);
  if (blockers.length) throw new ProtocolError("PRECONDITION_FAILED", "The run cannot be formally recorded", blockers.map(b => b.message));
  const prepared = await prepareExecution(actor, { revisionId: run.revision_id, instrumentKey: run.instrument_key, measurements: run.measurements ?? {}, comments: [`Calibration run ${run.run_number}.`, input.comments ?? ""].join(" ").trim(), deviations: input.deviations, stage: input.stage });
  const t = now();
  const duties = await dutiesOf(actor);
  await protocolStore().apply([
    ...prepared.changes,
    { op: "update", table: "protocol_runs", id: run.id, set: { status: "recorded", execution_id: prepared.executionId, evaluation: prepared.evaluation, overall_result: prepared.evaluation.overall, current_step: "approval", updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: run.row_version + 1 }, expect: { row_version: run.row_version, status: "draft" } },
    { op: "insert", table: "protocol_run_snapshots", row: { id: id(), run_id: run.id, row_version: run.row_version + 1, action: "recorded", measurements: run.measurements ?? {}, evaluation: prepared.evaluation, overall_result: prepared.evaluation.overall, equipment_version: run.equipment_version, reason: `Execution ${prepared.executionId}`, actor_user_id: actor.id, actor_name: actor.name, created_at: t } },
    audit(actor, duties, { protocolId: run.protocol_id, revisionId: run.revision_id, revisionNumber: run.revision_number, entityType: "run", entityId: run.id, action: "run.recorded", next: { executionId: prepared.executionId, overall: prepared.evaluation.overall } }),
  ]);
  return { executionId: prepared.executionId, evaluation: prepared.evaluation };
}

export async function abandonRun(actor: Actor, input: { runId: string; expectedRowVersion: number; reason: string }) {
  await requireWorkflowSchema();
  const duties = await requireDuty(actor, "executor");
  if (input.reason.trim().length < 3) throw new ProtocolError("BAD_REQUEST", "A reason is required to abandon a run");
  const run = await loadRun(input.runId);
  if (run.status !== "draft") throw new ProtocolError("PRECONDITION_FAILED", `Run ${run.run_number} is ${run.status}`);
  if (run.row_version !== input.expectedRowVersion) throw new ProtocolError("PRECONDITION_FAILED", "DRAFT_CONFLICT: the run was changed by another user; reload first");
  const t = now();
  await protocolStore().apply([
    { op: "update", table: "protocol_runs", id: run.id, set: { status: "abandoned", abandon_reason: input.reason.trim(), updated_by_user_id: actor.id, updated_by_name: actor.name, updated_at: t, row_version: run.row_version + 1 }, expect: { row_version: run.row_version, status: "draft" } },
    { op: "insert", table: "protocol_run_snapshots", row: { id: id(), run_id: run.id, row_version: run.row_version + 1, action: "abandoned", measurements: run.measurements ?? {}, evaluation: run.evaluation, overall_result: run.overall_result, equipment_version: run.equipment_version, reason: input.reason.trim(), actor_user_id: actor.id, actor_name: actor.name, created_at: t } },
    audit(actor, duties, { protocolId: run.protocol_id, revisionId: run.revision_id, revisionNumber: run.revision_number, entityType: "run", entityId: run.id, action: "run.abandoned", reason: input.reason.trim() }),
  ]);
  return { ok: true };
}

export async function logRunPdf(actor: Actor, input: { runId: string; documentStatus: string; documentId: string }) {
  await requireWorkflowSchema();
  const run = await loadRun(input.runId);
  const duties = await dutiesOf(actor);
  await protocolStore().apply([audit(actor, duties, { protocolId: run.protocol_id, revisionId: run.revision_id, revisionNumber: run.revision_number, entityType: "run", entityId: run.id, action: "run.pdf-generated", next: { documentStatus: input.documentStatus, documentId: input.documentId, rowVersion: run.row_version } })]);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Import of the supplied 8-protocol package                            */
/* ------------------------------------------------------------------ */

/** Seeds the package references that do not exist yet (pending verification); returns placeholder → id. */
async function seedPackageReferences(actor: Actor) {
  const { rows: refs } = await referenceLookup();
  const map: Record<string, string> = {};
  const referencesCreated: string[] = [];
  for (const seed of PACKAGE_REFERENCES) {
    const found = refs.find(r => r.code === seed.code);
    if (found) {
      map[seed.placeholder] = found.id;
      continue;
    }
    const res = await saveReference(actor, { code: seed.code, title: seed.title, issuer: seed.issuer, referenceType: seed.referenceType, documentNumber: seed.documentNumber, edition: seed.edition, revision: seed.revision, publicationDate: seed.publicationDate, effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: seed.sourceUrl, documentUrl: "", applicableSection: seed.applicableSection, applicableClause: "", verificationStatus: "pending-verification", notes: seed.notes, reason: "Reference seeded by the 8-protocol package import (verification pending)" });
    map[seed.placeholder] = res.id;
    referencesCreated.push(seed.code);
  }
  return { map, referencesCreated };
}

export type ImportLine = { protocolNumber: string; status: "created" | "skipped-existing" | "failed"; protocolId: string | null; revisionId: string | null; tests: number; linkedEquipment: string | null; notes: string[] };

/**
 * Idempotent by protocol number: existing protocols are NEVER overwritten
 * (reported as skipped). Every protocol is created as a DRAFT with all
 * criteria PENDING TECHNICAL VERIFICATION. References are seeded as
 * pending-verification. Creates the analytical-balance equipment record
 * (CAL-QC-BAL-001 Rev.03 §4) when it is not registered yet.
 */
export async function importCalibrationPackage(actor: Actor) {
  await requireDuty(actor, "author");
  const status = await protocolStore().schemaStatus();
  const notes: string[] = [];
  // 1. Equipment defined by the package but not yet registered.
  let registry = await equipmentRegistry();
  for (const eq of PACKAGE_NEW_EQUIPMENT) {
    const exists = registry.find(e => e.instrumentKey === eq.instrumentKey || e.instrumentId.trim().toUpperCase() === eq.instrumentId);
    if (exists) {
      notes.push(`${eq.instrumentId}: already registered as "${exists.instrumentKey}" — not modified.`);
      continue;
    }
    const identity: EquipmentIdentity = { instrumentId: eq.instrumentId, manufacturer: eq.manufacturer, model: eq.model, serialNumber: eq.serialNumber, nameEn: eq.nameEn, nameAr: eq.nameAr, sopNumber: eq.sopNumber, formNumber: eq.formNumber };
    const specs: SpecMap = Object.fromEntries(Object.entries(eq.specifications).map(([k, v]) => [k, { value: v.value, unit: v.unit, source: v.source }]));
    if (status.workflowOk) {
      await createEquipmentData(actor, { instrumentKey: eq.instrumentKey, equipmentType: eq.equipmentType, identity, specs, reason: `Registered from ${eq.source}`, reference: eq.reference });
      notes.push(`${eq.instrumentId} (${eq.model}, S/N ${eq.serialNumber}): new equipment record created with ${Object.keys(specs).length} specification values from the source.`);
    } else {
      if (actor.role === "viewer") throw new ProtocolError("FORBIDDEN", "Viewers cannot register equipment");
      await upsertInstrumentProfile({ instrumentKey: eq.instrumentKey, nameAr: identity.nameAr, nameEn: identity.nameEn, instrumentId: identity.instrumentId, sopNumber: identity.sopNumber, manufacturer: identity.manufacturer, model: identity.model, serialNumber: identity.serialNumber, formNumber: identity.formNumber, accent: "#3B5B8C", userId: actor.id });
      notes.push(`${eq.instrumentId}: identity registered; specifications not stored because the v3 workflow tables are not installed yet (re-run the migration, then enter them on the equipment page).`);
    }
  }
  registry = await equipmentRegistry();

  // 2. References (pending verification).
  const { map, referencesCreated } = await seedPackageReferences(actor);

  // 3. Protocols.
  const existing = new Set((await protocolStore().select<{ protocol_number: string }>("protocols", { columns: ["protocol_number"] })).map(p => p.protocol_number));
  const lines: ImportLine[] = [];
  for (const pkg of PACKAGE_PROTOCOLS) {
    const tests = pkg.content.sections?.reduce((n, s) => n + (s.tests?.length ?? 0), 0) ?? 0;
    if (existing.has(pkg.number)) {
      lines.push({ protocolNumber: pkg.number, status: "skipped-existing", protocolId: null, revisionId: null, tests, linkedEquipment: null, notes: ["A protocol with this number already exists — not overwritten."] });
      continue;
    }
    const lineNotes: string[] = [];
    try {
      const content = parseProtocolContent(remapReferencePlaceholders(pkg.content, map));
      let linked: string | null = null;
      if (pkg.instrumentKey) {
        const entry = registry.find(e => e.instrumentKey === pkg.instrumentKey);
        const problems = entry ? compatibilityProblems({ ...content, identification: { ...content.identification, associationType: "model" } }, entry) : [`Equipment ${pkg.instrumentKey} not registered`];
        if (entry && !problems.length) {
          content.equipmentLinks = [{ instrumentKey: entry.instrumentKey, instrumentId: entry.instrumentId, serialNumber: entry.serialNumber, manufacturer: entry.manufacturer, model: entry.model, compatibilityNote: `Linked at package import (${pkg.sourceFile}).` }];
          linked = `${entry.instrumentId} (${entry.model}, S/N ${entry.serialNumber})`;
        } else {
          content.identification.associationType = "model";
          lineNotes.push(`Not linked to ${pkg.instrumentKey}: ${problems.join("; ")}. Imported as model-associated; link it in the builder after verification.`);
        }
      } else lineNotes.push("Model-associated (no equipment link) — see technical gaps.");
      const res = await createProtocol(actor, { content, reason: `${PACKAGE_IMPORT_REASON} Source: ${pkg.sourceFile} (Rev.${pkg.sourceRevision}).` });
      lines.push({ protocolNumber: pkg.number, status: "created", protocolId: res.protocolId, revisionId: res.revisionId, tests, linkedEquipment: linked, notes: lineNotes });
    } catch (error) {
      lines.push({ protocolNumber: pkg.number, status: "failed", protocolId: null, revisionId: null, tests, linkedEquipment: null, notes: [...lineNotes, error instanceof Error ? error.message : String(error)] });
    }
  }
  return { lines, referencesCreated, notes, created: lines.filter(l => l.status === "created").length, skipped: lines.filter(l => l.status === "skipped-existing").length, failed: lines.filter(l => l.status === "failed").length };
}



/* ------------------------------------------------------------------ */
/* CAL-QC-BAL-001 Rev.03 replaces the Rev.01 content (history kept)     */
/* ------------------------------------------------------------------ */

const BAL_REV03_MARKER = BAL_REV03.sourceFile;
const CLOSED_REVISION_STATUSES = ["released", "superseded", "retired", "rejected"];

export type BalanceRev03Result = {
  outcome: "created" | "updated-draft" | "new-revision" | "already-current";
  protocolId: string;
  revisionId: string;
  revisionNumber: number;
  previousRevisionNumber: number | null;
  linkedEquipment: string | null;
  referencesCreated: string[];
  equipmentSpecsRelabelled: string[];
  notes: string[];
};

/**
 * Adopts CAL-QC-BAL-001 Rev.03 in place of the Rev.01 content already in the system.
 *  - no protocol yet            → created as a new DRAFT (same as the package import);
 *  - open draft / changes-requested revision → content replaced through saveDraft (audited diff);
 *  - otherwise (released / superseded…) → a NEW revision is created and filled with Rev.03;
 *    the released revision stays in force (and in history) until Rev.03 completes review and QA approval;
 *  - a revision under review / approval blocks the replacement (it must be returned first).
 * The content stays a DRAFT with every criterion PENDING TECHNICAL VERIFICATION; existing
 * equipment links are kept. Balance equipment specifications are only re-labelled as
 * UNVERIFIED where they still carry the untouched Rev.01 import value + source.
 */
export async function adoptBalanceRev03(actor: Actor): Promise<BalanceRev03Result> {
  await requireDuty(actor, "author");
  const notes: string[] = [];
  const { map, referencesCreated } = await seedPackageReferences(actor);
  const fresh = parseProtocolContent(remapReferencePlaceholders(BAL_REV03.content, map));
  const registry = await equipmentRegistry();
  const entry = registry.find(e => e.instrumentKey === BAL_REV03.instrumentKey);
  const equipmentSpecsRelabelled = await relabelBalanceSpecs(actor, notes);

  const [protocol] = await protocolStore().select<ProtocolRow>("protocols", { where: { protocol_number: BAL_REV03.number }, limit: 1 });
  if (!protocol) {
    let linked: string | null = null;
    const problems = entry ? compatibilityProblems({ ...fresh, identification: { ...fresh.identification, associationType: "model" } }, entry) : ["Equipment balance not registered"];
    if (entry && !problems.length) {
      fresh.equipmentLinks = [{ instrumentKey: entry.instrumentKey, instrumentId: entry.instrumentId, serialNumber: entry.serialNumber, manufacturer: entry.manufacturer, model: entry.model, compatibilityNote: `Linked at Rev.03 adoption (${BAL_REV03.sourceFile}).` }];
      linked = `${entry.instrumentId} (${entry.model}, S/N ${entry.serialNumber})`;
    } else {
      fresh.identification.associationType = "model";
      notes.push(`Not linked: ${problems.join("; ")}. Created as model-associated; run the package import first to register QC-I-074.`);
    }
    const res = await createProtocol(actor, { content: fresh, reason: BAL_REV03_REASON });
    return { outcome: "created", protocolId: res.protocolId, revisionId: res.revisionId, revisionNumber: 1, previousRevisionNumber: null, linkedEquipment: linked, referencesCreated, equipmentSpecsRelabelled, notes };
  }

  const revisions = await protocolStore().select<RevisionRow>("protocol_revisions", { where: { protocol_id: protocol.id }, order: [{ column: "revision_number", desc: true }] });
  const latest = revisions[0];
  const open = revisions.find(r => !CLOSED_REVISION_STATUSES.includes(r.status));
  const current = open ?? latest;
  if (current && current.content.identification.description.includes(BAL_REV03_MARKER)) {
    notes.push(`Revision ${current.revision_number} already carries the Rev.03 content — nothing changed.`);
    return { outcome: "already-current", protocolId: protocol.id, revisionId: current.id, revisionNumber: current.revision_number, previousRevisionNumber: null, linkedEquipment: linkText(current.content), referencesCreated, equipmentSpecsRelabelled, notes };
  }
  if (open && !EDITABLE_STATUSES.includes(open.status))
    throw new ProtocolError("PRECONDITION_FAILED", `Revision ${open.revision_number} of ${protocol.protocol_number} is ${open.status} — it must be returned for changes (or rejected) before the Rev.03 content can replace it.`);

  let target = open;
  let outcome: BalanceRev03Result["outcome"] = "updated-draft";
  const previousRevisionNumber = (open ?? latest)?.revision_number ?? null;
  if (!target) {
    const rev = await createRevision(actor, { protocolId: protocol.id, reason: BAL_REV03_REASON, description: "CAL-QC-BAL-001 Rev.03 (DRAFT) — supersedes the Rev.01 content" });
    target = await loadRevision(rev.revisionId);
    outcome = "new-revision";
    notes.push(`Revision ${previousRevisionNumber} (${latest.status}) is preserved unchanged; it remains in force until revision ${rev.revisionNumber} completes technical review and QA approval.`);
  }
  // Keep the equipment association the system already has (user-managed), Rev.03 content otherwise.
  const prior = parseProtocolContent(target.content);
  fresh.equipmentLinks = prior.equipmentLinks;
  fresh.identification.associationType = prior.identification.associationType;
  if (!fresh.equipmentLinks.length && entry && !compatibilityProblems({ ...fresh, identification: { ...fresh.identification, associationType: "model" } }, entry).length) {
    fresh.equipmentLinks = [{ instrumentKey: entry.instrumentKey, instrumentId: entry.instrumentId, serialNumber: entry.serialNumber, manufacturer: entry.manufacturer, model: entry.model, compatibilityNote: `Linked at Rev.03 adoption (${BAL_REV03.sourceFile}).` }];
    fresh.identification.associationType = "equipment";
  }
  const saved = await saveDraft(actor, { revisionId: target.id, expectedRowVersion: target.row_version, content: fresh, reason: BAL_REV03_REASON });
  notes.push(`${saved.changes} content change(s) recorded in the audit trail (revision.content-updated).`);
  return { outcome, protocolId: protocol.id, revisionId: target.id, revisionNumber: target.revision_number, previousRevisionNumber, linkedEquipment: linkText(fresh), referencesCreated, equipmentSpecsRelabelled, notes };
}

function linkText(content: ProtocolContent) {
  const l = content.equipmentLinks[0];
  return l ? `${l.instrumentId} (${l.model}, S/N ${l.serialNumber})` : null;
}

/** Re-labels untouched Rev.01-imported balance specifications as UNVERIFIED (Rev.03 §4); never changes values or user edits. */
async function relabelBalanceSpecs(actor: Actor, notes: string[]) {
  const status = await protocolStore().schemaStatus();
  if (!status.workflowOk) return [];
  const seed = PACKAGE_NEW_EQUIPMENT[0];
  const item = (await listEquipmentData()).find(e => e.instrumentKey === seed.instrumentKey);
  if (!item) return [];
  const specs: SpecMap = { ...(item.specs as SpecMap) };
  const relabelled: string[] = [];
  for (const [key, old] of Object.entries(BAL_REV01_SPEC_SOURCES)) {
    const cur = specs[key];
    const next = (seed.specifications as Record<string, { value: number | string; unit: string; source: string }>)[key];
    if (cur && next && cur.value === old.value && cur.source === old.source) {
      specs[key] = { value: cur.value, unit: cur.unit, source: next.source };
      relabelled.push(key);
    }
  }
  if (!relabelled.length) return [];
  await updateEquipmentData(actor, { instrumentKey: item.instrumentKey, expectedSpecsRowVersion: item.specsRowVersion, identity: item.identity, specs, equipmentType: item.equipmentType, reason: "CAL-QC-BAL-001 Rev.03 §4: specification sources re-labelled (capacity/d: verify from nameplate/manual; manufacturer repeatability, linearity, response time, pan size, operating range, calibration weight: UNVERIFIED — not acceptance criteria). Values unchanged.", reference: "CAL-QC-BAL-001 Rev.03 §4" });
  notes.push(`${item.identity.instrumentId}: ${relabelled.length} specification source(s) re-labelled per Rev.03 §4 (values unchanged; user-edited values untouched).`);
  return relabelled;
}
