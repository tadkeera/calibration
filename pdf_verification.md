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
