import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";
import { AnthropicModel } from "./model";

describe("inferContextWindow (anthropic)", () => {
  it("knows documented 200K models, with platform prefixes and dated suffixes", () => {
    expect(inferContextWindow("claude-haiku-4-5-20251001")).toBe(200_000);
    expect(inferContextWindow("us.anthropic.claude-sonnet-4-5-v1:0")).toBe(200_000);
  });

  it.each([
    ["claude-fable-5-1", 1_000_000],
    ["claude-fable-5", 1_000_000],
    ["claude-mythos-5-1", 1_000_000],
    ["claude-opus-5-5", 1_000_000],
    ["claude-opus-5", 1_000_000],
    ["claude-opus-4-8", 1_000_000],
    ["claude-opus-4-7", 1_000_000],
    ["claude-opus-4-6", 1_000_000],
    ["claude-opus-4-5", 200_000],
    ["claude-opus-4-1", 200_000],
    ["claude-opus-4", 200_000],
    ["claude-sonnet-5-5", 1_000_000],
    ["claude-sonnet-5", 1_000_000],
    ["claude-sonnet-4-6", 1_000_000],
    ["claude-sonnet-4-5", 200_000],
    ["claude-sonnet-4", 200_000],
    ["claude-haiku-5-5", 1_000_000],
    ["claude-haiku-4-5", 200_000],
    ["claude-3-7-sonnet-20250219", 200_000],
    ["claude-3-5-haiku-20241022", 200_000],
    ["claude-3-haiku-20240307", 200_000],
  ])("reports a positive window for %s", (name, window) => {
    const client = {} as never;

    expect(new AnthropicModel(client, { name }).capabilities.contextWindow).toBe(window);
  });

  it("leaves unknown models unset", () => {
    expect(inferContextWindow("claude-unreleased-9")).toBeUndefined();
    expect(inferContextWindow("my-gateway/model")).toBeUndefined();
  });

  it("surfaces on capabilities, with the config value winning", () => {
    const client = {} as never;

    expect(
      new AnthropicModel(client, { name: "claude-haiku-4-5" }).capabilities.contextWindow,
    ).toBe(200_000);
    expect(
      new AnthropicModel(client, { name: "claude-haiku-4-5", contextWindow: 500_000 }).capabilities
        .contextWindow,
    ).toBe(500_000);
    expect(new AnthropicModel(client, { name: "proxy" }).capabilities).not.toHaveProperty(
      "contextWindow",
    );
  });
});
