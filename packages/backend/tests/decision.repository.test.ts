
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { pool } from "../src/db/postgres.js";
import { submitCase } from "../src/decisions/decision.repository.js";

const USER_ID = "user-1";
const POLICY_ID = "policy-1";

async function seedDatabase() {
  await pool.query(`
    TRUNCATE TABLE
      audit_events,
      review_actions,
      rule_results,
      decision_rule_snapshots,
      decisions,
      cases,
      policy_rules,
      policies,
      users
    CASCADE
  `);

  await pool.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [USER_ID, "tester", "test-hash", "administrator"]
  );

  await pool.query(
    `INSERT INTO policies (
      id, policy_key, version, title, policy_text, status, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      POLICY_ID,
      "test-policy",
      1,
      "Test Policy",
      "Applicant must provide a name.",
      "active",
      USER_ID,
    ]
  );

  await pool.query(
    `INSERT INTO policy_rules (
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
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
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
      USER_ID,
    ]
  );
}

describe("submitCase repository", () => {
  beforeAll(async () => {
    const result = await pool.query(
      "SELECT current_database() AS database_name"
    );

    if (result.rows[0]?.database_name !== "decisiontrace_test") {
      throw new Error(
        "Safety check failed: tests may only run against decisiontrace_test."
      );
    }
  });

  beforeEach(async () => {
    await seedDatabase();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("saves an approved decision, its rule result, and an audit event", async () => {
    const result = await submitCase({
      policyId: POLICY_ID,
      applicantData: {
        applicant_name: "Jane Doe",
      },
      submittedBy: USER_ID,
    });

    expect(result.recommendation).toBe("APPROVED");
    expect(result.ruleResults).toHaveLength(1);
    expect(result.ruleResults[0].status).toBe("PASS");

    const savedDecision = await pool.query(
      "SELECT * FROM decisions WHERE id = $1",
      [result.id]
    );

    expect(savedDecision.rows[0]?.recommendation).toBe("APPROVED");

    const savedCase = await pool.query(
      "SELECT * FROM cases WHERE id = $1",
      [result.caseId]
    );

    expect(savedCase.rows.length).toBe(1);

    const snapshot = await pool.query(
      `SELECT * FROM decision_rule_snapshots
       WHERE decision_id = $1`,
      [result.id]
    );

    expect(snapshot.rows[0]?.evidence_passage).toBe(
      "Applicant must provide a name."
    );

    const auditEvent = await pool.query(
      `SELECT * FROM audit_events
       WHERE actor_id = $1
         AND event_type = 'case-submitted'`,
      [USER_ID]
    );

    expect(auditEvent.rows.length).toBe(1);
  });

  it("escalates a case when a required field is missing", async () => {
    const result = await submitCase({
      policyId: POLICY_ID,
      applicantData: {},
      submittedBy: USER_ID,
    });

    expect(result.recommendation).toBe("ESCALATED");
    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
  });

  it("rejects submission when the policy does not exist", async () => {
    await expect(
      submitCase({
        policyId: "missing-policy",
        applicantData: {},
        submittedBy: USER_ID,
      })
    ).rejects.toThrow("POLICY_NOT_FOUND");
  });

  it("rejects submission when the policy is not active", async () => {
    await pool.query(
      "UPDATE policies SET status = $1 WHERE id = $2",
      ["retired", POLICY_ID]
    );

    await expect(
      submitCase({
        policyId: POLICY_ID,
        applicantData: {
          applicant_name: "Jane Doe",
        },
        submittedBy: USER_ID,
      })
    ).rejects.toThrow("POLICY_NOT_ACTIVE");
  });

  it("preserves the original evidence in a historical rule snapshot", async () => {
    const originalEvidence = "Applicant must provide a name.";

    const result = await submitCase({
      policyId: POLICY_ID,
      applicantData: {
        applicant_name: "Jane Doe",
      },
      submittedBy: USER_ID,
    });

    await pool.query(
      `UPDATE policy_rules
       SET evidence_passage = $1
       WHERE id = $2`,
      ["This is the updated policy evidence.", "rule-1"]
    );

    const snapshot = await pool.query(
      `SELECT evidence_passage
       FROM decision_rule_snapshots
       WHERE decision_id = $1`,
      [result.id]
    );

    expect(snapshot.rows[0]?.evidence_passage).toBe(originalEvidence);
  });

  it("rolls back all saved records if the audit insert fails", async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_audit_event()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'forced audit failure';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      CREATE TRIGGER fail_audit_event
      BEFORE INSERT ON audit_events
      FOR EACH ROW
      EXECUTE FUNCTION test_fail_audit_event();
    `);

    try {
      await expect(
        submitCase({
          policyId: POLICY_ID,
          applicantData: {
            applicant_name: "Jane Doe",
          },
          submittedBy: USER_ID,
        })
      ).rejects.toThrow("forced audit failure");
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS fail_audit_event ON audit_events"
      );

      await pool.query(
        "DROP FUNCTION IF EXISTS test_fail_audit_event()"
      );
    }

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM cases) AS cases,
        (SELECT COUNT(*) FROM decisions) AS decisions,
        (SELECT COUNT(*) FROM decision_rule_snapshots) AS snapshots,
        (SELECT COUNT(*) FROM rule_results) AS results,
        (SELECT COUNT(*) FROM audit_events) AS audit_events
    `);

    const actualCounts = Object.fromEntries(
      Object.entries(counts.rows[0]).map(([key, value]) => [
        key,
        Number(value),
      ])
    );

    expect(actualCounts).toEqual({
      cases: 0,
      decisions: 0,
      snapshots: 0,
      results: 0,
      audit_events: 0,
    });
  });
});
