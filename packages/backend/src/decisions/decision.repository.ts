import { randomUUID } from "node:crypto";
import { pool } from "../db/postgres.js";
import {
  evaluateDecision,
  type EvaluationRule,
} from "./decision.service.js";

interface PolicyRow {
  id: string;
  status: "active" | "retired";
}

interface RuleRow extends EvaluationRule {
  policy_version_id: string;
}

export interface SubmitCaseInput {
  policyId: string;
  applicantData: Record<string, unknown>;
  submittedBy: string;
}

export interface SavedDecision {
  id: string;
  caseId: string;
  policyVersionId: string;
  recommendation: "APPROVED" | "DENIED" | "ESCALATED";
  escalationReasons: string[];
  ruleResults: Array<{
    ruleId: string;
    ruleName: string;
    status: "PASS" | "FAIL" | "MISSING_INFO";
    observedValue: unknown;
    explanation: string;
  }>;
}

export async function submitCase(
  input: SubmitCaseInput
): Promise<SavedDecision> {
  const policyResult = await pool.query<PolicyRow>(
    `SELECT id, status
     FROM policies
     WHERE id = $1`,
    [input.policyId]
  );

  const policy = policyResult.rows[0];

  if (!policy) {
    throw new Error("POLICY_NOT_FOUND");
  }

  if (policy.status !== "active") {
    throw new Error("POLICY_NOT_ACTIVE");
  }

  const rulesResult = await pool.query<RuleRow>(
    `SELECT id, logical_rule_id, version, name, rule_type,
            target_field, operator, threshold_json,
            evidence_passage, status, policy_version_id
     FROM policy_rules
     WHERE policy_version_id = $1
       AND status != 'retired'
     ORDER BY logical_rule_id, version`,
    [policy.id]
  );

  const rules = rulesResult.rows;

  const evaluation = evaluateDecision(rules, input.applicantData);

  const now = new Date().toISOString();
  const caseId = randomUUID();
  const decisionId = randomUUID();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO cases
       (id, policy_version_id, applicant_data_json, submitted_by, submitted_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        caseId,
        policy.id,
        JSON.stringify(input.applicantData),
        input.submittedBy,
        now,
      ]
    );

    await client.query(
      `INSERT INTO decisions
       (id, case_id, policy_version_id, recommendation,
        escalation_reasons_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        decisionId,
        caseId,
        policy.id,
        evaluation.recommendation,
        JSON.stringify(evaluation.escalationReasons),
        now,
      ]
    );

    const resultsByRuleId = new Map(
      evaluation.ruleResults.map((result) => [result.ruleId, result])
    );

    for (const rule of rules) {
      const snapshotId = randomUUID();

      await client.query(
        `INSERT INTO decision_rule_snapshots
         (id, decision_id, source_rule_id, logical_rule_id,
          rule_version, rule_name, rule_type, target_field,
          operator, threshold_json, evidence_passage, rule_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          snapshotId,
          decisionId,
          rule.id,
          rule.logical_rule_id,
          rule.version,
          rule.name,
          rule.rule_type,
          rule.target_field,
          rule.operator,
          rule.threshold_json,
          rule.evidence_passage,
          rule.status,
        ]
      );

      const result = resultsByRuleId.get(rule.id);

      if (result) {
        await client.query(
          `INSERT INTO rule_results
           (id, decision_id, snapshot_id, result,
            observed_value_json, explanation)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            decisionId,
            snapshotId,
            result.status,
            JSON.stringify(result.observedValue ?? null),
            result.explanation,
          ]
        );
      }
    }

    await client.query(
      `INSERT INTO audit_events
       (id, event_type, actor_id, summary, details_json, created_at)
       VALUES ($1, 'case-submitted', $2, $3, $4, $5)`,
      [
        randomUUID(),
        input.submittedBy,
        `Case ${caseId} evaluated as ${evaluation.recommendation}`,
        JSON.stringify({
          caseId,
          decisionId,
          policyVersionId: policy.id,
          recommendation: evaluation.recommendation,
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

  return {
    id: decisionId,
    caseId,
    policyVersionId: policy.id,
    recommendation: evaluation.recommendation,
    escalationReasons: evaluation.escalationReasons,
    ruleResults: evaluation.ruleResults,
  };
}