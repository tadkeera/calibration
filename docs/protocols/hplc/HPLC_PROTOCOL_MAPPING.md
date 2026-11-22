# HPLC Calibration Protocol – Shimadzu LC 2030 PLUS — source mapping

Source: `docs/HPLC.pdf` (9 scanned pages) — **Laboratory Calibration Reference** (not a USP requirement).
English extraction: `HPLC_Complete_Analysis_English.txt` (authoritative per user instruction).
Implementation: `shared/protocols/hplcLc2030.ts` (content), `server/protocols/hplcSeed.ts` (idempotent registration).

| # | Test (stable key) | Pages | Readings / fields | Formula | Criterion | Notes |
|---|---|---|---|---|---|---|
| 1 | Flow Rate Accuracy (`hplc_flow_rate`) | p.1–2 | set 1.0 / 1.5 / 2.0 mL/min; time t (min) per set; V = 10.0 mL (source default) | Actual = V/t; Dev = Actual − Set; Dev % = (Actual − Set)/Set × 100 | \|Dev %\| ≤ 1.0 | Note A — resolved: p.1 setpoints 1.0 / 1.5 / 2.0 apply (user instruction); p.2 values kept for traceability |
| 2 | Lamp Reference Energy (`hplc_lamp_energy`) | p.3 | energy (mV); wavelength 254 nm | direct | ≥ 400 mV | Note F — p.3 shows "NA" |
| 3 | UV Lamp Hours (`hplc_uv_lamp_hours`) | p.3 | lamp hours (h) | — | advisory only: alert at ≥ 2000 h | Note D — not PASS/FAIL |
| 4 | Column Oven Temperature (`hplc_column_oven`) | p.3 | 25 / 40 / 50 / 60 °C: thermometer, display | Th − Set; Disp − Set; Disp − Th (informative) | \|Th − Set\| ≤ 2.0 and \|Disp − Set\| ≤ 2.0 | |
| 5 | System and Injector Precision (`hplc_precision`) | p.4 | 5 injections: RT, area | mean, SD (n − 1), RSD % = SD/mean × 100, deviations | RSD RT ≤ 1.0 %; RSD area ≤ 2.0 % | conditions p.4 |
| 6 | Wavelength Accuracy (`hplc_wavelength`) | p.5 | area at 267–277 nm (11) | λ at max response (ties flagged) | 270 ≤ λmax ≤ 274 nm | |
| 7 | Detector Linearity (`hplc_detector_linearity`) | p.5–6 | 10–50 ppm areas | slope, intercept, Pearson r, R² = 1 − SSres/SStot, predicted, residuals | r ≥ 0.99 | Note B — p.1 wording |
| 8 | Autosampler Linearity (`hplc_autosampler_linearity`) | p.6 | 5, 10, 20, 50, 80, 100 µL areas | as test 7 | r ≥ 0.99 | Note G — capacity 100 µL to verify |
| 9 | Carryover Test (`hplc_carryover`) | p.7 | blank area, carryover area (> 0) | Blank / Carry × 100 | ≤ 0.01 % | preparation pending verification |
| 10 | Gradient Proportioning Valve (`hplc_gpv`) | p.7–9 | A&B, A&C, A&D × 10 / 50 / 90 %: H0, Hset, H100 | Actual % = (Hset − H0)/(H100 − H0) × 100; Dev = Actual − Set (pp); Rel. dev % = (Actual − Set)/Set × 100 | \|Rel. dev %\| ≤ 2.0 (± 2.0 % **relative** to the setting, e.g. 9.8–10.2 % at 10 %) | Note C — resolved by user decision; USP <621> / <1058> extracts: NOT SPECIFIED IN SUPPLIED USP SOURCE |

Review notes stored in the protocol (`gaps`): A flow setpoints · B linearity wording · C GPV ±2.0 interpretation ·
D lamp hours advisory · E source instrument (LC 2030 PLUS, RLS/QC/HPLC/02) vs Equipment Master QC-I-104 (LC-40B XR) ·
F lamp-energy wavelength · G handwritten details pending verification.

Seed v2 (this revision of the mapping): notes A and C are resolved by explicit user decisions, so no acceptance
criterion is pending. The supplied USP extracts give no GPV limit; the limit stays the HPLC.pdf laboratory value
(not labelled as USP). A Draft registered by seed v1 is upgraded automatically (audited) unless a user edited it;
an approved v1 revision is never edited — a new Draft revision is created instead. Equipment specifications
documented in HPLC.pdf (pump channels, autosampler, 100 µL capacity, UV detector, wavelengths, C18 25 cm × 4.6 mm
column, semi-annual interval) are recorded on the Equipment Master only where the field is empty, with the page as
source. The reference HPLC-CAL-RECORD-LC2030 stays pending until the Quality Manager uses **Verified** on the
Protocol page (password-signed; values never change).

Historical 2022 values (results, 20/08/2022, 20/02/2023) are reference only — never defaults.
The protocol is registered as **Draft – Pending Quality Manager Approval** and is never approved automatically.
