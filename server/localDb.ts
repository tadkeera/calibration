import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { devices, defaultSettings } from "../client/src/lib/qc";
import { versionPolarimeterSettings } from "../shared/polarimeter";
import {
  REQUIRED_SCHEMA,
  type SchemaCheck,
  type SchemaHealth,
} from "./schemaRequirements";
import {
  assertCanAcceptTechnicalReview,
  assertCanApprovePolarimeter,
  polarimeterFailureCases,
  validateDeviationClosure,
} from "./polarimeterWorkflow";
import {
  assertPolarimeterEquipmentSnapshot,
  normalizeServerEvaluatedResult,
} from "./validationRecompute";
import {
  createRecordSummary,
  decisionSummary,
  exportRecordSummary,
  updateRecordSummary,
} from "./validationUtils";
import type {
  AdminActivityEventType,
  AdminActivityFilters,
  AppRole,
  AppUser,
  InstrumentProfilePayload,
  RecordFilters,
} from "./supabaseDb";

const requireFromServer = createRequire(import.meta.url);
type SQLiteDatabase = import("node:sqlite").DatabaseSync;
type SQLiteConstructor = typeof import("node:sqlite").DatabaseSync;
const { DatabaseSync: SQLiteDatabaseSync } = requireFromServer(
  "node:sqlite"
) as { DatabaseSync: SQLiteConstructor };

type RecordPayload = {
  instrumentKey: string;
  instrumentName: string;
  instrumentId: string;
  sopNumber: string;
  formNumber: string;
  resultStatus: "pass" | "fail";
  pharmacistName: string;
  resultData: Record<string, unknown>;
  retestOfRecordId?: number | null;
  retestReason?: string | null;
};
type LocalUserRow = {
  id: number;
  open_id: string;
  name: string | null;
  email: string;
  login_method: string;
  role: AppRole;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_signed_in: string;
  password_hash: string | null;
};
type LocalRecordRow = {
  id: number;
  instrument_key: string;
  instrument_name: string;
  instrument_id: string;
  sop_number: string;
  form_number: string;
  result_status: "pass" | "fail";
  lifecycle_status: "draft" | "approved" | "rejected";
  result_data: string;
  pharmacist_name: string;
  validated_by_user_id: number;
  approved_by_user_id: number | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  record_version: number;
  retest_of_record_id: number | null;
  retest_reason: string | null;
};

const now = () => new Date().toISOString();
const dbPath = () =>
  resolve(process.env.QC_LOCAL_DB_PATH || "./data/miayar-offline.sqlite");
let singleton: SQLiteDatabase | null = null;

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}
function parseJson<T>(value: string | null | undefined, fallback: T) {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function passwordMatches(password: string, stored: string | null) {
  if (!stored) return false;
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function database() {
  if (singleton) return singleton;
  const filename = dbPath();
  mkdirSync(dirname(filename), { recursive: true });
  const connection = new SQLiteDatabaseSync(filename);
  singleton = connection;
  connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, open_id TEXT NOT NULL UNIQUE, name TEXT, email TEXT NOT NULL UNIQUE, login_method TEXT NOT NULL DEFAULT 'local', role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')), is_active INTEGER NOT NULL DEFAULT 1, password_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_signed_in TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS validation_records (id INTEGER PRIMARY KEY AUTOINCREMENT, instrument_key TEXT NOT NULL, instrument_name TEXT NOT NULL, instrument_id TEXT NOT NULL, sop_number TEXT NOT NULL, form_number TEXT NOT NULL, result_status TEXT NOT NULL CHECK(result_status IN ('pass','fail')), lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_status IN ('draft','approved','rejected')), result_data TEXT NOT NULL, pharmacist_name TEXT NOT NULL, validated_by_user_id INTEGER NOT NULL, approved_by_user_id INTEGER, approved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_version INTEGER NOT NULL DEFAULT 1, retest_of_record_id INTEGER REFERENCES validation_records(id), retest_reason TEXT);
    CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, validation_record_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, action TEXT NOT NULL, previous_status TEXT, next_status TEXT, summary TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS record_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, validation_record_id INTEGER NOT NULL, approver_user_id INTEGER NOT NULL, decision TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS instrument_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, instrument_key TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, instrument_id TEXT NOT NULL, sop_number TEXT NOT NULL, manufacturer TEXT NOT NULL, model TEXT NOT NULL, serial_number TEXT NOT NULL, form_number TEXT NOT NULL, accent TEXT NOT NULL, updated_by_user_id INTEGER, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS instrument_change_events (id INTEGER PRIMARY KEY AUTOINCREMENT, instrument_key TEXT NOT NULL, editor_user_id INTEGER NOT NULL, previous_data TEXT, next_data TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS validation_settings (device_key TEXT PRIMARY KEY, settings TEXT NOT NULL, updated_by_user_id INTEGER, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_activity_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, actor_user_id INTEGER, subject_user_id INTEGER, email TEXT, summary TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS polarimeter_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, draft_key TEXT NOT NULL, protocol_version TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, draft_key));
    CREATE TABLE IF NOT EXISTS record_technical_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, validation_record_id INTEGER NOT NULL REFERENCES validation_records(id) ON DELETE RESTRICT, record_version INTEGER NOT NULL, reviewer_user_id INTEGER NOT NULL REFERENCES app_users(id), decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')), comments TEXT NOT NULL, rejection_reason TEXT, outstanding_issues TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS polarimeter_deviations (id INTEGER PRIMARY KEY AUTOINCREMENT, validation_record_id INTEGER NOT NULL REFERENCES validation_records(id) ON DELETE RESTRICT, test_key TEXT NOT NULL CHECK(test_key IN ('accuracy','repeatability','linearity')), actual_result TEXT NOT NULL, acceptance_limit TEXT NOT NULL, protocol_status TEXT NOT NULL CHECK(protocol_status IN ('approved','pending-verification')), investigation TEXT NOT NULL DEFAULT '', root_cause TEXT NOT NULL DEFAULT '', corrective_action TEXT NOT NULL DEFAULT '', preventive_action TEXT NOT NULL DEFAULT '', responsible_user_id INTEGER REFERENCES app_users(id), target_completion_date TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','actions-planned','closed')), version INTEGER NOT NULL DEFAULT 1, created_by_user_id INTEGER NOT NULL REFERENCES app_users(id), updated_by_user_id INTEGER NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, UNIQUE(validation_record_id,test_key));
    CREATE TABLE IF NOT EXISTS polarimeter_deviation_events (id INTEGER PRIMARY KEY AUTOINCREMENT, deviation_id INTEGER NOT NULL REFERENCES polarimeter_deviations(id) ON DELETE RESTRICT, actor_user_id INTEGER NOT NULL REFERENCES app_users(id), event_type TEXT NOT NULL, change_data TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS record_technical_reviews_record_idx ON record_technical_reviews(validation_record_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS polarimeter_deviations_record_idx ON polarimeter_deviations(validation_record_id);
    CREATE INDEX IF NOT EXISTS polarimeter_deviation_events_deviation_idx ON polarimeter_deviation_events(deviation_id, created_at DESC);
  `);
  const validationColumns = new Set(
    (
      connection
        .prepare("PRAGMA table_info(validation_records)")
        .all() as Array<{ name: string }>
    ).map(column => column.name)
  );
  if (!validationColumns.has("record_version"))
    connection.exec(
      "ALTER TABLE validation_records ADD COLUMN record_version INTEGER NOT NULL DEFAULT 1"
    );
  if (!validationColumns.has("retest_of_record_id"))
    connection.exec(
      "ALTER TABLE validation_records ADD COLUMN retest_of_record_id INTEGER REFERENCES validation_records(id)"
    );
  if (!validationColumns.has("retest_reason"))
    connection.exec(
      "ALTER TABLE validation_records ADD COLUMN retest_reason TEXT"
    );
  // Same partial index as Supabase (validation_records_retest_parent_idx):
  // ordinary records keep NULL and are not indexed; retests are traceable to their parent.
  connection.exec(
    "CREATE INDEX IF NOT EXISTS validation_records_retest_parent_idx ON validation_records(retest_of_record_id) WHERE retest_of_record_id IS NOT NULL"
  );
  const approvalColumns = new Set(
    (
      connection.prepare("PRAGMA table_info(record_approvals)").all() as Array<{
        name: string;
      }>
    ).map(column => column.name)
  );
  if (!approvalColumns.has("reason"))
    connection.exec("ALTER TABLE record_approvals ADD COLUMN reason TEXT");
  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS polarimeter_failure_record_immutable
    BEFORE UPDATE ON validation_records
    WHEN OLD.instrument_key='polarimeter' AND OLD.result_status='fail' AND (
      NEW.instrument_key IS NOT OLD.instrument_key OR
      NEW.instrument_name IS NOT OLD.instrument_name OR
      NEW.instrument_id IS NOT OLD.instrument_id OR
      NEW.sop_number IS NOT OLD.sop_number OR
      NEW.form_number IS NOT OLD.form_number OR
      NEW.result_status IS NOT OLD.result_status OR
      NEW.result_data IS NOT OLD.result_data OR
      NEW.pharmacist_name IS NOT OLD.pharmacist_name OR
      NEW.validated_by_user_id IS NOT OLD.validated_by_user_id OR
      NEW.retest_of_record_id IS NOT OLD.retest_of_record_id OR
      NEW.retest_reason IS NOT OLD.retest_reason
    )
    BEGIN
      SELECT RAISE(ABORT, 'Failed Polarimeter measurements are immutable; create a linked retest instead');
    END;
    CREATE TRIGGER IF NOT EXISTS polarimeter_failure_record_no_delete
    BEFORE DELETE ON validation_records
    WHEN OLD.instrument_key='polarimeter' AND OLD.result_status='fail'
    BEGIN
      SELECT RAISE(ABORT, 'Failed Polarimeter measurements are retained; create a linked retest instead');
    END;
    CREATE TRIGGER IF NOT EXISTS polarimeter_retest_link_guard_insert
    BEFORE INSERT ON validation_records
    BEGIN
      SELECT CASE
        WHEN NEW.retest_of_record_id IS NULL AND NEW.retest_reason IS NOT NULL
        THEN RAISE(ABORT, 'A retest reason requires an original record')
        WHEN NEW.retest_of_record_id IS NOT NULL AND (
          NEW.instrument_key <> 'polarimeter' OR
          length(trim(coalesce(NEW.retest_reason, ''))) < 10 OR
          NOT EXISTS (
            SELECT 1 FROM validation_records original
            WHERE original.id=NEW.retest_of_record_id
              AND original.instrument_key='polarimeter'
              AND original.result_status='fail'
              AND original.instrument_id=NEW.instrument_id
          )
        )
        THEN RAISE(ABORT, 'A retest must link to an existing failed Polarimeter record using the same equipment and a reason')
      END;
    END;
    CREATE TRIGGER IF NOT EXISTS polarimeter_retest_link_guard_update
    BEFORE UPDATE OF retest_of_record_id,retest_reason ON validation_records
    BEGIN
      SELECT CASE
        WHEN NEW.retest_of_record_id IS NULL AND NEW.retest_reason IS NOT NULL
        THEN RAISE(ABORT, 'A retest reason requires an original record')
        WHEN NEW.retest_of_record_id IS NOT NULL AND (
          NEW.instrument_key <> 'polarimeter' OR
          length(trim(coalesce(NEW.retest_reason, ''))) < 10 OR
          NOT EXISTS (
            SELECT 1 FROM validation_records original
            WHERE original.id=NEW.retest_of_record_id
              AND original.instrument_key='polarimeter'
              AND original.result_status='fail'
              AND original.instrument_id=NEW.instrument_id
          )
        )
        THEN RAISE(ABORT, 'A retest must link to an existing failed Polarimeter record using the same equipment and a reason')
      END;
    END;
  `);
  const insertSetting = connection.prepare(
    "INSERT OR IGNORE INTO validation_settings (device_key, settings, updated_at) VALUES (?, ?, ?)"
  );
  const insertedProfile = connection.prepare(
    "INSERT OR IGNORE INTO instrument_profiles (instrument_key, name_ar, name_en, instrument_id, sop_number, manufacturer, model, serial_number, form_number, accent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const seededAt = now();
  Object.entries(defaultSettings).forEach(([key, settings]) =>
    insertSetting.run(key, json(settings), seededAt)
  );
  devices.forEach(device =>
    insertedProfile.run(
      device.key,
      device.name,
      device.english,
      device.id,
      device.sop,
      device.manufacturer,
      device.model,
      device.serial,
      device.form,
      device.accent,
      seededAt
    )
  );
  return connection;
}

function mapUser(row: LocalUserRow): AppUser {
  return {
    id: Number(row.id),
    openId: row.open_id,
    name: row.name,
    email: row.email,
    loginMethod: row.login_method,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastSignedIn: new Date(row.last_signed_in),
  };
}
function mapRecord(row: LocalRecordRow) {
  return {
    id: Number(row.id),
    instrumentKey: row.instrument_key,
    instrumentName: row.instrument_name,
    instrumentId: row.instrument_id,
    sopNumber: row.sop_number,
    formNumber: row.form_number,
    resultStatus: row.result_status,
    lifecycleStatus: row.lifecycle_status,
    resultData: parseJson<Record<string, unknown>>(row.result_data, {}),
    pharmacistName: row.pharmacist_name,
    validatedByUserId: Number(row.validated_by_user_id),
    approvedByUserId:
      row.approved_by_user_id === null ? null : Number(row.approved_by_user_id),
    approvedAt: row.approved_at ? new Date(row.approved_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    recordVersion: Number(row.record_version ?? 1),
    retestOfRecordId:
      row.retest_of_record_id === null || row.retest_of_record_id === undefined
        ? null
        : Number(row.retest_of_record_id),
    retestReason: row.retest_reason ?? null,
  };
}

function activity(input: {
  eventType: AdminActivityEventType;
  actorUserId?: number | null;
  subjectUserId?: number | null;
  email?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  database()
    .prepare(
      "INSERT INTO admin_activity_events (event_type, actor_user_id, subject_user_id, email, summary, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      input.eventType,
      input.actorUserId ?? null,
      input.subjectUserId ?? null,
      input.email?.toLowerCase() ?? null,
      input.summary,
      json(input.metadata),
      now()
    );
}
function audit(input: {
  recordId: number;
  actorUserId: number;
  action: string;
  previousStatus?: string | null;
  nextStatus?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  database()
    .prepare(
      "INSERT INTO audit_events (validation_record_id, actor_user_id, action, previous_status, next_status, summary, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      input.recordId,
      input.actorUserId,
      input.action,
      input.previousStatus ?? null,
      input.nextStatus ?? null,
      input.summary,
      json(input.metadata),
      now()
    );
}

export function assertControlledSettingsMatch(
  submittedSettings: unknown,
  controlledSettings: Record<string, unknown>
) {
  if (
    !submittedSettings ||
    canonicalJson(submittedSettings) !== canonicalJson(controlledSettings)
  )
    throw new Error(
      "Validation result does not match the current controlled local settings"
    );
}
export async function getUserByOpenId(openId: string) {
  const row = database()
    .prepare("SELECT * FROM app_users WHERE open_id = ? LIMIT 1")
    .get(openId) as LocalUserRow | undefined;
  return row ? mapUser(row) : undefined;
}
export async function getUserById(id: number) {
  const row = database()
    .prepare("SELECT * FROM app_users WHERE id = ? LIMIT 1")
    .get(id) as LocalUserRow | undefined;
  return row ? mapUser(row) : undefined;
}
export async function getUserByEmail(email: string) {
  const row = database()
    .prepare("SELECT * FROM app_users WHERE lower(email) = lower(?) LIMIT 1")
    .get(email) as LocalUserRow | undefined;
  return row ? mapUser(row) : undefined;
}
export async function listUsers() {
  return (
    database()
      .prepare("SELECT * FROM app_users ORDER BY created_at DESC")
      .all() as LocalUserRow[]
  ).map(mapUser);
}

export async function createInitialAdmin() {
  const email = "tadkrah@gmail.com";
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  const password =
    process.env.QC_INITIAL_ADMIN_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;
  if (!password)
    throw new Error(
      "Set QC_INITIAL_ADMIN_PASSWORD before the first offline host launch"
    );
  return createLocalUser({
    email,
    password,
    name: "System Administrator",
    role: "admin",
  });
}
export async function createLocalUser(input: {
  email: string;
  password: string;
  name: string;
  role: AppRole;
}) {
  const existing = await getUserByEmail(input.email);
  if (existing) return existing;
  const timestamp = now();
  const created = database()
    .prepare(
      "INSERT INTO app_users (open_id, name, email, login_method, role, is_active, password_hash, created_at, updated_at, last_signed_in) VALUES (?, ?, ?, 'local', ?, 1, ?, ?, ?, ?)"
    )
    .run(
      `local:${randomBytes(16).toString("hex")}`,
      input.name,
      input.email.toLowerCase(),
      input.role,
      hashPassword(input.password),
      timestamp,
      timestamp,
      timestamp
    );
  return (await getUserById(Number(created.lastInsertRowid)))!;
}
export async function localLogin(input: {
  email: string;
  password: string;
  recordActivity?: boolean;
}) {
  let row = database()
    .prepare("SELECT * FROM app_users WHERE lower(email) = lower(?) LIMIT 1")
    .get(input.email) as LocalUserRow | undefined;
  if (!row && input.email.toLowerCase() === "tadkrah@gmail.com") {
    try {
      await createInitialAdmin();
      row = database()
        .prepare(
          "SELECT * FROM app_users WHERE lower(email) = lower(?) LIMIT 1"
        )
        .get(input.email) as LocalUserRow | undefined;
    } catch {
      /* setup instructions are returned below */
    }
  }
  if (!row || !passwordMatches(input.password, row.password_hash)) {
    activity({
      eventType: "login_failed",
      email: input.email,
      summary: "محاولة تسجيل دخول فاشلة",
      metadata: { reason: "invalid_credentials" },
    });
    throw new Error("Invalid email or password");
  }
  const user = mapUser(row);
  if (!user.isActive) {
    activity({
      eventType: "login_failed",
      subjectUserId: user.id,
      email: user.email,
      summary: "محاولة تسجيل دخول لحساب معطّل",
      metadata: { reason: "inactive_account" },
    });
    throw new Error("User account is unavailable");
  }
  database()
    .prepare(
      "UPDATE app_users SET last_signed_in = ?, updated_at = ? WHERE id = ?"
    )
    .run(now(), now(), user.id);
  if (input.recordActivity !== false)
    activity({
      eventType: "login_succeeded",
      actorUserId: user.id,
      subjectUserId: user.id,
      email: user.email,
      summary: "تم تسجيل الدخول بنجاح",
    });
  return (await getUserById(user.id))!;
}
export async function updateUserRole(input: { id: number; role: AppRole }) {
  database()
    .prepare("UPDATE app_users SET role = ?, updated_at = ? WHERE id = ?")
    .run(input.role, now(), input.id);
  const user = await getUserById(input.id);
  if (!user) throw new Error("User not found");
  return user;
}
export async function changeLocalPassword(input: {
  userId: number;
  currentPassword: string;
  newPassword: string;
}) {
  const row = database()
    .prepare("SELECT * FROM app_users WHERE id = ?")
    .get(input.userId) as LocalUserRow | undefined;
  if (
    !row?.is_active ||
    !passwordMatches(input.currentPassword, row.password_hash)
  )
    throw new Error("Current password is invalid");
  database()
    .prepare(
      "UPDATE app_users SET password_hash = ?, updated_at = ? WHERE id = ?"
    )
    .run(hashPassword(input.newPassword), now(), input.userId);
  activity({
    eventType: "password_changed",
    actorUserId: input.userId,
    subjectUserId: input.userId,
    email: row.email,
    summary: "تم تغيير كلمة المرور",
  });
  return { success: true } as const;
}
export async function requestPasswordRecovery(input: {
  email: string;
  redirectTo: string;
}): Promise<{ readonly success: true }> {
  const profile = await getUserByEmail(input.email);
  activity({
    eventType: "recovery_requested",
    subjectUserId: profile?.id,
    email: input.email,
    summary: "تم طلب استعادة كلمة المرور",
  });
  throw new Error(
    "Offline recovery email is unavailable. Ask a local administrator to reset the password."
  );
}
export async function completePasswordRecovery(_: {
  recoveryToken: string;
  newPassword: string;
}): Promise<{ readonly success: true }> {
  throw new Error(
    "Offline recovery links are unavailable. Ask a local administrator to reset the password."
  );
}
export async function updateUserActiveState(input: {
  id: number;
  isActive: boolean;
  actorUserId: number;
}) {
  if (input.id === input.actorUserId)
    throw new Error("Administrators cannot disable their own account");
  const target = await getUserById(input.id);
  if (!target) throw new Error("User not found");
  if (
    !input.isActive &&
    target.role === "admin" &&
    (await listUsers()).filter(user => user.role === "admin" && user.isActive)
      .length <= 1
  )
    throw new Error("At least one active administrator is required");
  database()
    .prepare("UPDATE app_users SET is_active = ?, updated_at = ? WHERE id = ?")
    .run(input.isActive ? 1 : 0, now(), input.id);
  const user = (await getUserById(input.id))!;
  activity({
    eventType: input.isActive ? "account_enabled" : "account_disabled",
    actorUserId: input.actorUserId,
    subjectUserId: user.id,
    email: user.email,
    summary: input.isActive ? "تمت إعادة تفعيل الحساب" : "تم تعطيل الحساب",
  });
  return user;
}
export async function listAdminActivityEvents(
  filters: AdminActivityFilters = {}
) {
  const conditions: string[] = [];
  const values: Array<string | number | null> = [];
  if (filters.eventType) {
    conditions.push("e.event_type = ?");
    values.push(filters.eventType);
  }
  if (filters.dateFrom) {
    conditions.push("e.created_at >= ?");
    values.push(`${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters.dateTo) {
    const end = new Date(`${filters.dateTo}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push("e.created_at < ?");
    values.push(end.toISOString());
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = database()
    .prepare(
      `SELECT e.*, actor.name AS actor_name, subject.name AS subject_name FROM admin_activity_events e LEFT JOIN app_users actor ON actor.id = e.actor_user_id LEFT JOIN app_users subject ON subject.id = e.subject_user_id ${where} ORDER BY e.created_at DESC LIMIT 300`
    )
    .all(...values) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: Number(row.id),
    eventType: row.event_type as AdminActivityEventType,
    actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
    subjectUserId:
      row.subject_user_id === null ? null : Number(row.subject_user_id),
    actorName: row.actor_name as string | null,
    subjectName: row.subject_name as string | null,
    email: row.email as string | null,
    summary: String(row.summary),
    metadata: parseJson<Record<string, unknown> | null>(
      row.metadata as string | null,
      null
    ),
    createdAt: new Date(String(row.created_at)),
  }));
}
export async function upsertUser(user: Partial<AppUser> & { openId: string }) {
  const existing = await getUserByOpenId(user.openId);
  if (!existing) return;
  database()
    .prepare(
      "UPDATE app_users SET last_signed_in = ?, updated_at = ? WHERE id = ?"
    )
    .run(now(), now(), existing.id);
}

function settingsFor(key: string) {
  const row = database()
    .prepare("SELECT settings FROM validation_settings WHERE device_key = ?")
    .get(key) as { settings: string } | undefined;
  if (!row)
    throw new Error(
      "Controlled validation settings have not been provisioned for this instrument"
    );
  const stored = parseJson<Record<string, unknown>>(row.settings, {});
  return key === "polarimeter"
    ? { ...defaultSettings.polarimeter, ...stored }
    : stored;
}
async function assertCurrentPolarimeterEquipment(input: RecordPayload) {
  if (input.instrumentKey !== "polarimeter") return;
  const profile = (await listInstrumentProfiles()).find(
    entry => entry.instrumentKey === "polarimeter"
  );
  if (!profile)
    throw new Error(
      "The Polarimeter is missing from the existing equipment register"
    );
  assertPolarimeterEquipmentSnapshot(
    input.resultData.polarimeterData,
    {
      instrumentName: input.instrumentName,
      instrumentId: input.instrumentId,
      sopNumber: input.sopNumber,
      formNumber: input.formNumber,
    },
    profile
  );
}

async function assertRetestReference(input: RecordPayload) {
  if (input.retestOfRecordId === undefined || input.retestOfRecordId === null) {
    if (input.retestReason)
      throw new Error("A retest reason requires an original record");
    return;
  }
  if (input.instrumentKey !== "polarimeter")
    throw new Error(
      "Controlled retesting is currently limited to Polarimeter records"
    );
  if (!input.retestReason?.trim() || input.retestReason.trim().length < 10)
    throw new Error("A retest reason of at least 10 characters is required");
  const original = await getValidationRecordById(input.retestOfRecordId);
  if (
    !original ||
    original.instrumentKey !== "polarimeter" ||
    original.resultStatus !== "fail"
  )
    throw new Error(
      "A retest must reference an existing failed Polarimeter record"
    );
  if (original.instrumentId !== input.instrumentId)
    throw new Error(
      "A retest must use the same registered equipment identity as its original record"
    );
}

function ensurePolarimeterFailureCases(recordId: number, actorUserId: number) {
  const record = database()
    .prepare(
      "SELECT instrument_key, result_status, result_data, record_version FROM validation_records WHERE id = ?"
    )
    .get(recordId) as
    | {
        instrument_key: string;
        result_status: string;
        result_data: string;
        record_version: number;
      }
    | undefined;
  if (
    !record ||
    record.instrument_key !== "polarimeter" ||
    record.result_status !== "fail"
  )
    return;
  const cases = polarimeterFailureCases(
    parseJson<Record<string, unknown>>(record.result_data, {})
  );
  const connection = database();
  connection.exec("BEGIN IMMEDIATE");
  try {
    for (const failure of cases) {
      const inserted = connection
        .prepare(
          "INSERT OR IGNORE INTO polarimeter_deviations (validation_record_id, test_key, actual_result, acceptance_limit, protocol_status, created_by_user_id, updated_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          recordId,
          failure.testKey,
          failure.actualResult,
          failure.acceptanceLimit,
          failure.protocolStatus,
          actorUserId,
          actorUserId,
          now(),
          now()
        );
      if (Number(inserted.changes) > 0) {
        const deviation = connection
          .prepare(
            "SELECT id FROM polarimeter_deviations WHERE validation_record_id=? AND test_key=?"
          )
          .get(recordId, failure.testKey) as { id: number };
        connection
          .prepare(
            "INSERT INTO polarimeter_deviation_events (deviation_id, actor_user_id, event_type, change_data, created_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run(
            deviation.id,
            actorUserId,
            "created",
            json({ ...failure, recordVersion: Number(record.record_version) }),
            now()
          );
      }
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export async function createValidationRecord(
  input: RecordPayload & { userId: number }
) {
  const controlled = settingsFor(input.instrumentKey);
  assertControlledSettingsMatch(
    input.resultData.controlledSettings,
    controlled
  );
  await assertCurrentPolarimeterEquipment(input);
  await assertRetestReference(input);
  const evaluated = normalizeServerEvaluatedResult(
    input.instrumentKey,
    input.resultData,
    controlled,
    input.resultStatus
  );
  const resultData = {
    ...evaluated.resultData,
    controlledSettings: controlled,
  };
  const timestamp = now();
  const created = database()
    .prepare(
      "INSERT INTO validation_records (instrument_key, instrument_name, instrument_id, sop_number, form_number, result_status, result_data, pharmacist_name, validated_by_user_id, created_at, updated_at, record_version, retest_of_record_id, retest_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
    )
    .run(
      input.instrumentKey,
      input.instrumentName,
      input.instrumentId,
      input.sopNumber,
      input.formNumber,
      evaluated.resultStatus,
      json(resultData),
      input.pharmacistName,
      input.userId,
      timestamp,
      timestamp,
      input.retestOfRecordId ?? null,
      input.retestOfRecordId ? input.retestReason!.trim() : null
    );
  const record = (await getValidationRecordById(
    Number(created.lastInsertRowid)
  ))!;
  audit({
    recordId: record.id,
    actorUserId: input.userId,
    action: "created",
    nextStatus: "draft",
    summary: createRecordSummary(input.instrumentId, evaluated.resultStatus),
    metadata: {
      resultStatus: evaluated.resultStatus,
      sopNumber: input.sopNumber,
    },
  });
  ensurePolarimeterFailureCases(record.id, input.userId);
  return (await getValidationRecordById(record.id))!;
}
export async function updateValidationRecord(
  input: RecordPayload & { id: number; userId: number; expectedVersion: number }
) {
  const current = await getValidationRecordById(input.id);
  if (!current) throw new Error("Validation record not found");
  if (current.lifecycleStatus !== "draft")
    throw new Error("Only draft records can be edited");
  if (current.recordVersion !== input.expectedVersion)
    throw new Error(
      "Draft version conflict: reload the saved record before editing"
    );
  if (current.validatedByUserId !== input.userId)
    throw new Error("Only the analyst who created a draft may edit it");
  if (
    input.instrumentKey !== current.instrumentKey ||
    input.instrumentName !== current.instrumentName ||
    input.instrumentId !== current.instrumentId ||
    input.sopNumber !== current.sopNumber ||
    input.formNumber !== current.formNumber
  )
    throw new Error(
      "A draft cannot be reassigned to different equipment or protocol identifiers"
    );
  if (
    current.instrumentKey === "polarimeter" &&
    current.resultStatus === "fail"
  )
    throw new Error(
      "Failed Polarimeter measurements are preserved; create a linked retest instead of replacing them"
    );
  const controlled = settingsFor(input.instrumentKey);
  assertControlledSettingsMatch(
    input.resultData.controlledSettings,
    controlled
  );
  await assertCurrentPolarimeterEquipment(input);
  const evaluated = normalizeServerEvaluatedResult(
    input.instrumentKey,
    input.resultData,
    controlled,
    input.resultStatus
  );
  const resultData = {
    ...evaluated.resultData,
    controlledSettings: controlled,
  };
  const updateResult = database()
    .prepare(
      "UPDATE validation_records SET instrument_key=?, instrument_name=?, instrument_id=?, sop_number=?, form_number=?, result_status=?, result_data=?, pharmacist_name=?, updated_at=?, record_version=record_version+1 WHERE id=? AND record_version=? AND lifecycle_status='draft' AND validated_by_user_id=?"
    )
    .run(
      input.instrumentKey,
      input.instrumentName,
      input.instrumentId,
      input.sopNumber,
      input.formNumber,
      evaluated.resultStatus,
      json(resultData),
      input.pharmacistName,
      now(),
      input.id,
      input.expectedVersion,
      input.userId
    );
  if (Number(updateResult.changes) !== 1)
    throw new Error(
      "Draft version conflict: reload the saved record before editing"
    );
  const record = await getValidationRecordById(input.id);
  if (!record) throw new Error("Validation record not found");
  ensurePolarimeterFailureCases(record.id, input.userId);
  audit({
    recordId: input.id,
    actorUserId: input.userId,
    action: "updated",
    previousStatus: "draft",
    nextStatus: "draft",
    summary: updateRecordSummary(input.instrumentId, evaluated.resultStatus),
    metadata: {
      resultStatus: evaluated.resultStatus,
      sopNumber: input.sopNumber,
    },
  });
  return record;
}
export async function approveValidationRecord(input: {
  id: number;
  decision: "approved" | "rejected";
  userId: number;
  expectedVersion?: number;
  reason?: string;
}) {
  const connection = database();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const recordRow = connection
      .prepare("SELECT * FROM validation_records WHERE id=? LIMIT 1")
      .get(input.id) as LocalRecordRow | undefined;
    const record = recordRow ? mapRecord(recordRow) : null;
    if (!record) throw new Error("Validation record not found");
    const approver = connection
      .prepare("SELECT role,is_active FROM app_users WHERE id=? LIMIT 1")
      .get(input.userId) as { role: string; is_active: number } | undefined;
    if (!approver || !approver.is_active || approver.role !== "admin")
      throw new Error(
        "An active administrator is required to decide validation records"
      );
    if (record.lifecycleStatus !== "draft")
      throw new Error("Validation record has already been decided");
    if (
      record.instrumentKey === "polarimeter" &&
      input.expectedVersion === undefined
    )
      throw new Error(
        "Polarimeter lifecycle decisions require the current record version"
      );
    if (
      input.expectedVersion !== undefined &&
      record.recordVersion !== input.expectedVersion
    )
      throw new Error(
        "Approval conflict: the record changed; reload before deciding"
      );
    if (
      input.decision === "rejected" &&
      record.instrumentKey === "polarimeter" &&
      !input.reason?.trim()
    )
      throw new Error(
        "A rejection reason is required for a Polarimeter lifecycle rejection"
      );
    if (input.decision === "approved" && record.resultStatus !== "pass")
      throw new Error(
        "Failed validation records cannot be approved as successful"
      );
    if (
      input.decision === "approved" &&
      record.instrumentKey === "polarimeter"
    ) {
      const polarimeterData = record.resultData.polarimeterData as
        | {
            protocolSnapshot?: { protocolStatus?: string };
            overallResult?: string;
          }
        | undefined;
      if (polarimeterData?.protocolSnapshot?.protocolStatus !== "approved")
        throw new Error(
          "Polarimeter approval is blocked until the protocol is verified and approved"
        );
      if (polarimeterData.overallResult !== "pass")
        throw new Error("Failed Polarimeter tests cannot be approved");
      const latestReviewRow = connection
        .prepare(
          "SELECT * FROM record_technical_reviews WHERE validation_record_id=? ORDER BY created_at DESC,id DESC LIMIT 1"
        )
        .get(input.id) as Record<string, unknown> | undefined;
      const latestReview = latestReviewRow
        ? mapTechnicalReview(latestReviewRow)
        : null;
      if (
        !latestReview ||
        latestReview.decision !== "accepted" ||
        latestReview.recordVersion !== record.recordVersion ||
        latestReview.outstandingIssues.length > 0
      )
        throw new Error(
          "A current accepted independent technical review is required before approval"
        );
      assertCanApprovePolarimeter({
        analystUserId: record.validatedByUserId,
        reviewerUserId: latestReview.reviewerUserId,
        approverUserId: input.userId,
      });
    }
    const timestamp = now();
    const decisionResult = connection
      .prepare(
        "UPDATE validation_records SET lifecycle_status=?, approved_by_user_id=?, approved_at=?, updated_at=? WHERE id=? AND lifecycle_status='draft' AND record_version=?"
      )
      .run(
        input.decision,
        input.userId,
        timestamp,
        timestamp,
        input.id,
        record.recordVersion
      );
    if (Number(decisionResult.changes) !== 1)
      throw new Error(
        "Approval conflict: the record changed; reload before deciding"
      );
    connection
      .prepare(
        "INSERT INTO record_approvals (validation_record_id, approver_user_id, decision, reason, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        input.id,
        input.userId,
        input.decision,
        input.reason?.trim() || null,
        timestamp
      );
    audit({
      recordId: input.id,
      actorUserId: input.userId,
      action: input.decision,
      previousStatus: record.lifecycleStatus,
      nextStatus: input.decision,
      summary: decisionSummary(record.instrumentId, input.decision),
      metadata: {
        resultStatus: record.resultStatus,
        reason: input.reason?.trim() || null,
      },
    });
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
  return (await getValidationRecordById(input.id))!;
}

export async function markValidationRecordExported(input: {
  id: number;
  userId: number;
}) {
  const record = await getValidationRecordById(input.id);
  if (!record) throw new Error("Validation record not found");
  audit({
    recordId: input.id,
    actorUserId: input.userId,
    action: "exported",
    previousStatus: record.lifecycleStatus,
    nextStatus: record.lifecycleStatus,
    summary: exportRecordSummary(record.instrumentId),
  });
  return { success: true } as const;
}
export async function getValidationRecordById(id: number) {
  const row = database()
    .prepare("SELECT * FROM validation_records WHERE id = ? LIMIT 1")
    .get(id) as LocalRecordRow | undefined;
  return row ? mapRecord(row) : null;
}
export async function listValidationRecords(
  input: { userId: number; canViewAll: boolean } & RecordFilters
) {
  const where: string[] = [];
  const values: Array<string | number | null> = [];
  if (!input.canViewAll) {
    where.push("validated_by_user_id = ?");
    values.push(input.userId);
  }
  if (input.instrumentKey) {
    where.push("instrument_key = ?");
    values.push(input.instrumentKey);
  }
  if (input.resultStatus) {
    where.push("result_status = ?");
    values.push(input.resultStatus);
  }
  if (input.lifecycleStatus) {
    where.push("lifecycle_status = ?");
    values.push(input.lifecycleStatus);
  }
  if (input.dateFrom) {
    where.push("created_at >= ?");
    values.push(`${input.dateFrom}T00:00:00.000Z`);
  }
  if (input.dateTo) {
    const end = new Date(`${input.dateTo}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    where.push("created_at < ?");
    values.push(end.toISOString());
  }
  const statement = `SELECT * FROM validation_records ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 500`;
  return (
    database()
      .prepare(statement)
      .all(...values) as LocalRecordRow[]
  ).map(mapRecord);
}
export function summarizeValidationRecords(
  records: Array<{
    instrumentKey: string;
    instrumentName: string;
    resultStatus: "pass" | "fail";
    lifecycleStatus: "draft" | "approved" | "rejected";
  }>
) {
  const total = records.length,
    pass = records.filter(record => record.resultStatus === "pass").length,
    fail = total - pass,
    draft = records.filter(record => record.lifecycleStatus === "draft").length,
    approved = records.filter(
      record => record.lifecycleStatus === "approved"
    ).length,
    rejected = records.filter(
      record => record.lifecycleStatus === "rejected"
    ).length;
  const instruments = Array.from(
    records
      .reduce((map, record) => {
        const current = map.get(record.instrumentKey) ?? {
          instrumentKey: record.instrumentKey,
          instrumentName: record.instrumentName,
          total: 0,
          pass: 0,
          fail: 0,
        };
        current.total += 1;
        record.resultStatus === "pass"
          ? (current.pass += 1)
          : (current.fail += 1);
        map.set(record.instrumentKey, current);
        return map;
      }, new Map<string, { instrumentKey: string; instrumentName: string; total: number; pass: number; fail: number }>())
      .values()
  ).sort((first, second) => second.total - first.total);
  return {
    total,
    pass,
    fail,
    draft,
    approved,
    rejected,
    passRate: total ? Math.round((pass / total) * 1000) / 10 : 0,
    approvalRate: total ? Math.round((approved / total) * 1000) / 10 : 0,
    instruments,
  };
}
export async function getValidationRecordSummary(
  input: { userId: number; canViewAll: boolean } & RecordFilters
) {
  return summarizeValidationRecords(await listValidationRecords(input));
}
export async function getAuditTrail(recordId: number) {
  const rows = database()
    .prepare(
      "SELECT e.*, u.name AS actor_name, u.role AS actor_role FROM audit_events e LEFT JOIN app_users u ON u.id=e.actor_user_id WHERE e.validation_record_id=? ORDER BY e.created_at DESC"
    )
    .all(recordId) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: Number(row.id),
    validationRecordId: Number(row.validation_record_id),
    action: String(row.action),
    previousStatus: row.previous_status as string | null,
    nextStatus: row.next_status as string | null,
    summary: String(row.summary),
    metadata: parseJson<Record<string, unknown> | null>(
      row.metadata as string | null,
      null
    ),
    createdAt: new Date(String(row.created_at)),
    actorName: row.actor_name as string | null,
    actorRole: row.actor_role as AppRole | null,
  }));
}
type LocalDraftRow = {
  id: number;
  user_id: number;
  draft_key: string;
  protocol_version: string;
  payload: string;
  version: number;
  created_at: string;
  updated_at: string;
};

function mapPolarimeterDraft(row: LocalDraftRow) {
  return {
    id: Number(row.id),
    draftKey: row.draft_key,
    protocolVersion: row.protocol_version,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getPolarimeterDraft(input: {
  userId: number;
  draftKey: string;
}) {
  const row = database()
    .prepare(
      "SELECT * FROM polarimeter_drafts WHERE user_id=? AND draft_key=? LIMIT 1"
    )
    .get(input.userId, input.draftKey) as LocalDraftRow | undefined;
  return row ? mapPolarimeterDraft(row) : null;
}

export async function savePolarimeterDraft(input: {
  userId: number;
  draftKey: string;
  protocolVersion: string;
  payload: Record<string, unknown>;
  expectedVersion: number;
}) {
  const active = settingsFor("polarimeter");
  if (String(active.protocolVersion ?? 1) !== input.protocolVersion)
    throw new Error(
      "Protocol version changed; the draft was preserved and not overwritten"
    );
  const timestamp = now();
  if (input.expectedVersion === 0) {
    try {
      database()
        .prepare(
          "INSERT INTO polarimeter_drafts (user_id,draft_key,protocol_version,payload,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)"
        )
        .run(
          input.userId,
          input.draftKey,
          input.protocolVersion,
          json(input.payload),
          timestamp,
          timestamp
        );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(
          "UNIQUE constraint failed: polarimeter_drafts.user_id, polarimeter_drafts.draft_key"
        )
      )
        throw new Error(
          "Draft conflict: a server draft already exists; load it before saving"
        );
      throw error;
    }
  } else {
    const updated = database()
      .prepare(
        "UPDATE polarimeter_drafts SET protocol_version=?,payload=?,version=version+1,updated_at=? WHERE user_id=? AND draft_key=? AND version=?"
      )
      .run(
        input.protocolVersion,
        json(input.payload),
        timestamp,
        input.userId,
        input.draftKey,
        input.expectedVersion
      );
    if (Number(updated.changes) !== 1)
      throw new Error(
        "Draft conflict: another device changed this draft; reload and resolve the conflict"
      );
  }
  return (await getPolarimeterDraft({
    userId: input.userId,
    draftKey: input.draftKey,
  }))!;
}

export async function clearPolarimeterDraft(input: {
  userId: number;
  draftKey: string;
  expectedVersion: number;
}) {
  const deleted = database()
    .prepare(
      "DELETE FROM polarimeter_drafts WHERE user_id=? AND draft_key=? AND version=?"
    )
    .run(input.userId, input.draftKey, input.expectedVersion);
  if (Number(deleted.changes) !== 1)
    throw new Error(
      "Draft conflict: the server draft changed and was preserved"
    );
  return { success: true as const };
}

function mapTechnicalReview(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    validationRecordId: Number(row.validation_record_id),
    recordVersion: Number(row.record_version),
    reviewerUserId: Number(row.reviewer_user_id),
    reviewerName: row.reviewer_name === null ? null : String(row.reviewer_name),
    decision: String(row.decision) as "accepted" | "rejected",
    comments: String(row.comments),
    rejectionReason:
      row.rejection_reason === null ? null : String(row.rejection_reason),
    outstandingIssues: parseJson<string[]>(
      row.outstanding_issues as string,
      []
    ),
    createdAt: new Date(String(row.created_at)),
  };
}

export async function listPolarimeterTechnicalReviews(recordId: number) {
  const rows = database()
    .prepare(
      "SELECT r.*, u.name AS reviewer_name FROM record_technical_reviews r LEFT JOIN app_users u ON u.id=r.reviewer_user_id WHERE r.validation_record_id=? ORDER BY r.created_at ASC, r.id ASC"
    )
    .all(recordId) as Array<Record<string, unknown>>;
  return rows.map(mapTechnicalReview);
}

export async function createPolarimeterTechnicalReview(input: {
  recordId: number;
  expectedVersion: number;
  reviewerUserId: number;
  decision: "accepted" | "rejected";
  comments: string;
  rejectionReason: string | null;
  outstandingIssues: string[];
}) {
  const connection = database();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const recordRow = connection
      .prepare("SELECT * FROM validation_records WHERE id=? LIMIT 1")
      .get(input.recordId) as LocalRecordRow | undefined;
    const record = recordRow ? mapRecord(recordRow) : null;
    if (!record || record.instrumentKey !== "polarimeter")
      throw new Error("Polarimeter record not found");
    if (record.lifecycleStatus !== "draft")
      throw new Error("Only a saved draft Polarimeter record can be reviewed");
    if (record.recordVersion !== input.expectedVersion)
      throw new Error(
        "Review conflict: the record changed; reload before reviewing"
      );
    const reviewer = connection
      .prepare("SELECT role,is_active FROM app_users WHERE id=? LIMIT 1")
      .get(input.reviewerUserId) as
      | { role: string; is_active: number }
      | undefined;
    if (!reviewer || !reviewer.is_active || reviewer.role !== "admin")
      throw new Error(
        "An active administrator is required to perform a technical review"
      );
    if (!input.comments.trim())
      throw new Error("Technical review comments are required");
    if (input.decision === "rejected" && !input.rejectionReason?.trim())
      throw new Error(
        "A rejection reason is required for a rejected technical review"
      );
    const data = record.resultData.polarimeterData as
      | {
          protocolSnapshot?: {
            protocolStatus?: "approved" | "pending-verification";
          };
        }
      | undefined;
    if (input.decision === "accepted")
      assertCanAcceptTechnicalReview({
        resultStatus: record.resultStatus,
        reviewerUserId: input.reviewerUserId,
        analystUserId: record.validatedByUserId,
        protocolStatus: data?.protocolSnapshot?.protocolStatus,
        outstandingIssues: input.outstandingIssues,
      });
    else if (input.reviewerUserId === record.validatedByUserId)
      throw new Error(
        "The analyst cannot perform the independent technical review"
      );
    const timestamp = now();
    const inserted = connection
      .prepare(
        "INSERT INTO record_technical_reviews (validation_record_id,record_version,reviewer_user_id,decision,comments,rejection_reason,outstanding_issues,created_at) VALUES (?,?,?,?,?,?,?,?)"
      )
      .run(
        input.recordId,
        input.expectedVersion,
        input.reviewerUserId,
        input.decision,
        input.comments.trim(),
        input.rejectionReason?.trim() || null,
        json(input.outstandingIssues),
        timestamp
      );
    const row = connection
      .prepare(
        "SELECT r.*,u.name AS reviewer_name FROM record_technical_reviews r LEFT JOIN app_users u ON u.id=r.reviewer_user_id WHERE r.id=?"
      )
      .get(inserted.lastInsertRowid) as Record<string, unknown>;
    const mapped = mapTechnicalReview(row);
    connection.exec("COMMIT");
    return mapped;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

function mapDeviation(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    validationRecordId: Number(row.validation_record_id),
    testKey: String(row.test_key) as "accuracy" | "repeatability" | "linearity",
    actualResult: String(row.actual_result),
    acceptanceLimit: String(row.acceptance_limit),
    protocolStatus: String(row.protocol_status) as
      | "approved"
      | "pending-verification",
    investigation: String(row.investigation ?? ""),
    rootCause: String(row.root_cause ?? ""),
    correctiveAction: String(row.corrective_action ?? ""),
    preventiveAction: String(row.preventive_action ?? ""),
    responsibleUserId:
      row.responsible_user_id === null ? null : Number(row.responsible_user_id),
    responsibleName:
      row.responsible_name === null ? null : String(row.responsible_name),
    targetCompletionDate:
      row.target_completion_date === null
        ? null
        : String(row.target_completion_date),
    status: String(row.status) as
      | "open"
      | "investigating"
      | "actions-planned"
      | "closed",
    version: Number(row.version),
    createdByUserId: Number(row.created_by_user_id),
    updatedByUserId: Number(row.updated_by_user_id),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    closedAt: row.closed_at ? new Date(String(row.closed_at)) : null,
  };
}

export async function listPolarimeterDeviations(recordId: number) {
  const rows = database()
    .prepare(
      "SELECT d.*,u.name AS responsible_name FROM polarimeter_deviations d LEFT JOIN app_users u ON u.id=d.responsible_user_id WHERE d.validation_record_id=? ORDER BY d.id ASC"
    )
    .all(recordId) as Array<Record<string, unknown>>;
  return rows.map(mapDeviation);
}

export async function updatePolarimeterDeviation(input: {
  id: number;
  expectedVersion: number;
  actorUserId: number;
  investigation: string;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  responsibleUserId: number | null;
  targetCompletionDate: string | null;
  status: "open" | "investigating" | "actions-planned" | "closed";
  actorIsAdmin: boolean;
}) {
  const connection = database();
  const actor = connection
    .prepare("SELECT role,is_active FROM app_users WHERE id=? LIMIT 1")
    .get(input.actorUserId) as { role: string; is_active: number } | undefined;
  if (!actor || !actor.is_active || actor.role === "viewer")
    throw new Error("An active editor is required to update this deviation");
  const actorIsAdmin = actor.role === "admin";
  if (input.status === "closed" && !actorIsAdmin)
    throw new Error("Only an administrator may close a deviation");
  const current = connection
    .prepare("SELECT * FROM polarimeter_deviations WHERE id=? LIMIT 1")
    .get(input.id) as Record<string, unknown> | undefined;
  if (!current) throw new Error("Deviation record not found");
  const existing = mapDeviation(current);
  if (existing.version !== input.expectedVersion)
    throw new Error("Deviation conflict: reload the latest case before saving");
  validateDeviationClosure({
    status: input.status,
    previousStatus: existing.status,
    investigation: input.investigation,
    rootCause: input.rootCause,
    correctiveAction: input.correctiveAction,
    responsibleUserId: input.responsibleUserId,
    targetCompletionDate: input.targetCompletionDate,
  });
  if (input.responsibleUserId !== null) {
    const assignee = connection
      .prepare("SELECT role,is_active FROM app_users WHERE id=?")
      .get(input.responsibleUserId) as
      | { role: string; is_active: number }
      | undefined;
    if (!assignee || !assignee.is_active || assignee.role === "viewer")
      throw new Error(
        "The responsible person must be an active editor or administrator"
      );
  }
  const timestamp = now();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const updated = connection
      .prepare(
        "UPDATE polarimeter_deviations SET investigation=?,root_cause=?,corrective_action=?,preventive_action=?,responsible_user_id=?,target_completion_date=?,status=?,version=version+1,updated_by_user_id=?,updated_at=?,closed_at=? WHERE id=? AND version=?"
      )
      .run(
        input.investigation.trim(),
        input.rootCause.trim(),
        input.correctiveAction.trim(),
        input.preventiveAction.trim(),
        input.responsibleUserId,
        input.targetCompletionDate,
        input.status,
        input.actorUserId,
        timestamp,
        input.status === "closed" ? timestamp : null,
        input.id,
        input.expectedVersion
      );
    if (Number(updated.changes) !== 1)
      throw new Error(
        "Deviation conflict: reload the latest case before saving"
      );
    const changes = {
      investigation: input.investigation.trim(),
      rootCause: input.rootCause.trim(),
      correctiveAction: input.correctiveAction.trim(),
      preventiveAction: input.preventiveAction.trim(),
      responsibleUserId: input.responsibleUserId,
      targetCompletionDate: input.targetCompletionDate,
      previousStatus: existing.status,
      status: input.status,
    };
    connection
      .prepare(
        "INSERT INTO polarimeter_deviation_events (deviation_id,actor_user_id,event_type,change_data,created_at) VALUES (?,?,?,?,?)"
      )
      .run(input.id, input.actorUserId, "updated", json(changes), timestamp);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
  const row = connection
    .prepare(
      "SELECT d.*,u.name AS responsible_name FROM polarimeter_deviations d LEFT JOIN app_users u ON u.id=d.responsible_user_id WHERE d.id=?"
    )
    .get(input.id) as Record<string, unknown>;
  return mapDeviation(row);
}

export async function listPolarimeterDeviationEvents(recordId: number) {
  const rows = database()
    .prepare(
      "SELECT e.*,u.name AS actor_name FROM polarimeter_deviation_events e JOIN polarimeter_deviations d ON d.id=e.deviation_id LEFT JOIN app_users u ON u.id=e.actor_user_id WHERE d.validation_record_id=? ORDER BY e.created_at DESC,e.id DESC"
    )
    .all(recordId) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: Number(row.id),
    deviationId: Number(row.deviation_id),
    actorUserId: Number(row.actor_user_id),
    actorName: row.actor_name === null ? null : String(row.actor_name),
    eventType: String(row.event_type),
    changeData: parseJson<Record<string, unknown>>(
      row.change_data as string,
      {}
    ),
    createdAt: new Date(String(row.created_at)),
  }));
}

export async function listInstrumentProfiles() {
  const rows = database()
    .prepare("SELECT * FROM instrument_profiles ORDER BY instrument_key ASC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: Number(row.id),
    instrumentKey: String(row.instrument_key),
    nameAr: String(row.name_ar),
    nameEn: String(row.name_en),
    instrumentId: String(row.instrument_id),
    sopNumber: String(row.sop_number),
    manufacturer: String(row.manufacturer),
    model: String(row.model),
    serialNumber: String(row.serial_number),
    formNumber: String(row.form_number),
    accent: String(row.accent),
    updatedByUserId:
      row.updated_by_user_id === null ? null : Number(row.updated_by_user_id),
    updatedAt: new Date(String(row.updated_at)),
  }));
}
export async function upsertInstrumentProfile(
  input: InstrumentProfilePayload & { userId: number }
) {
  const existing = database()
    .prepare("SELECT * FROM instrument_profiles WHERE instrument_key=?")
    .get(input.instrumentKey) as Record<string, unknown> | undefined;
  const payload = {
    instrument_key: input.instrumentKey,
    name_ar: input.nameAr,
    name_en: input.nameEn,
    instrument_id: input.instrumentId,
    sop_number: input.sopNumber,
    manufacturer: input.manufacturer,
    model: input.model,
    serial_number: input.serialNumber,
    form_number: input.formNumber,
    accent: input.accent,
    updated_by_user_id: input.userId,
    updated_at: now(),
  };
  if (existing)
    database()
      .prepare(
        "UPDATE instrument_profiles SET name_ar=?,name_en=?,instrument_id=?,sop_number=?,manufacturer=?,model=?,serial_number=?,form_number=?,accent=?,updated_by_user_id=?,updated_at=? WHERE instrument_key=?"
      )
      .run(
        payload.name_ar,
        payload.name_en,
        payload.instrument_id,
        payload.sop_number,
        payload.manufacturer,
        payload.model,
        payload.serial_number,
        payload.form_number,
        payload.accent,
        payload.updated_by_user_id,
        payload.updated_at,
        input.instrumentKey
      );
  else
    database()
      .prepare(
        "INSERT INTO instrument_profiles (instrument_key,name_ar,name_en,instrument_id,sop_number,manufacturer,model,serial_number,form_number,accent,updated_by_user_id,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        payload.instrument_key,
        payload.name_ar,
        payload.name_en,
        payload.instrument_id,
        payload.sop_number,
        payload.manufacturer,
        payload.model,
        payload.serial_number,
        payload.form_number,
        payload.accent,
        payload.updated_by_user_id,
        payload.updated_at
      );
  database()
    .prepare(
      "INSERT INTO instrument_change_events (instrument_key,editor_user_id,previous_data,next_data,created_at) VALUES (?,?,?,?,?)"
    )
    .run(
      input.instrumentKey,
      input.userId,
      json(existing ?? null),
      json(payload),
      now()
    );
  return (await listInstrumentProfiles()).find(
    profile => profile.instrumentKey === input.instrumentKey
  )!;
}
export async function listInstrumentChanges(instrumentKey: string) {
  const rows = database()
    .prepare(
      "SELECT e.*, u.name AS editor_name FROM instrument_change_events e LEFT JOIN app_users u ON u.id=e.editor_user_id WHERE e.instrument_key=? ORDER BY e.created_at DESC"
    )
    .all(instrumentKey) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: Number(row.id),
    instrumentKey: String(row.instrument_key),
    previousData: parseJson<Record<string, unknown> | null>(
      row.previous_data as string | null,
      null
    ),
    nextData: parseJson<Record<string, unknown>>(row.next_data as string, {}),
    createdAt: new Date(String(row.created_at)),
    editorName: row.editor_name as string | null,
  }));
}
export async function listValidationSettings() {
  const rows = database()
    .prepare("SELECT * FROM validation_settings ORDER BY device_key ASC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(row => ({
    deviceKey: String(row.device_key),
    settings: parseJson<Record<string, unknown>>(row.settings as string, {}),
    updatedByUserId:
      row.updated_by_user_id === null ? null : Number(row.updated_by_user_id),
    updatedAt: new Date(String(row.updated_at)),
  }));
}
export async function upsertValidationSettings(input: {
  deviceKey: string;
  settings: Record<string, unknown>;
  userId: number;
}) {
  const timestamp = now();
  let settings = input.settings;
  if (input.deviceKey === "polarimeter") {
    const existing = database()
      .prepare(
        "SELECT settings, updated_by_user_id, updated_at FROM validation_settings WHERE device_key = ?"
      )
      .get(input.deviceKey) as
      | {
          settings: string;
          updated_by_user_id: number | null;
          updated_at: string;
        }
      | undefined;
    settings = versionPolarimeterSettings({
      defaults: defaultSettings.polarimeter,
      previous: existing
        ? parseJson<Record<string, unknown>>(existing.settings, {})
        : null,
      previousUpdatedByUserId: existing?.updated_by_user_id ?? null,
      previousUpdatedAt: existing?.updated_at ?? null,
      incoming: input.settings,
      userId: input.userId,
      timestamp,
    });
  }
  database()
    .prepare(
      "INSERT INTO validation_settings (device_key,settings,updated_by_user_id,updated_at) VALUES (?,?,?,?) ON CONFLICT(device_key) DO UPDATE SET settings=excluded.settings, updated_by_user_id=excluded.updated_by_user_id, updated_at=excluded.updated_at"
    )
    .run(input.deviceKey, json(settings), input.userId, timestamp);
  return {
    deviceKey: input.deviceKey,
    settings,
    updatedByUserId: input.userId,
    updatedAt: new Date(timestamp),
  };
}
export function closeLocalDatabase() {
  singleton?.close();
  singleton = null;
}

/** Read-only schema probe for the local SQLite store (parity with Supabase). */
export async function checkSchemaHealth(): Promise<SchemaHealth> {
  const connection = database();
  const checks: SchemaCheck[] = REQUIRED_SCHEMA.map(requirement => {
    const present = new Set(
      (
        connection
          .prepare(`PRAGMA table_info(${requirement.table})`)
          .all() as Array<{ name: string }>
      ).map(column => column.name)
    );
    const missing = requirement.columns.filter(column => !present.has(column));
    return missing.length
      ? { table: requirement.table, ok: false, missing }
      : { table: requirement.table, ok: true };
  });
  const polarimeterSettingsProvisioned = Boolean(
    connection
      .prepare("SELECT 1 AS present FROM validation_settings WHERE device_key = 'polarimeter' LIMIT 1")
      .get()
  );
  return {
    ok: checks.every(check => check.ok) && polarimeterSettingsProvisioned,
    storage: "local",
    checks,
    polarimeterSettingsProvisioned,
    checkedAt: new Date().toISOString(),
  };
}
