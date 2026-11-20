/**
 * Execution review & approval (§16.4–16.5). A calculated PASS is never an
 * approval: every recorded execution is technically reviewed and then
 * approved (or rejected) by QA, each step with an electronic signature.
 * Segregation of duties: executor ≠ technical reviewer ≠ QA approver.
 * Enforced on the backend (service) and in the database (sequence trigger,
 * one decision per state); the UI only mirrors these rules.
 */
import type { ProtocolDuty } from "./workflow";

export const EXECUTION_REVIEW_STATUSES = ["recorded", "reviewed", "approved", "rejected"] as const;
export type ExecutionReviewStatus = (typeof EXECUTION_REVIEW_STATUSES)[number];

export const EXECUTION_REVIEW_STATUS_LABELS: Record<ExecutionReviewStatus, string> = {
  recorded: "Recorded – awaiting technical review",
  reviewed: "Technically reviewed – awaiting QA approval",
  approved: "Approved by QA",
  rejected: "Rejected",
};

export const EXECUTION_REVIEW_ACTIONS = ["review", "approve", "reject"] as const;
export type ExecutionReviewAction = (typeof EXECUTION_REVIEW_ACTIONS)[number];

export type ExecutionReviewRow = { action: string; fromStatus: string; toStatus: string; actorUserId: number };

/** Current status = target status of the latest decision (decisions are append-only and sequential). */
export function executionReviewStatus(reviews: ReadonlyArray<Pick<ExecutionReviewRow, "toStatus">>): ExecutionReviewStatus {
  const last = reviews[reviews.length - 1];
  return (last?.toStatus as ExecutionReviewStatus | undefined) ?? "recorded";
}

export type ExecutionReviewContext = {
  status: ExecutionReviewStatus;
  executedByUserId: number;
  technicalReviewerUserId: number | null;
  overallResult: string;
};

export function executionReviewStep(action: ExecutionReviewAction, status: ExecutionReviewStatus) {
  if (action === "review") return { from: "recorded" as const, to: "reviewed" as const, duty: "technical-reviewer" as ProtocolDuty, signatureMeaning: "Execution technically reviewed by" };
  if (action === "approve") return { from: "reviewed" as const, to: "approved" as const, duty: "qa-approver" as ProtocolDuty, signatureMeaning: "Execution approved by Quality Assurance" };
  return status === "reviewed"
    ? { from: "reviewed" as const, to: "rejected" as const, duty: "qa-approver" as ProtocolDuty, signatureMeaning: "Execution rejected by Quality Assurance" }
    : { from: "recorded" as const, to: "rejected" as const, duty: "technical-reviewer" as ProtocolDuty, signatureMeaning: "Execution rejected at technical review" };
}

/** Reason the actor may not take the action, or null when allowed. */
export function executionReviewDenial(action: ExecutionReviewAction, ctx: ExecutionReviewContext, actor: { id: number; duties: readonly ProtocolDuty[] }): string | null {
  if (ctx.status === "approved" || ctx.status === "rejected") return `The execution already has a final decision (${EXECUTION_REVIEW_STATUS_LABELS[ctx.status]})`;
  const step = executionReviewStep(action, ctx.status);
  if (step.from !== ctx.status) return `"${action}" is not allowed while the execution is ${EXECUTION_REVIEW_STATUS_LABELS[ctx.status]}`;
  if (!actor.duties.includes(step.duty)) return `This decision requires the ${step.duty} duty`;
  if (actor.id === ctx.executedByUserId) return "Segregation of duties: the executor cannot review or approve their own execution";
  if (step.from === "reviewed" && actor.id === ctx.technicalReviewerUserId) return "Segregation of duties: the technical reviewer cannot also give the QA decision";
  if (action === "approve" && ctx.overallResult === "INCOMPLETE") return "An INCOMPLETE execution cannot be approved; reject it and record a new execution";
  return null;
}

export function availableExecutionActions(ctx: ExecutionReviewContext, actor: { id: number; duties: readonly ProtocolDuty[] }) {
  return EXECUTION_REVIEW_ACTIONS.filter(a => executionReviewDenial(a, ctx, actor) === null);
}

/** Deviation recorded during an execution (§16.3). Stored with the execution, never edited. */
export type ExecutionDeviation = { description: string; impact: string; immediateAction: string; reference: string };
