/**
 * SQLite DDL for the Protocol Management module (offline / desktop mode).
 * Idempotent: safe to run on every start. Mirrors
 * server/sql/protocol_management_migration.sql (Supabase/PostgreSQL),
 * including the database-level immutability and status-transition guards.
 * Existing tables are not modified.
 */
import { ALLOWED_STATUS_CHANGES, EDITABLE_STATUSES, LOCKED_STATUSES } from "../../shared/protocols/model";

const list = (values: readonly string[]) => values.map(v => `'${v}'`).join(",");
const transitions = list(ALLOWED_STATUS_CHANGES.map(([a, b]) => `${a}>${b}`));

export const SQLITE_PROTOCOL_DDL = `
CREATE TABLE IF NOT EXISTS protocols (
  id TEXT PRIMARY KEY, protocol_number TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, equipment_category TEXT, equipment_type TEXT,
  manufacturer TEXT, model TEXT, instrument_key TEXT, equipment_id TEXT, association_type TEXT NOT NULL CHECK(association_type IN ('model','equipment')),
  protocol_type TEXT NOT NULL, intended_use TEXT, status TEXT NOT NULL, current_revision_id TEXT, current_revision_number INTEGER,
  released_revision_id TEXT, released_revision_number INTEGER, review_flag INTEGER NOT NULL DEFAULT 0, review_flag_reason TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES app_users(id), created_by_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS protocols_instrument_idx ON protocols(instrument_key);
CREATE TABLE IF NOT EXISTS protocol_revisions (
  id TEXT PRIMARY KEY, protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE RESTRICT, revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
  status TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, change_reason TEXT NOT NULL, revision_description TEXT,
  based_on_revision_id TEXT REFERENCES protocol_revisions(id), locked INTEGER NOT NULL DEFAULT 0, author_user_id INTEGER NOT NULL REFERENCES app_users(id),
  author_name TEXT, submitted_at TEXT, technical_reviewer_user_id INTEGER REFERENCES app_users(id), technical_reviewer_name TEXT, technical_reviewed_at TEXT,
  qa_approver_user_id INTEGER REFERENCES app_users(id), qa_approver_name TEXT, approved_at TEXT, released_by_user_id INTEGER REFERENCES app_users(id),
  released_by_name TEXT, released_at TEXT, effective_date TEXT, next_review_date TEXT, superseded_at TEXT, superseded_by_revision_id TEXT, retired_at TEXT,
  reference_snapshot TEXT, reference_ids TEXT NOT NULL DEFAULT '[]', pending_verification_count INTEGER NOT NULL DEFAULT 0, open_gap_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(protocol_id, revision_number)
);
CREATE INDEX IF NOT EXISTS protocol_revisions_status_idx ON protocol_revisions(status);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_revisions_one_open_idx ON protocol_revisions(protocol_id) WHERE status NOT IN ('released','superseded','retired','rejected');
CREATE UNIQUE INDEX IF NOT EXISTS protocol_revisions_one_released_idx ON protocol_revisions(protocol_id) WHERE status = 'released';
CREATE TABLE IF NOT EXISTS protocol_references (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, issuer TEXT, reference_type TEXT NOT NULL, document_number TEXT, edition TEXT, revision TEXT,
  publication_date TEXT, effective_date TEXT, expiry_date TEXT, review_date TEXT, source_url TEXT, document_url TEXT, applicable_section TEXT, applicable_clause TEXT,
  verification_status TEXT NOT NULL CHECK(verification_status IN ('pending-verification','verified','superseded','withdrawn')), verified_at TEXT,
  verified_by_user_id INTEGER REFERENCES app_users(id), verified_by_name TEXT, notes TEXT, created_by_user_id INTEGER NOT NULL REFERENCES app_users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS protocol_approvals (
  id TEXT PRIMARY KEY, protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE RESTRICT, revision_id TEXT NOT NULL REFERENCES protocol_revisions(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL, action TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL, signature_meaning TEXT,
  actor_user_id INTEGER NOT NULL REFERENCES app_users(id), actor_name TEXT, actor_role TEXT, comment TEXT, content_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS protocol_approvals_revision_idx ON protocol_approvals(revision_id, created_at);
CREATE TABLE IF NOT EXISTS protocol_review_comments (
  id TEXT PRIMARY KEY, protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE RESTRICT, revision_id TEXT NOT NULL REFERENCES protocol_revisions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('comment','gap-decision')), stage TEXT NOT NULL, target_type TEXT NOT NULL, target_key TEXT, body TEXT NOT NULL, decision TEXT,
  author_user_id INTEGER NOT NULL REFERENCES app_users(id), author_name TEXT, status TEXT NOT NULL CHECK(status IN ('open','resolved','recorded')),
  resolution_note TEXT, resolved_by_user_id INTEGER REFERENCES app_users(id), resolved_by_name TEXT, resolved_at TEXT, created_at TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS protocol_review_comments_revision_idx ON protocol_review_comments(revision_id, created_at);
CREATE TABLE IF NOT EXISTS protocol_audit_events (
  id TEXT PRIMARY KEY, protocol_id TEXT, revision_id TEXT, revision_number INTEGER, entity_type TEXT NOT NULL, entity_id TEXT, action TEXT NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES app_users(id), actor_name TEXT, actor_role TEXT, previous_value TEXT, new_value TEXT, reason TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS protocol_audit_events_protocol_idx ON protocol_audit_events(protocol_id, created_at);
CREATE INDEX IF NOT EXISTS protocol_audit_events_entity_idx ON protocol_audit_events(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS protocol_executions (
  id TEXT PRIMARY KEY, protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE RESTRICT, revision_id TEXT NOT NULL REFERENCES protocol_revisions(id) ON DELETE RESTRICT,
  protocol_number TEXT NOT NULL, revision_number INTEGER NOT NULL, content_hash TEXT NOT NULL, instrument_key TEXT NOT NULL, equipment_id TEXT, serial_number TEXT,
  validation_record_id INTEGER REFERENCES validation_records(id) ON DELETE RESTRICT, stage TEXT, measurements TEXT NOT NULL, evaluation TEXT NOT NULL,
  overall_result TEXT NOT NULL CHECK(overall_result IN ('PASS','FAIL','INCOMPLETE','NOT APPLICABLE','UNDER REVIEW')), engine_version TEXT NOT NULL,
  protocol_snapshot TEXT NOT NULL, reference_snapshot TEXT, comments TEXT, executed_by_user_id INTEGER NOT NULL REFERENCES app_users(id), executed_by_name TEXT,
  executed_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS protocol_executions_revision_idx ON protocol_executions(revision_id);
CREATE INDEX IF NOT EXISTS protocol_executions_instrument_idx ON protocol_executions(instrument_key, executed_at);
CREATE INDEX IF NOT EXISTS protocol_executions_record_idx ON protocol_executions(validation_record_id) WHERE validation_record_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS protocol_notifications (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, recipient_duty TEXT, recipient_user_id INTEGER REFERENCES app_users(id), protocol_id TEXT REFERENCES protocols(id),
  revision_id TEXT REFERENCES protocol_revisions(id), message TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS protocol_notifications_created_idx ON protocol_notifications(created_at);
CREATE TABLE IF NOT EXISTS protocol_notification_reads (
  id TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES protocol_notifications(id) ON DELETE RESTRICT, user_id INTEGER NOT NULL REFERENCES app_users(id),
  read_at TEXT NOT NULL, UNIQUE(notification_id, user_id)
);
CREATE TABLE IF NOT EXISTS protocol_duty_assignments (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id), duty TEXT NOT NULL, granted_by_user_id INTEGER NOT NULL REFERENCES app_users(id),
  granted_at TEXT NOT NULL, revoked_at TEXT, revoked_by_user_id INTEGER REFERENCES app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_duty_active_idx ON protocol_duty_assignments(user_id, duty) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS protocol_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, template_category TEXT NOT NULL, protocol_type TEXT NOT NULL, description TEXT, structure TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1, source_revision_id TEXT REFERENCES protocol_revisions(id), created_by_user_id INTEGER NOT NULL REFERENCES app_users(id),
  created_by_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS protocol_execution_reviews (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES protocol_executions(id) ON DELETE RESTRICT,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE RESTRICT, action TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,
  signature_meaning TEXT NOT NULL, reauthenticated INTEGER NOT NULL DEFAULT 0, comment TEXT NOT NULL CHECK(length(trim(comment)) >= 3),
  actor_user_id INTEGER NOT NULL REFERENCES app_users(id), actor_name TEXT, actor_role TEXT, created_at TEXT NOT NULL,
  CHECK ((action = 'review' AND from_status = 'recorded' AND to_status = 'reviewed')
    OR (action = 'approve' AND from_status = 'reviewed' AND to_status = 'approved')
    OR (action = 'reject' AND from_status IN ('recorded','reviewed') AND to_status = 'rejected')),
  UNIQUE(execution_id, from_status)
);
CREATE INDEX IF NOT EXISTS protocol_execution_reviews_execution_idx ON protocol_execution_reviews(execution_id, created_at);
CREATE TRIGGER IF NOT EXISTS protocol_execution_reviews_sequence BEFORE INSERT ON protocol_execution_reviews
BEGIN
  SELECT RAISE(ABORT, 'protocol_execution_reviews: the execution already has a final decision')
    WHERE EXISTS (SELECT 1 FROM protocol_execution_reviews r WHERE r.execution_id = NEW.execution_id AND r.to_status IN ('approved','rejected'));
  SELECT RAISE(ABORT, 'protocol_execution_reviews: QA decision requires a completed technical review')
    WHERE NEW.from_status = 'reviewed' AND NOT EXISTS (SELECT 1 FROM protocol_execution_reviews r WHERE r.execution_id = NEW.execution_id AND r.to_status = 'reviewed');
  SELECT RAISE(ABORT, 'protocol_execution_reviews: the execution is no longer in the recorded state')
    WHERE NEW.from_status = 'recorded' AND EXISTS (SELECT 1 FROM protocol_execution_reviews r WHERE r.execution_id = NEW.execution_id);
  SELECT RAISE(ABORT, 'protocol_execution_reviews: segregation of duties - the executor cannot review or approve their own execution')
    WHERE EXISTS (SELECT 1 FROM protocol_executions e WHERE e.id = NEW.execution_id AND e.executed_by_user_id = NEW.actor_user_id);
END;
CREATE TABLE IF NOT EXISTS protocol_attachments (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('execution','reference')), entity_id TEXT NOT NULL,
  protocol_id TEXT REFERENCES protocols(id), file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 3145728), sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  content_base64 TEXT NOT NULL, description TEXT, uploaded_by_user_id INTEGER NOT NULL REFERENCES app_users(id), uploaded_by_name TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS protocol_attachments_entity_idx ON protocol_attachments(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS protocol_equipment_specs (
  id TEXT PRIMARY KEY, instrument_key TEXT NOT NULL UNIQUE, equipment_type TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  specs TEXT NOT NULL DEFAULT '{}', retired_reason TEXT, retired_at TEXT, created_by_user_id INTEGER NOT NULL REFERENCES app_users(id), created_by_name TEXT,
  created_at TEXT NOT NULL, updated_by_user_id INTEGER REFERENCES app_users(id), updated_by_name TEXT, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS protocol_equipment_changes (
  id TEXT PRIMARY KEY, change_set_id TEXT NOT NULL, instrument_key TEXT NOT NULL, field_group TEXT NOT NULL, field TEXT NOT NULL, label TEXT,
  previous_value TEXT, new_value TEXT, unit TEXT, critical INTEGER NOT NULL DEFAULT 0, reason TEXT, reference TEXT,
  actor_user_id INTEGER NOT NULL REFERENCES app_users(id), actor_name TEXT, actor_role TEXT, created_at TEXT NOT NULL,
  CHECK(critical = 0 OR length(trim(coalesce(reason, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS protocol_equipment_changes_key_idx ON protocol_equipment_changes(instrument_key, created_at);
CREATE TABLE IF NOT EXISTS protocol_runs (
  id TEXT PRIMARY KEY, run_number TEXT NOT NULL UNIQUE, protocol_id TEXT NOT NULL REFERENCES protocols(id), revision_id TEXT NOT NULL REFERENCES protocol_revisions(id),
  protocol_number TEXT NOT NULL, revision_number INTEGER NOT NULL, revision_status TEXT NOT NULL, content_hash TEXT NOT NULL, protocol_snapshot TEXT NOT NULL, instrument_key TEXT NOT NULL,
  equipment_snapshot TEXT NOT NULL, equipment_version TEXT NOT NULL, measurements TEXT NOT NULL DEFAULT '{}', evaluation TEXT, overall_result TEXT,
  current_step TEXT, status TEXT NOT NULL CHECK(status IN ('draft','recorded','abandoned')), execution_id TEXT REFERENCES protocol_executions(id), abandon_reason TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES app_users(id), created_by_name TEXT, created_at TEXT NOT NULL,
  updated_by_user_id INTEGER REFERENCES app_users(id), updated_by_name TEXT, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS protocol_runs_protocol_idx ON protocol_runs(protocol_id, instrument_key, status);
CREATE TABLE IF NOT EXISTS protocol_run_snapshots (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES protocol_runs(id), row_version INTEGER NOT NULL, action TEXT NOT NULL, measurements TEXT NOT NULL,
  evaluation TEXT, overall_result TEXT, equipment_version TEXT, reason TEXT, actor_user_id INTEGER NOT NULL REFERENCES app_users(id), actor_name TEXT,
  created_at TEXT NOT NULL, UNIQUE(run_id, row_version)
);
CREATE TRIGGER IF NOT EXISTS protocol_runs_guard_update BEFORE UPDATE ON protocol_runs
BEGIN
  SELECT RAISE(ABORT, 'protocol_runs: recorded / abandoned runs are immutable')
    WHERE OLD.status <> 'draft';
  SELECT RAISE(ABORT, 'protocol_runs: protocol, revision, equipment snapshot and creator are immutable')
    WHERE NEW.protocol_id IS NOT OLD.protocol_id OR NEW.revision_id IS NOT OLD.revision_id OR NEW.equipment_snapshot IS NOT OLD.equipment_snapshot
      OR NEW.equipment_version IS NOT OLD.equipment_version OR NEW.content_hash IS NOT OLD.content_hash OR NEW.protocol_snapshot IS NOT OLD.protocol_snapshot OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
      OR NEW.instrument_key IS NOT OLD.instrument_key OR NEW.run_number IS NOT OLD.run_number;
END;

-- Recreated on every start so upgraded databases receive the current transition list
-- (simplified Quality Manager approval: draft>released).
DROP TRIGGER IF EXISTS protocol_revisions_guard_update;
CREATE TRIGGER IF NOT EXISTS protocol_revisions_guard_update BEFORE UPDATE ON protocol_revisions
BEGIN
  SELECT RAISE(ABORT, 'protocol_revisions: protocol_id and revision_number are immutable')
    WHERE NEW.protocol_id IS NOT OLD.protocol_id OR NEW.revision_number IS NOT OLD.revision_number;
  SELECT RAISE(ABORT, 'protocol_revisions: invalid status transition')
    WHERE NEW.status IS NOT OLD.status AND (OLD.status || '>' || NEW.status) NOT IN (${transitions});
  SELECT RAISE(ABORT, 'protocol_revisions: content may only change while the revision is editable (draft or changes required)')
    WHERE (NEW.content IS NOT OLD.content OR NEW.content_hash IS NOT OLD.content_hash)
      AND (OLD.status NOT IN (${list(EDITABLE_STATUSES)}) OR NEW.status IS NOT OLD.status);
  SELECT RAISE(ABORT, 'protocol_revisions: approved revisions are immutable; create a new revision')
    WHERE OLD.locked = 1 AND (NEW.locked IS NOT 1 OR NEW.content IS NOT OLD.content OR NEW.content_hash IS NOT OLD.content_hash
      OR NEW.reference_snapshot IS NOT OLD.reference_snapshot OR NEW.reference_ids IS NOT OLD.reference_ids OR NEW.author_user_id IS NOT OLD.author_user_id
      OR NEW.technical_reviewer_user_id IS NOT OLD.technical_reviewer_user_id OR NEW.qa_approver_user_id IS NOT OLD.qa_approver_user_id
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.technical_reviewed_at IS NOT OLD.technical_reviewed_at OR NEW.change_reason IS NOT OLD.change_reason
      OR (OLD.released_at IS NOT NULL AND NEW.released_at IS NOT OLD.released_at));
  SELECT RAISE(ABORT, 'protocol_revisions: only approved/released/superseded/retired revisions can be locked')
    WHERE NEW.locked = 1 AND NEW.status NOT IN (${list(LOCKED_STATUSES)});
  SELECT RAISE(ABORT, 'protocol_revisions: approved, released, superseded and retired revisions must stay locked')
    WHERE NEW.locked IS NOT 1 AND NEW.status IN (${list(LOCKED_STATUSES)});
END;
CREATE TRIGGER IF NOT EXISTS protocol_review_comments_guard_update BEFORE UPDATE ON protocol_review_comments
BEGIN
  SELECT RAISE(ABORT, 'protocol_review_comments: comment content and gap decisions are immutable')
    WHERE OLD.kind = 'gap-decision' OR OLD.status <> 'open' OR NEW.body IS NOT OLD.body OR NEW.kind IS NOT OLD.kind OR NEW.decision IS NOT OLD.decision
      OR NEW.author_user_id IS NOT OLD.author_user_id OR NEW.revision_id IS NOT OLD.revision_id OR NEW.created_at IS NOT OLD.created_at;
END;
`;

/** Append-only / no-delete guards (generated for each table). */
const appendOnly = ["protocol_approvals", "protocol_audit_events", "protocol_executions", "protocol_notifications", "protocol_notification_reads", "protocol_execution_reviews", "protocol_attachments", "protocol_equipment_changes", "protocol_run_snapshots"];
const noDelete = ["protocols", "protocol_revisions", "protocol_references", "protocol_review_comments", "protocol_templates", "protocol_duty_assignments", "protocol_equipment_specs", "protocol_runs", ...appendOnly];

export const SQLITE_PROTOCOL_GUARDS =
  appendOnly
    .map(t => `CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`)
    .join("\n") +
  "\n" +
  noDelete
    .map(t => `CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t}: deletion is not permitted (historical records are preserved)'); END;`)
    .join("\n");

/**
 * Columns added after the first release of the module. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", so each is added only when missing (idempotent).
 */
export const SQLITE_PROTOCOL_ADDED_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "protocol_approvals", column: "reauthenticated", ddl: "reauthenticated INTEGER NOT NULL DEFAULT 0" },
  { table: "protocol_executions", column: "activity_key", ddl: "activity_key TEXT" },
  { table: "protocol_executions", column: "activity_name", ddl: "activity_name TEXT" },
  { table: "protocol_executions", column: "deviations", ddl: "deviations TEXT NOT NULL DEFAULT '[]'" },
];
export const SQLITE_PROTOCOL_POST_UPGRADE = `CREATE INDEX IF NOT EXISTS protocol_executions_activity_idx ON protocol_executions(protocol_id, instrument_key, activity_key, executed_at);`;
