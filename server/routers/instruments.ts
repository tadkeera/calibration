import { z } from "zod";
import { listInstrumentChanges, listInstrumentProfiles, upsertInstrumentProfile } from "../db";
import { editorProcedure, protectedProcedure, router } from "../_core/trpc";

const instrumentProfileSchema = z.object({
  instrumentKey: z.string().min(1).max(64),
  nameAr: z.string().min(1).max(255),
  nameEn: z.string().min(1).max(255),
  instrumentId: z.string().min(1).max(64),
  sopNumber: z.string().min(1).max(64),
  manufacturer: z.string().min(1).max(255),
  model: z.string().min(1).max(128),
  serialNumber: z.string().min(1).max(128),
  formNumber: z.string().min(1).max(64),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const instrumentsRouter = router({
  list: protectedProcedure.query(() => listInstrumentProfiles()),
  update: editorProcedure.input(instrumentProfileSchema).mutation(({ ctx, input }) => upsertInstrumentProfile({ ...input, userId: ctx.user.id })),
  trail: protectedProcedure.input(z.object({ instrumentKey: z.string().min(1).max(64) })).query(({ input }) => listInstrumentChanges(input.instrumentKey)),
});
