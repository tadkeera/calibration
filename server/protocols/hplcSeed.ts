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
 *      released / superseded only  → a NEW draft revision is created (approved revisions never change);
 *  - NEVER approved automatically: approval stays a Quality Manager action (password-signed).
 */
import { HPLC_INSTRUMENT_KEY, HPLC_PROTOCOL_NUMBER, HPLC_REFERENCE_SEED, HPLC_SEED_VERSION, HPLC_TEST_KEYS, hplcEquipmentDescription, hplcProtocolContent } from "../../shared/protocols/hplcLc2030";
import { EDITABLE_STATUSES } from "../../shared/protocols/model";
import { ProtocolError, createProtocol, createRevision, internals, protocolStore, saveDraft, saveReference, type Actor, type ProtocolRow, type RevisionRow } from "./service";
import { listEquipmentData } from "./workflowService";

const { requireDuty, referenceLookup, loadRevision } = internals;

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
  notes: string[];
};

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
  if (!equipment) return { ...base, outcome: "blocked", protocolId: null, revisionId: null, revisionNumber: null, referenceId: null, referenceCreated: false, equipment: null, notes: ["The HPLC equipment record is not registered in the Equipment Master."] };
  const idn = equipment.identity;
  const eqText = `${idn.instrumentId} — ${idn.nameEn} (${idn.manufacturer} ${idn.model}, S/N ${idn.serialNumber})`;

  // Existing protocol: same number, otherwise any protocol already linked to the HPLC (one protocol per equipment).
  let [protocol] = await protocolStore().select<ProtocolRow>("protocols", { where: { protocol_number: HPLC_PROTOCOL_NUMBER }, limit: 1 });
  if (!protocol) {
    const { protocolsForEquipment } = await import("./validationService");
    protocol = (await protocolsForEquipment(HPLC_INSTRUMENT_KEY))[0];
  }
  const revisions = protocol ? await protocolStore().select<RevisionRow>("protocol_revisions", { where: { protocol_id: protocol.id }, order: [{ column: "revision_number", desc: true }] }) : [];
  const seeded = revisions.find(r => String(r.content?.identification?.description ?? "").includes(HPLC_SEED_VERSION));
  if (protocol && seeded) {
    const current = revisions.find(r => !CLOSED.includes(r.status)) ?? revisions[0];
    return { ...base, outcome: "already-current", protocolId: protocol.id, protocolNumber: protocol.protocol_number, revisionId: current.id, revisionNumber: current.revision_number, referenceId: null, referenceCreated: false, equipment: eqText, notes: [`Revision ${seeded.revision_number} already carries the HPLC.pdf content — nothing changed (edits are never overwritten).`] };
  }

  const ref = await ensureReference(actor);
  const content = hplcProtocolContent({
    referenceId: ref.id,
    equipment: { instrumentKey: equipment.instrumentKey, instrumentId: idn.instrumentId, serialNumber: idn.serialNumber, manufacturer: idn.manufacturer, model: idn.model, equipmentType: equipment.equipmentType, sopNumber: idn.sopNumber, formNumber: idn.formNumber },
    equipmentDescription: hplcEquipmentDescription({ identity: idn as unknown as Record<string, string>, specs: equipment.specs as Record<string, { value: number | string | null; unit: string }> }),
  });
  if (ref.created) notes.push(`Reference ${HPLC_REFERENCE_SEED.code} created (pending verification).`);

  if (!protocol) {
    const res = await createProtocol(actor, { content, reason: HPLC_SEED_REASON });
    return { ...base, outcome: "created", protocolId: res.protocolId, revisionId: res.revisionId, revisionNumber: 1, referenceId: ref.id, referenceCreated: ref.created, equipment: eqText, notes };
  }

  content.identification.number = protocol.protocol_number;
  const open = revisions.find(r => !CLOSED.includes(r.status));
  if (open && !EDITABLE_STATUSES.includes(open.status))
    throw new ProtocolError("PRECONDITION_FAILED", `Revision ${open.revision_number} of ${protocol.protocol_number} is ${open.status}; it must be returned or retired before the HPLC.pdf content can be registered.`);
  let target = open;
  let outcome: HplcSeedResult["outcome"] = "updated-draft";
  if (!target) {
    const rev = await createRevision(actor, { protocolId: protocol.id, reason: HPLC_SEED_REASON, description: "HPLC Calibration Protocol – Shimadzu LC 2030 PLUS (HPLC.pdf, 10 tests)" });
    target = await loadRevision(rev.revisionId);
    outcome = "new-revision";
    notes.push(`Earlier revision ${revisions[0]?.revision_number} (${revisions[0]?.status}) preserved unchanged.`);
  }
  const saved = await saveDraft(actor, { revisionId: target.id, expectedRowVersion: target.row_version, content, reason: HPLC_SEED_REASON });
  notes.push(`${saved.changes} content change(s) recorded in the audit trail.`);
  return { ...base, outcome, protocolId: protocol.id, protocolNumber: protocol.protocol_number, revisionId: target.id, revisionNumber: target.revision_number, referenceId: ref.id, referenceCreated: ref.created, equipment: eqText, notes };
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
