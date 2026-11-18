/**
 * Vercel serverless entry point.
 *
 * Bundled by scripts/build-vercel.mjs into
 * .vercel/output/functions/api/index.func/index.mjs. Every request to /api/*
 * and /manus-storage/* is routed here; the original URL is preserved, so the
 * Express routes match exactly as they do on the long-running server.
 */
import { createApp } from "../_core/app";

const app = createApp();
// Vercel terminates TLS at its edge: trust X-Forwarded-* for protocol & host.
app.set("trust proxy", true);

export default app;
