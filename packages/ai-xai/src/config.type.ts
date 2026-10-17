import type { EmbedderConfig, ImageModelConfig, ModelConfig, ModelPricing } from "@warlock.js/ai";
import type { OpenAISDKConfig } from "@warlock.js/ai-openai";

/**
 * Configuration for the xAI Grok SDK adapter.
 *
 * xAI speaks the OpenAI Chat Completions protocol, so `XaiSDK` is a thin
 * wrapper over `OpenAISDK` and this config is the same `OpenAISDKConfig`
 * shape (every upstream `ClientOptions` value — `timeout`, `maxRetries`,
 * `defaultHeaders`, `fetch`, `organization`, … — is forwarded verbatim).
 *
 * The two xAI-specific defaults are applied by the wrapper, so neither
 * is required:
 * - `baseURL` defaults to `https://api.x.ai/v1` (the xAI
 *   OpenAI-compatible endpoint). Override only to target a proxy/gateway.
 * - `provider` defaults to `"xai"` — flows through to
 *   `ModelContract.provider`, `AgentReport.model.provider`, logs, and any
 *   provider-aware middleware. Set it to relabel a gateway upstream.
 *
 * `apiKey` is still required (your xAI API key); everything else is
 * optional. `pricing` is an optional SDK-level registry keyed by model
 * name — resolution at `model()` call time: per-model `pricing` > this
 * SDK registry > `undefined` (no cost computed).
 *
 * @example
 * new XaiSDK({ apiKey: process.env.XAI_API_KEY! });
 *
 * @example
 * // Custom proxy + SDK-level pricing (USD per 1M tokens).
 * new XaiSDK({
 *   apiKey,
 *   baseURL: "https://gateway.internal/x.ai/v1",
 *   pricing: { "grok-4": { input: 3, output: 15 } },
 * });
 */
export type XaiSDKConfig = OpenAISDKConfig;

/**
 * Per-model configuration for `XaiSDK.model()`. `name` is the Grok model
 * id (e.g. `"grok-4"`, `"grok-3"`, `"grok-3-mini"`, `"grok-2-vision"`).
 *
 * The wrapper injects xAI's OWN capability inference (see
 * `known-models.ts`) before delegating to `OpenAISDK.model()`, so Grok
 * model names resolve to the right `vision` / `reasoning` flags even
 * though they don't match OpenAI's `gpt-*` / `o*` prefixes. Any explicit
 * value below still wins over that inference.
 *
 * @example
 * xai.model({ name: "grok-4" });                  // vision + reasoning auto-true
 * xai.model({ name: "grok-3-mini" });             // reasoning auto-true
 * xai.model({ name: "grok-2-vision" });           // vision auto-true
 * xai.model({ name: "grok-3", vision: true });    // explicit capability override
 */
export type XaiModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter checks the model id against xAI's known vision families
   * (`grok-4`, `grok-2-vision`; see `known-models.ts`). Explicit
   * `true`/`false` always wins over inference — useful for new Grok
   * variants or a gateway exposing vision under a custom name.
   */
  vision?: boolean;
  /**
   * Override the auto-inferred reasoning capability. When omitted, the
   * adapter checks the model id against xAI's known reasoning families
   * (`grok-4`, `grok-3-mini`; see `known-models.ts`). When capable,
   * `ModelCallOptions.reasoning.effort` is forwarded to the
   * OpenAI-compatible `reasoning_effort` param. Explicit `true`/`false`
   * always wins over inference.
   */
  reasoning?: boolean;
  /**
   * Override the inferred `structuredOutput` capability. xAI supports
   * JSON-schema structured outputs on the Chat Completions endpoint, so
   * the wrapper leaves this to the underlying OpenAI adapter (default
   * `true`). Set `false` for a model/route that rejects strict
   * `json_schema` — the agent then re-injects a soft schema hint.
   */
  structuredOutput?: boolean;
  /**
   * Prompt-cache routing key, sent as `prompt_cache_key` so requests that
   * share a prefix land on the same xAI cache. Use a stable value per
   * conversation or tenant. Sent only while the SDK keeps its default
   * provider label.
   *
   * @example
   * model({ name: "grok-4.3", promptCacheKey: `conversation:${conversationId}` });
   */
  promptCacheKey?: string;
};

/**
 * Per-embedder configuration for `XaiSDK.embedder()`. Mirrors the
 * neutral {@link EmbedderConfig}.
 *
 * NOTE: xAI does not currently expose a public embeddings endpoint, so
 * `embedder()` is wired for protocol parity but a call will fail
 * upstream. Use a dedicated embeddings provider (e.g.
 * `@warlock.js/ai-openai`) for vectors.
 *
 * @example
 * xai.embedder({ name: "text-embedding-3-small" }); // delegates; xAI has no embeddings API yet
 */
export type XaiEmbedderConfig = EmbedderConfig;

/**
 * Per-model configuration for `XaiSDK.image()`. Mirrors the neutral
 * {@link ImageModelConfig}.
 *
 * NOTE: `image()` delegates to the wrapped OpenAI Images adapter, which
 * only recognizes the `gpt-image-*` / `dall-e-*` families and rejects
 * any other id at construction. xAI's image generation ("Grok Imagine")
 * is a separate surface, so this hook exists for protocol parity rather
 * than a verified Grok image model. Use `@warlock.js/ai-openai`'s
 * `image()` for OpenAI-Images-compatible generation.
 */
export type XaiImageConfig = ImageModelConfig;

/**
 * Re-exported so consumers can build an SDK-level pricing registry
 * without reaching into `@warlock.js/ai` directly.
 */
export type { ModelPricing };
