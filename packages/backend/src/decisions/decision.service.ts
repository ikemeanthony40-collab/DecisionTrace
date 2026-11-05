

export type DecisionRecommendation = "APPROVED" | "DENIED" | "ESCALATED";
export type RuleResultStatus = "PASS" | "FAIL" | "MISSING_INFO";

export interface EvaluationRule {
  id: string;
  logical_rule_id: string;
  version: number;
  name: string;
  rule_type: "required-field" | "numeric-threshold" | "date-condition";
  target_field: string;
  operator: string;
  threshold_json: string | null;
  evidence_passage: string;
  status: "extracted" | "validated" | "retired";
}

export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  status: RuleResultStatus;
  observedValue: unknown;
  explanation: string;
}

export interface DecisionEvaluation {
  recommendation: DecisionRecommendation;
  escalationReasons: string[];
  ruleResults: RuleEvaluation[];
}

function isMissing(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function isStrictNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseThreshold(value: string | null): unknown {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("A rule contains invalid threshold data.");
  }
}

export function evaluateDecision(
  rules: EvaluationRule[],
  applicantData: Record<string, unknown>
): DecisionEvaluation {
  const ruleResults: RuleEvaluation[] = [];
  const escalationReasons: string[] = [];

  const activeRules = rules.filter((rule) => rule.status !== "retired");

  if (activeRules.length === 0) {
    escalationReasons.push("No active policy rules are available.");
  }

  for (const rule of activeRules) {
    if (rule.status === "extracted") {
      escalationReasons.push(
        `Rule "${rule.name}" has not been validated.`
      );
    }

    const value = applicantData[rule.target_field];

    if (isMissing(value)) {
      ruleResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: "MISSING_INFO",
        observedValue: value ?? null,
        explanation: `Required information for "${rule.target_field}" is missing.`,
      });

      escalationReasons.push(
        `Missing information: ${rule.target_field}.`
      );

      continue;
    }

    if (rule.rule_type === "required-field") {
      ruleResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: "PASS",
        observedValue: value,
        explanation: `"${rule.target_field}" has been supplied.`,
      });

      continue;
    }

    const threshold = parseThreshold(rule.threshold_json);

    if (threshold === null || threshold === undefined) {
      escalationReasons.push(
        `Rule "${rule.name}" has no usable threshold.`
      );

      continue;
    }

    if (rule.rule_type === "numeric-threshold") {
      if (!isStrictNumber(value) || !isStrictNumber(threshold)) {
        escalationReasons.push(
          `Rule "${rule.name}" requires a valid numeric value.`
        );

        ruleResults.push({
          ruleId: rule.id,
          ruleName: rule.name,
          status: "MISSING_INFO",
          observedValue: value,
          explanation: `A valid number is required for "${rule.target_field}".`,
        });

        continue;
      }

      const passed =
        rule.operator === ">="
          ? value >= threshold
          : rule.operator === "<="
            ? value <= threshold
            : rule.operator === ">"
              ? value > threshold
              : rule.operator === "<"
                ? value < threshold
                : false;

      ruleResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: passed ? "PASS" : "FAIL",
        observedValue: value,
        explanation: passed
          ? `${value} satisfies the threshold ${rule.operator} ${threshold}.`
          : `${value} does not satisfy the threshold ${rule.operator} ${threshold}.`,
      });

      continue;
    }

    if (rule.rule_type === "date-condition") {
      if (!isRealIsoDate(value) || !isRealIsoDate(threshold)) {
        escalationReasons.push(
          `Rule "${rule.name}" requires a valid YYYY-MM-DD date.`
        );

        ruleResults.push({
          ruleId: rule.id,
          ruleName: rule.name,
          status: "MISSING_INFO",
          observedValue: value,
          explanation: `A valid date is required for "${rule.target_field}".`,
        });

        continue;
      }

      const passed =
        rule.operator === ">="
          ? value >= threshold
          : rule.operator === "<="
            ? value <= threshold
            : rule.operator === ">"
              ? value > threshold
              : rule.operator === "<"
                ? value < threshold
                : false;

      ruleResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: passed ? "PASS" : "FAIL",
        observedValue: value,
        explanation: passed
          ? `${value} satisfies the date condition ${rule.operator} ${threshold}.`
          : `${value} does not satisfy the date condition ${rule.operator} ${threshold}.`,
      });

      continue;
    }

    escalationReasons.push(
      `Rule "${rule.name}" uses an unsupported rule type.`
    );
  }

  const hasFailure = ruleResults.some(
    (result) => result.status === "FAIL"
  );

  const hasMissingInfo = ruleResults.some(
    (result) => result.status === "MISSING_INFO"
  );

  let recommendation: DecisionRecommendation;

  if (escalationReasons.length > 0 || hasMissingInfo) {
    recommendation = "ESCALATED";
  } else if (hasFailure) {
    recommendation = "DENIED";
  } else {
    recommendation = "APPROVED";
  }

  return {
    recommendation,
    escalationReasons: [...new Set(escalationReasons)],
    ruleResults,
  };
}