import {
  createRecordSummary,
  decisionSummary,
  exportRecordSummary,
  updateRecordSummary,
} from "./validationUtils";

import { defaultSettings, devices } from "../client/src/lib/qc";
import {
  REQUIRED_SCHEMA,
  type SchemaCheck,
  type SchemaHealth,
} from "./schemaRequirements";
import { versionPolarimeterSettings } from "../shared/polarimeter";
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
  if (!url || !key)
    throw new Error("Supabase service configuration is unavailable");
  return { url, key };
};

/**
 * PostgREST / PostgreSQL codes that mean the deployed database schema (or the
 * PostgREST schema cache) is behind the application:
 *   PGRST204 column not found in schema cache · PGRST205 table not found in schema cache
 *   PGRST202 function not found in schema cache · 42703 undefined column · 42P01 undefined table
 */
export const SCHEMA_MISMATCH_CODES = new Set([
  "PGRST202",
  "PGRST204",
  "PGRST205",
  "42703",
  "42P01",
]);

export const SCHEMA_MISMATCH_GUIDANCE =
  "The deployed Supabase schema is older than the application. Apply server/sql/polarimeter_workflow_migration.sql in the Supabase SQL Editor (it ends by reloading the PostgREST schema cache), then retry. No data was saved by this request.";

export class SupabaseRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly schemaMismatch: boolean;

  constructor(status: number, body: string) {
    let parsed: { code?: unknown; message?: unknown } | null = null;
    try {
      parsed = JSON.parse(body) as { code?: unknown; message?: unknown };
    } catch {
      // Keep the raw response text available in the message below.
    }
    const detail =
      typeof parsed?.message === "string" ? parsed.message : body.slice(0, 240);
    const code = typeof parsed?.code === "string" ? parsed.code : null;
    const schemaMismatch = code !== null && SCHEMA_MISMATCH_CODES.has(code);
    // The original database message is always preserved; schema mismatches get
    // an actionable instruction appended instead of being hidden or bypassed.
    super(
      `Supabase request failed (${status}): ${detail}${schemaMismatch ? ` — ${SCHEMA_MISMATCH_GUIDANCE}` : ""}`
    );
    this.name = "SupabaseRequestError";
    this.status = status;
    this.code = code;
    this.schemaMismatch = schemaMismatch;
  }
}

async function supabaseRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { url, key } = getConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${url}${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new SupabaseRequestError(response.status, text);
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

export type AdminActivityEventType =
  | "login_succeeded"
  | "login_failed"
  | "account_disabled"
  | "account_enabled"
  | "password_changed"
  | "recovery_requested";
type RawAdminActivityEvent = {
  id: number;
  event_type: AdminActivityEventType;
  actor_user_id: number | null;
  subject_user_id: number | null;
  email: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function restPath(table: string, query = "") {
  return `/rest/v1/${table}${query ? `?${query}` : ""}`;
}

export async function getUserByOpenId(openId: string) {
  const rows = await supabaseRequest<RawUser[]>(
    restPath("app_users", `open_id=eq.${encodeURIComponent(openId)}&limit=1`)
  );
  return rows[0] ? mapUser(rows[0]) : undefined;
}

export async function getUserById(id: number) {
  const rows = await supabaseRequest<RawUser[]>(
    restPath("app_users", `id=eq.${id}&limit=1`)
  );
  return rows[0] ? mapUser(rows[0]) : undefined;
}

export async function getUserByEmail(email: string) {
  const rows = await supabaseRequest<RawUser[]>(
    restPath(
      "app_users",
      `email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`
    )
  );
  return rows[0] ? mapUser(rows[0]) : undefined;
}

async function writeAdminActivityEvent(input: {
  eventType: AdminActivityEventType;
  actorUserId?: number | null;
  subjectUserId?: number | null;
  email?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  await supabaseRequest(restPath("admin_activity_events"), {
    method: "POST",
    body: JSON.stringify({
      event_type: input.eventType,
      actor_user_id: input.actorUserId ?? null,
      subject_user_id: input.subjectUserId ?? null,
      email: input.email?.toLowerCase() ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
    }),
  });
}

async function writeAdminActivitySafely(
  input: Parameters<typeof writeAdminActivityEvent>[0]
) {
  try {
    await writeAdminActivityEvent(input);
  } catch (error) {
    console.error("[Admin activity] Unable to persist activity", error);
  }
}

export async function listUsers() {
  const rows = await supabaseRequest<RawUser[]>(
    restPath("app_users", "order=created_at.desc")
  );
  return rows.map(mapUser);
}

async function findAuthUserByEmail(email: string) {
  const data = await supabaseRequest<{
    users: Array<{ id: string; email?: string }>;
  }>("/auth/v1/admin/users?per_page=1000");
  return (
    data.users.find(
      user => user.email?.toLowerCase() === email.toLowerCase()
    ) ?? null
  );
}

async function createOrGetAuthUser(input: {
  email: string;
  password: string;
  name: string;
}) {
  const existing = await findAuthUserByEmail(input.email);
  if (existing) return existing;
  const created = await supabaseRequest<{ id: string; email?: string }>(
    "/auth/v1/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { name: input.name },
      }),
    }
  );
  return created;
}

async function upsertProfile(input: {
  authUserId: string;
  email: string;
  name: string;
  role: AppRole;
  loginMethod?: string;
}) {
  const openId = `supabase:${input.authUserId}`;
  const rows = await supabaseRequest<RawUser[]>(
    restPath("app_users", "on_conflict=auth_user_id"),
    {
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
    }
  );
  return mapUser(rows[0]);
}

export async function createInitialAdmin() {
  const email = "tadkrah@gmail.com";
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password) throw new Error("Initial admin password is unavailable");
  const authUser = await createOrGetAuthUser({
    email,
    password,
    name: "System Administrator",
  });
  return upsertProfile({
    authUserId: authUser.id,
    email,
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
  const authUser = await createOrGetAuthUser(input);
  return upsertProfile({
    authUserId: authUser.id,
    email: input.email,
    name: input.name,
    role: input.role,
  });
}

export async function localLogin(input: {
  email: string;
  password: string;
  recordActivity?: boolean;
}) {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (!response.ok) {
    await writeAdminActivitySafely({
      eventType: "login_failed",
      email: input.email,
      summary: "محاولة تسجيل دخول فاشلة",
      metadata: { reason: "invalid_credentials" },
    });
    throw new Error("Invalid email or password");
  }
  const data = (await response.json()) as {
    user: { id: string; email?: string; user_metadata?: { name?: string } };
  };
  const user = await getUserByOpenId(`supabase:${data.user.id}`);
  if (!user || !user.isActive) {
    await writeAdminActivitySafely({
      eventType: "login_failed",
      subjectUserId: user?.id,
      email: input.email,
      summary: user
        ? "محاولة تسجيل دخول لحساب معطّل"
        : "محاولة تسجيل دخول لحساب غير مرتبط",
      metadata: { reason: user ? "inactive_account" : "missing_profile" },
    });
    throw new Error("User account is unavailable");
  }
  await supabaseRequest(restPath("app_users", `id=eq.${user.id}`), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ last_signed_in: new Date().toISOString() }),
  });
  if (input.recordActivity !== false)
    await writeAdminActivitySafely({
      eventType: "login_succeeded",
      actorUserId: user.id,
      subjectUserId: user.id,
      email: user.email,
      summary: "تم تسجيل الدخول بنجاح",
    });
  return user;
}

export async function updateUserRole(input: { id: number; role: AppRole }) {
  const rows = await supabaseRequest<RawUser[]>(
    restPath("app_users", `id=eq.${input.id}`),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ role: input.role }),
    }
  );
  if (!rows[0]) throw new Error("User not found");
  return mapUser(rows[0]);
}

function localAuthUserId(user: AppUser) {
  const authUserId = user.openId.replace(/^supabase:/, "");
  if (!authUserId || authUserId === user.openId)
    throw new Error("Only local Supabase users can manage passwords");
  return authUserId;
}

async function updateAuthUser(
  authUserId: string,
  body: Record<string, unknown>
) {
  return supabaseRequest<{ id: string }>(
    `/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );
}

export async function changeLocalPassword(input: {
  userId: number;
  currentPassword: string;
  newPassword: string;
}) {
  const user = await getUserById(input.userId);
  if (!user?.email || !user.isActive)
    throw new Error("User account is unavailable");
  const verifiedUser = await localLogin({
    email: user.email,
    password: input.currentPassword,
    recordActivity: false,
  });
  if (verifiedUser.id !== user.id)
    throw new Error("Current password is invalid");
  await updateAuthUser(localAuthUserId(user), { password: input.newPassword });
  await writeAdminActivitySafely({
    eventType: "password_changed",
    actorUserId: user.id,
    subjectUserId: user.id,
    email: user.email,
    summary: "تم تغيير كلمة المرور",
  });
  return { success: true } as const;
}

export async function requestPasswordRecovery(input: {
  email: string;
  redirectTo: string;
}) {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: input.email, redirect_to: input.redirectTo }),
  });
  if (!response.ok)
    throw new Error("Password recovery request could not be started");
  const profile = await getUserByEmail(input.email).catch(() => undefined);
  await writeAdminActivitySafely({
    eventType: "recovery_requested",
    subjectUserId: profile?.id,
    email: input.email,
    summary: "تم طلب استعادة كلمة المرور",
  });
  return { success: true } as const;
}

export async function completePasswordRecovery(input: {
  recoveryToken: string;
  newPassword: string;
}) {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: key,
      Authorization: `Bearer ${input.recoveryToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: input.newPassword }),
  });
  if (!response.ok)
    throw new Error("Password recovery link is invalid or expired");
  return { success: true } as const;
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
  if (!input.isActive && target.role === "admin") {
    const activeAdminCount = (await listUsers()).filter(
      user => user.role === "admin" && user.isActive
    ).length;
    if (activeAdminCount <= 1)
      throw new Error("At least one active administrator is required");
  }
  const rows = await supabaseRequest<RawUser[]>(
    restPath("app_users", `id=eq.${input.id}`),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ is_active: input.isActive }),
    }
  );
  if (!rows[0]) throw new Error("User not found");
  const updated = mapUser(rows[0]);
  await writeAdminActivitySafely({
    eventType: input.isActive ? "account_enabled" : "account_disabled",
    actorUserId: input.actorUserId,
    subjectUserId: updated.id,
    email: updated.email,
    summary: input.isActive ? "تمت إعادة تفعيل الحساب" : "تم تعطيل الحساب",
  });
  return updated;
}

export type AdminActivityFilters = {
  eventType?: AdminActivityEventType;
  dateFrom?: string;
  dateTo?: string;
};
export async function listAdminActivityEvents(
  filters: AdminActivityFilters = {}
) {
  const parts = ["order=created_at.desc", "limit=300"];
  if (filters.eventType) parts.push(`event_type=eq.${filters.eventType}`);
  if (filters.dateFrom)
    parts.push(
      `created_at=gte.${encodeURIComponent(`${filters.dateFrom}T00:00:00.000Z`)}`
    );
  if (filters.dateTo) {
    const nextDay = new Date(`${filters.dateTo}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    parts.push(`created_at=lt.${encodeURIComponent(nextDay.toISOString())}`);
  }
  const events = await supabaseRequest<RawAdminActivityEvent[]>(
    restPath("admin_activity_events", parts.join("&"))
  );
  const userIds = Array.from(
    new Set(
      events
        .flatMap(event => [event.actor_user_id, event.subject_user_id])
        .filter((id): id is number => id !== null)
    )
  );
  const users = userIds.length
    ? await supabaseRequest<RawUser[]>(
        restPath("app_users", `id=in.(${userIds.join(",")})`)
      )
    : [];
  const names = new Map(
    users.map(user => [Number(user.id), user.name ?? user.email])
  );
  return events.map(event => ({
    id: Number(event.id),
    eventType: event.event_type,
    actorUserId:
      event.actor_user_id === null ? null : Number(event.actor_user_id),
    subjectUserId:
      event.subject_user_id === null ? null : Number(event.subject_user_id),
    actorName:
      event.actor_user_id === null
        ? null
        : (names.get(Number(event.actor_user_id)) ?? null),
    subjectName:
      event.subject_user_id === null
        ? null
        : (names.get(Number(event.subject_user_id)) ?? null),
    email: event.email,
    summary: event.summary,
    metadata: event.metadata,
    createdAt: new Date(event.created_at),
  }));
}

export async function upsertUser(
  user: Partial<AppUser> & { openId: string }
): Promise<void> {
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
  retestOfRecordId?: number | null;
  retestReason?: string | null;
};

async function getRequiredValidationSettings(deviceKey: string) {
  const rows = await supabaseRequest<
    Array<{ settings: Record<string, unknown> }>
  >(
    restPath(
      "validation_settings",
      `device_key=eq.${encodeURIComponent(deviceKey)}&limit=1`
    )
  );
  if (!rows[0])
    throw new Error(
      "Controlled validation settings have not been provisioned for this instrument"
    );
  return deviceKey === "polarimeter"
    ? { ...defaultSettings.polarimeter, ...rows[0].settings }
    : rows[0].settings;
}
async function assertCurrentPolarimeterEquipment(input: RecordPayload) {
  if (input.instrumentKey !== "polarimeter") return;
  const profile = (await listInstrumentProfiles()).find(
    entry => entry.instrumentKey === "polarimeter"
  );
  const fallback = devices.find(device => device.key === "polarimeter");
  if (!profile && !fallback)
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
    profile ?? {
      nameEn: fallback!.english,
      instrumentId: fallback!.id,
      sopNumber: fallback!.sop,
      manufacturer: fallback!.manufacturer,
      model: fallback!.model,
      serialNumber: fallback!.serial,
      formNumber: fallback!.form,
    }
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

async function ensurePolarimeterFailureCases(
  recordId: number,
  actorUserId: number
) {
  const record = await getValidationRecordById(recordId);
  if (
    !record ||
    record.instrumentKey !== "polarimeter" ||
    record.resultStatus !== "fail"
  )
    return;
  const cases = polarimeterFailureCases(record.resultData);
  for (const failure of cases) {
    await supabaseRequest<Array<{ id: number }>>(
      restPath(
        "polarimeter_deviations",
        "on_conflict=validation_record_id,test_key"
      ),
      {
        method: "POST",
        headers: {
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify({
          validation_record_id: record.id,
          test_key: failure.testKey,
          actual_result: failure.actualResult,
          acceptance_limit: failure.acceptanceLimit,
          protocol_status: failure.protocolStatus,
          created_by_user_id: actorUserId,
          updated_by_user_id: actorUserId,
        }),
      }
    );
    // The migration trigger writes the creation event in this same transaction.
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

export function assertControlledSettingsMatch(
  submittedSettings: unknown,
  controlledSettings: Record<string, unknown>
) {
  if (
    !submittedSettings ||
    canonicalJson(submittedSettings) !== canonicalJson(controlledSettings)
  ) {
    throw new Error(
      "Validation result does not match the current controlled Supabase settings"
    );
  }
}

type ValidationRecordRow = {
  id: number;
  instrument_key: string;
  instrument_name: string;
  instrument_id: string;
  sop_number: string;
  form_number: string;
  result_status: "pass" | "fail";
  lifecycle_status: "draft" | "approved" | "rejected";
  result_data: Record<string, unknown>;
  pharmacist_name: string;
  validated_by_user_id: number;
  approved_by_user_id: number | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  record_version?: number;
  retest_of_record_id?: number | null;
  retest_reason?: string | null;
};

function mapRecord(row: ValidationRecordRow) {
  return {
    id: Number(row.id),
    instrumentKey: row.instrument_key,
    instrumentName: row.instrument_name,
    instrumentId: row.instrument_id,
    sopNumber: row.sop_number,
    formNumber: row.form_number,
    resultStatus: row.result_status,
    lifecycleStatus: row.lifecycle_status,
    resultData: row.result_data,
    pharmacistName: row.pharmacist_name,
    validatedByUserId: Number(row.validated_by_user_id),
    approvedByUserId: row.approved_by_user_id
      ? Number(row.approved_by_user_id)
      : null,
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

async function writeAuditEvent(input: {
  recordId: number;
  actorUserId: number;
  action: "created" | "updated" | "approved" | "rejected" | "exported";
  previousStatus?: string | null;
  nextStatus?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  await supabaseRequest(restPath("audit_events"), {
    method: "POST",
    body: JSON.stringify({
      validation_record_id: input.recordId,
      actor_user_id: input.actorUserId,
      action: input.action,
      previous_status: input.previousStatus ?? null,
      next_status: input.nextStatus ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
    }),
  });
}

export async function createValidationRecord(
  input: RecordPayload & { userId: number }
) {
  const controlledSettings = await getRequiredValidationSettings(
    input.instrumentKey
  );
  assertControlledSettingsMatch(
    input.resultData.controlledSettings,
    controlledSettings
  );
  await assertCurrentPolarimeterEquipment(input);
  await assertRetestReference(input);
  const evaluated = normalizeServerEvaluatedResult(
    input.instrumentKey,
    input.resultData,
    controlledSettings,
    input.resultStatus
  );
  const resultData = { ...evaluated.resultData, controlledSettings };
  const rows = await supabaseRequest<ValidationRecordRow[]>(
    restPath("validation_records"),
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        instrument_key: input.instrumentKey,
        instrument_name: input.instrumentName,
        instrument_id: input.instrumentId,
        sop_number: input.sopNumber,
        form_number: input.formNumber,
        result_status: evaluated.resultStatus,
        result_data: resultData,
        pharmacist_name: input.pharmacistName,
        validated_by_user_id: input.userId,
        retest_of_record_id: input.retestOfRecordId ?? null,
        retest_reason: input.retestOfRecordId
          ? input.retestReason!.trim()
          : null,
      }),
    }
  );
  const record = mapRecord(rows[0]);
  await writeAuditEvent({
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
  if (
    record.resultStatus === "fail" &&
    record.instrumentKey === "polarimeter"
  ) {
    try {
      await ensurePolarimeterFailureCases(record.id, input.userId);
    } catch (error) {
      // The failed record is already durable. The deviation query retries this idempotent creation.
      console.error(
        "[Polarimeter CAPA] Failed to create one or more deviation cases",
        error
      );
    }
  }
  return record;
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
  const controlledSettings = await getRequiredValidationSettings(
    input.instrumentKey
  );
  assertControlledSettingsMatch(
    input.resultData.controlledSettings,
    controlledSettings
  );
  await assertCurrentPolarimeterEquipment(input);
  const evaluated = normalizeServerEvaluatedResult(
    input.instrumentKey,
    input.resultData,
    controlledSettings,
    input.resultStatus
  );
  const resultData = { ...evaluated.resultData, controlledSettings };
  const rows = await supabaseRequest<ValidationRecordRow[]>(
    restPath(
      "validation_records",
      `id=eq.${input.id}&record_version=eq.${input.expectedVersion}&lifecycle_status=eq.draft&validated_by_user_id=eq.${input.userId}`
    ),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        instrument_key: input.instrumentKey,
        instrument_name: input.instrumentName,
        instrument_id: input.instrumentId,
        sop_number: input.sopNumber,
        form_number: input.formNumber,
        result_status: evaluated.resultStatus,
        result_data: resultData,
        pharmacist_name: input.pharmacistName,
        updated_at: new Date().toISOString(),
        record_version: input.expectedVersion + 1,
      }),
    }
  );
  if (!rows[0])
    throw new Error(
      "Draft version conflict: reload the saved record before editing"
    );
  const record = mapRecord(rows[0]);
  if (record.resultStatus === "fail" && record.instrumentKey === "polarimeter")
    await ensurePolarimeterFailureCases(record.id, input.userId);
  await writeAuditEvent({
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
  const record = await getValidationRecordById(input.id);
  if (!record) throw new Error("Validation record not found");
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
  if (input.decision === "approved" && record.instrumentKey === "polarimeter") {
    const polarimeterData = (record.resultData as Record<string, unknown>)
      .polarimeterData as
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
    const reviews = await listPolarimeterTechnicalReviews(input.id);
    const latestReview = reviews.at(-1);
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
  const approver = await getUserById(input.userId);
  if (!approver || !approver.isActive || approver.role !== "admin")
    throw new Error(
      "An active administrator is required to decide validation records"
    );
  if (record.instrumentKey === "polarimeter") {
    const decidedRows = await supabaseRequest<ValidationRecordRow[]>(
      restPath("rpc/decide_polarimeter_validation_record"),
      {
        method: "POST",
        body: JSON.stringify({
          p_validation_record_id: input.id,
          p_expected_record_version: input.expectedVersion,
          p_approver_user_id: input.userId,
          p_decision: input.decision,
          p_reason: input.reason?.trim() || null,
          p_summary: decisionSummary(record.instrumentId, input.decision),
          p_metadata: {
            resultStatus: record.resultStatus,
            reason: input.reason?.trim() || null,
          },
        }),
      }
    );
    if (!decidedRows[0])
      throw new Error("Polarimeter lifecycle decision was not recorded");
    return mapRecord(decidedRows[0]);
  }
  const rows = await supabaseRequest<ValidationRecordRow[]>(
    restPath(
      "validation_records",
      `id=eq.${input.id}&lifecycle_status=eq.draft&record_version=eq.${record.recordVersion}`
    ),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        lifecycle_status: input.decision,
        approved_by_user_id: input.userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }
  );
  if (!rows[0])
    throw new Error(
      "Approval conflict: the record changed; reload before deciding"
    );
  await supabaseRequest(restPath("record_approvals"), {
    method: "POST",
    body: JSON.stringify({
      validation_record_id: input.id,
      approver_user_id: input.userId,
      decision: input.decision,
      reason: input.reason?.trim() || null,
    }),
  });
  await writeAuditEvent({
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
  return mapRecord(rows[0]);
}

export async function markValidationRecordExported(input: {
  id: number;
  userId: number;
}) {
  const record = await getValidationRecordById(input.id);
  if (!record) throw new Error("Validation record not found");
  await writeAuditEvent({
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
  const rows = await supabaseRequest<ValidationRecordRow[]>(
    restPath("validation_records", `id=eq.${id}&limit=1`)
  );
  return rows[0] ? mapRecord(rows[0]) : null;
}

export type RecordFilters = {
  instrumentKey?: string;
  resultStatus?: "pass" | "fail";
  lifecycleStatus?: "draft" | "approved" | "rejected";
  dateFrom?: string;
  dateTo?: string;
};

function recordFilterParts(
  input: { userId: number; canViewAll: boolean } & RecordFilters
) {
  const parts = ["order=created_at.desc", "limit=500"];
  if (!input.canViewAll) parts.push(`validated_by_user_id=eq.${input.userId}`);
  if (input.instrumentKey)
    parts.push(`instrument_key=eq.${encodeURIComponent(input.instrumentKey)}`);
  if (input.resultStatus) parts.push(`result_status=eq.${input.resultStatus}`);
  if (input.lifecycleStatus)
    parts.push(`lifecycle_status=eq.${input.lifecycleStatus}`);
  if (input.dateFrom)
    parts.push(
      `created_at=gte.${encodeURIComponent(`${input.dateFrom}T00:00:00.000Z`)}`
    );
  if (input.dateTo) {
    const nextDay = new Date(`${input.dateTo}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    parts.push(`created_at=lt.${encodeURIComponent(nextDay.toISOString())}`);
  }
  return parts;
}

export async function listValidationRecords(
  input: { userId: number; canViewAll: boolean } & RecordFilters
) {
  const parts = recordFilterParts(input);
  const rows = await supabaseRequest<ValidationRecordRow[]>(
    restPath("validation_records", parts.join("&"))
  );
  return rows.map(mapRecord);
}

export function summarizeValidationRecords(
  records: Array<{
    instrumentKey: string;
    instrumentName: string;
    resultStatus: "pass" | "fail";
    lifecycleStatus: "draft" | "approved" | "rejected";
  }>
) {
  const total = records.length;
  const pass = records.filter(record => record.resultStatus === "pass").length;
  const fail = total - pass;
  const draft = records.filter(
    record => record.lifecycleStatus === "draft"
  ).length;
  const approved = records.filter(
    record => record.lifecycleStatus === "approved"
  ).length;
  const rejected = records.filter(
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
        if (record.resultStatus === "pass") current.pass += 1;
        else current.fail += 1;
        map.set(record.instrumentKey, current);
        return map;
      }, new Map<string, { instrumentKey: string; instrumentName: string; total: number; pass: number; fail: number }>())
      .values()
  ).sort((a, b) => b.total - a.total);
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
  const events = await supabaseRequest<
    Array<{
      id: number;
      validation_record_id: number;
      actor_user_id: number;
      action: string;
      previous_status: string | null;
      next_status: string | null;
      summary: string;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>
  >(
    restPath(
      "audit_events",
      `validation_record_id=eq.${recordId}&order=created_at.desc`
    )
  );
  const actorIds = Array.from(
    new Set(events.map(event => event.actor_user_id))
  );
  const users = actorIds.length
    ? await supabaseRequest<RawUser[]>(
        restPath("app_users", `id=in.(${actorIds.join(",")})`)
      )
    : [];
  const userMap = new Map(users.map(user => [Number(user.id), user]));
  return events.map(event => ({
    id: Number(event.id),
    validationRecordId: Number(event.validation_record_id),
    action: event.action,
    previousStatus: event.previous_status,
    nextStatus: event.next_status,
    summary: event.summary,
    metadata: event.metadata,
    createdAt: new Date(event.created_at),
    actorName: userMap.get(Number(event.actor_user_id))?.name ?? null,
    actorRole: userMap.get(Number(event.actor_user_id))?.role ?? null,
  }));
}

type PolarimeterDraftRow = {
  id: number;
  user_id: number;
  draft_key: string;
  protocol_version: string;
  payload: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
};

function mapPolarimeterDraft(row: PolarimeterDraftRow) {
  return {
    id: Number(row.id),
    draftKey: row.draft_key,
    protocolVersion: row.protocol_version,
    payload: row.payload,
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getPolarimeterDraft(input: {
  userId: number;
  draftKey: string;
}) {
  const rows = await supabaseRequest<PolarimeterDraftRow[]>(
    restPath(
      "polarimeter_drafts",
      `user_id=eq.${input.userId}&draft_key=eq.${encodeURIComponent(input.draftKey)}&limit=1`
    )
  );
  return rows[0] ? mapPolarimeterDraft(rows[0]) : null;
}

export async function savePolarimeterDraft(input: {
  userId: number;
  draftKey: string;
  protocolVersion: string;
  payload: Record<string, unknown>;
  expectedVersion: number;
}) {
  const active = await getRequiredValidationSettings("polarimeter");
  if (String(active.protocolVersion ?? 1) !== input.protocolVersion)
    throw new Error(
      "Protocol version changed; the draft was preserved and not overwritten"
    );
  let rows: PolarimeterDraftRow[];
  if (input.expectedVersion === 0) {
    try {
      rows = await supabaseRequest<PolarimeterDraftRow[]>(
        restPath("polarimeter_drafts"),
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: input.userId,
            draft_key: input.draftKey,
            protocol_version: input.protocolVersion,
            payload: input.payload,
          }),
        }
      );
    } catch (error) {
      if (
        error instanceof SupabaseRequestError &&
        (error.code === "23505" ||
          (error.status === 409 &&
            /duplicate key|unique constraint|already exists/i.test(
              error.message
            )))
      )
        throw new Error(
          "Draft conflict: a server draft already exists; load it before saving"
        );
      throw error;
    }
  } else {
    rows = await supabaseRequest<PolarimeterDraftRow[]>(
      restPath(
        "polarimeter_drafts",
        `user_id=eq.${input.userId}&draft_key=eq.${encodeURIComponent(input.draftKey)}&version=eq.${input.expectedVersion}`
      ),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          protocol_version: input.protocolVersion,
          payload: input.payload,
          version: input.expectedVersion + 1,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!rows[0])
      throw new Error(
        "Draft conflict: another device changed this draft; reload and resolve the conflict"
      );
  }
  if (!rows[0]) throw new Error("Server draft was not saved");
  return mapPolarimeterDraft(rows[0]);
}

export async function clearPolarimeterDraft(input: {
  userId: number;
  draftKey: string;
  expectedVersion: number;
}) {
  const rows = await supabaseRequest<PolarimeterDraftRow[]>(
    restPath(
      "polarimeter_drafts",
      `user_id=eq.${input.userId}&draft_key=eq.${encodeURIComponent(input.draftKey)}&version=eq.${input.expectedVersion}`
    ),
    { method: "DELETE", headers: { Prefer: "return=representation" } }
  );
  if (!rows[0])
    throw new Error(
      "Draft conflict: the server draft changed and was preserved"
    );
  return { success: true as const };
}

function mapTechnicalReview(
  row: Record<string, unknown>,
  reviewerName: string | null
) {
  return {
    id: Number(row.id),
    validationRecordId: Number(row.validation_record_id),
    recordVersion: Number(row.record_version),
    reviewerUserId: Number(row.reviewer_user_id),
    reviewerName,
    decision: String(row.decision) as "accepted" | "rejected",
    comments: String(row.comments),
    rejectionReason:
      row.rejection_reason === null ? null : String(row.rejection_reason),
    outstandingIssues: Array.isArray(row.outstanding_issues)
      ? (row.outstanding_issues as string[])
      : [],
    createdAt: new Date(String(row.created_at)),
  };
}

export async function listPolarimeterTechnicalReviews(recordId: number) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    restPath(
      "record_technical_reviews",
      `validation_record_id=eq.${recordId}&order=created_at.asc,id.asc`
    )
  );
  const reviewerIds = Array.from(
    new Set(rows.map(row => Number(row.reviewer_user_id)))
  );
  const users = reviewerIds.length
    ? await supabaseRequest<RawUser[]>(
        restPath("app_users", `id=in.(${reviewerIds.join(",")})`)
      )
    : [];
  const names = new Map(users.map(user => [Number(user.id), user.name]));
  return rows.map(row =>
    mapTechnicalReview(row, names.get(Number(row.reviewer_user_id)) ?? null)
  );
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
  const record = await getValidationRecordById(input.recordId);
  if (!record || record.instrumentKey !== "polarimeter")
    throw new Error("Polarimeter record not found");
  if (record.lifecycleStatus !== "draft")
    throw new Error("Only a saved draft Polarimeter record can be reviewed");
  if (record.recordVersion !== input.expectedVersion)
    throw new Error(
      "Review conflict: the record changed; reload before reviewing"
    );
  if (!input.comments.trim())
    throw new Error("Technical review comments are required");
  if (input.decision === "rejected" && !input.rejectionReason?.trim())
    throw new Error(
      "A rejection reason is required for a rejected technical review"
    );
  const reviewer = await getUserById(input.reviewerUserId);
  if (!reviewer || !reviewer.isActive || reviewer.role !== "admin")
    throw new Error(
      "An active administrator is required to perform a technical review"
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
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    restPath("rpc/submit_polarimeter_technical_review"),
    {
      method: "POST",
      body: JSON.stringify({
        p_validation_record_id: input.recordId,
        p_expected_record_version: input.expectedVersion,
        p_reviewer_user_id: input.reviewerUserId,
        p_decision: input.decision,
        p_comments: input.comments.trim(),
        p_rejection_reason: input.rejectionReason?.trim() || null,
        p_outstanding_issues: input.outstandingIssues,
      }),
    }
  );
  if (!rows[0]) throw new Error("Technical review was not recorded");
  return mapTechnicalReview(rows[0], reviewer.name);
}

function mapDeviation(
  row: Record<string, unknown>,
  responsibleName: string | null
) {
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
    responsibleName,
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
  const record = await getValidationRecordById(recordId);
  if (record?.instrumentKey === "polarimeter" && record.resultStatus === "fail")
    await ensurePolarimeterFailureCases(record.id, record.validatedByUserId);
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    restPath(
      "polarimeter_deviations",
      `validation_record_id=eq.${recordId}&order=id.asc`
    )
  );
  const ids = Array.from(
    new Set(
      rows.flatMap(row =>
        row.responsible_user_id ? [Number(row.responsible_user_id)] : []
      )
    )
  );
  const users = ids.length
    ? await supabaseRequest<RawUser[]>(
        restPath("app_users", `id=in.(${ids.join(",")})`)
      )
    : [];
  const names = new Map(users.map(user => [Number(user.id), user.name]));
  return rows.map(row =>
    mapDeviation(
      row,
      row.responsible_user_id
        ? (names.get(Number(row.responsible_user_id)) ?? null)
        : null
    )
  );
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
  const currentRows = await supabaseRequest<Array<Record<string, unknown>>>(
    restPath("polarimeter_deviations", `id=eq.${input.id}&limit=1`)
  );
  if (!currentRows[0]) throw new Error("Deviation record not found");
  const current = mapDeviation(currentRows[0], null);
  if (current.version !== input.expectedVersion)
    throw new Error("Deviation conflict: reload the latest case before saving");
  if (input.status === "closed" && !input.actorIsAdmin)
    throw new Error("Only an administrator may close a deviation");
  validateDeviationClosure({
    status: input.status,
    previousStatus: current.status,
    investigation: input.investigation,
    rootCause: input.rootCause,
    correctiveAction: input.correctiveAction,
    responsibleUserId: input.responsibleUserId,
    targetCompletionDate: input.targetCompletionDate,
  });
  if (input.responsibleUserId !== null) {
    const assignee = await getUserById(input.responsibleUserId);
    if (!assignee || !assignee.isActive || assignee.role === "viewer")
      throw new Error(
        "The responsible person must be an active editor or administrator"
      );
  }
  const changeData = {
    investigation: input.investigation.trim(),
    rootCause: input.rootCause.trim(),
    correctiveAction: input.correctiveAction.trim(),
    preventiveAction: input.preventiveAction.trim(),
    responsibleUserId: input.responsibleUserId,
    targetCompletionDate: input.targetCompletionDate,
    previousStatus: current.status,
    status: input.status,
  };
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    restPath("rpc/update_polarimeter_deviation"),
    {
      method: "POST",
      body: JSON.stringify({
        p_id: input.id,
        p_expected_version: input.expectedVersion,
        p_actor_user_id: input.actorUserId,
        p_investigation: input.investigation.trim(),
        p_root_cause: input.rootCause.trim(),
        p_corrective_action: input.correctiveAction.trim(),
        p_preventive_action: input.preventiveAction.trim(),
        p_responsible_user_id: input.responsibleUserId,
        p_target_completion_date: input.targetCompletionDate,
        p_status: input.status,
        p_change_data: changeData,
      }),
    }
  );
  if (!rows[0]) throw new Error("Deviation update was not recorded");
  const responsible = input.responsibleUserId
    ? await getUserById(input.responsibleUserId)
    : undefined;
  return mapDeviation(rows[0], responsible?.name ?? null);
}

export async function listPolarimeterDeviationEvents(recordId: number) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    restPath(
      "polarimeter_deviation_events",
      `select=*,polarimeter_deviations!inner(validation_record_id)&polarimeter_deviations.validation_record_id=eq.${recordId}&order=created_at.desc,id.desc`
    )
  );
  const actorIds = Array.from(
    new Set(rows.map(row => Number(row.actor_user_id)))
  );
  const users = actorIds.length
    ? await supabaseRequest<RawUser[]>(
        restPath("app_users", `id=in.(${actorIds.join(",")})`)
      )
    : [];
  const names = new Map(users.map(user => [Number(user.id), user.name]));
  return rows.map(row => ({
    id: Number(row.id),
    deviationId: Number(row.deviation_id),
    actorUserId: Number(row.actor_user_id),
    actorName: names.get(Number(row.actor_user_id)) ?? null,
    eventType: String(row.event_type),
    changeData: row.change_data as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)),
  }));
}

export type InstrumentProfilePayload = {
  instrumentKey: string;
  nameAr: string;
  nameEn: string;
  instrumentId: string;
  sopNumber: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  formNumber: string;
  accent: string;
};

type InstrumentProfileRow = {
  id: number;
  instrument_key: string;
  name_ar: string;
  name_en: string;
  instrument_id: string;
  sop_number: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  form_number: string;
  accent: string;
  updated_by_user_id: number;
  updated_at: string;
};
function mapProfile(row: InstrumentProfileRow) {
  return {
    id: Number(row.id),
    instrumentKey: row.instrument_key,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    instrumentId: row.instrument_id,
    sopNumber: row.sop_number,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serial_number,
    formNumber: row.form_number,
    accent: row.accent,
    updatedByUserId: Number(row.updated_by_user_id),
    updatedAt: new Date(row.updated_at),
  };
}

export async function listInstrumentProfiles() {
  const rows = await supabaseRequest<InstrumentProfileRow[]>(
    restPath("instrument_profiles", "order=instrument_key.asc")
  );
  return rows.map(mapProfile);
}

export async function upsertInstrumentProfile(
  input: InstrumentProfilePayload & { userId: number }
) {
  const existing = (
    await supabaseRequest<InstrumentProfileRow[]>(
      restPath(
        "instrument_profiles",
        `instrument_key=eq.${encodeURIComponent(input.instrumentKey)}&limit=1`
      )
    )
  )[0];
  const nextData = {
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
    updated_at: new Date().toISOString(),
  };
  const rows = await supabaseRequest<InstrumentProfileRow[]>(
    existing
      ? restPath("instrument_profiles", `id=eq.${existing.id}`)
      : restPath("instrument_profiles"),
    {
      method: existing ? "PATCH" : "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(nextData),
    }
  );
  await supabaseRequest(restPath("instrument_change_events"), {
    method: "POST",
    body: JSON.stringify({
      instrument_key: input.instrumentKey,
      editor_user_id: input.userId,
      previous_data: existing ?? null,
      next_data: nextData,
    }),
  });
  return mapProfile(rows[0]);
}

export async function listInstrumentChanges(instrumentKey: string) {
  const events = await supabaseRequest<
    Array<{
      id: number;
      instrument_key: string;
      editor_user_id: number;
      previous_data: Record<string, unknown> | null;
      next_data: Record<string, unknown>;
      created_at: string;
    }>
  >(
    restPath(
      "instrument_change_events",
      `instrument_key=eq.${encodeURIComponent(instrumentKey)}&order=created_at.desc`
    )
  );
  const ids = Array.from(new Set(events.map(event => event.editor_user_id)));
  const users = ids.length
    ? await supabaseRequest<RawUser[]>(
        restPath("app_users", `id=in.(${ids.join(",")})`)
      )
    : [];
  const names = new Map(users.map(user => [Number(user.id), user.name]));
  return events.map(event => ({
    id: Number(event.id),
    instrumentKey: event.instrument_key,
    previousData: event.previous_data,
    nextData: event.next_data,
    createdAt: new Date(event.created_at),
    editorName: names.get(Number(event.editor_user_id)) ?? null,
  }));
}

export async function listValidationSettings() {
  const rows = await supabaseRequest<
    Array<{
      device_key: string;
      settings: Record<string, unknown>;
      updated_by_user_id: number | null;
      updated_at: string;
    }>
  >(restPath("validation_settings", "order=device_key.asc"));
  return rows.map(row => ({
    deviceKey: row.device_key,
    settings: row.settings,
    updatedByUserId: row.updated_by_user_id,
    updatedAt: new Date(row.updated_at),
  }));
}

export async function upsertValidationSettings(input: {
  deviceKey: string;
  settings: Record<string, unknown>;
  userId: number;
}) {
  const timestamp = new Date().toISOString();
  let settings = input.settings;
  if (input.deviceKey === "polarimeter") {
    const existingRows = await supabaseRequest<
      Array<{
        settings: Record<string, unknown>;
        updated_by_user_id: number | null;
        updated_at: string;
      }>
    >(
      restPath(
        "validation_settings",
        `device_key=eq.${encodeURIComponent(input.deviceKey)}&limit=1`
      )
    );
    const existing = existingRows[0];
    settings = versionPolarimeterSettings({
      defaults: defaultSettings.polarimeter,
      previous: existing?.settings ?? null,
      previousUpdatedByUserId: existing?.updated_by_user_id ?? null,
      previousUpdatedAt: existing?.updated_at ?? null,
      incoming: input.settings,
      userId: input.userId,
      timestamp,
    });
  }
  const rows = await supabaseRequest<
    Array<{
      device_key: string;
      settings: Record<string, unknown>;
      updated_by_user_id: number;
      updated_at: string;
    }>
  >(restPath("validation_settings", "on_conflict=device_key"), {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      device_key: input.deviceKey,
      settings,
      updated_by_user_id: input.userId,
      updated_at: timestamp,
    }),
  });
  return {
    deviceKey: rows[0].device_key,
    settings: rows[0].settings,
    updatedByUserId: rows[0].updated_by_user_id,
    updatedAt: new Date(rows[0].updated_at),
  };
}

/**
 * Read-only schema probe against the deployed Supabase project. Each table is
 * queried with `select=<required columns>&limit=0`, which PostgREST validates
 * against its schema cache — the same validation that rejected the insert with
 * PGRST204. No rows are read or written.
 */
export async function checkSchemaHealth(): Promise<SchemaHealth> {
  const { url } = getConfig();
  let projectRefHint: string | undefined;
  try {
    projectRefHint = new URL(url).hostname.split(".")[0].slice(0, 6);
  } catch {
    projectRefHint = undefined;
  }
  const checks: SchemaCheck[] = [];
  for (const requirement of REQUIRED_SCHEMA) {
    try {
      await supabaseRequest(
        restPath(
          requirement.table,
          `select=${requirement.columns.join(",")}&limit=0`
        )
      );
      checks.push({ table: requirement.table, ok: true });
    } catch (error) {
      if (!(error instanceof SupabaseRequestError) || !error.schemaMismatch)
        throw error;
      // Narrow down which columns are unknown so the report is actionable.
      const missing: string[] = [];
      for (const column of requirement.columns) {
        try {
          await supabaseRequest(
            restPath(requirement.table, `select=${column}&limit=0`)
          );
        } catch (columnError) {
          if (
            columnError instanceof SupabaseRequestError &&
            columnError.schemaMismatch
          )
            missing.push(column);
          else throw columnError;
        }
      }
      checks.push({
        table: requirement.table,
        ok: false,
        missing: missing.length ? missing : requirement.columns.slice(),
      });
    }
  }
  let polarimeterSettingsProvisioned = false;
  try {
    const rows = await supabaseRequest<Array<{ device_key: string }>>(
      restPath(
        "validation_settings",
        "device_key=eq.polarimeter&select=device_key&limit=1"
      )
    );
    polarimeterSettingsProvisioned = rows.length === 1;
  } catch (error) {
    if (!(error instanceof SupabaseRequestError) || !error.schemaMismatch)
      throw error;
  }
  return {
    ok: checks.every(check => check.ok) && polarimeterSettingsProvisioned,
    storage: "supabase",
    projectRefHint,
    checks,
    polarimeterSettingsProvisioned,
    checkedAt: new Date().toISOString(),
  };
}
