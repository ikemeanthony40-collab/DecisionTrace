
import { describe, expect, it } from "vitest";
import {
  evaluateDecision,
  type EvaluationRule,
} from "../src/decisions/decision.service.js";

function makeRule(
  overrides: Partial<EvaluationRule> = {}
): EvaluationRule {
  return {
    id: "rule-1",
    logical_rule_id: "logical-rule-1",
    version: 1,
    name: "Test rule",
    rule_type: "required-field",
    target_field: "applicant_name",
    operator: "exists",
    threshold_json: null,
    evidence_passage: "Applicant name must be provided.",
    status: "validated",
    ...overrides,
  };
}

describe("evaluateDecision - required-field rules", () => {
  it("passes when the required field is supplied", () => {
    const result = evaluateDecision(
      [makeRule()],
      { applicant_name: "Jane Doe" }
    );

    expect(result.ruleResults[0].status).toBe("PASS");
    expect(result.recommendation).toBe("APPROVED");
  });

  it("returns MISSING_INFO when the required field is absent", () => {
    const result = evaluateDecision([makeRule()], {});

    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
    expect(result.recommendation).toBe("ESCALATED");
  });

  it("treats a whitespace-only required field as missing", () => {
    const result = evaluateDecision(
      [makeRule()],
      { applicant_name: "   " }
    );

    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
    expect(result.recommendation).toBe("ESCALATED");
  });
});

describe("evaluateDecision - numeric-threshold rules", () => {
  const numericRule = makeRule({
    rule_type: "numeric-threshold",
    target_field: "funding",
    operator: ">=",
    threshold_json: "10000",
  });

  it("passes when the numeric value meets the threshold", () => {
    const result = evaluateDecision(
      [numericRule],
      { funding: 12000 }
    );

    expect(result.ruleResults[0].status).toBe("PASS");
    expect(result.recommendation).toBe("APPROVED");
  });

  it("fails when the numeric value does not meet the threshold", () => {
    const result = evaluateDecision(
      [numericRule],
      { funding: 5000 }
    );

    expect(result.ruleResults[0].status).toBe("FAIL");
    expect(result.recommendation).toBe("DENIED");
  });

  it("returns MISSING_INFO when the numeric field is absent", () => {
    const result = evaluateDecision([numericRule], {});

    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
    expect(result.recommendation).toBe("ESCALATED");
  });

  it("returns MISSING_INFO when the supplied value is not numeric", () => {
    const result = evaluateDecision(
      [numericRule],
      { funding: "twelve thousand" }
    );

    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
    expect(result.recommendation).toBe("ESCALATED");
  });
});

describe("evaluateDecision - date-condition rules", () => {
  const dateRule = makeRule({
    rule_type: "date-condition",
    target_field: "submission_date",
    operator: ">=",
    threshold_json: '"2026-01-01"',
  });

  it("passes when the date meets the condition", () => {
    const result = evaluateDecision(
      [dateRule],
      { submission_date: "2026-02-15" }
    );

    expect(result.ruleResults[0].status).toBe("PASS");
    expect(result.recommendation).toBe("APPROVED");
  });

  it("fails when the date does not meet the condition", () => {
    const result = evaluateDecision(
      [dateRule],
      { submission_date: "2025-12-15" }
    );

    expect(result.ruleResults[0].status).toBe("FAIL");
    expect(result.recommendation).toBe("DENIED");
  });

  it("returns MISSING_INFO when the date is absent", () => {
    const result = evaluateDecision([dateRule], {});

    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
    expect(result.recommendation).toBe("ESCALATED");
  });

  it("returns MISSING_INFO when the date is invalid", () => {
    const result = evaluateDecision(
      [dateRule],
      { submission_date: "2026-02-30" }
    );

    expect(result.ruleResults[0].status).toBe("MISSING_INFO");
    expect(result.recommendation).toBe("ESCALATED");
  });
});

describe("evaluateDecision - recommendation rules", () => {
  it("escalates when a rule has not been validated", () => {
    const extractedRule = makeRule({
      status: "extracted",
    });

    const result = evaluateDecision(
      [extractedRule],
      { applicant_name: "Jane Doe" }
    );

    expect(result.ruleResults[0].status).toBe("PASS");
    expect(result.recommendation).toBe("ESCALATED");
  });

  it("escalates when there are no active rules", () => {
    const retiredRule = makeRule({
      status: "retired",
    });

    const result = evaluateDecision(
      [retiredRule],
      { applicant_name: "Jane Doe" }
    );

    expect(result.recommendation).toBe("ESCALATED");
    expect(result.ruleResults).toHaveLength(0);
  });

  it("escalates when a rule has no usable threshold", () => {
    const rule = makeRule({
      rule_type: "numeric-threshold",
      target_field: "funding",
      operator: ">=",
      threshold_json: null,
    });

    const result = evaluateDecision(
      [rule],
      { funding: 12000 }
    );

    expect(result.recommendation).toBe("ESCALATED");
  });
});
