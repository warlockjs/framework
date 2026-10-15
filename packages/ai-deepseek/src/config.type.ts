import type { EmbedderConfig, ImageModelConfig, ModelConfig } from "@warlock.js/ai";
import type { OpenAISDKConfig } from "@warlock.js/ai-openai";

/**
 * Per-model `response_format` override forwarded to the wrapped OpenAI
 * model. Mirrors the OpenAI adapter's union (DeepSeek speaks the same
 * OpenAI-compatible Chat Completions protocol):
 *
 * - `"json_schema"` — strict token-level shape enforcement.
 * - `"json_object"` — guarantees valid JSON, NOT shape; the agent
 *   re-injects the schema as a soft prompt hint.
 * - `"text"` — no `response_format` on the wire; relies on the prompt hint.
 */
export type DeepSeekResponseFormat = "json_schema" | "json_object" | "text";

/**
 * Configuration for the DeepSeek SDK adapter.
 *
 * DeepSeek's API is OpenAI-compatible on the wire, so this config is the
 * {@link OpenAISDKConfig} shape with one ergonomic change: `baseURL` and
 * `provider` are **optional** because the adapter defaults them to
 * DeepSeek's endpoint (`https://api.deepseek.com`) and the `"deepseek"`
 * label. Pass only your `apiKey` for the common path; every other upstream
 * `openai` `ClientOptions` value (`timeout`, `maxRetries`,
 * `defaultHeaders`, `fetch`, …) is forwarded verbatim to the wrapped
 * `OpenAISDK`.
 *
 * `provider` flows through to `ModelContract.provider`, `AgentReport.model`,
 * logs, and any provider-aware middleware. Defaults to `"deepseek"`.
 *
 * `pricing` is an optional SDK-level registry keyed by model name —
 * resolution at `model()` time is per-model `pricing` > this SDK registry >
 * the adapter's built-in DeepSeek defaults > `undefined`.
 *
 * @example
 * new DeepSeekSDK({ apiKey: process.env.DEEPSEEK_API_KEY! });
 *
 * @example
 * // Override the default endpoint (e.g. a proxy) or the provider label:
 * new DeepSeekSDK({
 *   apiKey,
 *   baseURL: "https://my-gateway.example.com/deepseek",
 *   provider: "deepseek-proxy",
 * });
 *
 * @example
 * new DeepSeekSDK({
 *   apiKey,
 *   pricing: { "deepseek-chat": { input: 0.14, output: 0.28, cachedInput: 0.0028 } },
 * });
 */
export type DeepSeekSDKConfig = Omit<OpenAISDKConfig, "baseURL" | "provider"> & {
  /**
   * Override the DeepSeek base URL. Defaults to
   * `https://api.deepseek.com` (the OpenAI-compatible endpoint). Set this
   * only to route through a proxy or a self-hosted gateway.
   */
  baseURL?: string;
  /**
   * Override the upstream label. Defaults to `"deepseek"`. Flows through
   * to `ModelContract.provider`, `AgentReport.model`, and logs.
   */
  provider?: string;
};

/**
 * Per-model configuration for `DeepSeekSDK.model()`. `name` is a DeepSeek
 * chat model id (e.g. `"deepseek-chat"`, `"deepseek-reasoner"`).
 *
 * Mirrors the OpenAI adapter's per-model overrides field-for-field —
 * DeepSeek runs on the same OpenAI-compatible wire. The difference from
 * using `OpenAISDK` directly is the **default** capability inference:
 * `DeepSeekSDK` derives `vision` and `reasoning` from DeepSeek's own
 * model-name lists (see `known-models.ts`) rather than OpenAI's prefix
 * lists, then injects them as explicit booleans. An explicit value you
 * pass here always wins over that inference.
 *
 * @example
 * deepseek.model({ name: "deepseek-chat" });                  // reasoning auto-false
 * deepseek.model({ name: "deepseek-reasoner" });              // reasoning auto-true
 * deepseek.model({ name: "deepseek-chat", reasoning: true }); // explicit override
 */
export type DeepSeekModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter infers from the DeepSeek model name (always `false` today —
   * no DeepSeek chat model documents image input). Explicit `true`/`false`
   * always wins.
   */
  vision?: boolean;
  /**
   * Override the auto-inferred reasoning capability. When omitted, the
   * adapter infers from the DeepSeek model name — `true` for
   * `deepseek-reasoner` and the `*-pro` tier, `false` for `deepseek-chat`
   * / `*-flash`. Drives whether the reasoning-effort knob is forwarded.
   * Explicit `true`/`false` always wins.
   */
  reasoning?: boolean;
  /**
   * Override the inferred `structuredOutput` capability. Forwarded to the
   * wrapped OpenAI model, where it defaults to `true` unless
   * `responseFormat` forces a loose mode.
   */
  structuredOutput?: boolean;
  /**
   * Override the wire-level `response_format` the adapter emits for a
   * response schema. Use a loose mode (`"json_object"` / `"text"`) for a
   * route that rejects strict `json_schema`. Forwarded to the wrapped
   * OpenAI model unchanged.
   */
  responseFormat?: DeepSeekResponseFormat;
  /**
   * Opt into PDF / document **input**. Forwarded to the wrapped OpenAI
   * model; off by default.
   */
  pdf?: boolean;
  /**
   * Opt into audio **input**. Forwarded to the wrapped OpenAI model; off
   * by default.
   */
  audio?: boolean;
};

/**
 * Per-embedder configuration for `DeepSeekSDK.embedder()`. Mirrors the
 * neutral {@link EmbedderConfig}.
 *
 * NOTE: DeepSeek does not officially document an OpenAI-compatible
 * embeddings endpoint (mid-2026). `embedder()` is delegated to the wrapped
 * `OpenAISDK` for completeness, so it works against any compatible gateway
 * you point `baseURL` at — but calling `.embed()` against the stock
 * `https://api.deepseek.com` endpoint may fail upstream. Prefer a
 * dedicated embeddings provider for RAG.
 */
export type DeepSeekEmbedderConfig = EmbedderConfig;

/**
 * Per-model configuration for `DeepSeekSDK.image()`. Mirrors the neutral
 * {@link ImageModelConfig}.
 *
 * NOTE: DeepSeek does not document an image-generation endpoint
 * (mid-2026). `image()` is delegated to the wrapped `OpenAISDK` for
 * parity; a non-image model id is rejected by the wrapped OpenAI image
 * model at construction exactly as it would be there.
 */
export type DeepSeekImageConfig = ImageModelConfig;
