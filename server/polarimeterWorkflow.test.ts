import { describe, expect, it } from "vitest";
import {
  assertCanAcceptTechnicalReview,
  assertCanApprovePolarimeter,
  validateDeviationClosure,
} from "./polarimeterWorkflow";

describe("Polarimeter workflow separation and closure rules", () => {
  it("allows accepted review only for a verified, passing, issue-free record by a different user", () => {
    const valid = {
      resultStatus: "pass" as const,
      reviewerUserId: 7,
      analystUserId: 5,
      protocolStatus: "approved" as const,
      outstandingIssues: [],
    };
    expect(() => assertCanAcceptTechnicalReview(valid)).not.toThrow();
    expect(() =>
      assertCanAcceptTechnicalReview({
        ...valid,
        protocolStatus: "pending-verification",
      })
    ).toThrow("protocol is verified");
    expect(() =>
      assertCanAcceptTechnicalReview({ ...valid, resultStatus: "fail" })
    ).toThrow("Failed technical results");
    expect(() =>
      assertCanAcceptTechnicalReview({
        ...valid,
        reviewerUserId: valid.analystUserId,
      })
    ).toThrow("analyst cannot perform");
    expect(() =>
      assertCanAcceptTechnicalReview({
        ...valid,
        outstandingIssues: ["Resolve fixture"],
      })
    ).toThrow("outstanding issues");
  });

  it("requires the approver to be distinct from both analyst and reviewer", () => {
    const valid = {
      analystUserId: 5,
      reviewerUserId: 7,
      approverUserId: 8,
    };
    expect(() => assertCanApprovePolarimeter(valid)).not.toThrow();
    expect(() =>
      assertCanApprovePolarimeter({
        ...valid,
        approverUserId: valid.analystUserId,
      })
    ).toThrow("analyst cannot approve");
    expect(() =>
      assertCanApprovePolarimeter({
        ...valid,
        approverUserId: valid.reviewerUserId,
      })
    ).toThrow("reviewer and approver");
  });

  it("requires a planned, complete CAPA before closure and disallows backwards status", () => {
    const closure = {
      status: "closed" as const,
      previousStatus: "actions-planned" as const,
      investigation: "Synthetic investigation",
      rootCause: "Synthetic cause",
      correctiveAction: "Synthetic action",
      responsibleUserId: 12,
      targetCompletionDate: "2026-12-15",
    };
    expect(() => validateDeviationClosure(closure)).not.toThrow();
    expect(() =>
      validateDeviationClosure({ ...closure, previousStatus: "investigating" })
    ).toThrow("Plan corrective actions");
    expect(() =>
      validateDeviationClosure({ ...closure, correctiveAction: " " })
    ).toThrow("corrective action");
    expect(() =>
      validateDeviationClosure({
        ...closure,
        status: "investigating",
        previousStatus: "actions-planned",
      })
    ).toThrow("cannot move backwards");
  });
});
