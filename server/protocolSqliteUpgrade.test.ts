/**
 * An existing desktop (SQLite) database created by the first release of the
 * Protocol Management module (PR #4) must be upgraded in place: new columns are
 * added, new tables created, guards installed — and existing rows are kept
 * unchanged and readable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { closeLocalDatabase, createLocalUser, localConnection } from "./localDb";
import * as svc from "./protocols/service";
import { sqliteProtocolStore } from "./protocols/sqliteStore";

const testDatabase = "/tmp/miayar-protocols-upgrade.test.sqlite";
const v1Ddl = readFileSync(path.join(__dirname, "testSupport", "protocolSqliteV1.sql"), "utf8");

describe("protocol management SQLite upgrade from v1", () => {
  beforeAll(() => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_STORAGE_MODE = "local";
    svc.setProtocolStoreForTests(sqliteProtocolStore);
  });
  afterAll(() => {
    svc.setProtocolStoreForTests(null);
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
  });

  it("adds the v2 columns/tables without touching existing executions and approvals", async () => {
    const u = await createLocalUser({ email: "old@upgrade.test", password: "upgrade-test-password-1", name: "Old", role: "admin" });
    const conn = localConnection();
    conn.exec(v1Ddl);
    const t = "2026-01-10T08:00:00.000Z";
    conn.prepare("INSERT INTO protocols (id, protocol_number, title, association_type, protocol_type, status, created_by_user_id, created_at, updated_at) VALUES ('p1', 'OLD-1', 'Old protocol', 'model', 'PQ', 'released', ?, ?, ?)").run(u.id, t, t);
    conn.prepare("INSERT INTO protocol_revisions (id, protocol_id, revision_number, status, content, content_hash, change_reason, locked, author_user_id, created_at, updated_at) VALUES ('r1', 'p1', 1, 'released', '{}', 'h1', 'Initial', 1, ?, ?, ?)").run(u.id, t, t);
    conn.prepare("INSERT INTO protocol_approvals (id, protocol_id, revision_id, revision_number, action, from_status, to_status, signature_meaning, actor_user_id, comment, content_hash, created_at) VALUES ('a1', 'p1', 'r1', 1, 'release', 'approved', 'released', 'Released', ?, 'ok', 'h1', ?)").run(u.id, t);
    conn.prepare("INSERT INTO protocol_executions (id, protocol_id, revision_id, protocol_number, revision_number, content_hash, instrument_key, measurements, evaluation, overall_result, engine_version, protocol_snapshot, executed_by_user_id, executed_at, created_at) VALUES ('e1', 'p1', 'r1', 'OLD-1', 1, 'h1', 'polarimeter', '{\"acc\":{\"readings\":[1]}}', '{}', 'PASS', 'v1', '{}', ?, ?, ?)").run(u.id, t, t);
    const cols = (table: string) => (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
    expect(cols("protocol_executions")).not.toContain("deviations");

    // First access through the store performs the upgrade.
    const rows = await sqliteProtocolStore.select("protocol_executions", { where: { id: "e1" } });
    expect(cols("protocol_executions")).toEqual(expect.arrayContaining(["activity_key", "activity_name", "deviations"]));
    expect(cols("protocol_approvals")).toContain("reauthenticated");
    expect(cols("protocol_execution_reviews").length).toBeGreaterThan(0);
    expect(cols("protocol_attachments")).toContain("sha256");
    expect(rows[0]).toMatchObject({ id: "e1", overall_result: "PASS", measurements: { acc: { readings: [1] } }, deviations: [], activity_key: null });
    const [approval] = await sqliteProtocolStore.select("protocol_approvals", { where: { id: "a1" } });
    expect(approval.reauthenticated).toBe(false); // historical signatures are not retro-labelled as re-authenticated
    // Guards installed after the upgrade still protect historical rows.
    expect(() => conn.prepare("UPDATE protocol_executions SET overall_result = 'FAIL' WHERE id = 'e1'").run()).toThrow(/append-only/);
    // Idempotent: a second connection setup is a no-op.
    closeLocalDatabase();
    expect((await sqliteProtocolStore.select("protocol_executions", { where: { id: "e1" } }))[0].deviations).toEqual([]);
  });
});
