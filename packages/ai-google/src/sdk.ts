import { GoogleGenAI } from "@google/genai";
import type {
  EmbedderContract,
  ImageModelContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { approximateTokenCount } from "@warlock.js/ai";
import type {
  GoogleEmbedderConfig,
  GoogleImageConfig,
  GoogleModelConfig,
  GoogleSDKConfig,
} from "./config.type";
import { GoogleEmbedder } from "./embedder";
import { GoogleImageModel } from "./image";
import { GoogleModel } from "./model";

/**
 * Google Gemini-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for Gemini models via the
 * `@google/genai` SDK. A single `GoogleSDK` holds one live
 * `GoogleGenAI` client, shared by every `ModelContract` /
 * `EmbedderContract` it produces. Construct one SDK per
 * account/project and reuse it everywhere.
 *
 * **Responsibility.**
 * - Owns: a long-lived `GoogleGenAI` client (auth, Vertex vs Gemini
 *   API) and its lifetime. Factory for `GoogleModel` /
 *   `GoogleEmbedder` instances sharing that client.
 * - Does NOT own: anything per-call — those live in `GoogleModel` /
 *   `GoogleEmbedder` and the agent runtime.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across many calls"), fronted by FP usage like the other adapters.
 *
 * @example
 * const google = new GoogleSDK({ apiKey: process.env.GEMINI_API_KEY! });
 * const model = google.model({ name: "gemini-2.5-flash", temperature: 0.7 });
 * const embedder = google.embedder({ name: "gemini-embedding-001" });
 */
export class GoogleSDK implements SDKAdapterContract {
  private readonly ai: GoogleGenAI;
  private readonly provider: string;
  private readonly pricing?: Record<string, ModelPricing>;

  public constructor(config: GoogleSDKConfig) {
    const { provider, pricing, ...clientOptions } = config;

    this.ai = new GoogleGenAI(clientOptions);
    this.provider = provider ?? "google";
    this.pricing = pricing;
  }

  /**
   * Build a `GoogleModel` bound to this SDK's client. Each call
   * returns a fresh instance; all instances share the underlying
   * `GoogleGenAI` client. The SDK's `provider` label is forwarded.
   *
   * Pricing resolution: per-model `config.pricing` wins; otherwise the
   * SDK-level registry entry keyed by `config.name`; otherwise
   * `undefined` (no cost computed).
   */
  public model(config: GoogleModelConfig): ModelContract {
    const resolvedPricing = config.pricing ?? this.pricing?.[config.name];
    const resolvedConfig: GoogleModelConfig =
      resolvedPricing === config.pricing ? config : { ...config, pricing: resolvedPricing };

    return new GoogleModel(this.ai, resolvedConfig, this.provider);
  }

  /**
   * Rough token-count estimate. Uses the character-heuristic
   * (`approximateTokenCount`) from the core package — Gemini's
   * `countTokens` is a network round-trip; `count()` is intentionally
   * offline. Good for budgeting/quota guards, not billing.
   */
  public async count(text: string, _model?: string): Promise<number> {
    return approximateTokenCount(text);
  }

  /**
   * Build a `GoogleEmbedder` bound to this SDK's client.
   *
   * @example
   * const embedder = google.embedder({ name: "gemini-embedding-001" });
   * const { vector } = await embedder.embed("Hello world");
   */
  public embedder(config: GoogleEmbedderConfig): EmbedderContract {
    return new GoogleEmbedder(this.ai, config, this.provider);
  }

  /**
   * Build a `GoogleImageModel` (Imagen) bound to this SDK's client for
   * use with `ai.image({ model, prompt })`. Accepts the `imagen-*`
   * family; a non-Imagen model id is rejected at construction.
   *
   * Pricing resolution mirrors `model()`: per-model `config.pricing`
   * wins, otherwise the SDK-level registry entry keyed by `config.name`,
   * otherwise `undefined`. Imagen is per-image-metered, so the registry
   * entry typically carries `{ perImage }`.
   *
   * @example
   * const model = google.image({ name: "imagen-4.0-generate-001" });
   * const { data } = await ai.image({ model, prompt: "a watercolor lighthouse" });
   */
  public image(config: GoogleImageConfig): ImageModelContract {
    const resolvedPricing = config.pricing ?? this.pricing?.[config.name];
    const resolvedConfig: GoogleImageConfig =
      resolvedPricing === config.pricing ? config : { ...config, pricing: resolvedPricing };

    return new GoogleImageModel(this.ai, resolvedConfig, this.provider);
  }
}
