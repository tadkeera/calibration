/**
 * Protocol review / approval / release workflow rules.
 *
 * The application has three base roles (admin, user, viewer). Protocol duties
 * are mapped onto them; administrators may additionally grant protocol duties
 * to "user" accounts (e.g. QA approver). Viewers are always read-only.
 * These rules run on the backend; the UI only mirrors them.
 *
 * Simplified controlled workflow (2026-11): Draft → Approved (active) by a
 * Quality Manager in one signed step ("approve"). The earlier multi-stage
 * actions are retained only for historical revisions / backwards
 * compatibility and are not offered in the UI; every path that makes a
 * revision approved or active requires the quality-manager duty.
 */
import type { RevisionStatus } from "./model";

export const PROTOCOL_DUTIES = [
  { id: "author", label: "Authorized Protocol Editor", description: "Create revisions, edit draft revisions, tests, acceptance criteria, formulas and references" },
  { id: "quality-manager", label: "Quality Manager", description: "Approve draft revisions (the approved revision becomes the active protocol); includes editor permissions" },
  { id: "technical-reviewer", label: "Technical Specialist", description: "Technical review, gap decisions, request corrections" },
  { id: "qa-approver", label: "QA Reviewer / Approver", description: "Final QA review, approve, reject or return" },
  { id: "releaser", label: "Document Controller (Release)", description: "Controlled release and retirement of approved protocols" },
  { id: "executor", label: "Calibration / Validation Personnel", description: "Execute released protocols" },
  { id: "settings-admin", label: "Protocol Settings Administrator", description: "Manage duties and module settings" },
] as const;
export type ProtocolDuty = (typeof PROTOCOL_DUTIES)[number]["id"];
export const PROTOCOL_DUTY_IDS = PROTOCOL_DUTIES.map(d => d.id) as [ProtocolDuty, ...ProtocolDuty[]];

export type BaseRole = "admin" | "user" | "viewer";

/** Default duty mapping onto the existing application roles. */
export const DEFAULT_DUTIES: Record<BaseRole, readonly ProtocolDuty[]> = {
  admin: ["author", "quality-manager", "technical-reviewer", "qa-approver", "releaser", "executor", "settings-admin"],
  // Normal users: view approved protocols, execute validations (enter readings,
  // calculate, save, print). Protocol editing / approval must be granted.
  user: ["technical-reviewer", "executor"],
  viewer: [],
};
/** Duties that may be granted explicitly to a "user" account. */
export const GRANTABLE_DUTIES: readonly ProtocolDuty[] = ["author", "quality-manager", "qa-approver", "releaser"];

export function effectiveDuties(role: BaseRole, granted: readonly string[] = []): ProtocolDuty[] {
  if (role === "viewer") return [];
  const set = new Set<ProtocolDuty>(DEFAULT_DUTIES[role] ?? []);
  if (role === "user") granted.forEach(d => (GRANTABLE_DUTIES as readonly string[]).includes(d) && set.add(d as ProtocolDuty));
  // A Quality Manager may perform the authorized protocol management actions.
  if (set.has("quality-manager")) set.add("author");
  return PROTOCOL_DUTY_IDS.filter(d => set.has(d));
}

export const WORKFLOW_ACTIONS = [
  "submit-technical-review",
  "start-technical-review",
  "request-technical-changes",
  "complete-technical-review",
  "submit-qa-review",
  "start-qa-review",
  "request-qa-changes",
  "qa-approve",
  "qa-reject",
  "release",
  "retire",
  "approve",
] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export type TransitionRule = {
  action: WorkflowAction;
  label: string;
  from: readonly RevisionStatus[];
  to: RevisionStatus;
  duty: ProtocolDuty;
  commentRequired: boolean;
  /** Electronic signature meaning recorded in the immutable approval record. */
  signatureMeaning: string | null;
  notify: ProtocolDuty | "author";
};

export const TRANSITIONS: Record<WorkflowAction, TransitionRule> = {
  "submit-technical-review": { action: "submit-technical-review", label: "Submit for technical review", from: ["draft", "technical-changes-required", "qa-changes-required"], to: "technical-review-pending", duty: "author", commentRequired: false, signatureMeaning: "Prepared by (author submission)", notify: "technical-reviewer" },
  "start-technical-review": { action: "start-technical-review", label: "Start technical review", from: ["technical-review-pending"], to: "technical-review-in-progress", duty: "technical-reviewer", commentRequired: false, signatureMeaning: null, notify: "author" },
  "request-technical-changes": { action: "request-technical-changes", label: "Return for technical corrections", from: ["technical-review-in-progress"], to: "technical-changes-required", duty: "technical-reviewer", commentRequired: true, signatureMeaning: "Technical review — changes required", notify: "author" },
  "complete-technical-review": { action: "complete-technical-review", label: "Record technical review completion", from: ["technical-review-in-progress"], to: "technically-reviewed", duty: "technical-reviewer", commentRequired: true, signatureMeaning: "Technically reviewed by", notify: "author" },
  "submit-qa-review": { action: "submit-qa-review", label: "Submit to QA", from: ["technically-reviewed"], to: "qa-review-pending", duty: "author", commentRequired: false, signatureMeaning: null, notify: "qa-approver" },
  "start-qa-review": { action: "start-qa-review", label: "Start QA review", from: ["qa-review-pending"], to: "qa-review-in-progress", duty: "qa-approver", commentRequired: false, signatureMeaning: null, notify: "author" },
  "request-qa-changes": { action: "request-qa-changes", label: "Return for QA corrections", from: ["qa-review-in-progress"], to: "qa-changes-required", duty: "qa-approver", commentRequired: true, signatureMeaning: "QA review — changes required", notify: "author" },
  "qa-approve": { action: "qa-approve", label: "QA approve", from: ["qa-review-in-progress"], to: "approved", duty: "quality-manager", commentRequired: true, signatureMeaning: "Approved by Quality Assurance", notify: "releaser" },
  "qa-reject": { action: "qa-reject", label: "QA reject", from: ["qa-review-in-progress"], to: "rejected", duty: "qa-approver", commentRequired: true, signatureMeaning: "Rejected by Quality Assurance", notify: "author" },
  release: { action: "release", label: "Controlled release", from: ["approved"], to: "released", duty: "quality-manager", commentRequired: false, signatureMeaning: "Released for use (document control)", notify: "executor" },
  approve: { action: "approve", label: "Approve (Quality Manager)", from: ["draft"], to: "released", duty: "quality-manager", commentRequired: false, signatureMeaning: "Approved by Quality Manager — active protocol revision", notify: "executor" },
  retire: { action: "retire", label: "Retire protocol", from: ["released"], to: "retired", duty: "releaser", commentRequired: true, signatureMeaning: "Retired (document control)", notify: "author" },
};

export type RevisionActors = {
  status: RevisionStatus;
  authorUserId: number;
  technicalReviewerUserId: number | null;
  qaApproverUserId: number | null;
};

/**
 * Returns a reason the actor may NOT perform the action, or null if allowed.
 * Enforces state, duty and segregation of duties.
 */
export function transitionDenial(action: WorkflowAction, revision: RevisionActors, actor: { id: number; duties: readonly ProtocolDuty[] }): string | null {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(revision.status)) return `"${rule.label}" is not allowed while the revision is ${revision.status}`;
  if (!actor.duties.includes(rule.duty)) return `"${rule.label}" requires the ${rule.duty} duty`;
  switch (action) {
    case "start-technical-review":
      if (actor.id === revision.authorUserId) return "Segregation of duties: the author cannot technically review their own protocol revision";
      break;
    case "request-technical-changes":
    case "complete-technical-review":
      if (actor.id !== revision.technicalReviewerUserId) return "Only the technical specialist who started this review may conclude it";
      break;
    case "start-qa-review":
      if (actor.id === revision.authorUserId) return "Segregation of duties: the author cannot perform QA approval of their own revision";
      if (actor.id === revision.technicalReviewerUserId) return "Segregation of duties: the technical reviewer cannot also perform QA approval";
      break;
    case "request-qa-changes":
    case "qa-approve":
    case "qa-reject":
      if (actor.id !== revision.qaApproverUserId) return "Only the QA reviewer who started this QA review may conclude it";
      if (actor.id === revision.authorUserId || actor.id === revision.technicalReviewerUserId) return "Segregation of duties violation";
      break;
  }
  return null;
}

export function availableActions(revision: RevisionActors, actor: { id: number; duties: readonly ProtocolDuty[] }) {
  return (Object.keys(TRANSITIONS) as WorkflowAction[]).filter(a => transitionDenial(a, revision, actor) === null);
}
