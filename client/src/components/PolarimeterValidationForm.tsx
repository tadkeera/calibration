import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  FileText,
  FlaskConical,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import type {
  PolarimeterEvaluation,
  PolarimeterProtocolSnapshot,
  PolarimeterV2,
} from "@shared/polarimeter";
import {
  createPolarimeterProtocolSnapshot,
  evaluatePolarimeterInputs,
  parseMeasurement,
  toPolarimeterCalculatedMetrics,
} from "@shared/polarimeter";
import type { CalibrationResult, Device, ResultRow } from "@/lib/qc";
import { trpc } from "@/lib/trpc";

type Language = "ar" | "en";
type Inputs = {
  accuracy: Omit<
    PolarimeterV2["accuracy"],
    "opticalRotation" | "concentrationGPer100Ml" | "temperatureC"
  > & {
    opticalRotation: string;
    concentrationGPer100Ml: string;
    temperatureC: string;
  };
  repeatability: Omit<PolarimeterV2["repeatability"], "sampleConcentration"> & {
    sampleConcentration: string;
  };
  linearity: Omit<PolarimeterV2["linearity"], "points"> & {
    points: Array<
      Omit<
        PolarimeterV2["linearity"]["points"][number],
        "actualConcentration" | "measuredOpticalRotation"
      > & {
        actualConcentration: string;
        measuredOpticalRotation: string;
      }
    >;
  };
};
type Step = {
  title: string;
  shortTitle: string;
  icon: typeof FlaskConical;
};

type LocalDraft = {
  protocolVersion: string;
  step: number;
  inputs: Inputs;
  savedAt: string;
};

function isLocalDraft(value: unknown): value is LocalDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  const inputs = draft.inputs as Record<string, unknown> | undefined;
  const accuracy = inputs?.accuracy as Record<string, unknown> | undefined;
  const repeatability = inputs?.repeatability as
    | Record<string, unknown>
    | undefined;
  const linearity = inputs?.linearity as Record<string, unknown> | undefined;
  const stringFields = (
    source: Record<string, unknown> | undefined,
    keys: string[]
  ) => Boolean(source) && keys.every(key => typeof source?.[key] === "string");
  const points = linearity?.points;
  return (
    typeof draft.protocolVersion === "string" &&
    Number.isInteger(draft.step) &&
    typeof draft.savedAt === "string" &&
    stringFields(accuracy, [
      "opticalRotation",
      "concentrationGPer100Ml",
      "tubeLengthDm",
      "temperatureC",
      "wavelengthLabel",
      "measurementDateTime",
      "referenceStandardId",
      "referenceStandardExpiryDate",
      "referenceStandardCertificateNumber",
      "analystNotes",
    ]) &&
    typeof accuracy?.wavelengthNm === "number" &&
    Number.isFinite(accuracy.wavelengthNm) &&
    stringFields(repeatability, [
      "sampleId",
      "sampleConcentration",
      "measurementConditions",
      "analystNotes",
    ]) &&
    repeatability?.concentrationUnit === "g/100ml" &&
    Array.isArray(repeatability?.readings) &&
    repeatability.readings.every(reading => typeof reading === "string") &&
    stringFields(linearity, ["measurementConditions", "analystNotes"]) &&
    Array.isArray(points) &&
    points.every(
      point =>
        Boolean(point) &&
        typeof point === "object" &&
        Number.isInteger((point as Record<string, unknown>).pointNumber) &&
        typeof (point as Record<string, unknown>).nominalConcentration ===
          "number" &&
        typeof (point as Record<string, unknown>).actualConcentration ===
          "string" &&
        typeof (point as Record<string, unknown>).measuredOpticalRotation ===
          "string" &&
        typeof (point as Record<string, unknown>).notes === "string"
    )
  );
}

const STEPS: Step[] = [
  { title: "Equipment Selection", shortTitle: "Equipment", icon: FlaskConical },
  {
    title: "Validation Protocol",
    shortTitle: "Protocol",
    icon: ClipboardCheck,
  },
  { title: "Accuracy Test", shortTitle: "Accuracy", icon: RotateCcw },
  { title: "Repeatability Test", shortTitle: "Repeatability", icon: Activity },
  { title: "Linearity Test", shortTitle: "Linearity", icon: Activity },
  { title: "Results Review", shortTitle: "Results", icon: Check },
  { title: "Technical Review", shortTitle: "Review", icon: ShieldCheck },
  { title: "Approval", shortTitle: "Approval", icon: ShieldCheck },
  { title: "PDF Report", shortTitle: "PDF", icon: FileText },
];

const numericInput = (value: string) =>
  value.trim() === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;
const format = (value: number | null | undefined, precision = 4) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "Not defined"
    : value.toFixed(precision);

function makeEmptyInputs(protocol: PolarimeterProtocolSnapshot): Inputs {
  return {
    accuracy: {
      opticalRotation: "",
      concentrationGPer100Ml: "",
      tubeLengthDm: String(protocol.conditions.tubeLengthDm),
      temperatureC: "",
      wavelengthLabel: protocol.conditions.wavelengthLabel,
      wavelengthNm: protocol.conditions.wavelengthNm,
      measurementDateTime: "",
      referenceStandardId: "",
      referenceStandardExpiryDate: "",
      referenceStandardCertificateNumber: "",
      analystNotes: "",
    },
    repeatability: {
      sampleId: "",
      sampleConcentration: "",
      concentrationUnit: "g/100ml",
      readings: Array.from(
        { length: protocol.repeatability.requiredReadings },
        () => ""
      ),
      measurementConditions: "",
      analystNotes: "",
    },
    linearity: {
      points: protocol.linearity.nominalConcentrations.map(
        (concentration, index) => ({
          pointNumber: index + 1,
          nominalConcentration: concentration,
          actualConcentration: "",
          measuredOpticalRotation: "",
          notes: "",
        })
      ),
      measurementConditions: "",
      analystNotes: "",
    },
  };
}

function equipmentSnapshot(
  device: Device,
  protocol: PolarimeterProtocolSnapshot
) {
  return {
    instrumentKey: "polarimeter" as const,
    instrumentName: device.english,
    equipmentId: device.id,
    manufacturer: device.manufacturer,
    model: device.model,
    serialNumber: device.serial,
    sopNumber: protocol.sopNumber,
    formNumber: protocol.formNumber,
    department: null,
    location: null,
    status: null,
  };
}

function resultRows(
  data: Inputs,
  protocol: PolarimeterProtocolSnapshot,
  evaluation: PolarimeterEvaluation
): ResultRow[] {
  const accuracyStatus = evaluation.testResults.accuracy === "pass";
  const repeatStatistics = evaluation.metrics.repeatability;
  const regression = evaluation.metrics.regression;
  const selectedMetric =
    protocol.linearity.metric === "r2" ? regression?.r2 : regression?.r;
  const perReadingMethods = new Set([
    "first-reading-deviation",
    "reference-value-deviation",
    "mean-deviation",
  ]);
  const repeatRows = perReadingMethods.has(protocol.repeatability.method)
    ? data.repeatability.readings.map((reading, index) => ({
        test: `Repeatability reading ${index + 1}`,
        expected: repeatExpected(protocol),
        actual: `${reading || "Not recorded"} °`,
        pass: repeatStatistics?.individualPasses[index] ?? false,
      }))
    : [];
  return [
    {
      test: "Accuracy — specific optical rotation",
      expected: `${protocol.accuracy.lowerLimit} to ${protocol.accuracy.upperLimit} °`,
      actual: `${format(evaluation.metrics.specificRotation, protocol.accuracy.displayPrecision)} °`,
      pass: accuracyStatus,
    },
    ...repeatRows,
    {
      test: "Repeatability — overall result",
      expected: repeatExpected(protocol),
      actual: repeatStatistics
        ? `Mean ${format(repeatStatistics.mean, 6)} °; range ${format(repeatStatistics.range, 6)} °; sample SD ${format(repeatStatistics.sampleStandardDeviation, 6)} °; RSD ${repeatStatistics.rsdPercent === null ? "Not defined" : `${format(repeatStatistics.rsdPercent, 4)}%`}`
        : "Not defined",
      pass: evaluation.testResults.repeatability === "pass",
    },
    {
      test: `Linearity — ${protocol.linearity.metric === "r2" ? "R²" : "correlation coefficient r"}`,
      expected: `${protocol.linearity.metric === "r2" ? "R²" : "r"} ≥ ${protocol.linearity.minimumMetric}`,
      actual: format(selectedMetric, protocol.linearity.displayPrecision),
      pass: evaluation.testResults.linearity === "pass",
    },
  ];
}

function repeatExpected(protocol: PolarimeterProtocolSnapshot) {
  const labels: Record<string, string> = {
    "first-reading-deviation": "absolute deviation from first reading",
    "reference-value-deviation":
      "absolute deviation from protocol reference value",
    "mean-deviation": "absolute deviation from the mean",
    "maximum-range": "maximum permitted range",
    "sample-standard-deviation": "sample standard deviation",
    "rsd-percent": "relative standard deviation",
  };
  const unit = protocol.repeatability.unit === "%" ? "%" : "°";
  return `${labels[protocol.repeatability.method]} ≤ ${protocol.repeatability.tolerance} ${unit}`;
}

function makeResult(
  data: Inputs,
  device: Device,
  protocol: PolarimeterProtocolSnapshot,
  evaluation: PolarimeterEvaluation,
  config: Record<string, unknown>
): CalibrationResult {
  if (
    evaluation.overallPass === null ||
    !evaluation.metrics.repeatability ||
    !evaluation.metrics.regression
  )
    throw new Error(
      "Complete all required Polarimeter fields before calculating results."
    );
  const calculatedMetrics = toPolarimeterCalculatedMetrics(evaluation);
  const accuracy = evaluation.testResults.accuracy;
  const repeatability = evaluation.testResults.repeatability;
  const linearity = evaluation.testResults.linearity;
  if (!accuracy || !repeatability || !linearity)
    throw new Error("A mandatory test is incomplete.");
  const pointX = data.linearity.points.map(point =>
    protocol.linearity.useActualConcentration
      ? numericInput(point.actualConcentration ?? "")!
      : point.nominalConcentration
  );
  const pointY = data.linearity.points.map(
    point => numericInput(point.measuredOpticalRotation ?? "")!
  );
  const regression = evaluation.metrics.regression;
  const chart = pointX.map((x, index) => ({
    label: String(x),
    value: pointY[index],
    reference: regression.slope * x + regression.intercept,
  }));
  const rows = resultRows(data, protocol, evaluation);
  const polarimeterData: PolarimeterV2 = {
    schemaVersion: 2,
    equipmentSnapshot: equipmentSnapshot(device, protocol),
    protocolSnapshot: protocol,
    accuracy: { ...data.accuracy },
    repeatability: {
      ...data.repeatability,
      readings: [...data.repeatability.readings],
    },
    linearity: {
      ...data.linearity,
      points: data.linearity.points.map(point => ({ ...point })),
    },
    calculatedMetrics,
    testResults: { accuracy, repeatability, linearity },
    overallResult: evaluation.overallPass ? "pass" : "fail",
  };
  const stats = evaluation.metrics.repeatability;
  const linearityResult =
    protocol.linearity.metric === "r2" ? regression.r2 : regression.r;
  const metrics = [
    {
      label: "Specific rotation",
      value: `${format(evaluation.metrics.specificRotation, protocol.accuracy.displayPrecision)} °`,
      tone: accuracy === "pass" ? ("success" as const) : ("warning" as const),
    },
    {
      label: "Mean",
      value: `${format(stats.mean, 4)} °`,
      tone: "neutral" as const,
    },
    {
      label: "Range",
      value: `${format(stats.range, 4)} °`,
      tone: "neutral" as const,
    },
    {
      label: "Sample standard deviation",
      value: `${format(stats.sampleStandardDeviation, 6)} °`,
      tone: "neutral" as const,
    },
    {
      label: "RSD",
      value:
        stats.rsdPercent === null
          ? "Not defined"
          : `${format(stats.rsdPercent, 4)}%`,
      tone: "neutral" as const,
    },
    {
      label: "Slope",
      value: format(regression.slope, protocol.linearity.displayPrecision),
      tone: "neutral" as const,
    },
    {
      label: "Intercept",
      value: format(regression.intercept, protocol.linearity.displayPrecision),
      tone: "neutral" as const,
    },
    {
      label: "Correlation coefficient r",
      value: format(regression.r, protocol.linearity.displayPrecision),
      tone: "neutral" as const,
    },
    {
      label: "Coefficient of determination R²",
      value: format(regression.r2, protocol.linearity.displayPrecision),
      tone: "neutral" as const,
    },
    {
      label: "Configured linearity metric",
      value: `${protocol.linearity.metric === "r2" ? "R²" : "r"} = ${format(linearityResult, protocol.linearity.displayPrecision)}`,
      tone: linearity === "pass" ? ("success" as const) : ("warning" as const),
    },
  ];
  return {
    deviceKey: "polarimeter",
    rows,
    metrics,
    chart,
    chartTitle: "Concentration vs. Optical Rotation",
    note:
      protocol.protocolStatus === "pending-verification"
        ? `Protocol ${protocol.protocolId} v${protocol.protocolVersion} is Pending Verification against SOP ${protocol.sopNumber}. This result is a draft calculation and cannot be formally approved until the protocol is verified.`
        : undefined,
    controlledSettings: JSON.parse(JSON.stringify(config)),
    polarimeterData,
    overall: evaluation.overallPass,
    createdAt: new Date().toISOString(),
  };
}

function StepStatus({ complete, label }: { complete: boolean; label: string }) {
  return (
    <span
      className={`polarimeter-step-status ${complete ? "complete" : "pending"}`}
    >
      <i />
      {label}
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  hint,
  required = false,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: string;
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {hint && <small>{hint}</small>}
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={onChange ? event => onChange(event.target.value) : undefined}
      />
    </label>
  );
}

export function PolarimeterValidationForm({
  device,
  config,
  onComplete,
  onInvalidate,
  readOnly = false,
  draftOwnerId = null,
  savedDraftNonce = 0,
  draftKey = "active",
  onRetestDraftCleared,
}: {
  device: Device;
  config: Record<string, unknown>;
  onComplete: (result: CalibrationResult) => void;
  onInvalidate?: () => void;
  readOnly?: boolean;
  draftOwnerId?: number | null;
  savedDraftNonce?: number;
  draftKey?: string;
  onRetestDraftCleared?: () => void;
}) {
  const protocol = useMemo(
    () => createPolarimeterProtocolSnapshot(config),
    [config]
  );
  const storageKey = `yemen-qc-polarimeter-draft-v${2}-user-${draftOwnerId ?? "anonymous"}-${draftKey}`;
  const [inputs, setInputs] = useState<Inputs>(() => makeEmptyInputs(protocol));
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState("");
  const lastSeenSavedDraftNonce = useRef(savedDraftNonce);
  const serverDraftQuery = trpc.records.getPolarimeterDraft.useQuery(
    { draftKey },
    { enabled: !readOnly, retry: false }
  );
  const serverDraftSaveMutation =
    trpc.records.savePolarimeterDraft.useMutation();
  const serverDraftClearMutation =
    trpc.records.clearPolarimeterDraft.useMutation();
  const [serverDraftVersion, setServerDraftVersion] = useState(0);
  const [serverDraftReady, setServerDraftReady] = useState(false);
  const [serverSyncArmed, setServerSyncArmed] = useState(false);
  const [serverDraftStatus, setServerDraftStatus] = useState<
    "unavailable" | "loading" | "saved" | "saving" | "offline" | "conflict"
  >(readOnly ? "unavailable" : "loading");
  // Last server-draft error, shown verbatim so persistence failures (for example
  // an outdated database schema) are never hidden behind a generic "offline".
  const [serverDraftError, setServerDraftError] = useState<string | null>(null);
  const [serverDraftConflict, setServerDraftConflict] = useState<{
    version: number;
    serverDraft: LocalDraft | null;
    localDraft: LocalDraft | null;
  } | null>(null);
  const lastServerFingerprint = useRef("");
  const serverSaveInFlight = useRef(false);
  const clearServerDraftAfterRecordSave = useRef(false);
  const recordSavedDraftCleanupPending = useRef(false);
  const onRetestDraftClearedRef = useRef(onRetestDraftCleared);
  onRetestDraftClearedRef.current = onRetestDraftCleared;
  const finishRecordSavedDraftCleanup = () => {
    clearServerDraftAfterRecordSave.current = false;
    if (!recordSavedDraftCleanupPending.current) return;
    recordSavedDraftCleanupPending.current = false;
    onRetestDraftClearedRef.current?.();
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const draft = JSON.parse(saved) as unknown;
        if (!isLocalDraft(draft)) {
          setInputs(makeEmptyInputs(protocol));
          setStep(0);
          setRecoveryBlocked(true);
          setSavedAt(null);
          setRecoveryMessage(
            "A local draft was found but its contents are invalid. It was not applied and is being preserved until you discard it."
          );
        } else if (draft.protocolVersion === protocol.protocolVersion) {
          setInputs(draft.inputs);
          setStep(Math.min(Math.max(draft.step, 0), STEPS.length - 1));
          setSavedAt(draft.savedAt);
          setRecoveryMessage(
            "Recovered an unfinished draft from this browser."
          );
        } else {
          setInputs(makeEmptyInputs(protocol));
          setStep(0);
          setRecoveryBlocked(true);
          setSavedAt(draft.savedAt);
          setRecoveryMessage(
            `A local draft for protocol v${draft.protocolVersion} was found. It was not applied because the active protocol is v${protocol.protocolVersion}. It is being preserved until you discard it.`
          );
        }
      }
    } catch {
      setInputs(makeEmptyInputs(protocol));
      setStep(0);
      setSavedAt(null);
      setRecoveryBlocked(true);
      setRecoveryMessage(
        "A local draft was found but could not be read. It is being preserved until you discard it."
      );
    }
    setLoaded(true);
  }, [storageKey, protocol.protocolVersion]);

  useEffect(() => {
    if (readOnly) {
      setServerDraftReady(false);
      setServerDraftStatus("unavailable");
      return;
    }
    if (!serverDraftQuery.isFetched) return;
    if (serverDraftQuery.isError) {
      setServerDraftStatus("offline");
      setServerDraftError(serverDraftQuery.error?.message ?? null);
      return;
    }
    setServerDraftReady(true);
    const server = serverDraftQuery.data;
    let local: LocalDraft | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isLocalDraft(parsed)) local = parsed;
      }
    } catch {
      // A malformed local draft remains blocked by the local recovery handler.
    }
    if (clearServerDraftAfterRecordSave.current && serverSaveInFlight.current) {
      setServerDraftStatus("saving");
      return;
    }
    if (
      clearServerDraftAfterRecordSave.current &&
      !serverSaveInFlight.current
    ) {
      clearServerDraftAfterRecordSave.current = false;
      if (server) {
        const payload = server.payload as Partial<LocalDraft>;
        const candidate = {
          protocolVersion: server.protocolVersion,
          step: payload.step,
          inputs: payload.inputs,
          savedAt: payload.savedAt,
        } as LocalDraft;
        const compatible =
          isLocalDraft(candidate) &&
          candidate.protocolVersion === protocol.protocolVersion;
        setServerDraftVersion(server.version);
        setServerDraftConflict({
          version: server.version,
          serverDraft: compatible ? candidate : null,
          localDraft: local,
        });
        setRecoveryBlocked(true);
        setServerDraftStatus("conflict");
        setRecoveryMessage(
          "The validation record was saved while a server draft still existed. The draft was preserved; choose a copy or explicitly discard the server draft."
        );
      } else if (local) {
        setServerDraftVersion(0);
        setServerDraftConflict({
          version: 0,
          serverDraft: null,
          localDraft: local,
        });
        setRecoveryBlocked(true);
        setServerDraftStatus("conflict");
        setRecoveryMessage(
          "The validation record was saved, but this device still has an older local draft. Choose it explicitly or discard both copies."
        );
      } else {
        setServerDraftVersion(0);
        setServerDraftStatus("saved");
        setRecoveryBlocked(false);
        setRecoveryMessage("");
        lastServerFingerprint.current = "";
        finishRecordSavedDraftCleanup();
      }
      return;
    }
    if (!server) {
      setServerDraftVersion(0);
      if (local && local.protocolVersion === protocol.protocolVersion) {
        setServerSyncArmed(true);
        setServerDraftStatus("saving");
      } else {
        setServerDraftStatus("saved");
      }
      return;
    }
    const payload = server.payload as Partial<LocalDraft>;
    const candidate = {
      protocolVersion: server.protocolVersion,
      step: payload.step,
      inputs: payload.inputs,
      savedAt: payload.savedAt,
    } as LocalDraft;
    if (
      !isLocalDraft(candidate) ||
      candidate.protocolVersion !== protocol.protocolVersion
    ) {
      setServerDraftVersion(server.version);
      setServerDraftConflict({
        version: server.version,
        serverDraft: null,
        localDraft: local,
      });
      setRecoveryBlocked(true);
      setServerDraftStatus("conflict");
      setRecoveryMessage(
        "A server draft exists for a different or invalid protocol payload. It was preserved; no device may overwrite it automatically."
      );
      return;
    }
    const sameInputs =
      local &&
      local.protocolVersion === candidate.protocolVersion &&
      JSON.stringify({ step: local.step, inputs: local.inputs }) ===
        JSON.stringify({ step: candidate.step, inputs: candidate.inputs });
    if (local && !sameInputs) {
      setServerDraftVersion(server.version);
      setServerDraftConflict({
        version: server.version,
        serverDraft: candidate,
        localDraft: local,
      });
      setRecoveryBlocked(true);
      setServerDraftStatus("conflict");
      setRecoveryMessage(
        "This browser and the server contain different drafts. Choose which copy to keep; neither copy has been overwritten."
      );
      return;
    }
    setInputs(candidate.inputs);
    setStep(Math.min(Math.max(candidate.step, 0), STEPS.length - 1));
    setSavedAt(candidate.savedAt);
    setServerDraftVersion(server.version);
    setServerDraftConflict(null);
    setRecoveryBlocked(false);
    setServerSyncArmed(false);
    lastServerFingerprint.current = JSON.stringify({
      protocolVersion: candidate.protocolVersion,
      step: candidate.step,
      inputs: candidate.inputs,
    });
    setServerDraftStatus("saved");
    setRecoveryMessage(
      "Recovered the latest server-saved draft for this account."
    );
  }, [
    readOnly,
    serverDraftQuery.data,
    serverDraftQuery.isError,
    serverDraftQuery.isFetched,
    storageKey,
    protocol.protocolVersion,
  ]);

  useEffect(() => {
    if (savedDraftNonce === lastSeenSavedDraftNonce.current) return;
    lastSeenSavedDraftNonce.current = savedDraftNonce;
    setServerSyncArmed(false);
    clearServerDraftAfterRecordSave.current = !readOnly;
    recordSavedDraftCleanupPending.current =
      !readOnly && Boolean(onRetestDraftClearedRef.current);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // The result is already saved on the server; local recovery is optional.
    }
    setInputs(makeEmptyInputs(protocol));
    setStep(0);
    setRecoveryMessage("");
    setRecoveryBlocked(false);
    setSavedAt(null);
    setResultMessage("");
    if (!readOnly && !serverSaveInFlight.current) {
      if (serverDraftReady && serverDraftVersion > 0) {
        serverDraftClearMutation.mutate(
          { draftKey, expectedVersion: serverDraftVersion },
          {
            onSuccess: () => {
              finishRecordSavedDraftCleanup();
              setServerDraftVersion(0);
              setServerDraftStatus("saved");
              lastServerFingerprint.current = "";
              void serverDraftQuery.refetch();
            },
            onError: () => {
              clearServerDraftAfterRecordSave.current = true;
              setServerDraftStatus("conflict");
              setRecoveryBlocked(true);
              setRecoveryMessage(
                "The validation record was saved, but the server draft changed on another device and was preserved. Review or clear that draft explicitly."
              );
              void serverDraftQuery.refetch();
            },
          }
        );
      } else if (serverDraftReady && serverDraftQuery.data) {
        setServerDraftStatus("saving");
        void serverDraftQuery.refetch();
      } else if (serverDraftReady) {
        finishRecordSavedDraftCleanup();
        setServerDraftStatus("saved");
      }
    }
  }, [
    savedDraftNonce,
    storageKey,
    protocol,
    readOnly,
    serverDraftReady,
    serverDraftVersion,
  ]);

  useEffect(() => {
    if (readOnly || !loaded || recoveryBlocked) return;
    const saved = new Date().toISOString();
    try {
      const previousDraft = localStorage.getItem(storageKey);
      if (
        previousDraft &&
        (JSON.parse(previousDraft) as Partial<LocalDraft>).protocolVersion !==
          protocol.protocolVersion
      ) {
        return;
      }
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          protocolVersion: protocol.protocolVersion,
          step,
          inputs,
          savedAt: saved,
        } satisfies LocalDraft)
      );
      setSavedAt(saved);
    } catch {
      setSavedAt(null);
    }
  }, [
    inputs,
    step,
    loaded,
    recoveryBlocked,
    readOnly,
    protocol.protocolVersion,
    storageKey,
  ]);

  useEffect(() => {
    if (
      readOnly ||
      !serverDraftReady ||
      !serverSyncArmed ||
      !loaded ||
      recoveryBlocked ||
      serverDraftConflict
    )
      return;
    const snapshot = {
      protocolVersion: protocol.protocolVersion,
      step,
      inputs,
    };
    const fingerprint = JSON.stringify(snapshot);
    if (fingerprint === lastServerFingerprint.current) return;
    setServerDraftStatus("saving");
    const timer = window.setTimeout(() => {
      if (serverSaveInFlight.current) return;
      serverSaveInFlight.current = true;
      const payload: LocalDraft = {
        ...snapshot,
        savedAt: new Date().toISOString(),
      };
      serverDraftSaveMutation.mutate(
        {
          draftKey,
          protocolVersion: protocol.protocolVersion,
          expectedVersion: serverDraftVersion,
          payload,
        },
        {
          onSuccess: saved => {
            serverSaveInFlight.current = false;
            if (clearServerDraftAfterRecordSave.current) {
              serverDraftClearMutation.mutate(
                { draftKey, expectedVersion: saved.version },
                {
                  onSuccess: () => {
                    finishRecordSavedDraftCleanup();
                    setServerDraftVersion(0);
                    lastServerFingerprint.current = "";
                    setServerDraftStatus("saved");
                    void serverDraftQuery.refetch();
                  },
                  onError: () => {
                    clearServerDraftAfterRecordSave.current = true;
                    setServerDraftVersion(saved.version);
                    setServerDraftStatus("conflict");
                    setRecoveryBlocked(true);
                    setRecoveryMessage(
                      "The validation record was saved, but another device changed the server draft. It was preserved for explicit review."
                    );
                    void serverDraftQuery.refetch();
                  },
                }
              );
              return;
            }
            setServerDraftVersion(saved.version);
            lastServerFingerprint.current = fingerprint;
            setServerDraftStatus("saved");
            setServerDraftError(null);
          },
          onError: error => {
            serverSaveInFlight.current = false;
            const conflict = error.message.toLowerCase().includes("conflict");
            if (clearServerDraftAfterRecordSave.current) {
              clearServerDraftAfterRecordSave.current = true;
              setServerDraftStatus("conflict");
              setRecoveryBlocked(true);
              setRecoveryMessage(
                "The validation record was saved, but draft synchronization did not finish. Any server copy was left unchanged until you explicitly resolve it."
              );
              void serverDraftQuery.refetch();
            }
            if (conflict) {
              setServerDraftStatus("conflict");
              setServerDraftConflict({
                version: serverDraftVersion,
                serverDraft: null,
                localDraft: payload,
              });
              setRecoveryBlocked(true);
              setRecoveryMessage(
                "Another device changed the server draft. Local changes were preserved; choose a copy to continue."
              );
              void serverDraftQuery.refetch();
            } else {
              setServerDraftStatus("offline");
              setServerDraftError(error.message);
            }
          },
        }
      );
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    readOnly,
    serverDraftReady,
    serverSyncArmed,
    loaded,
    recoveryBlocked,
    serverDraftConflict,
    protocol.protocolVersion,
    step,
    inputs,
    serverDraftVersion,
  ]);

  const discardConflictingDrafts = () => {
    if (!serverDraftConflict) return;
    if (
      !window.confirm(
        "Discard both the server draft and this device copy? This cannot be undone."
      )
    )
      return;
    const finishDiscard = () => {
      finishRecordSavedDraftCleanup();
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Server copy is cleared; local storage can be cleared manually if needed.
      }
      setServerDraftVersion(0);
      setServerDraftConflict(null);
      setServerDraftReady(true);
      setServerSyncArmed(false);
      setRecoveryBlocked(false);
      setRecoveryMessage("");
      setInputs(makeEmptyInputs(protocol));
      setStep(0);
      setSavedAt(null);
      setServerDraftStatus("saved");
      lastServerFingerprint.current = "";
      void serverDraftQuery.refetch();
    };
    if (serverDraftConflict.version === 0) {
      finishDiscard();
      return;
    }
    serverDraftClearMutation.mutate(
      { draftKey, expectedVersion: serverDraftConflict.version },
      {
        onSuccess: finishDiscard,
        onError: () => {
          clearServerDraftAfterRecordSave.current = true;
          setServerDraftStatus("conflict");
          setRecoveryBlocked(true);
          setRecoveryMessage(
            "The server draft changed before it could be cleared. Both copies were preserved; reload and resolve the newest conflict."
          );
          void serverDraftQuery.refetch();
        },
      }
    );
  };

  const resolveServerDraftConflict = (choice: "server" | "local") => {
    if (!serverDraftConflict) return;
    clearServerDraftAfterRecordSave.current = false;
    recordSavedDraftCleanupPending.current = false;
    if (choice === "server") {
      if (!serverDraftConflict.serverDraft) return;
      setInputs(serverDraftConflict.serverDraft.inputs);
      setStep(serverDraftConflict.serverDraft.step);
      setSavedAt(serverDraftConflict.serverDraft.savedAt);
      lastServerFingerprint.current = JSON.stringify({
        protocolVersion: serverDraftConflict.serverDraft.protocolVersion,
        step: serverDraftConflict.serverDraft.step,
        inputs: serverDraftConflict.serverDraft.inputs,
      });
      setServerSyncArmed(false);
    } else {
      if (
        !serverDraftConflict.localDraft ||
        serverDraftConflict.localDraft.protocolVersion !==
          protocol.protocolVersion
      )
        return;
      setInputs(serverDraftConflict.localDraft.inputs);
      setStep(serverDraftConflict.localDraft.step);
      setServerSyncArmed(true);
    }
    setServerDraftVersion(serverDraftConflict.version);
    setServerDraftConflict(null);
    setRecoveryBlocked(false);
    setServerDraftStatus("saved");
    setRecoveryMessage("");
  };

  const evaluation = useMemo(
    () => evaluatePolarimeterInputs(inputs, protocol),
    [inputs, protocol]
  );
  const accuracyErrors = evaluation.errors.accuracy;
  const repeatabilityErrors = evaluation.errors.repeatability;
  const linearityErrors = evaluation.errors.linearity;
  const overallComplete = evaluation.overallPass !== null;
  const testStatuses = [
    evaluation.testResults.accuracy,
    evaluation.testResults.repeatability,
    evaluation.testResults.linearity,
  ];
  const stepComplete = (index: number) => {
    if (index === 0 || index === 1) return true;
    if (index === 2) return accuracyErrors.length === 0;
    if (index === 3) return repeatabilityErrors.length === 0;
    if (index === 4) return linearityErrors.length === 0;
    if (index === 5) return overallComplete;
    return false;
  };

  const updateAccuracy = (key: keyof Inputs["accuracy"], value: string) => {
    setServerSyncArmed(true);
    setInputs(current => ({
      ...current,
      accuracy: { ...current.accuracy, [key]: value },
    }));
    setResultMessage("");
    onInvalidate?.();
  };
  const updateRepeatability = (
    key: keyof Inputs["repeatability"],
    value: string | string[]
  ) => {
    setServerSyncArmed(true);
    setInputs(current => ({
      ...current,
      repeatability: { ...current.repeatability, [key]: value },
    }));
    setResultMessage("");
    onInvalidate?.();
  };
  const updateRepeatReading = (index: number, value: string) => {
    const readings = [...inputs.repeatability.readings];
    readings[index] = value;
    updateRepeatability("readings", readings);
  };
  const updateLinearityPoint = (
    index: number,
    key: "actualConcentration" | "measuredOpticalRotation" | "notes",
    value: string
  ) => {
    const points = inputs.linearity.points.map((point, pointIndex) =>
      pointIndex === index ? { ...point, [key]: value } : point
    );
    setServerSyncArmed(true);
    setInputs(current => ({
      ...current,
      linearity: { ...current.linearity, points },
    }));
    setResultMessage("");
    onInvalidate?.();
  };

  const calculate = () => {
    const problems = [
      ...accuracyErrors,
      ...repeatabilityErrors,
      ...linearityErrors,
    ];
    if (problems.length || !overallComplete) {
      setResultMessage(
        "Complete all required measurements before calculating the validation result."
      );
      return;
    }
    try {
      const result = makeResult(inputs, device, protocol, evaluation, config);
      onComplete(result);
      setResultMessage(
        "Server verification is required when this result is saved. The current protocol is visibly marked pending verification."
      );
      setStep(5);
    } catch (error) {
      setResultMessage(
        error instanceof Error
          ? error.message
          : "Unable to calculate the Polarimeter result."
      );
    }
  };

  const clearRepeatability = () =>
    updateRepeatability(
      "readings",
      Array.from({ length: protocol.repeatability.requiredReadings }, () => "")
    );
  const discardStaleDraft = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* local recovery is optional */
    }
    setRecoveryMessage("");
    setRecoveryBlocked(false);
    setInputs(makeEmptyInputs(protocol));
    setStep(0);
  };

  const currentStep = STEPS[step];
  const StepIcon = currentStep.icon;
  const equipmentMissing = [
    device.id,
    device.manufacturer,
    device.model,
    device.serial,
    device.sop,
    device.form,
  ].some(value => !value?.trim());
  const protocolPending = protocol.protocolStatus !== "approved";
  const statusLabel = (status: string | null) =>
    status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "Not started";

  return (
    <div className="polarimeter-workflow" dir="ltr">
      <div className="polarimeter-workflow-heading">
        <div>
          <span className="eyebrow">CONTROLLED VALIDATION WORKFLOW</span>
          <h2>Polarimeter Validation</h2>
          <p>
            Record original measurements, review calculated results, and
            preserve the controlled protocol snapshot.
          </p>
        </div>
        <StepStatus
          complete={overallComplete}
          label={
            overallComplete
              ? "All mandatory tests calculated"
              : "Measurements in progress"
          }
        />
      </div>

      <nav
        className="polarimeter-stepper"
        aria-label="Polarimeter validation progress"
      >
        {STEPS.map((item, index) => {
          const Icon = item.icon;
          const complete = stepComplete(index);
          return (
            <button
              type="button"
              className={`polarimeter-step ${index === step ? "active" : ""} ${complete ? "done" : ""}`}
              key={item.title}
              onClick={() => {
                setServerSyncArmed(true);
                setStep(index);
              }}
              aria-current={index === step ? "step" : undefined}
              aria-label={`${index + 1}. ${item.title}${complete ? ", complete" : ""}`}
            >
              <span className="polarimeter-step-number">
                {complete && index < 5 ? (
                  <Check size={14} />
                ) : (
                  <Icon size={14} />
                )}
              </span>
              <span className="polarimeter-step-label">
                <small>{String(index + 1).padStart(2, "0")}</small>
                <strong>{item.shortTitle}</strong>
              </span>
            </button>
          );
        })}
      </nav>

      {recoveryMessage && (
        <div className="polarimeter-alert" role="status">
          <AlertTriangle size={18} />
          <span>{recoveryMessage}</span>
          {recoveryMessage.includes("was found") && (
            <button
              type="button"
              className="quiet-button"
              onClick={discardStaleDraft}
            >
              Discard old draft
            </button>
          )}
        </div>
      )}
      {serverDraftConflict && (
        <div className="polarimeter-alert warning" role="alert">
          <AlertTriangle size={18} />
          <span>
            Draft conflict detected. No server or local copy has been
            overwritten. Choose the source you want to continue from.
          </span>
          {serverDraftConflict.serverDraft && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => resolveServerDraftConflict("server")}
            >
              Use server copy
            </button>
          )}
          {serverDraftConflict.localDraft?.protocolVersion ===
            protocol.protocolVersion && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => resolveServerDraftConflict("local")}
            >
              {serverDraftConflict.version > 0
                ? "Keep this device copy and replace server copy"
                : "Keep this device copy and sync it"}
            </button>
          )}
          <button
            type="button"
            className="quiet-button"
            onClick={discardConflictingDrafts}
            disabled={serverDraftClearMutation.isPending}
          >
            Discard both copies
          </button>
        </div>
      )}
      {protocolPending && (
        <div className="polarimeter-alert warning" role="alert">
          <AlertTriangle size={18} />
          <span>
            <strong>Protocol pending verification.</strong> The supplied initial
            criteria are not confirmed against SOP {protocol.sopNumber}; this
            run can be saved as a draft, but successful formal approval is
            blocked until verification. Equipment review, measurement entry,
            calculations, step navigation and draft saving remain available.
          </span>
        </div>
      )}
      {equipmentMissing && (
        <div className="polarimeter-alert warning" role="alert">
          <AlertTriangle size={18} />
          <span>
            One or more required equipment identity fields are missing. Ask an
            authorized administrator to update the existing equipment profile
            under Settings; this workflow does not create a duplicate equipment
            record.
          </span>
        </div>
      )}

      <section
        className="polarimeter-step-panel"
        aria-labelledby="polarimeter-current-step"
      >
        <header className="polarimeter-panel-header">
          <div className="polarimeter-panel-icon">
            <StepIcon size={19} />
          </div>
          <div>
            <span className="eyebrow">
              STEP {String(step + 1).padStart(2, "0")} OF 09
            </span>
            <h3 id="polarimeter-current-step">{currentStep.title}</h3>
          </div>
          {step < 6 && (
            <StepStatus
              complete={stepComplete(step)}
              label={stepComplete(step) ? "Complete" : "In progress"}
            />
          )}
        </header>

        <fieldset
          className="polarimeter-step-fields"
          disabled={readOnly || recoveryBlocked}
        >
          <legend className="sr-only">{currentStep.title} controls</legend>
          {step === 0 && (
            <div className="polarimeter-step-content">
              <p className="polarimeter-intro">
                The selected instrument is read from the existing Equipment
                Register. Identity fields are displayed read-only for this
                validation run.
              </p>
              <dl className="polarimeter-equipment-grid">
                <div>
                  <dt>Instrument</dt>
                  <dd>{device.english}</dd>
                </div>
                <div>
                  <dt>Equipment ID</dt>
                  <dd>{device.id || "Missing"}</dd>
                </div>
                <div>
                  <dt>Manufacturer</dt>
                  <dd>{device.manufacturer || "Missing"}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{device.model || "Missing"}</dd>
                </div>
                <div>
                  <dt>Serial number</dt>
                  <dd>{device.serial || "Missing"}</dd>
                </div>
                <div>
                  <dt>SOP / Form</dt>
                  <dd>
                    {device.sop || "Missing"} / {device.form || "Missing"}
                  </dd>
                </div>
                <div>
                  <dt>Department</dt>
                  <dd>Not available in the current equipment profile</dd>
                </div>
                <div>
                  <dt>Location / status</dt>
                  <dd>Not available in the current equipment profile</dd>
                </div>
              </dl>
              <p className="polarimeter-muted">
                Department, location, and instrument status are not represented
                by the current shared profile schema. They are not guessed or
                stored as a new equipment record.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="polarimeter-step-content">
              <div className="polarimeter-protocol-banner">
                <span
                  className={`protocol-state ${protocolPending ? "pending" : "approved"}`}
                >
                  {protocol.protocolStatus.replaceAll("-", " ")}
                </span>
                <strong>
                  {protocol.protocolId} · v{protocol.protocolVersion}
                </strong>
                <span>
                  SOP {protocol.sopNumber} · Form {protocol.formNumber}
                </span>
              </div>
              <div className="polarimeter-equipment-grid protocol-grid">
                <div>
                  <dt>Effective date</dt>
                  <dd>
                    {protocol.effectiveDate || "Not set — pending verification"}
                  </dd>
                </div>
                <div>
                  <dt>Required repeat readings</dt>
                  <dd>{protocol.repeatability.requiredReadings}</dd>
                </div>
                <div>
                  <dt>Linearity nominal points</dt>
                  <dd>
                    {protocol.linearity.nominalConcentrations.join(", ")}{" "}
                    g/100ml
                  </dd>
                </div>
                <div>
                  <dt>Specific rotation limits</dt>
                  <dd>
                    {protocol.accuracy.lowerLimit} to{" "}
                    {protocol.accuracy.upperLimit} °
                  </dd>
                </div>
                <div>
                  <dt>Repeatability method</dt>
                  <dd>
                    {protocol.repeatability.method.replaceAll("-", " ")} ·{" "}
                    {protocol.repeatability.tolerance}{" "}
                    {protocol.repeatability.unit}
                  </dd>
                </div>
                <div>
                  <dt>Linearity acceptance</dt>
                  <dd>
                    {protocol.linearity.metric === "r2" ? "R²" : "r"} ≥{" "}
                    {protocol.linearity.minimumMetric}
                  </dd>
                </div>
                <div>
                  <dt>Tube length</dt>
                  <dd>{protocol.conditions.tubeLengthDm} dm</dd>
                </div>
                <div>
                  <dt>Conditions</dt>
                  <dd>
                    {protocol.conditions.wavelengthLabel},{" "}
                    {protocol.conditions.wavelengthNm} nm ·{" "}
                    {protocol.conditions.referenceTemperatureC} °C reference
                  </dd>
                </div>
              </div>
              <p className="polarimeter-muted">
                Every new result stores an immutable versioned snapshot of this
                protocol, its criteria, formula, conditions, reading counts, and
                nominal points. Changes are managed by an administrator in the
                existing Limits &amp; Settings page and require SOP
                verification.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="polarimeter-step-content">
              <div className="polarimeter-form-grid">
                <TextField
                  label="Optical rotation (α)"
                  value={inputs.accuracy.opticalRotation ?? ""}
                  onChange={value => updateAccuracy("opticalRotation", value)}
                  type="number"
                  hint="Measured value · °"
                  required
                />
                <TextField
                  label="Concentration"
                  value={inputs.accuracy.concentrationGPer100Ml ?? ""}
                  onChange={value =>
                    updateAccuracy("concentrationGPer100Ml", value)
                  }
                  type="number"
                  hint="g/100ml · must be greater than zero"
                  required
                />
                <TextField
                  label="Tube length"
                  value={inputs.accuracy.tubeLengthDm}
                  readOnly
                  hint="dm · protocol-configured; read-only"
                  required
                />
                <TextField
                  label="Measurement date and time"
                  value={inputs.accuracy.measurementDateTime}
                  onChange={value =>
                    updateAccuracy("measurementDateTime", value)
                  }
                  type="datetime-local"
                  required={protocol.requiredFields.measurementDateTime}
                />
                <TextField
                  label="Temperature"
                  value={inputs.accuracy.temperatureC ?? ""}
                  onChange={value => updateAccuracy("temperatureC", value)}
                  type="number"
                  hint={`°C${protocol.requiredFields.temperature ? " · required" : " · optional unless SOP requires"}`}
                  required={protocol.requiredFields.temperature}
                />
                <TextField
                  label="Wavelength"
                  value={`${inputs.accuracy.wavelengthLabel} · ${inputs.accuracy.wavelengthNm} nm`}
                  readOnly
                  hint="Protocol reference condition"
                />
                <TextField
                  label="Reference standard ID"
                  value={inputs.accuracy.referenceStandardId}
                  onChange={value =>
                    updateAccuracy("referenceStandardId", value)
                  }
                  required={protocol.requiredFields.referenceStandard}
                />
                <TextField
                  label="Reference standard expiry"
                  value={inputs.accuracy.referenceStandardExpiryDate}
                  onChange={value =>
                    updateAccuracy("referenceStandardExpiryDate", value)
                  }
                  type="date"
                />
                <TextField
                  label="Certificate number"
                  value={inputs.accuracy.referenceStandardCertificateNumber}
                  onChange={value =>
                    updateAccuracy("referenceStandardCertificateNumber", value)
                  }
                  required={protocol.requiredFields.referenceStandard}
                />
              </div>
              <label className="field">
                <span>Analyst notes</span>
                <textarea
                  value={inputs.accuracy.analystNotes}
                  onChange={event =>
                    updateAccuracy("analystNotes", event.target.value)
                  }
                  rows={3}
                />
              </label>
              <div className="polarimeter-formula">
                <strong>Specific rotation formula</strong>
                <code>[α]ᴰ²⁰ = 100 × α / (l × c)</code>
                <span>
                  Evaluation uses the unrounded result; display precision is{" "}
                  {protocol.accuracy.displayPrecision} decimal places.
                </span>
              </div>
              <ErrorList errors={accuracyErrors} />
            </div>
          )}

          {step === 3 && (
            <div className="polarimeter-step-content">
              <div className="polarimeter-form-grid">
                <TextField
                  label="Sample ID"
                  value={inputs.repeatability.sampleId}
                  onChange={value => updateRepeatability("sampleId", value)}
                  required
                />
                <TextField
                  label="Sample concentration"
                  value={inputs.repeatability.sampleConcentration ?? ""}
                  onChange={value =>
                    updateRepeatability("sampleConcentration", value)
                  }
                  type="number"
                  hint="g/100ml"
                  required
                />
                <TextField
                  label="Measurement conditions"
                  value={inputs.repeatability.measurementConditions}
                  onChange={value =>
                    updateRepeatability("measurementConditions", value)
                  }
                  hint="Record any protocol-relevant condition"
                />
              </div>
              <div className="polarimeter-table-wrap">
                <div className="polarimeter-table-heading">
                  <div>
                    <strong>Individual optical-rotation readings</strong>
                    <small>
                      Exactly {protocol.repeatability.requiredReadings} readings
                      are required by protocol v{protocol.protocolVersion}.
                    </small>
                  </div>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={clearRepeatability}
                    disabled={readOnly}
                  >
                    <RotateCcw size={14} /> Clear draft readings
                  </button>
                </div>
                <div className="table-scroll">
                  <table className="polarimeter-table">
                    <thead>
                      <tr>
                        <th>Reading</th>
                        <th>Optical rotation (°)</th>
                        <th>Deviation</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inputs.repeatability.readings.map((value, index) => {
                        const stats = evaluation.metrics.repeatability;
                        const deviation = stats?.deviations[index];
                        const pass = stats?.individualPasses[index];
                        return (
                          <tr key={`repeat-${index}`}>
                            <td>{index + 1}</td>
                            <td>
                              <input
                                type="number"
                                step="any"
                                value={value}
                                onChange={event =>
                                  updateRepeatReading(index, event.target.value)
                                }
                                aria-label={`Repeatability reading ${index + 1}`}
                              />
                            </td>
                            <td>
                              {deviation === undefined
                                ? "—"
                                : `${format(deviation, protocol.repeatability.displayPrecision)} °`}
                            </td>
                            <td>
                              <span
                                className={`polarimeter-inline-status ${pass === undefined ? "pending" : pass ? "pass" : "fail"}`}
                              >
                                {pass === undefined
                                  ? "Pending"
                                  : pass
                                    ? "PASS"
                                    : "FAIL"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="polarimeter-stat-grid">
                <Stat
                  label="Mean"
                  value={`${format(evaluation.metrics.repeatability?.mean, 4)} °`}
                />
                <Stat
                  label="Minimum / Maximum"
                  value={`${format(evaluation.metrics.repeatability?.minimum, 4)} / ${format(evaluation.metrics.repeatability?.maximum, 4)} °`}
                />
                <Stat
                  label="Range"
                  value={`${format(evaluation.metrics.repeatability?.range, 4)} °`}
                />
                <Stat
                  label="Sample standard deviation"
                  value={`${format(evaluation.metrics.repeatability?.sampleStandardDeviation, 6)} °`}
                />
                <Stat
                  label="RSD"
                  value={
                    evaluation.metrics.repeatability?.rsdPercent === null
                      ? "Not defined"
                      : `${format(evaluation.metrics.repeatability?.rsdPercent, 4)}%`
                  }
                />
                <Stat
                  label="Evaluation method"
                  value={protocol.repeatability.method.replaceAll("-", " ")}
                />
              </div>
              <p className="polarimeter-muted">
                The evaluation method is taken from the protocol snapshot; ±0.05
                is not treated as a range or standard deviation unless the
                protocol explicitly selects that method. The initial
                first-reading comparison remains Pending Verification.
              </p>
              <ErrorList errors={repeatabilityErrors} />
            </div>
          )}

          {step === 4 && (
            <div className="polarimeter-step-content">
              <p className="polarimeter-intro">
                X-axis: concentration (g/100ml). Y-axis: measured optical
                rotation (°). The nominal concentration values are protocol
                points; measurement fields start blank.
              </p>
              <div className="polarimeter-table-wrap">
                <div className="table-scroll">
                  <table className="polarimeter-table">
                    <thead>
                      <tr>
                        <th>Point</th>
                        <th>Nominal concentration (g/100ml)</th>
                        <th>Actual concentration (g/100ml)</th>
                        <th>Optical rotation (°)</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inputs.linearity.points.map((point, index) => (
                        <tr key={`linearity-${index}`}>
                          <td>{point.pointNumber}</td>
                          <td>{point.nominalConcentration}</td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              value={point.actualConcentration ?? ""}
                              onChange={event =>
                                updateLinearityPoint(
                                  index,
                                  "actualConcentration",
                                  event.target.value
                                )
                              }
                              aria-label={`Actual concentration point ${index + 1}`}
                              placeholder={
                                protocol.linearity.useActualConcentration
                                  ? "Required"
                                  : "Optional"
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              value={point.measuredOpticalRotation ?? ""}
                              onChange={event =>
                                updateLinearityPoint(
                                  index,
                                  "measuredOpticalRotation",
                                  event.target.value
                                )
                              }
                              aria-label={`Optical rotation point ${index + 1}`}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={point.notes}
                              onChange={event =>
                                updateLinearityPoint(
                                  index,
                                  "notes",
                                  event.target.value
                                )
                              }
                              aria-label={`Linearity note point ${index + 1}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="polarimeter-stat-grid">
                <Stat
                  label="Regression slope"
                  value={format(
                    evaluation.metrics.regression?.slope,
                    protocol.linearity.displayPrecision
                  )}
                />
                <Stat
                  label="Regression intercept"
                  value={format(
                    evaluation.metrics.regression?.intercept,
                    protocol.linearity.displayPrecision
                  )}
                />
                <Stat
                  label="Correlation coefficient r"
                  value={format(
                    evaluation.metrics.regression?.r,
                    protocol.linearity.displayPrecision
                  )}
                />
                <Stat
                  label="Coefficient of determination R²"
                  value={format(
                    evaluation.metrics.regression?.r2,
                    protocol.linearity.displayPrecision
                  )}
                />
                <Stat
                  label="Acceptance metric"
                  value={`${protocol.linearity.metric === "r2" ? "R²" : "r"} ≥ ${protocol.linearity.minimumMetric}`}
                />
                <Stat
                  label="Valid points"
                  value={`${evaluation.metrics.regression?.count ?? 0} / ${protocol.linearity.nominalConcentrations.length}`}
                />
              </div>
              {evaluation.metrics.regression && (
                <div className="polarimeter-equation">
                  <strong>Least-squares equation</strong>
                  <code>
                    y ={" "}
                    {format(
                      evaluation.metrics.regression.slope,
                      protocol.linearity.displayPrecision
                    )}
                    x {evaluation.metrics.regression.intercept < 0 ? "−" : "+"}{" "}
                    {format(
                      Math.abs(evaluation.metrics.regression.intercept),
                      protocol.linearity.displayPrecision
                    )}
                  </code>
                  <span>
                    R² is displayed separately from r; the configured acceptance
                    metric is {protocol.linearity.metric === "r2" ? "R²" : "r"}.
                  </span>
                </div>
              )}
              <p className="polarimeter-muted">
                A high correlation alone does not establish analytical
                performance. No slope, intercept, residual, or deviation
                criterion is applied unless configured in the protocol.
              </p>
              <ErrorList errors={linearityErrors} />
            </div>
          )}

          {step === 5 && (
            <div className="polarimeter-step-content">
              <div className="polarimeter-review-grid">
                {(["accuracy", "repeatability", "linearity"] as const).map(
                  (test, index) => (
                    <article className="polarimeter-review-card" key={test}>
                      <span className="eyebrow">
                        MANDATORY TEST {index + 1}
                      </span>
                      <h4>{test[0].toUpperCase() + test.slice(1)}</h4>
                      <StepStatus
                        complete={testStatuses[index] !== null}
                        label={statusLabel(testStatuses[index])}
                      />
                      {testStatuses[index] === "fail" && (
                        <p className="polarimeter-failure">
                          Failed test blocks successful validation approval.
                        </p>
                      )}
                    </article>
                  )
                )}
              </div>
              <div className="polarimeter-summary">
                <h4>Calculation summary</h4>
                <p>
                  <strong>Specific rotation:</strong>{" "}
                  {format(
                    evaluation.metrics.specificRotation,
                    protocol.accuracy.displayPrecision
                  )}{" "}
                  °; acceptance {protocol.accuracy.lowerLimit} to{" "}
                  {protocol.accuracy.upperLimit} °.
                </p>
                <p>
                  <strong>Repeatability:</strong> mean{" "}
                  {format(evaluation.metrics.repeatability?.mean, 4)} °; range{" "}
                  {format(evaluation.metrics.repeatability?.range, 4)} °; SD{" "}
                  {format(
                    evaluation.metrics.repeatability?.sampleStandardDeviation,
                    6
                  )}{" "}
                  °; RSD{" "}
                  {evaluation.metrics.repeatability?.rsdPercent === null
                    ? "Not defined"
                    : `${format(evaluation.metrics.repeatability?.rsdPercent, 4)}%`}
                  .
                </p>
                <p>
                  <strong>Linearity:</strong> slope{" "}
                  {format(
                    evaluation.metrics.regression?.slope,
                    protocol.linearity.displayPrecision
                  )}
                  ; intercept{" "}
                  {format(
                    evaluation.metrics.regression?.intercept,
                    protocol.linearity.displayPrecision
                  )}
                  ; r{" "}
                  {format(
                    evaluation.metrics.regression?.r,
                    protocol.linearity.displayPrecision
                  )}
                  ; R²{" "}
                  {format(
                    evaluation.metrics.regression?.r2,
                    protocol.linearity.displayPrecision
                  )}
                  .
                </p>
                <p>
                  <strong>Overall technical test:</strong>{" "}
                  {evaluation.overallPass === null
                    ? "Incomplete"
                    : evaluation.overallPass
                      ? "PASS"
                      : "FAIL"}
                  . This is not a lifecycle approval.
                </p>
              </div>
              {resultMessage && (
                <p className="polarimeter-inline-message" role="status">
                  {resultMessage}
                </p>
              )}
              <button
                type="button"
                className="primary-button polarimeter-calculate"
                onClick={calculate}
                disabled={readOnly || !overallComplete || equipmentMissing}
              >
                <Check size={16} /> Calculate and attach structured results
              </button>
            </div>
          )}

          {step === 6 && (
            <div className="polarimeter-step-content polarimeter-workflow-notice">
              <span className="workflow-state">SAVED RECORD REVIEW</span>
              <h4>Independent server-side technical review.</h4>
              <p>
                After saving, an active administrator who is not the analyst
                must record a review decision, comments, any rejection reason,
                and outstanding issues in Records &amp; Audit. The review is
                bound to this exact record version; edits invalidate an earlier
                decision.
              </p>
              <p>
                Acceptance is blocked while QC-032D remains unverified or any
                issue is outstanding. A review decision is recorded identity,
                not an electronic signature.
              </p>
            </div>
          )}
          {step === 7 && (
            <div className="polarimeter-step-content polarimeter-workflow-notice">
              <span
                className={`workflow-state ${protocolPending ? "blocked" : "pending"}`}
              >
                {protocolPending
                  ? "BLOCKED — PROTOCOL PENDING"
                  : "AWAITING SERVER DECISION"}
              </span>
              <h4>Formal approval is server-authoritative.</h4>
              <p>
                A passing calculation does not approve the record. The existing
                admin-only approval action records the lifecycle state and audit
                event.
              </p>
              {evaluation.overallPass === false && (
                <p className="polarimeter-failure">
                  At least one mandatory test failed; server approval of this
                  failed record will be rejected.
                </p>
              )}
              {protocolPending && (
                <p className="polarimeter-failure">
                  A successful Polarimeter approval remains blocked until
                  QC-032D criteria are verified and an approved protocol can be
                  issued.
                </p>
              )}
            </div>
          )}
          {step === 8 && (
            <div className="polarimeter-step-content polarimeter-workflow-notice">
              <span className="workflow-state pending">
                {overallComplete
                  ? "REPORT AVAILABLE AFTER SAVE"
                  : "REPORT NOT READY"}
              </span>
              <h4>Official report from the saved record</h4>
              <p>
                The report action is enabled only after the result is saved. It
                uses the saved lifecycle state, protocol snapshot, original
                measurements, and server-verified calculations; an unsaved
                report cannot be shown as approved.
              </p>
              <p>
                After saving, open the record in{" "}
                <strong>Records &amp; Audit</strong> and use its PDF action. The
                status will remain Draft / Not Approved until the authorized
                server workflow changes it.
              </p>
            </div>
          )}
        </fieldset>
      </section>

      <footer className="polarimeter-workflow-footer">
        <div className="polarimeter-save-state">
          <Save size={14} />
          {savedAt
            ? `Local recovery saved ${new Date(savedAt).toLocaleTimeString()}`
            : "Local recovery unavailable"}
          <small>
            {readOnly
              ? "Server draft synchronization requires an authenticated editor account."
              : `Server draft: ${serverDraftStatus}. Version ${serverDraftVersion || "not yet saved"}.`}
          </small>
          {!readOnly && serverDraftError && (
            <small className="polarimeter-server-draft-error" role="alert">
              Server draft not saved: {serverDraftError} Your entries are kept
              in this browser&apos;s local recovery copy.
            </small>
          )}
          <small>
            Server drafts are account-scoped and version-checked; saving this
            form creates a separate validation record.
          </small>
        </div>
        <div className="polarimeter-nav-buttons">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setServerSyncArmed(true);
              setStep(current => Math.max(0, current - 1));
            }}
            disabled={step === 0}
          >
            <ArrowLeft size={15} /> Previous
          </button>
          {step < STEPS.length - 1 && (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setServerSyncArmed(true);
                setStep(current => Math.min(STEPS.length - 1, current + 1));
              }}
            >
              <span>Next step</span>
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </footer>
      {resultMessage && step !== 5 && (
        <p className="polarimeter-inline-message" role="status">
          {resultMessage}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="polarimeter-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length)
    return (
      <p className="polarimeter-valid">
        <Check size={15} /> Required fields are complete for this section.
      </p>
    );
  return (
    <div className="polarimeter-validation-errors" role="status">
      <strong>Incomplete section</strong>
      <ul>
        {errors.map((error, index) => (
          <li key={`${error}-${index}`}>{error}</li>
        ))}
      </ul>
    </div>
  );
}
