# Polarimeter Save Fix Report

**Updated:** 2026-11-18. The fix was merged in PR #3. This update adds the draft round-trip verification and a full re-run of all checks on branch `arena/602b09f7-calibration` (PR #4).

## 1. Status

| Acceptance item | Status | Evidence |
|---|---|---|
| Root cause identified | ✅ | Migration not applied to production (`DATABASE-SCHEMA-ANALYSIS.md` §1.4) |
| Migration correct, idempotent, data-preserving | ✅ | Real PostgreSQL 30/30 |
| Production schema migrated | ✅ | `/api/health/schema` → `ok: true`, 7/7 tables, settings provisioned (2026-11-19 02:44 UTC) |
| Existing draft update → retrieve → reopen preserves measurements and protocol snapshot | ✅ SQLite, ✅ PostgreSQL, ✅ Supabase adapter (mocked) | §3 |
| Same behaviour against the **live Supabase project** | ⏳ **Not run** | No credentials or network in the sandbox. Run `pnpm test:integration` locally (§5) |
| Live save on https://calibration-silk.vercel.app | ⏳ **Not confirmed** by a user test yet | Functional steps in §5 |
| Protocol pending-verification restriction intact | ✅ | Approval refused while QC-032D is unverified (SQLite test and SQL function unchanged) |
| Formal approval server-authoritative | ✅ | Unchanged |

## 2. What was fixed (PR #3, summary)

- **"Protocol pending verification":**
  - The warning never blocked data entry, calculation, navigation or draft saving.
  - The real failure was the missing database objects. Server-draft errors are now shown verbatim.
  - Approval remains blocked server-side.
- **HTTP 400 `retest_of_record_id`:**
  - The migration was hardened and applied.
  - `SupabaseRequestError` keeps the PostgREST message and adds guidance for schema-cache codes.
  - Nothing is dropped or retried with fewer fields.
- **Diagnostics:** `GET /api/health/schema` is a read-only probe, with no secrets in the response.

## 3. Draft round-trip verification (new)

| Test | Class | What it proves |
|---|---|---|
| `server/polarimeterSaveFix.test.ts` › *updates an existing draft record, then retrieves and reopens it…* | **[SQLite]** real | Existing draft record updated (version 2); stale update refused; listed; reopened with identical measurements and protocol snapshot; `retest_of_record_id` NULL |
| `server/polarimeterSaveFix.test.ts` › existing server-draft test | **[SQLite]** real | Empty, partial and completed server drafts; version-guarded update; reopen equal |
| `server/supabasePolarimeterDraftUpdate.test.ts` (2 tests) | **[Supabase-mocked]**, stateful fake PostgREST | Adapter: update uses `PATCH ?version=eq.N`; stale version → conflict, nothing overwritten; reopen returns the stored payload. Record `PATCH` uses `record_version`, `lifecycle_status=draft` and owner filters. **Mutation-checked:** a deliberately wrong expectation made it fail |
| `scripts/db-verify/verify-migration.mjs` (draft block) | **[PG-real]** | Same round trip on real PostgreSQL 18 with the real migration, constraints and `jsonb` |
| `scripts/db-verify/verify-protocols.ts` (draft block) | **[PG-real]** | Protocol draft revision saved twice, stale save refused, reopened intact; earlier execution keeps measurements, snapshot and hash |
| `server/supabase.integration.test.ts` › opt-in write test | **[REAL Supabase]** | Same round trip on the live project. **Skipped here** (no credentials) |

## 4. Full check results (this run)

**Environment:** node 22, `NODE_OPTIONS=--experimental-sqlite`, dummy Supabase URL. Because the URL is a dummy, the real-Supabase suites skip.

| Group | Files | Result |
|---|---|---|
| TypeScript, `pnpm check` | — | ✅ 0 errors |
| Polarimeter (calculations, workflow, save fix) | `polarimeterCalculations`, `polarimeterWorkflow`, `polarimeterSaveFix` | ✅ 23/23 |
| Save-fix tests by class | `polarimeterSaveFix`: [SQLite] 3 + health route 1, [Supabase-mocked] 4, [SQL-static] 3 | ✅ 11/11 |
| Supabase adapter, mocked | `supabasePolarimeter{Record,Settings,Workflow,DraftErrors,DraftUpdate}` | ✅ 13/13 (**mocked, not live**) |
| SQLite database | `localDb`, `localDbMigration` | ✅ 5/5 |
| Other instruments regression | `validationRecompute`, `controlledSettings`, `validationUtils`, `recordFilters`, `recordAnalytics` | ✅ 14/14 |
| Auth, roles, users | `accountSecurity`, `adminActivities`, `auth.logout`, `rolePermissions`, `userManagement` | ✅ 12/12 |
| Protocol Management | `protocolCalc`, `protocolShared`, `protocolService`, `protocolPdf` | ✅ 40/40 |
| **Full suite** (`pnpm test`) | 31 files | ✅ **116 passed, 9 skipped, 0 failed** |
| Real PostgreSQL, Polarimeter migration | `scripts/db-verify` `npm test` | ✅ 30/30 |
| Real PostgreSQL, Protocol Management | `verify-protocols.ts` | ✅ 52/52 |
| Production build | `pnpm build`, `pnpm run build:vercel` | ✅ (Vercel function bundle 2.33 MB, nodejs22.x) |
| **REAL Supabase** | `supabase.integration` (4), `supabase.connection` (3), `localAuth` (1), `validationSettings` (1) | ⏭️ **9 skipped, not run.** With `pnpm test:integration` and no credentials they **fail on purpose** (verified: exit 1) |

**What changed in the real-Supabase tests:**
- **Before:** the three older files ran unconditionally and failed in any environment without live credentials, so they were indistinguishable from real regressions.
- **Now:** they are gated by `server/testSupport/realSupabase.ts` and labelled `[REAL Supabase …]`. Their assertions are unchanged.
- **Mocked suites:** their titles are now prefixed `[Supabase-mocked]`, so mocked results cannot be mistaken for live-database results.

## 5. Remaining manual verification (operator)

1. **Rotate the secrets** that were committed in history (commit `b98bb05` and the `env.` file):
   - the Supabase `service_role` key;
   - the access token;
   - the admin password;
   - `JWT_SECRET`.

   Then update Vercel. *Not yet confirmed.*
2. **Real Supabase tests, run locally** with your private `.env` (never paste secrets into chat):
   ```bash
   pnpm test:integration                                # read-only checks
   SUPABASE_INTEGRATION_WRITE=1 pnpm test:integration   # + draft update/reopen round trip
   ```
3. **Live functional check** on https://calibration-silk.vercel.app:
   1. Open Polarimeter and enter values. Expect `Server draft: saved. Version N`.
   2. Change a value. The version should increase.
   3. Reload. The values should reappear.
   4. Calculate → Save. There should be no 400 error.
   5. Open the record in Records & Audit. Measurements and protocol status *Pending verification* must be intact.
   6. Try to approve. It must be refused while QC-032D is unverified.
4. **For PR #4:** apply `server/sql/protocol_management_migration.sql` in the Supabase SQL Editor, then confirm `protocolManagement.ok: true` on `/api/health/schema`.
