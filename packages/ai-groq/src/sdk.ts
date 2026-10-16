import type {
  EmbedderContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import type { GroqEmbedderConfig, GroqModelConfig, GroqSDKConfig } from "./config.type";
import {
  GROQ_BASE_URL,
  GROQ_PROVIDER,
  inferReasoningCapability,
  inferVisionCapability,
} from "./known-models";

/**
 * Groq-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for Groq-hosted open models
 * (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`,
 * `openai/gpt-oss-*`, `deepseek-r1-distill-*`, …) served on Groq's fast
 * LPU hardware. Because Groq exposes the OpenAI Chat Completions wire
 * protocol verbatim, `GroqSDK` is a **thin wrapper over the already
 * battle-tested {@link OpenAISDK}** rather than a fresh transport
 * implementation — it owns one internal `OpenAISDK` pointed at Groq's
 * `baseURL` with the `"groq"` provider label, and delegates `model()` /
 * `embedder()` / `count()` to it.
 *
 * **Why a wrapper and not `OpenAISDK` directly?** Groq hosts *open*
 * models whose ids are the upstream open-weight names (`llama-…`,
 * `openai/gpt-oss-…`), not OpenAI's (`gpt-4o`, `o3`). The OpenAI
 * adapter's capability inference keys on OpenAI prefixes and would never
 * fire here, so every Groq model would come back with `vision`/
 * `reasoning` silently `false`. `GroqSDK` fixes that by computing
 * **this provider's own** vision/reasoning inference (see
 * `known-models.ts`) and injecting the result as explicit capability
 * config — which wins over the inner adapter's inference — plus a set of
 * default per-model pricing rates. Everything else (transport, retries,
 * streaming, structured output, error wrapping, usage accounting) is
 * inherited unchanged from `OpenAISDK`.
 *
 * **Responsibility.**
 * - Owns: one long-lived internal `OpenAISDK` (auth + Groq base URL) and
 *   this provider's capability + default-pricing inference.
 * - Does NOT own: the wire protocol, streaming loop, structured-output
 *   mapping, or error wrapping — all inherited from `OpenAISDK`.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across many calls"), fronted by FP usage like the other adapters.
 *
 * @example
 * const groq = new GroqSDK({ apiKey: process.env.GROQ_API_KEY! });
 * const model = groq.model({ name: "llama-3.3-70b-versatile", temperature: 0.7 });
 * const reasoner = groq.model({ name: "openai/gpt-oss-120b" }); // vision + reasoning auto-true
 *
 * @example
 * // Compose into an `ai.groq` namespace for ergonomic agent wiring
 * const ai = { agent, tool, systemPrompt, groq: new GroqSDK({ apiKey }) };
 * const myAgent = ai.agent({ model: ai.groq.model({ name: "llama-3.1-8b-instant" }) });
 */
export class GroqSDK implements SDKAdapterContract {
  /**
   * The wrapped OpenAI-compatible adapter, pre-pointed at Groq's
   * `baseURL` and labeled with the `"groq"` provider. All real wire work
   * happens here; `GroqSDK` only enriches the per-model config before
   * delegating.
   */
  private readonly openai: OpenAISDK;
  private readonly provider: string;
  private readonly pricing?: Record<string, ModelPricing>;

  public constructor(config: GroqSDKConfig) {
    const { baseURL, provider, pricing, ...clientOptions } = config;

    this.provider = provider ?? GROQ_PROVIDER;
    this.pricing = pricing;

    // Build the inner OpenAI-compatible client pointed at Groq. Forward
    // every other upstream ClientOptions (timeout, maxRetries,
    // defaultHeaders, fetch, …) verbatim — they type-check, so dropping
    // them would be a silent footgun. We pass `pricing` through too so
    // the inner registry stays a fallback, while THIS class's `model()`
    // layers Groq default rates on top.
    this.openai = new OpenAISDK({
      ...clientOptions,
      baseURL: baseURL ?? GROQ_BASE_URL,
      provider: this.provider,
      pricing,
    });
  }

  /**
   * Build a `ModelContract` bound to the internal Groq-pointed client.
   *
   * The wrapper's whole job lives here: it computes **Groq's** vision /
   * reasoning inference from the model id and forwards the result as
   * *explicit* `vision` / `reasoning` config to the inner
   * `OpenAISDK.model()`. Because explicit capability config wins over the
   * inner adapter's OpenAI-prefix inference, the returned model reports
   * the right capabilities even though the id isn't an OpenAI name. A
   * caller-supplied `vision` / `reasoning` still wins over this
   * inference (we only fill the gap when the field is omitted).
   *
   * Pricing resolution: per-model `config.pricing` wins; otherwise this
   * SDK's `pricing` registry keyed by `config.name`; otherwise the
   * adapter's built-in default rate for the model; otherwise `undefined`
   * (no cost computed).
   */
  public model(config: GroqModelConfig): ModelContract {
    const resolvedPricing =
      config.pricing ?? this.pricing?.[config.name] ?? defaultPricingFor(config.name);

    return this.openai.model({
      ...config,
      // Fill capability inference only when the caller didn't pin it —
      // explicit caller config always wins, then Groq inference, then
      // (inside OpenAISDK) the harmless OpenAI inference that won't match.
      vision: config.vision ?? inferVisionCapability(config.name),
      reasoning: config.reasoning ?? inferReasoningCapability(config.name),
      structuredOutput: config.structuredOutput ?? true,
      pricing: resolvedPricing,
    });
  }

  /**
   * Rough offline token-count estimate. Delegated straight to the inner
   * `OpenAISDK`, which uses the core character-heuristic
   * (`approximateTokenCount`). Good for budgeting / quota guards, not for
   * billing.
   */
  public async count(text: string, model?: string): Promise<number> {
    return this.openai.count(text, model);
  }

  /**
   * Build an embedder bound to the internal client. Delegated to the
   * inner `OpenAISDK`.
   *
   * IMPORTANT: as of mid-2026 Groq does **not** expose an
   * OpenAI-compatible embeddings endpoint, so a live `.embed()` /
   * `.embedMany()` call will fail at the provider. The method is kept for
   * adapter symmetry; use `@warlock.js/ai-openai` or
   * `@warlock.js/ai-google` for retrieval embeddings.
   */
  public embedder(config: GroqEmbedderConfig): EmbedderContract {
    return this.openai.embedder(config);
  }

  // NOTE: `image()` is intentionally NOT implemented. Groq hosts no
  // image-generation API, and `SDKAdapterContract.image` is optional —
  // its structural absence IS the capability guard, so
  // `ai.groq.image(...)` is a compile-time error rather than a runtime
  // surprise (mirrors Anthropic / Bedrock / Ollama).
}

/**
 * Built-in default USD-per-1,000,000-token rates for the current Groq
 * production models (mid-2026), used as the last fallback in `model()`'s
 * pricing resolution. A per-model or SDK-level `pricing` entry always
 * wins over these. Returns `undefined` for any unlisted id so cost stays
 * an honest absence rather than a false zero. Update when Groq revises
 * its public price list.
 */
function defaultPricingFor(name: string): ModelPricing | undefined {
  return GROQ_DEFAULT_PRICING[name];
}

/**
 * Default per-million-token USD rates for known Groq models. Kept inline
 * (not exported) so the public surface stays the inference helpers; a
 * caller who wants different numbers supplies `pricing` on the SDK or
 * per model.
 */
const GROQ_DEFAULT_PRICING: Record<string, ModelPricing> = {
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.75 },
  "openai/gpt-oss-20b": { input: 0.1, output: 0.5 },
  "deepseek-r1-distill-llama-70b": { input: 0.75, output: 0.99 },
};
