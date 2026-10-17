/**
 * Cost-truth capability inference for Bedrock Converse model ids.
 *
 * Bedrock model ids are provider-prefixed and version-suffixed
 * (`anthropic.claude-3-7-sonnet-20250219-v1:0`, `us.amazon.nova-pro-v1:0`),
 * so — exactly like `known-vision-models.ts` — a lowercase substring scan
 * is the only robust check across cross-region inference-profile prefixes
 * (`us.`, `eu.`, `apac.`) and date/version tags.
 *
 * Each predicate answers a single `ModelCapabilities` flag the agent reads
 * to decide whether to forward a cost-truth option (`reasoning`,
 * `cacheControl`) or up-front-reject an attachment (`pdf`). Unknown ids
 * default to `false` so an unsupported request fails fast with a clear
 * capability error instead of an opaque Bedrock `ValidationException`.
 * Every inference is overridable per-model via `bedrock.model({ name, … })`.
 */

/**
 * Families that expose Anthropic-style extended thinking on Bedrock
 * Converse via `additionalModelRequestFields.thinking`. Only Claude 3.7
 * and the Claude 4 line (Sonnet / Opus / Haiku) support a configurable
 * thinking budget; earlier Claude, Nova, Llama, Mistral and Cohere do
 * not, so they are intentionally absent.
 */
const REASONING_CAPABLE_SUBSTRINGS = [
  "claude-3-7",
  "claude-sonnet-4",
  "claude-opus-4",
  "claude-haiku-4",
];

/**
 * Families that honor Converse `cachePoint` prompt-cache breakpoints.
 * Anthropic Claude 3.5+ / 3.7 / 4 / 5 and the Amazon Nova line support
 * cache points; text-only legacy families do not. Per the "Supported
 * models" table of https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
 * (checked 2026-10-17).
 */
const PROMPT_CACHING_CAPABLE_SUBSTRINGS = [
  "claude-3-5",
  "claude-3-7",
  "claude-sonnet-4",
  "claude-opus-4",
  "claude-haiku-4",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-haiku-5",
  "claude-fable-5",
  "claude-mythos-5",
  "nova-2-lite",
  "nova-lite",
  "nova-pro",
  "nova-premier",
  "nova-micro",
];

/**
 * Families that accept Converse `document` content blocks (PDF / docx /
 * txt input). The multimodal Claude 3+ and Nova families support
 * document blocks; the substring set mirrors the vision-capable list
 * minus the image-only Llama entries (Llama on Bedrock takes images but
 * not document blocks via Converse).
 */
const PDF_CAPABLE_SUBSTRINGS = [
  "claude-3",
  "claude-sonnet-4",
  "claude-opus-4",
  "claude-haiku-4",
  "nova-lite",
  "nova-pro",
  "nova-premier",
];

function matchesAny(modelId: string, fragments: string[]): boolean {
  const normalized = modelId.toLowerCase();

  return fragments.some((fragment) => normalized.includes(fragment));
}

/**
 * Infer whether a Bedrock model id exposes extended-thinking / reasoning
 * (Claude 3.7 + Claude 4). When true the adapter forwards
 * `ModelCallOptions.reasoning` as Converse
 * `additionalModelRequestFields.thinking`.
 *
 * @example
 * inferReasoningCapability("anthropic.claude-3-7-sonnet-20250219-v1:0"); // → true
 * inferReasoningCapability("us.amazon.nova-pro-v1:0");                    // → false
 */
export function inferReasoningCapability(modelId: string): boolean {
  return matchesAny(modelId, REASONING_CAPABLE_SUBSTRINGS);
}

/**
 * Infer whether a Bedrock model id honors Converse `cachePoint`
 * breakpoints (Claude 3.5+ / Nova). When true the adapter both maps
 * `ModelCallOptions.cacheControl` write breakpoints to cache points and
 * reports `Usage.cachedTokens` / `Usage.cacheWriteTokens`.
 *
 * @example
 * inferPromptCachingCapability("us.amazon.nova-pro-v1:0");                       // → true
 * inferPromptCachingCapability("meta.llama3-1-8b-instruct-v1:0");                // → false
 */
export function inferPromptCachingCapability(modelId: string): boolean {
  return matchesAny(modelId, PROMPT_CACHING_CAPABLE_SUBSTRINGS);
}

/**
 * Infer whether a Bedrock model id accepts Converse `document` content
 * blocks (PDF / document input — Claude 3+ / Nova). When false the agent
 * rejects a PDF attachment up front instead of dropping it at the wire.
 *
 * @example
 * inferPdfCapability("anthropic.claude-3-5-sonnet-20240620-v1:0"); // → true
 * inferPdfCapability("meta.llama3-2-90b-instruct-v1:0");           // → false
 */
export function inferPdfCapability(modelId: string): boolean {
  return matchesAny(modelId, PDF_CAPABLE_SUBSTRINGS);
}

/**
 * Claude on Bedrock accepts a `cachePoint` in `system`, `messages` and
 * `tools`; Amazon Nova accepts one only in `system` and `messages`
 * (https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html,
 * "Fields that accept prompt cache checkpoints", checked 2026-10-17).
 * Unknown families get no tool cache point.
 *
 * @example
 * supportsToolCachePoint("global.anthropic.claude-sonnet-4-6"); // true
 * supportsToolCachePoint("amazon.nova-pro-v1:0"); // false
 */
export function supportsToolCachePoint(modelId: string): boolean {
  return modelId.toLowerCase().includes("anthropic.claude");
}

/** Claude families whose cache points accept the 1-hour TTL. */
const ONE_HOUR_TTL_PATTERN =
  /anthropic\.claude-(?:(?:opus|sonnet|haiku|fable|mythos)-5|opus-4-[5-9]|sonnet-4-[5-9]|haiku-4-5)/;

/**
 * Claude models whose Converse `cachePoint` accepts `ttl: "1h"`: Claude
 * Haiku 4.5, the 4.5+ Sonnet / Opus line and every Claude 5 family. Any
 * other model gets no `ttl` field (the 5-minute default), since AWS
 * warns that sending it to a 5-minute-only model "can result in a
 * ValidationException" (same page, checked 2026-10-17).
 *
 * @example
 * supportsOneHourCacheTtl("anthropic.claude-haiku-4-5-20251001-v1:0"); // true
 * supportsOneHourCacheTtl("anthropic.claude-3-7-sonnet-20250219-v1:0"); // false
 */
export function supportsOneHourCacheTtl(modelId: string): boolean {
  return ONE_HOUR_TTL_PATTERN.test(modelId.toLowerCase());
}
