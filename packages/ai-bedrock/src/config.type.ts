import type { EmbedderConfig, ModelConfig, ModelPricing } from "@warlock.js/ai";
import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";

/**
 * Configuration for the AWS Bedrock SDK adapter.
 *
 * Bedrock authenticates via the AWS credential chain, not an API key.
 * `region` is required by the runtime client; `credentials` is optional
 * — when omitted, the standard AWS provider chain (env vars, shared
 * config, IAM role, SSO) resolves them, exactly like every other AWS
 * SDK client. The whole object is forwarded to `BedrockRuntimeClient`,
 * so any additional client option (custom `requestHandler`, `endpoint`,
 * retry config) is accepted as-is.
 *
 * `provider` labels the SDK upstream — flows through to
 * `ModelContract.provider`, `AgentReport.model`, logs, and
 * provider-aware middleware. Defaults to `"bedrock"`.
 *
 * `pricing` is an optional SDK-level registry keyed by Bedrock model
 * id. Resolution at `model()` call time: per-model `pricing` >
 * this SDK registry > `undefined` (no cost computed).
 *
 * @example
 * // Ambient credential chain (env / role / SSO):
 * new BedrockSDK({ region: "us-east-1" });
 *
 * @example
 * // Explicit static credentials:
 * new BedrockSDK({
 *   region: "us-east-1",
 *   credentials: { accessKeyId: "AKIA...", secretAccessKey: "..." },
 *   pricing: {
 *     "anthropic.claude-sonnet-4-5-20250929-v1:0": { input: 3, output: 15 },
 *   },
 * });
 */
export type BedrockSDKConfig = BedrockRuntimeClientConfig & {
  provider?: string;
  /**
   * Per-model USD pricing registry, keyed by Bedrock model id.
   * Surfaced onto every `BedrockModel` produced by `model()`;
   * per-model `BedrockModelConfig.pricing` still wins when both are
   * set.
   */
  pricing?: Record<string, ModelPricing>;
};

/**
 * Per-model configuration for `BedrockSDK.model()`. `name` is the
 * Bedrock model id or inference-profile id (e.g.
 * `"anthropic.claude-sonnet-4-5-20250929-v1:0"`,
 * `"us.amazon.nova-pro-v1:0"`).
 *
 * @example
 * bedrock.model({ name: "anthropic.claude-sonnet-4-5-20250929-v1:0" });
 * bedrock.model({ name: "meta.llama3-1-8b-instruct-v1:0", vision: false });
 */
export type BedrockModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter checks the model id against the known multimodal families
   * (see `known-vision-models.ts`). Explicit `true`/`false` always
   * wins over inference.
   */
  vision?: boolean;
  /**
   * Override the inferred `structuredOutput` capability. When omitted,
   * the adapter treats the model as capable and forwards
   * `responseSchema` via Converse's native `outputConfig.textFormat`
   * (JSON-schema structured outputs). Set `false` for model families
   * that don't support it — the agent then re-injects a soft schema
   * hint into the system prompt instead.
   */
  structuredOutput?: boolean;
  /**
   * Override the auto-inferred reasoning / extended-thinking capability.
   * When omitted, the adapter infers `true` for Claude 3.7 + Claude 4
   * families (see `known-capabilities.ts`). When capable, the adapter
   * forwards `ModelCallOptions.reasoning` as Converse
   * `additionalModelRequestFields.thinking`.
   */
  reasoning?: boolean;
  /**
   * Override the auto-inferred prompt-caching capability. When omitted,
   * the adapter infers `true` for Claude 3.5+/3.7/4 and Nova families.
   * When capable, the adapter maps `ModelCallOptions.cacheControl` write
   * breakpoints to Converse `cachePoint` blocks and reports
   * `Usage.cachedTokens` / `Usage.cacheWriteTokens` from the response.
   */
  promptCaching?: boolean;
  /**
   * Override the auto-inferred PDF / document-input capability. When
   * omitted, the adapter infers `true` for Claude 3+ / Nova families
   * that accept Converse `document` content blocks. When false the
   * agent rejects a PDF attachment up front.
   */
  pdf?: boolean;
  /**
   * Override the audio-input capability. Defaults to `false` — Bedrock
   * Converse does not accept audio content blocks for the families this
   * adapter targets. Set `true` only for a model id you have confirmed
   * supports audio input on Converse.
   */
  audio?: boolean;
};

/**
 * Per-embedder configuration for `BedrockSDK.embedder()`. `name` is the
 * embeddings model id — the adapter targets the Amazon Titan Text
 * Embeddings family (`amazon.titan-embed-text-v2:0` and v1).
 * `dimensions` is forwarded to Titan v2's `dimensions` body field
 * (supported truncation: 256 / 512 / 1024).
 *
 * @example
 * bedrock.embedder({ name: "amazon.titan-embed-text-v2:0" });
 * bedrock.embedder({ name: "amazon.titan-embed-text-v2:0", dimensions: 256 });
 */
export type BedrockEmbedderConfig = EmbedderConfig;
