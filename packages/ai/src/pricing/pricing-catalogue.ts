import type { ModelCost, ModelPricing } from "../contracts/result/model-pricing.type";
import type { Usage } from "../contracts/result/usage.type";
import { computeCost, totalCost } from "../utils/compute-cost";

const BRAND = Symbol.for("@warlock.js/ai.pricingCatalogue");

/** A trailing dated-snapshot suffix: `-20251001` or `-2025-10-01`. */
const SNAPSHOT_SUFFIX = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/**
 * A price list the app owns: provider tables merged in one place, with
 * app overrides on top. Every rate is USD per 1,000,000 tokens (see
 * {@link ModelPricing}). Lookups return `undefined` for a model nobody
 * priced, so "unknown" never turns into "free".
 *
 * Lookup order for a model name: an override set with `set()`, then the
 * tables added with `use()` (the table added last wins), each tried with
 * the exact name and then without a dated-snapshot suffix.
 */
export type PricingCatalogue = {
  /** Price of a model, or `undefined` when none of the sources lists it. */
  get(model: string): ModelPricing | undefined;
  /** Override (or add) one model's price. Overrides beat every table. */
  set(model: string, pricing: ModelPricing): PricingCatalogue;
  /** Add a price table, such as `ANTHROPIC_MODEL_PRICING`. Tables added later win over earlier ones. */
  use(table: Readonly<Record<string, ModelPricing>>): PricingCatalogue;
  /** Cost breakdown of one `Usage`, or `undefined` when the model is unpriced. */
  cost(usage: Usage, model: string): ModelCost | undefined;
  /** Total USD of one `Usage`, or `undefined` when the model is unpriced. */
  costUSD(usage: Usage, model: string): number | undefined;
  /** Every model name with a price, overrides included. */
  models(): string[];
  /** The merged table as a plain record, e.g. for `budget({ pricing })` or an SDK's `pricing`. */
  toRecord(): Record<string, ModelPricing>;
};

/**
 * Build a {@link PricingCatalogue}. Pass it to `budget({ pricing })` so a
 * spend cap prices every model the app uses from one list.
 *
 * @example
 * import { ANTHROPIC_MODEL_PRICING } from "@warlock.js/ai-anthropic";
 * import { OPENAI_MODEL_PRICING } from "@warlock.js/ai-openai";
 *
 * const prices = pricingCatalogue({ tables: [ANTHROPIC_MODEL_PRICING, OPENAI_MODEL_PRICING] })
 *   .set("my-fine-tune", { input: 3, output: 12 }); // contract rate
 *
 * prices.costUSD(result.usage, "claude-sonnet-4-6");
 * ai.middleware.budget({ maxCostUSD: 1, pricing: prices });
 */
export function pricingCatalogue(
  options: { tables?: ReadonlyArray<Readonly<Record<string, ModelPricing>>> } = {},
): PricingCatalogue {
  const tables: Array<Readonly<Record<string, ModelPricing>>> = [...(options.tables ?? [])];
  const overrides = new Map<string, ModelPricing>();

  function find(model: string): ModelPricing | undefined {
    const names = [model, model.replace(SNAPSHOT_SUFFIX, "")];

    for (const name of names) {
      const override = overrides.get(name);

      if (override) return override;
    }

    for (const name of names) {
      for (let index = tables.length - 1; index >= 0; index--) {
        const entry = Object.hasOwn(tables[index]!, name) ? tables[index]![name] : undefined;

        if (entry) return entry;
      }
    }

    return undefined;
  }

  const catalogue: PricingCatalogue = {
    get: find,
    set(model, pricing) {
      overrides.set(model, pricing);

      return catalogue;
    },
    use(table) {
      tables.push(table);

      return catalogue;
    },
    cost: (usage, model) => computeCost(usage, find(model)),
    costUSD: (usage, model) => totalCost(computeCost(usage, find(model))),
    models() {
      return [...new Set([...tables.flatMap((table) => Object.keys(table)), ...overrides.keys()])];
    },
    toRecord() {
      return Object.fromEntries(
        catalogue.models().map((model) => [model, find(model)!] as const),
      );
    },
  };

  Object.defineProperty(catalogue, BRAND, { value: true });

  return catalogue;
}

/** Whether `value` is a catalogue built by {@link pricingCatalogue}. */
export function isPricingCatalogue(value: unknown): value is PricingCatalogue {
  return typeof value === "object" && value !== null && BRAND in value;
}
