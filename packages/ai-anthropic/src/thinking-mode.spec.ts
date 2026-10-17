import { describe, expect, it } from "vitest";
import {
  acceptsBetweenTools,
  acceptsTemperature,
  inferThinkingMode,
  noReasoningForm,
} from "./thinking-mode";

describe("inferThinkingMode", () => {
  it("returns 'adaptive' for the models that reject budget_tokens", () => {
    for (const name of [
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-sonnet-5-5",
      "claude-fable-5",
      "claude-fable-5-1",
      "claude-mythos-5-1",
    ]) {
      expect(inferThinkingMode(name), name).toBe("adaptive");
    }
  });

  it("returns 'budget' for Haiku 4.5, the 4.6 pair, and every older family", () => {
    for (const name of [
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "claude-opus-4-1",
      "claude-opus-4-1-20250805",
      "claude-opus-4-0",
      "claude-opus-4-20250514",
      "claude-opus-4",
      "claude-sonnet-4-0",
      "claude-sonnet-4-20250514",
      "claude-sonnet-4",
      "claude-haiku-4",
      "claude-3-haiku-20240307",
      "claude-3-5-sonnet-latest",
      "claude-3-7-sonnet-20250219",
      "claude-2.1",
      "claude-instant-1.2",
    ]) {
      expect(inferThinkingMode(name), name).toBe("budget");
    }
  });

  it("defaults unknown and future model ids to 'adaptive'", () => {
    expect(inferThinkingMode("claude-opus-6")).toBe("adaptive");
    expect(inferThinkingMode("claude-haiku-5")).toBe("adaptive");
    expect(inferThinkingMode("custom-proxy-llm")).toBe("adaptive");
  });

  it("is case-insensitive", () => {
    expect(inferThinkingMode("CLAUDE-HAIKU-4-5")).toBe("budget");
    expect(inferThinkingMode("Claude-Opus-5-5")).toBe("adaptive");
  });

  it("does not let a 4.6 budget prefix swallow a later 4.x release", () => {
    // `claude-opus-4-6` must not match as a prefix of e.g. a dated 4.7 id,
    // and the bare `claude-opus-4` entry must stay an exact match.
    expect(inferThinkingMode("claude-opus-4-7-20260101")).toBe("adaptive");
    expect(inferThinkingMode("claude-opus-4-8")).toBe("adaptive");
  });
});

describe("acceptsTemperature", () => {
  it("is true only for budget-mode models", () => {
    expect(acceptsTemperature("budget")).toBe(true);
    expect(acceptsTemperature("adaptive")).toBe(false);
  });
});

describe("acceptsBetweenTools", () => {
  it("is true for Claude Sonnet 5.5 ids, dated, tagged or platform-prefixed", () => {
    for (const name of [
      "claude-sonnet-5-5",
      "Claude-Sonnet-5-5",
      "claude-sonnet-5-5-20260901",
      "claude-sonnet-5-5-latest",
      "claude-sonnet-5-5@20260901",
      "anthropic.claude-sonnet-5-5",
    ]) {
      expect(acceptsBetweenTools(name), name).toBe(true);
    }
  });

  it("is false for every model without a documented between_tools form", () => {
    for (const name of [
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-sonnet-5-6",
      "claude-haiku-5-5",
      "claude-haiku-4-5",
      "claude-some-future-model",
    ]) {
      expect(acceptsBetweenTools(name), name).toBe(false);
    }
  });
});

describe("noReasoningForm", () => {
  it("maps each Claude 5-family release to its thinking-off form", () => {
    const expected: Array<[string, ReturnType<typeof noReasoningForm>]> = [
      ["claude-sonnet-5-5", "between_tools"],
      ["claude-sonnet-5", "disabled"],
      ["claude-sonnet-5-20260301", "disabled"],
      ["anthropic.claude-sonnet-5", "disabled"],
      ["claude-haiku-5-5", "disabled"],
      ["Claude-Haiku-5-5", "disabled"],
      ["us.anthropic.claude-haiku-5-5", "disabled"],
      ["claude-opus-5", "lowest-effort"],
      ["claude-opus-5@20260301", "lowest-effort"],
      ["claude-opus-5-5", "omit"],
      ["claude-fable-5-1", "omit"],
      ["claude-fable-5", "omit"],
      ["claude-opus-4-8", "omit"],
      ["claude-haiku-4-5", "omit"],
      ["claude-sonnet-5-6", "omit"],
      ["claude-haiku-5", "omit"],
    ];

    for (const [name, form] of expected) {
      expect(noReasoningForm(name), name).toBe(form);
    }
  });
});
