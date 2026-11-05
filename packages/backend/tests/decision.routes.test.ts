
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { pool } from "../src/db/postgres.js";

const JWT_SECRET =
  "decisiontrace-test-secret-only-32-characters-minimum";

const REVIEWER_ID = "reviewer-test-1";
const ADMIN_ID = "admin-test-1";
const POLICY_ID = "policy-test-1";
const CASE_ID = "case-test-1";
const ESCALATED_DECISION_ID = "decision-escalated-1";
const APPROVED_DECISION_ID = "decision-approved-1";

function createToken(
  userId: string,
  username: string,
  role: "reviewer" | "administrator"
) {
  return jwt.sign(
    { username, role },
    JWT_SECRET,
    {
      subject: userId,
      expiresIn: "1h",
      algorithm: "HS256",
    }
  );
}

const reviewerToken = createToken(
  REVIEWER_ID,
  "test-reviewer",
  "reviewer"
);

const adminToken = createToken(
  ADMIN_ID,
  "test-admin",
  "administrator"
);

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
    [REVIEWER_ID, "test-reviewer", "test-hash", "reviewer"]
  );

  await pool.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [ADMIN_ID, "test-admin", "test-hash", "administrator"]
  );

  await pool.query(
    `INSERT INTO policies (
      id, policy_key, version, title, policy_text, status, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      POLICY_ID,
      "review-test-policy",
      1,
      "Review Test Policy",
      "Test policy text.",
      "active",
      ADMIN_ID,
    ]
  );

  await pool.query(
    `INSERT INTO cases (
      id, policy_version_id, applicant_data_json, submitted_by
    )
    VALUES ($1, $2, $3, $4)`,
    [
      CASE_ID,
      POLICY_ID,
      JSON.stringify({ applicant_name: "Test Applicant" }),
      ADMIN_ID,
    ]
  );

  await pool.query(
    `INSERT INTO decisions (
      id, case_id, policy_version_id, recommendation
    )
    VALUES ($1, $2, $3, $4)`,
    [
      ESCALATED_DECISION_ID,
      CASE_ID,
      POLICY_ID,
      "ESCALATED",
    ]
  );

  const approvedCaseId = "case-approved-1";

  await pool.query(
    `INSERT INTO cases (
      id, policy_version_id, applicant_data_json, submitted_by
    )
    VALUES ($1, $2, $3, $4)`,
    [
      approvedCaseId,
      POLICY_ID,
      JSON.stringify({ applicant_name: "Another Applicant" }),
      ADMIN_ID,
    ]
  );

  await pool.query(
    `INSERT INTO decisions (
      id, case_id, policy_version_id, recommendation
    )
    VALUES ($1, $2, $3, $4)`,
    [
      APPROVED_DECISION_ID,
      approvedCaseId,
      POLICY_ID,
      "APPROVED",
    ]
  );
}

describe("Reviewer API", () => {
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

  it("rejects unauthenticated review requests", async () => {
    const response = await request(app)
      .post(`/api/decisions/${ESCALATED_DECISION_ID}/review`)
      .send({
        action: "APPROVE",
        reason: "The applicant meets the requirements.",
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required.");
  });

  it("rejects administrator access to the reviewer queue", async () => {
    const response = await request(app)
      .get("/api/decisions/review-queue")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(403);
  });

  it("allows a reviewer to approve an escalated decision", async () => {
    const response = await request(app)
      .post(`/api/decisions/${ESCALATED_DECISION_ID}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        action: "APPROVE",
        reason: "The applicant has provided sufficient evidence.",
      });

    expect(response.status).toBe(201);
    expect(response.body.review.action).toBe("APPROVE");
    expect(response.body.review.label).toBe("Approved by reviewer");
    expect(response.body.review.reviewerId).toBe(REVIEWER_ID);
    expect(response.body.machineRecommendation).toBe("ESCALATED");

    const savedDecision = await pool.query(
      "SELECT recommendation FROM decisions WHERE id = $1",
      [ESCALATED_DECISION_ID]
    );

    expect(savedDecision.rows[0]?.recommendation).toBe("ESCALATED");
  });

  it("rejects a review reason shorter than 10 characters", async () => {
    const response = await request(app)
      .post(`/api/decisions/${ESCALATED_DECISION_ID}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        action: "APPROVE",
        reason: "Too short",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid review action.");
  });

  it("rejects a duplicate review for the same decision", async () => {
    const firstResponse = await request(app)
      .post(`/api/decisions/${ESCALATED_DECISION_ID}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        action: "APPROVE",
        reason: "The applicant has provided sufficient evidence.",
      });

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app)
      .post(`/api/decisions/${ESCALATED_DECISION_ID}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        action: "OVERRIDE",
        reason: "A second review should not be permitted.",
      });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error).toBe(
      "This decision has already been reviewed."
    );
  });

  it("rejects reviews of decisions that are not escalated", async () => {
    const response = await request(app)
      .post(`/api/decisions/${APPROVED_DECISION_ID}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        action: "OVERRIDE",
        reason: "This decision should not be reviewed.",
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      "Only escalated decisions can be reviewed."
    );
  });

  it("records an audit event when a reviewer takes action", async () => {
    const response = await request(app)
      .post(`/api/decisions/${ESCALATED_DECISION_ID}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        action: "OVERRIDE",
        reason: "The evidence does not satisfy the policy.",
      });

    expect(response.status).toBe(201);

    const auditEvent = await pool.query(
      `SELECT event_type, actor_id, details_json
       FROM audit_events
       WHERE event_type = 'review-action-taken'`
    );

    expect(auditEvent.rows.length).toBe(1);
    expect(auditEvent.rows[0].event_type).toBe("review-action-taken");
    expect(auditEvent.rows[0].actor_id).toBe(REVIEWER_ID);

    const details = JSON.parse(auditEvent.rows[0].details_json);

    expect(details.decisionId).toBe(ESCALATED_DECISION_ID);
    expect(details.action).toBe("OVERRIDE");
    expect(details.reason).toBe(
      "The evidence does not satisfy the policy."
    );
  });
});
