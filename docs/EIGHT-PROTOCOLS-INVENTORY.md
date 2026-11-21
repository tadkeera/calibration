# Eight-protocol import inventory and source conflicts

Sources read in full (supplied in `docs/`):

- `Calibration_8_Protocols_System_Integration_Package.zip`
  - 8 protocol `.docx` files
  - `00_PROTOCOL_REGISTER_SOURCE.docx`
  - `02_Balance_Technical_Review_Note.docx`
  - `03_Eight_Protocol_Register.md`
  - `04_README.txt`
  - the master prompt
  - 9 screenshots of historical validation records
- `CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf` (7 pages, 21-Nov-2026). It **replaces the Rev 01 balance protocol** from the package; see "Balance (Rev 03)" below.
  - `Spectrophotometer_Page_1.jpg`
- `Calibrationtest.zip`: the same 9 screenshots plus `Spectrophotometer_Page_1.jpg`. The files are identical to those in the package, so nothing additional was found here.
- `HPLC.pdf`: a 9-page scanned HPLC calibration record. It is the controlling HPLC reference.

General rules applied on import:

- Every protocol is imported as a system **DRAFT**, revision 1. The source document revision is kept in the protocol description.
- Every acceptance criterion is imported as **PENDING TECHNICAL VERIFICATION**. No criterion is pre-verified.
- Where the supplied source gives no limit, the criterion is `record-only` with the text `NOT SPECIFIED IN SUPPLIED USP SOURCE`. A record-only criterion can never produce PASS.
- Historical record values (the screenshots and HPLC.pdf results) are **not imported as results**. They are used only as unit-test fixtures, to prove that the formulas reproduce the recorded calculations.
- Importing a protocol does not mean the instrument passed. No run or execution is created by the import.

## Register

| # | Protocol | Source revision / status | USP | Tests | Equipment link (system) |
|---|---|---|---|---|---|
| 1 | CAL-QC-HPLC-001 HPLC | Rev 00 DRAFT | <621>, <1058>, plus HPLC.pdf (controlling) | 10 (T01–T10) | **None.** The model conflicts with the registered HPLC; see conflict H2. |
| 2 | CAL-QC-POL-001 Polarimeter | Rev 00 DRAFT | <781>, <1058> | 6 | `polarimeter`: QC-I-029, ADP220, PE99003 |
| 3 | CAL-QC-BAL-001 Analytical Balance | **Rev 03 DRAFT**: technical review / QA approval required. It supersedes Rev 00, 01 and 02. | <41>, <1251>, <1058>, SOP QC-105D | 9 (DQ + T01–T08) | `balance`: QC-I-074, ED224S, 23304057. Equipment record per Rev 03 §4; the manufacturer values are marked UNVERIFIED. |
| 4 | CAL-QC-MOA-001 Moisture Analyzer | Rev 00 DRAFT | <731>, <1058>. <921> is deliberately not used. | 6 | `moisture`: QC-I-023, MA30 |
| 5 | CAL-QC-DIS-001 Dissolution Tester | Rev 00 DRAFT | <711>, <1058> | 7 | `dissolution`: QC-I-009, DT70 |
| 6 | CAL-QC-DISINT-001 Disintegration Tester | Rev 00 DRAFT | <701>, <1058> | 7 | `disintegration`: QC-I-008, ZT51 |
| 7 | CAL-QC-REF-001 Refractometer | Rev 00 DRAFT | <831>, <1058> | 6 | `refractometer`: QC-I-030, RFM340 |
| 8 | CAL-QC-UV-001 UV-Vis Spectrophotometer | Rev 00 DRAFT | <857>, <1857>, <1058> | 8 | `spectrophotometer`: QC-I-097, V-730 |

Each device's workflow therefore has a different number of steps. There are 6 fixed frame steps (Equipment, Protocol, Results, Review, Approval, PDF) plus one step per protocol test:

| Device | Steps |
|---|---|
| HPLC | 16 |
| UV | 14 |
| Balance | 15 |
| Dissolution | 13 |
| Disintegration | 13 |
| Polarimeter | 12 |
| Refractometer | 12 |
| Moisture | 12 |

## Numeric criteria imported, and their source

All of these remain pending verification.

### HPLC (from HPLC.pdf, which controls)

| Test | Criterion | Source |
|---|---|---|
| T01 Flow-rate accuracy | Error within ±1.0 % of the set value | Summary item 1 and data sheet p.2. The formula is flow = 10.0 mL ÷ time to fill. |
| T02 Lamp reference energy | Not less than 400 mV | Summary item 2 and data sheet p.3. The wavelength was recorded as "NA". |
| T03 UV lamp hours | Replace the lamp at 2000 h. This is a service trigger, not a USP limit. | Summary item 3 and data sheet p.3 |
| T04 Column oven temperature | 25, 40, 50 and 60 °C, each within ±2.0 °C (thermometer reading vs set point) | Summary item 4 and data sheet p.3 |
| T05 Injector precision | Retention-time %RSD not more than 1.0 % and area %RSD not more than 2.0 %, from 5 injections of 10 ppm caffeine | Data sheet p.4 |
| T06 Wavelength accuracy | Absorbance maximum at 272 ± 2 nm, from a scan of 267–277 nm | Data sheet p.5 |
| T07 Detector linearity | r not less than 0.99, at 10/20/30/40/50 ppm | Data sheet pp.5–6 |
| T08 Autosampler linearity | r not less than 0.99, at 5/10/20/50/80/100 µL | Data sheet p.6 |
| T09 Carryover | Blank area × 100 ÷ carryover area, not more than 0.01 % | Data sheet p.7 |
| T10 Gradient proportioning | Pumps A&B, A&C and A&D at 10/50/90 %. Actual % = (H<sub>x</sub> − H<sub>0</sub>)/(H<sub>100</sub> − H<sub>0</sub>) × 100. Acceptance: set value ± 2.0 %. | Data sheet pp.7–9 |

### Polarimeter (USP <781> text as quoted in the protocol)

- T02 temperature: within ±0.5 °C of the traceable reference, and the temperature reported to 0.1 °C or better.
- T04 accuracy: the instrument reports to 0.01° or better, and the result agrees with the certified value within the CRM's expanded uncertainty plus the manufacturer's accuracy specification.
- T05 repeatability: at least 5 replicates, and %RSD no greater than the manufacturer's specification.
- T06 linearity: at least 3 levels, each meeting the accuracy criterion.

### UV-Vis (USP <857> Table 1 as quoted in the protocol)

- T02 wavelength accuracy: ±1 nm in the UV range (200–400 nm) and ±2 nm in the visible range (400–780 nm).
- T02 precision: at least 6 replicates for non-diode-array instruments, with SD no more than 0.5 nm.

### Balance (Rev 03, replaces Rev 01)

Source: `docs/CAL-QC-BAL-001_Rev03_DRAFT_Expanded.pdf`. Rev 03 **removes** the numeric limits that Rev 01 had assumed for accuracy, sensitivity, linearity and eccentricity. Those criteria are therefore `record-only` until the current official USP text or an approved site method defines them. No limit was invented.

| Test | Criterion in the system | Source |
|---|---|---|
| DQ (URS-01…08) | Each URS item completed and approved (pass/fail). m comes from an approved method. | Rev 03 §5 |
| T01 IQ | 7 checklist items. Room temperature 20–25 °C and RH 40–60 % at start and end, labelled **PROPOSED SITE CONTROL LIMIT**: not a manufacturer or USP limit, and only enforceable once QC, Engineering and QA approve it. | Rev 03 §6, §9 |
| T02 OQ | Functional checks (pass/fail), plus the computerized-system check if connected. No universal numeric limit. | Rev 03 §9 |
| T03 Accuracy | 4 points. Signed and absolute relative error. Test weight 11–220 g (5–100 %), retained pending confirmation. Accuracy limit: the **current official <41> criterion** (record-only). Each point's weight-register entry is recorded with it (§7). | USP <41> |
| T04 Repeatability | n ≥ **10**. s<sub>eff</sub> = max(s, 0.41d), with d entered after verification. (2·s<sub>eff</sub>/m)×100 ≤ 0.10 % is the **prior criterion, to be checked against the current <41>**. | USP <41> |
| T05 Minimum weight | M<sub>min</sub> = 2000 × s<sub>eff</sub>; acceptance M<sub>min</sub> ≤ m (m − M<sub>min</sub> ≥ 0). The floor-only value 0.082 g is not an approved minimum. | USP <41> |
| T06 Sensitivity | **Optional**, risk-based. (ratio − 1)×100. The criterion comes from the approved PQ method (record-only). | USP <1251> |
| T07 Linearity | Pointwise e<sub>i</sub> = I<sub>i</sub> − m<sub>i</sub>, \|e<sub>i</sub>\|, max\|e\|, and 100·e<sub>i</sub>/m<sub>i</sub>. Not a regression. Limit from <1251> and the approved method (record-only). | USP <1251> |
| T08 Eccentricity | Centre plus 4 corners. Δ<sub>j</sub> = I<sub>j</sub> − I<sub>centre</sub>, max\|Δ\|, and 100·Δ<sub>j</sub>/m<sub>ref</sub>. Positions, denominator and limit to be approved (record-only). A 30 % load or 0.05 % limit is not assumed. | USP <1251> |

**How the replacement is applied in an existing system:** protocols → *New / import* → **"Adopt Rev.03"** (`protocols.adoptBalanceRev03`):

| Current state of CAL-QC-BAL-001 | Result |
|---|---|
| Open draft or changes-requested revision | Content replaced via the draft save. The diff is audited (`revision.content-updated`) with the Rev 03 reason. |
| Released or approved revision | That revision is kept **unchanged** and remains in force. A **new draft revision** is created with Rev 03 and goes through technical review and QA. |
| Revision under review | Refused: return it for changes first. |
| Already Rev 03 | Nothing changes. |
| Not in the system | Created as a DRAFT. |

Additional behaviour:

- Equipment links are preserved.
- Balance specifications that still carry the untouched Rev 01 value and source are re-labelled UNVERIFIED (Rev 03 §4). Their values are unchanged, and user edits are never touched.
- The new references, SOP QC-105D and the Rev 03 source document, are added as pending verification.

### All other tests

All other tests are `record-only` / NOT SPECIFIED IN SUPPLIED USP SOURCE.

## Conflicts (preserved, not resolved silently)

Each conflict is imported as a **technical gap** that needs a reviewer decision before QA approval.

### H1: HPLC flow-rate setpoints

Three sources disagree:

- **HPLC.pdf summary (p.1):** 1.0 / 1.5 / 2.0 mL/min.
- **HPLC.pdf data sheet (p.2):** printed as 0.5 / 1.5 / 2.5 mL/min, with handwritten corrections. Point A is marked "wrong" (10/20 = 0.5); point C has the note 10/4 = 2.5.
- **CAL-QC-HPLC-001 T01:** 1.0 / 1.5 / 2.5 mL/min.

How this was handled: the setpoints are entered at execution, and no default value is imposed.

There is also a separate historical "Flow Rate Accuracy Report" for QC-I-104 (LC-40B XR). It used 1.0 / 1.5 / 2.0 mL/min with 10 replicates, a different acceptance limit (Dev ≤ 3.0 %) and an extra criterion (RSD ≤ 2.0 %). That record is for a different instrument and was **not** adopted.

### H2: HPLC equipment identity

- HPLC.pdf is for a Shimadzu **LC 2030 PLUS**, instrument ID RLS/QC/HPLC/02 (Ray Life Sciences), calibrated 20/08/2022.
- The HPLC registered in the system is QC-I-104, Shimadzu HPLC2 **LC-40B XR / SPD-M40**.

How this was handled: the protocol is model-associated with LC-2030 PLUS and is **not** linked to QC-I-104. Draft runs can be started, but a compatibility banner blocks formal recording.

### H3: HPLC gradient acceptance

The record says "Setting value ± 2.0 %". The protocol notes that the units and definition must be verified. Because HPLC.pdf controls, ±2.0 is imported as absolute percentage points, and the interpretation remains pending.

### H4: HPLC "Flow Ramping (Flow slope)"

This phrase is handwritten on HPLC.pdf p.9, with no procedure and no criterion. It was **not** imported as a test; it is recorded as an open gap.

### P1: Polarimeter has two protocols

The system already contains **POL-QC-032D** (a DRAFT that documents the ±0.02° manual vs ±0.01° USP accuracy gap). The package adds **CAL-QC-POL-001**. Both are kept: CAL-QC-POL-001 is imported as a separate protocol, and neither overwrites the other. A gap records that one of them must be designated as controlling.

### B1–B10: Balance (Rev 03)

| Gap | Content |
|---|---|
| B1 | The historical QC-I-074 record has 6 readings and cannot satisfy n ≥ 10. Preserve it unchanged and retest (Rev 03 §10). The ±0.0004 g limit was not adopted. |
| B2 | The smallest net mass m (URS-03) is not set. The QC Owner must set it from an approved method. |
| B3 | The current official USP text is not confirmed. The extracts were printed 2024. DOI previews: <41> USPNF_M98780_05_01, <1251> USPNF_M99963_04_01 (2025). USP-NF 2026 Issue 5 has been official since 01-Oct-2026. |
| B4 | ED224S manufacturer specifications are unverified. Capacity and d must be verified; the Rev 01 manufacturer values are not used as criteria. |
| B5 | 20–25 °C / 40–60 % RH is a proposed site window. The previous Rev 01 range of +10–30 °C is unverified. |
| B6 | The reference-weight register is empty: no certificates were supplied. |
| B7 | The linearity method and limit are not approved. Rev 01's 0.05 % is not carried over. |
| B8 | The eccentricity positions, denominator and limit are not approved. |
| B9 | The sensitivity criterion is method-defined. Rev 01's 0.05 % is not mandatory. |
| B10 | The accuracy criterion and range must be confirmed against the current <41>. Rev 01's ≤ 0.10 % and one-third rule are not carried over. |

Rev 03 is a **DRAFT – NOT APPROVED** document. In the system it remains a draft revision, and technical review and QA approval must be recorded **in the system**. Note: the PDF's hidden header text layer still contains "Rev.02", while the visible header and document control state Rev 03.

### M1: Moisture analyzer and <921>

USP <921> Water Determination was not substituted for <731>.

### U1: UV-Vis historical record

The QC-I-097 historical record uses limits that the protocol does not state: correlation ≥ 0.99, baseline ±0.001 A, and stray light ≥ 2.0 A. These are shown only as level notes, not adopted as criteria.

### X1: Replicate and level counts

Several protocols require replicates or levels without stating how many:

- REF T03 and T04
- MOA T02, T03 and T05
- UV T03 and T04
- DIS T03 and T04

The import configures an editable placeholder count, labelled "count NOT SPECIFIED IN SUPPLIED SOURCE — confirm before technical review".
