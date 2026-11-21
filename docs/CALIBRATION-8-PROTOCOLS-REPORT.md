# Eight calibration protocols, unified run workflow and equipment data: delivery report

Branch `arena/2b194ce3-calibration`, based on `main` @ `b8761d2`.
The baseline is the package the user uploaded to `docs/`: the protocol ZIP, `Calibrationtest.zip` and `HPLC.pdf`.
`HPLC.pdf` controls the HPLC values. No value, criterion, date, result or signature was invented.

## 1. What was delivered

| Requirement | Delivered |
|---|---|
| 1. Inspect the system against the requirements | `docs/EIGHT-PROTOCOLS-INVENTORY.md`: register, criteria with their sources, step counts and 10 documented conflicts (H1–H4, P1, B1, B2, M1, U1, X1). |
| 2. Read and import the 8 protocols | `shared/protocols/package8.ts` holds the 8 protocols as structured content. The **Import 8 protocols** button (Protocol Management → Create Protocol) creates them as DRAFT revisions through `importCalibrationPackage`. The import is idempotent and leaves every criterion PENDING TECHNICAL VERIFICATION. |
| 3. One workflow, but each device keeps its own tests | **Calibration Runs** tab. The steps come from the protocol snapshot: Equipment → Protocol → one step per protocol test → Results → Review → Approval → PDF. This gives HPLC 16, BAL 15, UV 14, DIS 13, DISINT 13, POL 12, REF 12 and MOA 12 steps. The count is not fixed at nine. |
| 4. Page «تعديل بيانات ومواصفات الأجهزة» | A new item in the main navigation (`EquipmentDataPage.tsx`) with the exact title. It covers identity, typed and unit-aware specification groups per equipment type, change history, linked protocols, runs, registering new equipment and retiring equipment. Equipment is never deleted. |
| 5. Link equipment to protocols automatically | Import links 7 protocols to their registered equipment. The balance QC-I-074 is registered if missing. HPLC is **not** linked, because LC-2030 PLUS ≠ QC-I-104 (conflict H2). Equipment edits update linked unapproved drafts automatically, with an audit entry. Approved protocols are flagged for a new revision. |
| 6. Keep history and prevent conflicts | Equipment edits use optimistic versioning, a mandatory reason for critical fields and a field-level change log that cannot be altered (enforced by DB triggers). Every run save is a new version kept in `protocol_run_snapshots`. If two users save the same run, the second save fails with `DRAFT_CONFLICT`. The user then sees a per-test compare/merge screen, both versions are kept, and the merge is saved with its reason. Open runs keep their equipment snapshot and show a "newer equipment data" notice. |
| 7. Test the 8 protocols and produce PDF reports | `server/runPdf8.test.ts` takes all 8 protocols end to end: import → run → save → PDF. It writes the PDFs to `docs/test-evidence/run-pdfs/` (section 4). |
| 8. Working version with test results | Type check, build, the full unit and integration suite, and real PostgreSQL verification all pass (section 3). |

## 2. Data-integrity rules enforced

- **No automatic PASS.** Loading or executing a protocol never implies PASS. Pending criteria give *Indicative PASS/FAIL* in a message only, and the test status stays UNDER REVIEW. Pending criteria block approval but not saving.
- **Draft protocols cannot be formally recorded.** A run on a non-released revision is a *trial run*. Recording is blocked, and both the UI and the PDF say so.
- **Balance is now Rev.03 (DRAFT, not approved).** `CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf` replaces Rev.01; see the update section at the end. USP <41> repeatability needs at least 10 readings; 6 or 9 readings give INCOMPLETE. The 6-reading historical record is not imported.
- **Moisture analyzer.** All criteria trace to USP <731> or <1058>. USP <921> is never substituted.
- **NOT SPECIFIED.** "NOT SPECIFIED IN SUPPLIED USP SOURCE" stays as a record-only criterion.
- **Specifications never change acceptance criteria.** Units are never converted automatically.
- **Signatures.** Only names recorded by the system's review and approval workflow appear. Approval requires password re-authentication and segregation of duties (existing v2 workflow). No signature is simulated.
- **PDF reports** are generated from the run snapshot. Each has a unique document ID (`run number-V<version>-<fingerprint>`), "Page x of y" numbering, and a watermark until the execution is approved. Each generation is audit-logged as `run.pdf-generated`.
- **Rounding.** Intermediate calculations are no longer rounded; only reported results are. For example, HPLC flow 10/6.6 gives +1.0101 %, which is indicatively outside ±1.0 %. Rounding the flow first would have hidden that.

## 3. Test evidence (2026-11-20, this branch)

| Check | Result |
|---|---|
| `pnpm check` (tsc) | 0 errors |
| `pnpm build` | OK. `EquipmentDataPage` is a separate lazy chunk (39 kB) |
| Full vitest suite | **32 files passed, 4 skipped; 148 tests passed, 9 skipped** (PR #5 baseline: 124 passed) |
| `server/package8.test.ts` | 14/14: definitions, the HPLC.pdf formula fixtures, balance s_eff/Mmin, UV ±1/±2 nm, N/A justification, blockers, merge helpers |
| `server/protocolWorkflow.test.ts` | 9/9: import and idempotency, equipment audit and propagation, runs, snapshots, conflicts, history |
| `server/runPdf8.test.ts` | 1/1: 8 runs, 8 PDFs, 8 audit entries |
| Real PostgreSQL (`scripts/db-verify/verify-protocols.ts`) | **96/96 PASS** (was 73). See below. |

What the 23 new PostgreSQL checks cover:

- in-place upgrade v1 → v3, run twice, giving 17 tables;
- package import and idempotency;
- a critical-field reason is required;
- a stale equipment edit is rejected;
- the equipment change log is append-only;
- run versioning and `DRAFT_CONFLICT`;
- earlier versions are preserved;
- recording is blocked for drafts;
- runs cannot be deleted and run snapshots are append-only;
- an open run keeps its snapshot after an equipment edit and flags the newer data;
- the v3 rollback keeps the 13 core tables and their data, after which the migration re-applies.

Commands:

```
export VITE_APP_ID=test-app SUPABASE_URL=https://dummyproj.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy-key JWT_SECRET=test-secret-0123456789
NODE_OPTIONS=--experimental-sqlite npx vitest run
cd scripts/db-verify && npm install && cd ../.. && NODE_OPTIONS=--experimental-sqlite npx tsx scripts/db-verify/verify-protocols.ts
```

## 4. PDF reports for the 8 protocols

All 8 PDFs are in `docs/test-evidence/run-pdfs/` and summarised in `summary.json`. They are trial runs on DRAFT revisions, so every page carries **TRIAL RUN – NOT APPROVED**. The inputs are test fixtures, **not calibration results**:

- HPLC T01 uses the handwritten values on HPLC.pdf p.2.
- BAL T04, UV T02 and the POL T06 N/A entry are synthetic.

For the HPLC run, the test registered a clearly labelled instrument, `TEST-FIXTURE-HPLC` (LC-2030 PLUS), in a temporary database only.

| Protocol | Equipment | Tests | Steps | Calculated outcome | Pages |
|---|---|---|---|---|---|
| CAL-QC-HPLC-001 | TEST-FIXTURE-HPLC | 10 | 16 | INCOMPLETE (T01 UNDER REVIEW) | 8 |
| CAL-QC-POL-001 | QC-I-029 | 6 | 12 | INCOMPLETE (T06 N/A, justified) | 5 |
| CAL-QC-BAL-001 (Rev.03) | QC-I-074 | 9 | 15 | INCOMPLETE (T04 UNDER REVIEW, T06 N/A) | 10 |
| CAL-QC-MOA-001 | QC-I-023 | 6 | 12 | INCOMPLETE | 4 |
| CAL-QC-DIS-001 | QC-I-009 | 7 | 13 | INCOMPLETE | 5 |
| CAL-QC-DISINT-001 | QC-I-008 | 7 | 13 | INCOMPLETE | 4 |
| CAL-QC-REF-001 | QC-I-030 | 6 | 12 | INCOMPLETE | 5 |
| CAL-QC-UV-001 | QC-I-097 | 8 | 14 | INCOMPLETE (T02 UNDER REVIEW) | 5 |

## 5. Database migration and rollback

- `server/sql/protocol_management_migration.sql` is idempotent. It upgrades v1, v2 or v3 in place and adds 4 tables: `protocol_equipment_specs`, `protocol_equipment_changes`, `protocol_runs` and `protocol_run_snapshots`. It also adds guards (append-only, no-delete, and run state/immutability), RLS and the RPC whitelist.
- **Action for the user:** paste the whole file into the Supabase SQL Editor and run it. `/api/health/schema` should then report `protocolManagement.ok: true` and `workflowOk: true` (17 tables). Until then the core module keeps working. The Calibration Runs tab and the equipment page show which tables are missing.
- **Rollback:** `server/sql/protocol_management_v3_rollback.sql` drops only the v3 objects. v2 data are kept. Tested on PostgreSQL.

## 6. Changed files

- **New, shared:**
  - `shared/protocols/package8.ts`: package content.
  - `shared/protocols/equipment.ts`: spec catalog, diff, validation, version.
  - `shared/protocols/runWorkflow.ts`: dynamic steps, blockers, three-way merge.
- **New, server:**
  - `server/protocols/workflowService.ts`
  - `server/sql/protocol_management_v3_rollback.sql`
  - tests: `server/package8.test.ts`, `server/protocolWorkflow.test.ts`, `server/runPdf8.test.ts`
- **New, client:**
  - `client/src/components/protocols/EquipmentDataPage.tsx`
  - `client/src/components/protocols/RunWorkflow.tsx`
  - `client/src/components/protocols/runPdf.ts`
- **New, docs:** `docs/EIGHT-PROTOCOLS-INVENTORY.md`, this report, `docs/test-evidence/run-pdfs/*`
- **Modified, server:**
  - `server/protocols/{tables,sqliteSchema,sqliteStore,supabaseStore,service}.ts`
  - `server/routers/protocols.ts`: 15 endpoints
  - `server/_core/app.ts`: the health check reports v3
  - `server/sql/protocol_management_migration.sql`
- **Modified, client:**
  - `client/src/pages/Home.tsx`: navigation and page
  - `ProtocolManagement.tsx`: Calibration Runs tab and the Import 8 protocols panel
  - `ExecutionCenter.tsx`: exports `TestInput` and `ReadingInputs` for reuse
  - `common.tsx`: `runs` view
  - `protocols.css`
- **Modified, scripts:** `scripts/db-verify/verify-protocols.ts`

## 7. Known gaps and limitations

1. **All criteria are pending technical verification.** No run can be approved until a technical reviewer verifies the criteria against the original USP and manufacturer documents and the protocols are released through the existing review → QA → release workflow.
2. **Open source conflicts** stay recorded as gaps in the protocols:
   - H1: HPLC flow setpoints 1.0/1.5/2.0 vs 0.5/1.5/2.5 mL/min.
   - H2: LC-2030 PLUS ≠ QC-I-104.
   - H3: gradient acceptance.
   - H4: "Flow Ramping" has no criterion.
   - P1: the polarimeter has two protocols (POL-QC-032D is kept).
   - B1 and B2: balance history and revision.
3. **HPLC is not linked to any registered equipment.** Either register the LC-2030 PLUS on the equipment page or resolve H2.
4. **No browser test.** No headless browser was available in this environment, so the UI was verified by type checking, the build and the server and integration tests, not by clicking through it in a browser.
5. **Specification values are empty** except for the balance (capacity 220 g and readability 0.0001 g, to verify per Rev.03 §4; the other manufacturer values are marked UNVERIFIED). Fill them in from manufacturer documents on the new page; missing values print as "Not available in the current equipment profile".
6. **PDF character set.** The PDF uses the standard Latin fonts. Arabic text (for example the Arabic equipment name) is not rendered in the run PDF; the English identity fields are printed.

## Update: CAL-QC-BAL-001 Rev.03 replaces Rev.01

| Item | Detail |
|---|---|
| Source | `docs/CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf` (21-Nov-2026, status DRAFT – TECHNICAL REVIEW / QA APPROVAL REQUIRED) |
| Definition | `shared/protocols/package8.ts` (`BAL`, `BAL_REV03`). Tests: DQ/URS plus T01–T08, which is 15 run steps. 10 technical gaps (B1–B10). References: <41>/<1251> DOIs, SOP QC-105D, the source document. |
| Not invented | Rev.03 removed the numeric limits for accuracy, sensitivity, linearity and eccentricity, so they are record-only. Configured limits: repeatability (prior ≤ 0.10 %, to verify), M<sub>min</sub> ≤ m, the 11–220 g range, and the proposed 20–25 °C / 40–60 % RH site window. All criteria remain PENDING TECHNICAL VERIFICATION. |
| Applying it to a system that already has Rev.01 | Button **"Adopt Rev.03"** (`protocols.adoptBalanceRev03`). An open draft is updated with an audited diff. A released revision is kept and a new draft revision is created. Equipment links are kept. Untouched Rev.01 specification sources are re-labelled UNVERIFIED. The run is idempotent. A fresh import creates Rev.03 directly. |
| Tests | `server/package8.test.ts` 16/16; `server/protocolWorkflow.test.ts` 10/10 (new: Rev.01 draft → Rev.03, released Rev.01 → new revision 2, history and hash preserved, user specs untouched, idempotent); `server/runPdf8.test.ts` 1/1. The BAL evidence PDF has been regenerated. |
