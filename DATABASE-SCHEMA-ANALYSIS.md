# Database Schema Analysis

**Updated:** 2026-11-18 (branch `arena/602b09f7-calibration`, PR #4)
**Scope:**
1. Validation-record and Polarimeter-workflow schema, including `retest_of_record_id` and server drafts.
2. The new Protocol Management schema.

Both are covered for the two storage engines: Supabase/PostgreSQL and SQLite.

## 0. Where the SQL files are

| File | Purpose | Apply to Supabase |
|---|---|---|
| `server/sql/supabase_schema.sql` | Base schema: users, sessions, `validation_records`, settings, audit | Initial setup only (already applied in production) |
| `server/sql/polarimeter_workflow_migration.sql` | Additive Polarimeter workflow: `record_version`, `retest_of_record_id`, drafts, reviews, deviations, guard triggers, RPCs | **Already applied in production** (see §4) |
| **`server/sql/protocol_management_migration.sql`** | **Protocol Management module: 11 tables, guard triggers, RLS, `protocol_apply_changes` RPC** | **Not yet applied.** Run it in the Supabase SQL Editor before or when PR #4 is deployed |

Both migrations are:
- **Additive and idempotent:** `IF NOT EXISTS`, with no `DROP TABLE`, `DROP COLUMN`, `DELETE` or `TRUNCATE`.
- **Transactional:** wrapped in `BEGIN … COMMIT`.
- **Followed by a schema-cache reload:** `NOTIFY pgrst, 'reload schema'`.

SQLite needs no manual step. `server/localDb.ts` and `server/protocols/sqliteSchema.ts` create or upgrade the same structures at startup.

## 1. Validation records and Polarimeter workflow

### 1.1 Why the application sends `retest_of_record_id`

| Layer | Location | Behaviour |
|---|---|---|
| Client | `client/src/pages/Home.tsx` → `trpc.records.save` | Sends `retestOfRecordId` / `retestReason` only when a retest context exists |
| Supabase adapter | `server/supabaseDb.ts` `createValidationRecord()` | **Always** includes `retest_of_record_id: input.retestOfRecordId ?? null` and `retest_reason`. Ordinary records store `NULL` |
| Supabase adapter | `updateValidationRecord()` | `PATCH` guarded by `record_version=eq.N`, `lifecycle_status=eq.draft` and the owner |
| SQLite adapter | `server/localDb.ts` | Same fields, stored as `INTEGER`; same guards in SQL |

The field is part of the architecture: a controlled retest links to the failed original, and the failed record stays immutable. It must not be removed or stripped from payloads.

### 1.2 Key and relationship types

| Item | Supabase / PostgreSQL | SQLite |
|---|---|---|
| `validation_records.id` | `bigint` identity | `INTEGER PRIMARY KEY AUTOINCREMENT` (64-bit) |
| `retest_of_record_id` | `bigint NULL` FK → `validation_records(id) ON DELETE RESTRICT` | `INTEGER NULL REFERENCES validation_records(id)` |
| Parent index | `validation_records_retest_parent_idx` (partial, `IS NOT NULL`) | Same name and definition |
| `record_version` | `integer NOT NULL DEFAULT 1`, used for optimistic locking | Same |
| Retest rules | Trigger `validate_polarimeter_retest_link` | Equivalent triggers |
| Failed-record immutability | `polarimeter_failure_record_immutable` / `_no_delete` | Equivalent triggers |

### 1.3 Server drafts (`polarimeter_drafts`)

| Item | Supabase / PostgreSQL | SQLite |
|---|---|---|
| Identity | `unique (user_id, draft_key)`, so one draft per user and key | Same unique constraint |
| Concurrency | `version` column. Create = `POST` (expected version 0). Update = `PATCH … ?version=eq.N` | `UPDATE … WHERE version = ?` |
| Stale update | 0 rows changed → `Server draft conflict`, nothing overwritten | Same |
| Payload | `jsonb`. Measurements (including empty readings) and the protocol snapshot are stored unchanged | `TEXT` JSON, stored unchanged |

### 1.4 Root cause of the production 400 error (resolved)

`Could not find the 'retest_of_record_id' column of 'validation_records' in the schema cache` (`PGRST204`):
- **Cause:** the application code was deployed, but `polarimeter_workflow_migration.sql` had not been applied to production Supabase.
- **Fix:** the migration was hardened with a transaction, a bigint type pre-check, FK repair and a PostgREST schema reload, and the operator then applied it.

## 2. Protocol Management schema (`protocol_management_migration.sql`)

| Table | Key relationships |
|---|---|
| `protocols` | `protocol_number` UNIQUE, `created_by_user_id` → `app_users` |
| `protocol_revisions` | → `protocols` (RESTRICT), `based_on_revision_id` → self, author / reviewer / QA / releaser → `app_users`, UNIQUE (`protocol_id`, `revision_number`) |
| `protocol_references` | `code` UNIQUE, verified-by / created-by → `app_users` |
| `protocol_approvals` | → `protocols`, `protocol_revisions` (RESTRICT), actor → `app_users`. Append-only |
| `protocol_review_comments` | → `protocols`, `protocol_revisions`, author / resolver → `app_users` |
| `protocol_audit_events` | actor → `app_users`. Append-only (no UPDATE or DELETE) |
| `protocol_executions` | → `protocols`, `protocol_revisions`, optional `validation_record_id` → `validation_records` (RESTRICT). Append-only |
| `protocol_notifications` / `_reads` | `dedupe_key` UNIQUE, with one read per user and notification |
| `protocol_duty_assignments` | One active duty per user, enforced by a partial unique index |
| `protocol_templates` | Structure only, no acceptance limits |

**Parity:** both engines declare the same **31 foreign keys** and **13 indexes**. This was checked by comparing the column → target lists in the two schema files: no differences.

**Integrity guards enforced by the database itself:**
- **One open revision and one released revision per protocol.** Partial unique indexes `protocol_revisions_one_open_idx` and `protocol_revisions_one_released_idx`.
- **Approved content is immutable.** Trigger `protocol_revisions_guard`: content may change only while the revision is `draft` or `changes-required`, and status transitions are whitelisted (for example, `released → draft` is refused).
- **No deletions.** Approvals, audit events and executions are append-only. Protocols, references, templates and duties cannot be deleted.
- **Supabase only:** RLS is enabled on all 11 tables, and `anon` / `authenticated` have no privileges. The service role writes only through the SECURITY DEFINER RPC `protocol_apply_changes(jsonb)`. That RPC is whitelisted to protocol tables, applies a change set atomically, and raises `PROTOCOL_CONFLICT` on a row-version mismatch.
- **SQLite:** the same rules run inside one transaction in the store layer. `PRAGMA foreign_keys = ON` and the same unique indexes apply.

## 3. Draft update → retrieve → reopen (requested verification)

| Engine | Polarimeter server draft | Polarimeter draft record (`validation_records`) | Protocol draft revision |
|---|---|---|---|
| **SQLite (real)** | `polarimeterSaveFix.test.ts`: create → version-guarded update → stale update refused → reopen; payload equal | Same file: update the existing draft record → list → reopen; measurements and snapshot equal, `retest_of_record_id` NULL | `protocolService.test.ts`: two successive saves of an existing draft → reopen; content intact; earlier execution keeps rev-1 measurements, snapshot and hash |
| **PostgreSQL (real, embedded PG 18)** | `verify-migration.mjs`: insert → guarded update (v2) → stale update changes 0 rows → duplicate refused → reopen `jsonb` deep-equal | Same script: record updated to version 3 → reopen; measurements and snapshot deep-equal, retest NULL | `verify-protocols.ts`: via the real Supabase store code path (RPC) → stale save refused → reopen; execution keeps rev-1 measurements, snapshot and hash |
| **Supabase (mocked PostgREST)** | `supabasePolarimeterDraftUpdate.test.ts`: stateful fake honouring `version=eq.N` | Same file: `record_version`, `lifecycle_status` and owner filters | Not applicable (PG test above covers the RPC) |
| **Supabase (real project)** | `supabase.integration.test.ts`, opt-in write test | — | Schema probe |

**Not run here:** the real Supabase tests. The sandbox has no credentials and cannot reach `*.supabase.co`.

## 4. Deployed-schema evidence

`GET https://calibration-silk.vercel.app/api/health/schema` was checked on 2026-11-19 at 02:44 UTC. It returned:
- `ok: true` and `storage: supabase`;
- all 7 workflow tables `ok`;
- `polarimeterSettingsProvisioned: true`;
- `projectRefHint: zdctpd`.

This confirms that the **Polarimeter workflow migration is applied** in production.

The `protocolManagement` health block appears only once PR #4 is deployed. Until `protocol_management_migration.sql` is run, it reports `ok: false` and names this file.
