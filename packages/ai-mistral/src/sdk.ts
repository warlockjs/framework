import type {
  EmbedderConfig,
  EmbedderContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import type { MistralModelConfig, MistralSDKConfig } from "./config.type";
import {
  inferReasoningCapability,
  inferVisionCapability,
  MISTRAL_DEFAULT_PRICING,
} from "./known-models";

/** Default OpenAI-compatible base URL for the Mistral API. */
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

/** Default provider label stamped onto every model this SDK produces. */
const MISTRAL_PROVIDER = "mistral";

/**
 * Mistral-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for Mistral AI chat + embeddings.
 * Mistral exposes an **OpenAI-compatible** API (`/v1/chat/completions`,
 * `/v1/embeddings`), so `MistralSDK` is a *thin wrapper* over the
 * battle-tested {@link OpenAISDK} — it does NOT re-implement the wire
 * protocol, streaming loop, tool-call accumulation, structured-output
 * mapping, error wrapping, or token accounting. It constructs one
 * internal `OpenAISDK` pointed at Mistral's `baseURL` with
 * `provider: "mistral"`, and delegates `model()` / `embedder()` /
 * `count()` straight to it.
 *
 * **What this wrapper adds on top of the OpenAI adapter:**
 * - **Defaults.** Injects Mistral's `baseURL` + `provider` label and a
 *   default {@link MISTRAL_DEFAULT_PRICING} registry so cost truth works
 *   out of the box. All are overridable via config.
 * - **Provider-correct capability inference.** Mistral's model names
 *   aren't OpenAI names, so the OpenAI prefix lists never match. Before
 *   delegating `model()`, this wrapper infers `vision` (the `pixtral`
 *   family + recent multimodal generations) and `reasoning` (the
 *   `magistral` family + hybrid `mistral-small`) from *this provider's*
 *   fragment lists and passes them as explicit overrides — which the
 *   inner `OpenAISDK` honors verbatim. A caller-supplied explicit
 *   `vision` / `reasoning` still wins.
 *
 * Construct one SDK per account and reuse it everywhere; the single
 * underlying `OpenAI` client (connection pool, auth, rate-limit state)
 * is shared by every model / embedder produced here.
 *
 * **Note — no image generation.** Mistral has no OpenAI-compatible image
 * endpoint, so `image()` is intentionally NOT exposed. The structural
 * absence of the method IS the capability guard (see
 * `SDKAdapterContract.image`): `ai.mistral.image(...)` is a compile-time
 * error rather than a runtime failure.
 *
 * @example
 * const mistral = new MistralSDK({ apiKey: process.env.MISTRAL_API_KEY! });
 * const model = mistral.model({ name: "mistral-large-latest", temperature: 0.7 });
 * const embedder = mistral.embedder({ name: "mistral-embed" });
 *
 * @example
 * // Compose into an `ai.mistral` namespace for ergonomic agent wiring.
 * const ai = { agent, tool, systemPrompt, mistral: new MistralSDK({ apiKey }) };
 * const reasoner = ai.agent({ model: ai.mistral.model({ name: "magistral-medium-latest" }) });
 */
export class MistralSDK implements SDKAdapterContract {
  /**
   * The wrapped OpenAI-compatible adapter doing all the real work. Built
   * once in the constructor with Mistral's `baseURL`, `provider` label,
   * and merged pricing registry; every public method delegates to it.
   */
  private readonly openai: OpenAISDK;

  public constructor(config: MistralSDKConfig) {
    const { provider, baseURL, pricing, ...clientOptions } = config;

    // Caller pricing wins per model id; otherwise fall back to this
    // provider's published-list defaults so cost truth works out of the box.
    const mergedPricing: Record<string, ModelPricing> = {
      ...MISTRAL_DEFAULT_PRICING,
      ...pricing,
    };

    this.openai = new OpenAISDK({
      ...clientOptions,
      baseURL: baseURL ?? MISTRAL_BASE_URL,
      provider: provider ?? MISTRAL_PROVIDER,
      pricing: mergedPricing,
    });
  }

  /**
   * Build a `ModelContract` for a Mistral chat model.
   *
   * Delegates to the inner `OpenAISDK.model()` but first injects
   * **Mistral-aware capability inference**: when the caller omits
   * `vision` / `reasoning`, they're inferred from this provider's family
   * fragments (`pixtral` → vision, `magistral` / `mistral-small` →
   * reasoning, see `known-models.ts`) and passed down as explicit
   * overrides. Without this step the wrapped OpenAI adapter would check
   * Mistral ids against OpenAI prefixes (`gpt-4o`, `o3`, …) and wrongly
   * report every Mistral model as non-vision / non-reasoning.
   *
   * A caller-supplied explicit `vision` / `reasoning` is preserved as-is
   * (explicit config always wins over inference). Pricing resolution is
   * handled downstream by `OpenAISDK` against the merged registry:
   * per-model `pricing` > SDK registry (caller + Mistral defaults) >
   * `undefined`.
   */
  public model(config: MistralModelConfig): ModelContract {
    const resolvedConfig: MistralModelConfig = {
      ...config,
      vision: config.vision ?? inferVisionCapability(config.name),
      reasoning: config.reasoning ?? inferReasoningCapability(config.name),
    };

    return this.openai.model(resolvedConfig);
  }

  /**
   * Rough offline token-count estimate. Delegates to the wrapped
   * `OpenAISDK.count()` (the shared character-heuristic from the core
   * package) — good for budgeting / quota guards, not billing. The
   * optional model id is forwarded but currently ignored.
   */
  public async count(text: string, model?: string): Promise<number> {
    return this.openai.count(text, model);
  }

  /**
   * Build an `EmbedderContract` bound to this SDK's client. Mistral
   * serves embeddings (`mistral-embed`) through the OpenAI-compatible
   * `/v1/embeddings` endpoint, so this delegates straight to
   * `OpenAISDK.embedder()`.
   *
   * @example
   * const embedder = mistral.embedder({ name: "mistral-embed" });
   * const { vector } = await embedder.embed("Hello world");
   */
  public embedder(config: EmbedderConfig): EmbedderContract {
    // `embedder` is optional on the contract but always present on the
    // wrapped OpenAI adapter — assert it for the delegation.
    return this.openai.embedder!(config);
  }
}
