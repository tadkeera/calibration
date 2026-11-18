# Phase 3 — Server Verification and Data Integration

- **Status:** Implemented for SQLite and Supabase paths; live Supabase credentials were unavailable.
- **Branch:** `feat/polarimeter-validation-upgrade`
- **Date:** 2026-11-16

> Historical Phase 3 checkpoint: the later workflow upgrade added versioned drafts, review/deviation/retest tables, and a Supabase migration. Current schema and release status are in [`FINAL-COMPLETION-REPORT.md`](FINAL-COMPLETION-REPORT.md).

## Delivered

- Added tRPC shape validation for the schema-v2 Polarimeter payload while retaining the generic record schema for other instruments.
- Server code rebuilds the protocol snapshot from controlled settings, verifies the submitted snapshot and existing equipment-register identity, recalculates all mandatory metrics/statuses from primary inputs, and rejects mismatched client rows, metrics, chart, note, or lifecycle result.
- Both `server/localDb.ts` and `server/supabaseDb.ts` use the existing `validation_settings`, `instrument_profiles`, and validation-record persistence paths. No parallel equipment library or new tables were introduced.
- Preserved historical rows; new structured inputs/snapshots are additive JSON data. No SQL schema migration was needed.

## Verification

- Local SQLite workflow tests passed (4 tests), including persistence and failure/approval protection.
- Mocked Supabase Polarimeter record tests passed (3 tests), including server normalization, tamper rejection before insert, and pending-protocol approval blocking.
- Mocked Supabase settings version/history test passed (1 test).
- The real Supabase connection, local-auth-against-Supabase, and settings-against-Supabase test files were excluded from the feasible regression run because they require a configured external project and credentials.

## Limits

- Supabase behavior is verified with mocked REST responses, not against a live project.
- Persistence continues to store the structured payload in existing JSON/JSONB columns; historical records are not migrated or recalculated.
