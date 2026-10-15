import type { Usage } from "@warlock.js/ai";
import type { GenerateContentResponse } from "@google/genai";

/** Gemini's per-response token accounting block, as the SDK types it. */
export type GoogleUsageMetadata = NonNullable<GenerateContentResponse["usageMetadata"]>;

/**
 * Fold a Gemini `usageMetadata` block into a running neutral `Usage`
 * accumulator. Shared by every `generateContent`-backed surface — the
 * chat model's `complete()`, its streaming loop (where the final chunk
 * carries cumulative totals), and the Gemini image model — so one
 * mapping decides what a Gemini token report means package-wide.
 *
 * Cache-read hits (`cachedContentTokenCount`, implicit or explicit
 * context caching) surface as `cachedTokens`; the thinking-phase tokens
 * of a reasoning model (`thoughtsTokenCount`) surface as
 * `reasoningTokens`. Both are emitted only when reported `> 0` so an
 * absent channel leaves the field undefined rather than a false zero.
 *
 * `total` falls back to `input + output` when Google omits
 * `totalTokenCount`.
 */
export function applyGoogleUsage(usage: Usage, raw: GoogleUsageMetadata): void {
  usage.input = raw.promptTokenCount ?? usage.input;
  usage.output = raw.candidatesTokenCount ?? usage.output;
  usage.total = raw.totalTokenCount ?? usage.input + usage.output;

  const cached = raw.cachedContentTokenCount;

  if (cached && cached > 0) {
    usage.cachedTokens = cached;
  }

  const reasoning = raw.thoughtsTokenCount;

  if (reasoning && reasoning > 0) {
    usage.reasoningTokens = reasoning;
  }
}
