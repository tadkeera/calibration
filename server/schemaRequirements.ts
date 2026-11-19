/**
 * Columns the current server code reads or writes, per table, for the
 * Polarimeter workflow and the shared validation-record lifecycle.
 *
 * Used by the read-only schema health check (GET /api/health/schema) on both
 * storage adapters, so a deployed database that is behind the application is
 * detected explicitly instead of failing with HTTP 400 on the first save.
 */
export const REQUIRED_SCHEMA: ReadonlyArray<{
  table: string;
  columns: readonly string[];
}> = [
  {
    table: "validation_records",
    columns: [
      "id",
      "instrument_key",
      "result_status",
      "lifecycle_status",
      "result_data",
      "validated_by_user_id",
      "record_version",
      "retest_of_record_id",
      "retest_reason",
    ],
  },
  { table: "record_approvals", columns: ["id", "decision", "reason"] },
  {
    table: "polarimeter_drafts",
    columns: [
      "id",
      "user_id",
      "draft_key",
      "protocol_version",
      "payload",
      "version",
    ],
  },
  {
    table: "record_technical_reviews",
    columns: ["id", "validation_record_id", "record_version", "decision"],
  },
  {
    table: "polarimeter_deviations",
    columns: ["id", "validation_record_id", "test_key", "status", "version"],
  },
  {
    table: "polarimeter_deviation_events",
    columns: ["id", "deviation_id", "event_type"],
  },
  { table: "validation_settings", columns: ["device_key", "settings"] },
];

export type SchemaCheck = { table: string; ok: boolean; missing?: string[] };

export type SchemaHealth = {
  ok: boolean;
  storage: "supabase" | "local";
  /** Non-secret hint that identifies which Supabase project answered (first 6 chars of the project ref). */
  projectRefHint?: string;
  checks: SchemaCheck[];
  polarimeterSettingsProvisioned: boolean;
  checkedAt: string;
};
