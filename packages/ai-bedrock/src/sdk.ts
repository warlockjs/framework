import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type {
  EmbedderContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { approximateTokenCount } from "@warlock.js/ai";
import type {
  BedrockEmbedderConfig,
  BedrockModelConfig,
  BedrockSDKConfig,
} from "./config.type";
import { BedrockEmbedder } from "./embedder";
import { BedrockModel } from "./model";

/**
 * AWS Bedrock-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for any Bedrock-hosted model via
 * the Converse API. A single `BedrockSDK` holds one live
 * `BedrockRuntimeClient`, shared by every `ModelContract` and
 * `EmbedderContract` it produces. Construct one SDK per AWS
 * account/region and reuse it everywhere.
 *
 * **Responsibility.**
 * - Owns: a long-lived `BedrockRuntimeClient` (region, credential
 *   chain) and its lifetime. Factory for `BedrockModel` /
 *   `BedrockEmbedder` instances sharing that client.
 * - Does NOT own: anything per-call — those live in `BedrockModel` /
 *   `BedrockEmbedder` and the agent runtime.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across many calls"): the AWS client is heavy to construct and
 * designed for reuse; keeping it on `this` aligns with the
 * `new BedrockRuntimeClient(...)` upstream convention.
 *
 * @example
 * const bedrock = new BedrockSDK({ region: "us-east-1" });
 * const model = bedrock.model({ name: "anthropic.claude-sonnet-4-5-20250929-v1:0" });
 * const embedder = bedrock.embedder({ name: "amazon.titan-embed-text-v2:0" });
 */
export class BedrockSDK implements SDKAdapterContract {
  private readonly client: BedrockRuntimeClient;
  private readonly provider: string;
  private readonly pricing?: Record<string, ModelPricing>;

  public constructor(config: BedrockSDKConfig) {
    const { provider, pricing, ...clientConfig } = config;

    this.client = new BedrockRuntimeClient(clientConfig);
    this.provider = provider ?? "bedrock";
    this.pricing = pricing;
  }

  /**
   * Build a `BedrockModel` bound to this SDK's client. Each call
   * returns a fresh instance; all instances share the underlying AWS
   * client so connection pools, credential refresh, and retry config
   * stay unified. The SDK's `provider` label is forwarded.
   *
   * Pricing resolution: per-model `config.pricing` wins; otherwise the
   * SDK-level registry entry keyed by `config.name`; otherwise
   * `undefined` (no cost computed).
   */
  public model(config: BedrockModelConfig): ModelContract {
    const resolvedPricing = config.pricing ?? this.pricing?.[config.name];
    const resolvedConfig: BedrockModelConfig =
      resolvedPricing === config.pricing ? config : { ...config, pricing: resolvedPricing };

    return new BedrockModel(this.client, resolvedConfig, this.provider);
  }

  /**
   * Rough token-count estimate. Uses the character-heuristic
   * (`approximateTokenCount`) from the core package — Bedrock has no
   * offline tokenizer and the per-model tokenizers differ; good enough
   * for budgeting and quota guards, not for billing.
   */
  public async count(text: string, _model?: string): Promise<number> {
    return approximateTokenCount(text);
  }

  /**
   * Build a `BedrockEmbedder` (Amazon Titan Text Embeddings) bound to
   * this SDK's client.
   *
   * @example
   * const embedder = bedrock.embedder({ name: "amazon.titan-embed-text-v2:0" });
   * const { vector } = await embedder.embed("Hello world");
   */
  public embedder(config: BedrockEmbedderConfig): EmbedderContract {
    return new BedrockEmbedder(this.client, config, this.provider);
  }
}
