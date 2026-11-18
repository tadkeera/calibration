import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { closeLocalDatabase, getValidationRecordById } from "./localDb";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof import("node:sqlite").DatabaseSync;
};

const legacyPath = "/tmp/miayar-legacy-migration.test.sqlite";

afterEach(() => {
  closeLocalDatabase();
  if (existsSync(legacyPath)) rmSync(legacyPath);
  delete process.env.QC_LOCAL_DB_PATH;
});

describe("SQLite additive migration of historical validation records", () => {
  it("preserves legacy record content and assigns safe version/retest defaults", async () => {
    closeLocalDatabase();
    if (existsSync(legacyPath)) rmSync(legacyPath);
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      CREATE TABLE app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        open_id TEXT NOT NULL UNIQUE,
        name TEXT,
        email TEXT NOT NULL UNIQUE,
        login_method TEXT NOT NULL DEFAULT 'local',
        role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')),
        is_active INTEGER NOT NULL DEFAULT 1,
        password_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_signed_in TEXT NOT NULL
      );
      CREATE TABLE validation_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_key TEXT NOT NULL,
        instrument_name TEXT NOT NULL,
        instrument_id TEXT NOT NULL,
        sop_number TEXT NOT NULL,
        form_number TEXT NOT NULL,
        result_status TEXT NOT NULL CHECK(result_status IN ('pass','fail')),
        lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_status IN ('draft','approved','rejected')),
        result_data TEXT NOT NULL,
        pharmacist_name TEXT NOT NULL,
        validated_by_user_id INTEGER NOT NULL,
        approved_by_user_id INTEGER,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE record_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        validation_record_id INTEGER NOT NULL,
        approver_user_id INTEGER NOT NULL,
        decision TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO app_users
        (id,open_id,name,email,role,is_active,created_at,updated_at,last_signed_in)
      VALUES
        (7,'local:legacy','Legacy Analyst','legacy@example.test','user',1,
         '2024-03-04T10:00:00.000Z','2024-03-04T10:00:00.000Z','2024-03-04T10:00:00.000Z');
      INSERT INTO validation_records
        (id,instrument_key,instrument_name,instrument_id,sop_number,form_number,
         result_status,lifecycle_status,result_data,pharmacist_name,validated_by_user_id,
         approved_by_user_id,approved_at,created_at,updated_at)
      VALUES
        (65,'refractometer','Legacy Refractometer','QC-I-005','SOP-R-1','FORM-R-1',
         'pass','approved','{"historical":{"precision":"1.2300","note":"do not rewrite"}}',
         'Legacy Analyst',7,8,'2024-03-04T11:00:00.000Z',
         '2024-03-04T10:30:00.000Z','2024-03-04T11:00:00.000Z');
    `);
    legacy.close();
    process.env.QC_LOCAL_DB_PATH = legacyPath;

    const record = await getValidationRecordById(65);
    expect(record).toMatchObject({
      id: 65,
      instrumentKey: "refractometer",
      resultStatus: "pass",
      lifecycleStatus: "approved",
      recordVersion: 1,
      retestOfRecordId: null,
      retestReason: null,
      pharmacistName: "Legacy Analyst",
      validatedByUserId: 7,
      approvedByUserId: 8,
      createdAt: new Date("2024-03-04T10:30:00.000Z"),
    });
    expect(record?.resultData).toEqual({
      historical: { precision: "1.2300", note: "do not rewrite" },
    });

    closeLocalDatabase();
    const migrated = new DatabaseSync(legacyPath);
    const recordColumns = migrated
      .prepare("PRAGMA table_info(validation_records)")
      .all() as Array<{ name: string }>;
    const approvalColumns = migrated
      .prepare("PRAGMA table_info(record_approvals)")
      .all() as Array<{ name: string }>;
    expect(recordColumns.map(column => column.name)).toContain(
      "record_version"
    );
    expect(recordColumns.map(column => column.name)).toContain(
      "retest_of_record_id"
    );
    expect(recordColumns.map(column => column.name)).toContain("retest_reason");
    expect(approvalColumns.map(column => column.name)).toContain("reason");

    const insertRecord = migrated.prepare(
      `INSERT INTO validation_records (
        id,instrument_key,instrument_name,instrument_id,sop_number,form_number,
        result_status,lifecycle_status,result_data,pharmacist_name,
        validated_by_user_id,approved_by_user_id,approved_at,created_at,updated_at,
        record_version,retest_of_record_id,retest_reason
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const timestamp = "2026-01-02T10:00:00.000Z";
    insertRecord.run(
      66,
      "polarimeter",
      "Synthetic Polarimeter",
      "QC-P-001",
      "SOP-P-1",
      "FORM-P-1",
      "fail",
      "draft",
      "{}",
      "Legacy Analyst",
      7,
      null,
      null,
      timestamp,
      timestamp,
      1,
      null,
      null
    );
    insertRecord.run(
      67,
      "refractometer",
      "Legacy Refractometer",
      "QC-I-005",
      "SOP-R-1",
      "FORM-R-1",
      "fail",
      "draft",
      "{}",
      "Legacy Analyst",
      7,
      null,
      null,
      timestamp,
      timestamp,
      1,
      null,
      null
    );
    expect(() =>
      migrated.prepare("DELETE FROM validation_records WHERE id=?").run(66)
    ).toThrow(/Failed Polarimeter measurements are retained/);
    expect(() =>
      migrated
        .prepare("UPDATE validation_records SET result_data=? WHERE id=?")
        .run('{"mutated":true}', 66)
    ).toThrow(/Failed Polarimeter measurements are immutable/);
    expect(
      migrated.prepare("DELETE FROM validation_records WHERE id=?").run(67)
        .changes
    ).toBe(1);
    expect(() =>
      insertRecord.run(
        68,
        "polarimeter",
        "Synthetic invalid retest",
        "QC-P-001",
        "SOP-P-1",
        "FORM-P-1",
        "pass",
        "draft",
        "{}",
        "Legacy Analyst",
        7,
        null,
        null,
        timestamp,
        timestamp,
        1,
        999,
        "Synthetic invalid linked retest reason"
      )
    ).toThrow(/must link to an existing failed Polarimeter record/);
    insertRecord.run(
      69,
      "polarimeter",
      "Synthetic valid retest",
      "QC-P-001",
      "SOP-P-1",
      "FORM-P-1",
      "fail",
      "draft",
      "{}",
      "Legacy Analyst",
      7,
      null,
      null,
      timestamp,
      timestamp,
      1,
      66,
      "Synthetic linked retest reason"
    );
    expect(
      (
        migrated
          .prepare(
            "SELECT retest_of_record_id FROM validation_records WHERE id=?"
          )
          .get(69) as { retest_of_record_id: number }
      ).retest_of_record_id
    ).toBe(66);
    migrated.close();
  });
});
