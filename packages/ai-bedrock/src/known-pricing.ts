import type { ModelPricing } from "@warlock.js/ai";

/**
 * Bedrock on-demand list prices for Anthropic Claude, USD per 1,000,000
 * tokens, keyed by Bedrock model id (without an inference-profile
 * prefix). `cacheWrite` is the 5-minute write rate, `cacheWrite1h` the
 * 1-hour write rate, `cachedInput` the cache-read rate.
 *
 * Source: https://aws.amazon.com/bedrock/pricing/ — the page's own price
 * feed for "US East (N. Virginia)", fetched 2026-10-17 (Sonnet 5.5 cache
 * reads already at the rate effective 2026-10-07). Model ids from
 * https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html.
 *
 * Two tables, because AWS prices them differently:
 * - {@link BEDROCK_GLOBAL_PRICING} — `global.` cross-Region inference
 *   profiles.
 * - {@link BEDROCK_US_PRICING} — `us.` geographic profiles (the
 *   "Geo / In-region" rates, 10% above global for these models).
 *
 * In-Region ids without a profile prefix, other geographies (`eu.`,
 * `apac.`, …), Claude Haiku 5.5 and non-Claude models stay unpriced —
 * their rates vary by Region or were not verified — so pass `pricing`
 * yourself for them.
 */
export const BEDROCK_GLOBAL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "anthropic.claude-sonnet-5-5": claude(2, 10, 0.1),
  "anthropic.claude-opus-5-5": claude(4, 20, 0.2),
  "anthropic.claude-fable-5-1": claude(10, 50, 0.25),
  "anthropic.claude-opus-5": claude(5, 25, 0.5),
  "anthropic.claude-sonnet-5": claude(2, 10, 0.2),
  "anthropic.claude-fable-5": claude(10, 50, 1),
  "anthropic.claude-opus-4-8": claude(5, 25, 0.5),
  "anthropic.claude-opus-4-7": claude(5, 25, 0.5),
  "anthropic.claude-opus-4-6-v1": claude(5, 25, 0.5),
  "anthropic.claude-sonnet-4-6": claude(3, 15, 0.3),
  "anthropic.claude-opus-4-5-20251101-v1:0": claude(5, 25, 0.5),
  "anthropic.claude-sonnet-4-5-20250929-v1:0": claude(3, 15, 0.3),
  "anthropic.claude-haiku-4-5-20251001-v1:0": claude(1, 5, 0.1),
};

/** `us.` geographic-profile prices — see {@link BEDROCK_GLOBAL_PRICING}. */
export const BEDROCK_US_PRICING: Readonly<Record<string, ModelPricing>> = {
  "anthropic.claude-sonnet-5-5": claude(2.2, 11, 0.11),
  "anthropic.claude-opus-5-5": claude(4.4, 22, 0.22),
  "anthropic.claude-fable-5-1": claude(11, 55, 0.275),
  "anthropic.claude-opus-5": claude(5.5, 27.5, 0.55),
  "anthropic.claude-sonnet-5": claude(2.2, 11, 0.22),
  "anthropic.claude-fable-5": claude(11, 55, 1.1),
  "anthropic.claude-opus-4-8": claude(5.5, 27.5, 0.55),
  "anthropic.claude-opus-4-7": claude(5.5, 27.5, 0.55),
  "anthropic.claude-opus-4-6-v1": claude(5.5, 27.5, 0.55),
  "anthropic.claude-sonnet-4-6": claude(3.3, 16.5, 0.33),
  "anthropic.claude-opus-4-5-20251101-v1:0": claude(5.5, 27.5, 0.55),
  "anthropic.claude-sonnet-4-5-20250929-v1:0": claude(3.3, 16.5, 0.33),
  "anthropic.claude-haiku-4-5-20251001-v1:0": claude(1.1, 5.5, 0.11),
};

/**
 * Look up the built-in price for a Bedrock model id or inference-profile
 * id: `global.<model>` reads {@link BEDROCK_GLOBAL_PRICING}, `us.<model>`
 * reads {@link BEDROCK_US_PRICING}; anything else is `undefined`.
 *
 * @example
 * bedrockPricingFor("global.anthropic.claude-sonnet-4-6"); // { input: 3, output: 15, … }
 * bedrockPricingFor("anthropic.claude-sonnet-4-6"); // undefined — in-Region rates vary
 */
export function bedrockPricingFor(modelId: string): ModelPricing | undefined {
  if (modelId.startsWith("global.")) {
    return BEDROCK_GLOBAL_PRICING[modelId.slice("global.".length)];
  }

  if (modelId.startsWith("us.")) {
    return BEDROCK_US_PRICING[modelId.slice("us.".length)];
  }

  return undefined;
}

/**
 * Fill the Claude cache-write rates (5-minute 1.25x, 1-hour 2x the input
 * rate — the ratio of every Claude row in the tables above) into a
 * caller-supplied entry for a Claude model that omits them. Non-Claude
 * models are returned unchanged.
 */
export function withClaudeCacheWriteRates(
  modelId: string,
  pricing: ModelPricing | undefined,
): ModelPricing | undefined {
  if (!pricing || !modelId.toLowerCase().includes("anthropic.claude")) {
    return pricing;
  }

  if (pricing.cacheWrite !== undefined && pricing.cacheWrite1h !== undefined) {
    return pricing;
  }

  return {
    ...pricing,
    cacheWrite: pricing.cacheWrite ?? pricing.cachedOutput ?? round(pricing.input * 1.25),
    cacheWrite1h: pricing.cacheWrite1h ?? round(pricing.input * 2),
  };
}

function claude(input: number, output: number, cachedInput: number): ModelPricing {
  return {
    input,
    output,
    cachedInput,
    cacheWrite: round(input * 1.25),
    cacheWrite1h: round(input * 2),
  };
}

/** Trim binary floating-point noise (2.2 * 1.25 = 2.7500000000000004). */
function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
