import type { ModelPricing } from "@warlock.js/ai";

/**
 * Built-in Gemini API list prices (paid tier, Standard), USD per
 * 1,000,000 tokens, keyed by exact model id. `cachedInput` is the
 * context-cache read rate; the hourly cache-storage charge is not a token
 * rate and is never included.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing, fetched
 * 2026-10-17. Only models with one flat token price are listed. Left out
 * on purpose — pass `pricing` yourself for them:
 *
 * - Models priced by prompt length (the Pro models, split at 200k
 *   prompt tokens).
 * - Models with a higher audio-input rate (most Flash / Flash-Lite
 *   models): `Usage` does not split input by modality.
 * - Models with a scheduled price change (gemini-4-argon, the 3.8 / 3.6
 *   Flash models).
 */
export const GOOGLE_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cachedInput: 0.03 },
};

/**
 * Look up the built-in list price for a Gemini model id (exact match),
 * or `undefined` so cost stays unknown rather than wrong.
 *
 * @example
 * googlePricingFor("gemini-3.5-flash-lite"); // { input: 0.3, output: 2.5, cachedInput: 0.03 }
 * googlePricingFor("gemini-2.5-pro"); // undefined — priced by prompt length
 */
export function googlePricingFor(modelName: string): ModelPricing | undefined {
  return GOOGLE_MODEL_PRICING[modelName];
}

/** USD per nonempty unique query for Gemini 3+, before free monthly allowances.
 * Gemini 2.5 and older bill per grounded prompt; do not use this rate for them.
 * https://ai.google.dev/gemini-api/docs/google-search#pricing — verified 2026-10-18. */
export const GOOGLE_SERVER_TOOL_PRICING = { webSearch: 0.014 };
