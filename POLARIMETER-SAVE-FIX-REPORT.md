# Polarimeter Save Fix Report

## Status

| Acceptance item | Status |
|---|---|
| Root cause identified | ✅ Migration never applied to production Supabase (see `DATABASE-SCHEMA-ANALYSIS.md`) |
| Migration correct, idempotent, data-preserving | ✅ Verified on real PostgreSQL 18 |
| SQLite and Supabase parity | ✅ |
| Protocol Pending Verification restriction intact | ✅ Unchanged on client, server and database |
| Formal approval server-authoritative | ✅ Unchanged |
| **Deployed Supabase save operation works** | ⏳ **NOT YET CONFIRMED.** Requires the operator to run the migration in Supabase, then the checks below |

No claim of production success is made until `GET /api/health/schema` returns `"ok": true` and a real save succeeds on https://calibration-silk.vercel.app.

## Issue 1: "Protocol pending verification"

Finding: the warning **does not block** the workflow in the code.
- Stepper and Previous/Next are never gated by protocol status.
- The measurement `fieldset` is disabled only for `readOnly` or a blocked local-draft recovery.
- "Calculate and attach" requires complete measurements and equipment identity, not protocol approval.
- Local recovery autosaves on every change. Server drafts autosave to `polarimeter_drafts`.

What users experienced as "blocked" was the server draft and record save failing, because the database objects were missing (Issue 2). The UI reported only "Server draft: offline".

Changes (no weakening of approval):
- The warning now states that equipment review, measurement entry, calculations, navigation and draft saving remain available.
- Server-draft failures are shown verbatim in the footer (`Server draft not saved: <reason>`), with a note that entries remain in local recovery.
- Approval remains blocked by: the server (`approveValidationRecord`), the SQL function `decide_polarimeter_validation_record` (`protocolStatus` must be `approved`), and technical review acceptance. None of this code was modified.

## Issue 2: HTTP 400 `retest_of_record_id`

- **Migration:** see `DATABASE-MIGRATION-REPORT.md`.
- **Error handling:** `SupabaseRequestError` keeps the original PostgREST message and, for schema-cache codes (`PGRST202/204/205`, `42703`, `42P01`), appends the instruction to apply the migration. Nothing is dropped or retried with fewer fields.
- **Diagnostics:** `GET /api/health/schema` is a read-only, unauthenticated probe. It returns booleans and missing column names only. Response codes: 200 healthy, 503 schema behind, 500 unreachable.

## Retest traceability

The database architecture supports retests: a NULLable bigint FK, a partial index, and link-validation and immutability triggers in both engines. The application has a retest entry point (`retestContext` in `Home.tsx`) and server-side reference checks. **Not declared complete:** the end-to-end retest workflow has not been verified on the deployed system. It will be once the migration is applied.

## Tests

| Suite | Type | Result |
|---|---|---|
| `server/polarimeterSaveFix.test.ts` | `[SQLite]` real DB: empty, partial and completed drafts, draft update, reopen, measurements and protocol snapshot preserved, NULL retest reference, linked retest, failed original preserved, retest of passed record refused, pending-protocol approval refused, health route | ✅ 10/10 |
| ↳ same file | `[Supabase-mocked]`: payload always includes `retest_of_record_id: null`; PGRST204 surfaced with guidance and no audit write; health check pinpoints missing columns; health check read-only | ✅ |
| `scripts/db-verify` | Real PostgreSQL 18 migration test | ✅ 24/24 |
| Vercel function bundle + fake PostgREST copying the production error | `/api/health/schema` → 503 with exact missing columns, then 200 after "migration" | ✅ |
| Full suite (`pnpm test`) | 73 pass. The 5 failures are the pre-existing **real-Supabase** integration tests (`supabase.connection`, `localAuth`, `validationSettings`), which need live credentials and network. Not run here | 73/78 |
| `pnpm check`, `pnpm build`, `pnpm run build:vercel` | | ✅ |

## Deployment instructions

1. **Rotate secrets first.** `.env` with real keys was committed to the public repository again (commit `b98bb05`). This branch removes it, but it stays in git history. Regenerate the Supabase `service_role` key, delete the access token, change the admin password, and set a new `JWT_SECRET`. Update Vercel environment variables, then redeploy.
2. **Apply the migration:** Supabase Dashboard → **SQL Editor** → New query → paste the whole of `server/sql/polarimeter_workflow_migration.sql` → **Run**. The final result grid must show `retest_of_record_id | bigint | YES`.
3. **Merge this PR.** Vercel deploys automatically.
4. **Verify the deployed database:** open `https://calibration-silk.vercel.app/api/health/schema`. Expect `"ok": true`, every check `"ok": true`, and `projectRefHint` matching the start of your Supabase project ref.
5. **Functional check on the live site:**
   1. Open Polarimeter and enter a few values. The footer should show `Server draft: saved. Version N`.
   2. Reload the page. The values should reappear.
   3. Complete all measurements, then **Calculate**, then **Save**. There should be no 400 error.
   4. Open the record in Records & Audit and confirm the measurements and protocol status *Pending verification*.
   5. Try to approve. It must be refused while QC-032D is unverified.
