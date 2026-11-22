/**
 * Automatic, idempotent registration of the HPLC protocol transcribed from the
 * user-supplied HPLC.pdf (shared/protocols/hplcLc2030.ts).
 *
 *  - equipment: the existing Equipment Master record "hplc" is reused (never duplicated or modified);
 *  - reference: HPLC.pdf is reused / created in the Reference Library as PENDING VERIFICATION;
 *  - protocol (update-or-create, stable number + stable test keys):
 *      none                        → created as Rev.01 DRAFT;
 *      already carries the seed    → nothing changes (user / QM edits are never overwritten);
 *      open draft without the seed → content replaced through saveDraft (audited diff);
 *      draft with an EARLIER seed  → upgraded to the current seed content (audited diff) only
 *                                    when nobody edited that draft after it was seeded; otherwise
 *                                    left unchanged and reported ("blocked") for manual review;
 *      approved with earlier seed  → a NEW draft revision carrying the current seed content;
 *      released / superseded only  → a NEW draft revision is created (approved revisions never change);
 *  - NEVER approved automatically: approval stays a Quality Manager action (password-signed).
 */
import { HPLC_EQUIPMENT_SPEC_SEED, HPLC_INSTRUMENT_KEY, HPLC_PREVIOUS_SEED_VERSIONS, HPLC_PROTOCOL_NUMBER, HPLC_REFERENCE_SEED, HPLC_SEED_VERSION, HPLC_TEST_KEYS, hplcEquipmentDescription, hplcProtocolContent } from "../../shared/protocols/hplcLc2030";
import type { SpecMap } from "../../shared/protocols/equipment";
import { EDITABLE_STATUSES } from "../../shared/protocols/model";
import { ProtocolError, createProtocol, createRevision, internals, protocolStore, saveDraft, saveReference, type Actor, type ProtocolRow, type RevisionRow } from "./service";
import { listEquipmentData, updateEquipmentData } from "./workflowService";

const { requireDuty, referenceLookup, loadRevision } = internals;

export const HPLC_UPGRADE_REASON = "HPLC protocol content updated to the current HPLC.pdf seed (user decisions: flow setpoints 1.0 / 1.5 / 2.0 mL/min per p.1; GPV ± 2.0 % relative to the setting value). Draft – Pending Quality Manager Approval; not approved automatically.";
const carries = (r: RevisionRow, markers: readonly string[]) => markers.some(m => String(r.content?.identification?.description ?? "").includes(m));

/** True when a human changed the draft content after it was registered by the seed. */
async function editedAfterSeed(revisionId: string): Promise<boolean> {
  const events = await protocolStore().select<{ action: string; reason: string | null }>("protocol_audit_events", { where: { revision_id: revisionId }, columns: ["action", "reason"] });
  return events.some(e => e.action === "revision.content-updated" && e.reason !== HPLC_SEED_REASON && e.reason !== HPLC_UPGRADE_REASON);
}

export const HPLC_SEED_REASON = "HPLC protocol registered automatically from the supplied laboratory calibration reference HPLC.pdf (10 tests, page references, review notes A–G). Draft – Pending Quality Manager Approval; not approved automatically.";

export type HplcSeedResult = {
  outcome: "created" | "updated-draft" | "new-revision" | "already-current" | "blocked";
  protocolId: string | null;
  protocolNumber: string;
  revisionId: string | null;
  revisionNumber: number | null;
  referenceId: string | null;
  referenceCreated: boolean;
  equipment: string | null;
  tests: number;
  equipmentSpecsFilled: string[];
  notes: string[];
};

/**
 * Fills EMPTY HPLC specification fields with the values documented in HPLC.pdf
 * (each with its page as source). Values already recorded are never overwritten;
 * historical results / dates of the 2022 record are not used.
 */
export async function seedHplcEquipmentSpecs(actor: Actor): Promise<string[]> {
  const status = await protocolStore().schemaStatus();
  if (!status.workflowOk) return [];
  const item = (await listEquipmentData()).find(e => e.instrumentKey === HPLC_INSTRUMENT_KEY);
  if (!item) return [];
  const specs: SpecMap = { ...(item.specs as SpecMap) };
  const filled: string[] = [];
  for (const [key, v] of Object.entries(HPLC_EQUIPMENT_SPEC_SEED)) {
    const cur = specs[key];
    if (cur && cur.value !== null && String(cur.value).trim() !== "") continue;
    specs[key] = { value: v.value, unit: v.unit, source: v.source };
    filled.push(key);
  }
  if (!filled.length) return [];
  await updateEquipmentData(actor, { instrumentKey: item.instrumentKey, expectedSpecsRowVersion: item.specsRowVersion, identity: item.identity, specs, equipmentType: item.equipmentType, reason: "HPLC specifications recorded from the laboratory calibration reference HPLC.pdf (empty fields only; existing values unchanged).", reference: "HPLC.pdf (RLS/QC/HPLC/02)" });
  return filled;
}

const CLOSED = ["released", "superseded", "retired", "rejected"];

async function ensureReference(actor: Actor) {
  const { rows } = await referenceLookup();
  const found = rows.find(r => r.code === HPLC_REFERENCE_SEED.code);
  if (found) return { id: found.id, created: false };
  const s = HPLC_REFERENCE_SEED;
  const res = await saveReference(actor, {
    code: s.code, title: s.title, issuer: s.issuer, referenceType: s.referenceType, documentNumber: s.documentNumber, edition: s.edition, revision: s.revision,
    publicationDate: s.publicationDate, effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: s.sourceUrl, documentUrl: "", applicableSection: s.applicableSection,
    applicableClause: "", verificationStatus: "pending-verification", notes: s.notes, reason: "HPLC.pdf registered as Laboratory Calibration Reference (verification pending — Quality Manager)",
  });
  return { id: res.id, created: true };
}

export async function seedHplcProtocol(actor: Actor): Promise<HplcSeedResult> {
  await requireDuty(actor, "author");
  const notes: string[] = [];
  const base = { protocolNumber: HPLC_PROTOCOL_NUMBER, tests: HPLC_TEST_KEYS.length };
  const equipment = (await listEquipmentData()).find(e => e.instrumentKey === HPLC_INSTRUMENT_KEY);
  if (!equipment) return { ...base, outcome: "blocked", protocolId: null, revisionId: null, revisionNumber: null, referenceId: null, referenceCreated: false, equipment: null, equipmentSpecsFilled: [], notes: ["The HPLC equipment record is not registered in the Equipment Master."] };
  const idn = equipment.identity;
  const eqText = `${idn.instrumentId} — ${idn.nameEn} (${idn.manufacturer} ${idn.model}, S/N ${idn.serialNumber})`;

  // Existing protocol: same number, otherwise any protocol already linked to the HPLC (one protocol per equipment).
  let [protocol] = await protocolStore().select<ProtocolRow>("protocols", { where: { protocol_number: HPLC_PROTOCOL_NUMBER }, limit: 1 });
  if (!protocol) {
    const { protocolsForEquipment } = await import("./validationService");
    protocol = (await protocolsForEquipment(HPLC_INSTRUMENT_KEY))[0];
  }
  const revisions = protocol ? await protocolStore().select<RevisionRow>("protocol_revisions", { where: { protocol_id: protocol.id }, order: [{ column: "revision_number", desc: true }] }) : [];
  const seeded = revisions.find(r => carries(r, [HPLC_SEED_VERSION]));
  const openRev = revisions.find(r => !CLOSED.includes(r.status));
  if (protocol && !seeded && openRev && carries(openRev, HPLC_PREVIOUS_SEED_VERSIONS) && (await editedAfterSeed(openRev.id))) {
    return { ...base, outcome: "blocked", protocolId: protocol.id, protocolNumber: protocol.protocol_number, revisionId: openRev.id, revisionNumber: openRev.revision_number, referenceId: null, referenceCreated: false, equipment: eqText, equipmentSpecsFilled: [], notes: [`Revision ${openRev.revision_number} carries an earlier HPLC.pdf seed and was edited by a user — it is NOT overwritten. Apply the updated flow / GPV criteria manually (see review notes A and C).`] };
  }
  if (protocol && seeded) {
    const current = revisions.find(r => !CLOSED.includes(r.status)) ?? revisions[0];
    return { ...base, outcome: "already-current", protocolId: protocol.id, protocolNumber: protocol.protocol_number, revisionId: current.id, revisionNumber: current.revision_number, referenceId: null, referenceCreated: false, equipment: eqText, equipmentSpecsFilled: [], notes: [`Revision ${seeded.revision_number} already carries the HPLC.pdf content — nothing changed (edits are never overwritten).`] };
  }

  const ref = await ensureReference(actor);
  const equipmentSpecsFilled = await seedHplcEquipmentSpecs(actor);
  if (equipmentSpecsFilled.length) {
    const refreshed = (await listEquipmentData()).find(e => e.instrumentKey === HPLC_INSTRUMENT_KEY);
    if (refreshed) equipment.specs = refreshed.specs;
    notes.push(`Equipment specifications recorded from HPLC.pdf: ${equipmentSpecsFilled.join(", ")}.`);
  }
  const content = hplcProtocolContent({
    referenceId: ref.id,
    equipment: { instrumentKey: equipment.instrumentKey, instrumentId: idn.instrumentId, serialNumber: idn.serialNumber, manufacturer: idn.manufacturer, model: idn.model, equipmentType: equipment.equipmentType, sopNumber: idn.sopNumber, formNumber: idn.formNumber },
    equipmentDescription: hplcEquipmentDescription({ identity: idn as unknown as Record<string, string>, specs: equipment.specs as Record<string, { value: number | string | null; unit: string }> }),
  });
  if (ref.created) notes.push(`Reference ${HPLC_REFERENCE_SEED.code} created (pending verification).`);

  if (!protocol) {
    const res = await createProtocol(actor, { content, reason: HPLC_SEED_REASON });
    return { ...base, outcome: "created", protocolId: res.protocolId, revisionId: res.revisionId, revisionNumber: 1, referenceId: ref.id, referenceCreated: ref.created, equipment: eqText, equipmentSpecsFilled, notes };
  }

  content.identification.number = protocol.protocol_number;
  const open = revisions.find(r => !CLOSED.includes(r.status));
  if (open && !EDITABLE_STATUSES.includes(open.status))
    throw new ProtocolError("PRECONDITION_FAILED", `Revision ${open.revision_number} of ${protocol.protocol_number} is ${open.status}; it must be returned or retired before the HPLC.pdf content can be registered.`);
  let target = open;
  let outcome: HplcSeedResult["outcome"] = "updated-draft";
  if (!target) {
    const rev = await createRevision(actor, { protocolId: protocol.id, reason: revisions.some(r => carries(r, HPLC_PREVIOUS_SEED_VERSIONS)) ? HPLC_UPGRADE_REASON : HPLC_SEED_REASON, description: "HPLC Calibration Protocol – Shimadzu LC 2030 PLUS (HPLC.pdf, 10 tests)" });
    target = await loadRevision(rev.revisionId);
    outcome = "new-revision";
    notes.push(`Earlier revision ${revisions[0]?.revision_number} (${revisions[0]?.status}) preserved unchanged.`);
  }
  const upgrading = revisions.some(r => carries(r, HPLC_PREVIOUS_SEED_VERSIONS));
  if (upgrading) notes.push("Earlier HPLC.pdf seed content upgraded (flow setpoints per p.1; GPV ± 2.0 % relative).");
  const saved = await saveDraft(actor, { revisionId: target.id, expectedRowVersion: target.row_version, content, reason: upgrading ? HPLC_UPGRADE_REASON : HPLC_SEED_REASON });
  notes.push(`${saved.changes} content change(s) recorded in the audit trail.`);
  return { ...base, outcome, protocolId: protocol.id, protocolNumber: protocol.protocol_number, revisionId: target.id, revisionNumber: target.revision_number, referenceId: ref.id, referenceCreated: ref.created, equipment: eqText, equipmentSpecsFilled, notes };
}

/** Called when the Protocol page loads: registers the HPLC protocol once (users with the author duty). Never throws. */
export async function ensureHplcProtocolRegistered(actor: Actor) {
  try {
    const [row] = await protocolStore().select<{ description: string | null }>("protocols", { where: { protocol_number: HPLC_PROTOCOL_NUMBER }, columns: ["description"], limit: 1 });
    if (row && String(row.description ?? "").includes(HPLC_SEED_VERSION)) return null;
    return await seedHplcProtocol(actor);
  } catch {
    return null;
  }
}
