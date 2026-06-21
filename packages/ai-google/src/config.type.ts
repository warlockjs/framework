import type { EmbedderConfig, ModelConfig, ModelPricing } from "@warlock.js/ai";
import type { GoogleGenAIOptions } from "@google/genai";

/**
 * Configuration for the Google Gemini SDK adapter.
 *
 * Wraps `GoogleGenAIOptions` from `@google/genai`. The common path is
 * the Gemini API with an `apiKey`; the same options also support
 * Vertex AI (`vertexai: true` + `project` / `location`). The whole
 * object is forwarded to `new GoogleGenAI(...)`, so any client option
 * (`apiVersion`, `httpOptions`) is accepted as-is.
 *
 * `provider` labels the SDK upstream — flows through to
 * `ModelContract.provider`, `AgentReport.model`, logs, and
 * provider-aware middleware. Defaults to `"google"`.
 *
 * `pricing` is an optional SDK-level registry keyed by model name.
 * Resolution at `model()` call time: per-model `pricing` > this SDK
 * registry > `undefined` (no cost computed).
 *
 * @example
 * new GoogleSDK({ apiKey: process.env.GEMINI_API_KEY! });
 *
 * @example
 * // Vertex AI:
 * new GoogleSDK({ vertexai: true, project: "my-proj", location: "us-central1" });
 *
 * @example
 * new GoogleSDK({
 *   apiKey,
 *   pricing: { "gemini-2.5-flash": { input: 0.3, output: 2.5 } },
 * });
 */
export type GoogleSDKConfig = GoogleGenAIOptions & {
  provider?: string;
  /**
   * Per-model USD pricing registry, keyed by model name. Surfaced onto
   * every `GoogleModel` produced by `model()`; per-model
   * `GoogleModelConfig.pricing` still wins when both are set.
   */
  pricing?: Record<string, ModelPricing>;
};

/**
 * Per-model configuration for `GoogleSDK.model()`. `name` is the
 * Gemini model id (e.g. `"gemini-2.5-flash"`, `"gemini-2.5-pro"`).
 *
 * @example
 * google.model({ name: "gemini-2.5-flash" });
 * google.model({ name: "gemini-1.0-pro", vision: false });
 */
export type GoogleModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter checks the model id against the known multimodal Gemini
   * families (see `known-vision-models.ts`). Explicit `true`/`false`
   * always wins over inference.
   */
  vision?: boolean;
  /**
   * Override the inferred `structuredOutput` capability. When omitted,
   * the adapter treats the model as capable and forwards
   * `responseSchema` via Gemini's native `responseJsonSchema` +
   * `responseMimeType: "application/json"`. Set `false` for models
   * that don't support it — the agent then re-injects a soft schema
   * hint into the system prompt instead.
   */
  structuredOutput?: boolean;
  /**
   * Override the auto-inferred reasoning capability. When omitted, the
   * adapter treats every Gemini model as reasoning-capable (the 2.5
   * family thinks; older families simply ignore an empty thinking
   * budget). When `true`, `ModelCallOptions.reasoning` maps to Gemini's
   * `thinkingConfig` (`reasoning.maxTokens` → `thinkingBudget`,
   * `reasoning.effort` → a budget bucket); `usageMetadata.thoughtsTokenCount`
   * surfaces as `Usage.reasoningTokens`. Set `false` to stop forwarding
   * thinking config for a model that rejects it.
   */
  reasoning?: boolean;
  /**
   * Override the auto-inferred audio-input capability. When omitted, the
   * adapter mirrors the multimodal `vision` inference (every Gemini 1.5 /
   * 2.x model accepts audio parts). Explicit `true`/`false` always wins.
   */
  audio?: boolean;
  /**
   * Override the auto-inferred PDF / document-input capability. When
   * omitted, the adapter mirrors the multimodal `vision` inference (every
   * Gemini 1.5 / 2.x model accepts PDF document parts). Explicit
   * `true`/`false` always wins.
   */
  pdf?: boolean;
};

/**
 * Per-embedder configuration for `GoogleSDK.embedder()`. `name` is the
 * embeddings model id (e.g. `"gemini-embedding-001"`,
 * `"text-embedding-004"`). `dimensions` is forwarded to Gemini's
 * `outputDimensionality` truncation hint (supported by 2024+ models).
 *
 * @example
 * google.embedder({ name: "gemini-embedding-001" });
 * google.embedder({ name: "gemini-embedding-001", dimensions: 768 });
 */
export type GoogleEmbedderConfig = EmbedderConfig;
