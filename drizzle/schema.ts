import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** The lifecycle of a validation record is controlled through protected tRPC procedures. */
export const recordStatuses = ["draft", "approved", "rejected"] as const;

export const validationRecords = mysqlTable("validationRecords", {
  id: int("id").autoincrement().primaryKey(),
  instrumentKey: varchar("instrumentKey", { length: 64 }).notNull(),
  instrumentName: varchar("instrumentName", { length: 255 }).notNull(),
  instrumentId: varchar("instrumentId", { length: 64 }).notNull(),
  sopNumber: varchar("sopNumber", { length: 64 }).notNull(),
  formNumber: varchar("formNumber", { length: 64 }).notNull(),
  resultStatus: mysqlEnum("resultStatus", ["pass", "fail"]).notNull(),
  lifecycleStatus: mysqlEnum("lifecycleStatus", recordStatuses).default("draft").notNull(),
  resultData: json("resultData").$type<Record<string, unknown>>().notNull(),
  pharmacistName: varchar("pharmacistName", { length: 255 }).notNull(),
  validatedByUserId: int("validatedByUserId").notNull(),
  approvedByUserId: int("approvedByUserId"),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("validationRecords_createdBy_idx").on(table.validatedByUserId),
  index("validationRecords_status_idx").on(table.lifecycleStatus),
  index("validationRecords_createdAt_idx").on(table.createdAt),
]);

export const auditActions = ["created", "updated", "approved", "rejected", "exported"] as const;

export const auditEvents = mysqlTable("auditEvents", {
  id: int("id").autoincrement().primaryKey(),
  validationRecordId: int("validationRecordId").notNull(),
  actorUserId: int("actorUserId").notNull(),
  action: mysqlEnum("action", auditActions).notNull(),
  previousStatus: varchar("previousStatus", { length: 32 }),
  nextStatus: varchar("nextStatus", { length: 32 }),
  summary: text("summary").notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("auditEvents_record_idx").on(table.validationRecordId),
  index("auditEvents_actor_idx").on(table.actorUserId),
  index("auditEvents_createdAt_idx").on(table.createdAt),
]);

/** Immutable approval decisions are separated from the record lifecycle for controlled review. */
export const recordApprovals = mysqlTable("recordApprovals", {
  id: int("id").autoincrement().primaryKey(),
  validationRecordId: int("validationRecordId").notNull(),
  approverUserId: int("approverUserId").notNull(),
  decision: mysqlEnum("decision", ["approved", "rejected"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("recordApprovals_record_idx").on(table.validationRecordId),
  index("recordApprovals_approver_idx").on(table.approverUserId),
]);

export type ValidationRecord = typeof validationRecords.$inferSelect;
export type InsertValidationRecord = typeof validationRecords.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type RecordApproval = typeof recordApprovals.$inferSelect;
