import type { EmbedderConfig, ModelConfig, ModelPricing } from "@warlock.js/ai";
import type { Config } from "ollama";

/**
 * Configuration for the Ollama SDK adapter.
 *
 * Wraps the official `ollama` client `Config`. `host` is optional and
 * defaults to the client's own default (`http://127.0.0.1:11434`) —
 * point it at a remote/self-hosted Ollama server when needed. `headers`
 * is handy for gateways that require auth in front of Ollama. The
 * whole object is forwarded to `new Ollama(...)`.
 *
 * `provider` labels the SDK upstream — flows through to
 * `ModelContract.provider`, `AgentReport.model`, logs, and
 * provider-aware middleware. Defaults to `"ollama"`.
 *
 * `pricing` is an optional SDK-level registry keyed by model name.
 * Local Ollama is free so this is usually unset; it exists for parity
 * (hosted Ollama, internal chargeback). Resolution at `model()` call
 * time: per-model `pricing` > this SDK registry > `undefined`.
 *
 * @example
 * new OllamaSDK({});                                  // local default host
 * new OllamaSDK({ host: "http://gpu-box.internal:11434" });
 *
 * @example
 * new OllamaSDK({
 *   host: "https://ollama.internal",
 *   headers: { Authorization: `Bearer ${process.env.OLLAMA_TOKEN}` },
 * });
 */
export type OllamaSDKConfig = Partial<Config> & {
  provider?: string;
  /**
   * Per-model USD pricing registry, keyed by model name. Surfaced onto
   * every `OllamaModel` produced by `model()`; per-model
   * `OllamaModelConfig.pricing` still wins when both are set.
   */
  pricing?: Record<string, ModelPricing>;
};

/**
 * Per-model configuration for `OllamaSDK.model()`. `name` is the
 * Ollama model tag (e.g. `"llama3.1"`, `"qwen2.5:14b"`,
 * `"llama3.2-vision"`).
 *
 * @example
 * ollama.model({ name: "llama3.1" });
 * ollama.model({ name: "llama3.2-vision", vision: true });
 */
export type OllamaModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter checks the model tag against the known multimodal Ollama
   * families (see `known-vision-models.ts`). Explicit `true`/`false`
   * always wins over inference.
   */
  vision?: boolean;
  /**
   * Override the inferred `structuredOutput` capability. When omitted,
   * the adapter treats the model as capable and forwards
   * `responseSchema` via Ollama's native `format` JSON-schema field.
   * Set `false` for models that handle it poorly — the agent then
   * re-injects a soft schema hint into the system prompt instead.
   */
  structuredOutput?: boolean;
  /**
   * Override the auto-inferred reasoning / thinking capability. When
   * omitted, the adapter checks the model tag against the known
   * thinking-capable Ollama families (see `known-reasoning-models.ts`).
   * When `true`, the adapter maps `ModelCallOptions.reasoning` onto
   * Ollama's `think` request flag; when `false`/absent it leaves
   * `think` unset so the daemon uses its default. Explicit
   * `true`/`false` always wins over inference.
   */
  reasoning?: boolean;
};

/**
 * Per-embedder configuration for `OllamaSDK.embedder()`. `name` is the
 * embeddings model tag (e.g. `"nomic-embed-text"`,
 * `"mxbai-embed-large"`). `dimensions` is forwarded to Ollama's
 * `dimensions` truncation field (supported by newer embedding models).
 *
 * @example
 * ollama.embedder({ name: "nomic-embed-text" });
 */
export type OllamaEmbedderConfig = EmbedderConfig;
