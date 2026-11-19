# Protocol Management — Architecture

This document describes how the Centralized Equipment Protocol Management module
(see `docs/PROTOCOL-MANAGEMENT-PROMPT.md`) is built into the existing
calibration application. The implementation status, with evidence for each
requirement, is in `docs/PROTOCOL-MANAGEMENT-REPORT.md`.

## 1. Principles

* **One universal module.** There is one Protocol Management page, one generic
  builder, one workflow, one execution engine and one PDF generator for every
  equipment category. No code is specific to an equipment model. The
  Bellingham + Stanley ADP220 protocol (POL-QC-032D) is *configuration data*
  (`shared/protocols/adp220.ts`) created through the same service API as any
  other protocol.
* **One immutable content document per revision.** All protocol content
  (identification, narrative, sections, tests, levels, fields, calculations,
  criteria, references, intervals, risk, technical gaps, equipment links)
  lives in a single zod-validated JSON document (`protocolContentSchema`,
  `shared/protocols/model.ts`). It is stored per revision with a SHA-256 hash
  of its canonical JSON. Approved content is never edited; a change requires a
  new revision.
* **The backend is the authority.** Authentication (tRPC `protectedProcedure`),
  duty checks, segregation of duties, state transitions, row-version
  concurrency and approval blockers are enforced in
  `server/protocols/service.ts`. Database triggers enforce immutability,
  allowed transitions and append-only history independently. The frontend
  only mirrors these rules for usability.
* **Shared logic, identical results.** Validation, workflow rules, the
  calculation engine, the evaluation of executions, revision comparison and
  template stripping live in `shared/protocols/*` and are used by both server
  and client. The client preview therefore matches what the server computes.
  The server always recalculates before storing.
* **Nothing invented.** Criteria without a verified source are labelled
  `PENDING TECHNICAL VERIFICATION`. They can never yield PASS (only UNDER
  REVIEW), and QA approval is blocked while any are pending. Certificate and
  reference-standard values are recorded at execution from the certificate;
  they are never stored as defaults.

## 2. Layers

```
client/src/components/protocols/          React UI (English, LTR, existing palette)
  ProtocolManagement.tsx                  shell, tabs, dashboard, registry, create, documents, notifications
  ProtocolDetail.tsx                      detail tabs, ReviewPanel (workflow + e-signature), compare, audit, PDF hook
  ProtocolBuilder.tsx                     generic builder (sections/tests/levels/fields/calcs/criteria/refs/intervals/gaps)
  ReferenceLibrary.tsx  ReviewCenter.tsx  ExecutionCenter.tsx  ModuleSettings.tsx
  protocolPdf.ts                          universal A4 PDF (jsPDF), watermarks, signatures, page numbers
        │ tRPC (protocols.*), types inferred from AppRouter
server/routers/protocols.ts               input validation (zod), error mapping
server/protocols/service.ts               business rules, RBAC/duties, workflow, audit, notifications
server/protocols/tables.ts                ProtocolStore interface + atomic change sets
  sqliteStore.ts / sqliteSchema.ts        local mode (node:sqlite) + guard triggers
  supabaseStore.ts                        Supabase mode: reads via PostgREST, all writes via RPC protocol_apply_changes
server/sql/protocol_management_migration.sql   additive, idempotent, transactional PG migration
shared/protocols/                         model, calc, evaluate, validation, workflow, compare, templates, adp220
```

### 2.1 Storage abstraction

`ProtocolStore` exposes `select` and `apply(changes[])`. A change set is a
list of inserts, updates (each with an `expect` guard, usually
`row_version`/`status`) and `insert-ignore` operations. It is applied
atomically:

* **SQLite:** in one `BEGIN IMMEDIATE` transaction.
* **Supabase:** in one call to the `SECURITY DEFINER` function
  `public.protocol_apply_changes(jsonb)`, which runs in a single PG
  transaction.

A failed guard rolls back the whole set and surfaces as a CONFLICT or
PRECONDITION_FAILED error. Every business mutation writes its audit row in the
same change set, so there is no state change without an audit record.

### 2.2 Data model (11 tables)

| Table | Purpose |
|---|---|
| `protocols` | Registry entry: number (unique), title, equipment association, current/released revision pointers, status, review flag |
| `protocol_revisions` | One row per revision. Holds the content JSON, content hash, status, actors and timestamps, reference snapshot, effective and next review dates, and a lock flag. Partial unique index: one open revision per protocol |
| `protocol_references` | Reference Library (typed; edition, revision, dates, URLs, verification status) |
| `protocol_approvals` | Append-only electronic-signature records: action, from/to status, meaning, attestation, comment |
| `protocol_review_comments` | Review comments (open/resolved) and immutable technical-gap decisions (`kind='gap-decision'`) |
| `protocol_audit_events` | Append-only ALCOA+ audit: user, duties, entity, action, previous/new value, reason, revision |
| `protocol_executions` | Executions with the protocol snapshot, reference snapshot, content hash, measurements, evaluation and engine version |
| `protocol_notifications`, `protocol_notification_reads` | Role- and duty-aware notifications with a dedupe key; per-user read state |
| `protocol_duty_assignments` | Explicit grants of the `qa-approver` and `releaser` duties (granted and revoked rows are kept) |
| `protocol_templates` | Structure-only templates (limits stripped) |

**Equipment.** The module does not create a second equipment catalogue.
`equipmentRegistry()` reads the existing built-in devices (`qc.ts`) merged with
`instrument_profiles` overrides. The existing tables `validation_records`,
`validation_settings`, `app_users` and `instrument_profiles` are not altered.

### 2.3 Workflow

```
draft ─submit→ technical-review-pending ─start→ technical-review-in-progress
   ↑                                         ├─request-technical-changes→ technical-changes-required ─submit→ …
   │                                         └─complete-technical-review→ technically-reviewed
   │                                                 ─submit-qa→ qa-review-pending ─start→ qa-review-in-progress
   │                                                          ├─request-qa-changes→ qa-changes-required ─submit→ …
   │                                                          ├─qa-reject→ rejected
   │                                                          └─qa-approve→ approved (locked, reference snapshot)
   │                                                                 ─release(effective date)→ released
   └── new revision (reason) from released/approved content        released ─retire(reason)→ retired
                                                                   released ─(new revision released)→ superseded
```

* **Rules** are in `TRANSITIONS` (`shared/protocols/workflow.ts`). They
  record the duty, whether a comment is required and the signature meaning,
  and they are mirrored by the `protocol_revisions` transition trigger.
* **Segregation of duties.** The author cannot review their own revision. The
  technical reviewer cannot QA-approve. Only the recorded reviewer can
  complete their stage.
* **Blockers for `complete-technical-review`:** every technical gap needs a
  reviewer decision.
* **Blockers for `qa-approve`** (`approvalBlockers`): attestation is
  required. There must be no content errors, no pending criteria or
  intervals, no undocumented or undecided gaps, and no gap decision of
  "additional evidence required" or "equipment not suitable". There must also
  be no open comments, no unverified or expired references, and no missing
  risk assessment.
* **Role mapping** (`DEFAULT_DUTIES`):
  * `admin` has all duties.
  * `user` has author, technical-reviewer and executor. The `qa-approver` and
    `releaser` duties can be granted explicitly.
  * `viewer` is read-only.

### 2.4 Calculation and evaluation

* `shared/protocols/calc.ts` provides:
  * The standard statistics: mean, min, max, range, SD (n−1), RSD,
    repeatability, bias/error, absolute error, % error, % difference, and
    max |reading − reference|.
  * Multi-level linearity: slope, intercept, r, r², and max |level mean −
    level reference|.
  * A recursive-descent formula parser for custom formulas. It does not use
    `eval` or `Function`.
* **Missing values** propagate as `null`; they are never treated as zero.
* **Division by zero** raises a `CalcError`.
* **Rounding:** decimals or significant figures are applied after the raw value
  is kept.
* `evaluateExecution` produces PASS / FAIL / INCOMPLETE / NOT APPLICABLE /
  UNDER REVIEW for each criterion, test and overall result. It records the
  formula, formula revision, `CALC_ENGINE_VERSION` and timestamp, and it always
  carries the disclaimer that a calculated PASS is not an approval.

### 2.5 PDF

* **Generation.** `protocolPdf.ts` builds the document on the client with jsPDF
  from the revision returned by the server.
* **References.** Approved revisions use the approval-time reference snapshot.
* **Layout.** A4 pages with a header and footer, "Page X of Y" numbering, the
  content hash, the document status block, and a signature table populated from
  the approval records.
* **Watermarks:**
  * Drafts and review states: `DRAFT – NOT APPROVED`.
  * Approved: `APPROVED – NOT YET RELEASED – NOT FOR USE`.
  * Released: no watermark; labelled "CONTROLLED DOCUMENT – RELEASED".
  * Superseded and retired: `NOT FOR USE`.
* **Logging.** Each generation is logged (`pdf.generated` audit event).

## 3. Deployment

1. In Supabase, open the SQL Editor and run
   `server/sql/protocol_management_migration.sql`. It is additive, idempotent
   and transactional, and it ends with `NOTIFY pgrst, 'reload schema'`.
2. Check `GET /api/health/schema`. The response should contain
   `"protocolManagement": {"ok": true}`. Until the migration is applied, the
   Protocol Management page shows the list of missing tables and the core
   application keeps working.
3. Local or desktop (SQLite) mode creates the tables automatically on start.

## 4. Verification

* **Unit and integration tests:** `server/protocolCalc.test.ts`,
  `server/protocolShared.test.ts`, `server/protocolService.test.ts` (real
  SQLite store and triggers) and `client/src/components/protocols/protocolPdf.test.ts`.
* **Real PostgreSQL:** `scripts/db-verify/verify-protocols.ts` runs the
  migration twice on an embedded PostgreSQL. It then drives the real
  `supabaseStore` change-set payloads through `protocol_apply_changes` and
  checks:
  * Grants and RLS.
  * The full workflow.
  * Atomic rollback.
  * POL-QC-032D idempotency.
  * Reference flagging and snapshot preservation.
  * That existing `validation_records` are unchanged.

  Run it with:
  `cd scripts/db-verify && npm install && cd ../.. && npx tsx scripts/db-verify/verify-protocols.ts`.
