# Database Migration Report

**Updated:** 2026-11-18 (branch `arena/602b09f7-calibration`, PR #4)

## 1. Migrations and their state

| Migration | Engine | State |
|---|---|---|
| `server/sql/polarimeter_workflow_migration.sql` | Supabase | Applied in production (health endpoint `ok: true`) |
| **`server/sql/protocol_management_migration.sql`** | Supabase | **New in PR #4. Must be applied by the operator** |
| `server/localDb.ts` (validation records, Polarimeter workflow) | SQLite | Automatic at startup, including upgrade of legacy files |
| `server/protocols/sqliteSchema.ts` (Protocol Management) | SQLite | Automatic at startup (`CREATE … IF NOT EXISTS`) |

### 1.1 `polarimeter_workflow_migration.sql` (hardened in PR #3, unchanged since)

- Wrapped in `BEGIN; … COMMIT;`.
- Pre-checks that `validation_records.id` is `bigint`.
- Repairs a missing self-referencing FK without creating duplicates.
- Ends with `NOTIFY pgrst, 'reload schema'` and a final verification `SELECT`.
- Existing rows get `retest_of_record_id = NULL` and `record_version = 1`; historical rows are not rewritten.

### 1.2 `protocol_management_migration.sql` (new)

- **Structure:** 11 tables (see `DATABASE-SCHEMA-ANALYSIS.md` §2), 31 FKs, 13 indexes, guard triggers, RLS on every table, and the SECURITY DEFINER RPC `protocol_apply_changes(jsonb)`. `EXECUTE` is granted to `service_role` only.
- **Safety:**
  - Additive only, with no changes to existing tables.
  - Idempotent: running it twice is safe.
  - Transactional, with `NOTIFY pgrst, 'reload schema'` at the end.
- **No seeded laboratory data.** The POL-QC-032D draft and its pending references are created from the application (**Configure ADP220 draft**). Every criterion is unverified, so nothing is invented in SQL.

**How to apply:**
1. Supabase Dashboard → **SQL Editor** → New query.
2. Paste the whole file → **Run**.
3. Then open `/api/health/schema`. `protocolManagement.ok` must be `true`.

## 2. Verification performed (results of this run)

Test classes are kept strictly separate:

| Class | Meaning |
|---|---|
| **[SQLite]** | Real `node:sqlite` database file, no mocks |
| **[PG-real]** | Real PostgreSQL 18 server (embedded-postgres) running the actual migration SQL |
| **[Supabase-mocked]** | `fetch` stubbed with PostgREST-shaped responses. Proves the adapter's requests, filters and error handling, **not** the deployed database |
| **[SQL-static]** | Text checks of the migration files |
| **[REAL Supabase]** | Live project over the network. **Not run:** no credentials in the sandbox, `*.supabase.co` unreachable |

### 2.1 Real PostgreSQL: `scripts/db-verify/verify-migration.mjs` (Polarimeter workflow) — 30/30 PASS

- **Migration:** the pre-migration state reproduces production; run #1 and run #2 succeed (idempotent).
- **Schema:** bigint, NULLable, exactly one FK, parent index.
- **Existing data:** historical rows unchanged.
- **Draft round trip (new):**
  - draft created (v1);
  - version-guarded update (v2);
  - stale update changes nothing;
  - duplicate (`user_id`, `draft_key`) refused;
  - reopened `jsonb` payload deep-equal, including an empty reading and the protocol snapshot.
- **Draft record (new):** the existing draft record is updated to version 3 and reopened with measurements and snapshot deep-equal and `retest_of_record_id` NULL.
- **Retest rules:**
  - a valid retest is accepted, and the failed original is preserved;
  - retest of a passed record, a missing original, or a reason without an original are each refused;
  - failed measurements are immutable and cannot be deleted.
- **Other instruments:** HPLC still editable. A missing FK is restored on re-run.

### 2.2 Real PostgreSQL: `scripts/db-verify/verify-protocols.ts` (Protocol Management) — 52/52 PASS

- **Schema and permissions:**
  - every column the code writes exists;
  - RLS is enabled;
  - `anon` / `authenticated` have no privileges, and `anon` cannot call the RPC;
  - `service_role` cannot write tables directly.
- **Workflow via the production Supabase store code (`supabaseStore.ts` → RPC):**
  - create, then stale row version refused, duplicate submission refused, author self-review refused;
  - technical review → QA → **RELEASED**, with next review date computed;
  - execution recorded.
- **Database guards:**
  - locked content immutable;
  - `released → draft` refused;
  - audit, approvals and executions append-only;
  - protocols and references cannot be deleted;
  - RPC refuses a non-whitelisted table;
  - `PROTOCOL_CONFLICT` raised, and the failed change set leaves data unchanged;
  - a second open revision is refused.
- **POL-QC-032D:**
  - created as DRAFT, idempotent;
  - references pending verification;
  - a reference change flags the released protocol;
  - the approval-time snapshot is preserved.
- **Draft round trip (new):**
  - an existing draft revision is saved twice;
  - a stale save is refused;
  - on reopen the content is intact;
  - an earlier execution keeps its measurements, rev-1 protocol snapshot and content hash.
- **Existing data:** validation records unchanged, audit trail populated.

### 2.3 SQLite and other suites

See `POLARIMETER-SAVE-FIX-REPORT.md` §4 for the full table. Overall: **116 passed, 9 skipped, 0 failed** (31 files). The 9 skipped are exactly the [REAL Supabase] tests.

### 2.4 Re-running

```bash
pnpm install --frozen-lockfile
cd scripts/db-verify && npm install && npm test   # Polarimeter migration on real PostgreSQL
cd ../.. && npx tsx scripts/db-verify/verify-protocols.ts   # Protocol Management on real PostgreSQL
pnpm test                 # SQLite + mocked + static (real-Supabase suites SKIPPED without credentials)
pnpm test:integration     # REAL Supabase only; fails if credentials are missing
```

`pnpm test:integration` reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the environment or a local `.env`, which is never committed:
- **Default checks are read-only:** schema health for both migrations, settings, and no duplicate PE99003.
- **Opt-in write check:** setting `SUPABASE_INTEGRATION_WRITE=1` also runs the draft update → reopen round trip. It creates, updates and then removes one uniquely keyed draft for an existing administrator.
- **Secret-dependent checks** run only when that secret is set:
  - `SUPABASE_ACCESS_TOKEN`: management API check.
  - `INITIAL_ADMIN_PASSWORD`: administrator login.
