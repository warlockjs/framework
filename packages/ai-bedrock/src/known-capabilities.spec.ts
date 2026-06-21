import { describe, expect, it } from "vitest";
import {
  inferPdfCapability,
  inferPromptCachingCapability,
  inferReasoningCapability,
} from "./known-capabilities";

describe("inferReasoningCapability", () => {
  it("returns true for Claude 3.7 and Claude 4 families across inference-profile prefixes", () => {
    expect(inferReasoningCapability("anthropic.claude-3-7-sonnet-20250219-v1:0")).toBe(true);
    expect(inferReasoningCapability("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(true);
    expect(inferReasoningCapability("anthropic.claude-opus-4-20250514-v1:0")).toBe(true);
    expect(inferReasoningCapability("eu.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(inferReasoningCapability("US.ANTHROPIC.CLAUDE-3-7-SONNET-20250219-V1:0")).toBe(true);
  });

  it("returns false for non-reasoning families and unknown ids", () => {
    // Claude 3 / 3.5 have no configurable thinking budget on Converse.
    expect(inferReasoningCapability("anthropic.claude-3-5-sonnet-20240620-v1:0")).toBe(false);
    expect(inferReasoningCapability("us.amazon.nova-pro-v1:0")).toBe(false);
    expect(inferReasoningCapability("meta.llama3-1-8b-instruct-v1:0")).toBe(false);
    expect(inferReasoningCapability("")).toBe(false);
  });
});

describe("inferPromptCachingCapability", () => {
  it("returns true for Claude 3.5+/3.7/4 and Nova families", () => {
    expect(inferPromptCachingCapability("anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(true);
    expect(inferPromptCachingCapability("anthropic.claude-3-7-sonnet-20250219-v1:0")).toBe(true);
    expect(inferPromptCachingCapability("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(true);
    expect(inferPromptCachingCapability("anthropic.claude-opus-4-20250514-v1:0")).toBe(true);
    expect(inferPromptCachingCapability("us.amazon.nova-pro-v1:0")).toBe(true);
    expect(inferPromptCachingCapability("eu.amazon.nova-lite-v1:0")).toBe(true);
    expect(inferPromptCachingCapability("amazon.nova-micro-v1:0")).toBe(true);
  });

  it("returns false for text-only families and unknown ids", () => {
    expect(inferPromptCachingCapability("meta.llama3-1-8b-instruct-v1:0")).toBe(false);
    expect(inferPromptCachingCapability("amazon.titan-text-express-v1")).toBe(false);
    expect(inferPromptCachingCapability("cohere.command-r-v1:0")).toBe(false);
    expect(inferPromptCachingCapability("")).toBe(false);
  });
});

describe("inferPdfCapability", () => {
  it("returns true for multimodal Claude 3+ and Nova families", () => {
    expect(inferPdfCapability("anthropic.claude-3-5-sonnet-20240620-v1:0")).toBe(true);
    expect(inferPdfCapability("anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(true);
    expect(inferPdfCapability("us.amazon.nova-pro-v1:0")).toBe(true);
    expect(inferPdfCapability("amazon.nova-premier-v1:0")).toBe(true);
  });

  it("returns false for image-only Llama, text-only families, and unknown ids", () => {
    // Llama on Bedrock takes images but not Converse document blocks.
    expect(inferPdfCapability("meta.llama3-2-90b-instruct-v1:0")).toBe(false);
    expect(inferPdfCapability("meta.llama4-scout-17b-instruct-v1:0")).toBe(false);
    expect(inferPdfCapability("amazon.titan-text-express-v1")).toBe(false);
    expect(inferPdfCapability("")).toBe(false);
  });
});
