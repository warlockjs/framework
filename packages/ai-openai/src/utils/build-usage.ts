import { computeCost, type ModelPricing, type Usage } from "@warlock.js/ai";

/** The already-extracted token counts of one provider usage block. */
export type UsageCounts = {
  input: number;
  output: number;
  total: number;
  /** Subset of `input` served from the prompt cache. */
  cachedTokens?: number;
  /** Hidden reasoning channel, already counted within `output`. */
  reasoningTokens?: number;
  /** Subset of `input` written to the prompt cache. */
  cacheWriteTokens?: number;
};

/**
 * Build the neutral `Usage` from extracted counts. The optional detail
 * counters are emitted only when the provider reports a positive value, so
 * non-reasoning / uncached calls keep the lean `{ input, output, total }`
 * shape. Shared by the Chat Completions and Responses adapters so both
 * apply the same rule.
 *
 * OpenAI-style usage counts cache reads and writes inside the prompt
 * total (`input_tokens` includes `cached_tokens` and `cache_write_tokens`,
 * and the compatible vendors — DeepSeek, xAI, Groq, Mistral — document
 * the same), so the result is marked `inputIncludesCache: true`. When the
 * model is priced, `cost` is attached.
 */
export function buildUsage(counts: UsageCounts, pricing?: ModelPricing): Usage {
  const { input, output, total, cachedTokens, reasoningTokens, cacheWriteTokens } = counts;

  const usage: Usage = {
    input,
    output,
    total,
    inputIncludesCache: true,
    ...(cachedTokens !== undefined && cachedTokens > 0 ? { cachedTokens } : {}),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cacheWriteTokens !== undefined && cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  };

  const cost = computeCost(usage, pricing);

  if (cost) {
    usage.cost = cost;
  }

  return usage;
}
