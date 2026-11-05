import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("known chat models (bedrock)", () => {
  it.each([
    "anthropic.claude-sonnet-4-5-20250929-v1:0",
    "global.anthropic.claude-sonnet-4-6",
    "anthropic.claude-opus-4-5-20251101-v1:0",
    "anthropic.claude-opus-4-8",
    "anthropic.claude-haiku-4-5-20251001-v1:0",
    "anthropic.claude-3-7-sonnet-20250219-v1:0",
    "anthropic.claude-3-5-sonnet-20240620-v1:0",
    "anthropic.claude-opus-5",
    "anthropic.claude-sonnet-5-5",
    "anthropic.claude-fable-5-1",
    "us.amazon.nova-pro-v1:0",
    "us.amazon.nova-lite-v1:0",
    "us.amazon.nova-micro-v1:0",
    "amazon.nova-premier-v1:0",
    "meta.llama3-1-8b-instruct-v1:0",
    "us.meta.llama3-3-70b-instruct-v1:0",
    "us.meta.llama4-scout-17b-instruct-v1:0",
    "mistral.mistral-large-2407-v1:0",
    "cohere.command-r-plus-v1:0",
  ])("reports a positive window for %s", (name) => {
    expect(inferContextWindow(name)).toBeGreaterThan(0);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("some-unlisted-model")).toBeUndefined();
  });

  it("surfaces on capabilities, with the config value winning", async () => {
    const { BedrockModel } = await import("./model");
    const client = {} as never;

    expect(
      new BedrockModel(client, { name: "us.amazon.nova-pro-v1:0" }).capabilities.contextWindow,
    ).toBe(300_000);
    expect(
      new BedrockModel(client, { name: "us.amazon.nova-pro-v1:0", contextWindow: 50_000 })
        .capabilities.contextWindow,
    ).toBe(50_000);
  });
});
