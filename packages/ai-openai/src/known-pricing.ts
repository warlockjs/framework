import type { ModelPricing } from "@warlock.js/ai";

/**
 * Built-in OpenAI API list prices, USD per 1,000,000 tokens, keyed by
 * exact model id. `cachedInput` is the cached-input rate. None of these
 * models charges for cache writes.
 *
 * Source: https://developers.openai.com/api/docs/pricing (the target of
 * platform.openai.com/docs/pricing), Standard tier, fetched 2026-10-17.
 *
 * Applied only when the SDK's provider label is `"openai"`, and only on
 * an exact id match — dated snapshots can carry other prices. Left out on
 * purpose, so pass `pricing` yourself for them:
 *
 * - Models priced by prompt length (a higher rate above 272K input
 *   tokens): the gpt-6 / gpt-5.6 / gpt-5.5 / gpt-5.4 families and the
 *   `-pro` models. A flat `ModelPricing` cannot express the tiers.
 * - Promotional, Batch, Flex and Priority pricing, and the regional
 *   (data-residency) uplift.
 */
export const OPENAI_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cachedInput: 0.075 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cachedInput: 0.02 },
  "gpt-5.2": { input: 1.75, output: 14, cachedInput: 0.175 },
  "gpt-5.1": { input: 1.25, output: 10, cachedInput: 0.125 },
  "gpt-5": { input: 1.25, output: 10, cachedInput: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2, cachedInput: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },
  "gpt-4.1": { input: 2, output: 8, cachedInput: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cachedInput: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cachedInput: 0.025 },
  "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
  o3: { input: 2, output: 8, cachedInput: 0.5 },
  "o4-mini": { input: 1.1, output: 4.4, cachedInput: 0.275 },
  "o3-mini": { input: 1.1, output: 4.4, cachedInput: 0.55 },
  o1: { input: 15, output: 60, cachedInput: 7.5 },
};

/**
 * Look up the built-in list price for an OpenAI model id (exact match).
 * Returns `undefined` for unknown ids, so cost stays unknown rather than
 * wrong.
 *
 * @example
 * openAIPricingFor("gpt-4o-mini"); // { input: 0.15, output: 0.6, cachedInput: 0.075 }
 * openAIPricingFor("gpt-5.5"); // undefined — priced by prompt length
 */
export function openAIPricingFor(modelName: string): ModelPricing | undefined {
  return OPENAI_MODEL_PRICING[modelName];
}

/** USD per request for web_search (NOT non-reasoning web_search_preview).
 * Search content tokens are additional; preview variants can have other rates.
 * https://developers.openai.com/api/docs/pricing#built-in-tools — verified 2026-10-18. */
export const OPENAI_SERVER_TOOL_PRICING = { webSearch: 0.01 };
