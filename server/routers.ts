import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { changeLocalPassword, completePasswordRecovery, localLogin, requestPasswordRecovery } from "./db";
import { recordsRouter } from "./routers/records";
import { instrumentsRouter } from "./routers/instruments";
import { usersRouter } from "./routers/users";
import { settingsRouter } from "./routers/settings";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const user = await localLogin(input);
        const token = await sdk.createSessionToken(user.openId, { name: user.name ?? user.email ?? "" });
        ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: 7 * 24 * 60 * 60 * 1000 });
        return user;
      }),
    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) }))
      .mutation(async ({ ctx, input }) => {
        await changeLocalPassword({ userId: ctx.user.id, ...input });
        ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
        return { success: true, reloginRequired: true } as const;
      }),
    requestPasswordRecovery: publicProcedure
      .input(z.object({ email: z.string().email().max(320) }))
      .mutation(({ ctx, input }) => {
        const host = String(ctx.req.headers.host ?? "").trim();
        if (!host) throw new Error("Recovery origin is unavailable");
        const forwardedProtocol = String(ctx.req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
        const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : (ctx.req.protocol === "https" ? "https" : "http");
        return requestPasswordRecovery({ email: input.email, redirectTo: `${protocol}://${host}/?recovery=1` });
      }),
    completePasswordRecovery: publicProcedure
      .input(z.object({ recoveryToken: z.string().min(20).max(4096), newPassword: z.string().min(8).max(128) }))
      .mutation(({ input }) => completePasswordRecovery(input)),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  records: recordsRouter,
  instruments: instrumentsRouter,
  users: usersRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
