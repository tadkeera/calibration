/**
 * Supabase (PostgREST) implementation of the protocol store.
 * Reads use PostgREST; every write goes through the single SQL function
 * public.protocol_apply_changes(jsonb), which applies the whole change set in
 * one PostgreSQL transaction with row-version guards (see
 * server/sql/protocol_management_migration.sql).
 */
import { SupabaseRequestError, supabaseRestPath, supabaseRestRequest } from "../supabaseDb";
import {
  PROTOCOL_TABLES,
  PROTOCOL_TABLE_NAMES,
  ProtocolConflictError,
  assertColumns,
  completeRow,
  type Change,
  type ProtocolStore,
  type ProtocolTable,
  type Row,
  type SelectOptions,
} from "./tables";

export const PROTOCOL_MIGRATION_GUIDANCE =
  "Protocol Management tables are missing in Supabase. Apply server/sql/protocol_management_migration.sql in the Supabase SQL Editor (it ends with NOTIFY pgrst, 'reload schema'), then retry. No data was saved by this request.";

const encodeValue = (v: string | number | boolean) => encodeURIComponent(String(v));
const quoteIn = (v: string | number) => (typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '\\"')}"`);

function translate(error: unknown): never {
  if (error instanceof SupabaseRequestError) {
    if (error.message.includes("PROTOCOL_CONFLICT")) throw new ProtocolConflictError();
    if (error.schemaMismatch) throw new Error(`${error.message.split(" — ")[0]} — ${PROTOCOL_MIGRATION_GUIDANCE}`);
    if (error.code === "23505") throw new Error(`Duplicate value rejected by the database (unique constraint). ${error.message}`);
  }
  throw error;
}

/** JSON payload for public.protocol_apply_changes(jsonb) (whitelisted columns only, inserts fully populated). */
export function toRpcPayload(changes: Change[]) {
  return changes.map(change => {
    if (change.op === "update") {
      assertColumns(change.table, [...Object.keys(change.set), ...Object.keys(change.expect ?? {})]);
      return { op: "update", table: change.table, id: change.id, set: change.set, expect: change.expect ?? {} };
    }
    return { op: change.op, table: change.table, row: completeRow(change.table, change.row) };
  });
}

export const supabaseProtocolStore: ProtocolStore = {
  kind: "supabase",
  async select<T extends Row = Row>(table: ProtocolTable, options: SelectOptions = {}): Promise<T[]> {
    const columns = options.columns ?? Object.keys(PROTOCOL_TABLES[table]);
    assertColumns(table, columns);
    const query: string[] = [`select=${columns.join(",")}`];
    Object.entries(options.where ?? {}).forEach(([c, v]) => {
      assertColumns(table, [c]);
      query.push(v === null ? `${c}=is.null` : `${c}=eq.${encodeValue(v)}`);
    });
    if (options.in) {
      assertColumns(table, [options.in.column]);
      if (!options.in.values.length) return [];
      query.push(`${options.in.column}=in.(${encodeURIComponent(options.in.values.map(quoteIn).join(","))})`);
    }
    if (options.order?.length) {
      options.order.forEach(o => assertColumns(table, [o.column]));
      query.push(`order=${options.order.map(o => `${o.column}.${o.desc ? "desc" : "asc"}`).join(",")}`);
    }
    if (options.limit) query.push(`limit=${Math.max(1, Math.floor(options.limit))}`);
    try {
      return await supabaseRestRequest<T[]>(supabaseRestPath(table, query.join("&")));
    } catch (error) {
      translate(error);
    }
  },
  async apply(changes: Change[]) {
    const payload = toRpcPayload(changes);
    try {
      await supabaseRestRequest(supabaseRestPath("rpc/protocol_apply_changes"), {
        method: "POST",
        body: JSON.stringify({ p_changes: payload }),
      });
    } catch (error) {
      translate(error);
    }
  },
  async schemaStatus() {
    const missing: string[] = [];
    for (const table of PROTOCOL_TABLE_NAMES) {
      try {
        await supabaseRestRequest(supabaseRestPath(table, `select=${Object.keys(PROTOCOL_TABLES[table]).join(",")}&limit=0`));
      } catch (error) {
        if (error instanceof SupabaseRequestError && error.schemaMismatch) missing.push(table);
        else throw error;
      }
    }
    try {
      // Probe the transactional write function without changing data (empty change set).
      await supabaseRestRequest(supabaseRestPath("rpc/protocol_apply_changes"), { method: "POST", body: JSON.stringify({ p_changes: [] }) });
    } catch (error) {
      if (error instanceof SupabaseRequestError && error.schemaMismatch) missing.push("rpc/protocol_apply_changes");
      else throw error;
    }
    return { ok: missing.length === 0, missing };
  },
};
