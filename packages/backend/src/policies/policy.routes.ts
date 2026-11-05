
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db/postgres.js";
import {
  requireAuthentication,
  requireRole,
} from "../auth/auth.middleware.js";

interface PolicyRecord {
  id: string;
  policy_key: string;
  version: number;
  title: string;
  policy_text: string;
  status: "active" | "retired";
  created_at: string;
}

interface RuleRecord {
  id: string;
  logical_rule_id: string;
  version: number;
  policy_version_id: string;
  name: string;
  rule_type: string;
  target_field: string;
  operator: string;
  threshold_json: string | null;
  evidence_passage: string;
  status: "extracted" | "validated" | "retired";
  predecessor_id: string | null;
  created_at: string;
  updated_at: string;
}

export const policyRouter = Router();

// List policy versions.
policyRouter.get(
  "/",
  requireAuthentication,
  async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, policy_key, version, title, status, created_at
         FROM policies
         ORDER BY policy_key, version DESC`
      );

      res.json({ policies: result.rows });
    } catch (error) {
      next(error);
    }
  }
);

// Retrieve one policy and its rules.
policyRouter.get(
  "/:policyId",
  requireAuthentication,
  async (req, res, next) => {
    try {
      const policyResult = await pool.query<PolicyRecord>(
        `SELECT id, policy_key, version, title, policy_text,
                status, created_at
         FROM policies
         WHERE id = $1`,
        [req.params.policyId]
      );

      const policy = policyResult.rows[0];

      if (!policy) {
        res.status(404).json({ error: "Policy not found." });
        return;
      }

      const rulesResult = await pool.query<RuleRecord>(
        `SELECT id, logical_rule_id, version, policy_version_id,
                name, rule_type, target_field, operator, threshold_json,
                evidence_passage, status, predecessor_id,
                created_at, updated_at
         FROM policy_rules
         WHERE policy_version_id = $1
         ORDER BY logical_rule_id, version`,
        [policy.id]
      );

      const rules = rulesResult.rows;

      res.json({
        policy,
        rules: rules.map((rule) => ({
          ...rule,
          threshold:
            rule.threshold_json === null
              ? null
              : JSON.parse(rule.threshold_json),
          threshold_json: undefined,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Validate an extracted rule.
policyRouter.post(
  "/:policyId/rules/:ruleId/validate",
  requireAuthentication,
  requireRole("administrator"),
  async (req, res, next) => {
    try {
      const policyResult = await pool.query<{
        id: string;
        policy_text: string;
        status: string;
      }>(
        `SELECT id, policy_text, status
         FROM policies
         WHERE id = $1`,
        [req.params.policyId]
      );

      const policy = policyResult.rows[0];

      if (!policy) {
        res.status(404).json({ error: "Policy not found." });
        return;
      }

      if (policy.status !== "active") {
        res.status(409).json({
          error: "Only rules belonging to an active policy can be validated.",
        });
        return;
      }

      const ruleResult = await pool.query<{
        id: string;
        policy_version_id: string;
        evidence_passage: string;
        status: string;
      }>(
        `SELECT id, policy_version_id, evidence_passage, status
         FROM policy_rules
         WHERE id = $1 AND policy_version_id = $2`,
        [req.params.ruleId, policy.id]
      );

      const rule = ruleResult.rows[0];

      if (!rule) {
        res.status(404).json({ error: "Rule not found for this policy." });
        return;
      }

      if (rule.status !== "extracted") {
        res.status(409).json({
          error: "Only extracted rules can be validated.",
        });
        return;
      }

      if (
        !rule.evidence_passage ||
        !policy.policy_text.includes(rule.evidence_passage)
      ) {
        res.status(400).json({
          error: "The evidence passage must match the policy text verbatim.",
        });
        return;
      }

      const now = new Date().toISOString();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const updateResult = await client.query(
          `UPDATE policy_rules
           SET status = 'validated', updated_at = $1
           WHERE id = $2 AND status = 'extracted'`,
          [now, rule.id]
        );

        if (updateResult.rowCount !== 1) {
          throw new Error("RULE_VALIDATION_CONFLICT");
        }

        await client.query(
          `INSERT INTO audit_events
           (id, event_type, actor_id, summary, details_json, created_at)
           VALUES ($1, 'rule-validated', $2, $3, $4, $5)`,
          [
            randomUUID(),
            req.user!.id,
            `Rule ${rule.id} validated`,
            JSON.stringify({
              policyId: policy.id,
              ruleId: rule.id,
              evidencePassage: rule.evidence_passage,
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

      res.json({
        message: "Rule validated successfully.",
        ruleId: rule.id,
        status: "validated",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "RULE_VALIDATION_CONFLICT"
      ) {
        res.status(409).json({
          error: "Only extracted rules can be validated.",
        });
        return;
      }

      next(error);
    }
  }
);
