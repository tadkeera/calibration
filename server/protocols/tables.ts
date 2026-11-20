/**
 * Column registry for the Protocol Management tables.
 *
 * Used by both storage adapters to (de)serialise rows and as a whitelist:
 * no table or column outside this registry can be read or written through the
 * protocol store. Physical DDL lives in sqliteSchema.ts (SQLite) and
 * server/sql/protocol_management_migration.sql (Supabase/PostgreSQL).
 */
export type ColumnType = "text" | "int" | "bool" | "json";

export const PROTOCOL_TABLES = {
  protocols: {
    id: "text", protocol_number: "text", title: "text", description: "text", equipment_category: "text", equipment_type: "text",
    manufacturer: "text", model: "text", instrument_key: "text", equipment_id: "text", association_type: "text", protocol_type: "text",
    intended_use: "text", status: "text", current_revision_id: "text", current_revision_number: "int", released_revision_id: "text",
    released_revision_number: "int", review_flag: "bool", review_flag_reason: "text", created_by_user_id: "int", created_by_name: "text",
    created_at: "text", updated_at: "text", row_version: "int",
  },
  protocol_revisions: {
    id: "text", protocol_id: "text", revision_number: "int", status: "text", content: "json", content_hash: "text", change_reason: "text",
    revision_description: "text", based_on_revision_id: "text", locked: "bool", author_user_id: "int", author_name: "text", submitted_at: "text",
    technical_reviewer_user_id: "int", technical_reviewer_name: "text", technical_reviewed_at: "text", qa_approver_user_id: "int",
    qa_approver_name: "text", approved_at: "text", released_by_user_id: "int", released_by_name: "text", released_at: "text",
    effective_date: "text", next_review_date: "text", superseded_at: "text", superseded_by_revision_id: "text", retired_at: "text",
    reference_snapshot: "json", reference_ids: "json", pending_verification_count: "int", open_gap_count: "int", created_at: "text",
    updated_at: "text", row_version: "int",
  },
  protocol_references: {
    id: "text", code: "text", title: "text", issuer: "text", reference_type: "text", document_number: "text", edition: "text", revision: "text",
    publication_date: "text", effective_date: "text", expiry_date: "text", review_date: "text", source_url: "text", document_url: "text",
    applicable_section: "text", applicable_clause: "text", verification_status: "text", verified_at: "text", verified_by_user_id: "int",
    verified_by_name: "text", notes: "text", created_by_user_id: "int", created_at: "text", updated_at: "text", row_version: "int",
  },
  protocol_approvals: {
    id: "text", protocol_id: "text", revision_id: "text", revision_number: "int", action: "text", from_status: "text", to_status: "text",
    signature_meaning: "text", actor_user_id: "int", actor_name: "text", actor_role: "text", comment: "text", content_hash: "text", created_at: "text",
    reauthenticated: "bool",
  },
  protocol_review_comments: {
    id: "text", protocol_id: "text", revision_id: "text", kind: "text", stage: "text", target_type: "text", target_key: "text", body: "text",
    decision: "text", author_user_id: "int", author_name: "text", status: "text", resolution_note: "text", resolved_by_user_id: "int",
    resolved_by_name: "text", resolved_at: "text", created_at: "text", row_version: "int",
  },
  protocol_audit_events: {
    id: "text", protocol_id: "text", revision_id: "text", revision_number: "int", entity_type: "text", entity_id: "text", action: "text",
    actor_user_id: "int", actor_name: "text", actor_role: "text", previous_value: "json", new_value: "json", reason: "text", created_at: "text",
  },
  protocol_executions: {
    id: "text", protocol_id: "text", revision_id: "text", protocol_number: "text", revision_number: "int", content_hash: "text",
    instrument_key: "text", equipment_id: "text", serial_number: "text", validation_record_id: "int", stage: "text", measurements: "json",
    evaluation: "json", overall_result: "text", engine_version: "text", protocol_snapshot: "json", reference_snapshot: "json", comments: "text",
    executed_by_user_id: "int", executed_by_name: "text", executed_at: "text", created_at: "text",
    activity_key: "text", activity_name: "text", deviations: "json",
  },
  protocol_execution_reviews: {
    id: "text", execution_id: "text", protocol_id: "text", action: "text", from_status: "text", to_status: "text", signature_meaning: "text",
    reauthenticated: "bool", comment: "text", actor_user_id: "int", actor_name: "text", actor_role: "text", created_at: "text",
  },
  protocol_attachments: {
    id: "text", entity_type: "text", entity_id: "text", protocol_id: "text", file_name: "text", mime_type: "text", size_bytes: "int",
    sha256: "text", content_base64: "text", description: "text", uploaded_by_user_id: "int", uploaded_by_name: "text", created_at: "text",
  },
  protocol_notifications: {
    id: "text", kind: "text", recipient_duty: "text", recipient_user_id: "int", protocol_id: "text", revision_id: "text", message: "text",
    dedupe_key: "text", created_at: "text",
  },
  protocol_notification_reads: { id: "text", notification_id: "text", user_id: "int", read_at: "text" },
  protocol_duty_assignments: {
    id: "text", user_id: "int", duty: "text", granted_by_user_id: "int", granted_at: "text", revoked_at: "text", revoked_by_user_id: "int",
  },
  protocol_templates: {
    id: "text", name: "text", template_category: "text", protocol_type: "text", description: "text", structure: "json", is_active: "bool",
    source_revision_id: "text", created_by_user_id: "int", created_by_name: "text", created_at: "text", updated_at: "text", row_version: "int",
  },
  /* -------- v3: equipment specifications, field-level equipment audit, calibration runs -------- */
  /** Typed, unit-aware specification groups per equipment item (identity stays in instrument_profiles). */
  protocol_equipment_specs: {
    id: "text", instrument_key: "text", equipment_type: "text", status: "text", specs: "json", retired_reason: "text", retired_at: "text",
    created_by_user_id: "int", created_by_name: "text", created_at: "text", updated_by_user_id: "int", updated_by_name: "text", updated_at: "text",
    row_version: "int",
  },
  /** Immutable field-level equipment change log (field, old, new, user, time, reason, reference). */
  protocol_equipment_changes: {
    id: "text", change_set_id: "text", instrument_key: "text", field_group: "text", field: "text", label: "text", previous_value: "json",
    new_value: "json", unit: "text", critical: "bool", reason: "text", reference: "text", actor_user_id: "int", actor_name: "text", actor_role: "text",
    created_at: "text",
  },
  /** Calibration runs (dynamic per-protocol workflow). The equipment snapshot is frozen at run creation. */
  protocol_runs: {
    id: "text", run_number: "text", protocol_id: "text", revision_id: "text", protocol_number: "text", revision_number: "int", revision_status: "text",
    content_hash: "text", protocol_snapshot: "json", instrument_key: "text", equipment_snapshot: "json", equipment_version: "text", measurements: "json", evaluation: "json",
    overall_result: "text", current_step: "text", status: "text", execution_id: "text", abandon_reason: "text", created_by_user_id: "int",
    created_by_name: "text", created_at: "text", updated_by_user_id: "int", updated_by_name: "text", updated_at: "text", row_version: "int",
  },
  /** Append-only history of every saved run version (historical versions are never altered). */
  protocol_run_snapshots: {
    id: "text", run_id: "text", row_version: "int", action: "text", measurements: "json", evaluation: "json", overall_result: "text",
    equipment_version: "text", reason: "text", actor_user_id: "int", actor_name: "text", created_at: "text",
  },
} as const satisfies Record<string, Record<string, ColumnType>>;

export type ProtocolTable = keyof typeof PROTOCOL_TABLES;
export const PROTOCOL_TABLE_NAMES = Object.keys(PROTOCOL_TABLES) as ProtocolTable[];
/**
 * v3 tables (equipment specifications page + calibration-run workflow). They are
 * reported separately so that a database that has not yet re-run the migration
 * keeps the existing Protocol Management features working; only the new
 * features report "migration required".
 */
export const PROTOCOL_WORKFLOW_TABLE_NAMES: ProtocolTable[] = ["protocol_equipment_specs", "protocol_equipment_changes", "protocol_runs", "protocol_run_snapshots"];
export const PROTOCOL_CORE_TABLE_NAMES = PROTOCOL_TABLE_NAMES.filter(t => !PROTOCOL_WORKFLOW_TABLE_NAMES.includes(t));
export type SchemaStatus = { ok: boolean; missing: string[]; workflowOk: boolean; workflowMissing: string[] };

export type Row = Record<string, unknown>;
export type Filter = Record<string, string | number | boolean | null>;

export type SelectOptions = {
  where?: Filter;
  in?: { column: string; values: Array<string | number> };
  order?: Array<{ column: string; desc?: boolean }>;
  limit?: number;
  columns?: string[];
};

export type Change =
  | { op: "insert"; table: ProtocolTable; row: Row }
  | { op: "insert-ignore"; table: ProtocolTable; row: Row }
  | { op: "update"; table: ProtocolTable; id: string; set: Row; expect?: Filter };

export interface ProtocolStore {
  readonly kind: "local" | "supabase";
  select<T extends Row = Row>(table: ProtocolTable, options?: SelectOptions): Promise<T[]>;
  /** Applies every change atomically (single transaction). Throws ProtocolConflictError when a guarded update matches no row. */
  apply(changes: Change[]): Promise<void>;
  schemaStatus(): Promise<SchemaStatus>;
}

export class ProtocolConflictError extends Error {
  constructor(message = "The record was changed by another user or is no longer in the expected state. Reload and retry; no changes were saved.") {
    super(message);
    this.name = "ProtocolConflictError";
  }
}

export function assertColumns(table: ProtocolTable, columns: string[]) {
  const known = PROTOCOL_TABLES[table] as Record<string, ColumnType>;
  columns.forEach(c => {
    if (!(c in known)) throw new Error(`Column ${table}.${c} is not part of the protocol schema registry`);
  });
}

/** Complete row (every registry column present, missing ones null) for inserts. */
export function completeRow(table: ProtocolTable, row: Row): Row {
  assertColumns(table, Object.keys(row));
  const out: Row = {};
  Object.keys(PROTOCOL_TABLES[table]).forEach(c => (out[c] = row[c] === undefined ? null : row[c]));
  return out;
}
