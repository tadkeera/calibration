import { z } from "zod";
import { listAdminActivityEvents } from "../db";
import { adminProcedure, router } from "../_core/trpc";

const filtersSchema = z.object({
  eventType: z.enum(["login_succeeded", "login_failed", "account_disabled", "account_enabled", "password_changed", "recovery_requested"]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).optional();

export const adminActivitiesRouter = router({
  list: adminProcedure.input(filtersSchema).query(({ input }) => listAdminActivityEvents(input)),
});
