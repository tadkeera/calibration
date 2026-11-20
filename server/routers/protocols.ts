/**
 * Protocol Management API (tRPC). Authentication is required for every
 * procedure; duty checks, segregation of duties and state rules are enforced
 * in server/protocols/service.ts (never in the frontend).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { measurementsSchema } from "../../shared/protocols/evaluate";
import { PROTOCOL_TYPE_IDS, REFERENCE_TYPE_IDS, REFERENCE_VERIFICATION_STATUSES, GAP_DECISION_IDS } from "../../shared/protocols/model";
import { PROTOCOL_DUTY_IDS, WORKFLOW_ACTIONS } from "../../shared/protocols/workflow";
import { EXECUTION_REVIEW_ACTIONS, EXECUTION_REVIEW_STATUSES } from "../../shared/protocols/executionReview";
import { ATTACHMENT_ENTITY_TYPES, MAX_ATTACHMENT_BYTES } from "../../shared/protocols/attachments";
import * as service from "../protocols/service";
import * as workflow from "../protocols/workflowService";
import { ProtocolConflictError } from "../protocols/tables";

type Ctx = { user: { id: number; name: string | null; role: "admin" | "user" | "viewer"; email?: string | null } };
const actorOf = (ctx: Ctx): service.Actor => ({ id: ctx.user.id, name: ctx.user.name, role: ctx.user.role, email: ctx.user.email ?? null });
/** Electronic-signature password (re-authentication). Never logged or stored. */
const signaturePassword = z.string().min(1).max(256).optional();

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof service.ProtocolError) throw new TRPCError({ code: error.code, message: error.message, cause: error });
    if (error instanceof ProtocolConflictError) throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
    if (error instanceof TRPCError) throw error;
    const message = error instanceof Error ? error.message : "Unexpected protocol module error";
    // Database guard messages (immutability, transitions) are safe to show; no secrets are included.
    console.error("[protocols]", message);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message, cause: error });
  }
}

const revisionId = z.string().min(1).max(64);
const dateText = z.string().max(10).regex(/^$|^\d{4}(-\d{2}(-\d{2})?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD");
const identificationSchema = z.object({
  title: z.string().min(3).max(255),
  number: z.string().min(2).max(64),
  protocolType: z.enum(PROTOCOL_TYPE_IDS),
  description: z.string().max(2000).optional(),
  equipmentCategory: z.string().max(120).optional(),
  equipmentType: z.string().max(120).optional(),
  manufacturer: z.string().max(255).optional(),
  model: z.string().max(128).optional(),
  associationType: z.enum(["model", "equipment"]).optional(),
  intendedUse: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  relatedForm: z.string().max(64).optional(),
});

const instrumentKey = z.string().min(1).max(64);
const runId = z.string().min(1).max(64);
const identityInput = z.object({
  instrumentId: z.string().max(255), manufacturer: z.string().max(255), model: z.string().max(255), serialNumber: z.string().max(255),
  nameEn: z.string().max(255), nameAr: z.string().max(255), sopNumber: z.string().max(255), formNumber: z.string().max(255),
});
const specsInput = z.record(z.string().max(64), z.object({ value: z.union([z.number(), z.string().max(500)]).nullable(), unit: z.string().max(40), source: z.string().max(500) })).refine(v => Object.keys(v).length <= 80, "Too many specifications");
const deviationsInput = z.array(z.object({ description: z.string().max(2000), impact: z.string().max(2000), immediateAction: z.string().max(2000), reference: z.string().max(200) })).max(20).optional();

export const protocolsRouter = router({
  me: protectedProcedure.query(({ ctx }) => run(() => service.getMe(actorOf(ctx)))),
  moduleStatus: protectedProcedure.query(() => run(() => service.moduleStatus())),
  dashboard: protectedProcedure.query(() => run(() => service.dashboard())),
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().max(200).optional(),
        status: z.string().max(60).optional(),
        protocolType: z.string().max(60).optional(),
        equipmentCategory: z.string().max(120).optional(),
        author: z.string().max(120).optional(),
        revision: z.number().int().positive().optional(),
        approvedFrom: z.string().max(10).optional(),
        approvedTo: z.string().max(10).optional(),
        reviewBefore: z.string().max(10).optional(),
        flag: z.enum(["due-for-review", "expired-references", "pending-verification", "open-gaps", "review-flag"]).optional(),
        sort: z.enum(["protocolNumber", "title", "updatedAt", "status", "nextReviewDate"]).optional(),
        direction: z.enum(["asc", "desc"]).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      })
    )
    .query(({ input }) => run(() => service.listProtocols(input))),
  detail: protectedProcedure.input(z.object({ protocolId: z.string().min(1).max(64) })).query(({ input }) => run(() => service.getProtocolDetail(input.protocolId))),
  revision: protectedProcedure.input(z.object({ revisionId })).query(({ ctx, input }) => run(() => service.getRevision(actorOf(ctx), input.revisionId))),
  compare: protectedProcedure.input(z.object({ fromRevisionId: revisionId, toRevisionId: revisionId })).query(({ input }) => run(() => service.compareRevisions(input.fromRevisionId, input.toRevisionId))),
  audit: protectedProcedure.input(z.object({ protocolId: z.string().max(64).optional(), entityType: z.string().max(60).optional(), limit: z.number().int().min(1).max(1000).optional() })).query(({ input }) => run(() => service.listAudit(input))),
  equipment: protectedProcedure.query(() => run(() => service.equipmentRegistry())),

  create: protectedProcedure
    .input(z.object({ content: z.unknown().optional(), templateId: z.string().max(64).optional(), identification: identificationSchema.optional(), reason: z.string().min(3).max(1000) }))
    .mutation(({ ctx, input }) => run(() => service.createProtocol(actorOf(ctx), input as Parameters<typeof service.createProtocol>[1]))),
  saveDraft: protectedProcedure
    .input(z.object({ revisionId, expectedRowVersion: z.number().int().positive(), content: z.unknown(), reason: z.string().min(3).max(1000) }))
    .mutation(({ ctx, input }) => run(() => service.saveDraft(actorOf(ctx), input))),
  createRevision: protectedProcedure
    .input(z.object({ protocolId: z.string().min(1).max(64), reason: z.string().min(3).max(1000), description: z.string().max(2000) }))
    .mutation(({ ctx, input }) => run(() => service.createRevision(actorOf(ctx), input))),
  transition: protectedProcedure
    .input(z.object({ revisionId, expectedRowVersion: z.number().int().positive(), action: z.enum(WORKFLOW_ACTIONS), comment: z.string().max(4000).optional(), effectiveDate: z.string().max(10).optional(), attestation: z.boolean().optional(), password: signaturePassword }))
    .mutation(({ ctx, input }) => run(() => service.transition(actorOf(ctx), input))),
  addComment: protectedProcedure
    .input(z.object({ revisionId, targetType: z.enum(["protocol", "section", "test", "criterion", "reference", "interval", "gap", "calculation"]), targetKey: z.string().max(200).nullable(), body: z.string().min(3).max(4000) }))
    .mutation(({ ctx, input }) => run(() => service.addReviewComment(actorOf(ctx), input))),
  resolveComment: protectedProcedure
    .input(z.object({ commentId: z.string().min(1).max(64), expectedRowVersion: z.number().int().positive(), note: z.string().min(3).max(2000) }))
    .mutation(({ ctx, input }) => run(() => service.resolveReviewComment(actorOf(ctx), input))),
  recordGapDecision: protectedProcedure
    .input(z.object({ revisionId, gapKey: z.string().min(1).max(64), decision: z.enum(GAP_DECISION_IDS), rationale: z.string().min(10).max(4000) }))
    .mutation(({ ctx, input }) => run(() => service.recordGapDecision(actorOf(ctx), input))),

  references: protectedProcedure.query(() => run(() => service.listReferences())),
  saveReference: protectedProcedure
    .input(
      z.object({
        id: z.string().max(64).optional(),
        expectedRowVersion: z.number().int().positive().optional(),
        code: z.string().min(2).max(64),
        title: z.string().min(3).max(500),
        issuer: z.string().max(255),
        referenceType: z.enum(REFERENCE_TYPE_IDS),
        documentNumber: z.string().max(120),
        edition: z.string().max(120),
        revision: z.string().max(120),
        publicationDate: dateText,
        effectiveDate: dateText,
        expiryDate: dateText,
        reviewDate: dateText,
        sourceUrl: z.string().max(1000).regex(/^$|^https?:\/\//, "URL must start with http(s)://"),
        documentUrl: z.string().max(1000).regex(/^$|^https?:\/\//, "URL must start with http(s)://"),
        applicableSection: z.string().max(300),
        applicableClause: z.string().max(300),
        verificationStatus: z.enum(REFERENCE_VERIFICATION_STATUSES),
        notes: z.string().max(4000),
        reason: z.string().min(3).max(1000),
      })
    )
    .mutation(({ ctx, input }) => run(() => service.saveReference(actorOf(ctx), input))),

  releasedForEquipment: protectedProcedure.input(z.object({ instrumentKey: z.string().min(1).max(64) })).query(({ input }) => run(() => service.releasedForEquipment(input.instrumentKey))),
  execute: protectedProcedure
    .input(z.object({ revisionId, instrumentKey: z.string().min(1).max(64), measurements: measurementsSchema, validationRecordId: z.number().int().positive().nullable().optional(),
        stage: z.string().max(60).optional(), comments: z.string().max(4000).optional(),
        activityKey: z.string().max(64).nullable().optional(),
        deviations: z.array(z.object({ description: z.string().max(2000), impact: z.string().max(2000), immediateAction: z.string().max(2000), reference: z.string().max(200) })).max(20).optional(),
      }))
    .mutation(({ ctx, input }) => run(() => service.executeProtocol(actorOf(ctx), input))),
  executions: protectedProcedure.input(z.object({ protocolId: z.string().max(64).optional(), instrumentKey: z.string().max(64).optional(), reviewStatus: z.enum(EXECUTION_REVIEW_STATUSES).optional() })).query(({ input }) => run(() => service.listExecutions(input))),
  execution: protectedProcedure.input(z.object({ executionId: z.string().min(1).max(64) })).query(({ ctx, input }) => run(() => service.getExecution(actorOf(ctx), input.executionId))),
  reviewExecution: protectedProcedure
    .input(z.object({ executionId: z.string().min(1).max(64), action: z.enum(EXECUTION_REVIEW_ACTIONS), comment: z.string().min(3).max(4000), password: signaturePassword }))
    .mutation(({ ctx, input }) => run(() => service.reviewExecution(actorOf(ctx), input))),
  schedule: protectedProcedure.input(z.object({ instrumentKey: z.string().max(64).optional() }).optional()).query(({ input }) => run(() => service.activitySchedule(input ?? {}))),
  attachments: protectedProcedure
    .input(z.object({ entityType: z.enum(ATTACHMENT_ENTITY_TYPES), entityId: z.string().min(1).max(64) }))
    .query(({ input }) => run(() => service.listAttachments(input.entityType, input.entityId))),
  uploadAttachment: protectedProcedure
    .input(z.object({
      entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
      entityId: z.string().min(1).max(64),
      fileName: z.string().min(1).max(255),
      mimeType: z.string().max(120),
      contentBase64: z.string().min(1).max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8),
      description: z.string().max(1000).optional(),
    }))
    .mutation(({ ctx, input }) => run(() => service.uploadAttachment(actorOf(ctx), input))),
  downloadAttachment: protectedProcedure.input(z.object({ attachmentId: z.string().min(1).max(64) })).mutation(({ input }) => run(() => service.downloadAttachment(input.attachmentId))),

  notifications: protectedProcedure.query(({ ctx }) => run(() => service.listNotifications(actorOf(ctx)))),
  markNotificationRead: protectedProcedure.input(z.object({ notificationId: z.string().min(1).max(64) })).mutation(({ ctx, input }) => run(() => service.markNotificationRead(actorOf(ctx), input.notificationId))),
  duties: protectedProcedure.query(() => run(() => service.listDutyAssignments())),
  setDuty: protectedProcedure
    .input(z.object({ userId: z.number().int().positive(), duty: z.enum(PROTOCOL_DUTY_IDS), granted: z.boolean(), reason: z.string().min(3).max(1000) }))
    .mutation(({ ctx, input }) => run(() => service.setDuty(actorOf(ctx), input))),
  templates: protectedProcedure.query(() => run(() => service.listTemplates())),
  saveTemplate: protectedProcedure
    .input(z.object({ revisionId, name: z.string().min(3).max(200), templateCategory: z.string().min(2).max(120), description: z.string().max(1000) }))
    .mutation(({ ctx, input }) => run(() => service.saveTemplateFromRevision(actorOf(ctx), input))),
  logPdf: protectedProcedure.input(z.object({ revisionId, documentStatus: z.string().max(60) })).mutation(({ ctx, input }) => run(() => service.logPdfGenerated(actorOf(ctx), input))),
  configureAdp220: protectedProcedure.mutation(({ ctx }) => run(() => service.configureAdp220Draft(actorOf(ctx)))),

  /* ---- v3: 8-protocol package, equipment data & specifications, calibration runs ---- */
  importPackage: protectedProcedure.mutation(({ ctx }) => run(() => workflow.importCalibrationPackage(actorOf(ctx)))),
  equipmentData: protectedProcedure.query(() => run(() => workflow.listEquipmentData())),
  equipmentDetail: protectedProcedure.input(z.object({ instrumentKey })).query(({ input }) => run(() => workflow.getEquipmentData(input.instrumentKey))),
  updateEquipment: protectedProcedure
    .input(z.object({ instrumentKey, expectedSpecsRowVersion: z.number().int().min(0), identity: identityInput, specs: specsInput, equipmentType: z.string().max(64).optional(), reason: z.string().max(1000), reference: z.string().max(300) }))
    .mutation(({ ctx, input }) => run(() => workflow.updateEquipmentData(actorOf(ctx), input))),
  createEquipment: protectedProcedure
    .input(z.object({ instrumentKey, equipmentType: z.string().min(2).max(64), identity: identityInput, specs: specsInput, reason: z.string().min(3).max(1000), reference: z.string().max(300) }))
    .mutation(({ ctx, input }) => run(() => workflow.createEquipmentData(actorOf(ctx), input))),
  retireEquipment: protectedProcedure
    .input(z.object({ instrumentKey, expectedSpecsRowVersion: z.number().int().min(0), reason: z.string().min(3).max(1000) }))
    .mutation(({ ctx, input }) => run(() => workflow.retireEquipmentData(actorOf(ctx), input))),
  runCatalog: protectedProcedure.query(() => run(() => workflow.runCatalog())),
  runs: protectedProcedure
    .input(z.object({ protocolId: z.string().max(64).optional(), instrumentKey: z.string().max(64).optional(), status: z.enum(["draft", "recorded", "abandoned"]).optional() }).optional())
    .query(({ input }) => run(() => workflow.listRuns(input ?? {}))),
  run: protectedProcedure.input(z.object({ runId })).query(({ ctx, input }) => run(() => workflow.getRun(actorOf(ctx), input.runId))),
  runVersion: protectedProcedure.input(z.object({ runId, rowVersion: z.number().int().min(1) })).query(({ input }) => run(() => workflow.runVersion(input.runId, input.rowVersion))),
  createRun: protectedProcedure.input(z.object({ protocolId: z.string().min(1).max(64), instrumentKey })).mutation(({ ctx, input }) => run(() => workflow.createRun(actorOf(ctx), input))),
  saveRun: protectedProcedure
    .input(z.object({ runId, expectedRowVersion: z.number().int().min(1), measurements: measurementsSchema, currentStep: z.string().max(80).nullable().optional(), reason: z.string().max(1000).optional() }))
    .mutation(({ ctx, input }) => run(() => workflow.saveRun(actorOf(ctx), input))),
  recordRun: protectedProcedure
    .input(z.object({ runId, expectedRowVersion: z.number().int().min(1), comments: z.string().max(4000).optional(), stage: z.string().max(60).optional(), deviations: deviationsInput }))
    .mutation(({ ctx, input }) => run(() => workflow.recordRun(actorOf(ctx), input))),
  abandonRun: protectedProcedure.input(z.object({ runId, expectedRowVersion: z.number().int().min(1), reason: z.string().min(3).max(1000) })).mutation(({ ctx, input }) => run(() => workflow.abandonRun(actorOf(ctx), input))),
  logRunPdf: protectedProcedure.input(z.object({ runId, documentStatus: z.string().max(60), documentId: z.string().max(120) })).mutation(({ ctx, input }) => run(() => workflow.logRunPdf(actorOf(ctx), input))),
});
