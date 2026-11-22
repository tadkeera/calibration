# Implementation plan — Protocol page, simplified approval, protocol-driven New Validation

Source: *Master PROMPT* (2026-11) + user decisions recorded on 2026-11-18:

| Question | Decision |
|---|---|
| Protocol data reset | Back up, then delete **all** protocol data and start **empty** (protocols are entered manually; the 8 docs protocols are not re-imported). Users, roles/duties and the equipment master are never touched. |
| Approval workflow | **Draft → Approved** by a **Quality Manager** in one signed step; the approved revision becomes active immediately and the previous active revision becomes **Superseded**. Full history and audit trail kept. Enforced on the backend. |
| Legacy New Validation forms | **Protocol-only.** The hard-coded forms (`CalibrationForm`, `PolarimeterValidationForm`) are removed from New Validation. Equipment without an approved protocol shows *“No Approved Protocol Available for This Equipment”*. Old records remain viewable/printable in Record History. |
| Old page | Replace only the **Protocol Management** page with the new **Protocol** page; **keep “الإعدادات والحدود”**. |

## 1. Inspection findings (what exists and is reused)

* **Protocol engine (kept, reused):** `shared/protocols/model.ts` (protocol content schema: sections → tests → fields / levels / calculations / criteria / references), `calc.ts` (calculation engine — mean, SD, RSD, error, % deviation, regression …), `evaluate.ts` (per-test + overall PASS/FAIL/INCOMPLETE/UNDER REVIEW), `validation.ts` (structure checks).
* **Backend:** `server/protocols/service.ts` (protocol CRUD, revisions, workflow, executions, duties, audit), `workflowService.ts` (equipment master + specs, calibration runs with protocol/equipment snapshots), SQLite + Supabase stores with DB triggers that make approved revisions and recorded runs immutable.
* **Old UI:** `ProtocolManagement` (registry, multi-stage review/QA/release), `RunWorkflow` (fixed nine-step run), `CalibrationPage` with hard-coded `CalibrationForm` / `PolarimeterValidationForm` driven by `client/src/lib/qc.ts` limits.
* **Gaps vs. the spec:** multi-stage approval (draft → technical review → QA → approved → released); New Validation independent of protocols (hard-coded tests/limits); no Quality Manager role; any “user” may author; no graphs derived from protocol tests; validation PDF mixes everything in one flow.

## 2. Changes

### 2.1 Roles (backend-enforced)
* New duty **`quality-manager`** (grantable by an administrator; administrators hold it). A Quality Manager also holds the editor permissions.
* **`author`** is relabelled **Authorized Protocol Editor** and becomes a *granted* duty (no longer automatic for every “user”).
* Normal users keep `executor` (view approved protocols, enter readings, calculate, save validations, PDFs) and `technical-reviewer` (existing execution review).
* References and protocol content edits require the editor duty (or Quality Manager).

### 2.2 Simplified approval
* New workflow action **`approve`**: `draft → released` (“Approved – Active”), duty `quality-manager`, password re-entry (electronic signature), stores approver, approval date/time, protocol, revision number and status in `protocol_approvals` + audit trail, freezes the reference snapshot, locks the revision.
* The previous active revision of that protocol → `superseded` in the same transaction.
* Only one active protocol per equipment: approval is rejected if another protocol is already active for the same equipment.
* Approval blockers (simple, honest): content errors, criteria not marked *verified*, references not verified / expired. Values “Needs Source Verification” can never be approved silently.
* DB guards updated on both backends (`draft>released` transition allowed); legacy multi-stage transitions stay valid for historical records but are no longer offered in the UI.
* **Edit** on an approved revision always creates a new Draft copied from the active approved revision (existing `createRevision`); approved and superseded revisions stay read-only (DB triggers).

### 2.3 Protocol page (replaces “Protocol Management”)
* Nine equipment cards (3 / 2 / 1 responsive grid) in the required order, linked to the **existing** equipment master records by instrument key (no duplicates, existing codes kept). The Analytical Balance card links to the registered `balance` record (QC-I-074) — or offers to register it from the supplied package data if it is missing.
* Protocol Details page: equipment info, active revision, revision dropdown (Rev.NN – Approved/Superseded/Draft), contents of the selected revision (tests, fields, calculations/formulas, acceptance limits, references), revision metadata (created/modified/approved by and when, notes), **Edit** and **Approve** buttons. Editing reuses the existing protocol builder (tests, criteria, formulas, references).
* Create protocol for an equipment (empty start) — editor only.

### 2.4 Reset of experimental protocol data
* `server/sql/protocol_v4_simplified_approval_reset.sql` (Supabase): backs up every protocol table into schema `protocol_backup_20261118`, installs the new revision guard, then deletes protocols, revisions, approvals, comments, executions, reviews, runs, run snapshots, protocol notifications/attachments, references and templates. Triggers are disabled only inside the transaction and re-enabled. Users, duty assignments, equipment specs/changes, instrument profiles, validation records and the audit trail are untouched.
* Local/SQLite: `npm run protocols:reset` (`scripts/reset-protocol-data.ts`) — copies the database file first, then performs the same deletion with the guard triggers temporarily dropped and recreated.

### 2.5 New Validation (protocol-only)
* Select equipment → the backend returns the active approved revision for it → the form is generated from the revision’s tests (fields, readings, levels, references, units).
* **Calibration** button: runs the shared calculation/evaluation engine and shows per-test calculations (mean, SD, RSD %, error, deviation, regression), acceptance criteria with limits, per-test and overall PASS/FAIL, and the graphs configured for each test, drawn **only from entered data**.
* **Save**: the backend recomputes everything and stores an immutable record (run + execution) containing the equipment snapshot, protocol ID, revision, content hash, tests/criteria/formulas (protocol snapshot), reference snapshot, readings, calculated results, decisions and graph data.
* History of protocol validations (per equipment) — view and print.

### 2.6 PDF
* Section A: identification, equipment snapshot, protocol/revision, per-test numerical tables (readings, calculations, criteria, decisions), overall result, signatures (system records only).
* Page break → Section B: each graph on its own page, title, axis labels, legend, regression equation; pages created only for graphs that exist; “Page x of y” on every page.

### 2.7 Tests
Extend/adapt the vitest suites (roles, approval, immutability, reset, dynamic validation, graphs, PDF structure) and the PostgreSQL verification script; run `tsc`, the full suite, `pnpm build`.

## 3. Execution status (2026-11-18)

| Area | Status | Evidence |
|---|---|---|
| Roles (Normal User / Authorized Protocol Editor / Quality Manager) | Done — backend | `shared/protocols/workflow.ts`, `service.ts`; `server/protocolV4.test.ts`, PG verify |
| Simplified approval Draft → Approved (active) → Superseded | Done | `transition("approve")`, guard `draft>released` (SQLite + PG) |
| Protocol page (9 cards 3/2/1, details, revision dropdown + metadata, edit = new draft, QM approval with password) | Done | `client/src/components/protocols/ProtocolPage.tsx` |
| Graph definitions per test in the builder | Done | `ProtocolBuilder.tsx` (Graphs sub-list) |
| Old Protocol Management / Protocol Setup UI | Removed | `ProtocolManagement.tsx`, `ReviewCenter.tsx`, `RunWorkflow.tsx` deleted; «الإعدادات والحدود» kept |
| Hard-coded New Validation forms | Removed | `CalibrationForm.tsx`, `PolarimeterValidationForm.tsx` deleted; legacy records stay viewable/printable in «السجلات والتدقيق» |
| Protocol-driven New Validation (dynamic inputs, Calibration button, PASS/FAIL, graphs, save, history, PDF) | Done | `ProtocolValidation.tsx`, `validationService.ts` |
| PDF: Section A tables → page break → Section B one graph per page, page x of y | Done | `validationPdf.ts`; `server/validationPdf.test.ts` |
| Reset (backup first; users, duties, equipment, legacy records kept) | Done — SQL + local script | `server/sql/protocol_v4_simplified_approval_reset.sql`, `pnpm protocols:reset:local -- --confirm`; verified on real PostgreSQL |
| Supabase production reset | **Pending — must be run by the owner in the Supabase SQL Editor** | (no network access to Supabase from the sandbox) |

Results: `tsc` 0 errors · vitest 35 files passed / 4 skipped, 174 tests passed / 9 skipped, 0 failed (+ the item-29 assertion added afterwards) · `pnpm build` OK · PostgreSQL verification 118/118 PASS.
