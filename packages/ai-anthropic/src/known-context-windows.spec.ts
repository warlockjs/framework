import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";
import { AnthropicModel } from "./model";

describe("inferContextWindow (anthropic)", () => {
  it("knows documented 200K models, with platform prefixes and dated suffixes", () => {
    expect(inferContextWindow("claude-haiku-4-5-20251001")).toBe(200_000);
    expect(inferContextWindow("us.anthropic.claude-sonnet-4-5-v1:0")).toBe(200_000);
  });

  it("leaves unknown models unset", () => {
    expect(inferContextWindow("claude-opus-4-7")).toBeUndefined();
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
