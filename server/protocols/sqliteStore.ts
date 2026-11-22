/** SQLite implementation of the protocol store (offline / desktop mode). */
import { randomUUID } from "node:crypto";
// localDb is imported lazily: node:sqlite must never load in Supabase/serverless mode.
import { SQLITE_PROTOCOL_ADDED_COLUMNS, SQLITE_PROTOCOL_DDL, SQLITE_PROTOCOL_GUARDS, SQLITE_PROTOCOL_POST_UPGRADE } from "./sqliteSchema";
import {
  PROTOCOL_TABLES,
  PROTOCOL_TABLE_NAMES,
  PROTOCOL_WORKFLOW_TABLE_NAMES,
  ProtocolConflictError,
  assertColumns,
  completeRow,
  type Change,
  type ColumnType,
  type ProtocolStore,
  type ProtocolTable,
  type Row,
  type SelectOptions,
} from "./tables";

let ensuredFor: unknown = null;

async function connection() {
  const { localConnection } = await import("../localDb");
  const conn = localConnection();
  if (ensuredFor !== conn) {
    conn.exec(SQLITE_PROTOCOL_DDL);
    SQLITE_PROTOCOL_ADDED_COLUMNS.forEach(({ table, column, ddl }) => {
      const present = (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column);
      if (!present) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    });
    conn.exec(SQLITE_PROTOCOL_POST_UPGRADE);
    conn.exec(SQLITE_PROTOCOL_GUARDS);
    ensuredFor = conn;
  }
  return conn;
}

function toDb(type: ColumnType, value: unknown) {
  if (value === null || value === undefined) return null;
  if (type === "json") return JSON.stringify(value);
  if (type === "bool") return value ? 1 : 0;
  return value as string | number;
}

function fromDb(table: ProtocolTable, row: Record<string, unknown>): Row {
  const cols = PROTOCOL_TABLES[table] as Record<string, ColumnType>;
  const out: Row = {};
  Object.entries(row).forEach(([k, v]) => {
    const type = cols[k];
    if (v === null || v === undefined) out[k] = null;
    else if (type === "json") out[k] = JSON.parse(String(v));
    else if (type === "bool") out[k] = Number(v) === 1;
    else if (type === "int") out[k] = Number(v);
    else out[k] = v;
  });
  return out;
}

export const sqliteProtocolStore: ProtocolStore = {
  kind: "local",
  async select<T extends Row = Row>(table: ProtocolTable, options: SelectOptions = {}): Promise<T[]> {
    const conn = await connection();
    const cols = PROTOCOL_TABLES[table] as Record<string, ColumnType>;
    const columns = options.columns ?? Object.keys(cols);
    assertColumns(table, columns);
    const params: Array<string | number | null> = [];
    const where: string[] = [];
    Object.entries(options.where ?? {}).forEach(([c, v]) => {
      assertColumns(table, [c]);
      if (v === null) where.push(`${c} IS NULL`);
      else {
        where.push(`${c} = ?`);
        params.push(toDb(cols[c], v) as string | number);
      }
    });
    if (options.in) {
      assertColumns(table, [options.in.column]);
      if (!options.in.values.length) return [];
      where.push(`${options.in.column} IN (${options.in.values.map(() => "?").join(",")})`);
      params.push(...options.in.values);
    }
    (options.order ?? []).forEach(o => assertColumns(table, [o.column]));
    const sql = `SELECT ${columns.join(",")} FROM ${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${
      options.order?.length ? ` ORDER BY ${options.order.map(o => `${o.column} ${o.desc ? "DESC" : "ASC"}`).join(",")}` : ""
    }${options.limit ? ` LIMIT ${Math.max(1, Math.floor(options.limit))}` : ""}`;
    const rows = conn.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(r => fromDb(table, r) as T);
  },
  async apply(changes: Change[]) {
    const conn = await connection();
    conn.exec("BEGIN IMMEDIATE");
    try {
      for (const change of changes) {
        const cols = PROTOCOL_TABLES[change.table] as Record<string, ColumnType>;
        if (change.op === "insert" || change.op === "insert-ignore") {
          const row = completeRow(change.table, change.row);
          const names = Object.keys(row);
          conn
            .prepare(`INSERT ${change.op === "insert-ignore" ? "OR IGNORE " : ""}INTO ${change.table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`)
            .run(...names.map(n => toDb(cols[n], row[n])));
        } else {
          const setCols = Object.keys(change.set);
          assertColumns(change.table, setCols);
          const expect = change.expect ?? {};
          assertColumns(change.table, Object.keys(expect));
          const result = conn
            .prepare(
              `UPDATE ${change.table} SET ${setCols.map(c => `${c} = ?`).join(",")} WHERE id = ?${Object.keys(expect)
                .map(c => ` AND ${c} IS ?`)
                .join("")}`
            )
            .run(...setCols.map(c => toDb(cols[c], change.set[c])), change.id, ...Object.keys(expect).map(c => toDb(cols[c], expect[c])));
          if (Number(result.changes) !== 1) throw new ProtocolConflictError();
        }
      }
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  },
  async schemaStatus() {
    const conn = await connection();
    const missing: string[] = [];
    const workflowMissing: string[] = [];
    PROTOCOL_TABLE_NAMES.forEach(table => {
      const present = new Set((conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name));
      const target = PROTOCOL_WORKFLOW_TABLE_NAMES.includes(table) ? workflowMissing : missing;
      Object.keys(PROTOCOL_TABLES[table]).forEach(c => !present.has(c) && target.push(`${table}.${c}`));
    });
    return { ok: missing.length === 0, missing, workflowOk: workflowMissing.length === 0, workflowMissing };
  },
};

/** Protocol data tables emptied by the v4 reset (equipment master, duties and the audit trail are kept). */
export const PROTOCOL_RESET_TABLES = [
  "protocol_run_snapshots",
  "protocol_runs",
  "protocol_execution_reviews",
  "protocol_attachments",
  "protocol_executions",
  "protocol_notification_reads",
  "protocol_notifications",
  "protocol_approvals",
  "protocol_review_comments",
  "protocol_templates",
  "protocol_revisions",
  "protocols",
  "protocol_references",
] as const;

/**
 * Local (SQLite) equivalent of server/sql/protocol_v4_simplified_approval_reset.sql.
 * 1. Writes a full copy of the database to `backupPath` (VACUUM INTO) BEFORE anything is deleted.
 * 2. Inside one transaction: drops the guard triggers of the protocol data tables, deletes their
 *    rows (children first; foreign keys stay enforced), recreates every guard trigger and appends
 *    an audit event. Users, duty assignments, equipment master/specs, validation records and the
 *    audit trail are not touched.
 */
export async function resetProtocolDataSqlite(input: { backupPath: string; actor: { id: number; name: string } }) {
  const conn = await connection();
  const quoted = input.backupPath.replace(/'/g, "''");
  conn.exec(`VACUUM INTO '${quoted}'`);
  const counts: Record<string, number> = {};
  PROTOCOL_RESET_TABLES.forEach(t => {
    counts[t] = Number((conn.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
  });
  const list = PROTOCOL_RESET_TABLES.map(t => `'${t}'`).join(",");
  const triggers = conn.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (${list})`).all() as Array<{ name: string }>;
  conn.exec("BEGIN IMMEDIATE");
  try {
    triggers.forEach(t => conn.exec(`DROP TRIGGER IF EXISTS "${t.name.replace(/"/g, "")}"`));
    PROTOCOL_RESET_TABLES.forEach(t => conn.exec(`DELETE FROM ${t}`));
    conn.exec(SQLITE_PROTOCOL_DDL);
    conn.exec(SQLITE_PROTOCOL_POST_UPGRADE);
    conn.exec(SQLITE_PROTOCOL_GUARDS);
    const t = new Date().toISOString();
    conn
      .prepare("INSERT INTO protocol_audit_events (id, entity_type, entity_id, action, actor_user_id, actor_name, actor_role, previous_value, new_value, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        "module",
        "protocol-data",
        "protocol-data.reset",
        input.actor.id,
        input.actor.name,
        "system",
        JSON.stringify(counts),
        JSON.stringify({ backup: input.backupPath, kept: ["app_users", "protocol_duty_assignments", "instrument_profiles", "protocol_equipment_specs", "protocol_equipment_changes", "validation_records", "protocol_audit_events"] }),
        "Experimental protocol data removed before the new Protocol page / simplified Quality Manager approval (v4). Protocols are re-entered manually.",
        t
      );
    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    // Make sure the guards exist again even after a failure.
    conn.exec(SQLITE_PROTOCOL_DDL);
    conn.exec(SQLITE_PROTOCOL_GUARDS);
    throw error;
  }
  return { backupPath: input.backupPath, deleted: counts, triggersRecreated: triggers.length };
}
