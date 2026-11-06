import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_CHAT_MODELS,
  inferReasoningCapability,
  inferVisionCapability,
} from "./known-models";
import { deepseekLifecycleFor } from "./known-lifecycle";
import { DEEPSEEK_DEFAULT_PRICING, DEEPSEEK_DEFAULT_PRICING_AS_OF } from "./sdk";

describe("inferReasoningCapability", () => {
  it("recognizes the dedicated thinking surface", () => {
    expect(inferReasoningCapability("deepseek-reasoner")).toBe(true);
  });

  it("recognizes the v4 pro tier", () => {
    expect(inferReasoningCapability("deepseek-v4-pro")).toBe(true);
  });

  it("treats the non-thinking surfaces as non-reasoning", () => {
    expect(inferReasoningCapability("deepseek-chat")).toBe(false);
    expect(inferReasoningCapability("deepseek-v4-flash")).toBe(false);
  });

  it("is case-insensitive and tolerates suffixes", () => {
    expect(inferReasoningCapability("DeepSeek-Reasoner")).toBe(true);
    expect(inferReasoningCapability("deepseek-reasoner-2026-06")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(inferReasoningCapability("some-other-model")).toBe(false);
  });
});

describe("inferVisionCapability", () => {
  it("returns false for every DeepSeek model (no documented vision support)", () => {
    expect(inferVisionCapability("deepseek-chat")).toBe(false);
    expect(inferVisionCapability("deepseek-reasoner")).toBe(false);
    expect(inferVisionCapability("deepseek-v4-flash")).toBe(false);
    expect(inferVisionCapability("deepseek-v4-pro")).toBe(false);
  });
});

describe("DEEPSEEK_CHAT_MODELS", () => {
  it("lists the current chat surfaces and none of the retired names", () => {
    expect(DEEPSEEK_CHAT_MODELS).toContain("deepseek-flash");
    expect(DEEPSEEK_CHAT_MODELS).toContain("deepseek-v4-pro");
    expect(DEEPSEEK_CHAT_MODELS).not.toContain("deepseek-chat");
    expect(DEEPSEEK_CHAT_MODELS).not.toContain("deepseek-reasoner");
  });

  it("gives every listed model a status", () => {
    for (const id of DEEPSEEK_CHAT_MODELS) {
      expect(deepseekLifecycleFor(id)?.status).toBe("current");
    }
  });

  it("records the retired names", () => {
    expect(deepseekLifecycleFor("deepseek-chat")).toEqual({
      status: "retired",
      retiresOn: "2026-07-24",
      replacement: "deepseek-v4-flash",
    });
    expect(deepseekLifecycleFor("deepseek-reasoner")?.status).toBe("retired");
    expect(deepseekLifecycleFor("deepseek-v4-flash")?.replacement).toBe("deepseek-flash");
    expect(deepseekLifecycleFor("nope")).toBeUndefined();
  });
});

describe("DeepSeek priced models", () => {
  it("dates the table and gives every priced model a status", () => {
    expect(DEEPSEEK_DEFAULT_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    for (const id of Object.keys(DEEPSEEK_DEFAULT_PRICING)) {
      expect(deepseekLifecycleFor(id)).toBeDefined();
    }
  });
});
