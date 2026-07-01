import type { EmbedderConfig, ModelConfig, ModelPricing } from "@warlock.js/ai";
import type { OpenAISDKConfig } from "@warlock.js/ai-openai";

/**
 * Configuration for the Groq SDK adapter.
 *
 * Groq speaks the OpenAI Chat Completions wire protocol, so this type
 * is structurally `OpenAISDKConfig` (which is `openai`'s `ClientOptions`
 * + `provider` + `pricing`) with two ergonomic differences:
 *
 * - `baseURL` is **optional** here — it defaults to Groq's
 *   OpenAI-compatible endpoint (`https://api.groq.com/openai/v1`) when
 *   omitted, so the common path is just `{ apiKey }`. Override it only
 *   to point at a proxy/gateway.
 * - `provider` defaults to `"groq"` (not `"openai"`), so every model the
 *   SDK produces self-identifies as Groq on `ModelContract.provider`,
 *   `AgentReport.model`, logs, and provider-aware middleware.
 *
 * Every other upstream `ClientOptions` field (`timeout`, `maxRetries`,
 * `defaultHeaders`, `fetch`, `organization`, …) is forwarded verbatim to
 * the internal `OpenAISDK` it wraps.
 *
 * `pricing` is an optional SDK-level registry keyed by model name.
 * Resolution at `model()` call time: per-model `pricing` > this SDK
 * registry > the adapter's built-in default rates for known Groq models
 * > `undefined` (no cost computed).
 *
 * @example
 * // Common path — apiKey only; baseURL + provider default to Groq.
 * new GroqSDK({ apiKey: process.env.GROQ_API_KEY! });
 *
 * @example
 * // SDK-level pricing registry — USD per 1,000,000 tokens.
 * new GroqSDK({
 *   apiKey,
 *   pricing: { "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 } },
 * });
 */
export type GroqSDKConfig = Omit<OpenAISDKConfig, "baseURL" | "provider"> & {
  /**
   * Override Groq's OpenAI-compatible endpoint. Defaults to
   * `https://api.groq.com/openai/v1` when omitted — set this only to
   * route through a proxy or self-hosted gateway.
   */
  baseURL?: string;
  /**
   * Override the upstream provider label. Defaults to `"groq"`; flows
   * through to `ModelContract.provider` and every report/log derived
   * from it.
   */
  provider?: string;
  /**
   * Per-model USD pricing registry, keyed by model name. Surfaced onto
   * every model produced by `model()`; per-model `GroqModelConfig.pricing`
   * still wins when both are set, and the adapter's built-in default
   * rates fill the gap when neither is provided.
   */
  pricing?: Record<string, ModelPricing>;
};

/**
 * Per-model configuration for `GroqSDK.model()`. `name` is the
 * Groq-hosted model id — the upstream open-weight name (e.g.
 * `"llama-3.3-70b-versatile"`, `"openai/gpt-oss-120b"`,
 * `"deepseek-r1-distill-llama-70b"`), NOT an OpenAI id.
 *
 * The capability overrides mirror the OpenAI adapter, but their
 * auto-inference is driven by **Groq's** model-name lists
 * (`known-models.ts`) rather than OpenAI's — that is the core reason
 * this wrapper exists. Any explicit `true`/`false` always wins over
 * inference.
 *
 * @example
 * groq.model({ name: "llama-3.3-70b-versatile" });           // text, no vision/reasoning
 * groq.model({ name: "openai/gpt-oss-120b" });               // vision + reasoning auto-true
 * groq.model({ name: "custom-llama", vision: true });        // explicit override
 */
export type GroqModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter checks the model id against Groq's known multimodal families
   * (see `known-models.ts`) — `true` for `gpt-oss` / `llama-4` /
   * `llama-3.2-*-vision`, `false` otherwise. Explicit `true`/`false`
   * always wins.
   */
  vision?: boolean;
  /**
   * Override the auto-inferred reasoning capability. When omitted, the
   * adapter checks the model id against Groq's known reasoning families
   * (see `known-models.ts`) — `true` for `gpt-oss` / `deepseek-r1` /
   * `qwq` / `qwen3`, `false` otherwise. Drives whether
   * `ModelCallOptions.reasoning` maps to `reasoning_effort` on the wire.
   * Explicit `true`/`false` always wins.
   */
  reasoning?: boolean;
  /**
   * Override the inferred `structuredOutput` capability. Defaults to
   * `true` — Groq's Chat Completions endpoint accepts OpenAI-style
   * `response_format`. Set `false` (or pass `responseFormat` on the
   * underlying model) for a model that rejects strict `json_schema`, so
   * the agent re-injects a soft schema hint into the system prompt.
   */
  structuredOutput?: boolean;
};

/**
 * Per-embedder configuration for `GroqSDK.embedder()`. Mirrors the
 * neutral {@link EmbedderConfig}.
 *
 * NOTE: as of mid-2026 Groq does **not** expose an OpenAI-compatible
 * embeddings endpoint — `embedder()` is delegated to the inner
 * `OpenAISDK` for API symmetry, but a live `.embed()` call will fail at
 * the provider. Use a dedicated embeddings provider
 * (`@warlock.js/ai-openai` / `@warlock.js/ai-google`) for retrieval.
 *
 * @example
 * // Will construct, but Groq currently has no embeddings model to call.
 * groq.embedder({ name: "some-future-embeddings-model" });
 */
export type GroqEmbedderConfig = EmbedderConfig;
