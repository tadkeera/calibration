import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approveValidationRecord,
  createValidationRecord,
  getAuditTrail,
  getValidationRecordById,
  getValidationRecordSummary,
  listValidationRecords,
  markValidationRecordExported,
  updateValidationRecord,
} from "../db";
import { adminProcedure, editorProcedure, protectedProcedure, router } from "../_core/trpc";

const resultDataSchema = z.record(z.string(), z.unknown());
const recordPayloadSchema = z.object({
  instrumentKey: z.string().min(1).max(64),
  instrumentName: z.string().min(1).max(255),
  instrumentId: z.string().min(1).max(64),
  sopNumber: z.string().min(1).max(64),
  formNumber: z.string().min(1).max(64),
  resultStatus: z.enum(["pass", "fail"]),
  pharmacistName: z.string().min(1).max(255),
  resultData: resultDataSchema,
});
const recordFiltersSchema = z.object({
  instrumentKey: z.string().min(1).max(64).optional(),
  resultStatus: z.enum(["pass", "fail"]).optional(),
  lifecycleStatus: z.enum(["draft", "approved", "rejected"]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).optional();

async function requireRecordAccess(recordId: number, user: { id: number; role: "user" | "admin" | "viewer" }) {
  const record = await getValidationRecordById(recordId);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Validation record not found" });
  if (user.role === "user" && record.validatedByUserId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot access this validation record" });
  }
  return record;
}

export const recordsRouter = router({
  list: protectedProcedure
    .input(recordFiltersSchema)
    .query(({ ctx, input }) => listValidationRecords({ userId: ctx.user.id, canViewAll: ctx.user.role === "admin" || ctx.user.role === "viewer", ...input })),

  summary: protectedProcedure
    .input(recordFiltersSchema)
    .query(({ ctx, input }) => getValidationRecordSummary({ userId: ctx.user.id, canViewAll: ctx.user.role === "admin" || ctx.user.role === "viewer", ...input })),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ ctx, input }) => requireRecordAccess(input.id, ctx.user)),

  save: editorProcedure
    .input(recordPayloadSchema)
    .mutation(({ ctx, input }) => createValidationRecord({ ...input, userId: ctx.user.id })),

  updateDraft: editorProcedure
    .input(recordPayloadSchema.extend({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      if (record.lifecycleStatus !== "draft") {
        throw new TRPCError({ code: "CONFLICT", message: "Only draft records can be edited" });
      }
      const { id, ...payload } = input;
      return updateValidationRecord({ id, ...payload, userId: ctx.user.id });
    }),

  decide: adminProcedure
    .input(z.object({ id: z.number().int().positive(), decision: z.enum(["approved", "rejected"]) }))
    .mutation(({ ctx, input }) => approveValidationRecord({ id: input.id, decision: input.decision, userId: ctx.user.id })),

  trail: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireRecordAccess(input.id, ctx.user);
      return getAuditTrail(input.id);
    }),

  markExported: editorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      return markValidationRecordExported({ id: record.id, userId: ctx.user.id });
    }),
});
