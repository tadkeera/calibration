/**
 * Interval / activity scheduling (§13.2): due-date calculation and upcoming /
 * overdue alerts per equipment, derived only from RELEASED protocol revisions
 * (approved intervals) and recorded executions. Nothing here changes an
 * approved interval.
 *
 * Rules
 *  - Only time-based intervals (days/weeks/months/years) produce a due date.
 *    Event-based intervals are listed as "event-based" without a date.
 *  - The baseline is the latest execution of that activity for that equipment
 *    whose calculated result is PASS and which has not been rejected in the
 *    execution review. FAIL, INCOMPLETE, UNDER REVIEW and rejected executions
 *    never reset the due date.
 *  - Without such an execution, the baseline is the revision effective date
 *    (flagged "never performed under this protocol").
 */
import { addInterval, type ProtocolInterval } from "./model";

export const DUE_SOON_DAYS = 30;

export type ScheduleState = "overdue" | "due-soon" | "scheduled" | "event-based";

export type ScheduleExecution = {
  instrumentKey: string;
  activityKey: string | null;
  executedAt: string;
  overallResult: string;
  rejected: boolean;
};

export type ScheduleProtocolInput = {
  protocolId: string;
  protocolNumber: string;
  title: string;
  revisionId: string;
  revisionNumber: number;
  effectiveDate: string | null;
  intervals: ProtocolInterval[];
  equipment: Array<{ instrumentKey: string; instrumentId: string; name: string }>;
  executions: ScheduleExecution[];
};

export type ScheduleItem = {
  protocolId: string;
  protocolNumber: string;
  title: string;
  revisionId: string;
  revisionNumber: number;
  instrumentKey: string;
  equipmentId: string;
  equipmentName: string;
  intervalKey: string;
  activity: string;
  intervalText: string;
  mandatory: boolean;
  sourceClass: string;
  department: string;
  baseline: "last-pass-execution" | "effective-date" | "none";
  lastPerformedAt: string | null;
  nextDue: string | null;
  daysRemaining: number | null;
  state: ScheduleState;
};

const day = (iso: string) => iso.slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function intervalText(i: Pick<ProtocolInterval, "value" | "unit" | "event">) {
  if (i.unit === "event") return `Event-based${i.event ? `: ${i.event}` : ""}`;
  return i.value ? `Every ${i.value} ${i.unit}` : "Not defined";
}

export function computeSchedule(inputs: ScheduleProtocolInput[], today: string, dueSoonDays = DUE_SOON_DAYS): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  for (const p of inputs) {
    for (const eq of p.equipment) {
      for (const interval of p.intervals) {
        if (interval.unit !== "event" && !interval.value) continue;
        const qualifying = p.executions
          .filter(e => e.instrumentKey === eq.instrumentKey && e.activityKey === interval.key && e.overallResult === "PASS" && !e.rejected)
          .sort((a, b) => b.executedAt.localeCompare(a.executedAt))[0];
        const base: Omit<ScheduleItem, "baseline" | "lastPerformedAt" | "nextDue" | "daysRemaining" | "state"> = {
          protocolId: p.protocolId, protocolNumber: p.protocolNumber, title: p.title, revisionId: p.revisionId, revisionNumber: p.revisionNumber,
          instrumentKey: eq.instrumentKey, equipmentId: eq.instrumentId, equipmentName: eq.name, intervalKey: interval.key, activity: interval.activity,
          intervalText: intervalText(interval), mandatory: interval.mandatory, sourceClass: interval.sourceClass, department: interval.department,
        };
        const lastPerformedAt = qualifying ? qualifying.executedAt : null;
        if (interval.unit === "event") {
          items.push({ ...base, baseline: qualifying ? "last-pass-execution" : "none", lastPerformedAt, nextDue: null, daysRemaining: null, state: "event-based" });
          continue;
        }
        const baselineDate = qualifying ? day(qualifying.executedAt) : p.effectiveDate ? day(p.effectiveDate) : null;
        if (!baselineDate) {
          items.push({ ...base, baseline: "none", lastPerformedAt, nextDue: null, daysRemaining: null, state: "scheduled" });
          continue;
        }
        const due = addInterval(new Date(`${baselineDate}T00:00:00Z`), interval.value as number, interval.unit);
        const nextDue = due ? due.toISOString().slice(0, 10) : null;
        const daysRemaining = nextDue ? daysBetween(today, nextDue) : null;
        const state: ScheduleState = daysRemaining === null ? "scheduled" : daysRemaining < 0 ? "overdue" : daysRemaining <= dueSoonDays ? "due-soon" : "scheduled";
        items.push({ ...base, baseline: qualifying ? "last-pass-execution" : "effective-date", lastPerformedAt, nextDue, daysRemaining, state });
      }
    }
  }
  const rank: Record<ScheduleState, number> = { overdue: 0, "due-soon": 1, scheduled: 2, "event-based": 3 };
  return items.sort((a, b) => rank[a.state] - rank[b.state] || (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") || a.protocolNumber.localeCompare(b.protocolNumber));
}
