import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const configuredPath = process.env.DATABASE_PATH ?? "data/decisiontrace.sqlite";
const databasePath =
  configuredPath === ":memory:" ? ":memory:" : resolve(configuredPath);

if (databasePath !== ":memory:") {
  mkdirSync(dirname(databasePath), { recursive: true });
}

export const db = new Database(databasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('administrator', 'reviewer')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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

  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_version_per_policy
    ON policies(policy_key)
    WHERE status = 'active';

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
    status TEXT NOT NULL CHECK (
      status IN ('extracted', 'validated', 'retired')
    ),
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
    rule_status TEXT NOT NULL CHECK (
      rule_status IN ('extracted', 'validated', 'retired')
    ),
    UNIQUE (decision_id, source_rule_id)
  );

  CREATE TABLE IF NOT EXISTS rule_results (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL REFERENCES decisions(id),
    snapshot_id TEXT NOT NULL REFERENCES decision_rule_snapshots(id),
    result TEXT NOT NULL CHECK (
      result IN ('PASS', 'FAIL', 'MISSING_INFO')
    ),
    observed_value_json TEXT,
    explanation TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS review_actions (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL UNIQUE REFERENCES decisions(id),
    action TEXT NOT NULL CHECK (action IN ('APPROVE', 'OVERRIDE')),
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
    reviewer_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (
      event_type IN (
        'policy-ingested',
        'rule-created',
        'rule-validated',
        'rule-updated',
        'rule-retired',
        'case-submitted',
        'review-action-taken'
      )
    ),
    actor_id TEXT REFERENCES users(id),
    summary TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rules_policy_status
    ON policy_rules(policy_version_id, status);

  CREATE INDEX IF NOT EXISTS idx_cases_submitted
    ON cases(submitted_at);

  CREATE INDEX IF NOT EXISTS idx_decisions_created
    ON decisions(created_at);

  CREATE INDEX IF NOT EXISTS idx_audit_created
    ON audit_events(created_at);
`);

console.log("DecisionTrace database initialized:", databasePath);