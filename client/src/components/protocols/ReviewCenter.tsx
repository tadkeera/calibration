/**
 * Review & Approval Center (§14). Lists revisions waiting for technical
 * review, QA review or controlled release. Every action is executed through
 * the shared ReviewPanel, which calls the backend workflow (duties,
 * segregation of duties and state rules are enforced server-side).
 */
import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { RevisionStatus } from "@shared/protocols/model";
import { ErrorBox, Loading, Panel, StatusBadge, fmtDate, type Nav, type PmUser, type RegistryRowDto } from "./common";
import { ContentView, ReviewPanel } from "./ProtocolDetail";

const QUEUES: Array<{ id: string; title: string; duty: string; statuses: RevisionStatus[] }> = [
  { id: "technical", title: "Technical review", duty: "technical-reviewer", statuses: ["technical-review-pending", "technical-review-in-progress"] },
  { id: "qa", title: "QA review & approval", duty: "qa-approver", statuses: ["technically-reviewed", "qa-review-pending", "qa-review-in-progress"] },
  { id: "release", title: "Awaiting controlled release", duty: "releaser", statuses: ["approved"] },
  { id: "returned", title: "Returned to author", duty: "author", statuses: ["technical-changes-required", "qa-changes-required"] },
];

export function ReviewCenter({ user, setNav }: { user: PmUser; setNav: (n: Nav) => void }) {
  const list = trpc.protocols.list.useQuery({ pageSize: 100, sort: "updatedAt", direction: "desc" });
  const me = trpc.protocols.me.useQuery();
  const [selected, setSelected] = useState<string | null>(null);

  const queues = useMemo(() => {
    const rows = list.data?.rows ?? [];
    return QUEUES.map(q => ({ ...q, rows: rows.filter(r => r.currentRevision && q.statuses.includes(r.currentRevision.status as RevisionStatus)) }));
  }, [list.data]);

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  const truncated = (list.data?.total ?? 0) > (list.data?.rows.length ?? 0);

  return (
    <div className="pm-grid">
      {truncated && <div className="pm-alert pm-alert-info">Showing the 100 most recently updated protocols. Use the Registry status filter for older items.</div>}
      <div className="pm-split">
        <div className="pm-grid">
          {queues.map(q => {
            const mine = me.data?.duties.includes(q.duty as never);
            return (
              <Panel key={q.id} title={<><ClipboardCheck size={16} /> {q.title} <span className="pm-badge pm-tone-neutral">{q.rows.length}</span></>} actions={mine ? <span className="pm-badge pm-tone-info">Your duty</span> : <span className="pm-muted">Requires {q.duty}</span>}>
                {!q.rows.length ? <div className="pm-empty">Nothing in this queue.</div> : <QueueTable rows={q.rows} selected={selected} onSelect={setSelected} />}
              </Panel>
            );
          })}
        </div>
        <div className="pm-grid">
          {selected ? <SelectedRevision revisionId={selected} user={user} setNav={setNav} /> : <Panel title="Review"><div className="pm-empty">Select a revision from a queue to review it.</div></Panel>}
        </div>
      </div>
    </div>
  );
}

function QueueTable({ rows, selected, onSelect }: { rows: RegistryRowDto[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="pm-table-wrap">
      <table className="pm-table">
        <thead><tr><th>Protocol</th><th>Rev</th><th>Status</th><th>Author</th><th>Pending</th><th>Gaps</th><th>Updated</th></tr></thead>
        <tbody>
          {rows.map(r => {
            const rev = r.currentRevision!;
            return (
              <tr key={rev.id} className="is-click" style={selected === rev.id ? { outline: "2px solid #0C5A4C" } : undefined} onClick={() => onSelect(rev.id)}>
                <td><strong>{r.protocolNumber}</strong><div className="pm-muted">{r.title}</div></td>
                <td>{rev.revisionNumber}</td>
                <td><StatusBadge status={rev.status} /></td>
                <td>{rev.authorName ?? "—"}</td>
                <td>{r.pendingVerification}</td>
                <td>{r.openGaps}</td>
                <td>{fmtDate(rev.updatedAt, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SelectedRevision({ revisionId, user, setNav }: { revisionId: string; user: PmUser; setNav: (n: Nav) => void }) {
  const rev = trpc.protocols.revision.useQuery({ revisionId });
  const [showContent, setShowContent] = useState(false);
  if (rev.isLoading) return <Loading />;
  if (rev.error || !rev.data) return <ErrorBox error={rev.error} />;
  const r = rev.data;
  const refName = (id: string) => r.references.find(x => x.id === id)?.code ?? "unknown reference";
  return (
    <>
      <Panel
        title={<>{r.protocol.protocolNumber} rev {r.revision.revisionNumber}</>}
        actions={
          <>
            <button type="button" className="pm-btn small" onClick={() => setShowContent(s => !s)}>{showContent ? "Hide content" : "Show content"}</button>
            <button type="button" className="pm-btn small" onClick={() => setNav({ view: "detail", protocolId: r.protocol.id, tab: "review", revisionId })}>Open protocol</button>
          </>
        }
      >
        <div className="pm-muted">{r.protocol.title}</div>
        {showContent && <ContentView content={r.revision.content} refName={refName} />}
      </Panel>
      <ReviewPanel r={r} user={user} />
    </>
  );
}
