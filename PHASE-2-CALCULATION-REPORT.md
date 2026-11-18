# Phase 2 — Protocol Engine and Scientific Calculations

**Status:** Implemented; SOP-dependent settings remain pending verification.  
**Branch:** `feat/polarimeter-validation-upgrade`  
**Date:** 2026-11-16

## Delivered

- Added a typed schema-version-2 Polarimeter payload and a full protocol snapshot in `shared/polarimeter.ts`.
- Recomputed specific rotation from the original optical rotation, concentration, and controlled tube length using `100 × rotation / (tube length × concentration)`. Evaluation uses unrounded values; display precision is separate.
- Added protocol-configurable reading count and repeatability methods: deviation from first/reference/mean, maximum range, sample standard deviation, or RSD%. Sample SD uses `n − 1`; RSD is reported as undefined for a zero/near-zero mean.
- Added concentration-versus-optical-rotation least-squares regression, slope, intercept, Pearson `r`, and `R²` as separate values. The configured criterion selects exactly `r` or `R²`; the two are not substituted for one another.
- Added nominal or configured actual-concentration X values, required-field controls, finite-number checks, valid calendar/date-time/expiry checks, and effective-date validation.
- Added version history for controlled settings. Any change creates a new pending-verification version; general settings APIs cannot mark the protocol approved.

## Verification

- `server/polarimeterCalculations.test.ts`: 9 tests passed, covering calculations, `r` versus `R²`, evaluation methods, zero concentration, unrounded acceptance, configured counts/actual X values, undefined RSD, invalid dates, and version history.
- Client and server use the same shared calculation functions; the server still independently reconstructs and validates the submitted payload.

## Scientific limitation

The approved QC-032D source was not available for verification. Existing initial limits and method assumptions are therefore treated only as unverified settings. Protocol status remains `pending-verification`, and successful formal approval remains blocked. No replacement scientific criteria were invented.
