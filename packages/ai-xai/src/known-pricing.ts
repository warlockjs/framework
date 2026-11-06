import type { ModelPricing, PricingTier } from "@warlock.js/ai";

/**
 * xAI bills a request whose prompt is 200K tokens or longer at double the
 * rates, for every token of the request. A tier starts above its
 * threshold, so 199,999 puts a 200,000-token prompt in the long tier.
 */
function longPrompt(input: number, cachedInput: number, output: number): PricingTier[] {
  return [{ abovePromptTokens: 199_999, input, output, cachedInput }];
}

/**
 * Built-in xAI list prices, USD per 1,000,000 tokens, keyed by exact model
 * id. `cachedInput` is the cached-input rate; the prompt-length `tiers`
 * hold the rates xAI charges for prompts of 200K tokens or more.
 *
 * Source: https://docs.x.ai/docs/models, as of {@link XAI_MODEL_PRICING_AS_OF}.
 * Only the models on that pricing table are listed; the Grok 4, 3 and 2
 * families have no listed price there, so pass `pricing` yourself for them.
 * Server-side tool charges (search) are not included.
 */
export const XAI_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "grok-4.7": { input: 2, output: 6, cachedInput: 0.5, tiers: longPrompt(4, 1, 12) },
  "grok-4.6": { input: 2, output: 6, cachedInput: 0.5, tiers: longPrompt(4, 1, 12) },
  "grok-4.5": { input: 2, output: 6, cachedInput: 0.3, tiers: longPrompt(4, 0.6, 12) },
  "grok-4.3": { input: 1.25, output: 2.5, cachedInput: 0.2, tiers: longPrompt(2.5, 0.4, 5) },
  "grok-4.20-0309-reasoning": {
    input: 1.25,
    output: 2.5,
    cachedInput: 0.2,
    tiers: longPrompt(2.5, 0.4, 5),
  },
  "grok-4.20-0309-non-reasoning": {
    input: 1.25,
    output: 2.5,
    cachedInput: 0.2,
    tiers: longPrompt(2.5, 0.4, 5),
  },
  "grok-4.20-multi-agent-0309": {
    input: 1.25,
    output: 2.5,
    cachedInput: 0.2,
    tiers: longPrompt(2.5, 0.4, 5),
  },
  "grok-build-0.1": { input: 1, output: 2, cachedInput: 0.2, tiers: longPrompt(2, 0.4, 4) },
};

/** The date the {@link XAI_MODEL_PRICING} rates were last checked against xAI's model page. */
export const XAI_MODEL_PRICING_AS_OF = "2026-11-06";

/**
 * Look up the built-in list price for a Grok model id (exact match), or
 * `undefined` so cost stays unknown rather than wrong.
 *
 * @example
 * xaiPricingFor("grok-4.3"); // { input: 1.25, output: 2.5, cachedInput: 0.2, tiers: [...] }
 * xaiPricingFor("grok-3"); // undefined — no listed price
 */
export function xaiPricingFor(modelName: string): ModelPricing | undefined {
  return Object.hasOwn(XAI_MODEL_PRICING, modelName) ? XAI_MODEL_PRICING[modelName] : undefined;
}
