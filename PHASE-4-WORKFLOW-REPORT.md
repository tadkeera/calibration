# Phase 4 — Lifecycle, Independent Review, Deviations, and Retesting

- **Status:** Implemented in the local application code; Supabase database rollout is still a release gate.
- **Branch:** `feat/polarimeter-validation-upgrade`
- **Date:** 2026-11-16

> The final scope and verification numbers are maintained in [`FINAL-COMPLETION-REPORT.md`](FINAL-COMPLETION-REPORT.md).

## Delivered

- A calculated Polarimeter result is distinct from the saved record lifecycle. Passing calculations remain Draft until an authorized server workflow decides the record.
- Failed technical results cannot be approved as successful; an unverified protocol blocks accepted review and successful approval. QC-032D remains Pending Verification because the approved source was unavailable.
- Added append-only technical-review records bound to the exact validation-record version. Reviews are administrator-gated in the current `admin`/`user`/`viewer` role model, and the analyst cannot review their own record.
- Polarimeter approval requires a current accepted independent review, a passing result, an approved protocol, no outstanding review issues, and distinct analyst, reviewer, and approver user IDs. Rejections require reasons.
- Failed accuracy/repeatability/linearity tests create deviation cases with saved evidence and configured-limit disclosure. CAPA updates carry versions and append-only audit events. Status transitions cannot move backwards; closure is administrator-only and requires the specified investigation/action fields.
- Failed Polarimeter measurement records are immutable and retained. Linked retests require the same equipment identity, a failed original record, and a recorded reason. The retest is a new record; it does not replace the original.
- Added account-scoped, versioned server drafts alongside local browser recovery. Concurrent or incompatible copies are preserved until a user explicitly resolves them; successful record-save cleanup uses version checks.
- SQLite record decisions/reviews and CAPA updates use transactions. Supabase review, decision, and CAPA updates are routed through migration-defined atomic RPCs. The SQL migration also scopes the failed-record delete guard to failed Polarimeter records.

## Verification

The feasible regression run passed **61 tests across 21 files**, including SQLite workflow/migration tests and mocked Supabase provider tests. The current overall test/build status and the three externally dependent exclusions are recorded in `FINAL-COMPLETION-REPORT.md`.

## Limits and release gates

- Supabase behavior is mocked; the migration has not been applied or executed against a live/staging PostgreSQL project.
- There is no dedicated reviewer role; reviewer and approver are administrator accounts, with independent user IDs enforced. No secure electronic signature is implemented or claimed.
- QC-032D must be obtained and verified before protocol approval can be enabled.
