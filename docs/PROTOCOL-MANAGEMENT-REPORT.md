# Protocol Management — Final Development Report (§28)

* **Branch:** `arena/602b09f7-calibration`
* **Base:** `main` @ `c8447f1`
* **Report date:** 2026-11-18

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
| Queries | `me`, `moduleStatus`, `dashboard`, `list`, `detail`, `revision`, `compare`, `audit`, `equipment`, `references`, `releasedForEquipment`, `executions`, `execution`, `notifications`, `duties`, `templates` |
| Mutations | `create`, `saveDraft`, `createRevision`, `transition`, `addComment`, `resolveComment`, `recordGapDecision`, `saveReference`, `execute`, `markNotificationRead`, `setDuty`, `saveTemplate`, `logPdf`, `configureAdp220` |

### Test results (this branch)

| Suite | Result |
|---|---|
| `protocolCalc.test.ts` | 10/10 |
| `protocolShared.test.ts` | 12/12 |
| `protocolService.test.ts` (real SQLite store and triggers) | 13/13 |
| `protocolPdf.test.ts` | 4/4 |
| Full `pnpm test` | 112 passed, 5 failed. The 5 failures existed before this work: they need a reachable live Supabase project, which the sandbox cannot reach (`localAuth`, `supabase.connection`, `validationSettings`) |
| `verify-protocols.ts` on embedded PostgreSQL | **ALL CHECKS PASSED** (22 checks) |
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
| 8 | Equipment-specific protocols | PARTIAL | Enforced in `releasedForEquipment` and validation (an equipment-specific protocol needs a link). No dedicated test |
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
| 24 | Validation integration | PARTIAL | `execute` accepts `validationRecordId` and checks that it belongs to the same equipment. No UI field yet; not covered by a test |
| 25 | Qualification integration | PARTIAL | IQ/OQ/PQ stages, a stage filter at execution, and stage stored per execution. No separate qualification-record module exists to link to |
| 26 | Historical execution traceability | PASS | SVC: the stored execution keeps the protocol snapshot, content hash and engine version. PG execution check |
| 27 | Universal PDF generation | PASS | PDF 4/4. A rendered 14-page A4 POL-QC-032D PDF was checked visually |
| 28 | Audit Trail integration | PASS | SVC audit with previous value and reason; `pdf.generated`. PG "audit trail populated". Module audit table (the existing `AdminActivityLog` is unchanged) |
| 29 | RBAC enforced | PASS | SVC: viewers cannot author; duty grants need settings-admin; non-releaser cannot retire; segregation of duties |
| 30 | Migrations safe | PASS | PG: run twice (idempotent), RLS on, anon has no grants, writes only through the RPC, atomic rollback |
| 31 | Existing functionality operational | PASS | Same 112/117 suite result as before; the 5 failures need live Supabase. PG "existing validation records unchanged". Changes to existing files are additive only |
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
| 13 | Intervals with justification, approval and next due date | PARTIAL | Intervals are part of approved content and pending ones block approval. The Periodic Review interval drives `nextReviewDate` and due-for-review alerts. **Other intervals (for example external calibration due) do not yet raise per-equipment due alerts** |
| 14 | Electronic signature | PARTIAL | Authenticated user, attestation checkbox, signature meaning and timestamp stored in append-only approval records. **No re-authentication at signing**, so no Part 11 compliance claim |
| 16.3 | Attachments | PARTIAL | Attachment and certificate fields record a document or certificate reference (text). **File upload is not implemented** |
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
   21 CFR Part 11 / Annex 11 assessment.
6. **Attachments.** Add controlled file storage for attachments and
   certificates. Today only references are recorded.
7. **Interval alerts.** Add due alerts per equipment for calibration, PQ and
   linearity intervals. Today only periodic protocol review is alerted.
8. **Validation record linkage UI.** Expose `validationRecordId` in the
   execution form.
9. **Bundle size.** The main JS chunk is about 1.8 MB, and Vite warns about
   it. Consider lazy-loading the Protocol Management page.
10. **Carried over from earlier work:**
    * `startLogin()` still redirects to Manus OAuth.
    * Secrets previously committed (`env.`, and the `.env` in commit b98bb05)
      should be rotated if this has not been done yet.
