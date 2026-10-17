import type { Usage } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { applyAnthropicCacheUsage, requestCacheTtl } from "./cache-usage";

function emptyUsage(): Usage {
  return { input: 0, output: 0, total: 0 };
}

describe("applyAnthropicCacheUsage", () => {
  it("copies reads, writes and the reported 1-hour share", () => {
    const usage = emptyUsage();

    applyAnthropicCacheUsage(
      usage,
      {
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 30,
        cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 20 },
      },
      "5m",
    );

    expect(usage).toMatchObject({ cachedTokens: 50, cacheWriteTokens: 30, cacheWrite1hTokens: 10 });
  });

  it("falls back to the request lifetime only when the breakdown is missing", () => {
    const all1h = emptyUsage();
    applyAnthropicCacheUsage(all1h, { cache_creation_input_tokens: 30 }, "1h");
    expect(all1h.cacheWrite1hTokens).toBe(30);

    const mixed = emptyUsage();
    applyAnthropicCacheUsage(mixed, { cache_creation_input_tokens: 30 }, "mixed");
    expect(mixed.cacheWrite1hTokens).toBeUndefined();
  });

  it("leaves zero and null counters undefined", () => {
    const usage = emptyUsage();

    applyAnthropicCacheUsage(
      usage,
      { cache_read_input_tokens: 0, cache_creation_input_tokens: null },
      "1h",
    );

    expect(usage).toEqual(emptyUsage());
  });
});

describe("requestCacheTtl", () => {
  it("reports the lifetime every cache marker asked for", () => {
    expect(requestCacheTtl({ messages: [] })).toBeUndefined();
    expect(requestCacheTtl({ cache_control: { type: "ephemeral" } })).toBe("5m");
    expect(
      requestCacheTtl({
        system: [{ type: "text", text: "s", cache_control: { type: "ephemeral", ttl: "1h" } }],
        tools: [{ name: "t", cache_control: { type: "ephemeral", ttl: "1h" } }],
      }),
    ).toBe("1h");
    expect(
      requestCacheTtl({
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: "s", cache_control: { type: "ephemeral", ttl: "1h" } }],
      }),
    ).toBe("mixed");
  });
});
