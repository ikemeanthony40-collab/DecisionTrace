
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { db } from "../src/db/database.js";

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
    INSERT INTO users (id, username, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(REVIEWER_ID, "test-reviewer", "test-hash", "reviewer");

  db.prepare(`
    INSERT INTO users (id, username, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(ADMIN_ID, "test-admin", "test-hash", "administrator");

  db.prepare(`
    INSERT INTO policies (
      id, policy_key, version, title, policy_text, status, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    POLICY_ID,
    "review-test-policy",
    1,
    "Review Test Policy",
    "Test policy text.",
    "active",
    ADMIN_ID
  );

  db.prepare(`
    INSERT INTO cases (
      id, policy_version_id, applicant_data_json, submitted_by
    )
    VALUES (?, ?, ?, ?)
  `).run(
    CASE_ID,
    POLICY_ID,
    JSON.stringify({ applicant_name: "Test Applicant" }),
    ADMIN_ID
  );

  db.prepare(`
    INSERT INTO decisions (
      id, case_id, policy_version_id, recommendation
    )
    VALUES (?, ?, ?, ?)
  `).run(
    ESCALATED_DECISION_ID,
    CASE_ID,
    POLICY_ID,
    "ESCALATED"
  );

  const approvedCaseId = "case-approved-1";

  db.prepare(`
    INSERT INTO cases (
      id, policy_version_id, applicant_data_json, submitted_by
    )
    VALUES (?, ?, ?, ?)
  `).run(
    approvedCaseId,
    POLICY_ID,
    JSON.stringify({ applicant_name: "Another Applicant" }),
    ADMIN_ID
  );

  db.prepare(`
    INSERT INTO decisions (
      id, case_id, policy_version_id, recommendation
    )
    VALUES (?, ?, ?, ?)
  `).run(
    APPROVED_DECISION_ID,
    approvedCaseId,
    POLICY_ID,
    "APPROVED"
  );
}

describe("Reviewer API", () => {
  beforeEach(() => {
    seedDatabase();
  });

  afterAll(() => {
    db.close();
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

    const savedDecision = db
      .prepare("SELECT recommendation FROM decisions WHERE id = ?")
      .get(ESCALATED_DECISION_ID) as {
        recommendation: string;
      };

    expect(savedDecision.recommendation).toBe("ESCALATED");
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

    const auditEvent = db
      .prepare(`
        SELECT event_type, actor_id, details_json
        FROM audit_events
        WHERE event_type = 'review-action-taken'
      `)
      .get() as {
        event_type: string;
        actor_id: string;
        details_json: string;
      };

    expect(auditEvent.event_type).toBe("review-action-taken");
    expect(auditEvent.actor_id).toBe(REVIEWER_ID);

    const details = JSON.parse(auditEvent.details_json);
    expect(details.decisionId).toBe(ESCALATED_DECISION_ID);
    expect(details.action).toBe("OVERRIDE");
    expect(details.reason).toBe(
      "The evidence does not satisfy the policy."
    );
  });
});
