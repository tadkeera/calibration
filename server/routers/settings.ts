import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createPolarimeterProtocolSnapshot } from "../../shared/polarimeter";
import { listValidationSettings, upsertValidationSettings } from "../db";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

export const settingsRouter = router({
  list: protectedProcedure.query(() => listValidationSettings()),
  save: adminProcedure
    .input(
      z.object({
        deviceKey: z.string().min(1).max(64),
        settings: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ ctx, input }) => {
      if (input.deviceKey === "polarimeter") {
        if (input.settings.protocolStatus !== "pending-verification") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Polarimeter protocol approval is unavailable until the approved SOP has been verified.",
          });
        }
        try {
          createPolarimeterProtocolSnapshot(input.settings);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Invalid Polarimeter protocol settings",
          });
        }
      }
      return upsertValidationSettings({ ...input, userId: ctx.user.id });
    }),
});
