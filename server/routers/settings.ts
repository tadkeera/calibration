import { z } from "zod";
import { listValidationSettings, upsertValidationSettings } from "../db";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

export const settingsRouter = router({
  list: protectedProcedure.query(() => listValidationSettings()),
  save: adminProcedure
    .input(z.object({ deviceKey: z.string().min(1).max(64), settings: z.record(z.string(), z.unknown()) }))
    .mutation(({ ctx, input }) => upsertValidationSettings({ ...input, userId: ctx.user.id })),
});
