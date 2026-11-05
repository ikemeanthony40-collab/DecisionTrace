
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

async function seed(): Promise<void> {
  const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
  const reviewerUsername = process.env.REVIEWER_USERNAME ?? "reviewer";
  const adminPassword = process.env.ADMIN_PASSWORD;
  const reviewerPassword = process.env.REVIEWER_PASSWORD;

  if (!adminPassword || !reviewerPassword) {
    throw new Error(
      "Set ADMIN_PASSWORD and REVIEWER_PASSWORD in your .env file before seeding."
    );
  }

  if (adminPassword.length < 12 || reviewerPassword.length < 12) {
    throw new Error("Both account passwords must be at least 12 characters.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingAdmin = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [adminUsername]
    );

    if (existingAdmin.rows.length === 0) {
      await client.query(
        `INSERT INTO users (id, username, password_hash, role)
         VALUES ($1, $2, $3, $4)`,
        [
          randomUUID(),
          adminUsername,
          await bcrypt.hash(adminPassword, 12),
          "administrator",
        ]
      );
    }

    const existingReviewer = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [reviewerUsername]
    );

    if (existingReviewer.rows.length === 0) {
      await client.query(
        `INSERT INTO users (id, username, password_hash, role)
         VALUES ($1, $2, $3, $4)`,
        [
          randomUUID(),
          reviewerUsername,
          await bcrypt.hash(reviewerPassword, 12),
          "reviewer",
        ]
      );
    }

    const savedAdminResult = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [adminUsername]
    );

    const savedAdmin = savedAdminResult.rows[0];

    if (!savedAdmin) {
      throw new Error("Administrator account could not be found.");
    }

    const existingPolicy = await client.query<{ id: string }>(
      "SELECT id FROM policies WHERE policy_key = $1",
      ["greenleaf-fund"]
    );

    if (existingPolicy.rows.length > 0) {
      await client.query("COMMIT");

      console.log(
        "Required accounts checked. Greenleaf sample policy already exists. No policy changes made."
      );
      return;
    }

    const policyId = randomUUID();

    const policyText = `
Greenleaf Community Innovation Fund — Application Policy

1. Applicants must be at least 18 years old.
2. The applicant's organisation must be registered.
3. The maximum funding request is 50,000 currency units.
4. Applications must have a submission date on or after 1 January 2025.
5. Every application must include a project description.
6. Every application must include an impact statement.
`.trim();

    await client.query(
      `INSERT INTO policies (
         id, policy_key, version, title, policy_text, status, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        policyId,
        "greenleaf-fund",
        1,
        "Greenleaf Community Innovation Fund",
        policyText,
        "active",
        savedAdmin.id,
      ]
    );

    const rules = [
      {
        logicalId: "applicant-age",
        name: "Applicant must be at least 18",
        type: "numeric-threshold",
        field: "applicant_age",
        operator: ">=",
        threshold: 18,
        evidence: "Applicants must be at least 18 years old.",
        status: "validated",
      },
      {
        logicalId: "organisation-registered",
        name: "Organisation registration is required",
        type: "required-field",
        field: "organisation_registered",
        operator: "required",
        threshold: null,
        evidence: "The applicant's organisation must be registered.",
        status: "validated",
      },
      {
        logicalId: "funding-limit",
        name: "Funding request must not exceed 50,000",
        type: "numeric-threshold",
        field: "funding_amount_requested",
        operator: "<=",
        threshold: 50000,
        evidence: "The maximum funding request is 50,000 currency units.",
        status: "validated",
      },
      {
        logicalId: "submission-date",
        name: "Submission date must be on or after 2025-01-01",
        type: "date-condition",
        field: "submission_date",
        operator: ">=",
        threshold: "2025-01-01",
        evidence: "Applications must have a submission date on or after 1 January 2025.",
        status: "validated",
      },
      {
        logicalId: "project-description",
        name: "Project description is required",
        type: "required-field",
        field: "project_description",
        operator: "required",
        threshold: null,
        evidence: "Every application must include a project description.",
        status: "extracted",
      },
      {
        logicalId: "impact-statement",
        name: "Impact statement is required",
        type: "required-field",
        field: "impact_statement",
        operator: "required",
        threshold: null,
        evidence: "Every application must include an impact statement.",
        status: "extracted",
      },
    ] as const;

    for (const rule of rules) {
      await client.query(
        `INSERT INTO policy_rules (
           id, logical_rule_id, version, policy_version_id, name,
           rule_type, target_field, operator, threshold_json,
           evidence_passage, status, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          randomUUID(),
          rule.logicalId,
          1,
          policyId,
          rule.name,
          rule.type,
          rule.field,
          rule.operator,
          rule.threshold === null ? null : JSON.stringify(rule.threshold),
          rule.evidence,
          rule.status,
          savedAdmin.id,
        ]
      );
    }

    await client.query(
      `INSERT INTO audit_events (
         id, event_type, actor_id, summary, details_json
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        "policy-ingested",
        savedAdmin.id,
        "Initial Greenleaf Community Innovation Fund policy created",
        JSON.stringify({
          policyId,
          policyKey: "greenleaf-fund",
          version: 1,
          rulesCreated: rules.length,
        }),
      ]
    );

    await client.query("COMMIT");

    console.log("DecisionTrace seed completed successfully.");
    console.log("Administrator username:", adminUsername);
    console.log("Reviewer username:", reviewerUsername);
    console.log("Policy:", "Greenleaf Community Innovation Fund");
    console.log("Rules created:", rules.length);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
