import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { db } from "../src/db/database.js";
import { submitCase } from "../src/decisions/decision.repository.js";

const USER_ID = "user-1";
const POLICY_ID = "policy-1";

function insertRequiredFieldRule() {
  db.prepare(`
    INSERT INTO policy_rules (
      id,
      logical_rule_id,
      version,
      policy_version_id,
      name,
      rule_type,
      target_field,
      operator,
      threshold_json,
      evidence_passage,
      status,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "rule-1",
    "logical-rule-1",
    1,
    POLICY_ID,
    "Applicant name",
    "required-field",
    "applicant_name",
    "required",
    null,
    "Applicant must provide a name.",
    "validated",
    USER_ID
  );
}

function seedDatabase() {
  db.exec(`
    DELETE FROM audit_events;
    DELETE FROM review_actions;
    DELETE FROM rule_results;
    DELETE FROM decision_rule_snapshots;
    DELETE FROM decisions;
    DELETE FROM cases;
    DELETE FROM policy_rules;
    DELETE FROM policies;
    DELETE FROM users;
  `);

  db.prepare(`
    INSERT INTO users (
      id, username, password_hash, role
    )
    VALUES (?, ?, ?, ?)
  `).run(USER_ID, "tester", "test-hash", "administrator");

  db.prepare(`
    INSERT INTO policies (
      id,
      policy_key,
      version,
      title,
      policy_text,
      status,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    POLICY_ID,
    "test-policy",
    1,
    "Test Policy",
    "Applicant must provide a name.",
    "active",
    USER_ID
  );

  insertRequiredFieldRule();
}

describe("submitCase repository", () => {
  beforeEach(() => {
    seedDatabase();
  });

  afterAll(() => {
    db.close();
  });

  it("saves an approved decision, its rule result, and an audit event", () => {
    const result = submitCase({
      policyId: POLICY_ID,
      applicantData: {
        applicant_name: "Jane Doe",
      },
      submittedBy: USER_ID,
    });

    expect(result.recommendation).toBe("APPROVED");
    expect(result.ruleResults).toHaveLength(1);
    expect(result.ruleResults[0].status).toBe("PASS");

    const savedDecision = db
      .prepare("SELECT * FROM decisions WHERE id = ?")
      .get(result.id) as { recommendation: string } | undefined;

    expect(savedDecision?.recommendation).toBe("APPROVED");

    const savedCase = db
      .prepare("SELECT * FROM cases WHERE id = ?")
      .get(result.caseId);

    expect(savedCase).toBeDefined();

    const snapshot = db
      .prepare(`
        SELECT * FROM decision_rule_snapshots
        WHERE decision_id = ?
      `)
      .get(result.id) as { evidence_passage: string } | undefined;

    expect(snapshot?.evidence_passage).toBe(
      "Applicant must provide a name."
    );

    const auditEvent = db
      .prepare(`
        SELECT * FROM audit_events
        WHERE actor_id = ?
          AND event_type = 'case-submitted'
      `)
      .get(USER_ID);

    expect(auditEvent).toBeDefined();
  });

  it("escalates a case when a required field is missing", () => {
    const result = submitCase({
      policyId: POLICY_ID,
      applicantData: {},
      submittedBy: USER_ID,
    });

    expect(result.recommendation).toBe("ESCALATED");
    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
  });

  it("rejects submission when the policy does not exist", () => {
    expect(() =>
      submitCase({
        policyId: "missing-policy",
        applicantData: {},
        submittedBy: USER_ID,
      })
    ).toThrow("POLICY_NOT_FOUND");
  });

  it("rejects submission when the policy is not active", () => {
    db.prepare(`
      UPDATE policies SET status = 'retired' WHERE id = ?
    `).run(POLICY_ID);

    expect(() =>
      submitCase({
        policyId: POLICY_ID,
        applicantData: {
          applicant_name: "Jane Doe",
        },
        submittedBy: USER_ID,
      })
    ).toThrow("POLICY_NOT_ACTIVE");
  });

  it("preserves the original evidence in a historical rule snapshot", () => {
    const originalEvidence = "Applicant must provide a name.";

    const result = submitCase({
      policyId: POLICY_ID,
      applicantData: {
        applicant_name: "Jane Doe",
      },
      submittedBy: USER_ID,
    });

    db.prepare(`
      UPDATE policy_rules
      SET evidence_passage = ?
      WHERE id = 'rule-1'
    `).run("This is the updated policy evidence.");

    const snapshot = db
      .prepare(`
        SELECT evidence_passage
        FROM decision_rule_snapshots
        WHERE decision_id = ?
      `)
      .get(result.id) as { evidence_passage: string } | undefined;

    expect(snapshot?.evidence_passage).toBe(originalEvidence);
  });

  it("rolls back all saved records if the audit insert fails", () => {
    db.exec(`
      CREATE TRIGGER fail_audit_event
      BEFORE INSERT ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `);

    try {
      expect(() =>
        submitCase({
          policyId: POLICY_ID,
          applicantData: {
            applicant_name: "Jane Doe",
          },
          submittedBy: USER_ID,
        })
      ).toThrow();
    } finally {
      db.exec("DROP TRIGGER IF EXISTS fail_audit_event;");
    }

    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM cases) AS cases,
        (SELECT COUNT(*) FROM decisions) AS decisions,
        (SELECT COUNT(*) FROM decision_rule_snapshots) AS snapshots,
        (SELECT COUNT(*) FROM rule_results) AS results,
        (SELECT COUNT(*) FROM audit_events) AS audit_events
    `).get() as {
      cases: number;
      decisions: number;
      snapshots: number;
      results: number;
      audit_events: number;
    };

    expect(counts).toEqual({
      cases: 0,
      decisions: 0,
      snapshots: 0,
      results: 0,
      audit_events: 0,
    });
  });
});