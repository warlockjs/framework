import { describe, expect, it } from "vitest";
import { DEVTOOLS_AI_ERROR_CATEGORIES } from "../../../src/production/contracts";
import { classifyAiError, emptyErrorCounts } from "../../../src/ai/rollup/categories";

describe("classifyAiError", () => {
  it.each([
    ["PROVIDER_RATE_LIMIT", "rate-limit"],
    ["PROVIDER_QUOTA_EXCEEDED", "rate-limit"],
    ["PROVIDER_OVERLOADED", "rate-limit"],
    ["PROVIDER_TIMEOUT", "timeout"],
    ["CONTENT_FILTER", "refusal"],
    ["GUARDRAIL_VIOLATION", "refusal"],
    ["PROVIDER_ERROR", "provider"],
    ["PROVIDER_INVALID_REQUEST", "provider"],
    ["PROVIDER_AUTH", "provider"],
    ["CONTEXT_LENGTH_EXCEEDED", "provider"],
    ["PROVIDER_EMBEDDING_VECTOR_COUNT_MISMATCH", "provider"],
    ["BUDGET_EXCEEDED", "budget"],
    ["TOOL_EXEC_FAILED", "tool"],
    ["SCHEMA_VALIDATION_FAILED", "schema"],
    ["AGENT_INCOMPLETE", "incomplete"],
    ["AGENT_MAX_TRIPS", "incomplete"],
    ["AgentIncompleteError", "incomplete"],
    ["FetchTimeoutError", "timeout"],
    ["SOMETHING_NEW", "other"],
  ] as const)("failed with %s is %s", (code, category) => {
    expect(classifyAiError("failed", code)).toBe(category);
  });

  it("uses the status for incomplete runs", () => {
    expect(classifyAiError("incomplete", undefined)).toBe("incomplete");
    expect(classifyAiError("max-iterations", "PROVIDER_ERROR")).toBe("incomplete");
  });

  it("answers other without an error type", () => {
    expect(classifyAiError("failed", undefined)).toBe("other");
  });
});

describe("emptyErrorCounts", () => {
  it("has every category at 0", () => {
    const counts = emptyErrorCounts();

    expect(Object.keys(counts)).toEqual([...DEVTOOLS_AI_ERROR_CATEGORIES]);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
});
