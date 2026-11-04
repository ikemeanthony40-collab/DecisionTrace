# Requirements Document

## Introduction

DecisionTrace is a web application that evaluates case submissions against a written policy document, explains each finding with traceable evidence, identifies missing information, and routes uncertain cases to human review. The initial demonstration uses fictional grant eligibility policies.

DecisionTrace is a decision-support tool. It assists administrators and reviewers in making policy-based decisions; it does not replace professional judgment or legal advice.

The minimum viable product (MVP) covers the core evaluation pipeline: policy ingestion, case submission, deterministic rule evaluation, a decision record with evidence, a review queue, and an audit history. AI-assisted rule extraction is identified as a post-MVP enhancement that requires separate provider access and configuration approval before implementation begins.

---

## Glossary

- **Policy**: A plain-text document pasted by an Administrator that describes eligibility rules, thresholds, and conditions used to evaluate cases.
- **Policy_Rule**: A single condition or threshold extracted from a Policy and stored in structured form, linked to the source passage from which it was derived.
- **Policy_Version**: An immutable snapshot of a Policy document taken at the time of each Case evaluation, identified by the Policy's unique identifier and a version counter.
- **Rule_Snapshot**: An immutable copy of a Policy_Rule's definition (including its Evidence_Passage, type, operator, and threshold) captured at evaluation time and stored alongside the Decision_Record.
- **Case**: A structured submission entered by a user that contains all fields relevant to evaluating eligibility under a Policy.
- **Case_Field**: A named attribute of a Case (for example, applicant age, funding amount requested, submission date) with a declared type of text, number, or date.
- **Evaluator**: The backend module that applies Policy_Rules deterministically to a Case and produces a Decision_Record.
- **Decision_Record**: The structured output of an evaluation, containing the recommendation, individual rule results, supporting evidence passages drawn from Rule_Snapshots, missing information, and escalation reasons.
- **Recommendation**: One of three machine-generated verdicts produced by the Evaluator: APPROVED, DENIED, or ESCALATED.
- **Rule_Result**: The outcome of evaluating a single Policy_Rule against a Case, recording PASS, FAIL, or MISSING_INFO.
- **Evidence_Passage**: A verbatim excerpt from the Policy that supports a specific Rule_Result, stored in the Rule_Snapshot at evaluation time.
- **Missing_Field**: A Case_Field that is required by a Policy_Rule but was not supplied in the Case submission.
- **Escalation**: The routing of a Case to human review because the Evaluator cannot produce a confident APPROVED or DENIED verdict.
- **Escalation_Reason**: A structured explanation attached to an ESCALATED Recommendation identifying which Missing_Fields, Extracted_Rule items, or ambiguous conditions triggered escalation.
- **Review_Action**: An action taken by a Reviewer on a Decision_Record: APPROVE or OVERRIDE, accompanied by a mandatory reason.
- **Reviewer**: An authorized user who can examine escalated or completed Decision_Records and record Review_Actions.
- **Administrator**: A user who can paste Policy documents and configure Case field definitions.
- **Audit_Entry**: An append-only record of an evaluation event or Review_Action, stored in chronological order and never exposed to deletion or update through any application API.
- **Dashboard**: The main landing page of the application, showing summary counts and navigation to all major sections.
- **Review_Queue**: The list of Decision_Records with a Recommendation of ESCALATED that are awaiting a Review_Action.
- **Audit_History**: The chronological list of all Audit_Entries.
- **Rule_Extraction**: The process of converting Policy text into structured Policy_Rules. In the MVP this is performed manually by the Administrator; AI-assisted extraction is a post-MVP enhancement.
- **Extracted_Rule**: A Policy_Rule that has been parsed from Policy text but not yet verified by a Reviewer. Displayed with a distinct visual indicator. Evaluations that include any Extracted_Rule are automatically ESCALATED.
- **Validated_Rule**: A Policy_Rule that a Reviewer has confirmed is an accurate representation of the Policy text. Only Validated_Rules may contribute to APPROVED or DENIED recommendations.
- **SQLite**: The local relational database used for persistence in the MVP.
- **JWT**: JSON Web Token used for session authentication.

---

## Requirements

### Requirement 1: Dashboard

**User Story:** As an Administrator or Reviewer, I want a clear professional dashboard, so that I can see the current state of the system and navigate to all major sections without confusion.

#### Acceptance Criteria

1. THE Dashboard SHALL display the count of active Policy documents, total Cases submitted, pending Review_Queue items, and a link to the Audit_History.
2. THE Dashboard SHALL provide navigation links to: Policy management, Case submission, Review Queue, and Audit History.
3. WHEN the application loads, THE Dashboard SHALL render completely within 3 seconds on a standard broadband connection.
4. THE Dashboard SHALL be responsive and usable on screen widths between 360 px and 1920 px.
5. IF no Policy document has been ingested, THEN THE Dashboard SHALL display a visible prompt directing the Administrator to add a Policy.
6. THE Dashboard SHALL display a visible indicator of the count of Extracted_Rule items that have not yet been validated, so that the trust boundary between verified and unverified rules is immediately apparent.

---

### Requirement 2: Policy Ingestion

**User Story:** As an Administrator, I want to paste a policy document into the application, so that the system can use it as the basis for evaluating cases.

#### Acceptance Criteria

1. THE Policy_Ingestion_Form SHALL accept a plain-text policy document of up to 50 000 characters pasted into a multi-line text area.
2. WHEN the Administrator submits a Policy, THE System SHALL store the Policy text with a unique identifier, a version counter, a submission timestamp, and the submitting user's identifier.
3. IF the submitted Policy text is empty or contains only whitespace, THEN THE System SHALL reject the submission and display a descriptive validation error.
4. IF the submitted Policy text exceeds 50 000 characters, THEN THE System SHALL reject the submission and display a message stating the limit.
5. THE System SHALL support at least one active Policy at any time.
6. WHEN a new Policy is submitted, THE System SHALL record an Audit_Entry for the ingestion event.
7. THE Policy_Ingestion_Form SHALL display the currently active Policy text for reference.
8. WHEN a Policy is updated or replaced, THE System SHALL NOT alter any Decision_Record that was generated under a previous Policy_Version; each Decision_Record retains its Policy_Version identifier and the Rule_Snapshots captured at evaluation time.

---

### Requirement 3: Policy Rule Management

**User Story:** As an Administrator, I want to define and manage Policy_Rules linked to source passages, so that the Evaluator can apply them deterministically to cases.

#### Acceptance Criteria

1. THE Rule_Editor SHALL allow an Administrator to create a Policy_Rule by specifying: a rule name, the rule type (required-field, numeric-threshold, or date-condition), the target Case_Field name, the comparison operator and threshold value (for numeric and date types), and the verbatim Evidence_Passage from the Policy.
2. WHEN a Policy_Rule is created, THE System SHALL store it with status Extracted_Rule.
3. WHEN a Reviewer marks a Policy_Rule as verified, THE System SHALL change its status to Validated_Rule.
4. THE Rule_Editor SHALL display Extracted_Rule items with a distinct visual indicator differentiating them from Validated_Rule items.
5. THE System SHALL allow an Administrator to update or delete a Policy_Rule that has not yet been used in any evaluation.
6. IF an Administrator attempts to delete a Policy_Rule that has been used in at least one evaluation, THEN THE System SHALL retire the rule (marking it inactive) rather than permanently deleting it, and SHALL display an explanation that the rule has been retired to preserve historical Decision_Records.
7. THE System SHALL NOT allow saving a Policy_Rule whose Evidence_Passage is absent from the active Policy text.
8. WHEN a Policy_Rule is created, updated, or retired, THE System SHALL record an Audit_Entry for the change.
9. WHEN a Policy_Rule that has been used in at least one evaluation is edited, THE System SHALL create a new version of the rule and retire the previous version, so that existing Decision_Records continue to reference their original Rule_Snapshots unchanged.

---

### Requirement 4: Case Submission

**User Story:** As a user, I want to enter case details using a form, so that the system can evaluate the case against the active Policy.

#### Acceptance Criteria

1. THE Case_Submission_Form SHALL render an input field for each Case_Field defined under the active Policy, labelled with the field name and declared type.
2. THE Case_Submission_Form SHALL list any Case_Fields required by at least one Policy_Rule that the user has left blank, as an informational notice, so that the user is aware of absent fields before submitting; this notice SHALL NOT prevent submission.
3. WHEN a Case is submitted, THE System SHALL accept the submission regardless of whether required fields are absent; absent required fields are a rule evaluation concern handled by the Evaluator, not a submission gate.
4. WHEN a Case is submitted, THE System SHALL pass the Case to the Evaluator and return a Decision_Record within 5 seconds.
5. THE System SHALL assign each submitted Case a unique identifier and a submission timestamp.
6. IF a Case_Field is declared as type number and the submitted value cannot be parsed as a finite number, THEN THE System SHALL display a field-level validation error and prevent submission.
7. IF a Case_Field is declared as type date and the submitted value does not conform to ISO 8601 format (YYYY-MM-DD), THEN THE System SHALL display a field-level validation error and prevent submission.
8. WHEN a Case is successfully submitted, THE System SHALL record an Audit_Entry for the submission event.
9. THE Case_Submission_Form SHALL include a set of pre-filled sample cases demonstrating the fictional grant eligibility policy, selectable from a dropdown.

---

### Requirement 5: Deterministic Rule Evaluation

**User Story:** As a user, I want the system to evaluate my case against each Policy_Rule deterministically, so that I receive consistent, traceable results.

#### Acceptance Criteria

1. WHEN a Case is evaluated, THE Evaluator SHALL capture an immutable Rule_Snapshot for each active Policy_Rule and store those snapshots alongside the Decision_Record before applying any rule logic.
2. THE Evaluator SHALL apply every active Policy_Rule to the Case and record a Rule_Result of PASS, FAIL, or MISSING_INFO for each rule.
3. WHEN evaluating a required-field rule, THE Evaluator SHALL record PASS if the field is present and non-empty, FAIL if the field is present but empty, and MISSING_INFO if the field is absent from the Case.
4. WHEN evaluating a numeric-threshold rule, THE Evaluator SHALL record PASS if the field value satisfies the comparison operator and threshold, FAIL if it does not, and MISSING_INFO if the field is absent or non-numeric.
5. WHEN evaluating a date-condition rule, THE Evaluator SHALL record PASS if the date field satisfies the comparison operator and reference date, FAIL if it does not, and MISSING_INFO if the field is absent or not a valid ISO 8601 date.
6. THE Evaluator SHALL attach the Evidence_Passage from the Rule_Snapshot (not the live Policy_Rule record) to every Rule_Result.
7. THE Evaluator SHALL NOT fabricate or infer an Evidence_Passage; every Evidence_Passage in a Rule_Result MUST be the verbatim text stored in the corresponding Rule_Snapshot.
8. WHEN all Rule_Results are PASS and every rule used in the evaluation is a Validated_Rule, THE Evaluator SHALL set the Recommendation to APPROVED.
9. WHEN at least one Rule_Result is FAIL, no Rule_Result is MISSING_INFO, and every rule used in the evaluation is a Validated_Rule, THE Evaluator SHALL set the Recommendation to DENIED.
10. WHEN at least one Rule_Result is MISSING_INFO, THE Evaluator SHALL set the Recommendation to ESCALATED and include an Escalation_Reason identifying each Missing_Field.
11. WHEN any rule used in the evaluation is an Extracted_Rule (status not yet Validated_Rule), THE Evaluator SHALL set the Recommendation to ESCALATED and include an Escalation_Reason stating that unverified rules were used, regardless of whether all rule conditions would otherwise pass or fail.
12. THE Evaluator SHALL be executable independently of any external AI service or network connection.

---

### Requirement 6: Decision Record

**User Story:** As a user or Reviewer, I want to view a complete Decision_Record for each evaluated case, so that I can understand the recommendation and trace every finding to its source.

#### Acceptance Criteria

1. THE Decision_Record_View SHALL display: the Case identifier, submission timestamp, the Policy_Version identifier used at evaluation time, the overall Recommendation, and a per-rule breakdown.
2. THE per-rule breakdown SHALL show, for each Rule_Snapshot: the rule name, the Rule_Result (PASS, FAIL, or MISSING_INFO), and the verbatim Evidence_Passage captured in the Rule_Snapshot at evaluation time.
3. THE Decision_Record_View SHALL list all Missing_Fields identified during evaluation.
4. WHEN the Recommendation is ESCALATED, THE Decision_Record_View SHALL display each Escalation_Reason (missing fields, unverified rules, or ambiguous conditions) clearly and separately.
5. THE Decision_Record_View SHALL visually distinguish PASS, FAIL, and MISSING_INFO results using colour and iconography so that the status is conveyed without relying on colour alone.
6. IF the Decision_Record includes any Rule_Results derived from Extracted_Rule snapshots, THEN THE Decision_Record_View SHALL display those results in a clearly labelled "Unverified findings" section and SHALL display a prominent notice that some rules used in this evaluation had not been verified at the time of evaluation; these findings SHALL NOT be presented as authoritative.
7. WHEN a Review_Action has been recorded against a Decision_Record, THE Decision_Record_View SHALL display the reviewer's verdict, reason, and the timestamp of the action.
8. WHEN the active Policy or any Policy_Rule is updated after a Decision_Record was generated, THE Decision_Record_View SHALL continue to display the original Policy_Version identifier and the original Evidence_Passages from the Rule_Snapshots, not the updated values.
9. THE Decision_Record_View SHALL be printable to PDF via the browser's print function; the print output SHALL preserve all decision findings, Rule_Snapshot Evidence_Passages, review actions, and timestamps and SHALL remain readable across multiple pages if the content requires it.

---

### Requirement 7: Review Queue

**User Story:** As a Reviewer, I want a queue of escalated cases, so that I can examine, approve, or override each recommendation and record my reasoning.

#### Acceptance Criteria

1. THE Review_Queue SHALL list all Decision_Records with a Recommendation of ESCALATED, ordered by submission timestamp ascending (oldest first).
2. THE Review_Queue SHALL display for each item: the Case identifier, submission timestamp, and each Escalation_Reason.
3. WHEN a Reviewer selects a queued item, THE System SHALL display the full Decision_Record_View alongside a Review_Action form.
4. THE Review_Action_Form SHALL require the Reviewer to select a verdict of APPROVE or OVERRIDE and enter a non-empty reason of at least 10 characters before submission.
5. WHEN a Reviewer submits a Review_Action, THE System SHALL record the verdict, reason, reviewer identifier, and timestamp against the Decision_Record.
6. WHEN a Review_Action is submitted, THE System SHALL remove the Decision_Record from the Review_Queue and record an Audit_Entry.
7. THE Review_Queue SHALL update without a full page reload after a Review_Action is submitted.
8. WHEN the Review_Queue is empty, THE System SHALL display a message confirming that no items are pending review.

---

### Requirement 8: Audit History

**User Story:** As an Administrator or Reviewer, I want an append-only audit history of all evaluations and review actions, so that I can trace every decision back to its inputs and actors.

#### Acceptance Criteria

1. THE Audit_History_View SHALL display all Audit_Entries in reverse chronological order.
2. EACH Audit_Entry SHALL record: the event type (policy-ingested, rule-created, rule-updated, rule-retired, case-submitted, review-action-taken), the acting user identifier, a timestamp, and a summary of the change.
3. THE Audit_History_View SHALL support filtering by event type and by date range.
4. THE System SHALL NOT expose any Audit_Entry to deletion or modification through any application API; Audit_Entries are append-only through normal application operations.
5. THE System SHALL retain all Audit_Entries for the lifetime of the application database.
6. THE Audit_History_View SHALL display at most 50 entries per page and provide pagination controls for navigating additional pages.

---

### Requirement 9: Authentication and Authorisation

**User Story:** As an Administrator or Reviewer, I want the application to enforce role-based access, so that only authorised users can perform sensitive actions.

#### Acceptance Criteria

1. THE System SHALL require users to authenticate with a username and password before accessing any application feature.
2. THE System SHALL support two roles: Administrator and Reviewer.
3. WHILE a user holds the Administrator role, THE System SHALL permit policy ingestion, rule creation, rule updates, and rule retirement.
4. WHILE a user holds the Reviewer role, THE System SHALL permit viewing Decision_Records, submitting Review_Actions, and marking Policy_Rules as Validated_Rule.
5. IF an unauthenticated request is made to any protected API endpoint, THEN THE System SHALL return HTTP 401 and redirect the client to the login page.
6. IF an authenticated user attempts an action outside their role, THEN THE System SHALL return HTTP 403 and display a descriptive error message.
7. THE System SHALL store passwords using a one-way cryptographic hash (bcrypt with cost factor 12 or higher) and SHALL NOT store plaintext passwords.
8. THE System SHALL issue session tokens as JWTs with an expiry of no more than 8 hours.
9. THE System SHALL NOT store secrets or API keys in source control.
10. THE Repository SHALL include a seed script (npm run seed) that reads Administrator and Reviewer credentials from a .env file and creates exactly one account of each role; the seed script SHALL be committed to the repository but the .env file containing credentials SHALL NOT be committed.
11. THE System SHALL NOT provide public user registration, password-reset workflows, or a role-management UI in the MVP; all account management is performed through the seed script.

---

### Requirement 10: Error Handling and Resilience

**User Story:** As a user, I want clear and actionable error messages, so that I can recover from problems without losing my work.

#### Acceptance Criteria

1. WHEN a backend API request fails, THE System SHALL display a human-readable error message that does not expose internal stack traces or database details.
2. WHEN a form submission fails validation, THE System SHALL highlight each invalid field with a descriptive inline error and preserve the user's input.
3. IF the SQLite database is unavailable at startup, THEN THE System SHALL log the error to the console and display a maintenance notice on the frontend.
4. THE System SHALL return HTTP 400 for malformed request payloads and HTTP 500 for unhandled server errors, each with a JSON error body containing a machine-readable code and a human-readable message.
5. WHEN a network timeout occurs during Case evaluation, THE System SHALL display a timeout message and preserve the submitted Case data for resubmission.

---

### Requirement 11: Automated Testing

**User Story:** As a developer, I want a comprehensive automated test suite, so that I can verify rule evaluation, missing-field detection, trust-boundary enforcement, historical immutability, and all demonstration scenarios before each release.

#### Acceptance Criteria

1. THE Test_Suite SHALL include unit tests for the Evaluator covering: required-field PASS, required-field FAIL, required-field MISSING_INFO, numeric-threshold PASS, numeric-threshold FAIL, numeric-threshold MISSING_INFO, date-condition PASS, date-condition FAIL, and date-condition MISSING_INFO.
2. THE Test_Suite SHALL include a test asserting that the Evaluator sets Recommendation to APPROVED only when all Rule_Results are PASS and every rule used is a Validated_Rule.
3. THE Test_Suite SHALL include a test asserting that the Evaluator sets Recommendation to DENIED when at least one Rule_Result is FAIL, none are MISSING_INFO, and every rule used is a Validated_Rule.
4. THE Test_Suite SHALL include a test asserting that the Evaluator sets Recommendation to ESCALATED whenever at least one Rule_Result is MISSING_INFO.
5. THE Test_Suite SHALL include a test asserting that the Evaluator sets Recommendation to ESCALATED when any rule used in the evaluation is an Extracted_Rule, even if all rule conditions would otherwise produce PASS or FAIL results.
6. THE Test_Suite SHALL include a test asserting that every Evidence_Passage in a Rule_Result exactly matches the verbatim text stored in the corresponding Rule_Snapshot (no fabrication, no reference to the live Policy_Rule record).
7. THE Test_Suite SHALL include a test asserting that submitting a Case with one or more absent required fields is accepted by the submission layer and produces a Decision_Record with Recommendation ESCALATED (absent required fields must NOT block submission).
8. THE Test_Suite SHALL include a test asserting that after a Policy_Rule's Evidence_Passage is updated, all previously generated Decision_Records continue to display the original Evidence_Passage from their Rule_Snapshots, not the updated value.
9. THE Test_Suite SHALL include tests for Review_Action validation: rejection of an empty reason, rejection of a reason shorter than 10 characters, and acceptance of a valid reason.
10. THE Test_Suite SHALL include at least one automated test covering each of the five demonstration scenarios: (a) APPROVED outcome with all Validated_Rules passing and no missing fields; (b) DENIED outcome with at least one Validated_Rule failing and no missing fields; (c) ESCALATED outcome due to at least one absent required field; (d) a Reviewer submitting a Review_Action with a recorded reason on an escalated case; (e) historical immutability verified by confirming that an existing Decision_Record displays its original Policy_Version and Rule_Snapshot Evidence_Passages after the active policy has been updated.
11. THE Test_Suite SHALL be executable with a single command (pnpm test) that runs without network access or external AI service calls.
12. THE Repository SHALL include a README section with step-by-step instructions for installing dependencies and running the Test_Suite on Windows.
13. WHEN the Test_Suite is run, THE System SHALL report the number of tests passed, failed, and skipped, and exit with code 0 only when all tests pass.

---

### Requirement 12: Sample Data and Demonstration Scenarios

**User Story:** As a developer or evaluator, I want the application to ship with fictional sample data covering all key demonstration scenarios, so that I can explore the system without entering real personal information and can showcase every outcome type.

#### Acceptance Criteria

1. THE System SHALL include fictional sample Cases that produce each of the following five demonstration outcomes when submitted against the pre-loaded fictional grant eligibility Policy: (a) APPROVED — all applicable Validated_Rules pass and no required fields are absent; (b) DENIED — at least one Validated_Rule fails and no required fields are absent; (c) ESCALATED due to missing information — at least one required field is absent from the Case; (d) a case ready for human review — an ESCALATED Decision_Record with a pre-recorded Review_Action showing the reviewer's verdict and reason; (e) historical immutability — a Decision_Record generated before a subsequent policy update, displaying its original Policy_Version identifier and original Rule_Snapshot Evidence_Passages.
2. THE Sample_Cases SHALL use entirely fictional names, organisations, and figures; no real personal data SHALL be included in the repository.
3. THE System SHALL include one fictional grant eligibility Policy pre-loaded at first run, with at least five Policy_Rules covering required-field, numeric-threshold, and date-condition rule types; at least one Policy_Rule SHALL have status Extracted_Rule and at least one SHALL have status Validated_Rule to demonstrate the trust boundary.
4. THE System SHALL NOT collect, store, or transmit real personal information beyond what is necessary to identify and track fictional Case submissions.

---

## Resolved Technical Decisions

The following technical choices have been made for the MVP and are binding on the implementation:

- **Test runner**: Vitest for both frontend and backend unit and integration tests.
- **PDF output**: Browser print-to-PDF via `window.print` and print CSS; no additional PDF library is required.
- **Frontend routing**: React Router with HTML5 history mode, served by the Vite development server.
- **User provisioning**: Seed script (`npm run seed`) that reads Administrator and Reviewer credentials from a `.env` file; the script is committed to the repository and the `.env` file is listed in `.gitignore`.
- **AI integration**: Deferred entirely to post-MVP; no AI code shall appear in the MVP implementation.

---

## Beginner-Friendly Implementation Notes

The following conventions apply to the MVP implementation and are chosen to minimise setup friction for developers new to the stack:

- **Repository structure**: Single monorepo using pnpm workspaces with `packages/frontend` and `packages/backend` directories.
- **Frontend**: Vite + React + TypeScript.
- **Backend**: Node.js + Express + better-sqlite3.
- **Testing**: Vitest for all tests (frontend and backend); tests run with `pnpm test` (single execution, no watch mode).
- **Windows compatibility**: All setup and test commands must work on Windows PowerShell without additional Unix tools. The README must include step-by-step Windows setup instructions covering Node.js installation, pnpm installation, dependency installation, database seeding, and running the development server.

---

## Out of Scope (Post-MVP)

The following features are explicitly deferred and MUST NOT be implemented during the MVP:

- AI-assisted Rule_Extraction
- Multi-Policy evaluation (evaluating a Case against more than one active Policy simultaneously)
- Public user registration
- Password-reset workflows
- Role-management UI
- Export formats beyond browser print-to-PDF
- Email or webhook notifications
- Real-time collaboration
