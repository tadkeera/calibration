import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type RecordItem = {
  id: number;
  recordVersion: number;
  instrumentKey: string;
  resultStatus: "pass" | "fail";
  lifecycleStatus: "draft" | "approved" | "rejected";
  validatedByUserId: number;
  retestOfRecordId?: number | null;
  retestReason?: string | null;
  resultData: Record<string, unknown>;
};

type RetestStarter = (recordId: number, reason: string) => void;

export function PolarimeterWorkflowPanel({
  record,
  isAdmin,
  currentUserId,
  onStartRetest,
}: {
  record: RecordItem;
  isAdmin: boolean;
  currentUserId: number;
  /** Omitted since v4: the legacy hard-coded form is retired, so legacy retests are no longer started here. */
  onStartRetest?: RetestStarter;
}) {
  const utils = trpc.useUtils();
  const reviews = trpc.records.technicalReviews.useQuery({ id: record.id });
  const deviations = trpc.records.deviations.useQuery({ id: record.id });
  const users = trpc.users.list.useQuery(undefined, { enabled: isAdmin });
  const [comments, setComments] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [outstandingIssues, setOutstandingIssues] = useState("");
  const [retestReason, setRetestReason] = useState("");
  const submitReview = trpc.records.submitTechnicalReview.useMutation({
    onSuccess: () => {
      setComments("");
      setRejectionReason("");
      setOutstandingIssues("");
      void utils.records.technicalReviews.invalidate({ id: record.id });
      void utils.records.get.invalidate({ id: record.id });
      toast.success("Technical review decision was recorded on the server.");
    },
    onError: error => toast.error(error.message),
  });

  const polarimeterData = record.resultData.polarimeterData as
    | { protocolSnapshot?: { protocolStatus?: string } }
    | undefined;
  const protocolPending =
    polarimeterData?.protocolSnapshot?.protocolStatus !== "approved";
  const latest = reviews.data?.at(-1);
  const isAnalyst = record.validatedByUserId === currentUserId;
  const canReview = isAdmin && !isAnalyst && record.lifecycleStatus === "draft";
  const submit = (decision: "accepted" | "rejected") => {
    submitReview.mutate({
      id: record.id,
      expectedVersion: record.recordVersion,
      decision,
      comments,
      rejectionReason: decision === "rejected" ? rejectionReason : null,
      outstandingIssues: outstandingIssues
        .split("\n")
        .map(value => value.trim())
        .filter(Boolean),
    });
  };

  return (
    <section className="polarimeter-record-workflow" dir="ltr">
      <header>
        <span className="eyebrow">SERVER-CONTROLLED POLARIMETER WORKFLOW</span>
        <h3>Independent review, deviations and retesting</h3>
        <p>
          These decisions and changes are persisted with authenticated user
          identity, timestamps and version checks. None is an electronic
          signature.
        </p>
      </header>

      {record.retestOfRecordId && (
        <div className="polarimeter-alert warning" role="status">
          <RotateCcw size={17} />
          <span>
            Retest of record {record.retestOfRecordId}. Reason:{" "}
            {record.retestReason || "Not recorded"}. The original record remains
            unchanged.
          </span>
        </div>
      )}

      <section className="polarimeter-record-workflow-card">
        <h4>
          <ShieldCheck size={17} /> Technical review
        </h4>
        {latest ? (
          <div className="polarimeter-review-history">
            <p>
              <strong>Latest decision:</strong> {latest.decision.toUpperCase()}{" "}
              · reviewer{" "}
              {latest.reviewerName || `user ${latest.reviewerUserId}`} · version{" "}
              {latest.recordVersion}
            </p>
            <p>
              <strong>Comments:</strong> {latest.comments}
            </p>
            {latest.rejectionReason && (
              <p>
                <strong>Rejection reason:</strong> {latest.rejectionReason}
              </p>
            )}
            {latest.outstandingIssues.length > 0 && (
              <p>
                <strong>Outstanding issues:</strong>{" "}
                {latest.outstandingIssues.join("; ")}
              </p>
            )}
            <p className="muted-copy">
              {new Date(latest.createdAt).toLocaleString()} · reviewer and
              analyst must be different; the approver must be a third user.
            </p>
          </div>
        ) : (
          <p className="muted-copy">
            No server-side technical review has been recorded.
          </p>
        )}
        {reviews.data && reviews.data.length > 1 && (
          <details>
            <summary>
              Earlier review decisions ({reviews.data.length - 1})
            </summary>
            {reviews.data.slice(0, -1).map(entry => (
              <article key={entry.id} className="polarimeter-review-history">
                <strong>
                  {entry.decision.toUpperCase()} ·{" "}
                  {entry.reviewerName || `user ${entry.reviewerUserId}`} ·
                  record version {entry.recordVersion}
                </strong>
                <p>{entry.comments}</p>
                {entry.rejectionReason && (
                  <p>Reason: {entry.rejectionReason}</p>
                )}
                {entry.outstandingIssues.length > 0 && (
                  <p>Issues: {entry.outstandingIssues.join("; ")}</p>
                )}
                <small>{new Date(entry.createdAt).toLocaleString()}</small>
              </article>
            ))}
          </details>
        )}
        {canReview && (
          <div className="polarimeter-review-form">
            <label>
              Reviewer comments
              <textarea
                value={comments}
                onChange={event => setComments(event.target.value)}
                maxLength={5000}
              />
            </label>
            <label>
              Outstanding issues, one per line
              <textarea
                value={outstandingIssues}
                onChange={event => setOutstandingIssues(event.target.value)}
                maxLength={3000}
              />
            </label>
            <label>
              Rejection reason (required when rejecting)
              <textarea
                value={rejectionReason}
                onChange={event => setRejectionReason(event.target.value)}
                maxLength={5000}
              />
            </label>
            {protocolPending && (
              <p className="polarimeter-failure">
                <AlertTriangle size={15} /> Accepted technical review is blocked
                until SOP QC-032D is verified.
              </p>
            )}
            <div className="record-detail-actions">
              <button
                type="button"
                className="secondary-button decision-reject"
                disabled={
                  submitReview.isPending ||
                  !comments.trim() ||
                  !rejectionReason.trim()
                }
                onClick={() => submit("rejected")}
              >
                Record rejection
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={
                  submitReview.isPending ||
                  !comments.trim() ||
                  Boolean(outstandingIssues.trim()) ||
                  protocolPending ||
                  record.resultStatus !== "pass"
                }
                onClick={() => submit("accepted")}
              >
                <Check size={15} /> Accept technical review
              </button>
            </div>
          </div>
        )}
        {isAdmin && isAnalyst && record.lifecycleStatus === "draft" && (
          <p className="polarimeter-failure">
            The analyst cannot review their own record. Assign a different
            active administrator.
          </p>
        )}
      </section>

      {record.resultStatus === "fail" && (
        <section className="polarimeter-record-workflow-card">
          <h4>
            <AlertTriangle size={17} /> Deviation / CAPA
          </h4>
          {deviations.isLoading ? (
            <p>Loading deviation cases…</p>
          ) : deviations.data?.cases.length ? (
            deviations.data.cases.map(item => (
              <DeviationEditor
                key={`${item.id}-${item.version}`}
                item={item}
                recordId={record.id}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                activeEditors={(users.data ?? []).filter(
                  user => user.isActive && user.role !== "viewer"
                )}
                events={(deviations.data?.events ?? []).filter(
                  event => event.deviationId === item.id
                )}
                onSaved={() =>
                  void utils.records.deviations.invalidate({ id: record.id })
                }
              />
            ))
          ) : (
            <p className="muted-copy">
              Failed tests are saved as separate deviation cases; refresh the
              record to retry case creation if the service was temporarily
              unavailable.
            </p>
          )}
          <p className="muted-copy">
            Acceptance limits above are copied from the record’s protocol
            snapshot. If that snapshot is Pending Verification, the limit is
            unverified and is not an approved scientific criterion.
          </p>
        </section>
      )}

      {record.resultStatus === "fail" && onStartRetest && (
        <section className="polarimeter-record-workflow-card">
          <h4>
            <RotateCcw size={17} /> Controlled retest
          </h4>
          <p>
            The original failed measurements are immutable. A retest starts a
            separate blank form and is linked to this record only when the new
            record is saved.
          </p>
          <label>
            Reason for retesting (minimum 10 characters)
            <textarea
              value={retestReason}
              onChange={event => setRetestReason(event.target.value)}
              minLength={10}
              maxLength={2000}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={retestReason.trim().length < 10 || currentUserId < 1}
            onClick={() => onStartRetest(record.id, retestReason.trim())}
          >
            <RotateCcw size={15} /> Start a new linked retest
          </button>
        </section>
      )}
    </section>
  );
}

function DeviationEditor({
  item,
  recordId,
  currentUserId,
  isAdmin,
  activeEditors,
  events,
  onSaved,
}: {
  item: {
    id: number;
    testKey: string;
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
  };
  recordId: number;
  currentUserId: number;
  isAdmin: boolean;
  activeEditors: Array<{
    id: number;
    name: string | null;
    email: string | null;
    role: string;
  }>;
  events: Array<{
    id: number;
    actorName: string | null;
    eventType: string;
    changeData: Record<string, unknown>;
    createdAt: Date;
  }>;
  onSaved: () => void;
}) {
  const [investigation, setInvestigation] = useState(item.investigation);
  const [rootCause, setRootCause] = useState(item.rootCause);
  const [correctiveAction, setCorrectiveAction] = useState(
    item.correctiveAction
  );
  const [preventiveAction, setPreventiveAction] = useState(
    item.preventiveAction
  );
  const [responsibleUserId, setResponsibleUserId] = useState(
    String(item.responsibleUserId ?? currentUserId)
  );
  const [targetCompletionDate, setTargetCompletionDate] = useState(
    item.targetCompletionDate ?? ""
  );
  const [status, setStatus] = useState(item.status);
  const mutation = trpc.records.updateDeviation.useMutation({
    onSuccess: () => {
      onSaved();
      toast.success("Deviation and CAPA update recorded.");
    },
    onError: error => toast.error(error.message),
  });
  useEffect(() => {
    setInvestigation(item.investigation);
    setRootCause(item.rootCause);
    setCorrectiveAction(item.correctiveAction);
    setPreventiveAction(item.preventiveAction);
    setResponsibleUserId(String(item.responsibleUserId ?? currentUserId));
    setTargetCompletionDate(item.targetCompletionDate ?? "");
    setStatus(item.status);
  }, [item.version, currentUserId]);
  const nextStatus = (current: typeof status) =>
    current === "open"
      ? ["open", "investigating"]
      : current === "investigating"
        ? ["investigating", "actions-planned"]
        : current === "actions-planned"
          ? isAdmin
            ? ["actions-planned", "closed"]
            : ["actions-planned"]
          : ["closed"];
  const eventsForItem = events.filter(
    event =>
      event.eventType === "created" || event.changeData.status !== undefined
  );
  return (
    <article className="polarimeter-deviation-card">
      <div className="polarimeter-deviation-heading">
        <strong>
          {item.testKey[0].toUpperCase() + item.testKey.slice(1)} failure
        </strong>
        <span
          className={`lifecycle ${item.status === "closed" ? "approved" : "draft"}`}
        >
          {item.status}
        </span>
      </div>
      <dl className="polarimeter-deviation-evidence">
        <div>
          <dt>Actual saved result</dt>
          <dd>{item.actualResult}</dd>
        </div>
        <div>
          <dt>
            {item.protocolStatus === "approved"
              ? "Acceptance limit"
              : "Configured limit — UNVERIFIED"}
          </dt>
          <dd>{item.acceptanceLimit}</dd>
        </div>
      </dl>
      <label>
        Investigation
        <textarea
          value={investigation}
          onChange={event => setInvestigation(event.target.value)}
          maxLength={5000}
        />
      </label>
      <label>
        Root cause
        <textarea
          value={rootCause}
          onChange={event => setRootCause(event.target.value)}
          maxLength={5000}
        />
      </label>
      <label>
        Corrective action
        <textarea
          value={correctiveAction}
          onChange={event => setCorrectiveAction(event.target.value)}
          maxLength={5000}
        />
      </label>
      <label>
        Preventive action (where applicable)
        <textarea
          value={preventiveAction}
          onChange={event => setPreventiveAction(event.target.value)}
          maxLength={5000}
        />
      </label>
      <div className="polarimeter-capa-fields">
        <label>
          Responsible person
          <select
            value={responsibleUserId}
            onChange={event => setResponsibleUserId(event.target.value)}
          >
            <option value="">Select responsible person</option>
            {(isAdmin
              ? activeEditors
              : activeEditors.filter(user => user.id === currentUserId)
            ).map(user => (
              <option key={user.id} value={user.id}>
                {user.name || user.email} · {user.role}
              </option>
            ))}
            {!isAdmin &&
              currentUserId > 0 &&
              !activeEditors.some(user => user.id === currentUserId) && (
                <option value={currentUserId}>Current user</option>
              )}
          </select>
        </label>
        <label>
          Target completion date
          <input
            type="date"
            value={targetCompletionDate}
            onChange={event => setTargetCompletionDate(event.target.value)}
          />
        </label>
        <label>
          Closure status
          <select
            value={status}
            onChange={event => setStatus(event.target.value as typeof status)}
          >
            {nextStatus(item.status).map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {status === "closed" &&
        (!investigation.trim() ||
          !rootCause.trim() ||
          !correctiveAction.trim() ||
          !responsibleUserId ||
          !targetCompletionDate) && (
          <p className="polarimeter-failure">
            Complete the investigation, root cause, corrective action,
            responsible person and target date before closure.
          </p>
        )}
      <button
        type="button"
        className="secondary-button"
        disabled={mutation.isPending || !responsibleUserId}
        onClick={() =>
          mutation.mutate({
            recordId,
            deviationId: item.id,
            expectedVersion: item.version,
            investigation,
            rootCause,
            correctiveAction,
            preventiveAction,
            responsibleUserId: responsibleUserId
              ? Number(responsibleUserId)
              : null,
            targetCompletionDate: targetCompletionDate || null,
            status,
          })
        }
      >
        <Save size={15} /> Save CAPA
      </button>
      <details className="polarimeter-deviation-audit">
        <summary>CAPA audit trail ({eventsForItem.length})</summary>
        {eventsForItem.length ? (
          eventsForItem.map(event => (
            <p key={event.id}>
              {event.actorName || "User"} ·{" "}
              {new Date(event.createdAt).toLocaleString()} · {event.eventType} ·{" "}
              {String(
                event.changeData.status ??
                  event.changeData.testKey ??
                  "case updated"
              )}
            </p>
          ))
        ) : (
          <p>No CAPA events recorded.</p>
        )}
      </details>
    </article>
  );
}
