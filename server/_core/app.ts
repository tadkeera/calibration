import express, { type Express } from "express";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { OFFICIAL_REPORT_HEADER_KEY } from "../officialHeader";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { checkSchemaHealth } from "../db";

/**
 * Builds the Express application with every API route (tRPC, OAuth, storage).
 * It does not serve the client or listen on a port, so it can be reused by the
 * long-running Node server (server/_core/index.ts) and by the Vercel
 * serverless function (server/vercel/handler.ts).
 */
export function createApp(): Express {
  const app = express();
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  if (process.env.QC_STORAGE_MODE === "local") {
    const assetDirectory = process.env.QC_DESKTOP_ASSETS_DIR;
    if (assetDirectory) {
      const resolvedAssetDirectory = path.resolve(assetDirectory);
      app.get("/api/trpc/assets.officialReportHeaderUrl", async (_req, res) => {
        res.json({
          result: {
            data: {
              json: {
                url: `/manus-storage/${OFFICIAL_REPORT_HEADER_KEY}`,
              },
            },
          },
        });
      });
      app.use("/manus-storage", express.static(resolvedAssetDirectory, { fallthrough: false, maxAge: "7d" }));
    }
  } else {
    registerStorageProxy(app);
  }
  registerOAuthRoutes(app);
  // Read-only, unauthenticated schema health probe. Returns only booleans and
  // missing column names — never rows, keys or connection details.
  app.get("/api/health/schema", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const health = await checkSchemaHealth();
      res.status(health.ok ? 200 : 503).json(health);
    } catch (error) {
      console.error("[SchemaHealth] check failed", error);
      res.status(500).json({
        ok: false,
        error: "Schema health check could not reach the configured database",
        checkedAt: new Date().toISOString(),
      });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  return app;
}
