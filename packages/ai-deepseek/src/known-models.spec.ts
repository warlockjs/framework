import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_CHAT_MODELS,
  inferReasoningCapability,
  inferVisionCapability,
} from "./known-models";

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
  it("lists the documented chat surfaces", () => {
    expect(DEEPSEEK_CHAT_MODELS).toContain("deepseek-chat");
    expect(DEEPSEEK_CHAT_MODELS).toContain("deepseek-reasoner");
  });
});
