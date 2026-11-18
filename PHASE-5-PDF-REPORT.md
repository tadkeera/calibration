# Phase 5 — Saved-Record PDF and Pagination

- **Status:** PDF header routing is restricted to the canonical original-approved asset and fails closed if unavailable. The original file is missing from this checkout/runtime, so visual signoff and production asset provisioning remain blocked.
- **Branch:** `feat/polarimeter-validation-upgrade`
- **Date:** 2026-11-16

> The authoritative current report is [`FINAL-COMPLETION-REPORT.md`](FINAL-COMPLETION-REPORT.md).

## Delivered

- Polarimeter PDFs are generated from saved record inputs, snapshots, metrics, and persisted lifecycle state. Known demonstration/fallback values are not substituted for missing saved values.
- The PDF includes accuracy, repeatability, concentration/rotation linearity, regression details, and separate `r`/`R²` values.
- Saved analyst account/record time, lifecycle decision identity/reason/time when available, the latest technical review, and linked-retest details are included. Export stops if the required saved review/audit lookup fails.
- Tables and workflow details can continue onto additional pages. Page numbering is added as `Page N of M` after rendering; synthetic tests exercise ordinary and maximum configured reading/linearity fixtures.
- The signature/status block explicitly discloses that the system captures no secure electronic signature. A typed name and an authenticated decision are not described as a secure signature.

## Verification and limits

- Vitest tests generate synthetic PDFs and check A4 page dimensions, page count/numbering, lifecycle/review/retest text, and maximum-table pagination. They do not rasterize the PDFs for visual review.
- The renderer requests `/api/trpc/assets.officialReportHeaderUrl`; the cloud storage proxy and local route use the single approved key `yemen-qc-official-report-header_14217543.png`. There is no production fallback image or generated header. A test explicitly verifies PDF generation rejects when that source is unavailable.
- The synthetic PNG response is used only by unit tests. The original header file is not present in this checkout or the expected local asset directories, so the real asset's bytes and rendered print appearance could not be verified here. Production remains dependent on provisioning that original under the approved key.
- Only the latest technical review and relevant lifecycle decision metadata are printed; the complete lifecycle audit log and CAPA event history remain in the application record view rather than the PDF.
- The PDF generation time is labeled as client-clock time and is distinct from the server-saved record creation time.
