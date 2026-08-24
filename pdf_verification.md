# PDF Visual Verification

- The official header in the generated PDF is the cropped image extracted from the supplied approved paper form, including the bilingual national header, BOMa logo, and double rule.
- The second generated sample renders the validation result labels in readable English within the official table, avoiding unsupported Arabic glyph rendering in the PDF font.
- The report retains the metadata grid, official validation-results table, tolerance conclusion, approval block, date, signature line, and form number on one A4 page.
- The standard disintegration layout intentionally leaves controlled whitespace below short result tables; the polarimeter path uses the extended accuracy, repeatability, and linearity layout.

## HPLC report verification

The Flow Rate Accuracy Report uses the supplied official header, a controlled metadata table, English test and result labels, and three distinct flow-rate charts for the 1.000, 1.500, and 2.000 ml/min sets. The corrected report replaces the previous unreadable Arabic transliteration in the test rows and calculated mean values with `Flow rate` and `Mean` labels.

## Disintegration report verification

The revised Disintegration Tester report preserves the supplied official header and control footer while separating its content into `Temperature Test`, `Temperature of Medium`, `Time Accuracy Test`, and `Number of Cycle Test`. Every tested value appears in the relevant section with an English official name, an SOP acceptance limit, actual value, and Pass/Fail remark.

## Refractometer report verification

The Refractometer report was regenerated after the final template changes. It contains separate `Calibration Test`, `Verification Test`, and `Linearity Test` sections; the verification liquids are rendered as Distilled Water, Isopropyl Alcohol, Dichloromethane, Glycerin, and Benzaldehyde. The linearly plotted refractive-index values and the official header, metadata, conclusion, and approval block all appear on the single-page report.

## Final device coverage

All eight validation forms were exercised with their reference readings after the final template updates. The generated reports cover: Disintegration Tester (temperature, medium, time, cycles), Refractometer (calibration, verification, linearity), Dissolution Tester (temperature, stirring, basket and paddle wobble), HPLC2 Pump (three ten-sample flow curves), Spectrophotometer (wavelength, specific absorbance, stray light, linearity), Moisture Analyzer (span, reproducibility, off-center load, linearity), Polarimeter (accuracy, repeatability, optical-rotation linearity), and Rotational Viscometer (standards and linearity). The spectrophotometer specific-absorbance formula was corrected during this verification, turning the supplied reference readings from four false failures into 17/17 passing readings.

The final Spectrophotometer PDF was reviewed as a two-page controlled record: page one contains only the official header and the four named result sections, while page two repeats the header and places the linearity chart above an independent approval block. This eliminates the earlier chart/signature overlap. The final Rotational Viscometer PDF was also visually reviewed and contains separate Viscosity Standards and Linearity Test sections, a readable chart, and a non-overlapping approval block.

## Detailed HPLC layout verification

The revised HPLC report now uses two controlled pages. The first page presents three separate compact tables—one each for 1.000, 1.500, and 2.000 ml/min—with all ten readings, Mean, Limit, Deviation, RSD, and an independent Pass/Fail result. The former overlapping combined-result cells have been removed. The second page carries the three separate flow-rate charts and the approval block, with sufficient vertical separation between every element.

The same HPLC file was then generated and opened from the published domain. Its first page confirmed that all 30 readings and all three summary blocks are present in production with no collided values or text.

The published second HPLC page was also reviewed. It contains three independent flow-rate charts with readable axes and sample labels, followed by a separated conclusion and approval block; no chart, value, or signature overlaps another report element.

## Detailed dissolution layout verification

The revised Dissolution Tester report uses the paper-form arrangement on a single page: a Temperature Test table with all six vessel readings, a distinct Stirring Test table, a dedicated water-bath table, and separate Basket and Paddle shaft-wobble tables. Each table retains its own limit and remarks column, and every one of the 24 reference readings is rendered without truncation or overlap.

The published dissolution workflow was executed using the reference readings. The generated production file is `Dissolution_Tester_Validation_Record (2).pdf`; it is retained as production evidence for the structured-table review.

After the final template refinement, the Rotational Viscometer workflow was rerun in the development preview. The result retained the three standards and linearity readings, and `Rotational_Viscometer_Validation_Record (1).pdf` was issued for a post-change visual review.

The first post-change review identified that the row labels encode the nominal values rather than ordinal numbers. The section matching was corrected to use the 50, 1,000, and 12,500 cP labels, and a replacement PDF was issued for confirmation.

The corrected viscometer PDF was visually reviewed. It now displays `Viscosity Standard 1`, `Viscosity Standard 2`, and `Viscosity Standard 3` as three independent tables, followed by a separate Linearity Test table and chart; all values, the final conclusion, and the approval block remain readable without overlap.

The production dissolution report was visually reviewed as a single controlled page. It presents all 24 results in the independent temperature, stirring, basket-wobble, and paddle-wobble tables, with no truncated values or collided table elements.

The Spectrophotometer was rerun with the 17 supplied reference readings after separating `Limit of Stray Light` from `Linearity Test`. A new two-page PDF was issued for visual confirmation of this post-change layout.

The two new Spectrophotometer pages were visually verified. Page one contains the four discrete tables—Control of Wavelengths, Control of Absorbance, Validation Performance Test, and Limit of Stray Light—while page two contains the separate Linearity Test table, chart, conclusion, and approval block. The pagination repeats the controlled header and no value or signature overlaps another element.

Refractometer, Moisture Analyzer, and Disintegration Tester were not affected by the final Spectrophotometer, Viscometer, or Polarimeter layout amendments. Their previously reviewed sectioned reports remain the current rendering paths: Calibration/Verification/Linearity; Span/Reproducibility/Off-center/Linearity; and Temperature/Medium/Time/Cycles respectively.

The Refractometer was then regenerated after its conversion to the dedicated five-column table layout. The reference zero, span, five verification standards, and linearity result all passed and `Refractometer_Validation_Record (1).pdf` was issued for visual inspection.

The Moisture Analyzer was regenerated after its conversion to dedicated tables for Span Calibration, Reproducibility, Off-center Load, and Linearity. Its 15 reference readings passed and `Moisture_Analyzer_Validation_Record (1).pdf` was issued for visual inspection.

The Refractometer report was visually reviewed on one page. It presents separate Calibration, Verification, and Linearity tables followed by the linearity chart and separated approval block, without clipped cells or collisions.

The Moisture Analyzer report was visually reviewed on two pages. The first page contains separate Span Calibration, Reproducibility, Off-center Load, and Linearity tables; the chart and approval block continue to the second controlled page without overlaying values or signatures.

The Disintegration Tester was regenerated after its conversion to dedicated Temperature, Medium Temperature, Time Accuracy, and Number of Cycle tables. All six reference results passed and `Disintegration_Tester_Validation_Record (3).pdf` was issued for visual inspection.

The Disintegration Tester report was visually reviewed on one page. Its four independent formal tables, all six readings, result conclusion, approval block, and form number are fully visible and separated without text or border overlap.
