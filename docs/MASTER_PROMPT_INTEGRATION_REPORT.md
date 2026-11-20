# Master Prompt Integration Report
## Eight protocols + unified nine-step workflow — implementation evidence

**Date:** 2026-11-21
**Project:** Calibration & Validation Management System (`yemen-qc-validation`)
**Source package:** `Calibration_8_Protocols_System_Integration_Package.zip` + `HPLC.pdf` + `calibration-main.zip`
**Repository:** `E:\calibration\calibration` (local git repository initialized from the supplied `calibration-main.zip` snapshot; see "Environment notes").

---

## 1. Executive summary

The supplied system already contained the eight protocol definitions, a generic protocol engine, normalized equipment data, immutable run/protocol snapshots, draft-conflict handling, review/approval gates, a snapshot-based PDF generator and a large automated test suite. The gap against the master prompt was that **the canonical nine-step workflow existed only for the polarimeter** (a hard-coded, English-only form) while the generic run engine rendered **12–16 dynamic steps** (one per protocol test), and the Arabic equipment page used a different title from the one specified.

This integration makes the nine-step workflow the single canonical workflow for **all eight devices**, keeps every protocol-specific test intact, adds explicit Not-Applicable documentation for empty test steps, prints the canonical mapping in the PDF, and renames the Arabic equipment page to the exact required title. No existing feature, table or historical record was deleted.

---

## 2. What was implemented

### 2.1 Canonical nine-step workflow (shared domain)
`shared/protocols/runWorkflow.ts`
- `CANONICAL_STEP_KEYS` and `CANONICAL_STEP_LABELS`: the exact steps and labels, in order —
  1. Equipment Selection · 2. Protocol · 3. Accuracy · 4. Repeatability · 5. Linearity ·
  6. Results · 7. Review · 8. Approval · 9. PDF — each with an Arabic label.
- `buildRunSteps(content)` now returns those nine steps for **every** protocol (previously 12–16).
- `mapTestsToSteps(content)` assigns each protocol test to Accuracy / Repeatability / Linearity by its controlled name; every other test is preserved in the Results group. This is a **view mapping**: evaluation and PDF still use the complete frozen protocol content, so no test, formula, field, criterion or acceptance limit is changed. Tests were verified to be mapped exactly once (new test).
- `canonicalStepBlockers(...)`: a test step with no test **must** be documented as Not Applicable with a written justification (≥10 chars) and a recorded reviewer confirmation. It blocks formal recording and approval, never draft saving. Reserved measurement keys `_na:accuracy`, `_na:repeatability`, `_na:linearity` hold this record.

### 2.2 Server enforcement
- `server/protocols/workflowService.ts`: `runCatalog` reports 9 steps; `getRun` and `recordRun` merge the canonical N/A blockers into the existing blocker list; `assertMeasurements` accepts the three reserved N/A keys (and still rejects any other unknown key).
- `server/protocols/service.ts`: `prepareExecution` accepts the same reserved keys, so a documented run can enter the existing review → approval workflow.
- The existing propagation, snapshot, immutability, conflict-merge, segregation-of-duties and approval rules were left unchanged.

### 2.3 User interface
`client/src/components/protocols/RunWorkflow.tsx`
- One nine-step horizontal stepper for all devices, showing step number, English + Arabic label, current/done/pending state, and a status badge. Navigation to Review/Approval is blocked until the run is recorded.
- Steps 3–5 render the device's mapped tests with their original protocol fields, raw-data inputs, calculated values and criteria; the Results step renders all remaining protocol tests under **"Additional protocol-specific tests"** with their own inputs and criteria.
- Empty test steps render `NaStepPanel` (Not-Applicable justification + reviewer confirmation) instead of being silently skipped.
- A language toggle (EN/عربي) drives the workflow labels; the stepper direction flips to RTL in Arabic.
- `client/src/components/protocols/protocols.css`: step labels wrap so all nine steps remain readable.

### 2.4 Arabic equipment page
- Exact required title **`تعديل بيانات المعدات والمواصفات`** is now used in `client/src/pages/Home.tsx` (navigation, breadcrumb, lazy-load fallback) and `client/src/components/protocols/EquipmentDataPage.tsx` (page heading/constant). The references in `shared/protocols/equipment.ts`, `server/protocols/workflowService.ts` and `RunWorkflow.tsx` were updated too. The page already supported typed/unit-aware specification groups, change reasons, immutable audit history, permissions, conflict safety and propagation.

### 2.5 PDF report
`client/src/components/protocols/runPdf.ts`
- Identification now states the unified nine-step workflow instead of the old dynamic count.
- New section **"Nine-step controlled workflow and test mapping"** lists each step and the exact protocol tests mapped to it, plus a table of Not-Applicable steps with their justification and confirmation.
- PDFs remain generated only from frozen run snapshots with controlled watermarks, page numbers, document IDs, history and system-record-only signatures.

### 2.6 Documentation
- `docs/EIGHT-PROTOCOLS-INVENTORY.md` and `docs/CALIBRATION-8-PROTOCOLS-REPORT.md` were corrected: the workflow now has nine fixed steps for all devices; the per-protocol test counts remain (HPLC 10, UV 8, BAL 8, DIS/DISINT 7, POL/REF/MOA 6).

---

## 3. Files changed / added

Modified:
- `shared/protocols/runWorkflow.ts`, `shared/protocols/equipment.ts`
- `server/protocols/workflowService.ts`, `server/protocols/service.ts`
- `client/src/components/protocols/RunWorkflow.tsx`, `client/src/components/protocols/runPdf.ts`, `client/src/components/protocols/protocols.css`, `client/src/components/protocols/EquipmentDataPage.tsx`
- `client/src/pages/Home.tsx`
- `server/package8.test.ts`, `server/protocolWorkflow.test.ts`, `server/runPdf8.test.ts`
- `scripts/db-verify/verify-protocols.ts`
- `docs/EIGHT-PROTOCOLS-INVENTORY.md`, `docs/CALIBRATION-8-PROTOCOLS-REPORT.md`

Added:
- `server/canonicalWorkflow.test.ts` (5 tests: exact labels/order, complete test mapping, device-specific assignment, Not-Applicable gating, exact Arabic page title)

No database migrations were required: the reserved N/A records use the existing `measurements` JSON column of `protocol_runs` / `protocol_executions`. Rollback = revert the listed files; no schema rollback needed.

---

## 4. Protocol import inventory and mapping

All eight protocols are imported as DRAFT with every criterion `PENDING TECHNICAL VERIFICATION` (source: `shared/protocols/package8.ts`; source documents verified from the supplied package). Conflicts (H1–H4, P1, B1–B2, M1, U1, X1) remain open technical gaps — nothing was silently resolved.

| Protocol | Device | Tests | Accuracy step | Repeatability step | Linearity step | Other tests → Results |
|---|---|---:|---|---|---|---|
| CAL-QC-HPLC-001 | Shimadzu LC-2030 PLUS | 10 | T01, T06 | T05 | T07, T08 | T02, T03, T04, T09, T10 |
| CAL-QC-POL-001 | ADP220 polarimeter | 6 | T04 | T05 | T06 | T01–T03 |
| CAL-QC-BAL-001 (Rev.01, QA pending) | Sartorius ED224S | 8 | T03 | T04 | T07 | T01, T02, T05, T06, T08 |
| CAL-QC-MOA-001 | Moisture analyzer | 6 | N/A (documented) | T05 | N/A (documented) | T01–T04, T06 |
| CAL-QC-DIS-001 | Dissolution tester | 7 | N/A | N/A | N/A | T01–T07 |
| CAL-QC-DISINT-001 | Disintegration tester | 7 | N/A | N/A | N/A | T01–T07 |
| CAL-QC-REF-001 | RFM340 refractometer | 6 | T03 | T04 | N/A | T01, T02, T05, T06 |
| CAL-QC-UV-001 | UV-Vis spectrophotometer | 8 | T02, T03 | N/A | T04 | T01, T05–T08 |

---

## 5. Test results (actual runs)

Environment: portable Node **v22.23.5**, pnpm **10.4.1**, `NODE_OPTIONS=--experimental-sqlite`.
(Test environment variables `JWT_SECRET`, `VITE_APP_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OAUTH_SERVER_URL` were set to local dummy values for the auth tests; `--testTimeout=30000` was used because the machine is slow.)

| Check | Command | Result |
|---|---|---|
| TypeScript | `pnpm check` (`tsc --noEmit`) | **PASS — 0 errors** |
| Focused 8-protocol/workflow tests | `vitest run server/canonicalWorkflow.test.ts server/package8.test.ts server/runPdf8.test.ts server/protocolWorkflow.test.ts` | **PASS — 4 files, 29 tests** |
| Full suite | `vitest run --testTimeout=30000` | **PASS — 33 files passed, 4 skipped (integration/env), 153 tests passed, 9 skipped, 0 failed** |
| Production build | `pnpm build` (vite + esbuild) | **PASS** — `dist/index.js` and `dist/public/*` generated |

`server/runPdf8.test.ts` additionally regenerated eight controlled PDFs under `docs/test-evidence/run-pdfs/` from frozen run snapshots for all eight protocols.

---

## 6. Known limitations / unresolved source-data gaps

These are inherited from the supplied package and were deliberately **not** fabricated:
- All eight protocol revisions remain DRAFT with criteria pending technical verification; formal approval is blocked by design until a reviewer verifies them and the protocol is released.
- Conflict **H2**: the HPLC protocol (LC-2030 PLUS) is not linked to the registered HPLC QC-I-104 (LC-40B XR). A compatibility banner blocks formal recording; start a new run only after controlled resolution.
- Open gaps H1, H3, H4, P1, B1, B2, M1, U1, X1 (flow setpoints, gradient units, flow ramping, two polarimeter protocols, historical balance record, Rev.01 QA pending, `<921>` vs `<731>`, UV historical limits, unspecified replicate counts).
- Most equipment specifications are intentionally empty ("Not available in the current equipment profile"); no values were invented.
- The legacy polarimeter-only form (`PolarimeterValidationForm.tsx`) is preserved for backward compatibility. The canonical nine-step workflow for **all** devices is the one under **Protocol Management → Calibration Runs**.
- The legacy device list in `client/src/lib/qc.ts` contains a viscometer and no balance; the protocol-linked equipment register used by the canonical workflow contains the balance. Reconciling the two catalogs is an institutional decision.
- Run PDFs render English text; Arabic labels are shown in the UI but not embedded in the PDF font set.
- Production Supabase migration, browser E2E screenshots and deployment-domain verification were not performed in this environment (see Environment notes).

---

## 7. Build / run instructions

```powershell
# Node 22+ required (Node 20 cannot load node:sqlite)
corepack pnpm install --frozen-lockfile
corepack pnpm check                      # typecheck
$env:NODE_OPTIONS = "--experimental-sqlite"
corepack pnpm exec vitest run --testTimeout=30000
corepack pnpm build                      # dist/
corepack pnpm dev                        # development server
```
Desktop installer: `corepack pnpm build:desktop:installer` (Windows, electron-builder NSIS).

---

## 8. Environment notes

- Direct `git clone https://github.com/tadkeera/calibration.git` initially timed out (three attempts, including `--depth 1`). The supplied `calibration-main.zip` — the repository snapshot with the same `package.json` repository URL — was therefore extracted to `E:\calibration\calibration` and a local git repository was initialized (`9adcb6a`). Once GitHub access became available, the real remote `main` (`959f8b8`) was fetched and the integration commit was cherry-picked on top of it, so remote history was **not** overwritten.
- The integration was pushed to `https://github.com/tadkeera/calibration.git` on branch `main`: remote head is now `2c985d5` ("Integrate eight protocols with canonical nine-step workflow and exact Arabic equipment page title"). No credentials were stored in `.git/config`.
- The npm registry is reachable; dependencies were installed from `pnpm-lock.yaml`.
- Live browser screenshots were not produced: starting the authenticated app requires the site's Supabase/initial-admin provisioning, which is outside this sandboxed environment. Automated PDF evidence is available in `docs/test-evidence/run-pdfs/`.
