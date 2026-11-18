import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

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
  role: mysqlEnum("role", ["user", "admin", "viewer"])
    .default("user")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** The lifecycle of a validation record is controlled through protected tRPC procedures. */
export const recordStatuses = ["draft", "approved", "rejected"] as const;

export const validationRecords = mysqlTable(
  "validationRecords",
  {
    id: int("id").autoincrement().primaryKey(),
    instrumentKey: varchar("instrumentKey", { length: 64 }).notNull(),
    instrumentName: varchar("instrumentName", { length: 255 }).notNull(),
    instrumentId: varchar("instrumentId", { length: 64 }).notNull(),
    sopNumber: varchar("sopNumber", { length: 64 }).notNull(),
    formNumber: varchar("formNumber", { length: 64 }).notNull(),
    resultStatus: mysqlEnum("resultStatus", ["pass", "fail"]).notNull(),
    lifecycleStatus: mysqlEnum("lifecycleStatus", recordStatuses)
      .default("draft")
      .notNull(),
    resultData: json("resultData").$type<Record<string, unknown>>().notNull(),
    pharmacistName: varchar("pharmacistName", { length: 255 }).notNull(),
    validatedByUserId: int("validatedByUserId").notNull(),
    approvedByUserId: int("approvedByUserId"),
    approvedAt: timestamp("approvedAt"),
    recordVersion: int("recordVersion").default(1).notNull(),
    retestOfRecordId: int("retestOfRecordId"),
    retestReason: text("retestReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("validationRecords_createdBy_idx").on(table.validatedByUserId),
    index("validationRecords_status_idx").on(table.lifecycleStatus),
    index("validationRecords_createdAt_idx").on(table.createdAt),
  ]
);

export const auditActions = [
  "created",
  "updated",
  "approved",
  "rejected",
  "exported",
] as const;

export const auditEvents = mysqlTable(
  "auditEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    validationRecordId: int("validationRecordId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    action: mysqlEnum("action", auditActions).notNull(),
    previousStatus: varchar("previousStatus", { length: 32 }),
    nextStatus: varchar("nextStatus", { length: 32 }),
    summary: text("summary").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("auditEvents_record_idx").on(table.validationRecordId),
    index("auditEvents_actor_idx").on(table.actorUserId),
    index("auditEvents_createdAt_idx").on(table.createdAt),
  ]
);

/** Immutable approval decisions are separated from the record lifecycle for controlled review. */
export const recordApprovals = mysqlTable(
  "recordApprovals",
  {
    id: int("id").autoincrement().primaryKey(),
    validationRecordId: int("validationRecordId").notNull(),
    approverUserId: int("approverUserId").notNull(),
    decision: mysqlEnum("decision", ["approved", "rejected"]).notNull(),
    reason: text("reason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("recordApprovals_record_idx").on(table.validationRecordId),
    index("recordApprovals_approver_idx").on(table.approverUserId),
  ]
);

/** Account-scoped server drafts use version compare-and-swap for cross-device recovery. */
export const polarimeterDrafts = mysqlTable(
  "polarimeterDrafts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    draftKey: varchar("draftKey", { length: 64 }).notNull(),
    protocolVersion: varchar("protocolVersion", { length: 32 }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    version: int("version").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("polarimeterDrafts_owner_key").on(table.userId, table.draftKey),
  ]
);

/** Append-only decisions bound to one exact validation-record version. */
export const recordTechnicalReviews = mysqlTable(
  "recordTechnicalReviews",
  {
    id: int("id").autoincrement().primaryKey(),
    validationRecordId: int("validationRecordId").notNull(),
    recordVersion: int("recordVersion").notNull(),
    reviewerUserId: int("reviewerUserId").notNull(),
    decision: mysqlEnum("decision", ["accepted", "rejected"]).notNull(),
    comments: text("comments").notNull(),
    rejectionReason: text("rejectionReason"),
    outstandingIssues: json("outstandingIssues").$type<string[]>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("recordTechnicalReviews_record_idx").on(
      table.validationRecordId,
      table.createdAt
    ),
  ]
);

/** Failure evidence and CAPA state are separate from immutable measurement records. */
export const polarimeterDeviations = mysqlTable(
  "polarimeterDeviations",
  {
    id: int("id").autoincrement().primaryKey(),
    validationRecordId: int("validationRecordId").notNull(),
    testKey: mysqlEnum("testKey", [
      "accuracy",
      "repeatability",
      "linearity",
    ]).notNull(),
    actualResult: text("actualResult").notNull(),
    acceptanceLimit: text("acceptanceLimit").notNull(),
    protocolStatus: mysqlEnum("protocolStatus", [
      "approved",
      "pending-verification",
    ]).notNull(),
    investigation: text("investigation").notNull(),
    rootCause: text("rootCause").notNull(),
    correctiveAction: text("correctiveAction").notNull(),
    preventiveAction: text("preventiveAction").notNull(),
    responsibleUserId: int("responsibleUserId"),
    targetCompletionDate: varchar("targetCompletionDate", { length: 10 }),
    status: mysqlEnum("status", [
      "open",
      "investigating",
      "actions-planned",
      "closed",
    ])
      .default("open")
      .notNull(),
    version: int("version").default(1).notNull(),
    createdByUserId: int("createdByUserId").notNull(),
    updatedByUserId: int("updatedByUserId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    closedAt: timestamp("closedAt"),
  },
  table => [
    index("polarimeterDeviations_record_idx").on(table.validationRecordId),
  ]
);

/** Append-only CAPA audit history. */
export const polarimeterDeviationEvents = mysqlTable(
  "polarimeterDeviationEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    deviationId: int("deviationId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    eventType: varchar("eventType", { length: 32 }).notNull(),
    changeData: json("changeData").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("polarimeterDeviationEvents_case_idx").on(
      table.deviationId,
      table.createdAt
    ),
  ]
);

/** Controlled instrument metadata overrides the baseline profile for future records and reports. */
export const instrumentProfiles = mysqlTable("instrumentProfiles", {
  id: int("id").autoincrement().primaryKey(),
  instrumentKey: varchar("instrumentKey", { length: 64 }).notNull().unique(),
  nameAr: varchar("nameAr", { length: 255 }).notNull(),
  nameEn: varchar("nameEn", { length: 255 }).notNull(),
  instrumentId: varchar("instrumentId", { length: 64 }).notNull(),
  sopNumber: varchar("sopNumber", { length: 64 }).notNull(),
  manufacturer: varchar("manufacturer", { length: 255 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  serialNumber: varchar("serialNumber", { length: 128 }).notNull(),
  formNumber: varchar("formNumber", { length: 64 }).notNull(),
  accent: varchar("accent", { length: 16 }).notNull(),
  updatedByUserId: int("updatedByUserId").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Append-only metadata change log for instrument profile governance. */
export const instrumentChangeEvents = mysqlTable(
  "instrumentChangeEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    instrumentKey: varchar("instrumentKey", { length: 64 }).notNull(),
    editorUserId: int("editorUserId").notNull(),
    previousData: json("previousData").$type<Record<string, unknown>>(),
    nextData: json("nextData").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("instrumentChangeEvents_key_idx").on(table.instrumentKey),
    index("instrumentChangeEvents_editor_idx").on(table.editorUserId),
    index("instrumentChangeEvents_createdAt_idx").on(table.createdAt),
  ]
);

export type ValidationRecord = typeof validationRecords.$inferSelect;
export type InsertValidationRecord = typeof validationRecords.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type RecordApproval = typeof recordApprovals.$inferSelect;
export type InstrumentProfile = typeof instrumentProfiles.$inferSelect;
export type InstrumentChangeEvent = typeof instrumentChangeEvents.$inferSelect;
