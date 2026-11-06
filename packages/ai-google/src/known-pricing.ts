import type { ModelPricing } from "@warlock.js/ai";

/**
 * Built-in Gemini API list prices (paid tier, Standard), USD per
 * 1,000,000 tokens, keyed by exact model id. `cachedInput` is the
 * context-cache read rate; the hourly cache-storage charge is not a token
 * rate and is never included.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing, as of
 * {@link GOOGLE_MODEL_PRICING_AS_OF}. Prices Google has already scheduled
 * are in `schedule`, so a model costs the right amount on each day without
 * a package update; models priced by prompt length carry `tiers`.
 * Left out on purpose — pass `pricing` yourself for them:
 *
 * - Models with a higher audio-input rate (`gemini-3.1-flash-lite`,
 *   `gemini-3-flash-preview`): `Usage` does not split input by modality.
 * - Models without a listed price.
 *
 * Models Google retired or reroutes stay out of the table; see
 * {@link GOOGLE_MODEL_LIFECYCLE}.
 */
export const GOOGLE_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "gemini-4-argon": {
    input: 2,
    output: 10,
    cachedInput: 0.1,
    schedule: [{ from: "2026-12-01", input: 4, output: 20, cachedInput: 0.2 }],
  },
  "gemini-3.8-flash": {
    input: 0.75,
    output: 3.75,
    cachedInput: 0.075,
    schedule: [{ from: "2027-01-01", input: 1.5, output: 7.5, cachedInput: 0.15 }],
  },
  "gemini-3.6-flash": {
    input: 0.75,
    output: 3.75,
    cachedInput: 0.075,
    schedule: [{ from: "2027-01-01", input: 1.5, output: 7.5, cachedInput: 0.15 }],
  },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "gemini-3.1-pro-preview": {
    input: 2,
    output: 12,
    cachedInput: 0.2,
    tiers: [{ abovePromptTokens: 200_000, input: 4, output: 18, cachedInput: 0.4 }],
  },
};

/** The date the {@link GOOGLE_MODEL_PRICING} rates were last checked against Google's pricing page. */
export const GOOGLE_MODEL_PRICING_AS_OF = "2026-11-06";

/**
 * Look up the built-in list price for a Gemini model id (exact match),
 * or `undefined` so cost stays unknown rather than wrong.
 *
 * @example
 * googlePricingFor("gemini-3.5-flash-lite"); // { input: 0.3, output: 2.5, cachedInput: 0.03 }
 * googlePricingFor("gemini-2.5-pro"); // undefined — not in the table
 */
export function googlePricingFor(modelName: string): ModelPricing | undefined {
  return GOOGLE_MODEL_PRICING[modelName];
}

/** USD per nonempty unique query for Gemini 3+, before free monthly allowances.
 * Gemini 2.5 and older bill per grounded prompt; do not use this rate for them.
 * https://ai.google.dev/gemini-api/docs/google-search#pricing — verified 2026-10-18. */
export const GOOGLE_SERVER_TOOL_PRICING = { webSearch: 0.014 };
