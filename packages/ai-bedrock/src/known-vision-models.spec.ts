import { describe, expect, it } from "vitest";
import { inferVisionCapability } from "./known-vision-models";

describe("inferVisionCapability", () => {
  it("returns true for multimodal Claude / Nova / Llama families", () => {
    expect(inferVisionCapability("anthropic.claude-3-5-sonnet-20240620-v1:0")).toBe(true);
    expect(inferVisionCapability("anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(true);
    expect(inferVisionCapability("us.amazon.nova-pro-v1:0")).toBe(true);
    expect(inferVisionCapability("eu.amazon.nova-lite-v1:0")).toBe(true);
    expect(inferVisionCapability("meta.llama3-2-90b-instruct-v1:0")).toBe(true);
    expect(inferVisionCapability("us.meta.llama4-scout-17b-instruct-v1:0")).toBe(true);
  });

  it("is case-insensitive and matches across inference-profile prefixes", () => {
    expect(inferVisionCapability("US.ANTHROPIC.CLAUDE-3-7-SONNET-20250219-V1:0")).toBe(true);
  });

  it("matches the remaining vision substrings (opus-4, haiku-4, premier, llama3-2-11b)", () => {
    expect(inferVisionCapability("anthropic.claude-opus-4-20250514-v1:0")).toBe(true);
    expect(inferVisionCapability("anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(true);
    expect(inferVisionCapability("amazon.nova-premier-v1:0")).toBe(true);
    expect(inferVisionCapability("us.meta.llama3-2-11b-instruct-v1:0")).toBe(true);
  });

  it("matches an apac inference-profile prefix", () => {
    expect(inferVisionCapability("apac.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(true);
  });

  it("does not match a bare claude-2 id (no covered substring)", () => {
    // Only claude-3 and claude-{sonnet,opus,haiku}-4 are covered; legacy
    // Claude 2 has no vision substring.
    expect(inferVisionCapability("anthropic.claude-v2:1")).toBe(false);
  });

  it("matches when the substring is embedded mid-id", () => {
    // The check is a plain substring scan, not an anchored prefix match.
    expect(inferVisionCapability("custom-profile.nova-pro.fine-tuned")).toBe(true);
  });

  it("returns false for text-only families and unknown ids", () => {
    expect(inferVisionCapability("meta.llama3-1-8b-instruct-v1:0")).toBe(false);
    expect(inferVisionCapability("amazon.titan-text-express-v1")).toBe(false);
    expect(inferVisionCapability("mistral.mistral-7b-instruct-v0:2")).toBe(false);
    expect(inferVisionCapability("cohere.command-r-v1:0")).toBe(false);
    expect(inferVisionCapability("")).toBe(false);
  });
});
