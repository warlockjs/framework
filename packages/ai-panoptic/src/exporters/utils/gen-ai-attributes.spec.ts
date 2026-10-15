import { describe, expect, it } from "vitest";
import { makeSpan } from "../test-support/make-trace";
import {
  GEN_AI_ATTRIBUTES,
  toGenAiAttributes,
  WARLOCK_ATTRIBUTES,
} from "./gen-ai-attributes";

describe("toGenAiAttributes", () => {
  it("should map token usage onto GenAI convention keys", () => {
    const span = makeSpan({ usage: { input: 150, output: 320, total: 470 } });

    const attributes = toGenAiAttributes(span);

    expect(attributes[GEN_AI_ATTRIBUTES.usageInputTokens]).toBe(150);
    expect(attributes[GEN_AI_ATTRIBUTES.usageOutputTokens]).toBe(320);
    expect(attributes[WARLOCK_ATTRIBUTES.totalTokens]).toBe(470);
  });

  it("should carry report type and duration as warlock attributes", () => {
    const span = makeSpan({ type: "workflow", duration: 2500 });

    const attributes = toGenAiAttributes(span);

    expect(attributes[WARLOCK_ATTRIBUTES.reportType]).toBe("workflow");
    expect(attributes[WARLOCK_ATTRIBUTES.durationMs]).toBe(2500);
  });

  it("should map sessionId onto the conversation id", () => {
    const span = makeSpan({ sessionId: "session-42" });

    const attributes = toGenAiAttributes(span);

    expect(attributes[GEN_AI_ATTRIBUTES.conversationId]).toBe("session-42");
  });

  it("should include cached and reasoning token counts only when present", () => {
    const withExtra = toGenAiAttributes(
      makeSpan({
        usage: { input: 150, output: 320, total: 470, cachedTokens: 50, reasoningTokens: 80 },
      }),
    );
    const withoutExtra = toGenAiAttributes(makeSpan());

    expect(withExtra[WARLOCK_ATTRIBUTES.cachedTokens]).toBe(50);
    expect(withExtra[WARLOCK_ATTRIBUTES.reasoningTokens]).toBe(80);
    expect(withoutExtra[WARLOCK_ATTRIBUTES.cachedTokens]).toBeUndefined();
    expect(withoutExtra[WARLOCK_ATTRIBUTES.reasoningTokens]).toBeUndefined();
  });

  it("should compute total cost when a cost breakdown is present", () => {
    const span = makeSpan({
      usage: { input: 150, output: 320, total: 470, cost: { input: 0.01, output: 0.04 } },
    });

    const attributes = toGenAiAttributes(span);

    expect(attributes[WARLOCK_ATTRIBUTES.costUsd]).toBeCloseTo(0.05, 10);
  });

  it("should forward scalar free-form attributes and skip non-scalars", () => {
    const span = makeSpan({
      attributes: {
        "gen_ai.request.model": "gpt-4o-mini",
        "gen_ai.system": "openai",
        toolArgs: { nested: true },
        history: [1, 2, 3],
      },
    });

    const attributes = toGenAiAttributes(span);

    expect(attributes[GEN_AI_ATTRIBUTES.requestModel]).toBe("gpt-4o-mini");
    expect(attributes[GEN_AI_ATTRIBUTES.system]).toBe("openai");
    expect(attributes.toolArgs).toBeUndefined();
    expect(attributes.history).toBeUndefined();
  });

  it("should let an explicit collector attribute override a derived value", () => {
    const span = makeSpan({
      type: "agent",
      attributes: { [WARLOCK_ATTRIBUTES.reportType]: "supervisor" },
    });

    const attributes = toGenAiAttributes(span);

    expect(attributes[WARLOCK_ATTRIBUTES.reportType]).toBe("supervisor");
  });
});
