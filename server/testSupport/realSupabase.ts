/**
 * Gate for REAL Supabase integration tests (network + live project).
 *
 * Test classes in this repository:
 *   [SQLite]                real node:sqlite database, no mocks
 *   [Supabase-mocked]       fetch() stubbed with PostgREST-shaped responses
 *   [REAL Supabase]         talks to the configured live Supabase project
 *
 * [REAL Supabase] suites run only when real credentials are present
 * (SUPABASE_URL = https://<20-char-ref>.supabase.co and a non-placeholder
 * service-role key, from the environment or a local .env file). Otherwise they
 * are reported as SKIPPED — never as passed. Set SUPABASE_INTEGRATION=required
 * (see `pnpm test:integration`) to make missing credentials a hard failure.
 *
 * This module is imported only by the [REAL Supabase] test files; vitest
 * isolates each test file, so loading .env here does not affect other suites.
 */
import { config } from "dotenv";

config({ quiet: true });

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const placeholder = /dummy|synthetic|test-only|example|placeholder/i;

export const hasRealSupabaseCredentials =
  /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url) && key.length >= 40 && !placeholder.test(url) && !placeholder.test(key);

export const supabaseIntegrationRequired = process.env.SUPABASE_INTEGRATION === "required";

/** True when [REAL Supabase] suites should execute (creds present, or explicitly required). */
export const runRealSupabase = hasRealSupabaseCredentials || supabaseIntegrationRequired;

/** For optional secrets used by individual real tests (access token, admin password). */
export const runWithSecret = (name: string) => runRealSupabase && (Boolean(process.env[name]) || supabaseIntegrationRequired);

export const REAL_SUPABASE_LABEL = hasRealSupabaseCredentials
  ? "[REAL Supabase]"
  : supabaseIntegrationRequired
    ? "[REAL Supabase — REQUIRED but no real credentials configured]"
    : "[REAL Supabase — SKIPPED: no real credentials]";
