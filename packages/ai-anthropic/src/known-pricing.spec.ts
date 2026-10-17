import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_MODEL_PRICING,
  anthropicPricingFor,
  withAnthropicCacheWriteRates,
} from "./known-pricing";

describe("Anthropic built-in pricing", () => {
  it("keeps every write rate at the documented 1.25x / 2x of input", () => {
    for (const pricing of Object.values(ANTHROPIC_MODEL_PRICING)) {
      expect(pricing.cacheWrite).toBeCloseTo(pricing.input * 1.25, 10);
      expect(pricing.cacheWrite1h).toBeCloseTo(pricing.input * 2, 10);
    }
  });

  it("resolves aliases and dated snapshots, not unknown ids", () => {
    expect(anthropicPricingFor("claude-opus-5-5")).toEqual({
      input: 4,
      output: 20,
      cachedInput: 0.2,
      cacheWrite: 5,
      cacheWrite1h: 8,
    });
    expect(anthropicPricingFor("claude-haiku-4-5-20251001")?.input).toBe(1);
    expect(anthropicPricingFor("claude-haiku-5-5")).toBeUndefined();
    expect(anthropicPricingFor("gpt-4o")).toBeUndefined();
  });

  it("fills only the missing cache-write rates", () => {
    expect(withAnthropicCacheWriteRates(undefined)).toBeUndefined();
    expect(withAnthropicCacheWriteRates({ input: 2, output: 8 })).toEqual({
      input: 2,
      output: 8,
      cacheWrite: 2.5,
      cacheWrite1h: 4,
    });
    expect(
      withAnthropicCacheWriteRates({ input: 2, output: 8, cachedOutput: 9, cacheWrite1h: 7 }),
    ).toEqual({ input: 2, output: 8, cachedOutput: 9, cacheWrite: 9, cacheWrite1h: 7 });
  });
});
