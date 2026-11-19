/**
 * Protocol Management settings (§20, §23). Shows the duty mapping onto the
 * existing application roles, lets a settings administrator grant the
 * explicitly grantable duties (QA approver, releaser) to user accounts,
 * lists structure-only templates and the module audit trail. All changes are
 * enforced and audited on the backend.
 */
import { useMemo, useState } from "react";
import { Settings, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { DEFAULT_DUTIES, GRANTABLE_DUTIES, PROTOCOL_DUTIES, type ProtocolDuty } from "@shared/protocols/workflow";
import { ErrorBox, Loading, Panel, askReason, errorText, fmtDate, type PmUser } from "./common";

const dutyLabel = (id: string) => PROTOCOL_DUTIES.find(d => d.id === id)?.label ?? id;

export function ModuleSettings({ user, duties, storage }: { user: PmUser; duties: readonly string[]; storage: string }) {
  const status = trpc.protocols.moduleStatus.useQuery();
  const templates = trpc.protocols.templates.useQuery();
  const isSettingsAdmin = duties.includes("settings-admin");
  return (
    <div className="pm-grid">
      <Panel title={<><Settings size={16} /> Module status</>}>
        <div className="pm-grid c3">
          <div><div className="pm-muted">Storage</div><strong>{storage || "—"}</strong></div>
          <div><div className="pm-muted">Schema</div>{status.isLoading ? "…" : status.data?.ok ? <span className="pm-badge pm-tone-ok">All protocol tables present</span> : <span className="pm-badge pm-tone-bad">Missing: {status.data?.missing.join(", ") || "unknown"}</span>}</div>
          <div><div className="pm-muted">Your duties</div>{duties.length ? duties.map(d => <span key={d} className="pm-badge pm-tone-info" style={{ marginRight: 4 }}>{dutyLabel(d)}</span>) : <span className="pm-muted">none (read-only)</span>}</div>
        </div>
      </Panel>
      <Panel title={<><ShieldCheck size={16} /> Role → duty mapping</>}>
        <p className="pm-muted" style={{ marginTop: 0 }}>Duties derive from the existing application roles. Segregation of duties is enforced per revision: the author, technical reviewer and QA approver must be different users.</p>
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>Duty</th><th>Description</th><th>admin</th><th>user</th><th>viewer</th></tr></thead>
            <tbody>
              {PROTOCOL_DUTIES.map(d => (
                <tr key={d.id}>
                  <td><strong>{d.label}</strong></td>
                  <td>{d.description}</td>
                  {(["admin", "user", "viewer"] as const).map(role => (
                    <td key={role}>{DEFAULT_DUTIES[role].includes(d.id) ? "✔" : GRANTABLE_DUTIES.includes(d.id) && role === "user" ? <span className="pm-muted">grantable</span> : "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {isSettingsAdmin && user.role === "admin" ? <DutyAssignments /> : <Panel title="Duty assignments"><div className="pm-empty">Managing duty assignments requires the Protocol Settings Administrator duty (admin role).</div></Panel>}
      <Panel title="Templates (structure only — no acceptance limits)">
        {templates.isLoading ? <Loading /> : templates.error ? <ErrorBox error={templates.error} /> : (
          <ul className="pm-list">
            {(templates.data ?? []).map(t => <li key={t.id}><div><strong>{t.name}</strong> <span className="pm-muted">· {t.templateCategory} · {t.protocolType}</span><div className="pm-muted">{t.description}</div></div><span className={`pm-badge ${t.builtin ? "pm-tone-neutral" : "pm-tone-info"}`}>{t.builtin ? "built-in" : "saved"}</span></li>)}
          </ul>
        )}
        <p className="pm-muted">Save a new template from any revision (Revisions tab). Limits, values and verification states are stripped automatically.</p>
      </Panel>
      <AuditTrail />
    </div>
  );
}

function DutyAssignments() {
  const utils = trpc.useUtils();
  const users = trpc.users.list.useQuery();
  const assignments = trpc.protocols.duties.useQuery();
  const setDuty = trpc.protocols.setDuty.useMutation();
  const active = useMemo(() => new Set((assignments.data ?? []).filter(a => !a.revokedAt).map(a => `${a.userId}:${a.duty}`)), [assignments.data]);
  const toggle = async (userId: number, duty: ProtocolDuty, granted: boolean) => {
    const reason = askReason(`${granted ? "Grant" : "Revoke"} "${dutyLabel(duty)}" — reason`);
    if (!reason) return;
    try {
      await setDuty.mutateAsync({ userId, duty, granted, reason });
      await utils.protocols.duties.invalidate();
      toast.success(granted ? "Duty granted" : "Duty revoked");
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  if (users.isLoading || assignments.isLoading) return <Loading />;
  if (users.error || assignments.error) return <ErrorBox error={users.error ?? assignments.error} />;
  const candidates = (users.data ?? []).filter(u => u.role === "user" && u.isActive);
  return (
    <Panel title="Duty assignments (user accounts)">
      {!candidates.length ? <div className="pm-empty">No active accounts with the “user” role.</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>User</th><th>Email</th>{GRANTABLE_DUTIES.map(d => <th key={d}>{dutyLabel(d)}</th>)}</tr></thead>
            <tbody>
              {candidates.map(u => (
                <tr key={u.id}>
                  <td>{u.name ?? `User ${u.id}`}</td>
                  <td>{u.email}</td>
                  {GRANTABLE_DUTIES.map(d => {
                    const has = active.has(`${u.id}:${d}`);
                    return <td key={d}><label className="pm-check"><input type="checkbox" checked={has} disabled={setDuty.isPending} onChange={() => toggle(u.id, d, !has)} /> {has ? "granted" : "—"}</label></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AuditTrail() {
  const [entity, setEntity] = useState("");
  const audit = trpc.protocols.audit.useQuery({ entityType: entity || undefined, limit: 200 });
  return (
    <Panel title="Module audit trail" actions={<select className="pm-input" style={{ maxWidth: 220 }} value={entity} onChange={e => setEntity(e.target.value)}><option value="">All entities</option>{["protocol", "revision", "reference", "execution", "technical-gap", "duty-assignment", "template", "document", "comment"].map(x => <option key={x}>{x}</option>)}</select>}>
      {audit.isLoading ? <Loading /> : audit.error ? <ErrorBox error={audit.error} /> : !audit.data?.length ? <div className="pm-empty">No audit entries.</div> : (
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Rev</th><th>Reason</th></tr></thead>
            <tbody>{audit.data.map(a => <tr key={a.id}><td>{fmtDate(a.createdAt, true)}</td><td>{a.actorName ?? `User ${a.actorUserId}`}</td><td className="pm-mono">{a.action}</td><td>{a.entityType}</td><td>{a.revisionNumber ?? "—"}</td><td>{a.reason ?? ""}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
