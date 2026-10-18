import type { Message } from "./conversation-message.type";
import type { FinishReason } from "./finish-reason.type";
import type { ModelToolCallRequest } from "./model-tool-call-request.type";
import type { ProviderContentBlock } from "./provider-content-block.type";
import type { ProviderToolDefinition } from "./provider-tool.type";
import type { ModelPricing } from "./result/model-pricing.type";
import type { Usage } from "./result/usage.type";
import type { ToolConfig } from "./tool.contract";

/**
 * Options passed to model.complete() or model.stream().
 *
 * `tools` is first-class so every model implementation is responsible for
 * converting the vendor-neutral ToolConfig into its own provider format
 * (OpenAI functions, Anthropic tools, etc.).
 *
 * @example
 * await model.complete(messages, {
 *   temperature: 0.2,
 *   maxTokens: 1000,
 *   tools: [weatherTool, searchTool],
 * });
 */
export type ModelCallOptions = {
  temperature?: number;
  maxTokens?: number;
  /** Tools to expose to the LLM on this call. Each model converts to its provider format. */
  tools?: ToolConfig<unknown, unknown>[];
  /**
   * Provider-defined tools for this call (Anthropic `web_search`, OpenAI
   * Responses `web_search`, Gemini `googleSearch`, …), usually built with
   * `ai.providerTool()`. Each adapter sends the `definition` verbatim when
   * `provider` names it, and skips the entry with a logged warning
   * otherwise. The agent fills this from the `ai.providerTool()` entries of
   * its `tools` list; pass it directly only when calling a model yourself.
   *
   * @example
   * await model.complete(messages, {
   *   providerTools: [{ provider: "anthropic", definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 } }],
   * });
   */
  providerTools?: ProviderToolDefinition[];
  /**
   * Opt in to the extra `stream()` chunks: `reasoning` (thinking deltas),
   * `tool-args` (tool-call argument deltas) and `usage` (running token
   * counts before `done`). Off by default so existing `model.stream()`
   * consumers see exactly the `delta` / `tool-call` / `done` sequence they
   * always did. `true` turns every kind on; an object picks kinds. The
   * agent turns them all on for `agent.stream()` unless `modelOptions`
   * sets this key. Ignored by `complete()`.
   *
   * @example
   * for await (const chunk of model.stream(messages, { streamChunks: { reasoning: true } })) {
   *   if (chunk.type === "reasoning") process.stdout.write(chunk.delta);
   * }
   */
  streamChunks?: StreamChunkOptions;
  /**
   * JSON Schema the response must match. Adapters that declare
   * `capabilities.structuredOutput` forward this to the provider's native
   * structured-output mechanism (OpenAI `response_format: json_schema`,
   * Anthropic tool-use trick, etc.). Adapters without native support may
   * ignore this field — the agent still injects a soft JSON instruction
   * into the system prompt as a fallback.
   */
  responseSchema?: Record<string, unknown>;
  /**
   * Cancellation handle — part of the adapter contract. An adapter must
   * reject a call whose signal is already aborted, and when the signal
   * aborts mid-call it must reject promptly AND cancel the underlying HTTP
   * request (so the provider stops generating and billing), for both
   * `complete()` and `stream()`. Every first-party adapter is checked with
   * `verifyModelSignalContract()`; run it against a custom adapter too.
   * The agent additionally honours the signal at trip boundaries.
   */
  signal?: AbortSignal;
  /**
   * Reasoning / thinking-effort control for reasoning-capable models.
   * `effort` maps to OpenAI `reasoning_effort`; `maxTokens` caps the
   * Anthropic extended-thinking budget. `effort: "none"` runs the model
   * **without reasoning, explicitly** — distinct from an absent `effort`
   * (which requests the provider default, i.e. the model may still reason
   * server-side). It is the only mode in which OpenAI's gpt-5 / o-series
   * models accept function tools on the Chat Completions API. Adapters
   * whose `capabilities.reasoning` is absent/false ignore this rather than
   * forwarding unsupported params. Absent = provider default.
   *
   * @example
   * await model.complete(messages, { reasoning: { effort: "high" } });
   *
   * @example
   * // gpt-5 / o-series + tools: turn reasoning off so tools are accepted.
   * await model.complete(messages, { reasoning: { effort: "none" }, tools });
   *
   * `@warlock.js/ai-openai` specifically DEFAULTS to `effort: "none"`
   * automatically whenever `tools` is non-empty and the caller left
   * `reasoning` unset — there is no working alternative on Chat Completions
   * in that state, so the explicit form above is for overriding the
   * default (or documenting intent), not required to get it. This is an
   * adapter-level default, not a contract guarantee — other adapters may
   * have different constraints (or none) around reasoning + tools.
   */
  reasoning?: {
    effort?: ReasoningEffort;
    maxTokens?: number;
  };
  /**
   * Vendor-neutral prompt-cache WRITE breakpoint hint. Adapters with
   * `capabilities.promptCaching` translate `breakpoints` into provider
   * cache markers (Anthropic `cache_control`); others ignore it.
   * Read-side accounting (`Usage.cachedTokens`) works without this — it
   * only controls WRITE placement. Absent = provider default (no
   * explicit breakpoints).
   *
   * @example
   * await model.complete(messages, { cacheControl: { breakpoints: 1 } });
   */
  cacheControl?: {
    breakpoints?: number;
    /**
     * Lifetime of the cache entries this call writes. Adapters with a
     * configurable TTL (Anthropic: `"5m"` default, `"1h"`) forward it;
     * others ignore it. Overrides any adapter-level TTL for this call.
     */
    ttl?: "5m" | "1h";
  };
  /**
   * Provider-specific request options, keyed by the adapter's wire format
   * (`anthropic`, `openai`, …). Each adapter reads only its own key and
   * ignores the rest, so one `modelOptions` object can serve a fallback
   * chain across providers. See the adapter's own docs for the accepted
   * shape (e.g. `@warlock.js/ai-anthropic`'s `AnthropicCallOptions`).
   *
   * @example
   * await model.complete(messages, {
   *   providerOptions: {
   *     anthropic: { betas: ["compact-2026-01-12"], body: { context_management: { edits: [{ type: "compact_20260112" }] } } },
   *   },
   * });
   */
  providerOptions?: Record<string, Record<string, unknown> | undefined>;
  /** Additional provider-specific options */
  [key: string]: unknown;
};

/**
 * Reasoning/thinking-effort levels for reasoning-capable models. Maps to
 * the provider-native control (OpenAI `reasoning_effort`); adapters
 * without reasoning support ignore it.
 *
 * `"none"` means **run without reasoning, explicitly** — not "provider
 * default" (that is what an absent `effort` requests). It exists because
 * OpenAI's gpt-5 / o-series models reject function tools on Chat
 * Completions while reasoning is active: the endpoint accepts tools only
 * when `reasoning_effort` is sent as `"none"` (the alternative is the
 * Responses API). The OpenAI adapter forwards `"none"` verbatim so
 * tool-using agents work on those models; budget-based adapters
 * (Anthropic / Google `thinking`, Ollama `think`, Bedrock) read `"none"`
 * as "reasoning off" and disable the thinking channel. Adapters map every
 * other level to the nearest value their provider/model accepts, clamping an
 * unsupported higher level to that provider/model's highest accepted level;
 * where `"minimal"` is unsupported it maps to `"low"`. They never reject a
 * request solely because its effort level is unsupported.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Declarative feature flags a `ModelContract` may expose so the agent can
 * short-circuit redundant work when the provider already enforces a
 * behavior natively.
 *
 * @example
 * class OpenAIModel implements ModelContract {
 *   public readonly capabilities: ModelCapabilities = { structuredOutput: true };
 * }
 */
export type ModelCapabilities = {
  /**
   * True when the adapter forwards `ModelCallOptions.responseSchema` to
   * the provider's native structured-output mechanism and the provider
   * guarantees a matching response at the token level. When true, the
   * agent skips the soft "respond in JSON" system-prompt injection.
   */
  structuredOutput?: boolean;
  /**
   * True when the adapter accepts `ContentPart` entries of type
   * `"image"` in user messages and the provider can interpret them
   * (vision models). When false/absent and the caller passes image
   * attachments, the agent throws upfront rather than silently
   * dropping them at the wire layer.
   */
  vision?: boolean;
  /**
   * True when the adapter exposes provider reasoning / extended-thinking
   * and forwards `ModelCallOptions.reasoning`. When false/absent the
   * agent ignores reasoning options rather than sending unsupported
   * params to the provider.
   */
  reasoning?: boolean;
  /**
   * True when the adapter honors `ModelCallOptions.cacheControl` write
   * breakpoints and reports `Usage.cachedTokens` / `Usage.cacheWriteTokens`.
   * When false/absent the agent skips emitting cache breakpoints.
   */
  promptCaching?: boolean;
  /**
   * True when the adapter accepts audio `ContentPart` input (A2). The
   * agent gates `{ type: "audio" }` attachments on this flag — when
   * false/absent it throws upfront rather than dropping them at the wire
   * layer (mirrors `vision`). Wired end-to-end: audio `ContentPart` +
   * attachment resolution exist; today Google (Gemini, via `inlineData`)
   * declares it.
   */
  audio?: boolean;
  /**
   * True when the adapter accepts PDF / document `ContentPart` input (A2).
   * The agent gates `{ type: "pdf" }` attachments on this flag — when
   * false/absent it throws upfront (mirrors `vision`). Wired end-to-end:
   * Anthropic (`document` block), Bedrock Converse (`document` block), and
   * Google (Gemini `inlineData`) map PDF parts.
   */
  pdf?: boolean;
};

/**
 * Full response from a non-streaming model call.
 *
 * @example
 * const response: ModelResponse = {
 *   content: "Here is the answer...",
 *   finishReason: "stop",
 *   usage: { input: 120, output: 80, total: 200 },
 * };
 */
export type ModelResponse = {
  content: string;
  finishReason: FinishReason;
  /**
   * Token usage of this call. The first-party adapters also attach
   * `usage.cost` when the model is priced (per-model `pricing`, the SDK
   * registry, or the adapter's built-in list prices), so a side call
   * made outside an agent — a summary, a classifier — is measured and
   * costed the same way an agent trip is. `usage.inputIncludesCache`
   * says how to read `input` against the cache counters.
   *
   * @example
   * const { usage } = await model.complete(messages);
   * console.log(usage.total, totalCost(usage.cost) ?? "unpriced");
   */
  usage: Usage;
  /** Tool calls requested by the model, present when finishReason is "tool_calls" */
  toolCalls?: ModelToolCallRequest[];
  /**
   * The provider's raw content blocks for this turn, in order — set by
   * adapters that have blocks the neutral fields cannot carry (Anthropic
   * thinking / redacted thinking / compaction). The agent copies them onto
   * the assistant `Message.blocks` so the next call replays the turn
   * verbatim. See {@link ProviderContentBlock}.
   */
  blocks?: ProviderContentBlock[];
};

/**
 * Which optional stream chunks a `model.stream()` call should yield — see
 * `ModelCallOptions.streamChunks`. `true` enables every kind.
 */
export type StreamChunkOptions =
  | boolean
  | {
      /** `{ type: "reasoning" }` chunks: the model's thinking text as it streams. */
      reasoning?: boolean;
      /** `{ type: "tool-args" }` chunks: a tool call's argument JSON as it streams. */
      toolArgs?: boolean;
      /** `{ type: "usage" }` chunks: running token counts before `done`. */
      usage?: boolean;
    };

/**
 * A single chunk emitted during a streaming model call.
 *
 * `delta`, `tool-call` and `done` are always emitted. `reasoning`,
 * `tool-args` and `usage` are emitted only when the call opts in through
 * `ModelCallOptions.streamChunks` **and** the provider streams that data;
 * a consumer should ignore chunk types it does not handle and read the
 * finish reason only from `type === "done"`.
 *
 * @example
 * for await (const chunk of model.stream(messages)) {
 *   if (chunk.type === "delta") process.stdout.write(chunk.content);
 *   else if (chunk.type === "done") console.log(chunk.usage.total, "tokens");
 * }
 */
export type ModelStreamChunk =
  | { type: "delta"; content: string }
  | {
      /**
       * A piece of the model's reasoning / thinking text (Anthropic
       * `thinking_delta`, OpenAI Responses reasoning summary or reasoning
       * text, Gemini thought parts, Bedrock `reasoningContent`, Ollama
       * `thinking`, DeepSeek-style `reasoning_content`). Never part of the
       * answer `content`. Opt-in: `streamChunks.reasoning`.
       */
      type: "reasoning";
      delta: string;
    }
  | {
      /**
       * A piece of a tool call's argument JSON while the model writes it.
       * Concatenating every `delta` of one `callId` gives the raw argument
       * string; the parsed input still arrives on the `tool-call` chunk with
       * the same id. Emitted only by providers that stream arguments.
       * Opt-in: `streamChunks.toolArgs`.
       */
      type: "tool-args";
      /** The tool call id — matches the later `tool-call` chunk's `id`. */
      callId: string;
      /** The tool the model is calling. */
      name: string;
      delta: string;
    }
  | {
      /**
       * Token counts so far for this call — a running total, not an
       * increment. The `done` chunk still carries the final usage.
       * Emitted only by providers that report usage mid-stream
       * (Anthropic, Gemini). Opt-in: `streamChunks.usage`.
       */
      type: "usage";
      usage: Usage;
    }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: unknown;
      /**
       * Opaque provider round-trip data for this call — see
       * `ModelToolCallRequest.providerMetadata`. The agent copies it
       * verbatim onto the assembled `ModelToolCallRequest` so streamed
       * tool calls round-trip identically to non-streamed ones.
       */
      providerMetadata?: Record<string, unknown>;
    }
  | {
      type: "done";
      finishReason: FinishReason;
      usage: Usage;
      /** The turn's raw provider blocks — see `ModelResponse.blocks`. */
      blocks?: ProviderContentBlock[];
    };

/**
 * Contract every SDK model instance must implement.
 * Created by SDKAdapterContract.model() — internally holds the SDK client
 * so agents only need to pass the model, not the SDK.
 *
 * @example
 * const model = ai.openai.model({ name: "gpt-4o", temperature: 0.7 });
 * const response = await model.complete(messages);
 *
 * @example
 * for await (const chunk of model.stream(messages)) {
 *   if (chunk.type === "delta") process.stdout.write(chunk.content);
 * }
 */
export interface ModelContract {
  /** Model identifier (e.g. "gpt-4o", "claude-3-5-sonnet-20241022") */
  readonly name: string;
  /** Provider this model belongs to (e.g. "openai", "anthropic") */
  readonly provider: string;
  /**
   * Optional feature flags so callers (notably the agent) can skip work
   * the provider already handles natively. Absent = treat every flag as
   * `false`.
   */
  readonly capabilities?: ModelCapabilities;

  /**
   * Per-million-token USD pricing. When set, the framework computes
   * `Usage.costUSD` at emit time for every trip / tool / report node
   * touching this model. Resolution: per-model `pricing` (here) >
   * SDK-level `pricing[name]` registry > undefined (no cost computed).
   *
   * Critical for multi-tenant projects where pricing is contract-
   * specific or runtime-resolved — pass per-model when you need to
   * override the SDK registry for a single agent.
   */
  readonly pricing?: ModelPricing;

  /**
   * Send messages and receive a full response once generation is complete.
   */
  complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse>;

  /**
   * Send messages and stream the response chunk by chunk.
   */
  stream(messages: Message[], options?: ModelCallOptions): AsyncIterable<ModelStreamChunk>;

  /**
   * Native input-token preflight (network call). Absent when this model's
   * transport has no counting endpoint. SDK.count() is a separate offline estimate.
   * Adapters that cannot count a request shape throw `InvalidRequestError` with
   * `reason: "count-unsupported"`; `countInputTokens` then estimates instead.
   * Never use this reason for authentication, transport or other request errors.
   */
  countTokens?(messages: Message[], options?: ModelCallOptions): Promise<number>;
}
