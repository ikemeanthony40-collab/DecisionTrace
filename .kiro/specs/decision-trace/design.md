# Design Document — DecisionTrace

## Overview

DecisionTrace is a Node.js/Express backend that evaluates case submissions against a structured policy's rules, produces an immutable decision record with per-rule evidence, and routes uncertain cases to a human review queue. All business logic is deterministic and self-contained; no external AI or network service is required at runtime.

This document describes the **currently implemented** backend. Features that are designed but not yet implemented are clearly marked **Proposed**.

---

## Architecture

### Technology Stack

| Layer | Technology | Status |
|---|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) | Implemented |
| Framework | Express 5 | Implemented |
| Language | TypeScript 5 | Implemented |
| Database | SQLite via `better-sqlite3` ^13.0.3 | Implemented |
| Auth | `jsonwebtoken` ^9.0.3 + `bcryptjs` ^3.0.3 | Implemented |
| Validation | `zod` ^4.6.7 | Implemented |
| Test runner | Vitest ^3.2.4 | Implemented |
| Dev runner | `tsx` | Implemented |
| Property-based testing | `fast-check` | **Proposed** — not installed |

> **Proposed (requires dependency approval):** Property-based testing with `fast-check` is recommended for the Evaluator but `fast-check` is not currently installed. Adding it requires updating `packages/backend/package.json` and obtaining approval before implementation. The primary test plan uses only Vitest with manually written test cases.

### Data Flow — Case Submission

```
HTTP POST /api/decisions
        |
        v
  requireAuthentication  (Bearer -> req.user)
        |
        v
  submitSchema.safeParse(req.body)
  { policyId: UUID, applicantData: Record<string, unknown> }
        |
        v
  submitCase(input)  <- decision.repository.ts
        |
        +- SELECT policies WHERE id=:policyId
        |     -> 404 if not found, 409 if status != 'active'
        |
        +- SELECT policy_rules WHERE policy_version_id=:policyId AND status!='retired'
        |
        +- evaluateDecision(rules, applicantData)  <- decision.service.ts (pure)
        |
        +- db.transaction()
              INSERT cases
              INSERT decisions
              INSERT decision_rule_snapshots   (one per non-retired rule)
              INSERT rule_results              (only for rules with a result entry)
              INSERT audit_events ('case-submitted')
        |
        v
  HTTP 201 { decision: SavedDecision }
```

---

## Package Structure

```
packages/backend/
+-- src/                              <- TypeScript sources (tsconfig include: ["src/**/*.ts"])
|   +-- server.ts
|   +-- auth/
|   |   +-- auth.service.ts
|   |   +-- auth.middleware.ts
|   +-- db/
|   |   +-- database.ts               <- better-sqlite3 singleton, DDL, pragmas
|   |   +-- seed.ts                   <- Greenleaf policy seed script
|   +-- decisions/
|   |   +-- decision.service.ts       <- evaluateDecision() pure function
|   |   +-- decision.repository.ts    <- submitCase() with DB persistence
|   |   +-- decision.routes.ts        <- Express router
|   +-- policies/
|       +-- policy.routes.ts          <- Express router
|
+-- tests/                            <- Test files (outside src/ to avoid tsc inclusion)
|   +-- unit/
|   |   +-- decision.service.test.ts
|   +-- integration/
|       +-- submit.test.ts
|       +-- review.test.ts
|
+-- vitest.config.ts                  <- Single Vitest config for this package
+-- data/
|   +-- decisiontrace.sqlite          <- Live database (gitignored; never touched by tests)
+-- tsconfig.json
+-- package.json
```

> **tsconfig constraint:** `tsconfig.json` sets `"include": ["src/**/*.ts"]`. Test files placed under `src/` would be compiled into `dist/` as production artifacts. All test files **must** live under `packages/backend/tests/`.

---

## Components and Interfaces

### `evaluateDecision(rules, applicantData)` — `decision.service.ts`

**Status: Implemented**

Pure function. No I/O. Takes the non-retired rules for a policy and the applicant's key-value data. Returns a `DecisionEvaluation` object.

```typescript
interface DecisionEvaluation {
  recommendation: 'APPROVED' | 'DENIED' | 'ESCALATED';
  escalationReasons: string[];
  ruleResults: RuleEvaluation[];
}

interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  status: 'PASS' | 'FAIL' | 'MISSING_INFO';
  observedValue: unknown;
  explanation: string;
}
```

### `submitCase(input)` — `decision.repository.ts`

**Status: Implemented**

Orchestrates a case submission: loads the policy and its non-retired rules, calls `evaluateDecision`, and persists all results in a single transaction.

```typescript
interface SubmitCaseInput {
  policyId: string;
  applicantData: Record<string, unknown>;
  submittedBy: string | null;
}
```

### `requireAuthentication` middleware — `auth.middleware.ts`

**Status: Implemented**

Extracts and verifies the Bearer JWT. Sets `req.user = { id, username, role }`. Returns HTTP 401 on failure.

### `requireRole(...roles)` middleware — `auth.middleware.ts`

**Status: Implemented**

Checks `req.user.role` against the allowed roles list. Returns HTTP 403 on mismatch.

### Express Routers

**Status: Implemented**

- `decisionRouter` — mounted at `/api/decisions`
- `policyRouter` — mounted at `/api/policies`
- Auth routes mounted directly on the app at `/api/auth/login`, `/api/auth/me`

---

## Data Models

### TypeScript Interfaces

```typescript
// policies table
interface Policy {
  id: string;
  policy_key: string;
  version: number;
  title: string;
  policy_text: string;
  status: 'active' | 'retired';
  created_by: string | null;
  created_at: string;
}

// policy_rules table
interface PolicyRule {
  id: string;
  logical_rule_id: string;
  version: number;
  policy_version_id: string;
  name: string;
  rule_type: 'required-field' | 'numeric-threshold' | 'date-condition';
  target_field: string;
  operator: 'required' | '>=' | '<=' | '>' | '<' | '=' | '!=';
  threshold_json: string | null;
  evidence_passage: string;
  status: 'extracted' | 'validated' | 'retired';
  predecessor_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// decisions table
interface Decision {
  id: string;
  case_id: string;
  policy_version_id: string;
  recommendation: 'APPROVED' | 'DENIED' | 'ESCALATED';
  escalation_reasons_json: string;
  created_at: string;
}

// decision_rule_snapshots table
interface DecisionRuleSnapshot {
  id: string;
  decision_id: string;
  source_rule_id: string;
  logical_rule_id: string;
  rule_version: number;
  rule_name: string;
  rule_type: string;
  target_field: string;
  operator: string;
  threshold_json: string | null;
  evidence_passage: string;
  rule_status: 'extracted' | 'validated' | 'retired';
}

// rule_results table
interface RuleResult {
  id: string;
  decision_id: string;
  snapshot_id: string;
  result: 'PASS' | 'FAIL' | 'MISSING_INFO';
  observed_value_json: string | null;
  explanation: string;
}

// review_actions table
interface ReviewAction {
  id: string;
  decision_id: string;
  action: 'APPROVE' | 'OVERRIDE';
  reason: string;
  reviewer_id: string;
  created_at: string;
}

// audit_events table
interface AuditEvent {
  id: string;
  event_type:
    | 'policy-ingested' | 'rule-created' | 'rule-validated'
    | 'rule-updated' | 'rule-retired' | 'case-submitted' | 'review-action-taken';
  actor_id: string | null;
  summary: string;
  details_json: string;
  created_at: string;
}
```

### Request/Response Shapes

**POST `/api/decisions`** request body:
```typescript
{ policyId: string; applicantData: Record<string, unknown> }
```

**POST `/api/decisions/:decisionId/review`** request body:
```typescript
{ action: 'APPROVE' | 'OVERRIDE'; reason: string }  // reason.trim().length >= 10
```

**POST `/api/auth/login`** request body:
```typescript
{ username: string; password: string }
```

---

## Database Schema

The schema is created idempotently at startup. Pragmas applied: `foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`.

```sql
-- Users: two roles ('administrator', 'reviewer'). Passwords bcrypt-hashed (cost 12).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('administrator', 'reviewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Policies: versioned by (policy_key, version).
-- At most one version per policy_key may be 'active' (partial unique index below).
-- Policy replacement (retiring old, inserting new) is a PROPOSED operation --
-- no application route currently implements it.
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL,
  policy_text TEXT NOT NULL CHECK (length(trim(policy_text)) > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (policy_key, version)
);

-- Enforces single active version per policy_key at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_version_per_policy
  ON policies(policy_key) WHERE status = 'active';

-- Policy rules: versioned by (logical_rule_id, version).
--
-- Permitted UPDATEs (status transitions only):
--   SET status = 'validated', updated_at = ?   (extracted -> validated)  [Implemented]
--   SET status = 'retired',   updated_at = ?   (extracted/validated -> retired)  [Proposed]
--
-- Data edits (name, rule_type, target_field, operator, threshold_json,
-- evidence_passage) are NEVER made in-place. A data change creates a new
-- row (same logical_rule_id, version+1, status='extracted', predecessor_id=old id)
-- and retires the old row. This is PROPOSED functionality -- no application
-- route currently implements it.
CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  logical_rule_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  policy_version_id TEXT NOT NULL REFERENCES policies(id),
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (
    rule_type IN ('required-field', 'numeric-threshold', 'date-condition')
  ),
  target_field TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (
    operator IN ('required', '>=', '<=', '>', '<', '=', '!=')
  ),
  threshold_json TEXT,
  evidence_passage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('extracted', 'validated', 'retired')),
  predecessor_id TEXT REFERENCES policy_rules(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (logical_rule_id, version)
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  policy_version_id TEXT NOT NULL REFERENCES policies(id),
  applicant_data_json TEXT NOT NULL,
  submitted_by TEXT REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One decision per case. Recommendation and escalation reasons are
-- frozen at evaluation time and NEVER updated.
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES cases(id),
  policy_version_id TEXT NOT NULL REFERENCES policies(id),
  recommendation TEXT NOT NULL CHECK (
    recommendation IN ('APPROVED', 'DENIED', 'ESCALATED')
  ),
  escalation_reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Immutable snapshots of each non-retired rule at evaluation time.
-- Rules with null threshold or unknown type produce a snapshot row
-- but NO corresponding rule_results row (see Evaluator Design).
CREATE TABLE IF NOT EXISTS decision_rule_snapshots (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  source_rule_id TEXT NOT NULL,
  logical_rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  target_field TEXT NOT NULL,
  operator TEXT NOT NULL,
  threshold_json TEXT,
  evidence_passage TEXT NOT NULL,
  rule_status TEXT NOT NULL CHECK (rule_status IN ('extracted', 'validated', 'retired')),
  UNIQUE (decision_id, source_rule_id)
);

-- One result row per rule that produced PASS/FAIL/MISSING_INFO.
-- Rules that only produced escalation reasons (null threshold, unknown type)
-- do NOT have a row here even though their snapshot row exists.
CREATE TABLE IF NOT EXISTS rule_results (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  snapshot_id TEXT NOT NULL REFERENCES decision_rule_snapshots(id),
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL', 'MISSING_INFO')),
  observed_value_json TEXT,
  explanation TEXT NOT NULL
);

-- One review per decision (UNIQUE on decision_id).
-- action = 'APPROVE'  -> "Approved by reviewer"
-- action = 'OVERRIDE' -> "Rejected by reviewer"
-- The machine recommendation in decisions.recommendation is never modified.
CREATE TABLE IF NOT EXISTS review_actions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE REFERENCES decisions(id),
  action TEXT NOT NULL CHECK (action IN ('APPROVE', 'OVERRIDE')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only audit log. No DELETE or UPDATE is ever issued
-- through any application API.
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'policy-ingested', 'rule-created', 'rule-validated',
      'rule-updated', 'rule-retired', 'case-submitted', 'review-action-taken'
    )
  ),
  actor_id TEXT REFERENCES users(id),
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_policy_status ON policy_rules(policy_version_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_submitted ON cases(submitted_at);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
```

---

## Evaluator Design

`evaluateDecision()` in `src/decisions/decision.service.ts` is a **pure function** — it takes rules and applicant data, returns a `DecisionEvaluation`. No I/O.

### Operator Support

> **Important:** The evaluator implements `>=`, `<=`, `>`, and `<` for both `numeric-threshold` and `date-condition` rules. The operators `=` and `!=` are permitted by the database `CHECK` constraint but are **not implemented** in the evaluator — the ternary chain falls through to `false`, producing `FAIL` unconditionally **when the rule is otherwise evaluable** (i.e., value is present and non-missing, and threshold is valid). Tests must verify this actual behaviour, not an assumed intended behaviour.

### Required-Field FAIL — Requirement Gap

> **Requirement clarification required:** Requirements mention PASS, FAIL, and MISSING_INFO for required-field rules. The current evaluator produces:
> - `MISSING_INFO` when `isMissing(value)` is true (undefined, null, or whitespace-only string)
> - `PASS` when the value is present and non-empty
>
> There is **no FAIL branch** for required-field rules in the current implementation. The evaluator does not distinguish "present but explicitly invalid" from "present and valid" for this rule type. Before finalising the required-field tests, it must be clarified whether FAIL is a valid outcome for required-field rules, and if so, what condition triggers it. Tests must not assert a FAIL outcome for required-field rules until this is resolved.

### Evaluation Algorithm

1. Filter retired rules: `activeRules = rules.filter(r => r.status !== 'retired')`.
2. No active rules: push `"No active policy rules are available."` to escalationReasons.
3. For each active rule:
   - a. `status === 'extracted'`: push `"Rule \"<name>\" has not been validated."` to escalationReasons. **Continue processing the rule.**
   - b. `isMissing(value)` (undefined, null, or whitespace-only string): push `MISSING_INFO` result + escalation reason `"Missing information: <field>."`. `continue`.
   - c. `rule_type === 'required-field'`: value is present and non-empty, so push `PASS` result. `continue`. *(No FAIL outcome exists — see Required-Field FAIL gap above.)*
   - d. `threshold = parseThreshold(threshold_json)`. If `threshold === null || threshold === undefined`: push escalation reason `"Rule \"<name>\" has no usable threshold."`. `continue`. **No rule_result entry pushed.**
   - e. `rule_type === 'numeric-threshold'`:
     - `!isStrictNumber(value) || !isStrictNumber(threshold)`: push escalation reason + `MISSING_INFO` result.
     - Otherwise: apply operator (`>=`, `<=`, `>`, `<`; others produce `false`) -> `PASS` or `FAIL`.
   - f. `rule_type === 'date-condition'`:
     - `!isRealIsoDate(value) || !isRealIsoDate(threshold)`: push escalation reason + `MISSING_INFO` result.
     - Otherwise: lexicographic comparison with same operator chain -> `PASS` or `FAIL`.
   - g. Unknown `rule_type`: push escalation reason `"Rule \"<name>\" uses an unsupported rule type."`. **No rule_result entry pushed.**
4. `recommendation`:
   - `ESCALATED` if `escalationReasons.length > 0` OR any result is `MISSING_INFO`.
   - `DENIED` if any result is `FAIL` (no escalation condition applies).
   - `APPROVED` otherwise.
5. De-duplicate escalation reasons with `[...new Set(...)]`.

### Snapshot Without Rule_Result

Two paths produce a `decision_rule_snapshots` row with **no** corresponding `rule_results` row:

| Path | Trigger | Snapshot created? | Rule result created? |
|---|---|---|---|
| Null/missing threshold | `threshold_json = null` for a numeric or date rule | Yes | **No** |
| Unknown rule_type | `rule_type` not in the three known values | Yes | **No** |

The repository inserts a snapshot for every non-retired rule unconditionally. It then calls `resultsByRuleId.get(rule.id)` — if the evaluator did not push a ruleResult for that rule, the `Map` lookup returns `undefined` and no `rule_results` row is inserted.

### Helper Functions

| Function | Behaviour |
|---|---|
| `isMissing(v)` | `true` if `undefined`, `null`, or `typeof string && trim().length === 0` |
| `isStrictNumber(v)` | `true` if `typeof v === 'number' && Number.isFinite(v)` |
| `isRealIsoDate(v)` | `true` if string, matches `/^\d{4}-\d{2}-\d{2}$/`, and round-trips through `new Date(v + 'T00:00:00.000Z').toISOString().slice(0,10) === v` |
| `parseThreshold(json)` | `JSON.parse(json)` — throws `"A rule contains invalid threshold data."` if malformed |

### Recommendation Truth Table

| escalationReasons non-empty | MISSING_INFO result exists | FAIL result exists | Recommendation |
|---|---|---|---|
| Yes | any | any | ESCALATED |
| No | Yes | any | ESCALATED |
| No | No | Yes | DENIED |
| No | No | No | APPROVED |

---

## Transaction Boundaries (Implemented)

### Case Submission

```
db.transaction():
  INSERT cases
  INSERT decisions
  INSERT decision_rule_snapshots   (N rows -- one per non-retired rule)
  INSERT rule_results              (<= N rows -- only rules with a result entry)
  INSERT audit_events              (event_type: 'case-submitted')
```

### Rule Validation (extracted -> validated)

```
db.transaction():
  UPDATE policy_rules SET status='validated', updated_at=? WHERE id=? AND status='extracted'
  INSERT audit_events (event_type: 'rule-validated')
```

### Review Action

```
db.transaction():
  INSERT review_actions (action, reason, reviewer_id)
  INSERT audit_events   (event_type: 'review-action-taken')
```

**Duplicate review detection:** `better-sqlite3` ^13 raises an error with `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` and `err.message` containing `'UNIQUE constraint failed: review_actions.decision_id'` when a second review is attempted. The route handler translates this specific error to HTTP 409. Any other database error is passed to the global handler (HTTP 500).

```typescript
function isDuplicateReviewError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : '';
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    message.includes('review_actions.decision_id')
  );
}
```

---

## Proposed API Extensions

> **None of the features in this section are implemented.** They describe the intended design for future development.

### Proposed: Policy Version Replacement

The `idx_one_active_version_per_policy` index supports at most one active version per `policy_key`. The intended replacement sequence is:

```
db.transaction():
  UPDATE policies SET status='retired' WHERE id=<old id>   <- deactivate first
  INSERT policies (policy_key, version+1, status='active', ...)
  INSERT audit_events (event_type: 'policy-ingested')
```

No HTTP route implements this. A future `POST /api/policies` endpoint would be required.

### Proposed: Rule Data Edit (versioning)

```
db.transaction():
  INSERT policy_rules (logical_rule_id, version+1, status='extracted',
                       predecessor_id=<old id>, <updated fields>)
  UPDATE policy_rules SET status='retired', updated_at=? WHERE id=<old id>
  INSERT audit_events (event_type: 'rule-updated')
```

No HTTP route implements this. The only currently implemented rule mutation is `extracted -> validated` via `POST /api/policies/:policyId/rules/:ruleId/validate`.

### Proposed: Rule Retirement

```
db.transaction():
  UPDATE policy_rules SET status='retired', updated_at=? WHERE id=?
  INSERT audit_events (event_type: 'rule-retired')
```

---

## API Design (Implemented)

All routes require `Authorization: Bearer <token>` except `/api/auth/login` and `/api/health`.

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | None | `{ username, password }` -> `{ token, tokenType, expiresIn, user }` |
| GET | `/api/auth/me` | Bearer | Returns `{ user }` for the token holder |

### Policies

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/policies` | Bearer | Any | List all policy versions |
| GET | `/api/policies/:policyId` | Bearer | Any | Get one policy + its rules |
| POST | `/api/policies/:policyId/rules/:ruleId/validate` | Bearer | administrator | Transition rule `extracted -> validated`; HTTP 400 if evidence_passage not in policy_text; HTTP 409 if policy not active or rule not extracted |

### Decisions

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/api/decisions` | Bearer | Any | Submit case: `{ policyId, applicantData }`. HTTP 404 policy not found; HTTP 409 policy not active. Returns `{ decision }` HTTP 201 |
| GET | `/api/decisions/review-queue` | Bearer | reviewer | ESCALATED decisions with no review action, oldest first |
| GET | `/api/decisions/history` | Bearer | administrator | All decisions with review joined, newest first |
| POST | `/api/decisions/:decisionId/review` | Bearer | reviewer | `{ action, reason }`. HTTP 404 not found; HTTP 409 not ESCALATED or already reviewed; HTTP 400 reason < 10 chars |
| GET | `/api/decisions/:decisionId` | Bearer | Any | Full decision: row + snapshots + results + review |

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | None | `{ status: 'ok', application: 'DecisionTrace API' }` |

---

## Authentication and Authorization

- JWT signed with `JWT_SECRET` from environment; must be >= 32 characters or the service throws at startup.
- Signing: `{ username, role }` payload, `sub = user.id`, `expiresIn: 28800` (8h), `algorithm: 'HS256'`, `jwtid: randomUUID()`.
- `requireAuthentication`: extracts Bearer token, calls `jwt.verify`, sets `req.user`. HTTP 401 on failure.
- `requireRole(...roles)`: checks `req.user.role` is in `allowedRoles`. HTTP 403 on failure.
- Passwords: bcrypt hash, cost 12. Plaintext never stored.

---

## Historical Traceability

Each `submitCase` call captures an immutable snapshot of every non-retired rule at evaluation time into `decision_rule_snapshots`. These rows are never updated. Future changes to `policy_rules` do not alter existing snapshots.

`GET /api/decisions/:decisionId` joins `decision_rule_snapshots` and `rule_results` to reconstruct the exact evidence and rule states at evaluation time. The `source_rule_id` field links back to the original `policy_rules` row for provenance.

---

## Audit Events

`audit_events` is append-only. No application API exposes DELETE or UPDATE on this table.

| event_type | When created |
|---|---|
| `policy-ingested` | Seed script creates initial policy |
| `rule-created` | (Proposed -- no route yet) |
| `rule-validated` | `POST /api/policies/:policyId/rules/:ruleId/validate` |
| `rule-updated` | (Proposed -- no route yet) |
| `rule-retired` | (Proposed -- no route yet) |
| `case-submitted` | `POST /api/decisions` |
| `review-action-taken` | `POST /api/decisions/:decisionId/review` |

---

## Sample Data and Seed Design

`src/db/seed.ts` creates the **Greenleaf Community Innovation Fund** demo dataset.

### Seeded Rules

| # | logical_rule_id | Type | Field | Operator | threshold_json | Status |
|---|---|---|---|---|---|---|
| 1 | `applicant-age` | numeric-threshold | `applicant_age` | `>=` | `"18"` | validated |
| 2 | `organisation-registered` | required-field | `organisation_registered` | `required` | null | validated |
| 3 | `funding-limit` | numeric-threshold | `funding_amount_requested` | `<=` | `"50000"` | validated |
| 4 | `submission-date` | date-condition | `submission_date` | `>=` | `"\"2025-01-01\""` | validated |
| 5 | `project-description` | required-field | `project_description` | `required` | null | extracted |
| 6 | `impact-statement` | required-field | `impact_statement` | `required` | null | extracted |

### Demo Scenarios

> **Note:** Because rules 5 and 6 are `extracted`, ALL evaluations currently produce `ESCALATED`. To demonstrate `APPROVED` or `DENIED`, rules 5 and 6 must first be validated via `POST /api/policies/:policyId/rules/:ruleId/validate`. The test suite must validate those rules before testing APPROVED or DENIED outcomes.

| Scenario | Key input | Expected recommendation | Notes |
|---|---|---|---|
| A | All fields present and valid | ESCALATED | Rules 5 & 6 are extracted |
| B | `funding_amount_requested = 75000` | ESCALATED | Rule 3 FAIL + extracted rules 5, 6 |
| C | `submission_date` absent | ESCALATED | Rule 4 MISSING_INFO + extracted rules |
| D | All fields present | ESCALATED | Rules 5 & 6 extracted |
| E | Same as C + pre-seeded review | ESCALATED (reviewed) | **Proposed:** seed does not yet insert a pre-seeded `review_actions` row or corresponding `audit_events` row. When implemented, both must be inserted in the same `db.transaction()`. |

---

## Testing Strategy

### Configuration

**Vitest config — `packages/backend/vitest.config.ts`:**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    isolate: true,
    env: {
      DATABASE_PATH: ':memory:',
      JWT_SECRET: 'test-secret-at-least-32-characters-long',
    },
  },
});
```

`packages/backend/package.json` test script: `"test": "vitest run"`.

Root `package.json`: `"test": "pnpm -r --if-present test"`.

### Root `pnpm test` and the Frontend Package

> **Correction 4 — Proposed adjustment:** Running `pnpm test` at the monorepo root executes `pnpm -r --if-present test`, which runs the `test` script in every package that defines one. The frontend `package.json` currently has `"test": "vitest run"`. Because the frontend has no test files, `vitest run` exits with code 1 ("No test files found"), causing the root command to fail even when all backend tests pass.
>
> **Proposed fix (not yet implemented):** Change the frontend test script to `"test": "vitest run --passWithNoTests"`. This allows Vitest to succeed when no test files are found, so the root `pnpm test` only fails if backend tests fail.
>
> This change is required before `pnpm test` can serve as a reliable single root command.

### Database Isolation

> **Verified:** `packages/backend/src/db/database.ts` reads `process.env.DATABASE_PATH ?? "data/decisiontrace.sqlite"` at module load time (confirmed at line 5-7 of that file). Setting `DATABASE_PATH: ':memory:'` in the Vitest `env` configuration directs the database singleton to an in-memory SQLite instance for the duration of the test run.

Because Vitest uses `isolate: true` (fresh module registry per test file), each test file imports `database.ts` afresh and receives its own independent in-memory database. The production file `data/decisiontrace.sqlite` is never read, written, reset, or deleted during tests.

**Limitation within a test file:** All tests within a single file share the same in-memory instance (created once at module load). Tests must use `beforeEach` to set up required rows, or accept that rows created by earlier tests in the same file remain visible to later tests.

**Unit tests of `evaluateDecision`** import only `decision.service.ts`, which has no database dependency. No database isolation is needed for these tests.

### Test File Layout

```
packages/backend/tests/
+-- unit/
|   +-- decision.service.test.ts    <- pure function, no DB
+-- integration/
    +-- submit.test.ts               <- submitCase(), full DB round-trip
    +-- review.test.ts               <- review submission, queue, duplicate
```

### Unit Tests — `decision.service.test.ts`

**Required-field rules:**

> **Requirement gap — must resolve before implementing:** Requirements list PASS, FAIL, and MISSING_INFO for required-field rules. The current evaluator produces only PASS (present non-empty value) or MISSING_INFO (missing/empty/null value). There is no FAIL outcome for required-field rules in the current implementation. The following tests are safe to implement immediately; tests asserting FAIL for required-field rules must wait for clarification.

- Present non-empty value -> PASS
- Field absent from applicantData -> MISSING_INFO
- Field present as null -> MISSING_INFO
- Field present as empty string `""` -> MISSING_INFO
- Field present as whitespace-only string -> MISSING_INFO

**Numeric-threshold rules:**

- Number satisfying `>=` -> PASS
- Number not satisfying `>=` -> FAIL
- Non-numeric string (e.g. `"abc"`) -> MISSING_INFO
- Absent field -> MISSING_INFO
- Operator `=`: value equals threshold, value is present and numeric, threshold is valid -> FAIL (documents actual behaviour: `=` is not implemented, produces FAIL unconditionally under evaluable conditions)
- Operator `!=`: value differs from threshold, value is present and numeric, threshold is valid -> FAIL (same: unimplemented, always FAIL)

**Date-condition rules:**

- Valid ISO date satisfying `>=` -> PASS
- Valid ISO date not satisfying `>=` -> FAIL
- Invalid date string -> MISSING_INFO
- Impossible date `"2025-02-30"` -> MISSING_INFO (fails isRealIsoDate)
- Absent field -> MISSING_INFO

**Recommendations:**

- All PASS, all validated rules -> APPROVED
- At least one FAIL, no MISSING_INFO, all validated -> DENIED
- At least one MISSING_INFO -> ESCALATED
- Any extracted rule -> ESCALATED (even if all conditions pass)
- No active rules -> ESCALATED

**Snapshot-without-result paths:**

- `numeric-threshold` rule with `threshold_json = null` -> escalation reason pushed; ruleResults array has no entry for that rule
- Rule with unknown `rule_type` -> escalation reason pushed; ruleResults array has no entry for that rule

### Integration Tests — `submit.test.ts`

- Valid case, all fields present, all validated rules pass -> HTTP 201, `recommendation: 'APPROVED'` (requires validating rules 5 & 6 first)
- Valid case, one validated rule fails -> HTTP 201, `recommendation: 'DENIED'`
- Missing required field -> HTTP 201, `recommendation: 'ESCALATED'`
- Extracted rule active -> HTTP 201, `recommendation: 'ESCALATED'`
- Policy not found -> HTTP 404
- Policy status `'retired'` -> HTTP 409
- `decision_rule_snapshots` count equals non-retired rule count
- A rule with `threshold_json = null` (numeric-threshold): snapshot row exists, no `rule_results` row for that snapshot
- Rule with unknown type: snapshot row exists, no `rule_results` row

### Integration Tests — `review.test.ts`

- `GET /api/decisions/review-queue` includes ESCALATED decision before review
- `POST /api/decisions/:id/review` with APPROVE + valid reason -> HTTP 201
- After review: `GET /api/decisions/review-queue` does NOT include the decision
- `GET /api/decisions/:id` still returns `recommendation: 'ESCALATED'` with review action attached
- Second POST review for same decision -> HTTP 409
- POST review for non-ESCALATED decision -> HTTP 409
- POST review with reason of 9 trimmed characters -> HTTP 400
- POST review with reason of 10 trimmed characters -> HTTP 201
- POST review unauthenticated -> HTTP 401
- POST review with administrator role -> HTTP 403
- Unrelated DB error during review -> HTTP 500 (not HTTP 409)

---

## Correctness Properties

### Property 1: No active rules always produces ESCALATED

`evaluateDecision` with no active rules -> recommendation is always `ESCALATED`.

**Design invariant:** No acceptance criterion explicitly states this outcome. It follows by exclusion from Requirement 5.8 (APPROVED requires all PASS and all Validated_Rule) and Requirement 5.9 (DENIED requires at least one FAIL and all Validated_Rule) ? neither condition can be satisfied with zero rules.

### Property 2: Any extracted rule always produces ESCALATED

`evaluateDecision` with any extracted rule -> recommendation is always `ESCALATED` regardless of rule outcomes.

**Validates: Requirements 5.11, Requirements 11.5**

### Property 3: Any MISSING_INFO result always produces ESCALATED

`evaluateDecision` with any `MISSING_INFO` result -> recommendation is always `ESCALATED`.

**Validates: Requirements 5.10, Requirements 11.4**

### Property 4: All PASS with all validated rules produces APPROVED

`evaluateDecision` with all `PASS` results and all validated rules -> recommendation is `APPROVED`.

**Validates: Requirements 5.8, Requirements 11.2**

### Property 5: Any FAIL with no MISSING_INFO and all validated produces DENIED

`evaluateDecision` with at least one `FAIL` result, no `MISSING_INFO`, all validated -> recommendation is `DENIED`.

**Validates: Requirements 5.9, Requirements 11.3**

### Property 6: Unimplemented operators produce FAIL for evaluable rules

For `numeric-threshold` and `date-condition` rules where the applicant value is present and non-missing, the value parses as a valid type (number or ISO date), and the threshold is also valid: operators `=` and `!=` produce `FAIL` unconditionally because they are not implemented in the evaluator. This property does not apply to cases where the value or threshold is missing or invalid (those take earlier branches that produce `MISSING_INFO`).

**Implementation gap:** Requirements 5.4 and 5.5 define FAIL as "does not satisfy the comparison operator" but do not enumerate which operators are supported. The `=` and `!=` operators are accepted by the database schema and input validation but fall through to `false` in the evaluator, silently producing FAIL. This documents an observed gap between what the schema permits and what the evaluator handles, not a validated requirement.

### Property 7: Null threshold produces escalation without a rule_result row

A `numeric-threshold` rule with `threshold_json = null` -> escalation reason pushed, no `rule_results` entry.

**Implementation deviation from Requirement 5.2:** Requirement 5.2 states "THE Evaluator SHALL apply every active Policy_Rule to the Case and record a Rule_Result of PASS, FAIL, or MISSING_INFO for each rule." The current implementation skips the `rule_results` row for null-threshold rules, inserting only an escalation reason instead. Skipping the result row is not compliant with Requirement 5.2. A conforming implementation would record `MISSING_INFO` for that rule.

### Property 8: Unknown rule_type produces escalation without a rule_result row

An unknown `rule_type` -> escalation reason pushed, no `rule_results` entry.

**Defensive implementation — no direct requirement:** The requirements define exactly three rule types (required-field, numeric-threshold, date-condition) and do not specify behaviour for any other value. This path is a defensive fallback to prevent silent failures. No acceptance criterion covers it.

### Property 9: Rule snapshots are immutable

`decision_rule_snapshots` are immutable after insert; future rule changes do not alter them.

**Validates: Requirements 5.1, Requirements 6.8, Requirements 11.8**

### Property 10: Machine recommendation is immutable

`decisions.recommendation` is never updated after initial insert; reviewer outcome is stored only in `review_actions.action`.

**Design invariant implied by review and history requirements:** No acceptance criterion explicitly forbids updating `recommendation`. The invariant is implied by Requirement 6.7 (display the reviewer's verdict separately from the recommendation), Requirement 6.8 (continue to display the original recommendation after policy updates), and Requirement 7.5 (record the verdict against the Decision_Record). It is a design invariant, not an explicit acceptance criterion.

### Property 11: Duplicate review action produces HTTP 409

A second review action for the same decision raises `SQLITE_CONSTRAINT_UNIQUE` -> HTTP 409.

**Implementation decision — no direct requirement:** Requirements 7.4 and 7.5 specify that a review action must be recorded, but no acceptance criterion defines the behaviour when a second review is attempted for the same decision. The HTTP 409 response is an implementation decision derived from the UNIQUE constraint on `review_actions.decision_id`.

---

## Error Handling

| Condition | HTTP Status | Response shape |
|---|---|---|
| Missing or empty Bearer token | 401 | `{ error: "Authentication required." }` |
| Invalid or expired Bearer token | 401 | `{ error: "Invalid or expired authentication token." }` |
| Wrong role | 403 | `{ error: "You do not have permission to perform this action." }` |
| Policy not found | 404 | `{ error: "Policy not found." }` |
| Decision not found | 404 | `{ error: "Decision not found." }` |
| Policy not active | 409 | `{ error: "Applications can only be submitted to an active policy." }` |
| Reviewing non-ESCALATED decision | 409 | `{ error: "Only escalated decisions can be reviewed." }` |
| Duplicate review action | 409 | `{ error: "This decision has already been reviewed." }` |
| Review reason < 10 chars | 400 | `{ error: "Invalid review action.", details: [...] }` |
| Invalid application submission | 400 | `{ error: "Invalid submission.", details: [...] }` |
| Unhandled server error | 500 | `{ error: "An unexpected server error occurred." }` |

---

## Windows Setup and Compatibility Notes

1. Install Node.js 20+ from https://nodejs.org
2. `npm install -g pnpm`
3. `pnpm install` (monorepo root)
4. Create `.env` at the monorepo root:
   ```
   JWT_SECRET=<at-least-32-character-secret>
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<at-least-12-characters>
   REVIEWER_USERNAME=reviewer
   REVIEWER_PASSWORD=<at-least-12-characters>
   ```
5. `pnpm --filter @decisiontrace/backend seed`
6. `pnpm --filter @decisiontrace/backend dev`
7. `pnpm test` (runs all package test scripts via `pnpm -r --if-present test`)

> **Note:** See the "Root `pnpm test` and the Frontend Package" section under Testing Strategy for a required adjustment to the frontend test script before `pnpm test` works reliably.

**`better-sqlite3` native bindings:** Requires C++ build tools. Install Visual Studio Build Tools (C++ workload) from https://visualstudio.microsoft.com/visual-cpp-build-tools/. If build fails: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md.

**Test isolation:** Tests use `DATABASE_PATH=':memory:'` via `vitest.config.ts`. The production database `packages/backend/data/decisiontrace.sqlite` is never read, written, reset, or deleted by tests.
