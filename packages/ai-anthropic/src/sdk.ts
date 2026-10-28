import Anthropic from "@anthropic-ai/sdk";
import type {
  ListModelsOptions,
  ModelInfo,
  ModelPricing,
  SDKAdapterContract,
} from "@warlock.js/ai";
import { approximateTokenCount } from "@warlock.js/ai";
import type { AnthropicModelConfig, AnthropicSDKConfig } from "./config.type";
import { AnthropicModel } from "./model";
import { wrapAnthropicError } from "./utils";

/**
 * Anthropic-backed implementation of `SDKAdapterContract`.
 *
 * **Role.** The package entry point for Claude models via the official
 * `@anthropic-ai/sdk`. A single `AnthropicSDK` instance holds one live
 * `Anthropic` client, shared by every `ModelContract` it produces via
 * `model()`. Users construct one SDK per account and reuse it across
 * all agents, workflows, and supervisors that target Anthropic.
 *
 * **Responsibility.**
 * - Owns: a long-lived `Anthropic` client (authentication, base URL)
 *   and its lifetime scope. Factory for `AnthropicModel` instances —
 *   each model call gets a reference to the same client.
 * - Does NOT own: anything per-call (tool execution, message history,
 *   streaming loop) — those live in `AnthropicModel` and the agent
 *   runtime. Does NOT implement `embedder()`: Anthropic ships no
 *   first-party embeddings API (the contract marks it optional).
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across many calls"): the `Anthropic` client is heavy to construct
 * and designed to be reused; keeping it on `this` makes that reuse
 * explicit and aligns with the `new Anthropic(...)` upstream
 * convention.
 *
 * @example
 * const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });
 * const model = anthropic.model({ name: "claude-sonnet-4-6", temperature: 0.7 });
 * const tokens = await anthropic.count("Hello world");
 *
 * @example
 * // Compose into an `ai.anthropic` namespace for ergonomic agent wiring
 * const ai = { agent, tool, systemPrompt, anthropic: new AnthropicSDK({ apiKey }) };
 * const myAgent = ai.agent({ model: ai.anthropic.model({ name: "claude-haiku-4-5" }) });
 */
export class AnthropicSDK implements SDKAdapterContract {
  private readonly client: Anthropic;
  private readonly provider: string;
  private readonly pricing?: Record<string, ModelPricing>;

  public constructor(config: AnthropicSDKConfig) {
    // Peel off the framework-only keys and forward every other upstream
    // `ClientOptions` (timeout, maxRetries, defaultHeaders, fetch, …) verbatim
    // — they type-check, so dropping them is a silent footgun. Mirrors the
    // Bedrock/Google/Ollama adapters.
    const { provider, pricing, ...clientOptions } = config;

    this.client = new Anthropic(clientOptions);
    this.provider = provider ?? "anthropic";
    this.pricing = pricing;
  }

  /**
   * Build an `AnthropicModel` bound to this SDK's client. Each call
   * returns a fresh model instance, but all instances share the
   * underlying `Anthropic` client — connection pools, rate limits, and
   * authentication stay unified across every model produced here. The
   * SDK's `provider` label is forwarded so every model self-identifies
   * as coming from the same upstream.
   *
   * Pricing resolution: per-model `config.pricing` wins; otherwise the
   * SDK-level registry entry keyed by `config.name`; otherwise
   * `undefined` (no cost computed).
   */
  public model(config: AnthropicModelConfig): AnthropicModel {
    const resolvedPricing = config.pricing ?? this.pricing?.[config.name];
    const resolvedConfig: AnthropicModelConfig =
      resolvedPricing === config.pricing ? config : { ...config, pricing: resolvedPricing };

    return new AnthropicModel(this.client, resolvedConfig, this.provider);
  }

  /**
   * Rough token-count estimate for a given text. Uses the
   * character-heuristic (`approximateTokenCount`) from the core package
   * — good enough for budgeting and quota guards, not for billing.
   * For an exact count use `AnthropicModel.countTokens()`, which calls
   * Anthropic's `messages.countTokens` endpoint (a network round-trip);
   * `count()` is intentionally offline and synchronous-cost. The optional model id is reserved for future
   * per-model tokenizer dispatch; currently ignored.
   */
  public async count(text: string, _model?: string): Promise<number> {
    return approximateTokenCount(text);
  }

  /**
   * List the Claude models this account can use, live from `GET /v1/models`,
   * mapped to {@link ModelInfo}. Follows pagination to the end. `created` is
   * the release date, `contextWindow` and `maxOutputTokens` come from
   * Anthropic's `max_input_tokens` / `max_tokens` when the API reports them.
   * Every entry is a chat model (`kind: "chat"`). Failures are thrown as the
   * adapter's usual provider errors, never an empty list.
   *
   * @example
   * const models = await anthropic.models();
   * models.map((model) => model.id); // ["claude-sonnet-4-5-...", ...]
   */
  public async models(options?: ListModelsOptions): Promise<ModelInfo[]> {
    const found = new Map<string, ModelInfo>();

    try {
      for await (const entry of this.client.models.list(
        { limit: 1000 },
        options?.signal ? { signal: options.signal } : undefined,
      )) {
        const row = entry as unknown as Record<string, unknown>;
        const id = row.id;

        if (typeof id !== "string" || id === "") {
          continue;
        }

        const released = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
        const contextWindow = row.max_input_tokens;
        const maxOutputTokens = row.max_tokens;

        found.set(id, {
          id,
          label: typeof row.display_name === "string" && row.display_name ? row.display_name : id,
          provider: this.provider,
          kind: "chat",
          ...(Number.isNaN(released) ? {} : { created: Math.floor(released / 1000) }),
          ...(typeof contextWindow === "number" ? { contextWindow } : {}),
          ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
        });
      }
    } catch (thrown) {
      throw wrapAnthropicError(thrown);
    }

    return [...found.values()];
  }
}
