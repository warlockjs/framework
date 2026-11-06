import type { ModelPricing } from "@warlock.js/ai";

/**
 * Built-in OpenAI API list prices, USD per 1,000,000 tokens, keyed by
 * exact model id. `cachedInput` is the cached-input rate. None of these
 * models charges for cache writes.
 *
 * Source: https://developers.openai.com/api/docs/pricing (the target of
 * platform.openai.com/docs/pricing), Standard tier, as of
 * {@link OPENAI_MODEL_PRICING_AS_OF}. Entries for models the page no
 * longer lists (the retired ids and a few older ones) keep the rates
 * verified on 2026-10-17, so a stored report can still be costed.
 *
 * Models priced by prompt length carry `tiers`: above 272K prompt tokens
 * the whole request bills at the tier rates.
 *
 * Applied only when the SDK's provider label is `"openai"`, and only on
 * an exact id match — dated snapshots can carry other prices. Left out on
 * purpose, so pass `pricing` yourself for them:
 *
 * - The `-pro` models, `gpt-6-sol` / `gpt-5.6-sol` (promotional pricing
 *   until 2026-11-30) and models without a listed price.
 * - Promotional, Batch, Flex and Priority pricing, and the regional
 *   (data-residency) uplift.
 *
 * Retired ids stay in the table so old reports keep their cost; see
 * {@link OPENAI_MODEL_LIFECYCLE} for their status.
 */
export const OPENAI_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "gpt-6.1-terra": {
    input: 1,
    output: 5,
    cachedInput: 0.05,
    tiers: [{ abovePromptTokens: 272_000, input: 2, output: 7.5, cachedInput: 0.1 }],
  },
  "gpt-6-cyber": { input: 20, output: 100, cachedInput: 2 },
  "gpt-6-astra": {
    input: 10,
    output: 50,
    cachedInput: 1,
    tiers: [{ abovePromptTokens: 272_000, input: 20, output: 75, cachedInput: 2 }],
  },
  "gpt-6-luna": {
    input: 0.1,
    output: 0.5,
    cachedInput: 0.01,
    tiers: [{ abovePromptTokens: 272_000, input: 0.2, output: 0.75, cachedInput: 0.02 }],
  },
  "gpt-5.6-terra": {
    input: 2,
    output: 12,
    cachedInput: 0.2,
    tiers: [{ abovePromptTokens: 272_000, input: 4, output: 18, cachedInput: 0.4 }],
  },
  "gpt-5.6-luna": {
    input: 0.2,
    output: 1.2,
    cachedInput: 0.02,
    tiers: [{ abovePromptTokens: 272_000, input: 0.4, output: 1.8, cachedInput: 0.04 }],
  },
  "gpt-5.5": {
    input: 5,
    output: 30,
    cachedInput: 0.5,
    tiers: [{ abovePromptTokens: 272_000, input: 10, output: 45, cachedInput: 1 }],
  },
  "gpt-5.4": {
    input: 2.5,
    output: 15,
    cachedInput: 0.25,
    tiers: [{ abovePromptTokens: 272_000, input: 5, output: 22.5, cachedInput: 0.5 }],
  },
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

/** The date the {@link OPENAI_MODEL_PRICING} rates were last checked against OpenAI's pricing page. */
export const OPENAI_MODEL_PRICING_AS_OF = "2026-11-06";

/**
 * Look up the built-in list price for an OpenAI model id (exact match).
 * Returns `undefined` for unknown ids, so cost stays unknown rather than
 * wrong.
 *
 * @example
 * openAIPricingFor("gpt-4o-mini"); // { input: 0.15, output: 0.6, cachedInput: 0.075 }
 * openAIPricingFor("gpt-5.5"); // { input: 5, output: 30, cachedInput: 0.5, tiers: [...] }
 * openAIPricingFor("gpt-5.5-pro"); // undefined — not in the table
 */
export function openAIPricingFor(modelName: string): ModelPricing | undefined {
  return OPENAI_MODEL_PRICING[modelName];
}

/** USD per request for web_search (NOT non-reasoning web_search_preview).
 * Search content tokens are additional; preview variants can have other rates.
 * https://developers.openai.com/api/docs/pricing#built-in-tools — verified 2026-10-18. */
export const OPENAI_SERVER_TOOL_PRICING = { webSearch: 0.01 };
