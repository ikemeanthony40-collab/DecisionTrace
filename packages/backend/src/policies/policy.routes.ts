import { Router } from "express";
import { db } from "../db/database.js";
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
  (_req, res, next) => {
    try {
      const policies = db
        .prepare(
          `SELECT id, policy_key, version, title, status, created_at
           FROM policies
           ORDER BY policy_key, version DESC`
        )
        .all();

      res.json({ policies });
    } catch (error) {
      next(error);
    }
  }
);

// Retrieve one policy and its rules.
policyRouter.get(
  "/:policyId",
  requireAuthentication,
  (req, res, next) => {
    try {
      const policy = db
        .prepare(
          `SELECT id, policy_key, version, title, policy_text,
                  status, created_at
           FROM policies
           WHERE id = ?`
        )
        .get(req.params.policyId) as PolicyRecord | undefined;

      if (!policy) {
        res.status(404).json({ error: "Policy not found." });
        return;
      }

      const rules = db
        .prepare(
          `SELECT id, logical_rule_id, version, policy_version_id,
                  name, rule_type, target_field, operator, threshold_json,
                  evidence_passage, status, predecessor_id,
                  created_at, updated_at
           FROM policy_rules
           WHERE policy_version_id = ?
           ORDER BY logical_rule_id, version`
        )
        .all(policy.id) as RuleRecord[];

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
  (req, res, next) => {
    try {
      const policy = db
        .prepare(
          `SELECT id, policy_text, status
           FROM policies
           WHERE id = ?`
        )
        .get(req.params.policyId) as
        | { id: string; policy_text: string; status: string }
        | undefined;

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

      const rule = db
        .prepare(
          `SELECT id, policy_version_id, evidence_passage, status
           FROM policy_rules
           WHERE id = ? AND policy_version_id = ?`
        )
        .get(req.params.ruleId, policy.id) as
        | {
            id: string;
            policy_version_id: string;
            evidence_passage: string;
            status: string;
          }
        | undefined;

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

      const updateRule = db.transaction(() => {
        db.prepare(
          `UPDATE policy_rules
           SET status = 'validated', updated_at = ?
           WHERE id = ? AND status = 'extracted'`
        ).run(now, rule.id);

        db.prepare(
          `INSERT INTO audit_events
           (id, event_type, actor_id, summary, details_json, created_at)
           VALUES (?, 'rule-validated', ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          req.user!.id,
          `Rule ${rule.id} validated`,
          JSON.stringify({
            policyId: policy.id,
            ruleId: rule.id,
            evidencePassage: rule.evidence_passage,
          }),
          now
        );
      });

      updateRule();

      res.json({
        message: "Rule validated successfully.",
        ruleId: rule.id,
        status: "validated",
      });
    } catch (error) {
      next(error);
    }
  }
);