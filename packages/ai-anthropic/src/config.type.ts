import type { ModelConfig, ModelPricing } from "@warlock.js/ai";
import type { ClientOptions } from "@anthropic-ai/sdk";
import type { AnthropicThinkingMode } from "./thinking-mode";

/**
 * Configuration for the Anthropic SDK adapter.
 *
 * `provider` labels the SDK with the upstream you're pointing at —
 * useful when the same Anthropic-compatible client is wired to a
 * gateway or proxy. The label flows through to `ModelContract.provider`
 * and surfaces on `AgentReport.model`, logs, and any middleware that
 * branches on provider identity. Defaults to `"anthropic"` when omitted.
 *
 * `pricing` is an optional SDK-level registry keyed by model name. One
 * source of truth per provider; matches how providers publish pricing
 * tables. Resolution at `model()` call time: per-model `pricing` (on
 * `AnthropicModelConfig`) > this SDK registry > `undefined`. When
 * neither is set, `Usage.cost` stays `undefined` on every report this
 * SDK's models produce.
 *
 * @example
 * new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });
 *
 * @example
 * // SDK-level pricing registry — pricing in USD per million tokens.
 * new AnthropicSDK({
 *   apiKey,
 *   pricing: {
 *     "claude-haiku-4-5":  { input: 1,  output: 5,  cachedInput: 0.1 },
 *     "claude-sonnet-4-6": { input: 3,  output: 15, cachedInput: 0.3 },
 *   },
 * });
 */
export type AnthropicSDKConfig = ClientOptions & {
  provider?: string;
  /**
   * Per-model USD pricing registry, keyed by model name. Surfaced onto
   * every `AnthropicModel` produced by `model()`; per-model
   * `AnthropicModelConfig.pricing` still wins when both are set.
   */
  pricing?: Record<string, ModelPricing>;
};

/**
 * Per-model configuration for `AnthropicSDK.model()`. Extends the
 * neutral `ModelConfig` with Anthropic-specific capability overrides.
 *
 * @example
 * anthropic.model({ name: "claude-sonnet-4-6" });               // vision auto-true
 * anthropic.model({ name: "custom-proxy-model", vision: false }); // dev override
 */
export type AnthropicModelConfig = ModelConfig & {
  /**
   * Override the auto-inferred vision capability. When omitted, the
   * adapter checks the model name against the known Claude vision
   * families (see `known-vision-models.ts`). Setting `true` or `false`
   * explicitly always wins over inference — useful for proxied
   * deployments or capability-degraded testing.
   */
  vision?: boolean;
  /**
   * The model's maximum output tokens, used to size the default
   * `max_tokens` when no `maxTokens` is set. Inferred from known Claude
   * ids (`known-output-limits.ts`: 128K for the Claude 5 family and
   * Opus 4.6–4.8 / Sonnet 4.6, 64K for Opus / Sonnet / Haiku 4.5); set it
   * for gateway or proxy ids the adapter does not recognise. Unknown ids
   * default to 16384.
   *
   * @example
   * anthropic.model({ name: "my-gateway/opus", maxOutputTokens: 128_000 });
   */
  maxOutputTokens?: number;
  /**
   * Override the inferred `structuredOutput` capability. When omitted,
   * the adapter treats the model as capable and forwards
   * `responseSchema` via Anthropic's native `output_config.format`
   * (JSON-schema structured outputs). Set to `false` for models or
   * proxies that don't support native structured output — the agent
   * then re-injects a soft schema hint into the system prompt instead.
   */
  structuredOutput?: boolean;
  /**
   * Opt into Anthropic prompt caching. When a request has no explicit
   * `ModelCallOptions.cacheControl.breakpoints`, the adapter sends
   * request-level `cache_control: { type: "ephemeral" }`, letting
   * Anthropic cache the longest reusable prefix automatically. Tool
   * definitions are still marked explicitly when present.
   *
   * Off by default: a cache *write* costs ~1.25x, so it only pays off
   * when the cached prefix is read at least twice (multi-trip agents).
   * A one-shot agent with no tools is unaffected — no tools, no marker,
   * no surcharge. The automatic marker caches the longest reusable
   * prefix, which includes the system prompt (a large stable system
   * prompt is read back from cache on the next call). A system prompt
   * with per-turn placeholders changes the prefix each turn, so it
   * pays the write surcharge without reads.
   *
   * Explicit per-call `ModelCallOptions.cacheControl.breakpoints`
   * behave as before: they place a breakpoint on the system prompt and
   * replace the automatic request-level marker.
   */
  promptCaching?: boolean;
  /**
   * Lifetime for prompt-cache entries emitted by `promptCaching` and
   * explicit `cacheControl.breakpoints`. Omit for Anthropic's default
   * five-minute TTL; use `"1h"` only when its higher write cost is worth
   * retaining a stable prefix for longer. A per-call
   * `ModelCallOptions.cacheControl.ttl` overrides it for that call.
   */
  promptCacheTtl?: "5m" | "1h";
  /**
   * Override the inferred `reasoning` capability. When omitted, the
   * adapter advertises reasoning as supported (every modern Claude model
   * accepts Anthropic extended thinking via `thinking`), so a per-call
   * `ModelCallOptions.reasoning` is forwarded in the model's thinking
   * shape (see `thinkingMode`). Set to `false` for proxied deployments or
   * older targets that reject the `thinking` param — the adapter then
   * ignores reasoning options rather than sending an unsupported field.
   */
  reasoning?: boolean;
  /**
   * Override the inferred thinking mode. When omitted, the adapter infers
   * it from the model name (see `thinking-mode.ts`): `"budget"` for
   * Claude Haiku 4.5, Opus/Sonnet 4.6 and older models, `"adaptive"` for
   * everything else (Opus 4.7+, Sonnet 5+, Fable 5+, and unknown ids).
   *
   * - `"adaptive"` sends `thinking: { type: "adaptive" }` plus
   *   `output_config.effort`, and never sends `temperature`.
   * - `"budget"` sends `thinking: { type: "enabled", budget_tokens }` and
   *   keeps forwarding `temperature`.
   *
   * Useful for gateways/proxies whose model ids don't follow Anthropic's
   * naming, or to opt Opus/Sonnet 4.6 into adaptive thinking.
   *
   * @example
   * anthropic.model({ name: "my-gateway/haiku", thinkingMode: "budget" });
   */
  thinkingMode?: AnthropicThinkingMode;
};

/**
 * Anthropic-only request options, passed per call (or through the agent's
 * `modelOptions`) as `providerOptions.anthropic`. Other adapters ignore
 * this key, so the same options object is safe in a cross-provider
 * fallback chain.
 *
 * @example
 * // Server-side compaction (beta) on a long-running agent.
 * const agent = ai.agent({
 *   model: anthropic.model({ name: "claude-opus-5-5" }),
 *   modelOptions: {
 *     providerOptions: {
 *       anthropic: {
 *         betas: ["compact-2026-01-12"],
 *         body: { context_management: { edits: [{ type: "compact_20260112" }] } },
 *       },
 *     },
 *   },
 * });
 *
 * @example
 * // Readable thinking summaries plus the refusal fallback.
 * await model.complete(messages, {
 *   reasoning: { effort: "high" },
 *   providerOptions: {
 *     anthropic: {
 *       thinkingDisplay: "summarized",
 *       betas: ["server-side-fallback-2026-07-01"],
 *       body: { fallbacks: "default" },
 *     },
 *   },
 * });
 */
export type AnthropicCallOptions = {
  /**
   * Beta flags (`anthropic-beta` header values). When non-empty the
   * request goes through the SDK's `client.beta.messages` endpoint, which
   * accepts the beta-only body fields (`context_management`, `fallbacks`,
   * `speed`, …) and returns beta-only blocks such as `compaction`.
   */
  betas?: string[];
  /**
   * Extra Messages API body fields, merged last over the adapter-built
   * body — e.g. `context_management`, `fallbacks`, `inference_geo`,
   * `tool_choice`, `metadata`. Sent as-is: the adapter does not validate
   * them, so a field the endpoint or model rejects surfaces as the
   * provider's 400. The fields the adapter builds from the call —
   * `model`, `messages`, `system`, `tools`, `mcp_servers`, `stream` — are
   * refused with `InvalidRequestError`. Never pass end-user input here.
   */
  body?: Record<string, unknown>;
  /**
   * `thinking.display` for adaptive-thinking models: `"summarized"`
   * returns readable thinking summaries, `"omitted"` (the API default on
   * Claude 5-family models) returns empty thinking text, `"updates"`
   * returns between-tool progress notes (needs the
   * `thinking-display-updates-2026-08-18` beta). Applied whenever the
   * adapter sends `thinking` to an adaptive-mode model — i.e. alongside a
   * `reasoning` option (on Claude 5-family models, `reasoning: { effort }`
   * is enough). Ignored on budget-mode models.
   */
  thinkingDisplay?: "summarized" | "omitted" | "updates";
};
