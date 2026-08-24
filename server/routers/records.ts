import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approveValidationRecord,
  createValidationRecord,
  getAuditTrail,
  getValidationRecordById,
  listValidationRecords,
  markValidationRecordExported,
  updateValidationRecord,
} from "../db";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

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

async function requireRecordAccess(recordId: number, user: { id: number; role: "user" | "admin" }) {
  const record = await getValidationRecordById(recordId);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Validation record not found" });
  if (user.role !== "admin" && record.validatedByUserId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot access this validation record" });
  }
  return record;
}

export const recordsRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.enum(["draft", "approved", "rejected"]).optional() }).optional())
    .query(({ ctx, input }) => listValidationRecords({ userId: ctx.user.id, isAdmin: ctx.user.role === "admin", status: input?.status })),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ ctx, input }) => requireRecordAccess(input.id, ctx.user)),

  save: protectedProcedure
    .input(recordPayloadSchema)
    .mutation(({ ctx, input }) => createValidationRecord({ ...input, userId: ctx.user.id })),

  updateDraft: protectedProcedure
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

  markExported: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      return markValidationRecordExported({ id: record.id, userId: ctx.user.id });
    }),
});
