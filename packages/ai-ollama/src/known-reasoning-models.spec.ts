import { describe, expect, it } from "vitest";
import { inferReasoningCapability } from "./known-reasoning-models";

describe("inferReasoningCapability", () => {
  it("returns true for thinking-capable Ollama families", () => {
    expect(inferReasoningCapability("deepseek-r1:7b")).toBe(true);
    expect(inferReasoningCapability("qwq:32b")).toBe(true);
    expect(inferReasoningCapability("qwen3:8b")).toBe(true);
    expect(inferReasoningCapability("magistral:24b")).toBe(true);
    expect(inferReasoningCapability("gpt-oss:20b")).toBe(true);
  });

  it("covers every known reasoning family substring", () => {
    expect(inferReasoningCapability("phi4-reasoning:14b")).toBe(true);
    expect(inferReasoningCapability("phi4-mini-reasoning")).toBe(true);
    expect(inferReasoningCapability("cogito:8b")).toBe(true);
    expect(inferReasoningCapability("smallthinker:3b")).toBe(true);
    expect(inferReasoningCapability("exaone-deep:7.8b")).toBe(true);
  });

  it("is case-insensitive and tolerates size/quant suffixes", () => {
    expect(inferReasoningCapability("DeepSeek-R1:70B-Q4_0")).toBe(true);
    expect(inferReasoningCapability("QwQ:32B-Preview")).toBe(true);
    expect(inferReasoningCapability("Qwen3:30B-A3B")).toBe(true);
  });

  it("returns false for plain instruct and unknown tags", () => {
    expect(inferReasoningCapability("llama3.1")).toBe(false);
    expect(inferReasoningCapability("mistral:7b")).toBe(false);
    expect(inferReasoningCapability("phi3")).toBe(false);
    expect(inferReasoningCapability("nomic-embed-text")).toBe(false);
    expect(inferReasoningCapability("")).toBe(false);
  });

  it("does not over-match adjacent non-reasoning families", () => {
    // qwen2.5 is not a thinking model (qwen3 is); phi3 is not (phi4-reasoning is).
    expect(inferReasoningCapability("qwen2.5:14b")).toBe(false);
    expect(inferReasoningCapability("phi4")).toBe(false);
    expect(inferReasoningCapability("llama3.2-vision")).toBe(false);
  });
});
