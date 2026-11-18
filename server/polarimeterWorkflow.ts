import type { PolarimeterV2 } from "../shared/polarimeter";

export type ReviewDecision = "accepted" | "rejected";
export type PolarimeterReview = {
  id: number;
  validationRecordId: number;
  recordVersion: number;
  reviewerUserId: number;
  reviewerName: string | null;
  decision: ReviewDecision;
  comments: string;
  rejectionReason: string | null;
  outstandingIssues: string[];
  createdAt: Date;
};

export type PolarimeterFailureCase = {
  testKey: "accuracy" | "repeatability" | "linearity";
  actualResult: string;
  acceptanceLimit: string;
  protocolStatus: "approved" | "pending-verification";
};

export type PolarimeterDeviation = {
  id: number;
  validationRecordId: number;
  testKey: PolarimeterFailureCase["testKey"];
  actualResult: string;
  acceptanceLimit: string;
  protocolStatus: "approved" | "pending-verification";
  investigation: string;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  responsibleUserId: number | null;
  targetCompletionDate: string | null;
  status: "open" | "investigating" | "actions-planned" | "closed";
  version: number;
  createdByUserId: number;
  updatedByUserId: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

export function polarimeterFailureCases(resultData: Record<string, unknown>) {
  const data = resultData.polarimeterData as PolarimeterV2 | undefined;
  if (!data || data.schemaVersion !== 2) return [];
  const protocol = data.protocolSnapshot;
  const metrics = data.calculatedMetrics;
  const cases: PolarimeterFailureCase[] = [];
  if (data.testResults.accuracy === "fail")
    cases.push({
      testKey: "accuracy",
      actualResult: `${metrics.specificRotation} °`,
      acceptanceLimit: `${protocol.accuracy.lowerLimit} to ${protocol.accuracy.upperLimit} ° specific rotation`,
      protocolStatus: protocol.protocolStatus,
    });
  if (data.testResults.repeatability === "fail") {
    const method = protocol.repeatability.method;
    const actual =
      method === "maximum-range"
        ? `${metrics.repeatabilityRange} ° range`
        : method === "sample-standard-deviation"
          ? `${metrics.repeatabilitySampleStandardDeviation ?? "Not defined"} ° sample SD`
          : method === "rsd-percent"
            ? `${metrics.repeatabilityRsdPercent ?? "Not defined"} % RSD`
            : `${metrics.repeatabilityDeviations.join(", ")} ° absolute deviations`;
    const limit =
      method === "maximum-range"
        ? `≤ ${protocol.repeatability.tolerance} ° range`
        : method === "sample-standard-deviation"
          ? `≤ ${protocol.repeatability.tolerance} ° sample SD`
          : method === "rsd-percent"
            ? `≤ ${protocol.repeatability.tolerance} % RSD`
            : `each absolute deviation ≤ ${protocol.repeatability.tolerance} °`;
    cases.push({
      testKey: "repeatability",
      actualResult: actual,
      acceptanceLimit: limit,
      protocolStatus: protocol.protocolStatus,
    });
  }
  if (data.testResults.linearity === "fail") {
    const value =
      protocol.linearity.metric === "r2"
        ? metrics.coefficientOfDetermination
        : metrics.correlationCoefficient;
    cases.push({
      testKey: "linearity",
      actualResult: `${value ?? "Not defined"} ${protocol.linearity.metric === "r2" ? "R²" : "r"}`,
      acceptanceLimit: `≥ ${protocol.linearity.minimumMetric} ${protocol.linearity.metric === "r2" ? "R²" : "r"}`,
      protocolStatus: protocol.protocolStatus,
    });
  }
  return cases;
}

export function assertCanAcceptTechnicalReview(input: {
  resultStatus: "pass" | "fail";
  reviewerUserId: number;
  analystUserId: number;
  protocolStatus: "approved" | "pending-verification" | undefined;
  outstandingIssues: string[];
}) {
  if (input.reviewerUserId === input.analystUserId)
    throw new Error(
      "The analyst cannot perform the independent technical review"
    );
  if (input.resultStatus !== "pass")
    throw new Error(
      "Failed technical results cannot receive an accepted review"
    );
  if (input.protocolStatus !== "approved")
    throw new Error(
      "Technical acceptance is blocked until the Polarimeter protocol is verified"
    );
  if (input.outstandingIssues.length)
    throw new Error(
      "An accepted technical review cannot retain outstanding issues"
    );
}

export function assertCanApprovePolarimeter(input: {
  analystUserId: number;
  reviewerUserId: number;
  approverUserId: number;
}) {
  if (input.approverUserId === input.analystUserId)
    throw new Error("The analyst cannot approve their own Polarimeter record");
  if (input.approverUserId === input.reviewerUserId)
    throw new Error(
      "The technical reviewer and approver must be different users"
    );
}

export function validateDeviationClosure(input: {
  status: PolarimeterDeviation["status"];
  previousStatus: PolarimeterDeviation["status"];
  investigation: string;
  rootCause: string;
  correctiveAction: string;
  responsibleUserId: number | null;
  targetCompletionDate: string | null;
}) {
  const order: PolarimeterDeviation["status"][] = [
    "open",
    "investigating",
    "actions-planned",
    "closed",
  ];
  if (order.indexOf(input.status) < order.indexOf(input.previousStatus))
    throw new Error("Deviation status cannot move backwards");
  if (input.status === "closed") {
    if (input.previousStatus !== "actions-planned")
      throw new Error("Plan corrective actions before closing a deviation");
    if (
      !input.investigation.trim() ||
      !input.rootCause.trim() ||
      !input.correctiveAction.trim()
    )
      throw new Error(
        "Investigation, root cause, and corrective action are required for closure"
      );
    if (input.responsibleUserId === null || !input.targetCompletionDate)
      throw new Error(
        "A responsible person and target completion date are required for closure"
      );
  }
}
