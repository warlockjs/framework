import { InvalidRequestError, isProviderTool, type ModelCallOptions } from "@warlock.js/ai";
import type {
  EmbedderContract,
  ImageModelContract,
  ModelContract,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import type {
  XaiEmbedderConfig,
  XaiImageConfig,
  XaiModelConfig,
  XaiSDKConfig,
} from "./config.type";
import { inferReasoningCapability, inferVisionCapability } from "./known-models";

/**
 * The xAI OpenAI-compatible base URL. xAI exposes Chat Completions at
 * `POST /v1/chat/completions` on this host, so the whole adapter rides
 * on the OpenAI wire protocol.
 */
const XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * The default `provider` label stamped on every model this SDK
 * produces. Surfaces on `ModelContract.provider`, `AgentReport.model`,
 * logs, and any provider-aware middleware.
 */
const XAI_PROVIDER = "xai";

/**
 * xAI Grok-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for xAI's Grok models. xAI speaks
 * the OpenAI Chat Completions protocol, so `XaiSDK` is a *thin wrapper*
 * over the already-battle-tested {@link OpenAISDK} from
 * `@warlock.js/ai-openai` — NOT a reimplementation. It constructs one
 * internal `OpenAISDK` pointed at xAI's `baseURL` and labeled
 * `provider: "xai"`, then delegates `model()` / `embedder()` /
 * `image()` / `count()` to it. Construct one SDK per account and reuse
 * it everywhere.
 *
 * **Responsibility.**
 * - Owns: the xAI defaults (`baseURL` → `https://api.x.ai/v1`,
 *   `provider` → `"xai"`) and this provider's OWN capability inference.
 *   Grok model names (`grok-4`, `grok-2-vision`, …) don't match
 *   OpenAI's `gpt-*` / `o*` prefixes, so before delegating `model()`
 *   the wrapper injects the `vision` / `reasoning` flags inferred from
 *   xAI's name lists (see `known-models.ts`). Because explicit config
 *   wins over OpenAI's inference inside `OpenAIModel`, the produced
 *   `ModelContract` carries the correct Grok capabilities.
 * - Does NOT own: the wire protocol, request/response mapping,
 *   streaming, tool-call accumulation, error wrapping, or pricing
 *   resolution — all of that is the wrapped `OpenAISDK`'s job and is
 *   reused verbatim.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across many calls"): it holds one live `OpenAISDK` (which in turn
 * holds one live `OpenAI` client), fronted by FP usage like the other
 * adapters.
 *
 * @example
 * const xai = new XaiSDK({ apiKey: process.env.XAI_API_KEY! });
 * const model = xai.model({ name: "grok-4", temperature: 0.7 });
 * const myAgent = ai.agent({ model });
 *
 * @example
 * // Compose into an `ai.xai` namespace for ergonomic agent wiring.
 * const ai = { agent, tool, systemPrompt, xai: new XaiSDK({ apiKey }) };
 * const fast = ai.agent({ model: ai.xai.model({ name: "grok-3-mini" }) });
 */
export class XaiSDK implements SDKAdapterContract {
  /**
   * The wrapped OpenAI-compatible adapter doing the actual wire work.
   * Constructed once with xAI's `baseURL` + `provider` and the caller's
   * `apiKey` / client options, then reused for every produced model,
   * embedder, and image model.
   */
  private readonly openai: OpenAISDK;

  /**
   * Optional SDK-level pricing registry, kept so `model()` can resolve
   * a per-model entry while still applying this provider's default
   * capability inference. The wrapped `OpenAISDK` also resolves
   * pricing, but we surface it here for parity and to keep the default
   * baseURL/provider injection in one place.
   */
  private readonly pricing?: Record<string, ModelPricing>;

  public constructor(config: XaiSDKConfig) {
    const { baseURL, provider, ...rest } = config;

    // Inject xAI's defaults — `baseURL` → the xAI OpenAI-compatible
    // endpoint, `provider` → "xai" — while still letting the caller
    // override either (e.g. a corporate proxy or a relabeled gateway).
    this.openai = new OpenAISDK({
      ...rest,
      baseURL: baseURL ?? XAI_BASE_URL,
      provider: provider ?? XAI_PROVIDER,
    });

    this.pricing = config.pricing;
  }

  /**
   * Build a `ModelContract` for a Grok model. Delegates to the wrapped
   * `OpenAISDK.model()` after injecting this provider's OWN capability
   * inference: `vision` and `reasoning` are resolved from xAI's
   * name-prefix lists (see `known-models.ts`) unless the caller set them
   * explicitly. Because explicit config wins over OpenAI's inference
   * inside `OpenAIModel`, the returned model self-identifies as
   * `provider: "xai"` and carries Grok's real capabilities even though
   * the model name isn't an OpenAI name.
   *
   * Pricing resolution is left to the wrapped adapter: per-model
   * `config.pricing` wins, otherwise the SDK-level registry entry keyed
   * by `config.name`, otherwise `undefined` (no cost computed).
   *
   * @example
   * xai.model({ name: "grok-4" });        // vision + reasoning auto-true
   * xai.model({ name: "grok-3-mini" });   // reasoning auto-true, vision false
   */
  public model(config: XaiModelConfig): ModelContract {
    const model = this.openai.model({
      ...config,
      // xAI names don't match OpenAI's vision/reasoning prefixes, so we
      // resolve them here and pass explicit flags through — explicit
      // config always wins over the OpenAI adapter's own inference.
      vision: config.vision ?? inferVisionCapability(config.name),
      reasoning: config.reasoning ?? inferReasoningCapability(config.name),
    });
    // Preserve xAI transport constraints even when a gateway relabels the provider.
    // https://docs.x.ai/developers/tools/web-search — native search uses Responses.
    return {
      name: model.name,
      provider: model.provider,
      capabilities: model.capabilities,
      ...(model.pricing ? { pricing: model.pricing } : {}),
      async complete(messages, options) {
        rejectNativeSearch(model.provider, options);
        return model.complete(messages, options);
      },
      async *stream(messages, options) {
        rejectNativeSearch(model.provider, options);
        yield* model.stream(messages, options);
      },
      ...(model.countTokens ? { countTokens: model.countTokens.bind(model) } : {}),
    };
  }

  /**
   * Rough token-count estimate. Delegates straight to the wrapped
   * `OpenAISDK.count()` (the shared character-heuristic from the core
   * package — offline, good for budgeting/quota guards, not billing).
   */
  public async count(text: string, model?: string): Promise<number> {
    return this.openai.count(text, model);
  }

  /**
   * Build an `EmbedderContract` by delegating to the wrapped
   * `OpenAISDK.embedder()`.
   *
   * NOTE: xAI does not currently expose a public embeddings endpoint, so
   * this is wired for protocol parity but a call to `embed()` /
   * `embedMany()` will fail upstream. Point an embedder at a dedicated
   * embeddings provider (e.g. `@warlock.js/ai-openai`) for vectors.
   */
  public embedder(config: XaiEmbedderConfig): EmbedderContract {
    return this.openai.embedder(config);
  }

  /**
   * Build an `ImageModelContract` by delegating to the wrapped
   * `OpenAISDK.image()` for use with `ai.image({ model, prompt })`.
   * Pricing resolution mirrors `model()` (per-model `pricing` > SDK
   * registry > `undefined`).
   */
  public image(config: XaiImageConfig): ImageModelContract {
    return this.openai.image(config);
  }
}

/** A provider label does not change the underlying Chat Completions transport. */
function rejectNativeSearch(provider: string, options: ModelCallOptions | undefined): void {
  const entries = [
    ...(options?.providerTools ?? []),
    ...(options?.tools ?? []).filter(isProviderTool),
  ];
  if (
    entries.some(
      (entry) =>
        entry.provider === provider &&
        (entry.definition.type === "web_search" || entry.definition.type === "x_search"),
    )
  ) {
    throw new InvalidRequestError(
      "xAI native web_search / x_search requires POST /v1/responses. XaiSDK currently supports Chat Completions only; use xAI's Responses API with the vendor SDK for native search.",
    );
  }
}
