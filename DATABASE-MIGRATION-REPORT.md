# Database Migration Report

## Supabase: `server/sql/polarimeter_workflow_migration.sql` (updated, not duplicated)

The existing migration already defined the correct column, so it was hardened instead of adding a second, conflicting migration.

| Change | Purpose |
|---|---|
| Wrapped in `BEGIN; … COMMIT;` | All-or-nothing application |
| Pre-check: `validation_records.id` must be `bigint` | Prevents creating a mismatched FK type |
| `DO` block adds `validation_records_retest_of_record_id_fkey` if `retest_of_record_id` exists without a self-referencing FK | Covers a column added manually; no duplicate FK on re-run |
| `NOTIFY pgrst, 'reload schema';` after `COMMIT` | Supported Supabase mechanism to refresh the PostgREST schema cache immediately |
| Final verification `SELECT` from `information_schema.columns` | Operator sees `retest_of_record_id · bigint · YES` in the SQL Editor |
| Header with application instructions | Operator guidance |

Unchanged: `retest_of_record_id bigint NULL REFERENCES validation_records(id) ON DELETE RESTRICT`, `retest_reason text`, `record_version integer NOT NULL DEFAULT 1`, the partial index, the Polarimeter tables, RLS, service-role grants, immutability and retest-link triggers, and the RPC functions.

**Data safety:** the migration contains no `DELETE`, `TRUNCATE`, `DROP TABLE` or `DROP COLUMN`. Existing rows get `retest_of_record_id = NULL` and `record_version = 1`. Historical rows are not rewritten.

## SQLite: `server/localDb.ts`

The column, FK, triggers and the migration of legacy files already existed and were covered by tests. Added:
- `CREATE INDEX IF NOT EXISTS validation_records_retest_parent_idx … WHERE retest_of_record_id IS NOT NULL`, for parity with Supabase.
- `checkSchemaHealth()`, which uses `PRAGMA table_info` checks.

## Verification performed

| Test | Engine | Result |
|---|---|---|
| `scripts/db-verify/verify-migration.mjs` | **Real PostgreSQL 18** (embedded-postgres), Supabase-like roles and an `auth.users` table | 24/24 checks pass |
| ↳ Pre-migration state reproduces production (columns absent) | | ✅ |
| ↳ Migration run twice (idempotent) | | ✅ |
| ↳ `retest_of_record_id` = `bigint`, nullable, exactly one FK, index present | | ✅ |
| ↳ Historical rows byte-identical; new columns `NULL` / `1` | | ✅ |
| ↳ Normal record saves with `NULL`; draft update bumps `record_version` | | ✅ |
| ↳ Retest of failed original saves; original unchanged | | ✅ |
| ↳ Retest of passed / missing record, orphan reason, overwrite or delete of failed record: all rejected | | ✅ |
| ↳ Another instrument (HPLC) still editable | | ✅ |
| ↳ Re-run restores a missing FK on a pre-existing column | | ✅ |
| `server/polarimeterSaveFix.test.ts` `[SQL-static]` | text inspection | ✅ |

Not exercised locally: the PostgREST server itself, and the **deployed** Supabase project. The deployed project must be checked through `/api/health/schema` after the migration is applied (see `POLARIMETER-SAVE-FIX-REPORT.md`).

### How to re-run the real-PostgreSQL test
```bash
cd scripts/db-verify && npm install && npm test
```
