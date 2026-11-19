import type { ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { AppRouter } from "../../../../server/routers";
import { PENDING_LABEL, STATUS_LABELS, type RevisionStatus } from "@shared/protocols/model";

export type ProtocolOutputs = inferRouterOutputs<AppRouter>["protocols"];
export type RegistryRowDto = ProtocolOutputs["list"]["rows"][number];
export type RevisionDetailDto = ProtocolOutputs["revision"];
export type ProtocolDetailDto = ProtocolOutputs["detail"];
export type ReferenceRowDto = ProtocolOutputs["references"][number];
export type EquipmentDto = ProtocolOutputs["equipment"][number];

export type PmUser = { id: number; name: string | null; role: "admin" | "user" | "viewer" };

export type Nav =
  | { view: "dashboard" }
  | { view: "registry"; flag?: RegistryFlag; status?: string }
  | { view: "create" }
  | { view: "detail"; protocolId: string; tab?: DetailTab; revisionId?: string }
  | { view: "builder"; revisionId: string }
  | { view: "references" }
  | { view: "review" }
  | { view: "executions"; revisionId?: string }
  | { view: "documents" }
  | { view: "settings" };
export type RegistryFlag = "due-for-review" | "expired-references" | "pending-verification" | "open-gaps" | "review-flag";
export type DetailTab = "overview" | "review" | "revisions" | "compare" | "executions" | "audit";

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "Unknown error"));

export const fmtDate = (v: string | null | undefined, withTime = false) => {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("en-GB", withTime ? { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" } : { dateStyle: "medium", timeZone: "UTC" }).format(d);
};

const TONES: Record<string, string> = {
  draft: "neutral",
  "technical-review-pending": "info",
  "technical-review-in-progress": "info",
  "technical-changes-required": "warn",
  "technically-reviewed": "info",
  "qa-review-pending": "info",
  "qa-review-in-progress": "info",
  "qa-changes-required": "warn",
  approved: "ok-soft",
  released: "ok",
  superseded: "muted",
  retired: "muted",
  rejected: "bad",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`pm-badge pm-tone-${TONES[status] ?? "neutral"}`}>{STATUS_LABELS[status as RevisionStatus] ?? status}</span>;
}

export function ResultBadge({ result }: { result: string }) {
  const tone = result === "PASS" ? "ok" : result === "FAIL" ? "bad" : result === "INCOMPLETE" ? "warn" : result === "UNDER REVIEW" ? "info" : "muted";
  return <span className={`pm-badge pm-tone-${tone}`}>{result}</span>;
}

export function PendingTag({ verified }: { verified: boolean }) {
  return verified ? <span className="pm-badge pm-tone-ok">Verified</span> : <span className="pm-badge pm-tone-warn">{PENDING_LABEL}</span>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="pm-empty">
      <Loader2 className="animate-spin" size={18} /> {label}
    </div>
  );
}

export function ErrorBox({ error, children }: { error?: unknown; children?: ReactNode }) {
  return (
    <div className="pm-alert pm-alert-bad" role="alert">
      <AlertTriangle size={16} />
      <div>{children ?? errorText(error)}</div>
    </div>
  );
}

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`pm-panel ${className}`}>
      {(title || actions) && (
        <header className="pm-panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="pm-row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`pm-field${wide ? " pm-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Prompts for a mandatory reason (ALCOA+ "why"). Returns null when cancelled. */
export function askReason(message: string, fallback = ""): string | null {
  const value = window.prompt(`${message}\n(A reason is required and is stored in the audit trail.)`, fallback);
  if (value === null) return null;
  if (value.trim().length < 3) {
    window.alert("A reason of at least 3 characters is required.");
    return null;
  }
  return value.trim();
}

export const newKey = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Electronic signature (§14 / §20): the signer re-enters the account password.
 * The password is verified on the server for this single action and is never
 * stored or logged.
 */
export function SignatureBox({ meaning, signer, password, onPassword, detail }: { meaning: string | null; signer: string; password: string; onPassword: (v: string) => void; detail?: ReactNode }) {
  return (
    <div className="pm-signature">
      <div className="pm-signature-head">Electronic signature{meaning ? <> — <strong>{meaning}</strong></> : null}</div>
      <div className="pm-muted">
        Signed by <strong>{signer}</strong>. Your identity, the date/time and the signature meaning are recorded{detail ? <> {detail}</> : null}. Re-enter your account password to sign.
      </div>
      <input type="password" autoComplete="current-password" placeholder="Account password" value={password} onChange={e => onPassword(e.target.value)} aria-label="Password for electronic signature" />
    </div>
  );
}
