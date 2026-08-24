/** Server-side validation helpers: keep audit summaries deterministic and free of client-supplied prose. */
export function createRecordSummary(instrumentId: string, resultStatus: "pass" | "fail") {
  return `Created validation record for ${instrumentId} with ${resultStatus.toUpperCase()} result.`;
}

export function updateRecordSummary(instrumentId: string, resultStatus: "pass" | "fail") {
  return `Updated draft validation record for ${instrumentId}; result is ${resultStatus.toUpperCase()}.`;
}

export function decisionSummary(instrumentId: string, decision: "approved" | "rejected") {
  return `${decision === "approved" ? "Approved" : "Rejected"} validation record for ${instrumentId}.`;
}

export function exportRecordSummary(instrumentId: string) {
  return `Generated official PDF report for ${instrumentId}.`;
}
