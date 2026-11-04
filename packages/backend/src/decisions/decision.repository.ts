import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";
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

export function submitCase(input: SubmitCaseInput): SavedDecision {
  const policy = db
    .prepare(
      `SELECT id, status
       FROM policies
       WHERE id = ?`
    )
    .get(input.policyId) as PolicyRow | undefined;

  if (!policy) {
    throw new Error("POLICY_NOT_FOUND");
  }

  if (policy.status !== "active") {
    throw new Error("POLICY_NOT_ACTIVE");
  }

  const rules = db
    .prepare(
      `SELECT id, logical_rule_id, version, name, rule_type,
              target_field, operator, threshold_json,
              evidence_passage, status, policy_version_id
       FROM policy_rules
       WHERE policy_version_id = ?
         AND status != 'retired'
       ORDER BY logical_rule_id, version`
    )
    .all(policy.id) as RuleRow[];

  const evaluation = evaluateDecision(rules, input.applicantData);

  const now = new Date().toISOString();
  const caseId = randomUUID();
  const decisionId = randomUUID();

  const saveTransaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO cases
       (id, policy_version_id, applicant_data_json, submitted_by, submitted_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      caseId,
      policy.id,
      JSON.stringify(input.applicantData),
      input.submittedBy,
      now
    );

    db.prepare(
      `INSERT INTO decisions
       (id, case_id, policy_version_id, recommendation,
        escalation_reasons_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      decisionId,
      caseId,
      policy.id,
      evaluation.recommendation,
      JSON.stringify(evaluation.escalationReasons),
      now
    );

    const insertSnapshot = db.prepare(
      `INSERT INTO decision_rule_snapshots
       (id, decision_id, source_rule_id, logical_rule_id,
        rule_version, rule_name, rule_type, target_field,
        operator, threshold_json, evidence_passage, rule_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertResult = db.prepare(
      `INSERT INTO rule_results
       (id, decision_id, snapshot_id, result,
        observed_value_json, explanation)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const resultsByRuleId = new Map(
      evaluation.ruleResults.map((result) => [result.ruleId, result])
    );

    for (const rule of rules) {
      const snapshotId = randomUUID();

      insertSnapshot.run(
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
        rule.status
      );

      const result = resultsByRuleId.get(rule.id);

      if (result) {
        insertResult.run(
          randomUUID(),
          decisionId,
          snapshotId,
          result.status,
          JSON.stringify(result.observedValue ?? null),
          result.explanation
        );
      }
    }

    db.prepare(
      `INSERT INTO audit_events
       (id, event_type, actor_id, summary, details_json, created_at)
       VALUES (?, 'case-submitted', ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      input.submittedBy,
      `Case ${caseId} evaluated as ${evaluation.recommendation}`,
      JSON.stringify({
        caseId,
        decisionId,
        policyVersionId: policy.id,
        recommendation: evaluation.recommendation,
      }),
      now
    );
  });

  saveTransaction();

  return {
    id: decisionId,
    caseId,
    policyVersionId: policy.id,
    recommendation: evaluation.recommendation,
    escalationReasons: evaluation.escalationReasons,
    ruleResults: evaluation.ruleResults,
  };
}