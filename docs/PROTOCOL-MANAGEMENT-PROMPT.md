# MASTER DEVELOPMENT PROMPT
# CENTRALIZED EQUIPMENT PROTOCOL MANAGEMENT & APPROVAL SYSTEM

**Project:** Calibration & Validation Management System  
**Module:** Protocol Management  
**Development Type:** Extension of Existing Application  
**Interface Language:** English  
**Primary Objective:** Universal Equipment Protocol Creation, Qualification, Review, Approval, Release, and Lifecycle Management

---

# 1. EXECUTIVE OBJECTIVE

Develop a comprehensive, centralized, scalable, and fully integrated **Protocol Management Module** within the existing Calibration & Validation Management System.

The purpose of this module is to establish one controlled location where authorized users can create, configure, review, approve, release, revise, and manage protocols for all equipment registered in the system.

## 1.1 Critical Architectural Principle

**DO NOT DEVELOP A POLARIMETER-SPECIFIC PAGE.**

Develop one universal Protocol Management page and one generic Protocol Builder that can accommodate different equipment categories, manufacturers, models, measurement principles, intended uses, and qualification requirements.

The Polarimeter ADP220 protocol is only the first example to be configured through this universal system.

Future equipment protocols must be created using the same Protocol Management architecture without requiring a separate page or equipment-specific programming.

Examples of equipment that may eventually use this module include:

- Polarimeters.
- Analytical Balances.
- pH Meters.
- Conductivity Meters.
- UV-Visible Spectrophotometers.
- HPLC Systems.
- GC Systems.
- Dissolution Testers.
- Disintegration Testers.
- Friability Testers.
- Hardness Testers.
- Melting Point Apparatus.
- Viscometers.
- Thermometers.
- Temperature Mapping Systems.
- Incubators.
- Ovens.
- Autoclaves.
- Refrigerators and Freezers.
- Water Testing Instruments.
- Environmental Monitoring Instruments.
- Other laboratory and production equipment.

The system must support different protocol structures and testing methods without assuming that all equipment requires identical tests or acceptance criteria.

## 1.2 Centralized Source of Truth

Protocol Management must become the authoritative source for:

- Protocol definitions.
- Protocol sections.
- Test methods.
- Measurement configurations.
- Acceptance criteria.
- Calculation formulas.
- Reference documents.
- Qualification requirements.
- Calibration and verification intervals.
- Technical justifications.
- Review and approval records.
- Protocol revisions.
- Controlled releases.

Existing Calibration, Validation, Qualification, and Equipment modules must retrieve applicable protocol information from this centralized source.

Do not create independent acceptance criteria or duplicate protocol definitions in other modules.

---

# 2. MANDATORY PRE-DEVELOPMENT PROJECT INSPECTION

Before changing any source code or database structure, conduct a complete inspection of the existing application.

## 2.1 Inspect the Existing Architecture

Identify and document:

- Frontend framework.
- Backend framework.
- Application entry points.
- Routing structure.
- Existing page components.
- Shared UI components.
- Authentication implementation.
- Role-based access control.
- Database architecture.
- API structure.
- File storage implementation.
- PDF generation implementation.
- Existing notification system.
- Audit trail implementation.
- Existing validation and calculation engines.

## 2.2 Inspect Existing Modules

Review all relevant existing modules, including:

- Dashboard.
- Equipment Library.
- Registered Equipment.
- Calibration Records.
- Calibration Scheduling.
- Validation Records.
- Qualification Records.
- Instrument Performance Verification.
- Reports.
- Document Management.
- Audit Trail.
- User Management.
- System Configuration.

Identify existing functionality that can be reused or extended.

## 2.3 Inspect Existing Database Structures

Inspect the actual database schemas and relationships.

Determine:

- Existing equipment tables.
- Existing calibration tables.
- Existing validation tables.
- Existing protocol-related structures.
- Existing approval records.
- Existing document records.
- Existing audit records.
- Existing foreign-key relationships.
- Existing database migrations.
- Existing SQLite and Supabase compatibility requirements.

Verify the actual deployed schema rather than relying exclusively on frontend models or cached schema information.

## 2.4 Mandatory Preservation Requirements

The existing application is operational and must be preserved.

STRICTLY PROHIBITED:

- Deleting existing functionality.
- Replacing existing modules unnecessarily.
- Creating a separate application.
- Creating a parallel equipment database.
- Deleting historical records.
- Removing existing database columns without an approved migration strategy.
- Breaking existing calibration workflows.
- Breaking existing validation workflows.
- Changing existing authentication without necessity.
- Creating duplicate equipment records.
- Overwriting approved historical records.
- Replacing existing working components with incomplete alternatives.

Implement this module as an extension of the existing application.

All database changes must use safe, documented, backward-compatible migrations.

---

# 3. MAIN APPLICATION PAGE: PROTOCOL MANAGEMENT

Create a new main navigation page named:

**Protocol Management**

This page must serve as the central management interface for all equipment protocols.

The page must be fully integrated into the existing application navigation, layout, authentication, and permission system.

## 3.1 Main Sections

The Protocol Management page must contain:

1. Protocol Dashboard.
2. Protocol Registry.
3. Create New Protocol.
4. Protocol Builder.
5. Reference Library.
6. Review & Approval Center.
7. Protocol Revision History.
8. Protocol Execution History.
9. Protocol Documents & Reports.
10. Protocol Settings.

## 3.2 User Interface Requirements

- All interface text must be in professional English.
- Use the existing application design system.
- Maintain consistent typography and spacing.
- Support desktop, tablet, and mobile screens.
- Use responsive tables and dialogs.
- Provide clear validation messages.
- Provide searchable and filterable records.
- Avoid unnecessary navigation complexity.
- Maintain consistent status indicators.
- Support keyboard and touch interaction.

Do not introduce a separate visual design that conflicts with the existing application.

---

# 4. PROTOCOL DASHBOARD

Create a dashboard displaying the current status of all protocols.

## 4.1 Dashboard Statistics

Include:

- Total Protocols.
- Draft Protocols.
- Pending Technical Review.
- Technical Changes Required.
- Pending QA Approval.
- QA Changes Required.
- Approved Protocols.
- Released Protocols.
- Superseded Protocols.
- Retired Protocols.
- Protocols Due for Review.
- Protocols with Expired References.
- Protocols with Pending Technical Verification.
- Protocols with Open Technical Gaps.

## 4.2 Dashboard Functionality

- Statistics must be calculated from actual database records.
- Do not use hardcoded values.
- Clicking a statistic must open the corresponding filtered registry.
- Provide filters by equipment category, protocol type, status, and date.
- Display recently created protocols.
- Display recently approved protocols.
- Display recently released protocols.
- Display upcoming protocol review dates.
- Display unresolved technical issues.

---

# 5. PROTOCOL REGISTRY

Create a comprehensive registry containing all protocols.

## 5.1 Protocol Information

Each protocol record must support:

| Field | Description |
|---|---|
| Protocol ID | Unique internal identifier |
| Protocol Number | Controlled document number |
| Protocol Title | Official protocol title |
| Description | Protocol description |
| Equipment Category | Equipment classification |
| Equipment Type | Equipment type |
| Manufacturer | Equipment manufacturer |
| Model | Equipment model |
| Equipment ID | Linked registered equipment, when applicable |
| Protocol Type | Calibration, IQ, OQ, PQ, Validation, etc. |
| Intended Use | Identification, Quantitative, Both, or custom |
| Reference Standards | Applicable references |
| Revision | Current revision |
| Status | Protocol lifecycle status |
| Created By | Protocol author |
| Technical Reviewer | Assigned technical reviewer |
| QA Approver | Assigned QA approver |
| Effective Date | Controlled effective date |
| Next Review Date | Next scheduled review |

## 5.2 Registry Functions

Provide:

- Search by protocol number.
- Search by protocol title.
- Search by equipment name.
- Search by manufacturer.
- Search by model.
- Filter by equipment category.
- Filter by protocol type.
- Filter by status.
- Filter by revision.
- Filter by author.
- Filter by approval date.
- Filter by review date.
- Sorting.
- Pagination.
- Protocol detail view.
- Protocol revision history access.
- PDF preview and controlled download.

Use actual database records.

---

# 6. EQUIPMENT LIBRARY AND REGISTERED EQUIPMENT INTEGRATION

Protocol Management must integrate directly with the existing Equipment Library and Registered Equipment modules.

Do not create a second equipment catalog.

## 6.1 Equipment Library Integration

When creating a protocol:

- Retrieve existing equipment categories.
- Retrieve equipment types.
- Retrieve manufacturers.
- Retrieve models.
- Retrieve applicable equipment specifications.
- Reuse existing equipment identifiers and relationships.
- Avoid unnecessary manual duplication.

## 6.2 Registered Equipment Integration

Allow protocols to be associated with:

- One equipment model.
- A technically compatible equipment family.
- One specific registered equipment item.
- Multiple registered equipment items when compatibility is justified.

## 6.3 Protocol Association Types

Support two main association types.

### A. Model-Level Protocol

A reusable protocol designed for a particular manufacturer and model or a technically justified equipment family.

It may be associated with multiple registered devices of the same compatible model.

### B. Equipment-Specific Protocol

A protocol specifically configured for an individual registered equipment item.

This may be necessary when equipment-specific characteristics or intended uses require different test methods or criteria.

## 6.4 Compatibility Verification

Before linking a protocol to equipment, verify:

- Manufacturer.
- Model.
- Measurement principle.
- Intended use.
- Measurement range.
- Relevant configuration.
- Applicable specifications.

Never assume that different equipment models share identical acceptance criteria.

## 6.5 Synchronization Rules

- Equipment Library remains the authoritative source of equipment definitions.
- Registered Equipment remains the authoritative source of individual equipment identities.
- Protocol Management stores protocol definitions and their equipment relationships.
- Equipment updates must not silently modify approved protocol content.
- Equipment retirement must not delete associated protocol history.
- Historical protocol execution records must remain accessible.

---

# 7. GENERIC PROTOCOL BUILDER

Develop a flexible, reusable Protocol Builder.

This is the central functional component of the module.

Authorized users must be able to create different equipment protocols without requiring developers to write custom code for every new equipment model.

The builder must support dynamic sections, dynamic tests, configurable fields, different measurement structures, calculations, references, and acceptance criteria.

## 7.1 Protocol Identification

Include:

- Protocol Title.
- Protocol Number.
- Protocol Description.
- Protocol Category.
- Equipment Category.
- Equipment Type.
- Manufacturer.
- Model.
- Equipment ID, when applicable.
- Intended Use.
- Protocol Type.
- Revision Number.
- Author.
- Creation Date.
- Applicable Department.
- Applicable Standards.
- Applicable SOPs.

## 7.2 Protocol Purpose and Scope

Provide configurable fields for:

- Purpose.
- Scope.
- Responsibilities.
- Definitions.
- Abbreviations.
- Equipment Description.
- Intended Application.
- Required Qualifications.
- Required Materials.
- Required Reference Standards.
- Environmental Conditions.
- Safety Requirements.

## 7.3 Dynamic Protocol Sections

Allow authorized authors to add, edit, reorder, and configure protocol sections.

Suggested sections include:

1. Purpose.
2. Scope.
3. Responsibilities.
4. References.
5. Definitions and Abbreviations.
6. Equipment Description.
7. Required Materials and Standards.
8. Environmental Conditions.
9. Safety Requirements.
10. Design Qualification.
11. Installation Qualification.
12. Operational Qualification.
13. Performance Qualification.
14. Calibration Tests.
15. Performance Verification.
16. Validation Activities.
17. Acceptance Criteria.
18. Deviation Management.
19. Final Assessment.
20. Attachments.
21. Approval Signatures.

Not all sections are mandatory for every protocol.

The author must be able to configure the structure according to equipment type and applicable standards.

## 7.4 Section Management

Each section must support:

- Section ID.
- Section Title.
- Section Description.
- Section Order.
- Required or Optional status.
- Applicable Protocol Stage.
- Reference Links.
- Attachments.
- Revision History.

Approved protocol sections must be immutable.

Changes must create a new protocol revision.

---

# 8. DYNAMIC TEST BUILDER

Allow authorized users to create an unlimited practical number of configurable tests within each protocol.

Each test must be independent and configurable.

## 8.1 Test Configuration Fields

Support:

- Test ID.
- Test Name.
- Test Description.
- Test Objective.
- Test Category.
- Qualification Stage.
- Test Method.
- Test Procedure.
- Applicable Reference.
- Reference Section or Clause.
- Required Materials.
- Required Instruments.
- Required Reference Standards.
- Measurement Parameter.
- Measurement Unit.
- Nominal Value.
- Target Value.
- Lower Acceptance Limit.
- Upper Acceptance Limit.
- Tolerance.
- Number of Readings.
- Number of Replicates.
- Number of Test Levels.
- Measurement Conditions.
- Calculation Method.
- Acceptance Formula.
- Required Evidence.
- Required Attachments.
- Test Notes.

## 8.2 Supported Test Data Types

The test builder must support:

- Numeric Values.
- Text Values.
- Boolean Values.
- Dates.
- Times.
- Single Selection.
- Multiple Selection.
- Measurement Series.
- Calculated Values.
- Reference Comparisons.
- Attachments.
- Images.
- Certificates.

## 8.3 Flexible Reading Configuration

Reading counts must be configurable independently for every test.

Examples:

- Test A: 3 readings.
- Test B: 5 readings.
- Test C: 10 readings.
- Test D: 3 levels with 5 readings per level.
- Test E: One measurement at each of several operating conditions.

Do not force all tests to have the same number of readings.

## 8.4 Multi-Level Tests

Support:

- Multiple test levels.
- Multiple measurement points.
- Multiple replicates at each level.
- Different nominal values per level.
- Different acceptance limits per level when justified.
- Independent result calculations.
- Overall test assessment.

## 8.5 Test Dependencies

Allow tests to be:

- Independent.
- Sequential.
- Conditional.
- Dependent on another test result.

For example, a test may only be performed if a preceding qualification test passes.

The dependency rules must be explicitly configured and traceable.

---

# 9. CALCULATION ENGINE

Implement a configurable calculation engine.

The engine must support common scientific and metrological calculations without assuming that every test requires every calculation.

## 9.1 Supported Calculations

Include:

- Average.
- Minimum.
- Maximum.
- Range.
- Standard Deviation.
- Relative Standard Deviation (RSD).
- Absolute Error.
- Percentage Error.
- Percentage Difference.
- Bias.
- Repeatability.
- Linearity.
- Measurement Difference.
- Other configurable mathematical formulas.

## 9.2 Calculation Configuration

Each calculation must support:

- Formula Name.
- Formula Definition.
- Input Parameters.
- Output Parameter.
- Measurement Unit.
- Rounding Rules.
- Significant Figures.
- Applicable Test.
- Formula Revision.
- Reference or Justification.

## 9.3 Calculation Integrity

- Validate inputs before calculation.
- Prevent division by zero.
- Handle missing values correctly.
- Avoid silently treating missing measurements as zero.
- Preserve original measurements.
- Preserve calculated outputs.
- Store the formula used.
- Store the calculation timestamp.
- Store the calculation engine version where applicable.
- Allow results to be reproduced.

Never silently modify an approved calculation formula.

A formula change must be controlled through protocol revision management.

---

# 10. ACCEPTANCE CRITERIA MANAGEMENT

Create a dynamic acceptance criteria engine.

Acceptance criteria must be configurable according to the actual requirements applicable to each equipment type and test.

## 10.1 Reference Sources

Acceptance criteria may originate from:

1. Pharmacopoeial requirements.
2. International standards.
3. Manufacturer specifications.
4. Reference material certificates.
5. External calibration certificates.
6. Approved institutional procedures.
7. Validated technical methods.
8. Documented risk-based institutional requirements.

## 10.2 Acceptance Criteria Fields

Each criterion must include:

- Criterion ID.
- Test ID.
- Parameter.
- Acceptance Requirement.
- Lower Limit.
- Upper Limit.
- Target Value.
- Tolerance.
- Measurement Unit.
- Comparison Method.
- Calculation Formula.
- Applicable Reference.
- Reference Edition.
- Reference Section or Clause.
- Reference Type.
- Technical Justification.
- Verification Status.
- Approval Status.
- Effective Revision.

## 10.3 Acceptance Criterion Classification

Clearly distinguish:

- Regulatory Requirement.
- Pharmacopoeial Requirement.
- Manufacturer Specification.
- Reference Material Specification.
- External Calibration Requirement.
- Institutional Requirement.
- Risk-Based Proposal.

## 10.4 Mandatory Technical Rules

NEVER invent acceptance criteria.

NEVER assume that a criterion from one model applies to another model.

NEVER represent an internal proposal as a regulatory requirement.

NEVER claim compliance without verified evidence.

If a criterion cannot be verified, mark it:

`PENDING TECHNICAL VERIFICATION`

If two references conflict, display the conflict and require technical assessment.

Every acceptance criterion must have a traceable source or documented technical justification.

---

# 11. CENTRAL REFERENCE LIBRARY

Create a centralized Reference Library.

This library must be reusable across all protocols.

## 11.1 Supported Reference Types

- Pharmacopoeias.
- International Standards.
- Manufacturer Manuals.
- Manufacturer Technical Specifications.
- Calibration Certificates.
- Reference Material Certificates.
- Internal SOPs.
- Institutional Procedures.
- Regulatory Guidance.
- Technical Publications.
- Validated Methods.
- Other Controlled Documents.

## 11.2 Reference Information

Each reference must contain:

- Reference ID.
- Reference Title.
- Issuing Organization.
- Reference Type.
- Document Number.
- Edition.
- Revision.
- Publication Date.
- Effective Date.
- Expiry Date, if applicable.
- Review Date.
- Source URL.
- Uploaded Document.
- Applicable Section.
- Applicable Clause.
- Verification Status.
- Verification Date.
- Verified By.
- Notes.

## 11.3 Reference Selection Interface

Inside the Protocol Builder, provide a reference-selection control next to relevant fields and acceptance criteria.

When selected, open a searchable reference dialog.

Users must be able to:

- Search references.
- Filter by reference type.
- View reference details.
- Preview uploaded documents where supported.
- Select a reference.
- Identify the relevant section or clause.
- Add a new reference if authorized.

## 11.4 Reference Traceability

Every linked reference must be traceable to the specific protocol section, test, or acceptance criterion it supports.

Do not simply attach a long reference list without identifying which requirement each reference supports.

## 11.5 Reference Version Control

When a protocol is approved, preserve the exact reference metadata and revision used.

If a reference is updated:

- Do not silently update approved protocols.
- Identify affected protocols.
- Identify the previous reference revision.
- Flag affected protocols for review.
- Allow controlled revision initiation.

Do not claim that a reference is current unless its edition and status have been verified.

---

# 12. QUALIFICATION AND PROTOCOL TYPES

The system must support different protocol types through configurable templates.

## 12.1 Supported Protocol Types

Include:

- Design Qualification (DQ).
- Installation Qualification (IQ).
- Operational Qualification (OQ).
- Performance Qualification (PQ).
- Calibration Protocol.
- Performance Verification Protocol.
- Periodic Verification Protocol.
- Requalification Protocol.
- Cleaning Validation Protocol, where applicable.
- Process Validation Protocol, where applicable.
- Computerized System Validation Protocol, where applicable.
- Custom Protocol.

These types must be configurable.

## 12.2 Qualification Stage Management

Each protocol must allow the author to select applicable stages.

Do not assume that all equipment requires DQ, IQ, OQ, and PQ.

The required stages must depend on:

- Equipment criticality.
- Intended use.
- Equipment complexity.
- Measurement function.
- Regulatory requirements.
- Manufacturer recommendations.
- Risk assessment.
- Institutional procedures.

## 12.3 Risk-Based Qualification

Allow documented risk assessments using factors such as:

- Product Quality Impact.
- Patient Safety Impact, where relevant.
- Measurement Criticality.
- Equipment Complexity.
- Failure Probability.
- Historical Performance.
- Maintenance History.
- Intended Use.
- Regulatory Impact.

Store the risk assessment and its justification.

Do not automatically assign qualification requirements without a documented basis.

---

# 13. CALIBRATION, PQ, AND REVIEW INTERVAL MANAGEMENT

Provide a configurable interval management section.

Support independent intervals for:

- External Calibration.
- Internal Calibration.
- Performance Verification.
- PQ.
- Requalification.
- Periodic Review.
- Reference Standard Verification.

## 13.1 Interval Fields

Each interval must include:

- Activity Type.
- Interval Value.
- Interval Unit.
- Initial Proposed Interval.
- Applicable Reference.
- Risk Assessment.
- Technical Justification.
- Responsible Department.
- Approval Status.
- Effective Date.
- Next Due Date.

Support:

- Days.
- Weeks.
- Months.
- Years.
- Event-Based Intervals.

## 13.2 Interval Control

Allow:

- Equipment-specific intervals.
- Model-level intervals.
- Risk-based interval proposals.
- Documented interval adjustments.
- Controlled interval approval.
- Interval revision history.
- Due-date calculation.
- Upcoming activity alerts.
- Overdue activity alerts.

Never change an approved interval without formal review and approval.

Clearly distinguish mandatory intervals from institutional proposals.

---

# 14. PROTOCOL REVIEW AND APPROVAL WORKFLOW

Implement a controlled sequential approval process.

The required approval sequence is:

1. Protocol Author.
2. Technical Specialist Review.
3. Quality Assurance Final Review and Approval.
4. Controlled Protocol Release.

## 14.1 Stage One: Draft Preparation

The author creates and configures the protocol.

Status:

`DRAFT`

The author may edit the protocol while it remains in Draft status.

## 14.2 Stage Two: Technical Specialist Review

The protocol is submitted to the assigned Technical Specialist.

The Technical Specialist must be able to:

- Review all sections.
- Review tests.
- Review methods.
- Verify acceptance criteria.
- Verify references.
- Review calculations.
- Review measurement configurations.
- Identify technical gaps.
- Add comments.
- Request corrections.
- Return the draft.
- Record technical review completion.

Possible statuses:

- Pending Technical Review.
- Technical Review in Progress.
- Technical Changes Required.
- Technically Reviewed.

The technical reviewer must provide an authenticated review record.

## 14.3 Stage Three: Quality Assurance Review

After technical review, submit the protocol to QA.

QA must be able to:

- Review the complete protocol.
- Verify document control.
- Verify reference traceability.
- Review technical comments.
- Verify correction closure.
- Review revision information.
- Review acceptance criteria traceability.
- Approve or reject the protocol.
- Return it for correction.

Possible statuses:

- Pending QA Approval.
- QA Review in Progress.
- QA Changes Required.
- QA Approved.
- QA Rejected.

## 14.4 Stage Four: Controlled Release

After both required approvals:

The protocol may proceed to controlled release.

Status:

`RELEASED`

Record:

- Protocol Number.
- Revision.
- Release Date.
- Effective Date.
- Released By.
- Technical Reviewer.
- QA Approver.
- Approval Timestamps.
- Electronic Signatures.
- Document Control Status.

## 14.5 Mandatory Approval Rules

- Technical review must precede QA approval.
- QA approval must not be bypassed.
- Backend authorization is mandatory.
- Frontend status changes cannot constitute approval.
- Approval must be linked to an authenticated user.
- Approval timestamps must be preserved.
- Approval records must be immutable.
- Approved revisions must be immutable.
- Changes after approval require a new revision.
- Passing calculations do not automatically approve protocols.
- Draft protocols must not be available for routine execution.
- Approved but unreleased protocols must not be represented as released.

---

# 15. PROTOCOL REVISION AND DOCUMENT CONTROL

Implement complete revision management.

## 15.1 Revision Information

Each revision must contain:

- Protocol ID.
- Protocol Number.
- Revision Number.
- Revision Date.
- Revision Description.
- Change Reason.
- Prepared By.
- Technical Reviewer.
- QA Approver.
- Approval Date.
- Release Date.
- Effective Date.
- Status.

## 15.2 Revision Lifecycle

Support:

- Draft.
- Under Technical Review.
- Under QA Review.
- Approved.
- Released.
- Superseded.
- Retired.

## 15.3 Revision Rules

- Never overwrite approved revisions.
- Never delete approved revisions.
- Preserve all historical versions.
- Record every modification.
- Record the reason for every change.
- Identify modified sections.
- Identify modified tests.
- Identify modified acceptance criteria.
- Identify modified formulas.
- Identify modified references.
- Preserve previous reference snapshots.

## 15.4 Revision Comparison

Provide a comparison interface showing differences between revisions.

Highlight:

- Added sections.
- Removed sections.
- Modified sections.
- Added tests.
- Removed tests.
- Modified tests.
- Changed reading counts.
- Changed formulas.
- Changed acceptance criteria.
- Changed references.
- Changed intervals.

## 15.5 Historical Execution Protection

Every execution must remain linked to the exact protocol revision used at the time.

Releasing a new revision must not modify historical execution records.

---

# 16. INTEGRATION WITH EXISTING CALIBRATION AND VALIDATION MODULES

Protocol Management must integrate with the existing Calibration and Validation workflows.

## 16.1 Protocol Selection

When an authorized user starts a calibration, qualification, or verification activity:

1. Identify the selected equipment.
2. Retrieve compatible released protocols.
3. Display available protocol numbers.
4. Display applicable revisions.
5. Verify equipment compatibility.
6. Allow the authorized user to select a protocol.
7. Create an execution record linked to that exact revision.

Do not display Draft or unreleased protocols as available routine execution protocols.

## 16.2 Dynamic Execution Forms

The execution form must retrieve its structure from the selected protocol revision.

Automatically load:

- Protocol sections.
- Test names.
- Test descriptions.
- Test methods.
- Required reading counts.
- Measurement units.
- Nominal values.
- Acceptance limits.
- Calculation formulas.
- Required evidence.
- Applicable references.

Do not duplicate acceptance criteria in the execution interface.

## 16.3 Measurement Recording

For each test:

- Display the configured number of readings.
- Display required measurement units.
- Validate input types.
- Prevent submission when mandatory readings are missing.
- Calculate results using the approved formula.
- Display calculated values.
- Evaluate results against approved criteria.
- Preserve original measurements.
- Record user identity and timestamp.
- Support comments.
- Support attachments.
- Support deviations.

## 16.4 Execution Results

Support:

- PASS.
- FAIL.
- INCOMPLETE.
- NOT APPLICABLE.
- UNDER REVIEW.

A calculated PASS must not automatically mean formal approval.

The existing authorized execution approval process must remain in control.

## 16.5 Execution Traceability

Each execution must preserve:

- Equipment ID.
- Protocol ID.
- Protocol Number.
- Protocol Revision.
- Reference Snapshot.
- Acceptance Criteria Snapshot.
- Formula Snapshot.
- Execution Date.
- Executed By.
- Reviewer.
- Approver.
- Final Result.

---

# 17. PROTOCOL PDF GENERATOR

Create a universal PDF generator for all protocol types.

The PDF must be generated from the exact protocol revision.

## 17.1 Required PDF Content

Include:

1. Organization Header.
2. Protocol Title.
3. Protocol Number.
4. Revision Number.
5. Equipment Information.
6. Purpose.
7. Scope.
8. Responsibilities.
9. Definitions.
10. References.
11. Required Materials.
12. Environmental Conditions.
13. Qualification Sections.
14. Test Procedures.
15. Measurement Tables.
16. Acceptance Criteria.
17. Calculation Methods.
18. Deviation Management.
19. Final Assessment.
20. Technical Specialist Review.
21. QA Approval.
22. Document Control Information.

## 17.2 PDF Design Requirements

- Professional scientific appearance.
- Consistent typography.
- Clear table formatting.
- Appropriate page margins.
- Page numbering.
- Header and footer.
- Controlled document identification.
- Revision identification.
- Signature areas.
- A4 printing compatibility.
- Multi-page support.
- No clipped tables.
- No missing content.
- No duplicated content.

## 17.3 Document Status

Draft PDF:

`DRAFT – NOT APPROVED`

Approved but unreleased documents must be clearly distinguished from released controlled documents.

Released PDFs must display:

- Controlled Document Status.
- Protocol Number.
- Revision.
- Effective Date.
- Approval Information.

---

# 18. FIRST CONFIGURED PROTOCOL: POLARIMETER ADP220

Configure the first protocol using the generic Protocol Builder.

This is a configuration example, not a separate software module.

## 18.1 Protocol Identification

**Protocol Title:**

Polarimeter Qualification and Performance Verification Protocol

**Protocol Number:**

POL-QC-032D

**Related Form:**

QC-032B-01

## 18.2 Equipment Information

- Manufacturer: Bellingham + Stanley.
- Model: ADP220.
- Equipment ID: QC-I-029.
- Serial Number: PE99003.
- Intended Use: Both Identification and Quantitative.
- Proposed PQ Interval: 6 Months.

Verify these values against the existing Equipment Library and Registered Equipment records before implementation.

Do not create duplicate equipment records.

## 18.3 Protocol Tests

Configure applicable tests for:

### Installation Qualification (IQ)

- Equipment Identification.
- Manufacturer and Model Verification.
- Serial Number Verification.
- Installation Conditions.
- Environmental Conditions.
- Required Accessories.
- Documentation Verification.
- Power Supply Verification.
- Installation Records.

### Operational Qualification (OQ)

- Power-On and Startup.
- Display and Controls.
- Measurement Modes.
- Zero Verification.
- Wavelength Verification.
- Temperature Indication.
- Temperature Control.
- Data Output.
- Print Output.
- Operational Functions.

### Performance Qualification (PQ)

- Accuracy of Optical Rotation.
- Repeatability.
- Linearity.
- Temperature Performance.
- Zero Verification.
- Measurement Performance Under Intended Conditions.

The exact applicability and detailed test procedures must be verified against the equipment manual and applicable standards.

## 18.4 Initial Reference Framework

Use the following references as the initial reference framework, subject to verification of the applicable editions and official requirements.

### Reference 1

USP General Chapter <781> – Optical Rotation.

https://doi.org/10.31003/USPNF_M99570_02_01

### Reference 2

USP General Chapter <1058> – Analytical Instrument Qualification.

https://doi.org/10.31003/USPNF_M1124_01_01

### Reference 3

Bellingham + Stanley ADP220/ADS220 Operator's Manual.

- Code: 36-102.
- Issue: 3.1.
- Date: February 2004.

### Reference 4

Applicable reference material certificates, quartz control plate certificates, CRM certificates, and external calibration certificates.

The actual certificate values must be entered from verified documents.

Do not invent certificate values.

## 18.5 Initial Technical Values

The following are initial reference values from the previously reviewed documentation and must be verified before protocol approval.

| Parameter | Initial Value | Source Classification |
|---|---|---|
| Nominal Wavelength | 589 nm | Manufacturer Documentation |
| Reference Temperature | 25°C, where applicable | Applicable Pharmacopoeial Conditions |
| Temperature Control | ±0.5°C, subject to applicable requirements | Pharmacopoeial Reference |
| Temperature Indication | ±0.1°C or better, subject to applicable requirements | Pharmacopoeial Reference |
| ADP220 Angular Accuracy | ±0.02° | Reviewed Manufacturer Manual |
| ADP220 Angular Resolution | 0.01° | Reviewed Manufacturer Manual |
| Initial PQ Interval | 6 months | Institutional Risk-Based Proposal |
| Initial External Calibration Interval | 12 months | Institutional Proposal |
| Initial Linearity Review Interval | 12 months | Institutional Proposal |

Do not automatically approve these values.

Each value must retain its source classification and verification status.

## 18.6 Mandatory Accuracy Compatibility Gap

The reviewed ADP220 manual specifies angular accuracy of ±0.02°.

The previously reviewed USP <781> requirement indicates an accuracy capability of ±0.01° or better.

This creates a technical compatibility gap.

The system must:

1. Display both specifications.
2. Identify their respective sources.
3. Display the numerical difference.
4. Flag the compatibility issue.
5. Require documented technical assessment.
6. Record the reviewer decision.
7. Preserve the decision in the protocol revision.
8. Prevent unsupported claims of full USP compliance.

Do not silently modify the manufacturer's specification.

Do not claim full compliance unless the technical assessment and applicable requirements support that conclusion.

## 18.7 Repeatability

Configure at least five replicate readings as the initial proposed test design.

The acceptance limit must be based on a verified applicable source or approved institutional justification.

Do not invent a numerical RSD limit.

If a numerical limit is not available, mark it:

`PENDING TECHNICAL VERIFICATION`

## 18.8 Linearity

Because the intended use includes quantitative measurements, configure a linearity test.

Support:

- Three or more test levels.
- Multiple readings at each level.
- Reference values.
- Measured values.
- Measurement differences.
- Error calculations.
- Graphical representation.
- Configurable acceptance criteria.

Do not impose a universal R² ≥ 0.99 limit without a verified applicable source.

## 18.9 Zero Verification

Configure zero verification according to the manufacturer's instructions and applicable requirements.

Do not invent a numerical zero tolerance.

## 18.10 Temperature Verification

Support comparison against a traceable reference thermometer.

Record:

- Instrument Temperature.
- Reference Temperature.
- Difference.
- Acceptance Limit.
- Reference Thermometer ID.
- Calibration Certificate Number.
- Certificate Validity.
- Measurement Date.
- Measurement Conditions.

## 18.11 Initial Interval Proposals

Configure the following as initial institutional proposals only:

- PQ: 6 months.
- External Calibration: 12 months.
- Linearity Review: 12 months or after significant change.

All intervals must undergo documented risk-based review and approval.

Do not present these intervals as mandatory USP requirements.

## 18.12 Approval

The Polarimeter protocol must follow the same centralized approval workflow:

1. Technical Specialist Review.
2. Quality Assurance Final Review and Approval.
3. Controlled Protocol Release.

The protocol must remain in Draft status until the required review and approval steps are completed.

---

# 19. DATABASE ARCHITECTURE AND DATA MODEL

Extend the existing database architecture.

Do not create a parallel data model if existing tables can be extended safely.

The following are suggested logical entities, not mandatory table names:

- protocols
- protocol_revisions
- protocol_sections
- protocol_equipment_models
- protocol_equipment_links
- protocol_tests
- protocol_test_fields
- protocol_measurement_configurations
- protocol_acceptance_criteria
- protocol_calculations
- protocol_references
- protocol_reference_snapshots
- protocol_approvals
- protocol_review_comments
- protocol_interval_settings
- protocol_change_history
- protocol_execution_links
- protocol_attachments

Use existing project naming conventions and relationships.

## 19.1 Database Requirements

- Stable primary keys.
- Foreign-key relationships.
- Referential integrity.
- Unique protocol identifiers where required.
- Revision-specific records.
- Historical data preservation.
- Transaction-safe approval operations.
- Appropriate indexes.
- Backend validation.
- Safe deletion policies.
- Clear migration history.

## 19.2 SQLite and Supabase Compatibility

If the project supports both SQLite and Supabase:

- Maintain compatibility with both.
- Implement safe migrations.
- Verify the actual deployed schema.
- Keep backend queries consistent with the actual database.
- Preserve existing synchronization behavior.
- Handle Supabase schema cache updates where required.
- Test database operations in both supported environments.

Never remove a field from an application payload merely to bypass a schema mismatch.

First determine whether the database schema or application model is incorrect, then implement the appropriate migration or code correction.

---

# 20. ROLE-BASED ACCESS CONTROL

Integrate with the existing user and permission system.

Suggested permission structure:

| Role | Permissions |
|---|---|
| Administrator | Manage authorized protocol settings and configuration |
| Protocol Author | Create and edit draft protocols |
| Technical Specialist | Review technical content |
| QA Reviewer | Perform final QA review and approval |
| Calibration Personnel | View released protocols and execute applicable activities |
| Validation Personnel | View released protocols and execute applicable activities |
| Read-Only User | View authorized protocol records |

Map these permissions to the actual existing application roles.

## 20.1 Security Requirements

- Enforce permissions on the backend.
- Do not rely only on frontend visibility.
- Prevent unauthorized approval.
- Prevent unauthorized release.
- Prevent modification of approved revisions.
- Prevent unauthorized deletion.
- Protect attachments.
- Protect electronic approval records.
- Preserve user identity in audit records.

---

# 21. AUDIT TRAIL AND ALCOA+ DATA INTEGRITY

Integrate all protocol activities with the existing Audit Trail.

Record:

- Protocol Creation.
- Protocol Modification.
- Section Addition.
- Section Modification.
- Test Addition.
- Test Modification.
- Acceptance Criteria Modification.
- Formula Modification.
- Reference Addition.
- Reference Update.
- Review Submission.
- Review Comments.
- Approval.
- Rejection.
- Release.
- Revision.
- Retirement.
- Interval Changes.
- Equipment Association Changes.
- PDF Generation.

Each audit event must contain:

- User ID.
- User Name.
- Action.
- Record Type.
- Record ID.
- Previous Value, where applicable.
- New Value, where applicable.
- Timestamp.
- Change Reason.
- Protocol Revision.

## 21.1 ALCOA+ Requirements

Support:

- Attributable.
- Legible.
- Contemporaneous.
- Original.
- Accurate.
- Complete.
- Consistent.
- Enduring.
- Available.

Preserve original measurements.

Prevent silent modification of approved records.

Ensure that changes are attributable to authenticated users.

---

# 22. NOTIFICATIONS AND TASK MANAGEMENT

Integrate with the existing notification system.

Support notifications for:

- Protocol Submitted for Technical Review.
- Technical Review Completed.
- Technical Changes Requested.
- Protocol Submitted for QA.
- QA Approval Completed.
- QA Changes Requested.
- QA Rejection.
- Protocol Released.
- New Revision Created.
- Protocol Review Due.
- Reference Revision Detected.
- Protocol Affected by Reference Change.
- Technical Gap Requiring Review.
- Protocol Retirement.

Notifications must:

- Be role-aware.
- Link to the relevant record.
- Avoid duplicates.
- Respect existing notification preferences.
- Record notification status where supported.

---

# 23. UNIVERSAL PROTOCOL TEMPLATES

Provide a template system to accelerate future protocol creation.

## 23.1 Template Types

Support reusable templates for:

- Analytical Instruments.
- Physical Testing Equipment.
- Temperature Monitoring Equipment.
- Measuring Instruments.
- Laboratory Utility Equipment.
- Production Equipment.
- Computerized Systems.
- Custom Equipment Categories.

## 23.2 Template Rules

Templates may include:

- Suggested sections.
- Suggested tests.
- Suggested data fields.
- Suggested measurement structures.
- Suggested calculations.
- Suggested reference categories.

However:

Templates must not automatically impose unverified acceptance limits.

Every new protocol must be reviewed for its actual manufacturer, model, intended use, and applicable standards.

Templates are starting structures, not automatically approved protocols.

---

# 24. ERROR HANDLING AND SYSTEM RELIABILITY

Implement appropriate validation and error handling.

Requirements:

- Prevent duplicate submissions.
- Prevent invalid protocol status transitions.
- Prevent incomplete approval operations.
- Prevent broken equipment relationships.
- Prevent invalid revision references.
- Handle missing reference documents.
- Handle failed PDF generation.
- Handle database transaction failures.
- Preserve entered draft information after recoverable errors.
- Display clear and useful error messages.
- Log technical failures without exposing sensitive information.

Use transactions for critical operations such as approval, release, and revision creation.

---

# 25. TESTING AND VALIDATION REQUIREMENTS

Do not declare the module complete until actual testing has been performed.

## 25.1 Functional Testing

Test the following:

1. Create a protocol.
2. Save a draft.
3. Reopen a draft.
4. Edit a draft.
5. Add protocol sections.
6. Reorder sections.
7. Add tests.
8. Configure different reading counts.
9. Configure multi-level measurements.
10. Configure calculations.
11. Configure acceptance criteria.
12. Add references.
13. Link references to tests.
14. Save and retrieve the complete protocol.
15. Submit for technical review.
16. Return for correction.
17. Resubmit.
18. Complete technical review.
19. Submit to QA.
20. Approve through QA.
21. Release the protocol.
22. Verify approved revision immutability.
23. Create a new revision.
24. Compare revisions.
25. Retire a protocol.
26. Generate a PDF.
27. Select a released protocol for execution.
28. Verify execution traceability.

## 25.2 Integration Testing

Verify:

- Equipment Library integration.
- Registered Equipment integration.
- Calibration integration.
- Validation integration.
- Qualification integration.
- PDF generation.
- Audit Trail integration.
- Notification integration.
- User permission integration.
- SQLite compatibility.
- Supabase compatibility, if applicable.

## 25.3 Security Testing

Verify:

- Unauthorized users cannot approve.
- Unauthorized users cannot release.
- Draft protocols cannot be used for routine execution.
- Approved revisions cannot be edited.
- Historical records cannot be overwritten.
- Approval order cannot be bypassed.
- Backend authorization works independently of frontend controls.

## 25.4 Data Integrity Testing

Verify:

- Reference snapshots remain unchanged.
- Historical protocol revisions remain accessible.
- Execution records retain their original revision.
- Original measurements remain unchanged.
- Calculations are reproducible.
- Audit records are complete.
- Database migrations preserve existing records.

---

# 26. IMPLEMENTATION PHASES

Implement the module in controlled phases.

## PHASE 1 – EXISTING PROJECT INSPECTION

- Inspect the complete application.
- Inspect database schemas.
- Inspect relevant modules.
- Identify reusable components.
- Identify integration points.
- Document compatibility risks.
- Submit an architecture assessment.

Do not begin destructive changes.

## PHASE 2 – DATABASE AND BACKEND FOUNDATION

- Implement required database changes.
- Create safe migrations.
- Implement protocol APIs.
- Implement revision management.
- Implement backend permissions.
- Implement audit trail integration.

## PHASE 3 – PROTOCOL MANAGEMENT INTERFACE

- Create the main Protocol Management page.
- Implement dashboard.
- Implement registry.
- Implement filters and search.
- Implement protocol details.

## PHASE 4 – GENERIC PROTOCOL BUILDER

- Implement dynamic sections.
- Implement dynamic tests.
- Implement configurable fields.
- Implement measurement configuration.
- Implement calculations.
- Implement acceptance criteria.

## PHASE 5 – REFERENCE LIBRARY

- Implement reference records.
- Implement reference search.
- Implement reference linking.
- Implement reference snapshots.
- Implement reference revision tracking.

## PHASE 6 – REVIEW AND APPROVAL

- Implement Technical Specialist Review.
- Implement QA Review.
- Implement controlled approval.
- Implement release workflow.
- Implement revision history.
- Implement immutable approved revisions.

## PHASE 7 – CALIBRATION AND VALIDATION INTEGRATION

- Integrate with existing calibration records.
- Integrate with existing validation records.
- Integrate with qualification activities.
- Implement dynamic execution forms.
- Implement protocol revision traceability.

## PHASE 8 – DOCUMENTS AND REPORTING

- Implement universal PDF generation.
- Implement controlled document status.
- Implement signature areas.
- Implement protocol reports.
- Implement notifications.

## PHASE 9 – POLARIMETER CONFIGURATION

- Configure POL-QC-032D.
- Link the existing ADP220 equipment record.
- Configure applicable tests.
- Add verified references.
- Configure measurement structures.
- Flag unresolved technical criteria.
- Document technical compatibility gaps.
- Keep the protocol in Draft status until formal review and approval.

## PHASE 10 – FINAL TESTING AND DELIVERY

- Execute functional tests.
- Execute integration tests.
- Execute security tests.
- Execute data integrity tests.
- Verify existing application functionality.
- Fix defects.
- Document outstanding limitations.
- Provide final implementation report.

---

# 27. FINAL ACCEPTANCE CRITERIA

The implementation is considered complete only when:

1. A centralized Protocol Management page exists.
2. It supports all equipment categories.
3. It is not Polarimeter-specific.
4. The generic Protocol Builder works.
5. Equipment Library integration works.
6. Registered Equipment integration works.
7. Model-level protocols are supported.
8. Equipment-specific protocols are supported.
9. Dynamic sections work.
10. Dynamic tests work.
11. Variable reading counts work.
12. Multi-level measurement configurations work.
13. Calculation configuration works.
14. Acceptance criteria are traceable.
15. Reference Library works.
16. Reference snapshots are preserved.
17. Technical review works.
18. QA approval works.
19. Controlled release works.
20. Approved revisions are immutable.
21. Revision history works.
22. Revision comparison works.
23. Calibration integration works.
24. Validation integration works.
25. Qualification integration works.
26. Historical execution traceability works.
27. Universal PDF generation works.
28. Audit Trail integration works.
29. Role-based access control is enforced.
30. Database migrations are safe.
31. Existing functionality remains operational.
32. Polarimeter ADP220 is configured using the generic builder.
33. Unverified acceptance criteria remain flagged.
34. Technical gaps are documented.
35. No unsupported regulatory compliance claims are generated.

---

# 28. FINAL DEVELOPMENT REPORT

After implementation, provide a detailed report containing:

## A. Architecture Assessment

- Existing project structure.
- Existing modules.
- Existing database architecture.
- Reusable components.
- Integration points.
- Compatibility risks.

## B. Implementation Summary

- Files created.
- Files modified.
- Database migrations.
- APIs implemented.
- Components implemented.
- Pages implemented.
- Integrations completed.

## C. Testing Report

For each requirement, provide one of the following:

- PASS – Implemented and tested.
- PARTIAL – Implemented but not fully verified.
- FAIL – Not implemented or failed testing.
- NOT APPLICABLE – Not relevant.

Include actual test evidence where available.

## D. Outstanding Issues

Document:

- Known limitations.
- Unresolved technical issues.
- Missing references.
- Pending acceptance criteria.
- Deployment requirements.
- Required institutional decisions.

Never claim that a feature has been tested unless the test was actually executed.

Never claim regulatory compliance merely because a reference has been added.

---

# 29. NON-NEGOTIABLE FINAL INSTRUCTIONS

1. Build one centralized Protocol Management system.
2. Use one generic Protocol Builder for all equipment types.
3. Do not create separate protocol pages for individual equipment models.
4. Treat Polarimeter ADP220 as the first configured example only.
5. Integrate with existing Equipment Library and Registered Equipment.
6. Integrate with existing Calibration and Validation modules.
7. Preserve all existing application functionality.
8. Preserve all historical data.
9. Never invent acceptance criteria.
10. Never invent reference certificate values.
11. Distinguish regulatory requirements from manufacturer specifications and institutional proposals.
12. Require Technical Specialist review.
13. Require final QA approval.
14. Require controlled protocol release.
15. Keep approved revisions immutable.
16. Preserve exact protocol revision traceability for every execution.
17. Enforce authorization on the backend.
18. Maintain complete audit trail and ALCOA+ data integrity.
19. Use safe database migrations.
20. Do not claim successful implementation without actual verification.

**FINAL OBJECTIVE:**

Create a professional, scientifically structured, scalable, and fully integrated centralized Protocol Management System that becomes the single controlled source for equipment protocols throughout the existing Calibration & Validation Management System.

The system must allow authorized personnel to create and approve protocols for any current or future equipment using the same universal architecture, while maintaining scientific traceability, controlled document management, technical review, QA approval, data integrity, and complete historical accountability.

**Preserve the existing application. Extend it safely. Do not replace it.**