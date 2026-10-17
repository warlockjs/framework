import type {
  EmbedderContract,
  ImageModelContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import type {
  DeepSeekEmbedderConfig,
  DeepSeekImageConfig,
  DeepSeekModelConfig,
  DeepSeekSDKConfig,
} from "./config.type";
import { inferReasoningCapability, inferVisionCapability } from "./known-models";

/**
 * DeepSeek's OpenAI-compatible Chat Completions endpoint. Verified against
 * the official API docs (api-docs.deepseek.com, mid-2026).
 */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** Default upstream label for models produced by this SDK. */
const DEEPSEEK_PROVIDER = "deepseek";

/**
 * Built-in DeepSeek pricing defaults, in USD per 1,000,000 tokens, keyed
 * by model name; `cachedInput` is the cache-hit input rate.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing, fetched
 * 2026-10-17. DeepSeek bills by time of day: peak hours (01:00–04:00 and
 * 06:00–10:00 UTC, Monday to Friday) cost twice the off-peak rate. A flat
 * `ModelPricing` cannot follow the clock, so these are the **peak** rates —
 * an upper bound that keeps USD budgets safe; off-peak calls really cost
 * half. Pass {@link DEEPSEEK_OFF_PEAK_PRICING} (or your own) as `pricing`
 * when you know you run off-peak.
 *
 * `deepseek-v4-flash` is the legacy name of `deepseek-flash` and bills at
 * the same rate. `deepseek-chat` / `deepseek-reasoner` are gone from the
 * price list (discontinued 2026-07-24) and stay unpriced.
 *
 * A caller-supplied SDK `pricing` registry, or a per-model `pricing`,
 * overrides any entry here.
 */
export const DEEPSEEK_DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  "deepseek-flash": { input: 0.3, output: 1.2, cachedInput: 0.006 },
  "deepseek-v4-flash": { input: 0.3, output: 1.2, cachedInput: 0.006 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96, cachedInput: 0.044 },
};

/**
 * DeepSeek's off-peak rates (half the peak {@link DEEPSEEK_DEFAULT_PRICING}),
 * same source and date. Opt in per SDK:
 *
 * @example
 * new DeepSeekSDK({ apiKey, pricing: DEEPSEEK_OFF_PEAK_PRICING });
 */
export const DEEPSEEK_OFF_PEAK_PRICING: Readonly<Record<string, ModelPricing>> = {
  "deepseek-flash": { input: 0.15, output: 0.6, cachedInput: 0.003 },
  "deepseek-v4-flash": { input: 0.15, output: 0.6, cachedInput: 0.003 },
  "deepseek-v4-pro": { input: 0.66, output: 1.98, cachedInput: 0.022 },
};

/**
 * DeepSeek-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for DeepSeek models. DeepSeek's API is
 * OpenAI-compatible on the wire, so rather than reimplementing the
 * battle-tested Chat Completions translation, this is a **thin wrapper**
 * over {@link OpenAISDK} from `@warlock.js/ai-openai`: it constructs one
 * internal `OpenAISDK` pinned to DeepSeek's `baseURL` and the `"deepseek"`
 * provider label, and delegates `model()` / `embedder()` / `image()` /
 * `count()` straight to it. Construct one `DeepSeekSDK` per account and
 * reuse it everywhere.
 *
 * **What the wrapper adds over a bare `OpenAISDK`.** DeepSeek's model
 * **names** are not OpenAI names, so OpenAI's own vision/reasoning prefix
 * lists never match them. This wrapper injects DeepSeek's OWN capability
 * inference (see `known-models.ts`) and built-in DeepSeek pricing defaults
 * as explicit values on every `model()` call — so `deepseek-reasoner` is
 * correctly flagged reasoning-capable and `deepseek-chat` is not, even
 * though neither matches an OpenAI prefix. An explicit `vision` /
 * `reasoning` / `pricing` you pass per model always wins over these
 * injected defaults.
 *
 * **Responsibility.**
 * - Owns: one long-lived internal `OpenAISDK` (auth, DeepSeek base URL)
 *   and DeepSeek's capability + pricing defaults.
 * - Does NOT own: the wire protocol, streaming loop, message/tool
 *   translation, or error wrapping — all inherited unchanged from
 *   `OpenAISDK` / `OpenAIModel`.
 *
 * @example
 * const deepseek = new DeepSeekSDK({ apiKey: process.env.DEEPSEEK_API_KEY! });
 * const chat = deepseek.model({ name: "deepseek-chat" });        // reasoning=false
 * const reasoner = deepseek.model({ name: "deepseek-reasoner" }); // reasoning=true
 *
 * @example
 * // Compose into an `ai.deepseek` namespace for ergonomic agent wiring
 * const ai = { agent, tool, deepseek: new DeepSeekSDK({ apiKey }) };
 * const myAgent = ai.agent({ model: ai.deepseek.model({ name: "deepseek-reasoner" }) });
 */
export class DeepSeekSDK implements SDKAdapterContract {
  /** The wrapped OpenAI-compatible client, pinned to DeepSeek. */
  private readonly openai: OpenAISDK;
  private readonly provider: string;
  private readonly pricing: Record<string, ModelPricing>;

  public constructor(config: DeepSeekSDKConfig) {
    const { provider, pricing, baseURL, ...clientOptions } = config;

    this.provider = provider ?? DEEPSEEK_PROVIDER;
    // Caller pricing overrides the built-in DeepSeek defaults entry-by-entry.
    this.pricing = { ...DEEPSEEK_DEFAULT_PRICING, ...pricing };

    // The internal OpenAISDK carries the DeepSeek base URL + provider label;
    // pricing stays on THIS wrapper so it can be merged with the built-in
    // defaults before each per-model resolution below.
    this.openai = new OpenAISDK({
      ...clientOptions,
      baseURL: baseURL ?? DEEPSEEK_BASE_URL,
      provider: this.provider,
    });
  }

  /**
   * Build a `ModelContract` for a DeepSeek model. Delegates to the wrapped
   * `OpenAISDK.model()`, but first injects this provider's defaults:
   * - `vision` / `reasoning` inferred from DeepSeek's model-name lists
   *   (`known-models.ts`) — so the right capabilities are set even though
   *   the names aren't OpenAI names.
   * - `pricing` resolved from the built-in DeepSeek table merged with any
   *   caller-supplied SDK registry.
   *
   * An explicit `vision` / `reasoning` / `pricing` on `config` always wins
   * over the injected default. Everything else (sampling, structured
   * output, streaming, error wrapping) is inherited unchanged from
   * `OpenAIModel`.
   */
  public model(config: DeepSeekModelConfig): ModelContract {
    const resolved: DeepSeekModelConfig = {
      ...config,
      vision: config.vision ?? inferVisionCapability(config.name),
      reasoning: config.reasoning ?? inferReasoningCapability(config.name),
      pricing: config.pricing ?? this.pricing[config.name],
    };

    return this.openai.model(resolved);
  }

  /**
   * Rough offline token-count estimate. Delegated to the wrapped
   * `OpenAISDK.count()` (the core character-heuristic) — good for
   * budgeting/quota guards, not billing.
   */
  public async count(text: string, model?: string): Promise<number> {
    return this.openai.count(text, model);
  }

  /**
   * Build an `EmbedderContract`. Delegated verbatim to
   * `OpenAISDK.embedder()`.
   *
   * NOTE: DeepSeek does not officially document an OpenAI-compatible
   * embeddings endpoint (mid-2026); this delegate works against a
   * compatible gateway you point `baseURL` at, but may fail against the
   * stock DeepSeek endpoint. Prefer a dedicated embeddings provider for
   * RAG.
   */
  public embedder(config: DeepSeekEmbedderConfig): EmbedderContract {
    return this.openai.embedder(config);
  }

  /**
   * Build an `ImageModelContract`. Delegated verbatim to
   * `OpenAISDK.image()`.
   *
   * NOTE: DeepSeek does not document an image-generation endpoint
   * (mid-2026); provided for adapter parity. A non-image model id is
   * rejected at construction by the wrapped OpenAI image model.
   */
  public image(config: DeepSeekImageConfig): ImageModelContract {
    return this.openai.image(config);
  }
}
