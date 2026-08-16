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
import { GeminiImageModel } from "./gemini-image";
import { GoogleImageModel } from "./image";
import { GoogleModel } from "./model";

/**
 * Pick the transport for an image model id.
 *
 * `ai.models.generateImages` calls `{model}:predict`, and a `gemini-`
 * id sent there comes back `404 … is not supported for predict`
 * (observed verbatim from Google). `generateContent` is what the SDK
 * itself points `generateImages` users at — its deprecation notice
 * reads "Please use the generateContent method with image models
 * instead" — so the id has to choose the transport.
 *
 * Runs in this package establish where a `gemini-` id is ACCEPTED, not
 * what it returns: on this transport such an id got as far as a quota
 * error (HTTP 429) instead of the 404. That an image
 * comes back end-to-end once billing is enabled is reported by the
 * maintainer from a locally linked build, not measured here. Whether
 * these models report token usage is still unknown.
 *
 * This is ROUTING, not validation — no id is refused here. An id this
 * function does not recognize takes the `generateImages` route, the
 * only route that existed before Gemini image support landed, so every
 * id that reached Google before still reaches Google the same way and
 * still fails (or succeeds) at the provider.
 *
 * A leading `models/` resource prefix is tolerated, matching the id
 * shapes `inferVisionCapability` already accepts
 * (`models/gemini-1.5-flash-001`).
 */
function usesGeminiImageTransport(name: string): boolean {
  return name.toLowerCase().replace(/^models\//, "").startsWith("gemini-");
}

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
   * Build an image model bound to this SDK's client for use with
   * `ai.image({ model, prompt })`. `config.name` decides the transport
   * (see {@link usesGeminiImageTransport}) — a `gemini-` id gets the
   * `generateContent` implementation, everything else the Imagen
   * `generateImages` one. No id is rejected locally either way, so an
   * unsupported model fails at Google, not here.
   *
   * The two differ in what usage they can report, which is what the
   * caller must price for: the Imagen path always returns a zero token
   * `Usage` (Imagen reports none — price with `{ perImage }`), while the
   * Gemini path passes through whatever `usageMetadata` Google attaches
   * (price with `{ input, output }` when tokens come back).
   *
   * Pricing resolution mirrors `model()`: per-model `config.pricing`
   * wins, otherwise the SDK-level registry entry keyed by `config.name`,
   * otherwise `undefined`.
   *
   * @example
   * const imagen = google.image({ name: "imagen-4.0-generate-001" });
   * const gemini = google.image({ name: "gemini-3.1-flash-lite-image" });
   * const { data } = await ai.image({ model: gemini, prompt: "a red bicycle" });
   */
  public image(config: GoogleImageConfig): ImageModelContract {
    const resolvedPricing = config.pricing ?? this.pricing?.[config.name];
    const resolvedConfig: GoogleImageConfig =
      resolvedPricing === config.pricing ? config : { ...config, pricing: resolvedPricing };

    if (usesGeminiImageTransport(config.name)) {
      return new GeminiImageModel(this.ai, resolvedConfig, this.provider);
    }

    return new GoogleImageModel(this.ai, resolvedConfig, this.provider);
  }
}
