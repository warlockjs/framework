/**
 * Per-million-token USD pricing for a model. All values are in USD per
 * 1,000,000 tokens — the industry-standard unit. Used by the framework
 * to compute `Usage.costUSD` at emit time, so stored reports carry
 * historical cost (not re-derived against today's pricing).
 *
 * **Optionality.** Every field except `input` / `output` is optional.
 * `cachedInput` / `cacheWrite` / `cacheWrite1h` matter only when the
 * provider meters them (OpenAI prompt-cache hits, Anthropic cache
 * reads / writes). Leave them undefined for adapters that don't report a
 * cache channel — cost falls back to the full input rate for those
 * tokens.
 *
 * **Where it lives.** Two declaration sites, both optional:
 *
 * 1. `SDK.pricing` — a registry keyed by model name. One source of
 *    truth per provider; matches how providers publish pricing tables.
 * 2. `model({ pricing })` — per-model override at instantiation. Wins
 *    over the SDK-level entry. Critical for multi-tenant projects
 *    where pricing is contract-specific or runtime-resolved.
 *
 * Resolution order: per-model > SDK registry > undefined (no cost
 * computed).
 *
 * @example
 * const pricing: ModelPricing = {
 *   input: 0.15,
 *   output: 0.6,
 *   cachedInput: 0.075,
 * };
 */
export type ModelPricing = {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /**
   * USD per 1M input tokens served from the provider's prompt cache.
   * Typically a fraction of `input`. Falls back to `input` when
   * undefined.
   */
  cachedInput?: number;
  /**
   * USD per 1M tokens written to the provider's prompt cache with the
   * default lifetime (Anthropic: the 5-minute cache, 1.25x the input
   * rate). Falls back to `cachedOutput`, then to `input`, when
   * undefined. As a cost-breakdown channel it holds the USD spent on
   * every cache write of the call (both lifetimes).
   *
   * @example
   * const pricing: ModelPricing = { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 };
   */
  cacheWrite?: number;
  /**
   * USD per 1M tokens written to the provider's prompt cache with a
   * 1-hour lifetime (`Usage.cacheWrite1hTokens`; Anthropic: 2x the input
   * rate). Falls back to the `cacheWrite` rate when undefined.
   */
  cacheWrite1h?: number;
  /**
   * @deprecated Use `cacheWrite`. Still read as the cache-write rate when
   * `cacheWrite` is unset; stored cost breakdowns written before 5.31 may
   * carry cache-write spend here, so `totalCost()` keeps summing it.
   */
  cachedOutput?: number;
  /**
   * USD per 1M reasoning/thinking tokens (`Usage.reasoningTokens`), for
   * providers that price reasoning above the standard output rate.
   * Falls back to `output` when undefined — the common case, since most
   * providers bill reasoning tokens at the output rate.
   *
   * @example
   * const pricing: ModelPricing = { input: 0.15, output: 0.6, reasoning: 0.6 };
   */
  reasoning?: number;
};
