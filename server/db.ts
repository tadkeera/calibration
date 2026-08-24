import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { auditEvents, InsertUser, instrumentChangeEvents, instrumentProfiles, recordApprovals, users, validationRecords } from "../drizzle/schema";
import { ENV } from './_core/env';
import { createRecordSummary, decisionSummary, exportRecordSummary, updateRecordSummary } from "./validationUtils";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
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

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db;
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
  const db = await requireDb();
  await db.insert(auditEvents).values({
    validationRecordId: input.recordId,
    actorUserId: input.actorUserId,
    action: input.action,
    previousStatus: input.previousStatus ?? null,
    nextStatus: input.nextStatus ?? null,
    summary: input.summary,
    metadata: input.metadata,
  });
}

export async function createValidationRecord(input: RecordPayload & { userId: number }) {
  const db = await requireDb();
  const created = await db.insert(validationRecords).values({
    ...input,
    lifecycleStatus: "draft",
    validatedByUserId: input.userId,
  });
  const recordId = Number(created[0].insertId);
  await writeAuditEvent({
    recordId,
    actorUserId: input.userId,
    action: "created",
    nextStatus: "draft",
    summary: createRecordSummary(input.instrumentId, input.resultStatus),
    metadata: { resultStatus: input.resultStatus, sopNumber: input.sopNumber },
  });
  return getValidationRecordById(recordId);
}

export async function updateValidationRecord(input: RecordPayload & { id: number; userId: number }) {
  const db = await requireDb();
  await db.update(validationRecords).set({
    instrumentKey: input.instrumentKey,
    instrumentName: input.instrumentName,
    instrumentId: input.instrumentId,
    sopNumber: input.sopNumber,
    formNumber: input.formNumber,
    resultStatus: input.resultStatus,
    pharmacistName: input.pharmacistName,
    resultData: input.resultData,
  }).where(eq(validationRecords.id, input.id));
  await writeAuditEvent({
    recordId: input.id,
    actorUserId: input.userId,
    action: "updated",
    previousStatus: "draft",
    nextStatus: "draft",
    summary: updateRecordSummary(input.instrumentId, input.resultStatus),
    metadata: { resultStatus: input.resultStatus, sopNumber: input.sopNumber },
  });
  return getValidationRecordById(input.id);
}

export async function approveValidationRecord(input: { id: number; decision: "approved" | "rejected"; userId: number }) {
  const db = await requireDb();
  const record = await getValidationRecordById(input.id);
  if (!record) throw new Error("Validation record not found");
  if (record.lifecycleStatus !== "draft") throw new Error("Validation record has already been decided");
  await db.update(validationRecords).set({
    lifecycleStatus: input.decision,
    approvedByUserId: input.userId,
    approvedAt: new Date(),
  }).where(eq(validationRecords.id, input.id));
  await db.insert(recordApprovals).values({
    validationRecordId: input.id,
    approverUserId: input.userId,
    decision: input.decision,
  });
  await writeAuditEvent({
    recordId: input.id,
    actorUserId: input.userId,
    action: input.decision,
    previousStatus: record.lifecycleStatus,
    nextStatus: input.decision,
    summary: decisionSummary(record.instrumentId, input.decision),
    metadata: { resultStatus: record.resultStatus },
  });
  return getValidationRecordById(input.id);
}

export async function markValidationRecordExported(input: { id: number; userId: number }) {
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
  const db = await requireDb();
  const records = await db.select().from(validationRecords).where(eq(validationRecords.id, id)).limit(1);
  return records[0] ?? null;
}

export async function listValidationRecords(input: { userId: number; isAdmin: boolean; status?: "draft" | "approved" | "rejected" }) {
  const db = await requireDb();
  const baseQuery = input.isAdmin
    ? db.select().from(validationRecords).orderBy(desc(validationRecords.createdAt)).limit(100)
    : db.select().from(validationRecords).where(eq(validationRecords.validatedByUserId, input.userId)).orderBy(desc(validationRecords.createdAt)).limit(100);
  const records = await baseQuery;
  return input.status ? records.filter((record) => record.lifecycleStatus === input.status) : records;
}

export async function getAuditTrail(recordId: number) {
  const db = await requireDb();
  return db.select({
    id: auditEvents.id,
    validationRecordId: auditEvents.validationRecordId,
    action: auditEvents.action,
    previousStatus: auditEvents.previousStatus,
    nextStatus: auditEvents.nextStatus,
    summary: auditEvents.summary,
    metadata: auditEvents.metadata,
    createdAt: auditEvents.createdAt,
    actorName: users.name,
    actorRole: users.role,
  }).from(auditEvents).leftJoin(users, eq(auditEvents.actorUserId, users.id)).where(eq(auditEvents.validationRecordId, recordId)).orderBy(desc(auditEvents.createdAt));
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

export async function listInstrumentProfiles() {
  const db = await requireDb();
  return db.select().from(instrumentProfiles).orderBy(instrumentProfiles.instrumentKey);
}

export async function upsertInstrumentProfile(input: InstrumentProfilePayload & { userId: number }) {
  const db = await requireDb();
  const { userId, ...nextData } = input;
  const existingRows = await db.select().from(instrumentProfiles).where(eq(instrumentProfiles.instrumentKey, input.instrumentKey)).limit(1);
  const previous = existingRows[0] ?? null;
  if (previous) {
    await db.update(instrumentProfiles).set({ ...nextData, updatedByUserId: userId }).where(eq(instrumentProfiles.id, previous.id));
  } else {
    await db.insert(instrumentProfiles).values({ ...nextData, updatedByUserId: userId });
  }
  await db.insert(instrumentChangeEvents).values({
    instrumentKey: input.instrumentKey,
    editorUserId: userId,
    previousData: previous ? { nameAr: previous.nameAr, nameEn: previous.nameEn, instrumentId: previous.instrumentId, sopNumber: previous.sopNumber, manufacturer: previous.manufacturer, model: previous.model, serialNumber: previous.serialNumber, formNumber: previous.formNumber, accent: previous.accent } : null,
    nextData,
  });
  const profile = await db.select().from(instrumentProfiles).where(eq(instrumentProfiles.instrumentKey, input.instrumentKey)).limit(1);
  return profile[0] ?? null;
}

export async function listInstrumentChanges(instrumentKey: string) {
  const db = await requireDb();
  return db.select({
    id: instrumentChangeEvents.id,
    instrumentKey: instrumentChangeEvents.instrumentKey,
    previousData: instrumentChangeEvents.previousData,
    nextData: instrumentChangeEvents.nextData,
    createdAt: instrumentChangeEvents.createdAt,
    editorName: users.name,
  }).from(instrumentChangeEvents).leftJoin(users, eq(instrumentChangeEvents.editorUserId, users.id)).where(eq(instrumentChangeEvents.instrumentKey, instrumentKey)).orderBy(desc(instrumentChangeEvents.createdAt));
}
