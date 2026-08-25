import crypto from "node:crypto";
import mysql from "mysql2/promise";

const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!projectUrl || !serviceRoleKey || !databaseUrl) throw new Error("Supabase and source database configuration are required");

const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
const rest = async (path, init = {}) => {
  const response = await fetch(`${projectUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${await response.text()}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
};
const encode = (value) => encodeURIComponent(String(value));
const imported = async (table, id) => (await rest(`/rest/v1/legacy_imports?source_table=eq.${encode(table)}&source_id=eq.${id}&select=source_id&limit=1`)).length > 0;
const markImported = (table, id, targetTable, targetId) => rest("/rest/v1/legacy_imports", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ source_table: table, source_id: id, target_table: targetTable, target_id: targetId ?? null }) });
const connection = await mysql.createConnection(databaseUrl);

const userMap = new Map();
const recordMap = new Map();
const findProfile = async (email) => (await rest(`/rest/v1/app_users?email=eq.${encode(email)}&select=id,auth_user_id&limit=1`))[0];

const [legacyUsers] = await connection.query("SELECT * FROM users ORDER BY id ASC");
for (const user of legacyUsers) {
  const email = user.email || `legacy-user-${user.id}@migration.invalid`;
  let profile = await findProfile(email);
  if (!profile) {
    const auth = await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: crypto.randomUUID(), email_confirm: true, user_metadata: { name: user.name || "Legacy user" } }) });
    const profiles = await rest("/rest/v1/app_users", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ auth_user_id: auth.id, open_id: `legacy:${user.openId || user.id}`, name: user.name || "Legacy user", email, login_method: "legacy-migration", role: ["admin", "user", "viewer"].includes(user.role) ? user.role : "user", is_active: true, created_at: user.createdAt || new Date().toISOString(), updated_at: user.updatedAt || new Date().toISOString(), last_signed_in: user.lastSignedIn || new Date().toISOString() }) });
    profile = profiles[0];
  }
  userMap.set(Number(user.id), Number(profile.id));
  if (!(await imported("users", user.id))) await markImported("users", user.id, "app_users", profile.id);
}

const [legacyRecords] = await connection.query("SELECT * FROM validationRecords ORDER BY id ASC");
for (const record of legacyRecords) {
  if (await imported("validationRecords", record.id)) continue;
  const profiles = await rest("/rest/v1/validation_records", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ instrument_key: record.instrumentKey, instrument_name: record.instrumentName, instrument_id: record.instrumentId, sop_number: record.sopNumber, form_number: record.formNumber, result_status: record.resultStatus, lifecycle_status: record.lifecycleStatus || "draft", result_data: { ...(typeof record.resultData === "string" ? JSON.parse(record.resultData) : record.resultData), legacyMigrated: true }, pharmacist_name: record.pharmacistName, validated_by_user_id: userMap.get(Number(record.validatedByUserId)), approved_by_user_id: record.approvedByUserId ? userMap.get(Number(record.approvedByUserId)) : null, approved_at: record.approvedAt, created_at: record.createdAt, updated_at: record.updatedAt }) });
  recordMap.set(Number(record.id), Number(profiles[0].id));
  await markImported("validationRecords", record.id, "validation_records", profiles[0].id);
}

const [legacyEvents] = await connection.query("SELECT * FROM auditEvents ORDER BY id ASC");
for (const event of legacyEvents) {
  if (await imported("auditEvents", event.id)) continue;
  const targetRecordId = recordMap.get(Number(event.validationRecordId));
  const targetUserId = userMap.get(Number(event.actorUserId));
  if (!targetRecordId || !targetUserId) continue;
  const rows = await rest("/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ validation_record_id: targetRecordId, actor_user_id: targetUserId, action: event.action, previous_status: event.previousStatus, next_status: event.nextStatus, summary: event.summary, metadata: typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata, created_at: event.createdAt }) });
  await markImported("auditEvents", event.id, "audit_events", rows[0].id);
}

const [legacyApprovals] = await connection.query("SELECT * FROM recordApprovals ORDER BY id ASC");
for (const approval of legacyApprovals) {
  if (await imported("recordApprovals", approval.id)) continue;
  const targetRecordId = recordMap.get(Number(approval.validationRecordId));
  const targetUserId = userMap.get(Number(approval.approverUserId));
  if (!targetRecordId || !targetUserId) continue;
  const rows = await rest("/rest/v1/record_approvals", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ validation_record_id: targetRecordId, approver_user_id: targetUserId, decision: approval.decision, created_at: approval.createdAt }) });
  await markImported("recordApprovals", approval.id, "record_approvals", rows[0].id);
}

const [legacyProfiles] = await connection.query("SELECT * FROM instrumentProfiles ORDER BY id ASC");
for (const profile of legacyProfiles) {
  if (await imported("instrumentProfiles", profile.id)) continue;
  const rows = await rest("/rest/v1/instrument_profiles?on_conflict=instrument_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ instrument_key: profile.instrumentKey, name_ar: profile.nameAr, name_en: profile.nameEn, instrument_id: profile.instrumentId, sop_number: profile.sopNumber, manufacturer: profile.manufacturer, model: profile.model, serial_number: profile.serialNumber, form_number: profile.formNumber, accent: profile.accent, updated_by_user_id: userMap.get(Number(profile.updatedByUserId)), updated_at: profile.updatedAt }) });
  await markImported("instrumentProfiles", profile.id, "instrument_profiles", rows[0].id);
}

const [legacyInstrumentEvents] = await connection.query("SELECT * FROM instrumentChangeEvents ORDER BY id ASC");
for (const event of legacyInstrumentEvents) {
  if (await imported("instrumentChangeEvents", event.id)) continue;
  const editorUserId = userMap.get(Number(event.editorUserId));
  if (!editorUserId) continue;
  const rows = await rest("/rest/v1/instrument_change_events", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ instrument_key: event.instrumentKey, editor_user_id: editorUserId, previous_data: typeof event.previousData === "string" ? JSON.parse(event.previousData) : event.previousData, next_data: typeof event.nextData === "string" ? JSON.parse(event.nextData) : event.nextData, created_at: event.createdAt }) });
  await markImported("instrumentChangeEvents", event.id, "instrument_change_events", rows[0].id);
}

await connection.end();
console.log("Legacy data migration completed");
