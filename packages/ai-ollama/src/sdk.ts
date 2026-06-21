import { Ollama } from "ollama";
import type {
  EmbedderContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { approximateTokenCount } from "@warlock.js/ai";
import type {
  OllamaEmbedderConfig,
  OllamaModelConfig,
  OllamaSDKConfig,
} from "./config.type";
import { OllamaEmbedder } from "./embedder";
import { OllamaModel } from "./model";

/**
 * Ollama-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for local / self-hosted models
 * served by an Ollama daemon via the official `ollama` client. One
 * `OllamaSDK` holds one live `Ollama` client, shared by every
 * `ModelContract` / `EmbedderContract` it produces.
 *
 * **Responsibility.**
 * - Owns: a long-lived `Ollama` client (host, headers) and its
 *   lifetime. Factory for `OllamaModel` / `OllamaEmbedder` instances
 *   sharing that client.
 * - Does NOT own: anything per-call — those live in `OllamaModel` /
 *   `OllamaEmbedder` and the agent runtime.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across many calls"), fronted by FP usage like the other adapters.
 *
 * @example
 * const ollama = new OllamaSDK({});                  // local default host
 * const model = ollama.model({ name: "llama3.1", temperature: 0.7 });
 * const embedder = ollama.embedder({ name: "nomic-embed-text" });
 */
export class OllamaSDK implements SDKAdapterContract {
  private readonly client: Ollama;
  private readonly provider: string;
  private readonly pricing?: Record<string, ModelPricing>;

  public constructor(config: OllamaSDKConfig = {}) {
    const { provider, pricing, ...clientConfig } = config;

    this.client = new Ollama(clientConfig);
    this.provider = provider ?? "ollama";
    this.pricing = pricing;
  }

  /**
   * Build an `OllamaModel` bound to this SDK's client. Each call
   * returns a fresh instance; all instances share the underlying
   * `Ollama` client. The SDK's `provider` label is forwarded.
   *
   * Pricing resolution: per-model `config.pricing` wins; otherwise the
   * SDK-level registry entry keyed by `config.name`; otherwise
   * `undefined` (local Ollama is free, so usually undefined).
   */
  public model(config: OllamaModelConfig): ModelContract {
    const resolvedPricing = config.pricing ?? this.pricing?.[config.name];
    const resolvedConfig: OllamaModelConfig =
      resolvedPricing === config.pricing ? config : { ...config, pricing: resolvedPricing };

    return new OllamaModel(this.client, resolvedConfig, this.provider);
  }

  /**
   * Rough token-count estimate. Uses the character-heuristic
   * (`approximateTokenCount`) from the core package — good enough for
   * budgeting / context guards, not billing (and Ollama is free
   * anyway). The optional model id is reserved for future per-model
   * tokenizer dispatch; currently ignored.
   */
  public async count(text: string, _model?: string): Promise<number> {
    return approximateTokenCount(text);
  }

  /**
   * Build an `OllamaEmbedder` bound to this SDK's client.
   *
   * @example
   * const embedder = ollama.embedder({ name: "nomic-embed-text" });
   * const { vector } = await embedder.embed("Hello world");
   */
  public embedder(config: OllamaEmbedderConfig): EmbedderContract {
    return new OllamaEmbedder(this.client, config, this.provider);
  }
}
