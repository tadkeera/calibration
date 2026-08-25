import { createRecordSummary, decisionSummary, exportRecordSummary, updateRecordSummary } from "./validationUtils";

import { assertServerEvaluatedResult } from "./validationRecompute";

export type AppRole = "admin" | "user" | "viewer";

export type AppUser = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: AppRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

type RawUser = {
  id: number;
  auth_user_id: string;
  open_id: string;
  name: string | null;
  email: string;
  login_method: string;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_signed_in: string;
};

const getConfig = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service configuration is unavailable");
  return { url, key };
};

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = getConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${url}${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${text.slice(0, 240)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function mapUser(row: RawUser): AppUser {
  return {
    id: Number(row.id),
    openId: row.open_id,
    name: row.name,
    email: row.email,
    loginMethod: row.login_method,
    role: row.role,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastSignedIn: new Date(row.last_signed_in),
  };
}

function restPath(table: string, query = "") {
  return `/rest/v1/${table}${query ? `?${query}` : ""}`;
}

export async function getUserByOpenId(openId: string) {
  const rows = await supabaseRequest<RawUser[]>(restPath("app_users", `open_id=eq.${encodeURIComponent(openId)}&limit=1`));
  return rows[0] ? mapUser(rows[0]) : undefined;
}

export async function getUserById(id: number) {
  const rows = await supabaseRequest<RawUser[]>(restPath("app_users", `id=eq.${id}&limit=1`));
  return rows[0] ? mapUser(rows[0]) : undefined;
}

export async function listUsers() {
  const rows = await supabaseRequest<RawUser[]>(restPath("app_users", "order=created_at.desc"));
  return rows.map(mapUser);
}

async function findAuthUserByEmail(email: string) {
  const data = await supabaseRequest<{ users: Array<{ id: string; email?: string }> }>("/auth/v1/admin/users?per_page=1000");
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function createOrGetAuthUser(input: { email: string; password: string; name: string }) {
  const existing = await findAuthUserByEmail(input.email);
  if (existing) return existing;
  const created = await supabaseRequest<{ id: string; email?: string }>("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true, user_metadata: { name: input.name } }),
  });
  return created;
}

async function upsertProfile(input: { authUserId: string; email: string; name: string; role: AppRole; loginMethod?: string }) {
  const openId = `supabase:${input.authUserId}`;
  const rows = await supabaseRequest<RawUser[]>(restPath("app_users", "on_conflict=auth_user_id"), {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      auth_user_id: input.authUserId,
      open_id: openId,
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      login_method: input.loginMethod ?? "local",
      last_signed_in: new Date().toISOString(),
    }),
  });
  return mapUser(rows[0]);
}

export async function createInitialAdmin() {
  const email = "tadkrah@gmail.com";
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password) throw new Error("Initial admin password is unavailable");
  const authUser = await createOrGetAuthUser({ email, password, name: "System Administrator" });
  return upsertProfile({ authUserId: authUser.id, email, name: "System Administrator", role: "admin" });
}

export async function createLocalUser(input: { email: string; password: string; name: string; role: AppRole }) {
  const authUser = await createOrGetAuthUser(input);
  return upsertProfile({ authUserId: authUser.id, email: input.email, name: input.name, role: input.role });
}

export async function localLogin(input: { email: string; password: string }) {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (!response.ok) throw new Error("Invalid email or password");
  const data = await response.json() as { user: { id: string; email?: string; user_metadata?: { name?: string } } };
  const user = await getUserByOpenId(`supabase:${data.user.id}`);
  if (!user || !user.isActive) throw new Error("User account is unavailable");
  await supabaseRequest(restPath("app_users", `id=eq.${user.id}`), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ last_signed_in: new Date().toISOString() }),
  });
  return user;
}

export async function updateUserRole(input: { id: number; role: AppRole }) {
  const rows = await supabaseRequest<RawUser[]>(restPath("app_users", `id=eq.${input.id}`), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ role: input.role }),
  });
  if (!rows[0]) throw new Error("User not found");
  return mapUser(rows[0]);
}

function localAuthUserId(user: AppUser) {
  const authUserId = user.openId.replace(/^supabase:/, "");
  if (!authUserId || authUserId === user.openId) throw new Error("Only local Supabase users can manage passwords");
  return authUserId;
}

async function updateAuthUser(authUserId: string, body: Record<string, unknown>) {
  return supabaseRequest<{ id: string }>(`/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function changeLocalPassword(input: { userId: number; currentPassword: string; newPassword: string }) {
  const user = await getUserById(input.userId);
  if (!user?.email || !user.isActive) throw new Error("User account is unavailable");
  const verifiedUser = await localLogin({ email: user.email, password: input.currentPassword });
  if (verifiedUser.id !== user.id) throw new Error("Current password is invalid");
  await updateAuthUser(localAuthUserId(user), { password: input.newPassword });
  return { success: true } as const;
}

export async function requestPasswordRecovery(input: { email: string; redirectTo: string }) {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: input.email, redirect_to: input.redirectTo }),
  });
  if (!response.ok) throw new Error("Password recovery request could not be started");
  return { success: true } as const;
}

export async function completePasswordRecovery(input: { recoveryToken: string; newPassword: string }) {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: key, Authorization: `Bearer ${input.recoveryToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: input.newPassword }),
  });
  if (!response.ok) throw new Error("Password recovery link is invalid or expired");
  return { success: true } as const;
}

export async function updateUserActiveState(input: { id: number; isActive: boolean; actorUserId: number }) {
  if (input.id === input.actorUserId) throw new Error("Administrators cannot disable their own account");
  const target = await getUserById(input.id);
  if (!target) throw new Error("User not found");
  if (!input.isActive && target.role === "admin") {
    const activeAdminCount = (await listUsers()).filter((user) => user.role === "admin" && user.isActive).length;
    if (activeAdminCount <= 1) throw new Error("At least one active administrator is required");
  }
  const rows = await supabaseRequest<RawUser[]>(restPath("app_users", `id=eq.${input.id}`), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ is_active: input.isActive }),
  });
  if (!rows[0]) throw new Error("User not found");
  return mapUser(rows[0]);
}

export async function upsertUser(user: Partial<AppUser> & { openId: string }): Promise<void> {
  const existing = await getUserByOpenId(user.openId);
  if (!existing) throw new Error("Only Supabase local users are supported");
  await supabaseRequest(restPath("app_users", `id=eq.${existing.id}`), {
    method: "PATCH",
    body: JSON.stringify({ last_signed_in: new Date().toISOString() }),
  });
}

type RecordPayload = {
  instrumentKey: string;
  instrumentName: string;
  instrumentId: string;
  sopNumber: string;
  formNumber: string;
  resultStatus: "pass" | "fail";
  pharmacistName: string;
  resultData: Record<string, unknown>;
};

async function getRequiredValidationSettings(deviceKey: string) {
  const rows = await supabaseRequest<Array<{ settings: Record<string, unknown> }>>(restPath("validation_settings", `device_key=eq.${encodeURIComponent(deviceKey)}&limit=1`));
  if (!rows[0]) throw new Error("Controlled validation settings have not been provisioned for this instrument");
  return rows[0].settings;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function assertControlledSettingsMatch(submittedSettings: unknown, controlledSettings: Record<string, unknown>) {
  if (!submittedSettings || canonicalJson(submittedSettings) !== canonicalJson(controlledSettings)) {
    throw new Error("Validation result does not match the current controlled Supabase settings");
  }
}

type ValidationRecordRow = {
  id: number; instrument_key: string; instrument_name: string; instrument_id: string; sop_number: string; form_number: string;
  result_status: "pass" | "fail"; lifecycle_status: "draft" | "approved" | "rejected"; result_data: Record<string, unknown>;
  pharmacist_name: string; validated_by_user_id: number; approved_by_user_id: number | null; approved_at: string | null; created_at: string; updated_at: string;
};

function mapRecord(row: ValidationRecordRow) {
  return { id: Number(row.id), instrumentKey: row.instrument_key, instrumentName: row.instrument_name, instrumentId: row.instrument_id, sopNumber: row.sop_number, formNumber: row.form_number, resultStatus: row.result_status, lifecycleStatus: row.lifecycle_status, resultData: row.result_data, pharmacistName: row.pharmacist_name, validatedByUserId: Number(row.validated_by_user_id), approvedByUserId: row.approved_by_user_id ? Number(row.approved_by_user_id) : null, approvedAt: row.approved_at ? new Date(row.approved_at) : null, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) };
}

async function writeAuditEvent(input: { recordId: number; actorUserId: number; action: "created" | "updated" | "approved" | "rejected" | "exported"; previousStatus?: string | null; nextStatus?: string | null; summary: string; metadata?: Record<string, unknown> }) {
  await supabaseRequest(restPath("audit_events"), { method: "POST", body: JSON.stringify({ validation_record_id: input.recordId, actor_user_id: input.actorUserId, action: input.action, previous_status: input.previousStatus ?? null, next_status: input.nextStatus ?? null, summary: input.summary, metadata: input.metadata ?? null }) });
}

export async function createValidationRecord(input: RecordPayload & { userId: number }) {
  const controlledSettings = await getRequiredValidationSettings(input.instrumentKey);
  assertControlledSettingsMatch(input.resultData.controlledSettings, controlledSettings);
  assertServerEvaluatedResult(input.instrumentKey, input.resultData, controlledSettings, input.resultStatus);
  const rows = await supabaseRequest<ValidationRecordRow[]>(restPath("validation_records"), { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ instrument_key: input.instrumentKey, instrument_name: input.instrumentName, instrument_id: input.instrumentId, sop_number: input.sopNumber, form_number: input.formNumber, result_status: input.resultStatus, result_data: { ...input.resultData, controlledSettings }, pharmacist_name: input.pharmacistName, validated_by_user_id: input.userId }) });
  const record = mapRecord(rows[0]);
  await writeAuditEvent({ recordId: record.id, actorUserId: input.userId, action: "created", nextStatus: "draft", summary: createRecordSummary(input.instrumentId, input.resultStatus), metadata: { resultStatus: input.resultStatus, sopNumber: input.sopNumber } });
  return record;
}

export async function updateValidationRecord(input: RecordPayload & { id: number; userId: number }) {
  const controlledSettings = await getRequiredValidationSettings(input.instrumentKey);
  assertControlledSettingsMatch(input.resultData.controlledSettings, controlledSettings);
  assertServerEvaluatedResult(input.instrumentKey, input.resultData, controlledSettings, input.resultStatus);
  const rows = await supabaseRequest<ValidationRecordRow[]>(restPath("validation_records", `id=eq.${input.id}`), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ instrument_key: input.instrumentKey, instrument_name: input.instrumentName, instrument_id: input.instrumentId, sop_number: input.sopNumber, form_number: input.formNumber, result_status: input.resultStatus, result_data: { ...input.resultData, controlledSettings }, pharmacist_name: input.pharmacistName, updated_at: new Date().toISOString() }) });
  const record = mapRecord(rows[0]);
  await writeAuditEvent({ recordId: input.id, actorUserId: input.userId, action: "updated", previousStatus: "draft", nextStatus: "draft", summary: updateRecordSummary(input.instrumentId, input.resultStatus), metadata: { resultStatus: input.resultStatus, sopNumber: input.sopNumber } });
  return record;
}

export async function approveValidationRecord(input: { id: number; decision: "approved" | "rejected"; userId: number }) {
  const record = await getValidationRecordById(input.id);
  if (!record) throw new Error("Validation record not found");
  if (record.lifecycleStatus !== "draft") throw new Error("Validation record has already been decided");
  const rows = await supabaseRequest<ValidationRecordRow[]>(restPath("validation_records", `id=eq.${input.id}`), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ lifecycle_status: input.decision, approved_by_user_id: input.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  await supabaseRequest(restPath("record_approvals"), { method: "POST", body: JSON.stringify({ validation_record_id: input.id, approver_user_id: input.userId, decision: input.decision }) });
  await writeAuditEvent({ recordId: input.id, actorUserId: input.userId, action: input.decision, previousStatus: record.lifecycleStatus, nextStatus: input.decision, summary: decisionSummary(record.instrumentId, input.decision), metadata: { resultStatus: record.resultStatus } });
  return mapRecord(rows[0]);
}

export async function markValidationRecordExported(input: { id: number; userId: number }) {
  const record = await getValidationRecordById(input.id);
  if (!record) throw new Error("Validation record not found");
  await writeAuditEvent({ recordId: input.id, actorUserId: input.userId, action: "exported", previousStatus: record.lifecycleStatus, nextStatus: record.lifecycleStatus, summary: exportRecordSummary(record.instrumentId) });
  return { success: true } as const;
}

export async function getValidationRecordById(id: number) {
  const rows = await supabaseRequest<ValidationRecordRow[]>(restPath("validation_records", `id=eq.${id}&limit=1`));
  return rows[0] ? mapRecord(rows[0]) : null;
}

export type RecordFilters = {
  instrumentKey?: string;
  resultStatus?: "pass" | "fail";
  lifecycleStatus?: "draft" | "approved" | "rejected";
  dateFrom?: string;
  dateTo?: string;
};

function recordFilterParts(input: { userId: number; canViewAll: boolean } & RecordFilters) {
  const parts = ["order=created_at.desc", "limit=500"];
  if (!input.canViewAll) parts.push(`validated_by_user_id=eq.${input.userId}`);
  if (input.instrumentKey) parts.push(`instrument_key=eq.${encodeURIComponent(input.instrumentKey)}`);
  if (input.resultStatus) parts.push(`result_status=eq.${input.resultStatus}`);
  if (input.lifecycleStatus) parts.push(`lifecycle_status=eq.${input.lifecycleStatus}`);
  if (input.dateFrom) parts.push(`created_at=gte.${encodeURIComponent(`${input.dateFrom}T00:00:00.000Z`)}`);
  if (input.dateTo) {
    const nextDay = new Date(`${input.dateTo}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    parts.push(`created_at=lt.${encodeURIComponent(nextDay.toISOString())}`);
  }
  return parts;
}

export async function listValidationRecords(input: { userId: number; canViewAll: boolean } & RecordFilters) {
  const parts = recordFilterParts(input);
  const rows = await supabaseRequest<ValidationRecordRow[]>(restPath("validation_records", parts.join("&")));
  return rows.map(mapRecord);
}

export function summarizeValidationRecords(records: Array<{ instrumentKey: string; instrumentName: string; resultStatus: "pass" | "fail"; lifecycleStatus: "draft" | "approved" | "rejected" }>) {
  const total = records.length;
  const pass = records.filter((record) => record.resultStatus === "pass").length;
  const fail = total - pass;
  const draft = records.filter((record) => record.lifecycleStatus === "draft").length;
  const approved = records.filter((record) => record.lifecycleStatus === "approved").length;
  const rejected = records.filter((record) => record.lifecycleStatus === "rejected").length;
  const instruments = Array.from(records.reduce((map, record) => {
    const current = map.get(record.instrumentKey) ?? { instrumentKey: record.instrumentKey, instrumentName: record.instrumentName, total: 0, pass: 0, fail: 0 };
    current.total += 1;
    if (record.resultStatus === "pass") current.pass += 1; else current.fail += 1;
    map.set(record.instrumentKey, current);
    return map;
  }, new Map<string, { instrumentKey: string; instrumentName: string; total: number; pass: number; fail: number }>()).values()).sort((a, b) => b.total - a.total);
  return { total, pass, fail, draft, approved, rejected, passRate: total ? Math.round((pass / total) * 1000) / 10 : 0, approvalRate: total ? Math.round((approved / total) * 1000) / 10 : 0, instruments };
}

export async function getValidationRecordSummary(input: { userId: number; canViewAll: boolean } & RecordFilters) {
  return summarizeValidationRecords(await listValidationRecords(input));
}

export async function getAuditTrail(recordId: number) {
  const events = await supabaseRequest<Array<{ id: number; validation_record_id: number; actor_user_id: number; action: string; previous_status: string | null; next_status: string | null; summary: string; metadata: Record<string, unknown> | null; created_at: string }>>(restPath("audit_events", `validation_record_id=eq.${recordId}&order=created_at.desc`));
  const actorIds = Array.from(new Set(events.map((event) => event.actor_user_id)));
  const users = actorIds.length ? await supabaseRequest<RawUser[]>(restPath("app_users", `id=in.(${actorIds.join(",")})`)) : [];
  const userMap = new Map(users.map((user) => [Number(user.id), user]));
  return events.map((event) => ({ id: Number(event.id), validationRecordId: Number(event.validation_record_id), action: event.action, previousStatus: event.previous_status, nextStatus: event.next_status, summary: event.summary, metadata: event.metadata, createdAt: new Date(event.created_at), actorName: userMap.get(Number(event.actor_user_id))?.name ?? null, actorRole: userMap.get(Number(event.actor_user_id))?.role ?? null }));
}

export type InstrumentProfilePayload = { instrumentKey: string; nameAr: string; nameEn: string; instrumentId: string; sopNumber: string; manufacturer: string; model: string; serialNumber: string; formNumber: string; accent: string };

type InstrumentProfileRow = { id: number; instrument_key: string; name_ar: string; name_en: string; instrument_id: string; sop_number: string; manufacturer: string; model: string; serial_number: string; form_number: string; accent: string; updated_by_user_id: number; updated_at: string };
function mapProfile(row: InstrumentProfileRow) { return { id: Number(row.id), instrumentKey: row.instrument_key, nameAr: row.name_ar, nameEn: row.name_en, instrumentId: row.instrument_id, sopNumber: row.sop_number, manufacturer: row.manufacturer, model: row.model, serialNumber: row.serial_number, formNumber: row.form_number, accent: row.accent, updatedByUserId: Number(row.updated_by_user_id), updatedAt: new Date(row.updated_at) }; }

export async function listInstrumentProfiles() { const rows = await supabaseRequest<InstrumentProfileRow[]>(restPath("instrument_profiles", "order=instrument_key.asc")); return rows.map(mapProfile); }

export async function upsertInstrumentProfile(input: InstrumentProfilePayload & { userId: number }) {
  const existing = (await supabaseRequest<InstrumentProfileRow[]>(restPath("instrument_profiles", `instrument_key=eq.${encodeURIComponent(input.instrumentKey)}&limit=1`)))[0];
  const nextData = { instrument_key: input.instrumentKey, name_ar: input.nameAr, name_en: input.nameEn, instrument_id: input.instrumentId, sop_number: input.sopNumber, manufacturer: input.manufacturer, model: input.model, serial_number: input.serialNumber, form_number: input.formNumber, accent: input.accent, updated_by_user_id: input.userId, updated_at: new Date().toISOString() };
  const rows = await supabaseRequest<InstrumentProfileRow[]>(existing ? restPath("instrument_profiles", `id=eq.${existing.id}`) : restPath("instrument_profiles"), { method: existing ? "PATCH" : "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(nextData) });
  await supabaseRequest(restPath("instrument_change_events"), { method: "POST", body: JSON.stringify({ instrument_key: input.instrumentKey, editor_user_id: input.userId, previous_data: existing ?? null, next_data: nextData }) });
  return mapProfile(rows[0]);
}

export async function listInstrumentChanges(instrumentKey: string) {
  const events = await supabaseRequest<Array<{ id: number; instrument_key: string; editor_user_id: number; previous_data: Record<string, unknown> | null; next_data: Record<string, unknown>; created_at: string }>>(restPath("instrument_change_events", `instrument_key=eq.${encodeURIComponent(instrumentKey)}&order=created_at.desc`));
  const ids = Array.from(new Set(events.map((event) => event.editor_user_id)));
  const users = ids.length ? await supabaseRequest<RawUser[]>(restPath("app_users", `id=in.(${ids.join(",")})`)) : [];
  const names = new Map(users.map((user) => [Number(user.id), user.name]));
  return events.map((event) => ({ id: Number(event.id), instrumentKey: event.instrument_key, previousData: event.previous_data, nextData: event.next_data, createdAt: new Date(event.created_at), editorName: names.get(Number(event.editor_user_id)) ?? null }));
}

export async function listValidationSettings() {
  const rows = await supabaseRequest<Array<{ device_key: string; settings: Record<string, unknown>; updated_by_user_id: number | null; updated_at: string }>>(restPath("validation_settings", "order=device_key.asc"));
  return rows.map((row) => ({ deviceKey: row.device_key, settings: row.settings, updatedByUserId: row.updated_by_user_id, updatedAt: new Date(row.updated_at) }));
}

export async function upsertValidationSettings(input: { deviceKey: string; settings: Record<string, unknown>; userId: number }) {
  const rows = await supabaseRequest<Array<{ device_key: string; settings: Record<string, unknown>; updated_by_user_id: number; updated_at: string }>>(restPath("validation_settings", "on_conflict=device_key"), {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ device_key: input.deviceKey, settings: input.settings, updated_by_user_id: input.userId, updated_at: new Date().toISOString() }),
  });
  return { deviceKey: rows[0].device_key, settings: rows[0].settings, updatedByUserId: rows[0].updated_by_user_id, updatedAt: new Date(rows[0].updated_at) };
}
