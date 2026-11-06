import { computeCost } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { ANTHROPIC_MODEL_LIFECYCLE, anthropicLifecycleFor } from "./known-lifecycle";
import {
  ANTHROPIC_MODEL_PRICING,
  ANTHROPIC_MODEL_PRICING_AS_OF,
  anthropicPricingFor,
  withAnthropicCacheWriteRates,
} from "./known-pricing";

describe("Anthropic built-in pricing", () => {
  it("keeps every write rate at the documented 1.25x / 2x of input", () => {
    for (const pricing of Object.values(ANTHROPIC_MODEL_PRICING)) {
      expect(pricing.cacheWrite).toBeCloseTo(pricing.input * 1.25, 10);
      expect(pricing.cacheWrite1h).toBeCloseTo(pricing.input * 2, 10);

      for (const tier of pricing.tiers ?? []) {
        expect(tier.cacheWrite).toBeCloseTo(tier.input! * 1.25, 10);
        expect(tier.cacheWrite1h).toBeCloseTo(tier.input! * 2, 10);
      }
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

  it("dates the table and gives every priced model a status", () => {
    expect(ANTHROPIC_MODEL_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    for (const id of Object.keys(ANTHROPIC_MODEL_PRICING)) {
      expect(anthropicLifecycleFor(id)?.status).toMatch(/^(current|retiring|retired)$/);
    }
  });

  it("keeps lifecycle dates consistent with their status", () => {
    for (const lifecycle of Object.values(ANTHROPIC_MODEL_LIFECYCLE)) {
      if (lifecycle.status === "current") {
        expect(lifecycle.retiresOn).toBeUndefined();
      } else {
        expect(lifecycle.retiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(lifecycle.replacement).toBeTruthy();
        expect(lifecycle.status === "retired").toBe(
          lifecycle.retiresOn! <= ANTHROPIC_MODEL_PRICING_AS_OF,
        );
      }
    }
  });

  it("finds a status by dated snapshot", () => {
    expect(anthropicLifecycleFor("claude-sonnet-4-5-20250929")).toEqual({
      status: "retiring",
      retiresOn: "2026-11-30",
      replacement: "claude-sonnet-5-5",
    });
    expect(anthropicLifecycleFor("claude-opus-4-1-20250805")?.status).toBe("retired");
    expect(anthropicLifecycleFor("gpt-4o")).toBeUndefined();
  });

  it("prices Haiku 5.5 by prompt length, cache reads and writes included", () => {
    const pricing = anthropicPricingFor("claude-haiku-5-5");
    const base = { output: 1_000, inputIncludesCache: false as const };
    const short = { ...base, input: 1_000, cachedTokens: 90_000, total: 0 };
    const long = { ...base, input: 1_000, cachedTokens: 100_000, total: 0 };

    expect(computeCost(short, pricing)?.output).toBeCloseTo((1_000 * 0.5) / 1e6);
    expect(computeCost(long, pricing)?.output).toBeCloseTo((1_000 * 2.5) / 1e6);
    expect(computeCost(long, pricing)?.cachedInput).toBeCloseTo((100_000 * 0.05) / 1e6);
  });
});
