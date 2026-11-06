import type {
  ModelPricing,
  PricingChange,
  PricingRates,
  PricingTier,
} from "../contracts/result/model-pricing.type";

/** Inputs that pick a price from a {@link ModelPricing} with tiers or a schedule. */
export type ResolvePricingOptions = {
  /** Prompt length of the request in tokens, cache reads and writes included. Without it no tier applies. */
  promptTokens?: number;
  /** Moment to price at. Defaults to now. */
  at?: Date | number | string;
};

/**
 * The flat rates that apply to one request: the latest dated tariff in
 * effect at `at`, then the highest prompt-length tier the prompt exceeds.
 * A pricing without `tiers` or `schedule` is returned as it is, so existing
 * flat tables cost the same as before.
 *
 * @example
 * const pricing = { input: 1, output: 5, tiers: [{ abovePromptTokens: 272_000, input: 2, output: 7.5 }] };
 * resolvePricing(pricing, { promptTokens: 300_000 }); // { input: 2, output: 7.5 }
 */
export function resolvePricing(
  pricing: ModelPricing,
  options: ResolvePricingOptions = {},
): PricingRates {
  if (!pricing.tiers && !pricing.schedule) {
    return pricing;
  }

  const { tiers: baseTiers, schedule, ...base } = pricing;
  let rates: PricingRates = base;
  let tiers: PricingTier[] | undefined = baseTiers;

  if (schedule?.length) {
    const at = toTime(options.at ?? Date.now());
    let change: PricingChange | undefined;
    let changeTime = -Infinity;

    for (const entry of schedule) {
      const from = Date.parse(entry.from);

      if (!Number.isNaN(from) && from <= at && from >= changeTime) {
        change = entry;
        changeTime = from;
      }
    }

    if (change) {
      const { from: _from, tiers: changeTiers, ...changed } = change;

      rates = { ...rates, ...definedOnly(changed) };
      tiers = changeTiers ?? tiers;
    }
  }

  const promptTokens = options.promptTokens;

  if (tiers?.length && promptTokens !== undefined) {
    let tier: PricingTier | undefined;

    for (const candidate of tiers) {
      if (
        promptTokens > candidate.abovePromptTokens &&
        (!tier || candidate.abovePromptTokens > tier.abovePromptTokens)
      ) {
        tier = candidate;
      }
    }

    if (tier) {
      const { abovePromptTokens: _above, ...tierRates } = tier;

      rates = { ...rates, ...definedOnly(tierRates) };
    }
  }

  return rates;
}

function toTime(at: Date | number | string): number {
  return at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
}

function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
