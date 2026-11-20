/**
 * Dynamic calibration-run workflow.
 *
 * The workflow is NOT a fixed number of steps: it is derived from the protocol
 * revision — one step per configured test, framed by common steps:
 *   Equipment → Protocol → [one step per test …] → Results → Review → Approval → PDF
 * (e.g. HPLC CAL-QC-HPLC-001: 10 tests → 16 steps; Polarimeter CAL-QC-POL-001: 6 tests → 12 steps).
 */
import type { ExecutionEvaluation } from "./evaluate";
import type { ProtocolContent } from "./model";

export type RunStep = { key: string; kind: "frame" | "test"; label: string; labelAr: string; testKey?: string; sectionKey?: string; stage?: string };

export function buildRunSteps(content: ProtocolContent): RunStep[] {
  const tests: RunStep[] = content.sections.flatMap(s =>
    s.tests.map(t => ({ key: `test:${t.key}`, kind: "test" as const, label: t.name, labelAr: t.name, testKey: t.key, sectionKey: s.key, stage: t.stage || s.stage }))
  );
  return [
    { key: "equipment", kind: "frame", label: "Equipment", labelAr: "الجهاز" },
    { key: "protocol", kind: "frame", label: "Protocol", labelAr: "البروتوكول" },
    ...tests,
    { key: "results", kind: "frame", label: "Results", labelAr: "النتائج" },
    { key: "review", kind: "frame", label: "Review", labelAr: "المراجعة" },
    { key: "approval", kind: "frame", label: "Approval", labelAr: "الاعتماد" },
    { key: "pdf", kind: "frame", label: "PDF report", labelAr: "تقرير PDF" },
  ];
}

export type RunBlocker = { code: string; message: string; blocksRecording: boolean; blocksApproval: boolean };

/**
 * Conditions preventing formal recording / approval of a run. "Pending
 * verification" blocks approval (and a compliance conclusion) but never
 * blocks saving draft data.
 */
export function runApprovalBlockers(input: {
  revisionStatus: string;
  protocolChanged: boolean;
  evaluation: ExecutionEvaluation;
  content: ProtocolContent;
  equipmentRetired: boolean;
  identityChanged: boolean;
  compatibility: string[];
}): RunBlocker[] {
  const out: RunBlocker[] = [];
  const add = (code: string, message: string, blocksRecording: boolean, blocksApproval = true) => out.push({ code, message, blocksRecording, blocksApproval });
  if (input.revisionStatus !== "released")
    add("revision-not-released", `The protocol revision is ${input.revisionStatus.toUpperCase()} — only RELEASED revisions can be formally executed. This run is a draft / trial run and cannot be approved.`, true);
  if (input.protocolChanged) add("protocol-changed", "The protocol revision content changed after this run was created. The run keeps its own protocol snapshot; start a new run to use the current content.", true);
  if (input.equipmentRetired) add("equipment-retired", "The equipment has been retired.", true);
  if (input.identityChanged) add("equipment-identity-changed", "Equipment identity (ID / serial / manufacturer / model) changed after the run was created. The run keeps its snapshot; start a new run to use the new identity.", true);
  input.compatibility.forEach(p => add("compatibility", `Equipment compatibility: ${p}`, true));
  const pending = input.content.sections.flatMap(s => s.tests.flatMap(t => t.criteria)).filter(c => c.verificationStatus !== "verified").length;
  if (pending) add("pending-verification", `${pending} acceptance criteria are PENDING TECHNICAL VERIFICATION — no PASS/FAIL compliance conclusion and no approval are possible.`, false);
  if (input.evaluation.counts.INCOMPLETE) add("incomplete", `${input.evaluation.counts.INCOMPLETE} test(s) incomplete.`, false);
  if (input.evaluation.counts.FAIL) add("failures", `${input.evaluation.counts.FAIL} test(s) failed — a deviation must be recorded and investigated.`, false);
  return out;
}

/** Per-test difference between two measurement sets (used to resolve draft conflicts without silent overwrite). */
export function measurementConflicts(mine: Record<string, unknown>, theirs: Record<string, unknown>, base: Record<string, unknown>) {
  const keys = Array.from(new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])).sort();
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return keys
    .map(k => {
      const changedMine = !same(mine[k], base[k]);
      const changedTheirs = !same(theirs[k], base[k]);
      const kind: "none" | "mine" | "theirs" | "both-same" | "conflict" =
        !changedMine && !changedTheirs ? "none" : changedMine && !changedTheirs ? "mine" : !changedMine && changedTheirs ? "theirs" : same(mine[k], theirs[k]) ? "both-same" : "conflict";
      return { testKey: k, kind };
    })
    .filter(x => x.kind !== "none");
}

/** Automatic merge: take each side's non-conflicting changes; conflicts default to the server version until the user chooses. */
export function mergeMeasurements(mine: Record<string, unknown>, theirs: Record<string, unknown>, base: Record<string, unknown>, choices: Record<string, "mine" | "theirs"> = {}) {
  const out: Record<string, unknown> = { ...theirs };
  measurementConflicts(mine, theirs, base).forEach(({ testKey, kind }) => {
    if (kind === "mine" || (kind === "conflict" && choices[testKey] === "mine")) {
      if (mine[testKey] === undefined) delete out[testKey];
      else out[testKey] = mine[testKey];
    }
  });
  return out;
}
