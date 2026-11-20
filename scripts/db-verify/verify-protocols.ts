/**
 * Verifies server/sql/protocol_management_migration.sql against a REAL
 * PostgreSQL server (embedded-postgres) and runs the actual Protocol
 * Management service (server/protocols/service.ts) on top of it, sending the
 * exact JSON payload the Supabase store sends to rpc/protocol_apply_changes.
 *
 * It does NOT run PostgREST and does NOT touch the deployed Supabase project.
 * After applying the migration in Supabase use GET /api/health/schema
 * (protocolManagement.ok) to confirm the deployed schema.
 *
 *   cd scripts/db-verify && npm install && cd ../.. && npx tsx scripts/db-verify/verify-protocols.ts
 */
import { isDeepStrictEqual } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as svc from "../../server/protocols/service";
import * as wf from "../../server/protocols/workflowService";
import { toRpcPayload } from "../../server/protocols/supabaseStore";
import { PROTOCOL_TABLES, PROTOCOL_WORKFLOW_TABLE_NAMES, ProtocolConflictError, assertColumns, type ProtocolStore, type ProtocolTable, type Row, type SelectOptions } from "../../server/protocols/tables";

delete process.env.QC_STORAGE_MODE;
delete process.env.SUPABASE_URL; // equipment registry falls back to the built-in device list

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/sql");
const read = (f: string) => fs.readFileSync(path.join(sqlDir, f), "utf8");

// PostgREST-like JSON value shapes: bigint/numeric → number, timestamptz → ISO string.
pg.types.setTypeParser(20, v => Number(v));
pg.types.setTypeParser(1700, v => Number(v));
pg.types.setTypeParser(1184, v => new Date(v).toISOString());
pg.types.setTypeParser(1082, v => v);

const port = 54330;
/** Supabase Auth is not available here: the e-signature verifier is replaced (password "sign"); the real check is covered by the SQLite tests. */
const SIGN = "sign";
svc.setSignatureVerifierForTests(async (_actor, password) => password === SIGN);
/** The module migration as merged before the v2 extension (PR #4) — used to prove the in-place upgrade. */
const V1_COMMIT = "2b56f65";
const server = new EmbeddedPostgres({ databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), "qc-pg-protocols-")), user: "postgres", password: "pw", port, persistent: false });
let failures = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};
async function rejects(name: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
    ok(`${name} (expected rejection, got success)`, false);
  } catch (e) {
    const err = e as Error & { details?: unknown };
    const msg = `${err.message} ${err.details ? JSON.stringify(err.details) : ""}`;
    ok(`${name} → rejected`, pattern.test(msg), msg.slice(0, 140));
  }
}

await server.initialise();
await server.start();
const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "pw", database: "postgres" });
await client.connect();
const q = (s: string, p?: unknown[]) => client.query(s, p as unknown[]);

/** Same contract as supabaseProtocolStore: reads by whitelisted columns, writes only via the RPC. */
const pgStore: ProtocolStore = {
  kind: "supabase",
  async select<T extends Row = Row>(table: ProtocolTable, options: SelectOptions = {}) {
    const columns = options.columns ?? Object.keys(PROTOCOL_TABLES[table]);
    assertColumns(table, columns);
    const params: unknown[] = [];
    const where: string[] = [];
    Object.entries(options.where ?? {}).forEach(([c, v]) => {
      assertColumns(table, [c]);
      if (v === null) where.push(`${c} IS NULL`);
      else {
        params.push(v);
        where.push(`${c} = $${params.length}`);
      }
    });
    if (options.in) {
      if (!options.in.values.length) return [];
      params.push(options.in.values.map(String));
      where.push(`${options.in.column}::text = ANY($${params.length})`);
    }
    const order = options.order?.length ? ` ORDER BY ${options.order.map(o => `${o.column} ${o.desc ? "DESC" : "ASC"}`).join(", ")}` : "";
    const limit = options.limit ? ` LIMIT ${Math.floor(options.limit)}` : "";
    const res = await q(`SET ROLE service_role; SELECT ${columns.join(", ")} FROM public.${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${order}${limit}`.replace("SET ROLE service_role; ", ""), params);
    return res.rows as T[];
  },
  async apply(changes) {
    try {
      await q("SET ROLE service_role");
      await q("SELECT public.protocol_apply_changes($1::jsonb)", [JSON.stringify(toRpcPayload(changes))]);
    } catch (e) {
      if ((e as Error).message.includes("PROTOCOL_CONFLICT")) throw new ProtocolConflictError();
      throw e;
    } finally {
      await q("RESET ROLE");
    }
  },
  async schemaStatus() {
    const res = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`, [Object.keys(PROTOCOL_TABLES)]);
    const present = new Set(res.rows.map(r => r.table_name as string));
    const absent = Object.keys(PROTOCOL_TABLES).filter(t => !present.has(t));
    const workflowMissing = absent.filter(t => PROTOCOL_WORKFLOW_TABLE_NAMES.includes(t as ProtocolTable));
    const missing = absent.filter(t => !workflowMissing.includes(t));
    return { ok: missing.length === 0, missing, workflowOk: workflowMissing.length === 0, workflowMissing };
  },
};

try {
  await q(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
           create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());`);
  await q(read("supabase_schema.sql"));
  await q(read("polarimeter_workflow_migration.sql"));
  const users: Record<string, svc.Actor> = {};
  for (const [key, role] of [["admin", "admin"], ["author", "user"], ["tech", "user"], ["qa", "user"], ["viewer", "viewer"]] as const) {
    const au = await q(`insert into auth.users default values returning id`);
    const r = await q(`insert into app_users (auth_user_id, open_id, email, name, role) values ($1, $2, $3, $4, $5) returning id`, [au.rows[0].id, `supabase:${key}`, `${key}@x.test`, key, role]);
    users[key] = { id: Number(r.rows[0].id), name: key, role };
  }
  await q(`insert into validation_records (instrument_key,instrument_name,instrument_id,sop_number,form_number,result_status,result_data,pharmacist_name,validated_by_user_id)
           values ('polarimeter','Polarimeter','QC-I-029','QC-032D','QC-032B-01','pass','{"legacy":true}','A',$1)`, [users.admin.id]);
  const historyBefore = (await q(`select id, result_data::text, created_at from validation_records order by id`)).rows;

  const v1 = execSync(`git show ${V1_COMMIT}:server/sql/protocol_management_migration.sql`, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  await q(v1);
  const v1Tables = await q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name like 'protocol%'`);
  ok("v1 module migration (already-deployed state) applied", v1Tables.rows[0].n === 11, String(v1Tables.rows[0].n));
  const migration = read("protocol_management_migration.sql");
  await q(migration);
  ok("migration run #1 succeeded (in-place upgrade from v1)", true);
  await q(migration);
  ok("migration run #2 succeeded (idempotent)", true);
  const tables = await q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name like 'protocol%'`);
  ok("17 protocol tables exist (13 core + 4 v3)", tables.rows[0].n === 17, String(tables.rows[0].n));
  for (const [table, cols] of Object.entries(PROTOCOL_TABLES)) {
    const res = await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [table]);
    const have = new Set(res.rows.map(r => r.column_name));
    const missing = Object.keys(cols).filter(c => !have.has(c));
    ok(`${table}: every whitelisted column exists`, missing.length === 0, missing.join(","));
  }
  const rls = await q(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'protocol%' and c.relkind='r' and c.relrowsecurity`);
  ok("RLS enabled on all protocol tables", rls.rows[0].n === 17, String(rls.rows[0].n));
  const anonPriv = await q(`select count(*)::int n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'protocol%'`);
  ok("anon/authenticated have no table privileges", anonPriv.rows[0].n === 0);
  const svcWrite = await q(`select count(*)::int n from information_schema.role_table_grants where grantee='service_role' and table_name like 'protocol%' and privilege_type in ('INSERT','UPDATE','DELETE')`);
  ok("service_role cannot write tables directly (RPC only)", svcWrite.rows[0].n === 0);
  ok("anon cannot execute protocol_apply_changes", !(await q(`select has_function_privilege('anon','public.protocol_apply_changes(jsonb)','EXECUTE') v`)).rows[0].v);
  ok("service_role can execute protocol_apply_changes", (await q(`select has_function_privilege('service_role','public.protocol_apply_changes(jsonb)','EXECUTE') v`)).rows[0].v);

  // ---- Real service flow over the RPC ----
  svc.setProtocolStoreForTests(pgStore);
  ok("moduleStatus ok", (await svc.moduleStatus()).ok);
  await svc.setDuty(users.admin, { userId: users.qa.id, duty: "qa-approver", granted: true, reason: "QA department" });
  await svc.setDuty(users.admin, { userId: users.qa.id, duty: "releaser", granted: true, reason: "Document control" });
  ok("duty assignment persisted", (await svc.getMe(users.qa)).duties.includes("qa-approver"));
  const ref = await svc.saveReference(users.admin, { code: "MAN-1", title: "Manufacturer manual", issuer: "Maker", referenceType: "manufacturer-manual", documentNumber: "36-102", edition: "3.1", revision: "", publicationDate: "2004-02", effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: "", documentUrl: "", applicableSection: "Specifications", applicableClause: "", verificationStatus: "verified", notes: "", reason: "Library setup" });
  const content = {
    identification: { title: "Generic polarimeter check", number: "GEN-PG-1", protocolType: "PQ", manufacturer: "Bellingham & Stanley", model: "ADP220" },
    narrative: { purpose: "Verify accuracy", scope: "ADP220" },
    stages: ["PQ"],
    risk: { overall: "medium", justification: "QC release instrument" },
    intervals: [{ key: "pr", activity: "Periodic Review", value: 12, unit: "months", justification: "Institutional", verificationStatus: "verified" }],
    sections: [{ key: "pq", title: "PQ", tests: [{ key: "acc", name: "Accuracy", dataType: "reference-comparison", readingsRequired: 3, calculations: [{ key: "error", label: "Error", kind: "error" }], criteria: [{ key: "c1", parameter: "error", comparison: "abs<=", tolerance: 0.02, sourceClass: "manufacturer", referenceId: ref.id, verificationStatus: "verified", verificationEvidence: "Manual §5" }] }] }],
  };
  const created = await svc.createProtocol(users.author, { content, reason: "New" });
  ok("createProtocol via RPC (all NOT NULL columns supplied)", !!created.revisionId);
  const rv = async () => (await svc.getRevision(users.admin, created.revisionId)).revision.rowVersion;
  await rejects("stale row version rejected", () => svc.saveDraft(users.author, { revisionId: created.revisionId, expectedRowVersion: 99, content, reason: "x" }), /modified by another user/);
  const stale = await rv();
  await svc.transition(users.author, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: stale, action: "submit-technical-review" });
  await rejects("duplicate submission rejected", () => svc.transition(users.author, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: stale, action: "submit-technical-review" }), /changed since it was loaded/);
  await rejects("author cannot self-review", () => svc.transition(users.author, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: 2, action: "start-technical-review" }), /Segregation|changed/);
  await svc.transition(users.tech, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: await rv(), action: "start-technical-review" });
  await svc.transition(users.tech, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: await rv(), action: "complete-technical-review", attestation: true, comment: "Technical review complete" });
  await svc.transition(users.author, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: await rv(), action: "submit-qa-review" });
  await svc.transition(users.qa, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: await rv(), action: "start-qa-review" });
  await svc.transition(users.qa, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: await rv(), action: "qa-approve", attestation: true, comment: "Approved" });
  await svc.transition(users.qa, { password: SIGN, revisionId: created.revisionId, expectedRowVersion: await rv(), action: "release", effectiveDate: new Date().toISOString().slice(0, 10) });
  const released = await svc.getRevision(users.admin, created.revisionId);
  ok("full workflow reaches RELEASED on PostgreSQL", released.revision.status === "released" && released.revision.locked === true);
  ok("next review date computed", !!released.revision.nextReviewDate);
  const exec = await svc.executeProtocol(users.author, { revisionId: created.revisionId, instrumentKey: "polarimeter", measurements: { acc: { readings: [10.01, 10, 10.02], reference: 10 } } });
  ok("execution of released revision recorded", exec.evaluation.overall === "PASS");

  const asService = async (sql: string, params: unknown[] = []) => {
    await q("SET ROLE service_role");
    try {
      return await q(sql, params);
    } finally {
      await q("RESET ROLE");
    }
  };
  const rpc = (changes: unknown[]) => asService("SELECT public.protocol_apply_changes($1::jsonb)", [JSON.stringify(changes)]);

  // ---- v2: e-signature, execution review, deviations, attachments, schedule ----
  const gen2 = await svc.createProtocol(users.author, { content: { ...content, identification: { ...content.identification, number: "SIG-PG-1" } }, reason: "Signature" });
  await rejects("PG: signature without password rejected", () => svc.transition(users.author, { revisionId: gen2.revisionId, expectedRowVersion: 1, action: "submit-technical-review" }), /re-enter your password/);
  await rejects("PG: wrong signature password rejected", () => svc.transition(users.author, { revisionId: gen2.revisionId, expectedRowVersion: 1, action: "submit-technical-review", password: "wrong" }), /Nothing was signed/);
  ok("PG: failed signature audited", (await q(`select count(*)::int n from protocol_audit_events where action='signature.failed' and entity_id=$1`, [gen2.revisionId])).rows[0].n === 1);
  ok("PG: approval rows record re-authentication", (await q(`select bool_and(reauthenticated) v from protocol_approvals where revision_id=$1 and signature_meaning is not null`, [created.revisionId])).rows[0].v === true);
  const exec2 = await svc.executeProtocol(users.author, { revisionId: created.revisionId, instrumentKey: "polarimeter", measurements: { acc: { readings: [10.01, 10, 10.02], reference: 10 } }, activityKey: "pr", deviations: [{ description: "Lamp warm-up shortened to 10 min", impact: "None expected", immediateAction: "Repeated reading", reference: "DEV-PG-1" }] });
  const e2 = await svc.getExecution(users.tech, exec2.executionId);
  ok("PG: deviations + activity stored as JSON", e2.deviations[0]?.reference === "DEV-PG-1" && e2.activityName === "Periodic Review");
  await rejects("PG: executor cannot review own execution", () => svc.reviewExecution(users.author, { executionId: exec2.executionId, action: "review", comment: "self", password: SIGN }), /Segregation|requires/);
  await rejects("PG: QA cannot approve before technical review", () => svc.reviewExecution(users.qa, { executionId: exec2.executionId, action: "approve", comment: "skip", password: SIGN }), /technical review|recorded/i);
  await svc.reviewExecution(users.tech, { executionId: exec2.executionId, action: "review", comment: "Raw data checked", password: SIGN });
  await svc.reviewExecution(users.qa, { executionId: exec2.executionId, action: "approve", comment: "QA approved", password: SIGN });
  ok("PG: execution technically reviewed and QA approved", (await svc.getExecution(users.admin, exec2.executionId)).reviewStatus === "approved");
  const reviewRow = (changes: Record<string, unknown>) => ({ op: "insert", table: "protocol_execution_reviews", row: { id: `x-${Math.random()}`, execution_id: exec2.executionId, protocol_id: created.protocolId, signature_meaning: "x", reauthenticated: true, comment: "direct", actor_user_id: users.admin.id, actor_name: "a", actor_role: "admin", created_at: new Date().toISOString(), ...changes } });
  await rejects("DB: decision after final QA decision blocked", () => rpc([reviewRow({ action: "reject", from_status: "reviewed", to_status: "rejected" })]), /final decision|duplicate key|unique/i);
  await rejects("DB: execution reviews append-only", () => q(`update protocol_execution_reviews set comment='x'`), /append-only|not permitted/i);
  const exec3 = await svc.executeProtocol(users.author, { revisionId: created.revisionId, instrumentKey: "polarimeter", measurements: { acc: { readings: [10.01, 10, 10.02], reference: 10 } } });
  await rejects("DB: executor self-review blocked by trigger", () => rpc([{ ...reviewRow({ action: "review", from_status: "recorded", to_status: "reviewed", actor_user_id: users.author.id }), row: { ...reviewRow({ action: "review", from_status: "recorded", to_status: "reviewed", actor_user_id: users.author.id }).row, execution_id: exec3.executionId } }]), /segregation of duties/i);
  await rejects("DB: QA decision without technical review blocked by trigger", () => rpc([{ ...reviewRow({}), row: { ...reviewRow({ action: "approve", from_status: "reviewed", to_status: "approved" }).row, execution_id: exec3.executionId } }]), /technical review/i);
  const fileBytes = Buffer.from("timestamp,reading\n2026-11-18T08:00Z,10.01\n");
  const att = await svc.uploadAttachment(users.author, { entityType: "execution", entityId: exec3.executionId, fileName: "raw.csv", mimeType: "text/csv", contentBase64: fileBytes.toString("base64"), description: "Instrument export" });
  ok("PG: attachment stored with server-side SHA-256", att.sha256 === createHash("sha256").update(fileBytes).digest("hex"));
  const dl = await svc.downloadAttachment(att.id);
  ok("PG: attachment round-trip + integrity", dl.integrityOk && Buffer.from(dl.contentBase64, "base64").equals(fileBytes));
  await rejects("DB: attachments append-only", () => q(`delete from protocol_attachments`), /append-only|not permitted/i);
  await rejects("DB: attachment sha256 format enforced", () => rpc([{ op: "insert", table: "protocol_attachments", row: { id: "bad-sha", entity_type: "execution", entity_id: exec3.executionId, protocol_id: created.protocolId, file_name: "a.txt", mime_type: "text/plain", size_bytes: 1, sha256: "nope", content_base64: "QQ==", description: "", uploaded_by_user_id: users.admin.id, uploaded_by_name: "a", created_at: new Date().toISOString() } }]), /check constraint|violates/i);
  const schedule = await svc.activitySchedule();
  ok("PG: activity schedule computed (Periodic Review excluded)", Array.isArray(schedule) && schedule.every(i => i.activity !== "Periodic Review"));
  const dash = await svc.dashboard();
  ok("PG: dashboard reports execution review queues", typeof dash.stats.executionsAwaitingReview === "number" && dash.stats.executionsAwaitingReview >= 1);

  // ---- Database guards (independent of the application) ----
  await rejects("DB: locked revision content cannot change (RPC)", () => rpc([{ op: "update", table: "protocol_revisions", id: created.revisionId, set: { content: { tampered: true } }, expect: {} }]), /editable|immutable|locked/i);
  await rejects("DB: invalid status transition released→draft", () => q(`update protocol_revisions set status='draft' where id=$1`, [created.revisionId]), /transition|not allowed|immutable/i);
  await rejects("DB: audit events append-only (UPDATE)", () => q(`update protocol_audit_events set reason='x'`), /append-only|not permitted/i);
  await rejects("DB: audit events append-only (DELETE)", () => q(`delete from protocol_audit_events`), /append-only|not permitted/i);
  await rejects("DB: approvals append-only", () => q(`delete from protocol_approvals`), /append-only|not permitted/i);
  await rejects("DB: executions append-only", () => q(`update protocol_executions set overall_result='FAIL'`), /append-only|not permitted/i);
  await rejects("DB: protocols cannot be deleted", () => q(`delete from protocols`), /not permitted|cannot be deleted/i);
  await rejects("DB: references cannot be deleted", () => q(`delete from protocol_references`), /not permitted|cannot be deleted/i);
  await rejects("DB: RPC rejects non-whitelisted table", () => rpc([{ op: "insert", table: "validation_records", row: {} }]), /not allowed|whitelist|unknown table/i);
  await rejects("DB: RPC guarded update with wrong row_version → PROTOCOL_CONFLICT", () => rpc([{ op: "update", table: "protocols", id: created.protocolId, set: { title: "x" }, expect: { row_version: 999 } }]), /PROTOCOL_CONFLICT/);
  const titleAfter = (await q(`select title from protocols where id=$1`, [created.protocolId])).rows[0].title;
  ok("failed change set left data unchanged (atomic)", titleAfter === "Generic polarimeter check");
  await rejects("DB: service_role cannot UPDATE tables directly", () => asService(`update protocols set title='x'`), /permission denied/);
  await rejects("DB: second open revision blocked by unique index", () => rpc([{ op: "insert", table: "protocol_revisions", row: { id: "dup-open-1", protocol_id: created.protocolId, revision_number: 5, status: "draft", content: {}, content_hash: "h", change_reason: "r", locked: false, author_user_id: users.author.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), row_version: 1, reference_ids: [], pending_verification_count: 0, open_gap_count: 0 } }, { op: "insert", table: "protocol_revisions", row: { id: "dup-open-2", protocol_id: created.protocolId, revision_number: 6, status: "draft", content: {}, content_hash: "h", change_reason: "r", locked: false, author_user_id: users.author.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), row_version: 1, reference_ids: [], pending_verification_count: 0, open_gap_count: 0 } }]), /duplicate key|unique/i);

  // ---- POL-QC-032D configuration ----
  const adp = await svc.configureAdp220Draft(users.author);
  ok("POL-QC-032D created as DRAFT", adp.created && (await svc.getProtocolDetail(adp.protocolId)).protocol.status === "draft");
  ok("POL-QC-032D idempotent (no duplicate)", !(await svc.configureAdp220Draft(users.author)).created);
  const refs = await svc.listReferences();
  ok("seeded references are pending verification", refs.filter(r => r.code !== "MAN-1").every(r => r.verificationStatus !== "verified") && refs.length === 5);

  // ---- Reference change flags protocols, approved snapshot preserved ----
  const man = refs.find(r => r.code === "MAN-1")!;
  const change = await svc.saveReference(users.admin, { ...man, publicationDate: man.publicationDate ?? "", effectiveDate: "", expiryDate: "", reviewDate: "", sourceUrl: "", documentUrl: "", applicableClause: "", notes: "", edition: "3.2", expectedRowVersion: man.rowVersion, reason: "New edition" });
  ok("reference change flags released protocol", change.affectedProtocols.includes("GEN-PG-1"));
  const snap = (await svc.getRevision(users.admin, created.revisionId)).revision.referenceSnapshot as { references: Array<{ edition: string }> };
  ok("approval-time reference snapshot preserved", snap.references[0].edition === "3.1");

  // ---- Existing draft update → retrieve → reopen; executions keep measurements + snapshot ----
  const r2 = await svc.createRevision(users.author, { protocolId: created.protocolId, reason: "Add repeatability", description: "Rev 2" });
  const draft2 = await svc.getRevision(users.admin, r2.revisionId);
  const content2 = structuredClone(draft2.revision.content);
  content2.sections[0].tests.push({ ...structuredClone(content2.sections[0].tests[0]), key: "rep", name: "Repeatability", dataType: "series", readingsRequired: 5, calculations: [], criteria: [] });
  const s1 = await svc.saveDraft(users.author, { revisionId: r2.revisionId, expectedRowVersion: draft2.revision.rowVersion, content: content2, reason: "Add repeatability" });
  content2.narrative.scope = "ADP220 (all registered units)";
  const s2 = await svc.saveDraft(users.author, { revisionId: r2.revisionId, expectedRowVersion: s1.rowVersion, content: content2, reason: "Clarify scope" });
  await rejects("PG: stale draft update rejected", () => svc.saveDraft(users.author, { revisionId: r2.revisionId, expectedRowVersion: s1.rowVersion, content: content2, reason: "stale" }), /modified by another user/);
  const reopened2 = await svc.getRevision(users.admin, r2.revisionId);
  ok("PG: updated draft revision reopened intact", reopened2.revision.rowVersion === s2.rowVersion && reopened2.revision.content.sections[0].tests.length === 2 && reopened2.revision.content.narrative.scope === "ADP220 (all registered units)");
  const storedExec = await svc.getExecution(users.admin, exec.executionId);
  ok("PG: execution keeps original measurements", isDeepStrictEqual(storedExec.measurements, { acc: { readings: [10.01, 10, 10.02], reference: 10 } }));
  ok("PG: execution keeps rev-1 protocol snapshot + hash", storedExec.protocolSnapshot.sections[0].tests.length === 1 && storedExec.protocolSnapshot.narrative.scope === "ADP220" && storedExec.contentHash === released.revision.contentHash);

  // ---------------- v3: 8-protocol package, equipment data, calibration runs (real PostgreSQL) ----------------
  ok("PG: workflow schema provisioned", (await svc.moduleStatus()).workflowOk === true);
  // The equipment registry (instrument_profiles) belongs to the core app database (Supabase in production);
  // here it is a throw-away local SQLite file. All protocol / v3 tables remain in real PostgreSQL.
  process.env.QC_STORAGE_MODE = "local";
  process.env.QC_LOCAL_DB_PATH = path.join(os.tmpdir(), `pg-verify-core-${process.pid}.sqlite`);
  const pkg = await wf.importCalibrationPackage(users.author);
  ok("PG: 8 protocols imported as drafts", pkg.created === 8 && pkg.failed === 0, JSON.stringify(pkg.lines.map(l => [l.protocolNumber, l.status])));
  ok("PG: package import idempotent", (await wf.importCalibrationPackage(users.author)).skipped === 8);
  const pol = (await wf.listEquipmentData()).find(e => e.instrumentKey === "polarimeter")!;
  await rejects("PG: critical equipment change requires a reason", () => wf.updateEquipmentData(users.author, { instrumentKey: "polarimeter", expectedSpecsRowVersion: pol.specsRowVersion, identity: pol.identity, specs: { ...pol.specs, resolution: { value: 0.001, unit: "°", source: "Manual" } }, reason: "", reference: "" }), /reason/);
  const upd = await wf.updateEquipmentData(users.author, { instrumentKey: "polarimeter", expectedSpecsRowVersion: pol.specsRowVersion, identity: pol.identity, specs: { ...pol.specs, resolution: { value: 0.001, unit: "°", source: "Manual" } }, reason: "Manual specification entered", reference: "MAN-1" });
  ok("PG: equipment change logged field-by-field", upd.changed === 1);
  await rejects("PG: stale equipment edit rejected (both versions kept)", () => wf.updateEquipmentData(users.author, { instrumentKey: "polarimeter", expectedSpecsRowVersion: pol.specsRowVersion, identity: pol.identity, specs: {}, reason: "stale", reference: "" }), /changed by another user/);
  await rejects("DB: equipment change log append-only", () => q(`delete from protocol_equipment_changes`), /not permitted/);
  const polProtocol = (await wf.runCatalog()).find(c => c.protocolNumber === "CAL-QC-POL-001")!;
  ok("PG: run catalog exposes the canonical nine-step workflow for every device", polProtocol.stepCount === 9, String(polProtocol.stepCount));
  const runA = await wf.createRun(users.author, { protocolId: polProtocol.protocolId, instrumentKey: "polarimeter" });
  const saved = await wf.saveRun(users.author, { runId: runA.runId, expectedRowVersion: 1, measurements: { T06: { notApplicable: true, naJustification: "Not used quantitatively" } } });
  ok("PG: run draft saved as version 2", saved.rowVersion === 2);
  await rejects("PG: concurrent run save → DRAFT_CONFLICT", () => wf.saveRun(users.author, { runId: runA.runId, expectedRowVersion: 1, measurements: {} }), /DRAFT_CONFLICT/);
  const runV1 = await wf.runVersion(runA.runId, 1);
  ok("PG: earlier run version preserved", isDeepStrictEqual(runV1.measurements, {}));
  await rejects("PG: recording blocked while the protocol is not released", () => wf.recordRun(users.author, { runId: runA.runId, expectedRowVersion: 2 }), /released|not released|DRAFT/i);
  await rejects("DB: runs cannot be deleted", () => q(`delete from protocol_runs`), /not permitted/);
  await rejects("DB: run snapshots append-only", () => q(`update protocol_run_snapshots set reason = 'x'`), /not permitted/);
  const pol2 = (await wf.listEquipmentData()).find(e => e.instrumentKey === "polarimeter")!;
  await wf.updateEquipmentData(users.author, { instrumentKey: "polarimeter", expectedSpecsRowVersion: pol2.specsRowVersion, identity: pol2.identity, specs: { ...pol2.specs, location: { value: "QC Lab room 2", unit: "", source: "" } }, reason: "", reference: "" });
  const afterChange = await wf.getRun(users.author, runA.runId);
  ok("PG: open run keeps its equipment snapshot and flags newer data", afterChange.newerEquipmentData === true && afterChange.run.equipmentSnapshot.specs.location === undefined && afterChange.run.equipmentSnapshot.specs.resolution?.value === 0.001);

  const historyAfter = (await q(`select id, result_data::text, created_at from validation_records order by id`)).rows;
  ok("existing validation records unchanged", JSON.stringify(historyBefore) === JSON.stringify(historyAfter));
  const audit = await q(`select count(*)::int n from protocol_audit_events`);
  ok("audit trail populated", audit.rows[0].n > 10, String(audit.rows[0].n));

  // v3 rollback: drops only the 4 v3 tables (+ guards); v2 data survive; re-applying the migration restores v3.
  const coreBefore = (await q(`select count(*)::int n from protocols`)).rows[0].n;
  await q(read("protocol_management_v3_rollback.sql"));
  const afterRollback = (await q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name like 'protocol%'`)).rows[0].n;
  ok("PG: v3 rollback leaves the 13 core tables", afterRollback === 13, String(afterRollback));
  ok("PG: v3 rollback keeps v2 data", (await q(`select count(*)::int n from protocols`)).rows[0].n === coreBefore);
  svc.setProtocolStoreForTests(pgStore);
  ok("PG: after rollback core module ok, workflow reported missing", await svc.moduleStatus().then(st => st.ok && !st.workflowOk));
  await q(read("protocol_management_migration.sql"));
  const reapplied = (await q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name like 'protocol%'`)).rows[0].n;
  ok("PG: migration re-applied after rollback", reapplied === 17, String(reapplied));
} catch (e) {
  console.error("ERROR", e);
  failures++;
} finally {
  svc.setProtocolStoreForTests(null);
  svc.setSignatureVerifierForTests(null);
  await client.end();
  await server.stop();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
