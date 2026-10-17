import type { ModelPricing } from "@warlock.js/ai";

/**
 * Anthropic's prompt-cache write multipliers, relative to the base input
 * rate: a 5-minute write costs 1.25x, a 1-hour write 2x. They hold for
 * every Claude model on Anthropic's price list.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 * (fetched 2026-10-17).
 */
export const ANTHROPIC_CACHE_WRITE_MULTIPLIER = 1.25;
export const ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER = 2;

/**
 * Built-in Claude API list prices, USD per 1,000,000 tokens, keyed by
 * model id. `cachedInput` is the cache-hit rate, `cacheWrite` the
 * 5-minute write rate and `cacheWrite1h` the 1-hour write rate.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing,
 * "Model pricing" table, fetched 2026-10-17. Standard (global) routing,
 * non-batch. Not covered, so pass `pricing` yourself when you need them:
 *
 * - Claude Haiku 5.5 — priced by prompt length (higher rates above
 *   100,000 prompt tokens), which a flat `ModelPricing` cannot express.
 * - US-only inference (`inference_geo: "us"`, 1.1x), fast mode, the Batch
 *   API, and Claude on Bedrock / Vertex AI (partner-priced).
 * - Limited-availability models (Mythos) and retired models.
 *
 * Dated snapshot ids (`claude-haiku-4-5-20251001`) resolve to their alias
 * entry through {@link anthropicPricingFor}.
 */
export const ANTHROPIC_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-fable-5-1": {
    input: 10,
    output: 50,
    cachedInput: 0.25,
    cacheWrite: 12.5,
    cacheWrite1h: 20,
  },
  "claude-fable-5": { input: 10, output: 50, cachedInput: 1, cacheWrite: 12.5, cacheWrite1h: 20 },
  "claude-opus-5-5": { input: 4, output: 20, cachedInput: 0.2, cacheWrite: 5, cacheWrite1h: 8 },
  "claude-opus-5": { input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-8": { input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-7": { input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-6": { input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-5": { input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10, cachedInput: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 },
  "claude-sonnet-5": { input: 2, output: 10, cachedInput: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    cacheWrite1h: 6,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    cacheWrite1h: 6,
  },
  "claude-haiku-4-5": { input: 1, output: 5, cachedInput: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
};

/** A trailing `-YYYYMMDD` snapshot date on a Claude model id. */
const SNAPSHOT_SUFFIX = /-\d{8}$/;

/**
 * Look up the built-in list price for a Claude model id. Accepts the
 * alias (`claude-sonnet-4-5`) or a dated snapshot
 * (`claude-sonnet-4-5-20250929`). Returns `undefined` for any id not in
 * {@link ANTHROPIC_MODEL_PRICING}, so cost stays unknown rather than wrong.
 *
 * @example
 * anthropicPricingFor("claude-haiku-4-5-20251001"); // { input: 1, output: 5, … }
 * anthropicPricingFor("claude-haiku-5-5"); // undefined (prompt-length tiers)
 */
export function anthropicPricingFor(modelName: string): ModelPricing | undefined {
  const exact = ANTHROPIC_MODEL_PRICING[modelName];

  if (exact) {
    return exact;
  }

  return ANTHROPIC_MODEL_PRICING[modelName.replace(SNAPSHOT_SUFFIX, "")];
}

/**
 * Fill the cache-write rates Anthropic derives from the input rate
 * (5-minute writes 1.25x, 1-hour writes 2x) into a pricing entry that
 * omits them, so a caller who supplies only `{ input, output }` is no
 * longer billed nothing for cache writes. Explicit rates always win; the
 * cache-read rate is left alone because it differs per model.
 *
 * @example
 * withAnthropicCacheWriteRates({ input: 3, output: 15 });
 * // { input: 3, output: 15, cacheWrite: 3.75, cacheWrite1h: 6 }
 */
export function withAnthropicCacheWriteRates(
  pricing: ModelPricing | undefined,
): ModelPricing | undefined {
  if (!pricing) {
    return undefined;
  }

  const cacheWrite =
    pricing.cacheWrite ?? pricing.cachedOutput ?? pricing.input * ANTHROPIC_CACHE_WRITE_MULTIPLIER;
  const cacheWrite1h = pricing.cacheWrite1h ?? pricing.input * ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER;

  if (pricing.cacheWrite === cacheWrite && pricing.cacheWrite1h === cacheWrite1h) {
    return pricing;
  }

  return { ...pricing, cacheWrite, cacheWrite1h };
}
