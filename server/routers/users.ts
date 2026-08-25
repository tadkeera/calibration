import { z } from "zod";
import { createLocalUser, listUsers, updateUserRole } from "../db";
import { adminProcedure, router } from "../_core/trpc";

const roleSchema = z.enum(["admin", "user", "viewer"]);

export const usersRouter = router({
  list: adminProcedure.query(() => listUsers()),
  create: adminProcedure
    .input(z.object({ email: z.string().email().max(320), name: z.string().min(2).max(120), password: z.string().min(6).max(128), role: roleSchema }))
    .mutation(({ input }) => createLocalUser(input)),
  updateRole: adminProcedure
    .input(z.object({ id: z.number().int().positive(), role: roleSchema }))
    .mutation(({ input }) => updateUserRole(input)),
});
