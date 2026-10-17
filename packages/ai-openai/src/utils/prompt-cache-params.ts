import type { OpenAIModelConfig } from "../config.type";

/** The prompt-cache request fields common to Chat Completions and Responses. */
export type PromptCacheParams = {
  prompt_cache_key?: string;
  prompt_cache_retention?: NonNullable<OpenAIModelConfig["promptCacheRetention"]>;
};

/**
 * Provider labels whose OpenAI-compatible endpoint documents a
 * `prompt_cache_key` request field:
 *
 * - `openai` — https://developers.openai.com/api/docs/guides/prompt-caching
 * - `xai` — Chat Completions accepts `prompt_cache_key` ("plumbed to
 *   x-grok-conv-id"), https://docs.x.ai/openapi.json and
 *   https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits
 * - `mistral` — https://docs.mistral.ai/studio/conversations/advanced/prompt-caching
 *
 * Groq and DeepSeek cache automatically and document no request hint, so
 * they receive nothing (checked 2026-10-17).
 */
const PROMPT_CACHE_KEY_PROVIDERS: ReadonlySet<string> = new Set(["openai", "xai", "mistral"]);

/**
 * Build the prompt-cache request fields from the model config.
 * `prompt_cache_key` is sent for the providers that document it
 * ({@link PROMPT_CACHE_KEY_PROVIDERS}); `prompt_cache_retention` is
 * OpenAI-only. Any other provider label — including a custom label on a
 * wrapper SDK — gets neither, since an unknown endpoint may reject them.
 */
export function buildPromptCacheParams(
  provider: string,
  config: Pick<OpenAIModelConfig, "promptCacheKey" | "promptCacheRetention">,
): PromptCacheParams {
  const sendsKey = PROMPT_CACHE_KEY_PROVIDERS.has(provider);

  return {
    ...(sendsKey && config.promptCacheKey !== undefined
      ? { prompt_cache_key: config.promptCacheKey }
      : {}),
    ...(provider === "openai" && config.promptCacheRetention !== undefined
      ? { prompt_cache_retention: config.promptCacheRetention }
      : {}),
  };
}
