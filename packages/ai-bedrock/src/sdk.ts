import {
  BedrockClient,
  ListFoundationModelsCommand,
  type ListFoundationModelsCommandOutput,
} from "@aws-sdk/client-bedrock";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type {
  ListModelsOptions,
  ModelInfo,
  ModelKind,
  EmbedderContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { approximateTokenCount, InvalidRequestError } from "@warlock.js/ai";
import type { BedrockEmbedderConfig, BedrockModelConfig, BedrockSDKConfig } from "./config.type";
import { BedrockEmbedder } from "./embedder";
import { BedrockModel } from "./model";
import { wrapBedrockError } from "./utils";

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
 *
 * @example
 * // Amazon Bedrock API key (bearer auth) instead of the AWS credential chain
 * const bedrock = new BedrockSDK({ apiKey: process.env.BEDROCK_API_KEY!, region: "us-east-1" });
 */
export class BedrockSDK implements SDKAdapterContract {
  private readonly client: BedrockRuntimeClient;
  /** Control-plane client for `ListFoundationModels`; built on first use from the same config. */
  private readonly controlConfig: ConstructorParameters<typeof BedrockClient>[0];
  private controlClient?: BedrockClient;
  private readonly provider: string;
  private readonly pricing?: Record<string, ModelPricing>;

  public constructor(config: BedrockSDKConfig) {
    const { provider, pricing, apiKey, ...clientConfig } = config;

    const resolvedConfig = apiKey === undefined ? clientConfig : withApiKey(clientConfig, apiKey);
    this.client = new BedrockRuntimeClient(resolvedConfig);
    this.controlConfig = resolvedConfig as ConstructorParameters<typeof BedrockClient>[0];
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

  /**
   * List the foundation models Bedrock offers in this SDK's region, live from
   * `ListFoundationModels`, mapped to {@link ModelInfo}. Uses the same
   * credentials, region and API key as the runtime client (a separate
   * `BedrockClient` is created on first use; the API needs the
   * `bedrock:ListFoundationModels` permission). Models whose lifecycle status
   * is `LEGACY` are left out. `kind` follows the model's output modalities
   * (`TEXT` chat, `EMBEDDING`, `IMAGE`). The listing carries no release date
   * or token limits, so those fields are absent. The ids are foundation-model
   * ids; some models can only be invoked through a cross-region inference
   * profile id (for example `us.` + id), which this listing does not return.
   * Failures are thrown as the adapter's usual provider errors.
   *
   * @example
   * const models = await bedrock.models();
   * const chat = models.filter((model) => model.kind === "chat");
   */
  public async models(options?: ListModelsOptions): Promise<ModelInfo[]> {
    this.controlClient ??= new BedrockClient(this.controlConfig);

    let response: ListFoundationModelsCommandOutput;

    try {
      response = await this.controlClient.send(
        new ListFoundationModelsCommand({}),
        options?.signal ? { abortSignal: options.signal } : undefined,
      );
    } catch (thrown) {
      throw wrapBedrockError(thrown);
    }

    const found = new Map<string, ModelInfo>();

    for (const summary of response.modelSummaries ?? []) {
      const id = summary.modelId;

      if (!id || summary.modelLifecycle?.status === "LEGACY") {
        continue;
      }

      const outputs = summary.outputModalities ?? [];
      const kind: ModelKind = outputs.includes("EMBEDDING")
        ? "embedding"
        : outputs.includes("IMAGE")
          ? "image"
          : outputs.includes("TEXT")
            ? "chat"
            : "other";

      found.set(id, {
        id,
        label: summary.providerName
          ? `${summary.providerName} ${summary.modelName ?? id}`
          : (summary.modelName ?? id),
        provider: this.provider,
        kind,
      });
    }

    return [...found.values()];
  }
}

/**
 * Configure the runtime client for an Amazon Bedrock API key.
 *
 * Bedrock API keys are bearer tokens: the request carries
 * `Authorization: Bearer <key>` instead of a SigV4 signature (AWS docs,
 * "Use an Amazon Bedrock API key",
 * https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html,
 * checked 2026-10-17). The installed `@aws-sdk/client-bedrock-runtime`
 * supports this natively: its auth scheme provider offers
 * `smithy.api#httpBearerAuth` beside SigV4, fed by the client's `token`
 * option, and `authSchemePreference: ["httpBearerAuth"]` selects it ahead
 * of SigV4, so the AWS credential chain is never consulted.
 *
 * Fails closed on an empty key, and on a key combined with `credentials`
 * or `token` — two credentials for one client leave which one signs the
 * request ambiguous.
 */
function withApiKey(
  clientConfig: Omit<BedrockSDKConfig, "provider" | "pricing" | "apiKey">,
  apiKey: string,
): Omit<BedrockSDKConfig, "provider" | "pricing" | "apiKey"> {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new InvalidRequestError("BedrockSDK: `apiKey` must be a non-empty string.");
  }

  const conflicting = (["credentials", "token"] as const).filter(
    (field) => clientConfig[field] !== undefined,
  );

  if (conflicting.length > 0) {
    throw new InvalidRequestError(
      `BedrockSDK: pass either \`apiKey\` or ${conflicting.map((field) => `\`${field}\``).join(" / ")}, not both.`,
      { context: { fields: conflicting } },
    );
  }

  return {
    ...clientConfig,
    token: { token: apiKey },
    authSchemePreference: ["httpBearerAuth"],
  };
}
