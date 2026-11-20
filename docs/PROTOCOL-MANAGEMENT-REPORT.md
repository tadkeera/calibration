# Protocol Management — Final Development Report (§28)

* **Branch:** `arena/602b09f7-calibration`
* **Base:** `main` @ `c8447f1`
* **Report date:** 2026-11-18
* **Update v2:** branch `arena/3a5063a9-calibration` (base `main` @ `2b56f65`).
  It implements the items that were PARTIAL or not implemented. Section **E**
  describes the update; the C tables below are updated in place.

**Status legend:**

| Status | Meaning |
|---|---|
| **PASS** | Implemented and verified by an automated test or a real-database check (cited) |
| **PARTIAL** | Implemented with stated limits, or verified only by type-check and build |
| **FAIL** | Not met |
| **N/A** | Not applicable |

> **Honesty statement (§29).**
> * **Not exercised in a browser.** The React UI type-checks (`pnpm check`)
>   and builds (`pnpm build`, `pnpm build:vercel`), but nobody has clicked
>   through it in a browser yet. Backend rules are verified by tests.
> * **Not applied in production.** The PostgreSQL migration is verified on a
>   real, embedded PostgreSQL, not yet on the deployed Supabase project.
> * **No compliance claim.** The system claims no regulatory compliance
>   (USP, 21 CFR Part 11, EU GMP Annex 11, or other).

---

## A. Architecture summary

See `docs/PROTOCOL-MANAGEMENT-ARCHITECTURE.md`. In short:

* **One generic module.** It has a shared zod content model, a backend service
  that is the single authority, and an atomic change-set store (SQLite
  transaction, or the Supabase RPC `protocol_apply_changes`).
* **Database protection.** Triggers enforce immutability and append-only
  history.
* **Shared engines.** The calculation and evaluation engine is shared by client
  and server.
* **PDF.** A universal client-side PDF generator.
* **Seeded example.** The ADP220 protocol POL-QC-032D is seeded purely as
  configuration and stays in **DRAFT**.

## B. Files, migrations, APIs, components

### New files

| Area | Files |
|---|---|
| Shared domain | `shared/protocols/model.ts` (content schema and vocabularies, 21 standard sections), `calc.ts` (engine `CALC_ENGINE_VERSION`), `evaluate.ts`, `validation.ts`, `workflow.ts`, `compare.ts`, `templates.ts`, `adp220.ts` |
| Server | `server/protocols/service.ts`, `tables.ts`, `sqliteSchema.ts`, `sqliteStore.ts`, `supabaseStore.ts`, `server/routers/protocols.ts` |
| Migration | `server/sql/protocol_management_migration.sql` (11 tables, indexes, FKs, RLS, guard triggers, RPC, `NOTIFY pgrst`) |
| Client | `client/src/components/protocols/`: `ProtocolManagement.tsx`, `ProtocolDetail.tsx`, `ProtocolBuilder.tsx`, `ReferenceLibrary.tsx`, `ReviewCenter.tsx`, `ExecutionCenter.tsx`, `ModuleSettings.tsx`, `common.tsx`, `protocols.css`, `protocolPdf.ts` |
| Tests | `server/protocolCalc.test.ts`, `server/protocolShared.test.ts`, `server/protocolService.test.ts`, `client/src/components/protocols/protocolPdf.test.ts` |
| Verification | `scripts/db-verify/verify-protocols.ts` (embedded PostgreSQL) |
| Docs | `docs/PROTOCOL-MANAGEMENT-PROMPT.md`, `docs/PROTOCOL-MANAGEMENT-ARCHITECTURE.md`, this report |

### Modified files (additive only, 43 lines)

* `server/routers.ts`: registers `protocols`.
* `server/_core/app.ts`: adds the `protocolManagement` field to
  `/api/health/schema`.
* `server/localDb.ts`: exports `localConnection()` so the protocol SQLite
  store can share the existing connection. Protocol tables are created by
  `server/protocols/sqliteSchema.ts`.
* `server/supabaseDb.ts`: re-exports the existing PostgREST helpers for the
  Supabase protocol store.
* `client/src/pages/Home.tsx`: adds the "Protocol Management" navigation item
  and page.

### tRPC API (`protocols.*`, all authenticated)

| Kind | Procedures |
|---|---|
| Queries | `me`, `moduleStatus`, `dashboard`, `list`, `detail`, `revision`, `compare`, `audit`, `equipment`, `references`, `releasedForEquipment`, `executions`, `execution`, `notifications`, `duties`, `templates`, `schedule` (v2), `attachments` (v2) |
| Mutations | `create`, `saveDraft`, `createRevision`, `transition` (v2: `password`), `addComment`, `resolveComment`, `recordGapDecision`, `saveReference`, `execute` (v2: `activityKey`, `deviations`), `markNotificationRead`, `setDuty`, `saveTemplate`, `logPdf`, `configureAdp220`, `reviewExecution` (v2), `uploadAttachment` (v2), `downloadAttachment` (v2) |

### Test results (this branch)

| Suite | Result |
|---|---|
| `protocolCalc.test.ts` | 10/10 |
| `protocolShared.test.ts` | 13/13 |
| `protocolService.test.ts` (real SQLite store and triggers) | 13/13 (v2: signing steps now pass the real account password) |
| `protocolCompletion.test.ts` (v2, real SQLite store, real password check) | 7/7 |
| `protocolSqliteUpgrade.test.ts` (v2, PR #4 database upgraded in place) | 1/1 |
| `protocolPdf.test.ts` | 4/4 |
| Full `pnpm test` | v2: **124 passed**, 9 skipped, 0 failed (was 116 passed). The 9 skipped are the `[REAL Supabase]` suites (`supabase.integration`, `supabase.connection`, `localAuth`, `validationSettings`). They run only with real credentials via `pnpm test:integration`, which the sandbox cannot provide or reach |
| `verify-protocols.ts` on embedded PostgreSQL | v2: **ALL CHECKS PASSED, 73 checks** (was 52). New checks: the PR #4 migration is applied first and then upgraded in place; signatures; execution review; DB triggers; attachments; schedule |
| `pnpm check` | 0 errors |
| `pnpm build`, `pnpm build:vercel` | Success |

## C. Requirement status

Abbreviations used in the evidence column:

| Abbreviation | Meaning |
|---|---|
| SVC | `server/protocolService.test.ts` |
| SH | `server/protocolShared.test.ts` |
| CALC | `server/protocolCalc.test.ts` |
| PDF | `protocolPdf.test.ts` |
| PG | `scripts/db-verify/verify-protocols.ts` |
| UI | Type-checked and built only |
| DONE | `server/protocolCompletion.test.ts` (v2) |
| UPG | `server/protocolSqliteUpgrade.test.ts` (v2) |

### C.1 Final acceptance criteria (§27)

| # | Criterion | Status | Evidence / notes |
|---|---|---|---|
| 1 | Centralized Protocol Management page | PARTIAL | One nav item in `Home.tsx` with Dashboard, Registry, Create, Review, Executions, References, Documents and Settings (UI) |
| 2 | Supports all equipment categories | PASS | No model-specific code. SVC creates a generic protocol; the equipment registry covers all 8 instruments |
| 3 | Not Polarimeter-specific | PASS | ADP220 is data only (`adp220.ts`), created through `createProtocol` |
| 4 | Generic Protocol Builder works | PARTIAL | Service save/validate path: SVC "creates a draft, saves changes…". Builder UI not browser-tested |
| 5 | Equipment Library integration | PASS | `equipmentRegistry()` reads the existing devices and `instrument_profiles`. SVC: no duplicate PE99003 record |
| 6 | Registered Equipment integration | PASS | `releasedForEquipment` and compatibility checks. SVC: an incompatible instrument is rejected |
| 7 | Model-level protocols | PASS | `associationType: "model"` in SVC generic content |
| 8 | Equipment-specific protocols | PASS | DONE "supports equipment-specific protocols…": offered only for the linked unit, execution on other equipment rejected, schedule limited to the linked unit |
| 9 | Dynamic sections | PARTIAL | Schema plus Builder add/reorder/remove (UI). Structural validation in SH |
| 10 | Dynamic tests | PASS | SVC rev 2 adds a test; the compare entry shows "added" |
| 11 | Variable reading counts | PASS | CALC "incomplete readings…"; SVC uses 3- and 5-reading tests |
| 12 | Multi-level configurations | PASS | CALC "linearity regression across levels"; ADP220 linearity uses ≥3 levels |
| 13 | Calculation configuration | PASS | CALC: statistics, safe custom formulas, rounding and significant figures, division by zero |
| 14 | Acceptance criteria traceable | PASS | SH "requires a source or justification for every criterion…". Each criterion stores its source class, reference, clause and verification state |
| 15 | Reference Library works | PASS | SVC and PG: create, update and flag via `saveReference`. Library UI built (UI) |
| 16 | Reference snapshots preserved | PASS | SVC and PG "approval-time reference snapshot preserved" |
| 17 | Technical review works | PASS | SVC full workflow and return-for-correction test |
| 18 | QA approval works | PASS | SVC (attestation and comment required; blockers) |
| 19 | Controlled release works | PASS | SVC and PG (effective date required; next review date computed) |
| 20 | Approved revisions immutable | PASS | SVC service and SQLite trigger checks. PG triggers |
| 21 | Revision history works | PASS | SVC "requires a reason for a new revision…" (one open revision; supersede on release) |
| 22 | Revision comparison works | PASS | SH "structured diff"; SVC `compareRevisions` |
| 23 | Calibration integration | PARTIAL | Released protocols run through the module's own execution form. The **existing Polarimeter calibration form is not yet driven by module protocols**: it still uses `validation_settings`, which was intentionally left untouched (see D) |
| 24 | Validation integration | PASS (backend) / UI not browser-tested | DONE: link to a record of other equipment is rejected, a missing record gives NOT_FOUND, and the linked record's status is shown in the execution detail. The execution form has a record picker (`records.list` filtered by equipment) |
| 25 | Qualification integration | PARTIAL | IQ/OQ/PQ stages, a stage filter at execution, and stage stored per execution. No separate qualification-record module exists to link to |
| 26 | Historical execution traceability | PASS | SVC: the stored execution keeps the protocol snapshot, content hash and engine version. PG execution check |
| 27 | Universal PDF generation | PASS | PDF 4/4. A rendered 14-page A4 POL-QC-032D PDF was checked visually |
| 28 | Audit Trail integration | PASS | SVC audit with previous value and reason; `pdf.generated`. PG "audit trail populated". Module audit table (the existing `AdminActivityLog` is unchanged) |
| 29 | RBAC enforced | PASS | SVC: viewers cannot author; duty grants need settings-admin; non-releaser cannot retire; segregation of duties |
| 30 | Migrations safe | PASS | PG: run twice (idempotent), RLS on, anon has no grants, writes only through the RPC, atomic rollback |
| 31 | Existing functionality operational | PASS | Full suite 116 passed / 0 failed (9 real-Supabase tests skipped without credentials). PG "existing validation records unchanged". Changes to existing files are additive only |
| 32 | ADP220 configured with the generic builder | PASS | SVC and PG: POL-QC-032D is DRAFT, idempotent, on the existing QC-I-029 / PE99003 record |
| 33 | Unverified criteria flagged | PASS | CALC "never concludes compliance for pending criteria"; SVC approval blocked with `PENDING TECHNICAL VERIFICATION` |
| 34 | Technical gaps documented | PASS | SH "mandatory accuracy gap…" (±0.02° vs ±0.01°); a decision is required before technical completion (SVC) |
| 35 | No unsupported compliance claims | PASS | Gap claim restriction, the calculated-PASS disclaimer and document status labels. A release does not state compliance |

### C.2 Functional tests (§25.1)

| # | Test | Status | Evidence |
|---|---|---|---|
| 1–4 | Create, save, reopen and edit a draft | PASS | SVC "creates a draft…" (row-version conflict rejected) |
| 5–6 | Add and reorder sections | PARTIAL | Builder UI (UI). Content schema covered by SH |
| 7–11 | Tests, reading counts, multi-level, calculations, criteria | PASS | SVC and CALC |
| 12–13 | Add references and link them to tests | PASS | SVC generic content and ADP220 (SH "links every reference placeholder") |
| 14 | Save and retrieve the full protocol | PASS | SVC `getRevision` round trip |
| 15 | Submit for technical review | PASS | SVC |
| 16 | Return for correction | PASS | SVC "returns for correction…" |
| 17 | Resubmit | PASS | SVC "returns for correction…" |
| 18–21 | Complete technical review, submit to QA, approve, release | PASS | SVC and PG |
| 22 | Approved revision immutability | PASS | SVC and PG |
| 23–24 | New revision and comparison | PASS | SVC |
| 25 | Retire | PASS | SVC (releaser only; reason required) |
| 26 | Generate PDF | PASS | PDF |
| 27 | Select a released protocol for execution | PASS | SVC `releasedForEquipment` |
| 28 | Execution traceability | PASS | SVC |

### C.3 Integration (§25.2)

| Area | Status | Evidence / notes |
|---|---|---|
| Equipment Library | PASS | `equipmentRegistry` |
| Registered Equipment | PASS | Compatibility checks |
| Calibration | PARTIAL | See C.1 #23 |
| Validation | PARTIAL | See C.1 #24 |
| Qualification | PARTIAL | See C.1 #25 |
| PDF | PASS | PDF test suite |
| Audit | PASS | SVC and PG |
| Notifications | PASS | SVC: duty routing; the viewer is not notified; reference-change notification |
| Users | PASS | Duty mapping; `setDuty` |
| SQLite | PASS | SVC |
| Supabase | PARTIAL | Verified on embedded PostgreSQL through the real RPC payloads. **Not yet applied to the deployed project** (PostgREST layer not exercised) |

### C.4 Security (§25.3)

**PASS.** SVC covers each of these:

* Unauthorized users cannot approve or release.
* Drafts and approved-but-unreleased revisions cannot be executed.
* Approved revisions cannot be edited.
* Approval order cannot be bypassed.

Backend enforcement is independent of the UI. The `transition` rules run in the
service, and DB triggers back them up.

### C.5 Data integrity (§25.4)

**PASS.** The evidence is SVC, CALC and PG:

* Reference snapshots remain unchanged.
* Historical revisions remain accessible.
* Executions keep their revision and snapshot.
* Audit, approval and execution records are append-only (triggers).
* Calculations are reproducible: shared engine with the version stored.
* The migration preserves existing records.

### C.6 Other sections

| § | Requirement | Status | Notes |
|---|---|---|---|
| 4 | Dashboard (real DB counts, clickable) | PASS | SVC "dashboard counts from the database". Clickable tiles route to registry filters (UI) |
| 5 | Registry (search, filter, sort, pagination) | PASS | Implemented server-side in `listProtocols` (UI) |
| 9.3 | Missing values not zero; division by zero; formula version | PASS | CALC |
| 13 | Intervals with justification, approval and next due date | PASS | v2: per-equipment schedule for every interval of every released revision (`activitySchedule`, pure engine `shared/protocols/schedule.ts`). Overdue / due-soon (≤ 30 days) alerts are deduplicated. Only a PASS that was not rejected resets the baseline; event-based intervals have no date. DONE plus PG. Alerts are generated when the dashboard or notifications are loaded (there is no background scheduler on Vercel) |
| 14 | Electronic signature | PASS (re-authentication) | v2: every signing step (revision workflow and execution review) requires the account password, verified on the server (local scrypt or Supabase Auth). The approval or review row stores `reauthenticated = true`, and failed attempts are audited as `signature.failed` (no password stored). DONE, SVC, PG. **Still no Part 11 / Annex 11 compliance claim**: that needs a formal assessment (validation, procedures, account controls) |
| 16.3 | Attachments | PASS | v2: controlled files on executions and references. Whitelisted types, 3 MB limit, SHA-256 calculated on the server, integrity re-checked on download, append-only (DB triggers), no upload after the final QA decision. DONE plus PG |
| 16.3 | Deviations | PASS | v2: structured deviations (description, impact, immediate action, reference) stored with the execution and shown in review. DONE plus PG |
| 16.4–16.5 | Execution review and approval | PASS | v2: recorded → technical review → QA approval or rejection. Executor ≠ reviewer ≠ approver, INCOMPLETE cannot be approved, and there is no decision after a final one. Enforced in the service **and** by a DB trigger plus a UNIQUE constraint (SQLite and PostgreSQL). DONE plus PG |
| 17 | PDF: 22 items, A4, watermark, signatures | PASS | PDF tests and visual check |
| 18 | POL-QC-032D seed | PASS | SVC and SH. All criteria and intervals pending. Linearity R² is record-only with no invented limit. The zero test has no tolerance. Certificate values are recorded at execution |
| 21 | ALCOA+ audit | PASS | User, duties, entity, previous and new value, reason, revision, timestamp |
| 22 | Notifications (role-aware, deduplicated) | PASS | Dedupe key with insert-ignore. In-app only; no email |
| 23 | Templates are structure only | PASS | SH "templates contain structure only…" |
| 24 | Errors: duplicate submit, invalid transition, drafts preserved | PASS | Stale row version is rejected (SVC). The Builder keeps a local backup and a beforeunload guard (UI) |
| 3.2 | English UI in the existing design system, responsive | PARTIAL | Uses the existing palette and the `pm-*` responsive grid. Not visually reviewed in a browser |

## D. Outstanding issues and recommended next steps

1. **Apply the migration in production.** Run
   `server/sql/protocol_management_migration.sql` in the Supabase SQL Editor,
   then confirm `/api/health/schema` reports `protocolManagement.ok: true`.
   Until then the page shows "schema missing", and the rest of the app is
   unaffected.
2. **Browser walkthrough.** Exercise Create → Builder → submit → review → QA →
   release → execute → PDF with real accounts. That needs three distinct users
   (author, technical specialist, QA with the qa-approver and releaser duties)
   because segregation of duties is enforced.
3. **Single source of truth for the Polarimeter calibration form.** The
   existing Polarimeter calibration screen still evaluates against
   `validation_settings`. It was deliberately not modified, per the
   instructions not to alter existing modules or historical data.
   Switching that form to execute the *released* POL-QC-032D revision needs:
   * POL-QC-032D to go through technical verification, QA approval and
     release first (all criteria are pending today).
   * A migration plan for the existing records.
4. **POL-QC-032D technical verification.** Verify every criterion and interval
   against controlled copies of USP <781>, USP <1058> and the ADP220 manual
   36-102. Record certificate data in the Reference Library from the actual
   certificates. Obtain a technical decision on the ±0.02° vs ±0.01° gap.
5. **Electronic signatures.** Consider password re-entry at signing before any
   21 CFR Part 11 / Annex 11 assessment. *v2: done (re-authentication). The
   formal assessment is still open.*
6. **Attachments.** Add controlled file storage for attachments and
   certificates. Today only references are recorded. *v2: done (DB storage,
   3 MB per file).*
7. **Interval alerts.** Add due alerts per equipment for calibration, PQ and
   linearity intervals. Today only periodic protocol review is alerted.
   *v2: done.*
8. **Validation record linkage UI.** Expose `validationRecordId` in the
   execution form. *v2: done.*
9. **Bundle size.** The main JS chunk is about 1.8 MB, and Vite warns about
   it. Consider lazy-loading the Protocol Management page.
   *v2: done. See E.*
10. **Carried over from earlier work:**
    * `startLogin()` still redirects to Manus OAuth.
    * Secrets previously committed (`env.`, and the `.env` in commit b98bb05)
      should be rotated if this has not been done yet.

## E. Update v2 — remaining items implemented

### What was added

| Area | Backend | Database | UI |
|---|---|---|---|
| E-signature re-authentication (§14) | `requireSignature` in `service.ts`. Password checked through `localLogin(..., recordActivity:false)`; a failure is audited as `signature.failed` | `protocol_approvals.reauthenticated` | `SignatureBox` (password field) replaces the old `window.confirm` in the review panel |
| Execution review and approval (§16.4–16.5) | `reviewExecution`; `shared/protocols/executionReview.ts` (pure rules) | `protocol_execution_reviews` (append-only, `UNIQUE(execution_id, from_status)`, sequence/SoD trigger in PG and SQLite) | Review panel in the execution detail; review status column and filter |
| Deviations (§16.3) | `execute({ deviations })` | `protocol_executions.deviations` (json) | Deviations editor in the execution form |
| Interval activity and schedule (§13.2, §22) | `execute({ activityKey })`, `activitySchedule`, `refreshDueNotifications`; `shared/protocols/schedule.ts` | `protocol_executions.activity_key/activity_name` plus an index | Schedule panel (dashboard and per equipment); new dashboard tiles |
| Attachments (§16.3) | `uploadAttachment`, `listAttachments`, `downloadAttachment`; `shared/protocols/attachments.ts` | `protocol_attachments` (append-only, size ≤ 3 MB, SHA-256 format check) | Evidence panel on executions; "Files" for references |
| Validation-record link (C.1 #24) | Equipment match checked; linked record status returned | — | Record picker in the execution form |
| Bundle (D.9) | — | — | `React.lazy` plus `Suspense` for Protocol Management. Main chunk 1.52 MB; module chunk 350 KB loaded on demand |

### Upgrade of existing installations

* **Supabase / PostgreSQL:** re-run the **whole**
  `server/sql/protocol_management_migration.sql`. The file is idempotent: it
  adds columns with `ADD COLUMN IF NOT EXISTS` and creates the two new tables.
  PG proves this by applying the PR #4 file first and then upgrading in
  place. `/api/health/schema` expects 13 protocol tables (plus the new
  columns) and reports `protocolManagement.ok:false` until the file is
  re-run.
* **SQLite (desktop):** upgraded automatically on first access (`PRAGMA
  table_info` plus `ALTER TABLE ADD COLUMN`). UPG proves this on a database
  created with the PR #4 DDL: existing rows are kept unchanged, and historical
  approvals are *not* relabelled as re-authenticated.

### Still open (not code, or not possible here)

* **Production migration:** apply the updated SQL in Supabase (operator).
* **Browser walkthrough:** the sandbox has no headless browser, so all new UI
  pieces are type-checked and built only. Backend rules are covered by tests.
* **Qualification (C.1 #25):** there is still no separate qualification-record
  module. IQ/OQ/PQ are protocol stages, stored per execution.
* **Polarimeter form (C.1 #23, D.3):** still driven by `validation_settings`,
  deliberately unchanged until POL-QC-032D is verified and released.
* **Attachment storage:** files are stored in the database (base64), limited
  to 3 MB because of the Vercel request body limit. Larger evidence needs
  object storage (for example Supabase Storage); this is a design decision for
  the operator.
* **Due alerts** are created when users open the dashboard or notifications.
  There is no e-mail and no background job (Vercel serverless).
* **Carried over:** the Manus OAuth redirect and rotation of previously
  committed secrets.
