/**
 * Protocol Management service — the single backend authority for protocol
 * definitions, revisions, references, reviews, approvals, releases and
 * executions. Every rule here is enforced server-side; the UI only mirrors it.
 */
import { createHash, randomUUID } from "node:crypto";
import { devices } from "../../client/src/lib/qc";
import { getValidationRecordById, listInstrumentProfiles, localLogin } from "../db";
import { adp220DraftContent, ADP220_EXPECTED_EQUIPMENT, ADP220_PROTOCOL_NUMBER, ADP220_REFERENCES, remapReferencePlaceholders } from "../../shared/protocols/adp220";
import { compareContents, type DiffEntry } from "../../shared/protocols/compare";
import { evaluateExecution, type Measurements } from "../../shared/protocols/evaluate";
import {
  EDITABLE_STATUSES,
  STATUS_LABELS,
  addInterval,
  canonicalJson,
  collectReferenceIds,
  countPendingVerification,
  parseProtocolContent,
  type ProtocolContent,
  type ProtocolContentInput,
  type ReferenceVerificationStatus,
  type RevisionStatus,
} from "../../shared/protocols/model";
import { BUILTIN_TEMPLATES, contentFromTemplate, stripToStructure } from "../../shared/protocols/templates";
import { ATTACHMENT_ENTITY_TYPES, MAX_ATTACHMENT_BYTES, attachmentTypeProblem, type AttachmentEntityType } from "../../shared/protocols/attachments";
import {
  EXECUTION_REVIEW_STATUS_LABELS,
  availableExecutionActions,
  executionReviewDenial,
  executionReviewStatus,
  executionReviewStep,
  type ExecutionDeviation,
  type ExecutionReviewAction,
} from "../../shared/protocols/executionReview";
import { DUE_SOON_DAYS, computeSchedule, type ScheduleItem } from "../../shared/protocols/schedule";
import { approvalBlockers, structuralIssues, submissionIssues, type GapDecisionRecord, type ReferenceLookup } from "../../shared/protocols/validation";
import {
  GRANTABLE_DUTIES,
  TRANSITIONS,
  availableActions,
  effectiveDuties,
  transitionDenial,
  type BaseRole,
  type ProtocolDuty,
  type WorkflowAction,
} from "../../shared/protocols/workflow";
import { sqliteProtocolStore } from "./sqliteStore";
import { supabaseProtocolStore } from "./supabaseStore";
import type { Change, ProtocolStore, Row } from "./tables";

/* ------------------------------------------------------------------ */
/* Infrastructure                                                       */
/* ------------------------------------------------------------------ */

export type Actor = { id: number; name: string | null; role: BaseRole; email?: string | null };

export class ProtocolError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "BAD_REQUEST" | "NOT_FOUND" | "PRECONDITION_FAILED",
    message: string,
    readonly details: string[] = []
  ) {
    super(details.length ? `${message}: ${details.join("; ")}` : message);
    this.name = "ProtocolError";
  }
}

let storeOverride: ProtocolStore | null = null;
export function setProtocolStoreForTests(store: ProtocolStore | null) {
  storeOverride = store;
}
export function protocolStore(): ProtocolStore {
  if (storeOverride) return storeOverride;
  return process.env.QC_STORAGE_MODE === "local" ? sqliteProtocolStore : supabaseProtocolStore;
}

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const id = () => randomUUID();
export const hashContent = (content: ProtocolContent) => createHash("sha256").update(canonicalJson(content)).digest("hex");

async function dutiesOf(actor: Actor): Promise<ProtocolDuty[]> {
  if (actor.role === "viewer") return [];
  const rows = await protocolStore().select<{ duty: string }>("protocol_duty_assignments", { where: { user_id: actor.id, revoked_at: null }, columns: ["duty"] });
  return effectiveDuties(actor.role, rows.map(r => r.duty));
}

async function requireDuty(actor: Actor, ...allowed: ProtocolDuty[]) {
  const duties = await dutiesOf(actor);
  if (!allowed.some(d => duties.includes(d)))
    throw new ProtocolError("FORBIDDEN", `This action requires one of the protocol duties: ${allowed.join(", ")}`);
  return duties;
}

const actorRole = (actor: Actor, duties: readonly string[]) => `${actor.role}${duties.length ? ` [${duties.join(", ")}]` : ""}`;

/* Electronic signature: every signature manifestation requires re-entering the account password. */
type SignatureVerifier = (actor: Actor, password: string) => Promise<boolean>;
const defaultSignatureVerifier: SignatureVerifier = async (actor, password) => {
  if (!actor.email || !password) return false;
  try {
    const verified = await localLogin({ email: actor.email, password, recordActivity: false });
    return verified.id === actor.id && verified.isActive;
  } catch {
    return false;
  }
};
let signatureVerifier: SignatureVerifier = defaultSignatureVerifier;
/** Test hook (PostgreSQL verification script has no auth backend). Production always uses the account password. */
export function setSignatureVerifierForTests(verifier: SignatureVerifier | null) {
  signatureVerifier = verifier ?? defaultSignatureVerifier;
}

async function requireSignature(actor: Actor, duties: readonly string[], password: string | undefined, context: { protocolId?: string | null; revisionId?: string | null; revisionNumber?: number | null; entityType: string; entityId: string; meaning: string }) {
  if (!password) throw new ProtocolError("BAD_REQUEST", `Electronic signature required (${context.meaning}): re-enter your password to sign`);
  if (await signatureVerifier(actor, password)) return;
  await protocolStore().apply([
    audit(actor, duties, { protocolId: context.protocolId, revisionId: context.revisionId, revisionNumber: context.revisionNumber, entityType: context.entityType, entityId: context.entityId, action: "signature.failed", next: { meaning: context.meaning } }),
  ]);
  throw new ProtocolError("FORBIDDEN", "Electronic signature failed: the password is not correct. Nothing was signed.");
}

function audit(actor: Actor, duties: readonly string[], input: { protocolId?: string | null; revisionId?: string | null; revisionNumber?: number | null; entityType: string; entityId?: string | null; action: string; previous?: unknown; next?: unknown; reason?: string | null }): Change {
  return {
    op: "insert",
    table: "protocol_audit_events",
    row: {
      id: id(),
      protocol_id: input.protocolId ?? null,
      revision_id: input.revisionId ?? null,
      revision_number: input.revisionNumber ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      action: input.action,
      actor_user_id: actor.id,
      actor_name: actor.name,
      actor_role: actorRole(actor, duties),
      previous_value: input.previous === undefined ? null : input.previous,
      new_value: input.next === undefined ? null : input.next,
      reason: input.reason ?? null,
      created_at: now(),
    },
  };
}

function notify(kind: string, duty: ProtocolDuty | null, userId: number | null, protocolId: string | null, revisionId: string | null, message: string, dedupeKey: string): Change {
  return {
    op: "insert-ignore",
    table: "protocol_notifications",
    row: { id: id(), kind, recipient_duty: duty, recipient_user_id: userId, protocol_id: protocolId, revision_id: revisionId, message, dedupe_key: dedupeKey, created_at: now() },
  };
}

/* ------------------------------------------------------------------ */
/* Row types & mappers                                                  */
/* ------------------------------------------------------------------ */

type ProtocolRow = {
  id: string; protocol_number: string; title: string; description: string | null; equipment_category: string | null; equipment_type: string | null;
  manufacturer: string | null; model: string | null; instrument_key: string | null; equipment_id: string | null; association_type: "model" | "equipment";
  protocol_type: string; intended_use: string | null; status: string; current_revision_id: string | null; current_revision_number: number | null;
  released_revision_id: string | null; released_revision_number: number | null; review_flag: boolean; review_flag_reason: string | null;
  created_by_user_id: number; created_by_name: string | null; created_at: string; updated_at: string; row_version: number;
};
type RevisionRow = {
  id: string; protocol_id: string; revision_number: number; status: RevisionStatus; content: ProtocolContent; content_hash: string; change_reason: string;
  revision_description: string | null; based_on_revision_id: string | null; locked: boolean; author_user_id: number; author_name: string | null;
  submitted_at: string | null; technical_reviewer_user_id: number | null; technical_reviewer_name: string | null; technical_reviewed_at: string | null;
  qa_approver_user_id: number | null; qa_approver_name: string | null; approved_at: string | null; released_by_user_id: number | null;
  released_by_name: string | null; released_at: string | null; effective_date: string | null; next_review_date: string | null; superseded_at: string | null;
  superseded_by_revision_id: string | null; retired_at: string | null; reference_snapshot: unknown; reference_ids: string[]; pending_verification_count: number;
  open_gap_count: number; created_at: string; updated_at: string; row_version: number;
};
type ReferenceRow = {
  id: string; code: string; title: string; issuer: string | null; reference_type: string; document_number: string | null; edition: string | null;
  revision: string | null; publication_date: string | null; effective_date: string | null; expiry_date: string | null; review_date: string | null;
  source_url: string | null; document_url: string | null; applicable_section: string | null; applicable_clause: string | null;
  verification_status: ReferenceVerificationStatus; verified_at: string | null; verified_by_user_id: number | null; verified_by_name: string | null;
  notes: string | null; created_by_user_id: number; created_at: string; updated_at: string; row_version: number;
};
type CommentRow = {
  id: string; protocol_id: string; revision_id: string; kind: "comment" | "gap-decision"; stage: string; target_type: string; target_key: string | null;
  body: string; decision: string | null; author_user_id: number; author_name: string | null; status: "open" | "resolved" | "recorded";
  resolution_note: string | null; resolved_by_user_id: number | null; resolved_by_name: string | null; resolved_at: string | null; created_at: string; row_version: number;
};

const REVISION_SUMMARY_COLUMNS = [
  "id", "protocol_id", "revision_number", "status", "content_hash", "change_reason", "revision_description", "based_on_revision_id", "locked",
  "author_user_id", "author_name", "submitted_at", "technical_reviewer_user_id", "technical_reviewer_name", "technical_reviewed_at",
  "qa_approver_user_id", "qa_approver_name", "approved_at", "released_by_user_id", "released_by_name", "released_at", "effective_date",
  "next_review_date", "superseded_at", "superseded_by_revision_id", "retired_at", "reference_ids", "pending_verification_count",
  "open_gap_count", "created_at", "updated_at", "row_version",
];

export function mapReference(r: ReferenceRow) {
  return {
    id: r.id, code: r.code, title: r.title, issuer: r.issuer ?? "", referenceType: r.reference_type, documentNumber: r.document_number ?? "",
    edition: r.edition ?? "", revision: r.revision ?? "", publicationDate: r.publication_date ?? "", effectiveDate: r.effective_date ?? "",
    expiryDate: r.expiry_date ?? "", reviewDate: r.review_date ?? "", sourceUrl: r.source_url ?? "", documentUrl: r.document_url ?? "",
    applicableSection: r.applicable_section ?? "", applicableClause: r.applicable_clause ?? "", verificationStatus: r.verification_status,
    verifiedAt: r.verified_at, verifiedByName: r.verified_by_name, notes: r.notes ?? "", createdAt: r.created_at, updatedAt: r.updated_at, rowVersion: r.row_version,
    expired: Boolean(r.expiry_date && r.expiry_date < today()),
  };
}
export type ReferenceDto = ReturnType<typeof mapReference>;

function mapRevisionSummary(r: Omit<RevisionRow, "content" | "reference_snapshot"> & Partial<Pick<RevisionRow, "content" | "reference_snapshot">>) {
  return {
    id: r.id, protocolId: r.protocol_id, revisionNumber: r.revision_number, status: r.status, statusLabel: STATUS_LABELS[r.status] ?? r.status,
    contentHash: r.content_hash, changeReason: r.change_reason, revisionDescription: r.revision_description ?? "", basedOnRevisionId: r.based_on_revision_id,
    locked: r.locked, authorUserId: r.author_user_id, authorName: r.author_name, submittedAt: r.submitted_at, technicalReviewerUserId: r.technical_reviewer_user_id,
    technicalReviewerName: r.technical_reviewer_name, technicalReviewedAt: r.technical_reviewed_at, qaApproverUserId: r.qa_approver_user_id,
    qaApproverName: r.qa_approver_name, approvedAt: r.approved_at, releasedByName: r.released_by_name, releasedAt: r.released_at,
    effectiveDate: r.effective_date, nextReviewDate: r.next_review_date, supersededAt: r.superseded_at, supersededByRevisionId: r.superseded_by_revision_id,
    retiredAt: r.retired_at, referenceIds: r.reference_ids ?? [], pendingVerificationCount: r.pending_verification_count, openGapCount: r.open_gap_count,
    createdAt: r.created_at, updatedAt: r.updated_at, rowVersion: r.row_version,
  };
}
export type RevisionSummaryDto = ReturnType<typeof mapRevisionSummary>;

function mapProtocol(p: ProtocolRow) {
  return {
    id: p.id, protocolNumber: p.protocol_number, title: p.title, description: p.description ?? "", equipmentCategory: p.equipment_category ?? "",
    equipmentType: p.equipment_type ?? "", manufacturer: p.manufacturer ?? "", model: p.model ?? "", instrumentKey: p.instrument_key,
    equipmentId: p.equipment_id ?? "", associationType: p.association_type, protocolType: p.protocol_type, intendedUse: p.intended_use ?? "",
    status: p.status, currentRevisionId: p.current_revision_id, currentRevisionNumber: p.current_revision_number, releasedRevisionId: p.released_revision_id,
    releasedRevisionNumber: p.released_revision_number, reviewFlag: p.review_flag, reviewFlagReason: p.review_flag_reason ?? "",
    createdByUserId: p.created_by_user_id, createdByName: p.created_by_name, createdAt: p.created_at, updatedAt: p.updated_at, rowVersion: p.row_version,
  };
}

function mapComment(c: CommentRow) {
  return {
    id: c.id, revisionId: c.revision_id, kind: c.kind, stage: c.stage, targetType: c.target_type, targetKey: c.target_key, body: c.body,
    decision: c.decision, authorUserId: c.author_user_id, authorName: c.author_name, status: c.status, resolutionNote: c.resolution_note,
    resolvedByName: c.resolved_by_name, resolvedAt: c.resolved_at, createdAt: c.created_at, rowVersion: c.row_version,
  };
}

/* ------------------------------------------------------------------ */
/* Loaders                                                              */
/* ------------------------------------------------------------------ */

async function loadProtocol(protocolId: string) {
  const [row] = await protocolStore().select<ProtocolRow>("protocols", { where: { id: protocolId }, limit: 1 });
  if (!row) throw new ProtocolError("NOT_FOUND", "Protocol not found");
  return row;
}
async function loadRevision(revisionId: string) {
  const [row] = await protocolStore().select<RevisionRow>("protocol_revisions", { where: { id: revisionId }, limit: 1 });
  if (!row) throw new ProtocolError("NOT_FOUND", "Protocol revision not found");
  return row;
}
async function revisionSummaries(protocolId?: string) {
  return protocolStore().select<RevisionRow>("protocol_revisions", {
    where: protocolId ? { protocol_id: protocolId } : undefined,
    columns: REVISION_SUMMARY_COLUMNS,
    order: [{ column: "revision_number", desc: true }],
  });
}
async function referenceLookup(): Promise<{ rows: ReferenceRow[]; lookup: ReferenceLookup }> {
  const rows = await protocolStore().select<ReferenceRow>("protocol_references", { order: [{ column: "code" }] });
  const lookup: ReferenceLookup = new Map(
    rows.map(r => [r.id, { id: r.id, code: r.code, title: r.title, verificationStatus: r.verification_status, expiryDate: r.expiry_date || null, reviewDate: r.review_date || null }])
  );
  return { rows, lookup };
}
async function commentsFor(revisionId: string) {
  return protocolStore().select<CommentRow>("protocol_review_comments", { where: { revision_id: revisionId }, order: [{ column: "created_at" }] });
}
function latestGapDecisions(comments: CommentRow[]) {
  const map = new Map<string, GapDecisionRecord>();
  comments
    .filter(c => c.kind === "gap-decision" && c.target_key)
    .forEach(c => map.set(c.target_key as string, { gapKey: c.target_key as string, decision: c.decision ?? "", rationale: c.body, reviewerName: c.author_name, createdAt: c.created_at }));
  return map;
}

export function deriveProtocolStatus(revisions: Array<Pick<RevisionRow, "status" | "revision_number">>) {
  if (revisions.some(r => r.status === "released")) return "released";
  const latest = [...revisions].sort((a, b) => b.revision_number - a.revision_number)[0];
  return latest?.status ?? "draft";
}

/* ------------------------------------------------------------------ */
/* Equipment Library integration (no second catalog)                    */
/* ------------------------------------------------------------------ */

export type EquipmentEntry = { instrumentKey: string; name: string; instrumentId: string; manufacturer: string; model: string; serialNumber: string; sopNumber: string; formNumber: string; source: "registered-profile" | "built-in-default" };

/** Equipment as registered in the existing Equipment Library (instrument_profiles override the built-in device list). */
export async function equipmentRegistry(): Promise<EquipmentEntry[]> {
  let profiles: Awaited<ReturnType<typeof listInstrumentProfiles>> = [];
  try {
    profiles = await listInstrumentProfiles();
  } catch {
    profiles = [];
  }
  const byKey = new Map(profiles.map(p => [p.instrumentKey, p]));
  const entries: EquipmentEntry[] = devices.map(d => {
    const p = byKey.get(d.key);
    return p
      ? { instrumentKey: d.key, name: p.nameEn, instrumentId: p.instrumentId, manufacturer: p.manufacturer, model: p.model, serialNumber: p.serialNumber, sopNumber: p.sopNumber, formNumber: p.formNumber, source: "registered-profile" as const }
      : { instrumentKey: d.key, name: d.english, instrumentId: d.id, manufacturer: d.manufacturer, model: d.model, serialNumber: d.serial, sopNumber: d.sop, formNumber: d.form, source: "built-in-default" as const };
  });
  profiles.filter(p => !devices.some(d => d.key === p.instrumentKey)).forEach(p =>
    entries.push({ instrumentKey: p.instrumentKey, name: p.nameEn, instrumentId: p.instrumentId, manufacturer: p.manufacturer, model: p.model, serialNumber: p.serialNumber, sopNumber: p.sopNumber, formNumber: p.formNumber, source: "registered-profile" })
  );
  return entries;
}

export const normalizeMaker = (v: string) =>
  v.toLowerCase().replace(/\(.*?\)/g, "").replace(/&|\band\b/g, "+").replace(/[^a-z0-9+]/g, "");

/** Compatibility of one registered equipment item with a protocol (§6.4). Returns problems; empty = compatible. */
export function compatibilityProblems(content: ProtocolContent, equipment: EquipmentEntry): string[] {
  const problems: string[] = [];
  const id = content.identification;
  if (normalizeMaker(id.manufacturer) !== normalizeMaker(equipment.manufacturer))
    problems.push(`Manufacturer mismatch: protocol "${id.manufacturer}" vs equipment "${equipment.manufacturer}"`);
  if (normalizeMaker(id.model) !== normalizeMaker(equipment.model)) problems.push(`Model mismatch: protocol "${id.model}" vs equipment "${equipment.model}"`);
  const link = content.equipmentLinks.find(l => l.instrumentKey === equipment.instrumentKey);
  if (id.associationType === "equipment") {
    if (!link) problems.push(`Equipment-specific protocol is not linked to ${equipment.instrumentKey}`);
    else {
      if (link.instrumentId && link.instrumentId !== equipment.instrumentId) problems.push(`Equipment ID changed in the Equipment Library (${link.instrumentId} → ${equipment.instrumentId}); a protocol revision is required`);
      if (link.serialNumber && link.serialNumber !== equipment.serialNumber) problems.push(`Serial number changed in the Equipment Library (${link.serialNumber} → ${equipment.serialNumber}); a protocol revision is required`);
    }
  }
  return problems;
}

async function assertEquipmentLinks(content: ProtocolContent) {
  if (!content.equipmentLinks.length) return;
  const registry = await equipmentRegistry();
  const problems: string[] = [];
  content.equipmentLinks.forEach(link => {
    const equipment = registry.find(e => e.instrumentKey === link.instrumentKey);
    if (!equipment) return problems.push(`Equipment ${link.instrumentKey} does not exist in the Equipment Library`);
    if (link.instrumentId !== equipment.instrumentId) problems.push(`${link.instrumentKey}: equipment ID ${link.instrumentId} ≠ registered ${equipment.instrumentId}`);
    if (link.serialNumber !== equipment.serialNumber) problems.push(`${link.instrumentKey}: serial ${link.serialNumber} ≠ registered ${equipment.serialNumber}`);
    compatibilityProblems({ ...content, identification: { ...content.identification, associationType: "model" } }, equipment).forEach(p => problems.push(`${link.instrumentKey}: ${p}`));
  });
  if (problems.length) throw new ProtocolError("PRECONDITION_FAILED", "Equipment compatibility verification failed", problems);
}

/* ------------------------------------------------------------------ */
/* Content helpers                                                      */
/* ------------------------------------------------------------------ */

function parseContentOrThrow(input: unknown): ProtocolContent {
  try {
    return parseProtocolContent(input);
  } catch (error) {
    const issues = (error as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues;
    throw new ProtocolError("BAD_REQUEST", "Protocol content is invalid", issues ? issues.slice(0, 10).map(i => `${i.path.join(".")}: ${i.message}`) : [String(error)]);
  }
}

function assertStructure(content: ProtocolContent) {
  const errors = structuralIssues(content).filter(i => i.severity === "error");
  if (errors.length) throw new ProtocolError("BAD_REQUEST", "Protocol structure is invalid", errors.map(e => e.message));
}

function revisionDerived(content: ProtocolContent) {
  return {
    content_hash: hashContent(content),
    reference_ids: collectReferenceIds(content),
    pending_verification_count: countPendingVerification(content),
    open_gap_count: content.gaps.length,
  };
}

function headerFromContent(content: ProtocolContent) {
  const i = content.identification;
  return {
    protocol_number: i.number,
    title: i.title,
    description: i.description,
    equipment_category: i.equipmentCategory,
    equipment_type: i.equipmentType,
    manufacturer: i.manufacturer,
    model: i.model,
    instrument_key: content.equipmentLinks[0]?.instrumentKey ?? null,
    equipment_id: content.equipmentLinks.map(l => l.instrumentId).filter(Boolean).join(", "),
    association_type: i.associationType,
    protocol_type: i.protocolType,
    intended_use: i.intendedUse,
  };
}

async function assertNumberAvailable(number: string, exceptProtocolId?: string) {
  const rows = await protocolStore().select<{ id: string }>("protocols", { where: { protocol_number: number }, columns: ["id"] });
  if (rows.some(r => r.id !== exceptProtocolId)) throw new ProtocolError("PRECONDITION_FAILED", `Protocol number ${number} already exists`);
}

function diffForAudit(entries: DiffEntry[]) {
  const trim = (v: unknown) => {
    const s = JSON.stringify(v ?? null);
    return s.length > 4000 ? `${s.slice(0, 4000)}…(truncated)` : v;
  };
  return {
    previous: entries.filter(e => e.change !== "added").map(e => ({ entity: e.entity, change: e.change, path: e.path, label: e.label, value: trim(e.before) })),
    next: entries.filter(e => e.change !== "removed").map(e => ({ entity: e.entity, change: e.change, path: e.path, label: e.label, value: trim(e.after) })),
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

export async function getMe(actor: Actor) {
  const duties = await dutiesOf(actor);
  return { userId: actor.id, role: actor.role, duties, storage: protocolStore().kind };
}

export async function moduleStatus() {
  return protocolStore().schemaStatus();
}

export type RegistryFilters = {
  search?: string;
  status?: string;
  protocolType?: string;
  equipmentCategory?: string;
  author?: string;
  revision?: number;
  approvedFrom?: string;
  approvedTo?: string;
  reviewBefore?: string;
  flag?: "due-for-review" | "expired-references" | "pending-verification" | "open-gaps" | "review-flag";
  sort?: "protocolNumber" | "title" | "updatedAt" | "status" | "nextReviewDate";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

async function registryRows() {
  const [protocols, revisions, refs, decisions] = await Promise.all([
    protocolStore().select<ProtocolRow>("protocols", { order: [{ column: "protocol_number" }] }),
    revisionSummaries(),
    referenceLookup(),
    protocolStore().select<CommentRow>("protocol_review_comments", { where: { kind: "gap-decision" }, columns: ["revision_id", "target_key", "decision"] }),
  ]);
  const decidedByRevision = new Map<string, Set<string>>();
  decisions.forEach(d => {
    const set = decidedByRevision.get(d.revision_id) ?? new Set<string>();
    if (d.target_key) set.add(d.target_key);
    decidedByRevision.set(d.revision_id, set);
  });
  const t = today();
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return protocols.map(p => {
    const revs = revisions.filter(r => r.protocol_id === p.id).sort((a, b) => b.revision_number - a.revision_number);
    const current = revs[0];
    const released = revs.find(r => r.status === "released") ?? null;
    const focus = current;
    const refIds = new Set<string>([...(current?.reference_ids ?? []), ...(released?.reference_ids ?? [])]);
    const expiredReferences = Array.from(refIds).map(id => refs.lookup.get(id)).filter(r => r && r.expiryDate && r.expiryDate < t).map(r => r!.code);
    const openGaps = focus ? Math.max(0, focus.open_gap_count - (decidedByRevision.get(focus.id)?.size ?? 0)) : 0;
    return {
      ...mapProtocol(p),
      status: deriveProtocolStatus(revs),
      currentRevision: current ? mapRevisionSummary(current) : null,
      releasedRevision: released ? mapRevisionSummary(released) : null,
      revisionCount: revs.length,
      supersededCount: revs.filter(r => r.status === "superseded").length,
      dueForReview: Boolean(released?.next_review_date && released.next_review_date <= soon),
      overdueForReview: Boolean(released?.next_review_date && released.next_review_date < t),
      expiredReferences,
      pendingVerification: focus?.pending_verification_count ?? 0,
      openGaps,
      lastApprovedAt: revs.find(r => r.approved_at)?.approved_at ?? null,
    };
  });
}
export type RegistryRow = Awaited<ReturnType<typeof registryRows>>[number];

function matchesStatus(row: RegistryRow, status: string) {
  if (status === "released") return Boolean(row.releasedRevision);
  if (status === "superseded") return row.supersededCount > 0;
  return row.currentRevision?.status === status;
}

export async function listProtocols(filters: RegistryFilters = {}) {
  let rows = await registryRows();
  const q = filters.search?.trim().toLowerCase();
  if (q)
    rows = rows.filter(r =>
      [r.protocolNumber, r.title, r.manufacturer, r.model, r.equipmentType, r.equipmentCategory, r.instrumentKey ?? "", r.equipmentId].some(v => v.toLowerCase().includes(q))
    );
  if (filters.status) rows = rows.filter(r => matchesStatus(r, filters.status as string));
  if (filters.protocolType) rows = rows.filter(r => r.protocolType === filters.protocolType);
  if (filters.equipmentCategory) rows = rows.filter(r => r.equipmentCategory === filters.equipmentCategory);
  if (filters.author) rows = rows.filter(r => (r.createdByName ?? "").toLowerCase().includes(filters.author!.toLowerCase()) || (r.currentRevision?.authorName ?? "").toLowerCase().includes(filters.author!.toLowerCase()));
  if (filters.revision) rows = rows.filter(r => r.currentRevision?.revisionNumber === filters.revision || r.releasedRevision?.revisionNumber === filters.revision);
  if (filters.approvedFrom) rows = rows.filter(r => r.lastApprovedAt && r.lastApprovedAt.slice(0, 10) >= filters.approvedFrom!);
  if (filters.approvedTo) rows = rows.filter(r => r.lastApprovedAt && r.lastApprovedAt.slice(0, 10) <= filters.approvedTo!);
  if (filters.reviewBefore) rows = rows.filter(r => r.releasedRevision?.nextReviewDate && r.releasedRevision.nextReviewDate <= filters.reviewBefore!);
  if (filters.flag === "due-for-review") rows = rows.filter(r => r.dueForReview);
  if (filters.flag === "expired-references") rows = rows.filter(r => r.expiredReferences.length > 0);
  if (filters.flag === "pending-verification") rows = rows.filter(r => r.pendingVerification > 0);
  if (filters.flag === "open-gaps") rows = rows.filter(r => r.openGaps > 0);
  if (filters.flag === "review-flag") rows = rows.filter(r => r.reviewFlag);
  const dir = filters.direction === "desc" ? -1 : 1;
  const key = filters.sort ?? "protocolNumber";
  const value = (r: RegistryRow) =>
    key === "updatedAt" ? r.updatedAt : key === "status" ? r.status : key === "title" ? r.title : key === "nextReviewDate" ? r.releasedRevision?.nextReviewDate ?? "9999" : r.protocolNumber;
  rows.sort((a, b) => value(a).localeCompare(value(b)) * dir);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const total = rows.length;
  const page = Math.min(Math.max(1, filters.page ?? 1), Math.max(1, Math.ceil(total / pageSize)));
  return { total, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}

export async function dashboard() {
  await refreshDueNotifications();
  const [rows, schedule, executionRows] = await Promise.all([
    registryRows(),
    activitySchedule(),
    protocolStore().select<Row>("protocol_executions", { columns: EXECUTION_SUMMARY_COLUMNS, order: [{ column: "executed_at", desc: true }], limit: 500 }),
  ]);
  const executionsWithStatus = await withReviewStatus(executionRows);
  const countStatus = (s: string) => rows.filter(r => matchesStatus(r, s)).length;
  const [recentApprovals, comments] = await Promise.all([
    protocolStore().select<Row>("protocol_approvals", { order: [{ column: "created_at", desc: true }], limit: 50 }),
    protocolStore().select<CommentRow>("protocol_review_comments", { where: { status: "open" }, order: [{ column: "created_at", desc: true }], limit: 20 }),
  ]);
  const byId = new Map(rows.map(r => [r.id, r]));
  const stats = {
    total: rows.length,
    draft: countStatus("draft"),
    pendingTechnicalReview: countStatus("technical-review-pending") + countStatus("technical-review-in-progress"),
    technicalChangesRequired: countStatus("technical-changes-required"),
    pendingQa: countStatus("technically-reviewed") + countStatus("qa-review-pending") + countStatus("qa-review-in-progress"),
    qaChangesRequired: countStatus("qa-changes-required"),
    approved: countStatus("approved"),
    released: countStatus("released"),
    superseded: countStatus("superseded"),
    retired: countStatus("retired"),
    rejected: countStatus("rejected"),
    dueForReview: rows.filter(r => r.dueForReview).length,
    expiredReferences: rows.filter(r => r.expiredReferences.length).length,
    pendingVerification: rows.filter(r => r.pendingVerification > 0).length,
    openGaps: rows.filter(r => r.openGaps > 0).length,
    reviewFlagged: rows.filter(r => r.reviewFlag).length,
    activitiesOverdue: schedule.filter(i => i.state === "overdue").length,
    activitiesDueSoon: schedule.filter(i => i.state === "due-soon").length,
    executionsAwaitingReview: executionsWithStatus.filter(e => e.reviewStatus === "recorded").length,
    executionsAwaitingApproval: executionsWithStatus.filter(e => e.reviewStatus === "reviewed").length,
  };
  const pick = (action: string) =>
    recentApprovals.filter(a => a.action === action).slice(0, 5).map(a => ({ protocolId: String(a.protocol_id), protocolNumber: byId.get(String(a.protocol_id))?.protocolNumber ?? "", revisionNumber: Number(a.revision_number), actorName: a.actor_name as string | null, at: String(a.created_at) }));
  return {
    stats,
    categories: Array.from(new Set(rows.map(r => r.equipmentCategory).filter(Boolean))).sort(),
    recentlyCreated: [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(r => ({ id: r.id, protocolNumber: r.protocolNumber, title: r.title, createdAt: r.createdAt, status: r.status })),
    recentlyApproved: pick("qa-approve"),
    recentlyReleased: pick("release"),
    upcomingActivities: schedule.filter(i => i.state !== "event-based").slice(0, 12),
    executionsPendingDecision: executionsWithStatus.filter(e => e.reviewStatus === "recorded" || e.reviewStatus === "reviewed").slice(0, 10),
    upcomingReviews: rows.filter(r => r.releasedRevision?.nextReviewDate).sort((a, b) => (a.releasedRevision!.nextReviewDate as string).localeCompare(b.releasedRevision!.nextReviewDate as string)).slice(0, 8).map(r => ({ id: r.id, protocolNumber: r.protocolNumber, nextReviewDate: r.releasedRevision!.nextReviewDate, overdue: r.overdueForReview })),
    unresolvedIssues: [
      ...rows.filter(r => r.openGaps > 0).map(r => ({ protocolId: r.id, protocolNumber: r.protocolNumber, issue: `${r.openGaps} technical gap(s) without reviewer decision` })),
      ...rows.filter(r => r.pendingVerification > 0).map(r => ({ protocolId: r.id, protocolNumber: r.protocolNumber, issue: `${r.pendingVerification} item(s) PENDING TECHNICAL VERIFICATION` })),
      ...rows.filter(r => r.reviewFlag).map(r => ({ protocolId: r.id, protocolNumber: r.protocolNumber, issue: r.reviewFlagReason || "Flagged for review" })),
      ...comments.map(c => ({ protocolId: c.protocol_id, protocolNumber: byId.get(c.protocol_id)?.protocolNumber ?? "", issue: `Open review comment: ${c.body.slice(0, 120)}` })),
    ].slice(0, 30),
  };
}

export async function getProtocolDetail(protocolId: string) {
  const protocol = await loadProtocol(protocolId);
  const [revisions, approvals, comments, executions, auditRows] = await Promise.all([
    revisionSummaries(protocolId),
    protocolStore().select<Row>("protocol_approvals", { where: { protocol_id: protocolId }, order: [{ column: "created_at" }] }),
    protocolStore().select<CommentRow>("protocol_review_comments", { where: { protocol_id: protocolId }, order: [{ column: "created_at" }] }),
    protocolStore().select<Row>("protocol_executions", { where: { protocol_id: protocolId }, columns: EXECUTION_SUMMARY_COLUMNS, order: [{ column: "executed_at", desc: true }] }),
    protocolStore().select<Row>("protocol_audit_events", { where: { protocol_id: protocolId }, order: [{ column: "created_at", desc: true }], limit: 300 }),
  ]);
  return {
    protocol: { ...mapProtocol(protocol), status: deriveProtocolStatus(revisions) },
    revisions: revisions.map(mapRevisionSummary),
    approvals: approvals.map(mapApproval),
    comments: comments.map(mapComment),
    executions: await withReviewStatus(executions),
    audit: auditRows.map(mapAudit),
  };
}

function mapApproval(a: Row) {
  return { id: String(a.id), revisionId: String(a.revision_id), revisionNumber: Number(a.revision_number), action: String(a.action), fromStatus: String(a.from_status), toStatus: String(a.to_status), signatureMeaning: (a.signature_meaning as string | null) ?? null, actorUserId: Number(a.actor_user_id), actorName: (a.actor_name as string | null) ?? null, actorRole: (a.actor_role as string | null) ?? null, comment: (a.comment as string | null) ?? null, contentHash: String(a.content_hash), createdAt: String(a.created_at), reauthenticated: a.reauthenticated === true };
}
export type ApprovalDto = ReturnType<typeof mapApproval>;
function mapAudit(a: Row) {
  return { id: String(a.id), protocolId: (a.protocol_id as string | null) ?? null, revisionId: (a.revision_id as string | null) ?? null, revisionNumber: (a.revision_number as number | null) ?? null, entityType: String(a.entity_type), entityId: (a.entity_id as string | null) ?? null, action: String(a.action), actorUserId: Number(a.actor_user_id), actorName: (a.actor_name as string | null) ?? null, actorRole: (a.actor_role as string | null) ?? null, previousValue: a.previous_value ?? null, newValue: a.new_value ?? null, reason: (a.reason as string | null) ?? null, createdAt: String(a.created_at) };
}
function mapExecutionSummary(e: Row) {
  return { id: String(e.id), protocolId: e.protocol_id ? String(e.protocol_id) : undefined, protocolNumber: e.protocol_number ? String(e.protocol_number) : undefined, revisionId: String(e.revision_id), revisionNumber: Number(e.revision_number), instrumentKey: String(e.instrument_key), equipmentId: (e.equipment_id as string | null) ?? null, validationRecordId: (e.validation_record_id as number | null) ?? null, overallResult: String(e.overall_result), executedByUserId: Number(e.executed_by_user_id ?? 0), executedByName: (e.executed_by_name as string | null) ?? null, executedAt: String(e.executed_at), engineVersion: String(e.engine_version), activityKey: (e.activity_key as string | null) ?? null, activityName: (e.activity_name as string | null) ?? null };
}
const EXECUTION_SUMMARY_COLUMNS = ["id", "protocol_id", "protocol_number", "revision_id", "revision_number", "instrument_key", "equipment_id", "validation_record_id", "overall_result", "executed_by_user_id", "executed_by_name", "executed_at", "engine_version", "activity_key", "activity_name"];

export async function getRevision(actor: Actor, revisionId: string) {
  const revision = await loadRevision(revisionId);
  const [protocol, { rows: refRows, lookup }, comments, approvals, duties] = await Promise.all([
    loadProtocol(revision.protocol_id),
    referenceLookup(),
    commentsFor(revisionId),
    protocolStore().select<Row>("protocol_approvals", { where: { revision_id: revisionId }, order: [{ column: "created_at" }] }),
    dutiesOf(actor),
  ]);
  const gapDecisions = latestGapDecisions(comments);
  const openComments = comments.filter(c => c.kind === "comment" && c.status === "open").length;
  const actors = { status: revision.status, authorUserId: revision.author_user_id, technicalReviewerUserId: revision.technical_reviewer_user_id, qaApproverUserId: revision.qa_approver_user_id };
  const usedIds = new Set(collectReferenceIds(revision.content));
  return {
    protocol: mapProtocol(protocol),
    revision: { ...mapRevisionSummary(revision), content: revision.content, referenceSnapshot: revision.reference_snapshot ?? null },
    issues: submissionIssues(revision.content, lookup),
    approvalBlockers: approvalBlockers(revision.content, { references: lookup, gapDecisions, openCommentCount: openComments, today: today() }),
    gapDecisions: Array.from(gapDecisions.values()),
    comments: comments.map(mapComment),
    approvals: approvals.map(mapApproval),
    references: refRows.filter(r => usedIds.has(r.id)).map(mapReference),
    availableActions: availableActions(actors, { id: actor.id, duties }),
    editable: EDITABLE_STATUSES.includes(revision.status) && duties.includes("author"),
    duties,
  };
}

export async function compareRevisions(fromRevisionId: string, toRevisionId: string) {
  const [from, to] = await Promise.all([loadRevision(fromRevisionId), loadRevision(toRevisionId)]);
  if (from.protocol_id !== to.protocol_id) throw new ProtocolError("BAD_REQUEST", "Revisions belong to different protocols");
  return { from: mapRevisionSummary(from), to: mapRevisionSummary(to), entries: compareContents(from.content, to.content) };
}

export async function listAudit(input: { protocolId?: string; entityType?: string; limit?: number }) {
  const rows = await protocolStore().select<Row>("protocol_audit_events", {
    where: { ...(input.protocolId ? { protocol_id: input.protocolId } : {}), ...(input.entityType ? { entity_type: input.entityType } : {}) },
    order: [{ column: "created_at", desc: true }],
    limit: Math.min(1000, input.limit ?? 300),
  });
  return rows.map(mapAudit);
}

/* ------------------------------------------------------------------ */
/* Reference Library                                                    */
/* ------------------------------------------------------------------ */

export async function listReferences() {
  const { rows } = await referenceLookup();
  const revisions = await revisionSummaries();
  return rows.map(r => ({
    ...mapReference(r),
    usedByRevisionIds: revisions.filter(v => (v.reference_ids ?? []).includes(r.id)).map(v => v.id),
    usedByProtocolCount: new Set(revisions.filter(v => (v.reference_ids ?? []).includes(r.id)).map(v => v.protocol_id)).size,
  }));
}

export type ReferenceInput = {
  id?: string;
  expectedRowVersion?: number;
  code: string;
  title: string;
  issuer: string;
  referenceType: string;
  documentNumber: string;
  edition: string;
  revision: string;
  publicationDate: string;
  effectiveDate: string;
  expiryDate: string;
  reviewDate: string;
  sourceUrl: string;
  documentUrl: string;
  applicableSection: string;
  applicableClause: string;
  verificationStatus: ReferenceVerificationStatus;
  notes: string;
  reason: string;
};

const SIGNIFICANT_REFERENCE_FIELDS = ["code", "title", "document_number", "edition", "revision", "effective_date", "expiry_date", "verification_status", "publication_date"] as const;

export async function saveReference(actor: Actor, input: ReferenceInput) {
  const duties = await requireDuty(actor, "author", "technical-reviewer", "qa-approver");
  const existing = input.id ? (await protocolStore().select<ReferenceRow>("protocol_references", { where: { id: input.id }, limit: 1 }))[0] : undefined;
  if (input.id && !existing) throw new ProtocolError("NOT_FOUND", "Reference not found");
  const sameCode = await protocolStore().select<{ id: string }>("protocol_references", { where: { code: input.code }, columns: ["id"] });
  if (sameCode.some(r => r.id !== input.id)) throw new ProtocolError("PRECONDITION_FAILED", `Reference code ${input.code} already exists`);
  const becomesVerified = input.verificationStatus === "verified" && existing?.verification_status !== "verified";
  if (becomesVerified && !duties.some(d => d === "technical-reviewer" || d === "qa-approver"))
    throw new ProtocolError("FORBIDDEN", "Only a technical specialist or QA reviewer may mark a reference as verified");
  if (input.verificationStatus === "verified" && !input.edition.trim() && !input.revision.trim() && !input.effectiveDate.trim())
    throw new ProtocolError("PRECONDITION_FAILED", "A verified reference must record its edition, revision or effective date");
  const t = now();
  const row = {
    code: input.code, title: input.title, issuer: input.issuer, reference_type: input.referenceType, document_number: input.documentNumber,
    edition: input.edition, revision: input.revision, publication_date: input.publicationDate || null, effective_date: input.effectiveDate || null,
    expiry_date: input.expiryDate || null, review_date: input.reviewDate || null, source_url: input.sourceUrl, document_url: input.documentUrl,
    applicable_section: input.applicableSection, applicable_clause: input.applicableClause, verification_status: input.verificationStatus,
    verified_at: input.verificationStatus === "verified" ? (becomesVerified ? t : existing?.verified_at ?? t) : null,
    verified_by_user_id: input.verificationStatus === "verified" ? (becomesVerified ? actor.id : existing?.verified_by_user_id ?? actor.id) : null,
    verified_by_name: input.verificationStatus === "verified" ? (becomesVerified ? actor.name : existing?.verified_by_name ?? actor.name) : null,
    notes: input.notes, updated_at: t,
  };
  const changes: Change[] = [];
  if (!existing) {
    const newId = id();
    changes.push({ op: "insert", table: "protocol_references", row: { id: newId, ...row, created_by_user_id: actor.id, created_at: t, row_version: 1 } });
    changes.push(audit(actor, duties, { entityType: "reference", entityId: newId, action: "reference.created", next: row, reason: input.reason }));
    await protocolStore().apply(changes);
    return { id: newId, affectedProtocols: [] as string[] };
  }
  if (input.expectedRowVersion !== existing.row_version) throw new ProtocolError("PRECONDITION_FAILED", "Reference was modified by another user; reload and retry");
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  (Object.keys(row) as Array<keyof typeof row>).forEach(k => {
    if (k === "updated_at") return;
    const before = (existing as unknown as Record<string, unknown>)[k] ?? null;
    const after = row[k] ?? null;
    if (String(before ?? "") !== String(after ?? "")) {
      previous[k] = before;
      next[k] = after;
    }
  });
  if (!Object.keys(next).length) return { id: existing.id, affectedProtocols: [] as string[] };
  changes.push({ op: "update", table: "protocol_references", id: existing.id, set: { ...row, row_version: existing.row_version + 1 }, expect: { row_version: existing.row_version } });
  // Identify affected protocols — approved revisions are NEVER silently updated; they are flagged for review.
  const significant = SIGNIFICANT_REFERENCE_FIELDS.some(f => f in next);
  const affected: string[] = [];
  if (significant) {
    const revisions = await revisionSummaries();
    const protocolIds = Array.from(new Set(revisions.filter(r => (r.reference_ids ?? []).includes(existing.id) && r.status !== "superseded" && r.status !== "retired" && r.status !== "rejected").map(r => r.protocol_id)));
    for (const pid of protocolIds) {
      const p = await loadProtocol(pid);
      affected.push(p.protocol_number);
      const reason = `Reference ${existing.code} changed (${Object.keys(next).join(", ")}); review whether a new revision is required. Previous: ${JSON.stringify(previous)}`.slice(0, 900);
      changes.push({ op: "update", table: "protocols", id: pid, set: { review_flag: true, review_flag_reason: reason, updated_at: t, row_version: p.row_version + 1 }, expect: { row_version: p.row_version } });
      changes.push(notify("protocol-affected-by-reference-change", null, p.created_by_user_id, pid, null, `${p.protocol_number}: affected by change of reference ${existing.code}`, `refchange:${existing.id}:${existing.row_version}:${pid}`));
      changes.push(audit(actor, duties, { protocolId: pid, entityType: "protocol", entityId: pid, action: "protocol.flagged-by-reference-change", previous: { referenceId: existing.id, ...previous }, next, reason: input.reason }));
    }
    changes.push(notify("reference-revision-detected", "technical-reviewer", null, null, null, `Reference ${existing.code} was updated (${Object.keys(next).join(", ")})`, `refupdate:${existing.id}:${existing.row_version}`));
  }
  changes.push(audit(actor, duties, { entityType: "reference", entityId: existing.id, action: "reference.updated", previous, next: { ...next, affectedProtocols: affected }, reason: input.reason }));
  await protocolStore().apply(changes);
  return { id: existing.id, affectedProtocols: affected };
}

/* ------------------------------------------------------------------ */
/* Protocol authoring                                                   */
/* ------------------------------------------------------------------ */

export async function createProtocol(actor: Actor, input: { content?: unknown; templateId?: string; identification?: ProtocolContentInput["identification"]; reason: string }) {
  const duties = await requireDuty(actor, "author");
  let content: ProtocolContent;
  if (input.templateId) {
    if (!input.identification) throw new ProtocolError("BAD_REQUEST", "Identification is required when creating from a template");
    const builtin = BUILTIN_TEMPLATES.find(t => t.id === input.templateId);
    let structure: unknown = builtin?.structure;
    if (!builtin) {
      const [tpl] = await protocolStore().select<Row>("protocol_templates", { where: { id: input.templateId, is_active: true }, limit: 1 });
      if (!tpl) throw new ProtocolError("NOT_FOUND", "Template not found or inactive");
      structure = tpl.structure;
    }
    try {
      content = contentFromTemplate(structure, input.identification);
    } catch (error) {
      parseContentOrThrow({ identification: input.identification });
      throw error;
    }
  } else content = parseContentOrThrow(input.content);
  assertStructure(content);
  await assertNumberAvailable(content.identification.number);
  await assertEquipmentLinks(content);
  const t = now();
  const protocolId = id();
  const revisionId = id();
  const derived = revisionDerived(content);
  const changes: Change[] = [
    { op: "insert", table: "protocols", row: { id: protocolId, ...headerFromContent(content), status: "draft", current_revision_id: revisionId, current_revision_number: 1, released_revision_id: null, released_revision_number: null, review_flag: false, created_by_user_id: actor.id, created_by_name: actor.name, created_at: t, updated_at: t, row_version: 1 } },
    { op: "insert", table: "protocol_revisions", row: { id: revisionId, protocol_id: protocolId, revision_number: 1, status: "draft", content, ...derived, change_reason: input.reason || "Initial draft", revision_description: "Initial draft", locked: false, author_user_id: actor.id, author_name: actor.name, created_at: t, updated_at: t, row_version: 1 } },
    audit(actor, duties, { protocolId, revisionId, revisionNumber: 1, entityType: "protocol", entityId: protocolId, action: "protocol.created", next: { protocolNumber: content.identification.number, title: content.identification.title, templateId: input.templateId ?? null, contentHash: derived.content_hash, sections: content.sections.length }, reason: input.reason }),
  ];
  if (content.equipmentLinks.length)
    changes.push(audit(actor, duties, { protocolId, revisionId, revisionNumber: 1, entityType: "equipment-association", entityId: protocolId, action: "equipment.associated", next: content.equipmentLinks, reason: input.reason }));
  await protocolStore().apply(changes);
  return { protocolId, revisionId };
}

export async function saveDraft(actor: Actor, input: { revisionId: string; expectedRowVersion: number; content: unknown; reason: string }) {
  const duties = await requireDuty(actor, "author");
  const revision = await loadRevision(input.revisionId);
  if (!EDITABLE_STATUSES.includes(revision.status))
    throw new ProtocolError("PRECONDITION_FAILED", `Revision ${revision.revision_number} is ${STATUS_LABELS[revision.status]} and cannot be edited. Changes after submission/approval require returning the draft or creating a new revision.`);
  if (revision.row_version !== input.expectedRowVersion) throw new ProtocolError("PRECONDITION_FAILED", "The draft was modified by another user; reload it (your unsaved changes are kept in the editor)");
  if (!input.reason.trim()) throw new ProtocolError("BAD_REQUEST", "A change reason is required");
  const content = parseContentOrThrow(input.content);
  assertStructure(content);
  const protocol = await loadProtocol(revision.protocol_id);
  if (content.identification.number !== protocol.protocol_number) {
    if (protocol.released_revision_id || revision.revision_number > 1) throw new ProtocolError("PRECONDITION_FAILED", "The protocol number cannot change after a revision has been released or revised");
    await assertNumberAvailable(content.identification.number, protocol.id);
  }
  const entries = compareContents(revision.content, content);
  if (!entries.length) return { revisionId: revision.id, rowVersion: revision.row_version, changes: 0 };
  if (entries.some(e => e.entity === "equipment-link")) await assertEquipmentLinks(content);
  const t = now();
  const { previous, next } = diffForAudit(entries);
  const changes: Change[] = [
    { op: "update", table: "protocol_revisions", id: revision.id, set: { content, ...revisionDerived(content), updated_at: t, row_version: revision.row_version + 1 }, expect: { row_version: revision.row_version, status: revision.status } },
    { op: "update", table: "protocols", id: protocol.id, set: { ...headerFromContent(content), updated_at: t, row_version: protocol.row_version + 1 }, expect: { row_version: protocol.row_version } },
    audit(actor, duties, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "revision", entityId: revision.id, action: "revision.content-updated", previous, next, reason: input.reason }),
  ];
  const linkChanges = entries.filter(e => e.entity === "equipment-link");
  if (linkChanges.length)
    changes.push(audit(actor, duties, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "equipment-association", entityId: protocol.id, action: "equipment.association-changed", previous: linkChanges.map(e => e.before ?? null), next: linkChanges.map(e => e.after ?? null), reason: input.reason }));
  const intervalChanges = entries.filter(e => e.entity === "interval");
  if (intervalChanges.length)
    changes.push(audit(actor, duties, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "interval", entityId: revision.id, action: "interval.changed", previous: intervalChanges.map(e => e.before ?? null), next: intervalChanges.map(e => e.after ?? null), reason: input.reason }));
  await protocolStore().apply(changes);
  return { revisionId: revision.id, rowVersion: revision.row_version + 1, changes: entries.length };
}

export async function createRevision(actor: Actor, input: { protocolId: string; reason: string; description: string }) {
  const duties = await requireDuty(actor, "author");
  if (!input.reason.trim()) throw new ProtocolError("BAD_REQUEST", "A change reason is required for a new revision");
  const protocol = await loadProtocol(input.protocolId);
  const revisions = await revisionSummaries(protocol.id);
  const open = revisions.find(r => !["released", "superseded", "retired", "rejected"].includes(r.status));
  if (open) throw new ProtocolError("PRECONDITION_FAILED", `Revision ${open.revision_number} is still open (${STATUS_LABELS[open.status]}); only one open revision is allowed`);
  const base = revisions.find(r => r.status === "released") ?? revisions[0];
  if (!base) throw new ProtocolError("PRECONDITION_FAILED", "No base revision found");
  const baseFull = await loadRevision(base.id);
  const nextNumber = Math.max(...revisions.map(r => r.revision_number)) + 1;
  const content = parseProtocolContent(baseFull.content);
  const t = now();
  const revisionId = id();
  await protocolStore().apply([
    { op: "insert", table: "protocol_revisions", row: { id: revisionId, protocol_id: protocol.id, revision_number: nextNumber, status: "draft", content, ...revisionDerived(content), change_reason: input.reason, revision_description: input.description, based_on_revision_id: base.id, locked: false, author_user_id: actor.id, author_name: actor.name, created_at: t, updated_at: t, row_version: 1 } },
    { op: "update", table: "protocols", id: protocol.id, set: { current_revision_id: revisionId, current_revision_number: nextNumber, status: deriveProtocolStatus([...revisions, { status: "draft", revision_number: nextNumber }]), updated_at: t, row_version: protocol.row_version + 1 }, expect: { row_version: protocol.row_version } },
    audit(actor, duties, { protocolId: protocol.id, revisionId, revisionNumber: nextNumber, entityType: "revision", entityId: revisionId, action: "revision.created", previous: { basedOnRevision: base.revision_number, contentHash: base.content_hash }, next: { revisionNumber: nextNumber, description: input.description }, reason: input.reason }),
    notify("new-revision-created", "technical-reviewer", null, protocol.id, revisionId, `${protocol.protocol_number} revision ${nextNumber} created (draft)`, `newrev:${revisionId}`),
  ]);
  return { revisionId, revisionNumber: nextNumber };
}

/* ------------------------------------------------------------------ */
/* Review & approval workflow                                           */
/* ------------------------------------------------------------------ */

export async function transition(actor: Actor, input: { revisionId: string; expectedRowVersion: number; action: WorkflowAction; comment?: string; effectiveDate?: string; attestation?: boolean; password?: string }) {
  const duties = await dutiesOf(actor);
  const revision = await loadRevision(input.revisionId);
  if (revision.row_version !== input.expectedRowVersion) throw new ProtocolError("PRECONDITION_FAILED", "The revision changed since it was loaded (possible duplicate submission); reload and retry");
  const rule = TRANSITIONS[input.action];
  const denial = transitionDenial(input.action, { status: revision.status, authorUserId: revision.author_user_id, technicalReviewerUserId: revision.technical_reviewer_user_id, qaApproverUserId: revision.qa_approver_user_id }, { id: actor.id, duties });
  if (denial) throw new ProtocolError(duties.includes(rule.duty) && rule.from.includes(revision.status) ? "FORBIDDEN" : rule.from.includes(revision.status) ? "FORBIDDEN" : "PRECONDITION_FAILED", denial);
  const comment = input.comment?.trim() ?? "";
  if (rule.commentRequired && comment.length < 3) throw new ProtocolError("BAD_REQUEST", `"${rule.label}" requires a comment / reason`);
  const protocol = await loadProtocol(revision.protocol_id);
  const t = now();
  const set: Row = { status: rule.to, updated_at: t, row_version: revision.row_version + 1 };
  const changes: Change[] = [];
  const extraAudit: Record<string, unknown> = {};

  switch (input.action) {
    case "submit-technical-review": {
      const { lookup } = await referenceLookup();
      const errors = submissionIssues(revision.content, lookup).filter(i => i.severity === "error");
      if (errors.length) throw new ProtocolError("PRECONDITION_FAILED", "The protocol is not complete enough for technical review", errors.map(e => e.message));
      Object.assign(set, { submitted_at: t, technical_reviewer_user_id: null, technical_reviewer_name: null, technical_reviewed_at: null, qa_approver_user_id: null, qa_approver_name: null });
      break;
    }
    case "start-technical-review":
      Object.assign(set, { technical_reviewer_user_id: actor.id, technical_reviewer_name: actor.name });
      break;
    case "complete-technical-review": {
      if (!input.attestation) throw new ProtocolError("BAD_REQUEST", "Technical review completion requires the reviewer attestation");
      const comments = await commentsFor(revision.id);
      const decisions = latestGapDecisions(comments.filter(c => c.author_user_id === actor.id));
      const undecided = revision.content.gaps.filter(g => !decisions.has(g.key));
      if (undecided.length) throw new ProtocolError("PRECONDITION_FAILED", "Every technical gap requires a recorded technical reviewer decision", undecided.map(g => g.title));
      const open = comments.filter(c => c.kind === "comment" && c.status === "open");
      if (open.length) throw new ProtocolError("PRECONDITION_FAILED", `${open.length} review comment(s) are still open; return the draft for correction or resolve them`);
      Object.assign(set, { technical_reviewed_at: t });
      break;
    }
    case "start-qa-review":
      Object.assign(set, { qa_approver_user_id: actor.id, qa_approver_name: actor.name });
      break;
    case "qa-approve": {
      if (!input.attestation) throw new ProtocolError("BAD_REQUEST", "QA approval requires the electronic signature attestation");
      const [{ rows: refRows, lookup }, comments] = await Promise.all([referenceLookup(), commentsFor(revision.id)]);
      const blockers = approvalBlockers(revision.content, { references: lookup, gapDecisions: latestGapDecisions(comments), openCommentCount: comments.filter(c => c.kind === "comment" && c.status === "open").length, today: today() });
      if (blockers.length) throw new ProtocolError("PRECONDITION_FAILED", "QA approval is blocked", blockers);
      const used = new Set(collectReferenceIds(revision.content));
      const snapshot = { capturedAt: t, references: refRows.filter(r => used.has(r.id)).map(mapReference), gapDecisions: Array.from(latestGapDecisions(comments).values()) };
      Object.assign(set, { approved_at: t, locked: true, reference_snapshot: snapshot });
      extraAudit.referenceSnapshot = snapshot.references.map(r => ({ id: r.id, code: r.code, edition: r.edition, revision: r.revision, rowVersion: r.rowVersion }));
      break;
    }
    case "release": {
      const effective = input.effectiveDate ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) throw new ProtocolError("BAD_REQUEST", "Controlled release requires an effective date (YYYY-MM-DD)");
      if (revision.approved_at && effective < revision.approved_at.slice(0, 10)) throw new ProtocolError("BAD_REQUEST", "Effective date cannot precede the QA approval date");
      const periodic = revision.content.intervals.find(i => i.activity === "Periodic Review" && i.unit !== "event" && i.value);
      const nextReview = periodic ? addInterval(new Date(`${effective}T00:00:00Z`), periodic.value as number, periodic.unit)?.toISOString().slice(0, 10) ?? null : null;
      Object.assign(set, { released_by_user_id: actor.id, released_by_name: actor.name, released_at: t, effective_date: effective, next_review_date: nextReview });
      const previous = (await revisionSummaries(protocol.id)).find(r => r.status === "released");
      if (previous) {
        changes.push({ op: "update", table: "protocol_revisions", id: previous.id, set: { status: "superseded", superseded_at: t, superseded_by_revision_id: revision.id, updated_at: t, row_version: previous.row_version + 1 }, expect: { row_version: previous.row_version, status: "released" } });
        changes.push(audit(actor, duties, { protocolId: protocol.id, revisionId: previous.id, revisionNumber: previous.revision_number, entityType: "revision", entityId: previous.id, action: "revision.superseded", previous: { status: "released" }, next: { status: "superseded", supersededBy: revision.revision_number } }));
      }
      break;
    }
    case "retire":
      Object.assign(set, { retired_at: t });
      break;
  }
  if (rule.signatureMeaning)
    await requireSignature(actor, duties, input.password, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "revision", entityId: revision.id, meaning: rule.signatureMeaning });
  changes.push({ op: "update", table: "protocol_revisions", id: revision.id, set, expect: { row_version: revision.row_version, status: revision.status } });
  changes.push({
    op: "insert",
    table: "protocol_approvals",
    row: { id: id(), protocol_id: protocol.id, revision_id: revision.id, revision_number: revision.revision_number, action: input.action, from_status: revision.status, to_status: rule.to, signature_meaning: rule.signatureMeaning, actor_user_id: actor.id, actor_name: actor.name, actor_role: actorRole(actor, duties), comment: comment || null, content_hash: revision.content_hash, created_at: t, reauthenticated: Boolean(rule.signatureMeaning) },
  });
  const revs = (await revisionSummaries(protocol.id)).map(r => (r.id === revision.id ? { ...r, status: rule.to } : input.action === "release" && r.status === "released" ? { ...r, status: "superseded" as RevisionStatus } : r));
  const header: Row = { status: deriveProtocolStatus(revs), updated_at: t, row_version: protocol.row_version + 1 };
  if (input.action === "release") Object.assign(header, { released_revision_id: revision.id, released_revision_number: revision.revision_number, review_flag: false, review_flag_reason: null });
  if (input.action === "retire") Object.assign(header, { released_revision_id: null, released_revision_number: null });
  changes.push({ op: "update", table: "protocols", id: protocol.id, set: header, expect: { row_version: protocol.row_version } });
  changes.push(audit(actor, duties, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "revision", entityId: revision.id, action: `workflow.${input.action}`, previous: { status: revision.status }, next: { status: rule.to, contentHash: revision.content_hash, ...extraAudit, ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}) }, reason: comment || null }));
  const recipientUser = rule.notify === "author" ? revision.author_user_id : null;
  const recipientDuty = rule.notify === "author" ? null : rule.notify;
  changes.push(notify(`workflow.${input.action}`, recipientDuty, recipientUser, protocol.id, revision.id, `${protocol.protocol_number} rev ${revision.revision_number}: ${rule.label} → ${STATUS_LABELS[rule.to]}${comment ? ` — ${comment.slice(0, 160)}` : ""}`, `wf:${revision.id}:${input.action}:${revision.row_version}`));
  if (input.action === "submit-technical-review" && revision.content.gaps.length)
    changes.push(notify("technical-gap-requires-review", "technical-reviewer", null, protocol.id, revision.id, `${protocol.protocol_number} rev ${revision.revision_number}: ${revision.content.gaps.length} technical gap(s) require review`, `gap:${revision.id}:${revision.row_version}`));
  await protocolStore().apply(changes);
  return { status: rule.to, rowVersion: revision.row_version + 1 };
}

export async function addReviewComment(actor: Actor, input: { revisionId: string; targetType: string; targetKey: string | null; body: string }) {
  const duties = await dutiesOf(actor);
  const revision = await loadRevision(input.revisionId);
  let stage: string;
  if (revision.status === "technical-review-in-progress" && revision.technical_reviewer_user_id === actor.id && duties.includes("technical-reviewer")) stage = "technical";
  else if (revision.status === "qa-review-in-progress" && revision.qa_approver_user_id === actor.id && duties.includes("qa-approver")) stage = "qa";
  else throw new ProtocolError("FORBIDDEN", "Review comments can be added only by the assigned technical specialist or QA reviewer while their review is in progress");
  if (input.body.trim().length < 3) throw new ProtocolError("BAD_REQUEST", "Comment is too short");
  const commentId = id();
  await protocolStore().apply([
    { op: "insert", table: "protocol_review_comments", row: { id: commentId, protocol_id: revision.protocol_id, revision_id: revision.id, kind: "comment", stage, target_type: input.targetType, target_key: input.targetKey, body: input.body.trim(), decision: null, author_user_id: actor.id, author_name: actor.name, status: "open", created_at: now(), row_version: 1 } },
    audit(actor, duties, { protocolId: revision.protocol_id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "review-comment", entityId: commentId, action: "review.comment-added", next: { stage, targetType: input.targetType, targetKey: input.targetKey, body: input.body.trim() } }),
  ]);
  return { id: commentId };
}

export async function resolveReviewComment(actor: Actor, input: { commentId: string; expectedRowVersion: number; note: string }) {
  const duties = await dutiesOf(actor);
  const [comment] = await protocolStore().select<CommentRow>("protocol_review_comments", { where: { id: input.commentId }, limit: 1 });
  if (!comment) throw new ProtocolError("NOT_FOUND", "Comment not found");
  if (comment.kind !== "comment" || comment.status !== "open") throw new ProtocolError("PRECONDITION_FAILED", "Only open review comments can be resolved");
  const revision = await loadRevision(comment.revision_id);
  if (revision.locked) throw new ProtocolError("PRECONDITION_FAILED", "Approved revisions are immutable");
  const isCommentAuthor = comment.author_user_id === actor.id;
  if (!isCommentAuthor && !(duties.includes("author") && EDITABLE_STATUSES.includes(revision.status)))
    throw new ProtocolError("FORBIDDEN", "Comments are resolved by the protocol author while the draft is returned for correction, or withdrawn by the reviewer who raised them");
  if (input.note.trim().length < 3) throw new ProtocolError("BAD_REQUEST", "A resolution note is required");
  const t = now();
  await protocolStore().apply([
    { op: "update", table: "protocol_review_comments", id: comment.id, set: { status: "resolved", resolution_note: input.note.trim(), resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: t, row_version: comment.row_version + 1 }, expect: { row_version: input.expectedRowVersion, status: "open" } },
    audit(actor, duties, { protocolId: comment.protocol_id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "review-comment", entityId: comment.id, action: "review.comment-resolved", previous: { status: "open" }, next: { status: "resolved", note: input.note.trim() } }),
  ]);
  return { ok: true };
}

export async function recordGapDecision(actor: Actor, input: { revisionId: string; gapKey: string; decision: string; rationale: string }) {
  const duties = await dutiesOf(actor);
  const revision = await loadRevision(input.revisionId);
  if (revision.status !== "technical-review-in-progress" || revision.technical_reviewer_user_id !== actor.id || !duties.includes("technical-reviewer"))
    throw new ProtocolError("FORBIDDEN", "Gap decisions are recorded by the assigned technical specialist during technical review");
  const gap = revision.content.gaps.find(g => g.key === input.gapKey);
  if (!gap) throw new ProtocolError("NOT_FOUND", "Technical gap not found in this revision");
  if (!gap.assessment.trim()) throw new ProtocolError("PRECONDITION_FAILED", "The gap has no documented technical assessment; return the draft for the author to document it");
  if (input.rationale.trim().length < 10) throw new ProtocolError("BAD_REQUEST", "A decision rationale (≥ 10 characters) is required");
  const decisionId = id();
  await protocolStore().apply([
    { op: "insert", table: "protocol_review_comments", row: { id: decisionId, protocol_id: revision.protocol_id, revision_id: revision.id, kind: "gap-decision", stage: "technical", target_type: "gap", target_key: gap.key, body: input.rationale.trim(), decision: input.decision, author_user_id: actor.id, author_name: actor.name, status: "recorded", created_at: now(), row_version: 1 } },
    audit(actor, duties, { protocolId: revision.protocol_id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "technical-gap", entityId: gap.key, action: "gap.decision-recorded", next: { decision: input.decision, rationale: input.rationale.trim(), specifications: gap.specifications } }),
  ]);
  return { id: decisionId };
}

/* ------------------------------------------------------------------ */
/* Execution (calibration / validation / qualification integration)     */
/* ------------------------------------------------------------------ */

export async function releasedForEquipment(instrumentKey: string) {
  const registry = await equipmentRegistry();
  const equipment = registry.find(e => e.instrumentKey === instrumentKey);
  if (!equipment) throw new ProtocolError("NOT_FOUND", "Equipment not found in the Equipment Library");
  const protocols = await protocolStore().select<ProtocolRow>("protocols", { order: [{ column: "protocol_number" }] });
  const released = protocols.filter(p => p.released_revision_id);
  const out = [];
  for (const p of released) {
    const revision = await loadRevision(p.released_revision_id as string);
    if (revision.status !== "released") continue;
    const problems = compatibilityProblems(revision.content, equipment);
    const linked = revision.content.equipmentLinks.some(l => l.instrumentKey === instrumentKey);
    if (!linked && revision.content.identification.associationType === "equipment") continue;
    out.push({ protocolId: p.id, protocolNumber: p.protocol_number, title: p.title, revisionId: revision.id, revisionNumber: revision.revision_number, effectiveDate: revision.effective_date, stages: revision.content.stages, compatible: problems.length === 0, compatibilityProblems: problems });
  }
  const drafts = protocols.filter(p => !p.released_revision_id && (p.instrument_key === instrumentKey || normalizeMaker(p.model ?? "") === normalizeMaker(equipment.model))).map(p => ({ protocolNumber: p.protocol_number, status: p.status }));
  return { equipment, released: out, notExecutable: drafts };
}

export type ExecuteInput = { revisionId: string; instrumentKey: string; measurements: Measurements; validationRecordId?: number | null; stage?: string; comments?: string; activityKey?: string | null; deviations?: ExecutionDeviation[] };

export async function executeProtocol(actor: Actor, input: ExecuteInput) {
  const prepared = await prepareExecution(actor, input);
  await protocolStore().apply(prepared.changes);
  return { executionId: prepared.executionId, evaluation: prepared.evaluation };
}

/** Validates a formal execution and returns its change set (applied by executeProtocol, or together with a run by recordRun). */
export async function prepareExecution(actor: Actor, input: ExecuteInput) {
  const duties = await requireDuty(actor, "executor");
  const revision = await loadRevision(input.revisionId);
  if (revision.status !== "released")
    throw new ProtocolError("PRECONDITION_FAILED", `Only RELEASED protocol revisions can be executed (this revision is ${STATUS_LABELS[revision.status]})`);
  const protocol = await loadProtocol(revision.protocol_id);
  const equipment = (await equipmentRegistry()).find(e => e.instrumentKey === input.instrumentKey);
  if (!equipment) throw new ProtocolError("NOT_FOUND", "Equipment not found in the Equipment Library");
  const problems = compatibilityProblems(revision.content, equipment);
  if (problems.length) throw new ProtocolError("PRECONDITION_FAILED", "Equipment is not compatible with this protocol revision", problems);
  if (input.validationRecordId) {
    const record = await getValidationRecordById(input.validationRecordId);
    if (!record) throw new ProtocolError("NOT_FOUND", "Linked validation record not found");
    if (record.instrumentKey !== input.instrumentKey) throw new ProtocolError("PRECONDITION_FAILED", "Linked validation record belongs to different equipment");
  }
  const activity = input.activityKey ? revision.content.intervals.find(i => i.key === input.activityKey) : null;
  if (input.activityKey && !activity) throw new ProtocolError("BAD_REQUEST", "The selected interval activity is not defined in this protocol revision");
  const deviations = (input.deviations ?? []).map(d => ({ description: d.description.trim(), impact: d.impact.trim(), immediateAction: d.immediateAction.trim(), reference: d.reference.trim() }));
  if (deviations.some(d => d.description.length < 5)) throw new ProtocolError("BAD_REQUEST", "Each deviation needs a description (at least 5 characters)");
  const knownTests = new Set(revision.content.sections.flatMap(s => s.tests.map(t => t.key)));
  const unknown = Object.keys(input.measurements).filter(k => !knownTests.has(k));
  if (unknown.length) throw new ProtocolError("BAD_REQUEST", "Measurements reference tests that are not part of this revision", unknown);
  const evaluation = evaluateExecution(revision.content, input.measurements);
  const t = now();
  const executionId = id();
  const changes: Change[] = [
    {
      op: "insert",
      table: "protocol_executions",
      row: { id: executionId, protocol_id: protocol.id, revision_id: revision.id, protocol_number: protocol.protocol_number, revision_number: revision.revision_number, content_hash: revision.content_hash, instrument_key: equipment.instrumentKey, equipment_id: equipment.instrumentId, serial_number: equipment.serialNumber, validation_record_id: input.validationRecordId ?? null, stage: input.stage ?? null, measurements: input.measurements, evaluation, overall_result: evaluation.overall, engine_version: evaluation.engineVersion, protocol_snapshot: revision.content, reference_snapshot: revision.reference_snapshot ?? null, comments: input.comments ?? null, executed_by_user_id: actor.id, executed_by_name: actor.name, executed_at: t, created_at: t, activity_key: activity?.key ?? null, activity_name: activity?.activity ?? null, deviations },
    },
    audit(actor, duties, { protocolId: protocol.id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "execution", entityId: executionId, action: "execution.recorded", next: { overall: evaluation.overall, counts: evaluation.counts, instrumentKey: equipment.instrumentKey, equipmentId: equipment.instrumentId, validationRecordId: input.validationRecordId ?? null, contentHash: revision.content_hash, activity: activity?.activity ?? null, deviations: deviations.length } }),
    notify("execution-review-required", "technical-reviewer", null, protocol.id, revision.id, `${protocol.protocol_number} rev ${revision.revision_number}: execution on ${equipment.instrumentId} recorded (calculated ${evaluation.overall}${deviations.length ? `, ${deviations.length} deviation(s)` : ""}) — technical review required`, `exec-recorded:${executionId}`),
  ];
  return { executionId, evaluation, changes, equipment, protocol, revision };
}

type ExecutionReviewRowDb = { id: string; execution_id: string; protocol_id: string; action: string; from_status: string; to_status: string; signature_meaning: string; reauthenticated: boolean; comment: string; actor_user_id: number; actor_name: string | null; actor_role: string | null; created_at: string };

async function reviewsByExecution(executionIds: string[]) {
  const map = new Map<string, ExecutionReviewRowDb[]>();
  if (!executionIds.length) return map;
  const rows = await protocolStore().select<ExecutionReviewRowDb>("protocol_execution_reviews", { in: { column: "execution_id", values: executionIds }, order: [{ column: "created_at" }] });
  rows.forEach(r => map.set(r.execution_id, [...(map.get(r.execution_id) ?? []), r]));
  return map;
}
const mapExecutionReview = (r: ExecutionReviewRowDb) => ({ id: r.id, action: r.action, fromStatus: r.from_status, toStatus: r.to_status, signatureMeaning: r.signature_meaning, reauthenticated: r.reauthenticated === true, comment: r.comment, actorUserId: r.actor_user_id, actorName: r.actor_name, actorRole: r.actor_role, createdAt: r.created_at });

async function withReviewStatus(rows: Row[]) {
  const reviews = await reviewsByExecution(rows.map(r => String(r.id)));
  return rows.map(r => {
    const list = reviews.get(String(r.id)) ?? [];
    const status = executionReviewStatus(list.map(x => ({ toStatus: x.to_status })));
    return { ...mapExecutionSummary(r), reviewStatus: status, reviewStatusLabel: EXECUTION_REVIEW_STATUS_LABELS[status] };
  });
}

export async function listExecutions(input: { protocolId?: string; instrumentKey?: string; reviewStatus?: string; limit?: number }) {
  const rows = await protocolStore().select<Row>("protocol_executions", {
    where: { ...(input.protocolId ? { protocol_id: input.protocolId } : {}), ...(input.instrumentKey ? { instrument_key: input.instrumentKey } : {}) },
    columns: EXECUTION_SUMMARY_COLUMNS,
    order: [{ column: "executed_at", desc: true }],
    limit: Math.min(500, input.limit ?? 200),
  });
  const out = await withReviewStatus(rows);
  return input.reviewStatus ? out.filter(r => r.reviewStatus === input.reviewStatus) : out;
}

export async function getExecution(actor: Actor, executionId: string) {
  const [row] = await protocolStore().select<Row>("protocol_executions", { where: { id: executionId }, limit: 1 });
  if (!row) throw new ProtocolError("NOT_FOUND", "Execution not found");
  const [reviews, duties, attachments] = await Promise.all([reviewsByExecution([executionId]), dutiesOf(actor), listAttachments("execution", executionId)]);
  const list = reviews.get(executionId) ?? [];
  const status = executionReviewStatus(list.map(x => ({ toStatus: x.to_status })));
  const technicalReviewer = list.find(r => r.to_status === "reviewed");
  const qaDecision = list.find(r => r.from_status === "reviewed");
  let linkedRecord: { id: number; lifecycleStatus: string; resultStatus: string; approvedAt: string | null; createdAt: string } | null = null;
  if (row.validation_record_id) {
    try {
      const rec = await getValidationRecordById(Number(row.validation_record_id));
      if (rec) linkedRecord = { id: rec.id, lifecycleStatus: String(rec.lifecycleStatus), resultStatus: String(rec.resultStatus), approvedAt: rec.approvedAt ? new Date(rec.approvedAt).toISOString() : null, createdAt: new Date(rec.createdAt).toISOString() };
    } catch {
      linkedRecord = null;
    }
  }
  return {
    ...mapExecutionSummary(row),
    contentHash: String(row.content_hash),
    serialNumber: row.serial_number as string | null,
    stage: row.stage as string | null,
    measurements: row.measurements as Measurements,
    evaluation: row.evaluation as ReturnType<typeof evaluateExecution>,
    protocolSnapshot: row.protocol_snapshot as ProtocolContent,
    referenceSnapshot: row.reference_snapshot ?? null,
    comments: row.comments as string | null,
    deviations: (row.deviations as ExecutionDeviation[] | null) ?? [],
    reviewStatus: status,
    reviewStatusLabel: EXECUTION_REVIEW_STATUS_LABELS[status],
    reviews: list.map(mapExecutionReview),
    reviewerName: technicalReviewer?.actor_name ?? null,
    approverName: qaDecision?.to_status === "approved" ? qaDecision.actor_name : null,
    availableReviewActions: availableExecutionActions({ status, executedByUserId: Number(row.executed_by_user_id), technicalReviewerUserId: technicalReviewer?.actor_user_id ?? null, overallResult: String(row.overall_result) }, { id: actor.id, duties }),
    attachments,
    linkedRecord,
  };
}

export async function reviewExecution(actor: Actor, input: { executionId: string; action: ExecutionReviewAction; comment: string; password?: string }) {
  const duties = await dutiesOf(actor);
  const [row] = await protocolStore().select<Row>("protocol_executions", { where: { id: input.executionId }, columns: EXECUTION_SUMMARY_COLUMNS, limit: 1 });
  if (!row) throw new ProtocolError("NOT_FOUND", "Execution not found");
  const list = (await reviewsByExecution([input.executionId])).get(input.executionId) ?? [];
  const status = executionReviewStatus(list.map(x => ({ toStatus: x.to_status })));
  const technicalReviewer = list.find(r => r.to_status === "reviewed")?.actor_user_id ?? null;
  const ctx = { status, executedByUserId: Number(row.executed_by_user_id), technicalReviewerUserId: technicalReviewer, overallResult: String(row.overall_result) };
  const denial = executionReviewDenial(input.action, ctx, { id: actor.id, duties });
  if (denial) throw new ProtocolError(/requires the|Segregation/.test(denial) ? "FORBIDDEN" : "PRECONDITION_FAILED", denial);
  const comment = input.comment.trim();
  if (comment.length < 3) throw new ProtocolError("BAD_REQUEST", "A review comment / decision rationale is required");
  const step = executionReviewStep(input.action, status);
  const protocolId = String(row.protocol_id);
  await requireSignature(actor, duties, input.password, { protocolId, revisionId: String(row.revision_id), revisionNumber: Number(row.revision_number), entityType: "execution", entityId: input.executionId, meaning: step.signatureMeaning });
  const t = now();
  const reviewId = id();
  const label = `${row.protocol_number} rev ${row.revision_number} execution on ${row.equipment_id ?? row.instrument_key}`;
  const changes: Change[] = [
    { op: "insert", table: "protocol_execution_reviews", row: { id: reviewId, execution_id: input.executionId, protocol_id: protocolId, action: input.action, from_status: step.from, to_status: step.to, signature_meaning: step.signatureMeaning, reauthenticated: true, comment, actor_user_id: actor.id, actor_name: actor.name, actor_role: actorRole(actor, duties), created_at: t } },
    audit(actor, duties, { protocolId, revisionId: String(row.revision_id), revisionNumber: Number(row.revision_number), entityType: "execution", entityId: input.executionId, action: `execution.${input.action}`, previous: { reviewStatus: status }, next: { reviewStatus: step.to, calculatedResult: row.overall_result, signatureMeaning: step.signatureMeaning }, reason: comment }),
  ];
  if (step.to === "reviewed") changes.push(notify("execution-approval-required", "qa-approver", null, protocolId, String(row.revision_id), `${label}: technically reviewed — QA approval required`, `exec-reviewed:${input.executionId}`));
  else changes.push(notify(`execution-${step.to}`, null, Number(row.executed_by_user_id), protocolId, String(row.revision_id), `${label}: ${EXECUTION_REVIEW_STATUS_LABELS[step.to]} — ${comment.slice(0, 160)}`, `exec-${step.to}:${input.executionId}`));
  try {
    await protocolStore().apply(changes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|duplicate key|final decision|no longer in the recorded|requires a completed technical review/i.test(message))
      throw new ProtocolError("PRECONDITION_FAILED", "The execution was decided by another user in the meantime (duplicate decision prevented); reload and check its status");
    throw error;
  }
  return { reviewStatus: step.to };
}

/* ------------------------------------------------------------------ */
/* Controlled attachments                                               */
/* ------------------------------------------------------------------ */

const ATTACHMENT_LIST_COLUMNS = ["id", "entity_type", "entity_id", "protocol_id", "file_name", "mime_type", "size_bytes", "sha256", "description", "uploaded_by_user_id", "uploaded_by_name", "created_at"];
const mapAttachment = (r: Row) => ({ id: String(r.id), entityType: String(r.entity_type), entityId: String(r.entity_id), fileName: String(r.file_name), mimeType: String(r.mime_type), sizeBytes: Number(r.size_bytes), sha256: String(r.sha256), description: (r.description as string | null) ?? "", uploadedByName: (r.uploaded_by_name as string | null) ?? null, createdAt: String(r.created_at) });

export async function listAttachments(entityType: AttachmentEntityType, entityId: string) {
  const rows = await protocolStore().select<Row>("protocol_attachments", { where: { entity_type: entityType, entity_id: entityId }, columns: ATTACHMENT_LIST_COLUMNS, order: [{ column: "created_at" }] });
  return rows.map(mapAttachment);
}

export async function uploadAttachment(actor: Actor, input: { entityType: AttachmentEntityType; entityId: string; fileName: string; mimeType: string; contentBase64: string; description?: string }) {
  if (!ATTACHMENT_ENTITY_TYPES.includes(input.entityType)) throw new ProtocolError("BAD_REQUEST", "Unsupported attachment target");
  const fileName = input.fileName.trim().replace(/[\\/]+/g, "_").slice(0, 200);
  if (!fileName) throw new ProtocolError("BAD_REQUEST", "File name is required");
  const typeProblem = attachmentTypeProblem(fileName, input.mimeType);
  if (typeProblem) throw new ProtocolError("BAD_REQUEST", typeProblem);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) throw new ProtocolError("BAD_REQUEST", "File content is not valid base64");
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length) throw new ProtocolError("BAD_REQUEST", "The file is empty");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new ProtocolError("BAD_REQUEST", `The file exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`);
  let duties: ProtocolDuty[];
  let protocolId: string | null = null;
  let revisionId: string | null = null;
  let revisionNumber: number | null = null;
  if (input.entityType === "execution") {
    duties = await dutiesOf(actor);
    const [row] = await protocolStore().select<Row>("protocol_executions", { where: { id: input.entityId }, columns: EXECUTION_SUMMARY_COLUMNS, limit: 1 });
    if (!row) throw new ProtocolError("NOT_FOUND", "Execution not found");
    const status = executionReviewStatus(((await reviewsByExecution([input.entityId])).get(input.entityId) ?? []).map(x => ({ toStatus: x.to_status })));
    if (status === "approved" || status === "rejected") throw new ProtocolError("PRECONDITION_FAILED", "Evidence cannot be added after the final QA decision");
    const isExecutor = Number(row.executed_by_user_id) === actor.id;
    if (!isExecutor && !duties.some(d => d === "technical-reviewer" || d === "qa-approver"))
      throw new ProtocolError("FORBIDDEN", "Evidence is attached by the executor of the execution or by its reviewers");
    if (isExecutor && !duties.includes("executor")) throw new ProtocolError("FORBIDDEN", "The Executor duty is required");
    protocolId = String(row.protocol_id);
    revisionId = String(row.revision_id);
    revisionNumber = Number(row.revision_number);
  } else {
    duties = await requireDuty(actor, "author", "technical-reviewer", "qa-approver");
    const [ref] = await protocolStore().select<Row>("protocol_references", { where: { id: input.entityId }, columns: ["id"], limit: 1 });
    if (!ref) throw new ProtocolError("NOT_FOUND", "Reference not found");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const attachmentId = id();
  const description = (input.description ?? "").trim().slice(0, 1000);
  await protocolStore().apply([
    { op: "insert", table: "protocol_attachments", row: { id: attachmentId, entity_type: input.entityType, entity_id: input.entityId, protocol_id: protocolId, file_name: fileName, mime_type: input.mimeType, size_bytes: bytes.length, sha256, content_base64: bytes.toString("base64"), description, uploaded_by_user_id: actor.id, uploaded_by_name: actor.name, created_at: now() } },
    audit(actor, duties, { protocolId, revisionId, revisionNumber, entityType: "attachment", entityId: attachmentId, action: "attachment.uploaded", next: { target: `${input.entityType}:${input.entityId}`, fileName, mimeType: input.mimeType, sizeBytes: bytes.length, sha256, description } }),
  ]);
  return { id: attachmentId, sha256, sizeBytes: bytes.length };
}

export async function downloadAttachment(attachmentId: string) {
  const [row] = await protocolStore().select<Row>("protocol_attachments", { where: { id: attachmentId }, limit: 1 });
  if (!row) throw new ProtocolError("NOT_FOUND", "Attachment not found");
  const content = String(row.content_base64);
  const actual = createHash("sha256").update(Buffer.from(content, "base64")).digest("hex");
  return { ...mapAttachment(row), contentBase64: content, integrityOk: actual === String(row.sha256) };
}

/* ------------------------------------------------------------------ */
/* Interval / activity schedule (§13.2) and due alerts                  */
/* ------------------------------------------------------------------ */

export async function activitySchedule(filter: { instrumentKey?: string } = {}): Promise<ScheduleItem[]> {
  const protocols = (await protocolStore().select<ProtocolRow>("protocols", { order: [{ column: "protocol_number" }] })).filter(p => p.released_revision_id);
  if (!protocols.length) return [];
  const [registry, revisions, executions] = await Promise.all([
    equipmentRegistry(),
    protocolStore().select<RevisionRow>("protocol_revisions", { in: { column: "id", values: protocols.map(p => p.released_revision_id as string) } }),
    protocolStore().select<Row>("protocol_executions", { in: { column: "protocol_id", values: protocols.map(p => p.id) }, columns: ["id", "protocol_id", "instrument_key", "activity_key", "executed_at", "overall_result"] }),
  ]);
  const reviews = await reviewsByExecution(executions.map(e => String(e.id)));
  const inputs = protocols.flatMap(p => {
    const revision = revisions.find(r => r.id === p.released_revision_id && r.status === "released");
    if (!revision) return [];
    const content = revision.content;
    const equipment = registry.filter(e => {
      if (filter.instrumentKey && e.instrumentKey !== filter.instrumentKey) return false;
      const linked = content.equipmentLinks.some(l => l.instrumentKey === e.instrumentKey);
      if (content.identification.associationType === "equipment" && !linked) return false;
      return compatibilityProblems(content, e).length === 0;
    });
    if (!equipment.length) return [];
    return [{
      protocolId: p.id, protocolNumber: p.protocol_number, title: p.title, revisionId: revision.id, revisionNumber: revision.revision_number, effectiveDate: revision.effective_date,
      intervals: content.intervals.filter(i => i.activity !== "Periodic Review"),
      equipment: equipment.map(e => ({ instrumentKey: e.instrumentKey, instrumentId: e.instrumentId, name: e.name })),
      executions: executions.filter(e => e.protocol_id === p.id).map(e => ({ instrumentKey: String(e.instrument_key), activityKey: (e.activity_key as string | null) ?? null, executedAt: String(e.executed_at), overallResult: String(e.overall_result), rejected: executionReviewStatus((reviews.get(String(e.id)) ?? []).map(x => ({ toStatus: x.to_status }))) === "rejected" })),
    }];
  });
  return computeSchedule(inputs, today());
}

/**
 * Creates (deduplicated) alerts for overdue / due-soon interval activities and
 * protocol periodic reviews. Runs when the dashboard or notifications are
 * loaded (no background scheduler on serverless hosting). Never throws.
 */
export async function refreshDueNotifications() {
  try {
    const soon = new Date(Date.now() + DUE_SOON_DAYS * 86400000).toISOString().slice(0, 10);
    const t = today();
    const candidates: Change[] = [];
    const schedule = await activitySchedule();
    schedule.filter(i => i.state === "overdue" || i.state === "due-soon").forEach(i => {
      const what = `${i.protocolNumber}: ${i.activity} for ${i.equipmentId} (${i.equipmentName}) ${i.state === "overdue" ? `OVERDUE since ${i.nextDue}` : `due ${i.nextDue}`}${i.baseline === "effective-date" ? " — never performed under this protocol" : ""}`;
      candidates.push(notify(i.state === "overdue" ? "activity-overdue" : "activity-due-soon", "executor", null, i.protocolId, i.revisionId, what, `activity:${i.protocolId}:${i.instrumentKey}:${i.intervalKey}:${i.nextDue}:${i.state}`));
    });
    const released = await protocolStore().select<RevisionRow>("protocol_revisions", { where: { status: "released" }, columns: ["id", "protocol_id", "revision_number", "next_review_date"] });
    const due = released.filter(r => r.next_review_date && r.next_review_date <= soon);
    if (due.length) {
      const protocols = await protocolStore().select<ProtocolRow>("protocols", { in: { column: "id", values: due.map(r => r.protocol_id) }, columns: ["id", "protocol_number"] });
      due.forEach(r => {
        const overdue = (r.next_review_date as string) < t;
        const number = protocols.find(p => p.id === r.protocol_id)?.protocol_number ?? r.protocol_id;
        candidates.push(notify("protocol-review-due", "author", null, r.protocol_id, r.id, `${number} rev ${r.revision_number}: periodic review ${overdue ? "OVERDUE since" : "due"} ${r.next_review_date}`, `review-due:${r.id}:${r.next_review_date}:${overdue ? "overdue" : "due-soon"}`));
      });
    }
    if (!candidates.length) return 0;
    const keys = candidates.map(c => String((c as { row: Row }).row.dedupe_key));
    const existing = new Set((await protocolStore().select<Row>("protocol_notifications", { in: { column: "dedupe_key", values: keys }, columns: ["dedupe_key"] })).map(r => String(r.dedupe_key)));
    const missing = candidates.filter(c => !existing.has(String((c as { row: Row }).row.dedupe_key)));
    if (missing.length) await protocolStore().apply(missing);
    return missing.length;
  } catch (error) {
    console.warn("[protocols] due-notification refresh skipped:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Notifications, duties, templates, PDF log                            */
/* ------------------------------------------------------------------ */

export async function listNotifications(actor: Actor) {
  await refreshDueNotifications();
  const duties = await dutiesOf(actor);
  const [rows, reads] = await Promise.all([
    protocolStore().select<Row>("protocol_notifications", { order: [{ column: "created_at", desc: true }], limit: 200 }),
    protocolStore().select<Row>("protocol_notification_reads", { where: { user_id: actor.id }, columns: ["notification_id"] }),
  ]);
  const read = new Set(reads.map(r => String(r.notification_id)));
  return rows
    .filter(n => (n.recipient_user_id !== null && Number(n.recipient_user_id) === actor.id) || (n.recipient_duty !== null && duties.includes(n.recipient_duty as ProtocolDuty)))
    .map(n => ({ id: String(n.id), kind: String(n.kind), message: String(n.message), protocolId: (n.protocol_id as string | null) ?? null, revisionId: (n.revision_id as string | null) ?? null, createdAt: String(n.created_at), read: read.has(String(n.id)) }));
}

export async function markNotificationRead(actor: Actor, notificationId: string) {
  await protocolStore().apply([{ op: "insert-ignore", table: "protocol_notification_reads", row: { id: id(), notification_id: notificationId, user_id: actor.id, read_at: now() } }]);
  return { ok: true };
}

export async function listDutyAssignments() {
  const rows = await protocolStore().select<Row>("protocol_duty_assignments", { order: [{ column: "granted_at", desc: true }] });
  return rows.map(r => ({ id: String(r.id), userId: Number(r.user_id), duty: String(r.duty), grantedAt: String(r.granted_at), revokedAt: (r.revoked_at as string | null) ?? null }));
}

export async function setDuty(actor: Actor, input: { userId: number; duty: ProtocolDuty; granted: boolean; reason: string }) {
  const duties = await requireDuty(actor, "settings-admin");
  if (!GRANTABLE_DUTIES.includes(input.duty)) throw new ProtocolError("BAD_REQUEST", `Duty ${input.duty} is derived from the base role and cannot be granted individually`);
  const active = await protocolStore().select<Row>("protocol_duty_assignments", { where: { user_id: input.userId, duty: input.duty, revoked_at: null } });
  const t = now();
  if (input.granted) {
    if (active.length) return { ok: true };
    const assignmentId = id();
    await protocolStore().apply([
      { op: "insert", table: "protocol_duty_assignments", row: { id: assignmentId, user_id: input.userId, duty: input.duty, granted_by_user_id: actor.id, granted_at: t } },
      audit(actor, duties, { entityType: "duty-assignment", entityId: assignmentId, action: "duty.granted", next: { userId: input.userId, duty: input.duty }, reason: input.reason }),
    ]);
  } else {
    if (!active.length) return { ok: true };
    await protocolStore().apply([
      ...active.map(a => ({ op: "update" as const, table: "protocol_duty_assignments" as const, id: String(a.id), set: { revoked_at: t, revoked_by_user_id: actor.id }, expect: { revoked_at: null } })),
      audit(actor, duties, { entityType: "duty-assignment", entityId: String(active[0].id), action: "duty.revoked", previous: { userId: input.userId, duty: input.duty }, reason: input.reason }),
    ]);
  }
  return { ok: true };
}

export async function listTemplates() {
  const rows = await protocolStore().select<Row>("protocol_templates", { where: { is_active: true }, order: [{ column: "name" }] });
  return [
    ...BUILTIN_TEMPLATES.map(t => ({ id: t.id, name: t.name, templateCategory: t.templateCategory, protocolType: t.protocolType, description: t.description, builtin: true })),
    ...rows.map(r => ({ id: String(r.id), name: String(r.name), templateCategory: String(r.template_category), protocolType: String(r.protocol_type), description: String(r.description ?? ""), builtin: false })),
  ];
}

export async function saveTemplateFromRevision(actor: Actor, input: { revisionId: string; name: string; templateCategory: string; description: string }) {
  const duties = await requireDuty(actor, "author");
  const revision = await loadRevision(input.revisionId);
  const structure = stripToStructure(revision.content);
  const templateId = id();
  const t = now();
  await protocolStore().apply([
    { op: "insert", table: "protocol_templates", row: { id: templateId, name: input.name, template_category: input.templateCategory, protocol_type: revision.content.identification.protocolType, description: input.description, structure, is_active: true, source_revision_id: revision.id, created_by_user_id: actor.id, created_by_name: actor.name, created_at: t, updated_at: t, row_version: 1 } },
    audit(actor, duties, { protocolId: revision.protocol_id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "template", entityId: templateId, action: "template.created", next: { name: input.name, category: input.templateCategory, limitsStripped: true } }),
  ]);
  return { id: templateId };
}

export async function logPdfGenerated(actor: Actor, input: { revisionId: string; documentStatus: string }) {
  const duties = await dutiesOf(actor);
  const revision = await loadRevision(input.revisionId);
  await protocolStore().apply([
    audit(actor, duties, { protocolId: revision.protocol_id, revisionId: revision.id, revisionNumber: revision.revision_number, entityType: "document", entityId: revision.id, action: "pdf.generated", next: { documentStatus: input.documentStatus, status: revision.status, contentHash: revision.content_hash } }),
  ]);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Internals shared with the run / equipment / package services          */
/* ------------------------------------------------------------------ */

export const internals = { requireDuty, dutiesOf, audit, notify, id, now, loadProtocol, loadRevision, referenceLookup, actorRole, parseContentOrThrow, assertStructure, revisionDerived };
export type { ProtocolRow, RevisionRow };

/* ------------------------------------------------------------------ */
/* First configured protocol: POL-QC-032D (ADP220)                      */
/* ------------------------------------------------------------------ */

export async function configureAdp220Draft(actor: Actor) {
  const duties = await requireDuty(actor, "author");
  const existing = await protocolStore().select<ProtocolRow>("protocols", { where: { protocol_number: ADP220_PROTOCOL_NUMBER }, limit: 1 });
  if (existing[0]) return { protocolId: existing[0].id, revisionId: existing[0].current_revision_id, created: false, referencesCreated: [] as string[], equipment: null };
  const equipment = (await equipmentRegistry()).find(e => e.instrumentKey === ADP220_EXPECTED_EQUIPMENT.instrumentKey);
  const problems: string[] = [];
  if (!equipment) problems.push("Polarimeter equipment record not found in the Equipment Library");
  else {
    if (equipment.instrumentId !== ADP220_EXPECTED_EQUIPMENT.instrumentId) problems.push(`Equipment ID is ${equipment.instrumentId}, expected ${ADP220_EXPECTED_EQUIPMENT.instrumentId}`);
    if (equipment.serialNumber !== ADP220_EXPECTED_EQUIPMENT.serialNumber) problems.push(`Serial number is ${equipment.serialNumber}, expected ${ADP220_EXPECTED_EQUIPMENT.serialNumber}`);
    if (normalizeMaker(equipment.model) !== normalizeMaker(ADP220_EXPECTED_EQUIPMENT.model)) problems.push(`Model is ${equipment.model}, expected ${ADP220_EXPECTED_EQUIPMENT.model}`);
    if (!ADP220_EXPECTED_EQUIPMENT.manufacturerPattern.test(equipment.manufacturer)) problems.push(`Manufacturer is ${equipment.manufacturer}, expected Bellingham + Stanley`);
  }
  if (problems.length || !equipment)
    throw new ProtocolError("PRECONDITION_FAILED", "The registered equipment does not match the POL-QC-032D configuration; nothing was created and no duplicate equipment record was made", problems);
  const { rows: refs } = await referenceLookup();
  const map: Record<string, string> = {};
  const created: string[] = [];
  for (const seed of ADP220_REFERENCES) {
    const found = refs.find(r => r.code === seed.code);
    if (found) {
      map[seed.placeholder] = found.id;
      continue;
    }
    const res = await saveReference(actor, { code: seed.code, title: seed.title, issuer: seed.issuer, referenceType: seed.referenceType, documentNumber: seed.documentNumber, edition: seed.edition, revision: seed.revision, publicationDate: seed.publicationDate, effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: seed.sourceUrl, documentUrl: "", applicableSection: seed.applicableSection, applicableClause: "", verificationStatus: "pending-verification", notes: seed.notes, reason: "Initial reference framework for POL-QC-032D (verification pending)" });
    map[seed.placeholder] = res.id;
    created.push(seed.code);
  }
  const content = parseProtocolContent(remapReferencePlaceholders(adp220DraftContent(equipment), map));
  const result = await createProtocol(actor, { content, reason: "Initial configuration of POL-QC-032D with the generic Protocol Builder (first configured protocol). DRAFT — all criteria PENDING TECHNICAL VERIFICATION." });
  void duties;
  return { ...result, created: true, referencesCreated: created, equipment };
}
