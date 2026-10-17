import type { ModelPricing } from "./model-pricing.type";

/**
 * Token usage statistics for a single LLM call or aggregated across trips.
 *
 * `cachedTokens` counts prompt tokens served from the provider's prompt
 * cache (OpenAI's `prompt_tokens_details.cached_tokens`, Anthropic's
 * `cache_read_input_tokens`) and `cacheWriteTokens` counts prompt tokens
 * written to it. Cache reads and writes are billed at their own rates, so
 * separate accounting lets cost code price them correctly.
 *
 * **Does `input` include the cache tokens?** That depends on the provider,
 * and `inputIncludesCache` says which. OpenAI-style usage (OpenAI, Gemini,
 * DeepSeek, xAI, Groq, Mistral) counts cache reads inside `input`;
 * Anthropic and Bedrock report `input` as the uncached remainder only, so
 * the full prompt is `input + cachedTokens + cacheWriteTokens`.
 *
 * @example
 * const usage: Usage = {
 *   input: 150,
 *   output: 320,
 *   total: 470,
 *   cachedTokens: 120,
 *   cost: { input: 0.0000045, output: 0.000192, cachedInput: 0.000009 },
 * };
 */
export type Usage = {
  /**
   * Number of input/prompt tokens, as the provider reports them. Includes
   * `cachedTokens` / `cacheWriteTokens` unless `inputIncludesCache` is
   * `false` — see {@link Usage.inputIncludesCache}.
   */
  input: number;
  /** Number of output/completion tokens generated. */
  output: number;
  /** Total tokens (input + output). */
  total: number;
  /**
   * Prompt tokens served from the provider's prompt cache. Billed at
   * `ModelPricing.cachedInput` when cost is computed. Optional —
   * providers that don't report cache hits leave this undefined.
   */
  cachedTokens?: number;
  /**
   * Whether `input` already contains `cachedTokens` and
   * `cacheWriteTokens`. Set by each adapter from its provider's usage
   * semantics:
   *
   * - `true` (or absent) — OpenAI-style: `input` is the whole prompt and
   *   the cache counts are subsets of it (OpenAI, Gemini, DeepSeek, xAI,
   *   Groq, Mistral). Absent is read as `true` so custom adapters keep
   *   the historical meaning.
   * - `false` — Anthropic-style: `input` is the uncached remainder and the
   *   cache counts come on top of it (Anthropic `input_tokens`, Bedrock
   *   Converse `inputTokens`).
   *
   * `computeCost` honours it, so each cache token is billed exactly once
   * at its own rate. Usage merged across trips with different semantics
   * (a fallback chain spanning providers) is normalised to `true`.
   *
   * @example
   * // Anthropic: 100 uncached + 50,000 read + 20,000 written
   * const usage: Usage = {
   *   input: 100, output: 500, total: 600,
   *   cachedTokens: 50_000, cacheWriteTokens: 20_000, inputIncludesCache: false,
   * };
   */
  inputIncludesCache?: boolean;
  /**
   * Subset of `output` the provider attributes to internal reasoning /
   * thinking before the visible answer (OpenAI reasoning models'
   * `completion_tokens_details.reasoning_tokens`, Anthropic
   * extended-thinking tokens). Counted within `output` for billing
   * unless the provider prices it separately (see
   * `ModelPricing.reasoning`). Optional — undefined when the provider
   * doesn't report a reasoning channel.
   *
   * @example
   * const usage: Usage = { input: 150, output: 320, total: 470, reasoningTokens: 180 };
   */
  reasoningTokens?: number;
  /**
   * Number of input tokens WRITTEN to the provider's prompt cache on
   * this call (Anthropic `cache_creation_input_tokens`, Bedrock
   * `cacheWriteInputTokens`). Distinct from `cachedTokens`, which counts
   * read hits. Bills at `ModelPricing.cacheWrite` (the 1-hour share at
   * `ModelPricing.cacheWrite1h`). Optional — undefined for
   * providers/calls with no cache write.
   *
   * @example
   * const usage: Usage = { input: 150, output: 320, total: 470, cacheWriteTokens: 64 };
   */
  cacheWriteTokens?: number;
  /**
   * The part of `cacheWriteTokens` written with a 1-hour lifetime
   * (Anthropic `cache_creation.ephemeral_1h_input_tokens`). The rest of
   * `cacheWriteTokens` is a default (5-minute) write. Billed at
   * `ModelPricing.cacheWrite1h`. Optional — undefined when the provider
   * reports no 1-hour writes.
   *
   * @example
   * const usage: Usage = { input: 10, output: 5, total: 15, cacheWriteTokens: 900, cacheWrite1hTokens: 600 };
   */
  cacheWrite1hTokens?: number;
  /**
   * Cost breakdown in USD, computed at emit time from `tokens × pricing[model]`
   * when the model adapter declared a `ModelPricing`. Same shape as
   * `ModelPricing` (input / output / cachedInput / cacheWrite) so
   * dashboards can tell HOW the total was reached — what share was
   * input vs output, how much the prompt cache saved — instead of
   * looking at one opaque number.
   *
   * Captured as a historical fact so stored reports remain accurate
   * even after the pricing table changes upstream.
   *
   * `undefined` when no pricing is available (legacy adapters, unknown
   * model names, intentionally unpriced free-tier runs). Aggregators
   * merge defined fields and leave undefined ones untouched, so an
   * unpriced child cannot erase priced siblings.
   *
   * For a single scalar total use `totalCost(usage.cost)`, which sums
   * every populated channel.
   */
  cost?: ModelPricing;
};
