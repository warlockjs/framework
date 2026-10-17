import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { inferMaxOutputTokens } from "./known-output-limits";
import { AnthropicModel } from "./model";

const client = {} as Anthropic;
const messages = [{ role: "user" as const, content: "hi" }];

function maxTokens(
  name: string,
  options: Parameters<AnthropicModel["buildRequest"]>[1] = {},
  config: { maxTokens?: number; maxOutputTokens?: number } = {},
): unknown {
  return new AnthropicModel(client, { name, ...config }).buildRequest(messages, options).body
    .max_tokens;
}

describe("inferMaxOutputTokens", () => {
  it.each([
    ["claude-fable-5-1", 128_000],
    ["claude-mythos-5-1", 128_000],
    ["claude-opus-5-5", 128_000],
    ["claude-opus-5", 128_000],
    ["claude-sonnet-5-5", 128_000],
    ["claude-haiku-5-5", 128_000],
    ["claude-opus-4-8", 128_000],
    ["claude-opus-4-7", 128_000],
    ["claude-opus-4-6", 128_000],
    ["claude-sonnet-4-6", 128_000],
    ["claude-opus-4-5-20251101", 64_000],
    ["claude-sonnet-4-5", 64_000],
    ["claude-haiku-4-5-20251001", 64_000],
    ["claude-haiku-4-5@20251001", 64_000],
    ["anthropic.claude-haiku-4-5", 64_000],
    ["us.anthropic.claude-opus-4-5-20251101-v1:0", 64_000],
  ])("knows %s → %i", (name, limit) => {
    expect(inferMaxOutputTokens(name)).toBe(limit);
  });

  it.each(["claude-3-haiku-20240307", "claude-opus-4-1", "claude-opus-4", "my-gateway/model"])(
    "has no entry for %s",
    (name) => {
      expect(inferMaxOutputTokens(name)).toBeUndefined();
    },
  );
});

describe("AnthropicModel default max_tokens", () => {
  it("streams with the model's documented max output", () => {
    expect(maxTokens("claude-opus-5-5", { stream: true })).toBe(128_000);
    expect(maxTokens("claude-haiku-4-5", { stream: true })).toBe(64_000);
  });

  it("uses 16384 for a non-streaming request, capped by the model", () => {
    expect(maxTokens("claude-opus-5-5")).toBe(16_384);
    expect(maxTokens("claude-opus-5-5", { stream: false })).toBe(16_384);
  });

  it("uses 16384 for an unknown model whether streaming or not", () => {
    expect(maxTokens("my-gateway/model", { stream: true })).toBe(16_384);
    expect(maxTokens("my-gateway/model")).toBe(16_384);
  });

  it("honours a configured maxOutputTokens for an unrecognised id", () => {
    expect(maxTokens("my-gateway/opus", { stream: true }, { maxOutputTokens: 128_000 })).toBe(
      128_000,
    );
    expect(maxTokens("my-gateway/small", {}, { maxOutputTokens: 8192 })).toBe(8192);
  });

  it("keeps the thinking budget plus answer room, within the model's limit", () => {
    // Budget-mode Haiku 4.5, effort max → budget 32000 + 4096 answer room.
    expect(maxTokens("claude-haiku-4-5", { reasoning: { effort: "max" } })).toBe(36_096);
    // An unknown id has no limit to clamp to.
    expect(maxTokens("my-gateway/model", { stream: true, reasoning: { maxTokens: 20_000 } })).toBe(
      24_096,
    );
    // Streaming on a known model: the documented max already covers it.
    expect(maxTokens("claude-haiku-4-5", { stream: true, reasoning: { effort: "max" } })).toBe(
      64_000,
    );
  });

  it("never overrides an explicit maxTokens", () => {
    expect(maxTokens("claude-opus-5-5", { stream: true, maxTokens: 2000 })).toBe(2000);
    expect(maxTokens("claude-opus-5-5", { stream: true }, { maxTokens: 3000 })).toBe(3000);
  });
});
