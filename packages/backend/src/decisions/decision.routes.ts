
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool } from "../db/postgres.js";
import {
  requireAuthentication,
  requireRole,
} from "../auth/auth.middleware.js";
import { submitCase } from "./decision.repository.js";

export const decisionRouter = Router();

const submitSchema = z.object({
  policyId: z.string().uuid(),
  applicantData: z.record(z.string(), z.unknown()),
});

const reviewSchema = z.object({
  action: z.enum(["APPROVE", "OVERRIDE"]),
  reason: z.string().trim().min(10, "Reason must contain at least 10 characters."),
});

interface PostgresError extends Error {
  code?: string;
  constraint?: string;
}

function isDuplicateReviewError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const pgError = error as PostgresError;

  return (
    pgError.code === "23505" &&
    pgError.constraint === "review_actions_decision_id_key"
  );
}

// Submit an application for deterministic evaluation.
decisionRouter.post(
  "/",
  requireAuthentication,
  async (req, res, next) => {
    try {
      const parsed = submitSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid submission.",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        });
        return;
      }

      const result = await submitCase({
        policyId: parsed.data.policyId,
        applicantData: parsed.data.applicantData,
        submittedBy: req.user!.id,
      });

      res.status(201).json({ decision: result });
    } catch (error) {
      if (error instanceof Error && error.message === "POLICY_NOT_FOUND") {
        res.status(404).json({ error: "Policy not found." });
        return;
      }

      if (error instanceof Error && error.message === "POLICY_NOT_ACTIVE") {
        res.status(409).json({
          error: "Applications can only be submitted to an active policy.",
        });
        return;
      }

      next(error);
    }
  }
);

// List escalated decisions that have not yet been reviewed.
// Oldest decisions appear first.
decisionRouter.get(
  "/review-queue",
  requireAuthentication,
  requireRole("reviewer"),
  async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT
           d.id AS decision_id,
           d.case_id,
           d.policy_version_id,
           d.recommendation,
           d.escalation_reasons_json,
           d.created_at AS decision_created_at,
           c.applicant_data_json,
           c.submitted_at,
           p.title AS policy_title
         FROM decisions d
         JOIN cases c ON c.id = d.case_id
         JOIN policies p ON p.id = d.policy_version_id
         LEFT JOIN review_actions ra ON ra.decision_id = d.id
         WHERE d.recommendation = 'ESCALATED'
           AND ra.id IS NULL
         ORDER BY d.created_at ASC, d.id ASC`
      );

      const rows = result.rows;

      res.json({
        decisions: rows.map((row) => ({
          id: row.decision_id,
          caseId: row.case_id,
          policyVersionId: row.policy_version_id,
          policyTitle: row.policy_title,
          recommendation: row.recommendation,
          escalationReasons: JSON.parse(row.escalation_reasons_json),
          applicantData: JSON.parse(row.applicant_data_json),
          submittedAt: row.submitted_at,
          createdAt: row.decision_created_at,
        })),
        count: rows.length,
      });
    } catch (error) {
      next(error);
    }
  }
);

// List all decisions and their reviewer history for administrators.
decisionRouter.get(
  "/history",
  requireAuthentication,
  requireRole("administrator"),
  async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT
           d.id AS decision_id,
           d.case_id,
           d.recommendation,
           d.created_at AS decision_created_at,
           ra.action AS review_action,
           ra.reason AS review_reason,
           ra.created_at AS review_created_at,
           u.username AS reviewer_username
         FROM decisions d
         LEFT JOIN review_actions ra ON ra.decision_id = d.id
         LEFT JOIN users u ON u.id = ra.reviewer_id
         ORDER BY d.created_at DESC, d.id DESC`
      );

      const rows = result.rows;

      res.json({
        decisions: rows.map((row) => ({
          id: row.decision_id,
          caseId: row.case_id,
          recommendation: row.recommendation,
          decisionCreatedAt: row.decision_created_at,
          reviewAction: row.review_action,
          reviewOutcome:
            row.review_action === "APPROVE"
              ? "Approved by reviewer"
              : row.review_action === "OVERRIDE"
                ? "Rejected by reviewer"
                : "Not reviewed",
          reviewReason: row.review_reason,
          reviewCreatedAt: row.review_created_at,
          reviewerUsername: row.reviewer_username,
        })),
        count: rows.length,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Record a reviewer action without changing the machine recommendation.
decisionRouter.post(
  "/:decisionId/review",
  requireAuthentication,
  requireRole("reviewer"),
  async (req, res, next) => {
    try {
      const parsed = reviewSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid review action.",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        });
        return;
      }

      const decisionResult = await pool.query(
        `SELECT id, recommendation
         FROM decisions
         WHERE id = $1`,
        [req.params.decisionId]
      );

      const decision = decisionResult.rows[0] as
        | { id: string; recommendation: string }
        | undefined;

      if (!decision) {
        res.status(404).json({ error: "Decision not found." });
        return;
      }

      if (decision.recommendation !== "ESCALATED") {
        res.status(409).json({
          error: "Only escalated decisions can be reviewed.",
        });
        return;
      }

      const actionId = randomUUID();
      const now = new Date().toISOString();
      const reason = parsed.data.reason;
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO review_actions
             (id, decision_id, action, reason, reviewer_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            actionId,
            decision.id,
            parsed.data.action,
            reason,
            req.user!.id,
            now,
          ]
        );

        await client.query(
          `INSERT INTO audit_events
             (id, event_type, actor_id, summary, details_json, created_at)
           VALUES ($1, 'review-action-taken', $2, $3, $4, $5)`,
          [
            randomUUID(),
            req.user!.id,
            `Reviewer recorded ${parsed.data.action} for decision ${decision.id}`,
            JSON.stringify({
              decisionId: decision.id,
              actionId,
              action: parsed.data.action,
              reason,
            }),
            now,
          ]
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      res.status(201).json({
        review: {
          id: actionId,
          decisionId: decision.id,
          action: parsed.data.action,
          label:
            parsed.data.action === "APPROVE"
              ? "Approved by reviewer"
              : "Rejected by reviewer",
          reason,
          reviewerId: req.user!.id,
          createdAt: now,
        },
        machineRecommendation: decision.recommendation,
      });
    } catch (error) {
      if (isDuplicateReviewError(error)) {
        res.status(409).json({
          error: "This decision has already been reviewed.",
        });
        return;
      }

      next(error);
    }
  }
);

// Retrieve a decision with its saved rule snapshots, results and review.
decisionRouter.get(
  "/:decisionId",
  requireAuthentication,
  async (req, res, next) => {
    try {
      const decisionResult = await pool.query(
        `SELECT d.id, d.case_id, d.policy_version_id,
                d.recommendation, d.escalation_reasons_json,
                d.created_at, c.applicant_data_json, c.submitted_at
         FROM decisions d
         JOIN cases c ON c.id = d.case_id
         WHERE d.id = $1`,
        [req.params.decisionId]
      );

      const decision = decisionResult.rows[0] as
        | {
            id: string;
            case_id: string;
            policy_version_id: string;
            recommendation: string;
            escalation_reasons_json: string;
            created_at: string;
            applicant_data_json: string;
            submitted_at: string;
          }
        | undefined;

      if (!decision) {
        res.status(404).json({ error: "Decision not found." });
        return;
      }

      const snapshotsResult = await pool.query(
        `SELECT id, source_rule_id, logical_rule_id, rule_version,
                rule_name, rule_type, target_field, operator,
                threshold_json, evidence_passage, rule_status
         FROM decision_rule_snapshots
         WHERE decision_id = $1
         ORDER BY rule_name`,
        [decision.id]
      );

      const snapshots = snapshotsResult.rows as Array<{
        id: string;
        source_rule_id: string;
        logical_rule_id: string;
        rule_version: number;
        rule_name: string;
        rule_type: string;
        target_field: string;
        operator: string;
        threshold_json: string | null;
        evidence_passage: string;
        rule_status: string;
      }>;

      const resultsResult = await pool.query(
        `SELECT id, snapshot_id, result, observed_value_json, explanation
         FROM rule_results
         WHERE decision_id = $1`,
        [decision.id]
      );

      const reviewResult = await pool.query(
        `SELECT ra.id, ra.action, ra.reason, ra.reviewer_id,
                ra.created_at, u.username AS reviewer_username
         FROM review_actions ra
         JOIN users u ON u.id = ra.reviewer_id
         WHERE ra.decision_id = $1`,
        [decision.id]
      );

      const review = reviewResult.rows[0] as
        | {
            id: string;
            action: "APPROVE" | "OVERRIDE";
            reason: string;
            reviewer_id: string;
            created_at: string;
            reviewer_username: string;
          }
        | undefined;

      res.json({
        decision: {
          ...decision,
          escalationReasons: JSON.parse(decision.escalation_reasons_json),
          applicantData: JSON.parse(decision.applicant_data_json),
        },
        ruleSnapshots: snapshots.map((snapshot) => ({
          ...snapshot,
          threshold:
            snapshot.threshold_json === null
              ? null
              : JSON.parse(snapshot.threshold_json),
          threshold_json: undefined,
        })),
        ruleResults: resultsResult.rows,
        review: review
          ? {
              ...review,
              label:
                review.action === "APPROVE"
                  ? "Approved by reviewer"
                  : "Rejected by reviewer",
            }
          : null,
      });
    } catch (error) {
      next(error);
    }
  }
);
