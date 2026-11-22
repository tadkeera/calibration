/**
 * The nine equipment categories of the Protocol page, in the required display
 * order. Each card links to an EXISTING Equipment Master record by its
 * instrument key (no duplicate equipment records are created; existing
 * equipment codes are kept). `aliases` lets a card match an equipment record
 * registered under a different key with the same equipment type.
 */
export const PROTOCOL_EQUIPMENT_CARDS = [
  { cardKey: "disintegration", title: "Disintegration Tester", titleAr: "جهاز اختبار التفكك", instrumentKey: "disintegration", aliases: [] as string[] },
  { cardKey: "refractometer", title: "Refractometer", titleAr: "جهاز قياس معامل الانكسار", instrumentKey: "refractometer", aliases: [] as string[] },
  { cardKey: "dissolution", title: "Dissolution Tester", titleAr: "جهاز اختبار الذوبان", instrumentKey: "dissolution", aliases: [] as string[] },
  { cardKey: "hplc", title: "Shimadzu HPLC2 Pump", titleAr: "مضخة HPLC2 شيمادزو", instrumentKey: "hplc", aliases: [] as string[] },
  { cardKey: "spectrophotometer", title: "Spectrophotometer", titleAr: "جهاز المطياف الضوئي", instrumentKey: "spectrophotometer", aliases: ["uv-vis"] },
  { cardKey: "moisture", title: "Moisture Analyzer", titleAr: "جهاز تحليل الرطوبة", instrumentKey: "moisture", aliases: [] as string[] },
  { cardKey: "polarimeter", title: "Polarimeter", titleAr: "جهاز قياس الاستقطاب", instrumentKey: "polarimeter", aliases: [] as string[] },
  { cardKey: "viscometer", title: "Rotational Viscometer", titleAr: "مقياس اللزوجة الدوراني", instrumentKey: "viscometer", aliases: [] as string[] },
  { cardKey: "balance", title: "Analytical Balance", titleAr: "الميزان التحليلي", instrumentKey: "balance", aliases: ["analytical-balance"] },
] as const;

export type ProtocolEquipmentCard = (typeof PROTOCOL_EQUIPMENT_CARDS)[number];

/** Finds the equipment record of a card (by key, alias key or equipment type). */
export function matchCardEquipment<T extends { instrumentKey: string; equipmentType?: string; status?: string }>(card: ProtocolEquipmentCard, equipment: readonly T[]): T | null {
  const keys = [card.instrumentKey, ...card.aliases];
  return (
    equipment.find(e => e.instrumentKey === card.instrumentKey) ??
    equipment.find(e => keys.includes(e.instrumentKey)) ??
    equipment.find(e => e.status !== "retired" && !!e.equipmentType && keys.includes(e.equipmentType)) ??
    null
  );
}

/** User-facing revision status in the simplified workflow (Draft → Approved → Superseded). */
export function simpleRevisionStatus(status: string): { label: string; tone: "draft" | "approved" | "superseded" | "other" } {
  if (status === "released") return { label: "Approved (Active)", tone: "approved" };
  if (status === "superseded") return { label: "Superseded", tone: "superseded" };
  if (status === "draft") return { label: "Draft", tone: "draft" };
  if (status === "retired") return { label: "Retired", tone: "other" };
  if (status === "approved") return { label: "Approved (legacy, not active)", tone: "other" };
  return { label: `In legacy review (${status})`, tone: "other" };
}

export const NO_APPROVED_PROTOCOL = "No Approved Protocol Available for This Equipment";
