import type { ModelConfig } from "@warlock.js/ai";
import type { OpenAISDKConfig } from "@warlock.js/ai-openai";

/**
 * Configuration for the Mistral SDK adapter.
 *
 * Mistral exposes an **OpenAI-compatible** Chat Completions + Embeddings
 * API, so `MistralSDKConfig` is the OpenAI client options
 * ({@link OpenAISDKConfig}) with this provider's sensible defaults baked
 * in. The whole object is forwarded to the internal `OpenAISDK`, so any
 * upstream client option (`timeout`, `maxRetries`, `defaultHeaders`,
 * `fetch`, …) is accepted verbatim.
 *
 * Defaults injected by `MistralSDK` when omitted:
 * - `baseURL` → `https://api.mistral.ai/v1` (the OpenAI-compatible endpoint).
 * - `provider` → `"mistral"` (flows through to `ModelContract.provider`,
 *   `AgentReport.model.provider`, logs, and provider-aware middleware).
 * - `pricing` → merged on top of {@link MISTRAL_DEFAULT_PRICING} so cost
 *   accounting works out of the box; a caller entry for the same model id
 *   wins.
 *
 * `apiKey` is still required (your Mistral API key) — it has no honest
 * default. Point `baseURL` elsewhere only to reach a Mistral-compatible
 * gateway / proxy.
 *
 * @example
 * new MistralSDK({ apiKey: process.env.MISTRAL_API_KEY! });
 *
 * @example
 * // Override the default pricing for billing-grade cost truth.
 * new MistralSDK({
 *   apiKey,
 *   pricing: { "mistral-large-latest": { input: 2, output: 6 } },
 * });
 */
export type MistralSDKConfig = OpenAISDKConfig;

/**
 * Per-model configuration for `MistralSDK.model()`. Extends the neutral
 * {@link ModelConfig} with the same capability overrides the wrapped
 * OpenAI adapter understands — Mistral speaks the same Chat Completions
 * wire, so they pass straight through.
 *
 * The difference from the OpenAI adapter is **inference**: when `vision`
 * / `reasoning` are omitted, `MistralSDK` infers them from this
 * provider's own family fragments (`pixtral` / `magistral`, see
 * `known-models.ts`) rather than the OpenAI prefixes. An explicit
 * `true` / `false` always wins over that inference.
 *
 * @example
 * mistral.model({ name: "mistral-large-latest" });           // vision auto-true
 * mistral.model({ name: "magistral-medium-latest" });        // reasoning auto-true
 * mistral.model({ name: "some-fine-tune", vision: true });   // explicit override
 */
export type MistralModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter checks the model id against this provider's multimodal
   * family fragments (`pixtral`, recent `mistral-large` / `mistral-medium`
   * / `ministral-3` generations — see `known-models.ts`). Explicit
   * `true` / `false` always wins over inference.
   */
  vision?: boolean;
  /**
   * Override the auto-inferred reasoning capability. When omitted, the
   * adapter checks the model id against the reasoning fragments
   * (`magistral` family + hybrid `mistral-small`). When the resolved
   * value is `true`, `ModelCallOptions.reasoning.effort` is forwarded as
   * the OpenAI-compatible `reasoning_effort`; when `false` it is dropped.
   * Explicit `true` / `false` always wins over inference.
   */
  reasoning?: boolean;
  /**
   * Override the inferred `structuredOutput` capability, mirroring the
   * wrapped OpenAI adapter. When omitted, treated as capable unless
   * `responseFormat` forces a loose mode (`"json_object"` / `"text"`).
   */
  structuredOutput?: boolean;
  /**
   * Prompt-cache routing key, sent as `prompt_cache_key` so requests that
   * share a prefix land on the same Mistral cache. Use a stable value per
   * conversation or tenant. Sent only while the SDK keeps its default
   * provider label.
   *
   * @example
   * model({ name: "mistral-large-latest", promptCacheKey: `conversation:${conversationId}` });
   */
  promptCacheKey?: string;
  /**
   * Override the wire-level `response_format` the adapter emits when the
   * caller supplies a response schema (`"json_schema"` | `"json_object"`
   * | `"text"`). Forwarded verbatim to the wrapped OpenAI adapter — use
   * for a Mistral model / gateway that rejects strict `json_schema`.
   */
  responseFormat?: "json_schema" | "json_object" | "text";
  /**
   * Opt into PDF / document **input** (default `false`). Forwarded to the
   * wrapped OpenAI adapter, which maps `{ type: "pdf" }` parts to
   * OpenAI-compatible `file` parts.
   */
  pdf?: boolean;
  /**
   * Opt into audio **input** (default `false`). Forwarded to the wrapped
   * OpenAI adapter, which maps `{ type: "audio" }` parts to
   * OpenAI-compatible `input_audio` parts.
   */
  audio?: boolean;
};
