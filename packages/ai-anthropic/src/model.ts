import {
  InvalidRequestError,
  safeJsonParse,
  type Message,
  type ModelCallOptions,
  type ModelCapabilities,
  type ModelContract,
  type ModelPricing,
  type ModelResponse,
  type ModelStreamChunk,
  type ModelToolCallRequest,
  type ReasoningEffort,
  type Usage,
} from "@warlock.js/ai";
import { log, type Logger } from "@warlock.js/logger";
import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicCallOptions, AnthropicModelConfig } from "./config.type";
import type {
  AnthropicRequest,
  AnthropicRequestOptions,
  AnthropicStreamingRequest,
  AnthropicNonStreamingRequest,
} from "./request.type";
import { inferVisionCapability } from "./known-vision-models";
import {
  acceptsBetweenTools,
  acceptsTemperature,
  inferThinkingMode,
  type AnthropicThinkingMode,
} from "./thinking-mode";
import {
  mapStopReason,
  toAnthropicMessages,
  toAnthropicTools,
  toProviderBlocks,
  wrapAnthropicError,
} from "./utils";

const LOG_MODULE = "ai.anthropic";

/**
 * Anthropic requires `max_tokens` on every request (unlike OpenAI,
 * where it is optional). When neither the per-call option nor the
 * model config supplies one, fall back to a generous default so a
 * caller who never thought about token caps still gets a complete
 * answer instead of a 400.
 */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Anthropic rejects an extended-thinking budget below 1024 tokens, so
 * any resolved budget is floored at this minimum before it reaches the
 * wire.
 */
const MIN_THINKING_BUDGET = 1024;

type ThinkingEffort = Exclude<ReasoningEffort, "none">;

/**
 * Effort used when the caller asks for reasoning with only
 * `reasoning.maxTokens` and no `effort`. `"medium"` is what the adapter
 * has always assumed (the budget lookup fell back to
 * `EFFORT_THINKING_BUDGET.medium`), so adaptive models get the same tier.
 */
const DEFAULT_THINKING_EFFORT: ThinkingEffort = "medium";

/**
 * Map the neutral `ReasoningEffort` level to a thinking token count.
 *
 * - Budget-mode models: sent as `thinking.budget_tokens` when the caller
 *   doesn't pass an explicit `reasoning.maxTokens`.
 * - Both modes: reserved on top of `DEFAULT_MAX_TOKENS` when the caller
 *   sets no `maxTokens`, because thinking counts toward `max_tokens`
 *   (installed SDK `ThinkingConfigParam` docs, `messages.d.ts:1105`).
 *   Adaptive models therefore get the same `max_tokens` the budget path
 *   has always produced.
 */
const EFFORT_THINKING_BUDGET: Record<ThinkingEffort, number> = {
  // Anthropic's adaptive output config has no `minimal`; keep the minimum
  // budget for it in legacy budget mode too.
  minimal: 1024,
  low: 1024,
  medium: 4096,
  high: 12000,
  // Keep the tiers monotonic for older budget-mode models. Explicit
  // reasoning.maxTokens still wins and the existing max_tokens validation
  // remains authoritative.
  xhigh: 24000,
  max: 32000,
};

/**
 * Map the neutral `ReasoningEffort` level to Anthropic's
 * `output_config.effort` for adaptive-mode models. The installed SDK
 * accepts `low | medium | high | xhigh | max` (`OutputConfig.effort`,
 * `messages.ts:2767`); map every supported value 1:1 and clamp `minimal` to
 * the nearest accepted value, `low`.
 */
const EFFORT_TO_OUTPUT_EFFORT: Record<
  ThinkingEffort,
  NonNullable<Anthropic.OutputConfig["effort"]>
> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

type AnthropicThinkingBlock = Anthropic.ThinkingBlock | Anthropic.RedactedThinkingBlock;

/**
 * The SDK's `messages.create` (or `beta.messages.create`) seen through a
 * loose signature: provider-option body fields and beta flags are merged
 * in untyped, and the response is narrowed by the caller.
 */
type LooseCreate = (
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

/** Content-block types whose input arrives as `input_json_delta` while streaming. */
const STREAMED_INPUT_BLOCK_TYPES = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);

/** One content block being assembled from stream events. */
type StreamedBlock = { block: Record<string, unknown>; json?: string };

/**
 * Resolved thinking settings for one request.
 *
 * - `thinking`: the wire `thinking` field (absent = send nothing).
 * - `effort`: `output_config.effort`, set for adaptive-mode models only.
 * - `reservedTokens`: thinking tokens to reserve on top of
 *   `DEFAULT_MAX_TOKENS` when the caller configured no `maxTokens`.
 */
type ThinkingRequest = {
  thinking?: Anthropic.ThinkingConfigParam;
  effort?: Anthropic.OutputConfig["effort"];
  reservedTokens?: number;
};

/**
 * Anthropic-backed implementation of `ModelContract`.
 *
 * **Role.** The provider-facing bridge between the vendor-neutral
 * `@warlock.js/ai` agent runtime and the official `@anthropic-ai/sdk`
 * Messages API. Agents, workflows, and supervisors never talk to
 * Anthropic directly — they hold a `ModelContract`, and this class is
 * what makes that contract concrete for Claude models.
 *
 * **Responsibility.**
 * - Owns: a long-lived `Anthropic` client + frozen `ModelConfig`
 *   (name, temperature, maxTokens) used as defaults for every call.
 * - Owns: translating vendor-neutral `Message[]` / `ToolConfig[]` into
 *   Anthropic wire shapes (system hoisting, `tool_use` / `tool_result`
 *   blocks) on the way out, and translating Anthropic's content-block
 *   response (text, tool calls, stop reason, usage) back into the
 *   neutral shapes on the way in.
 * - Does NOT own: dispatching tools, deciding whether to loop, tracking
 *   conversation history, or retrying on failure — those are agent
 *   concerns. The model is a stateless (per-call) protocol adapter.
 *
 * Because it holds a live client and shared defaults, it is modeled as
 * a class (see §4.2 of code-style.md — "long-lived state across
 * calls").
 *
 * @example
 * import Anthropic from "@anthropic-ai/sdk";
 * const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 * const model = new AnthropicModel(client, { name: "claude-sonnet-4-6" });
 *
 * const myAgent = agent({
 *   model,
 *   systemPrompt: "You are a helpful assistant.",
 *   tools: [searchTool],
 * });
 *
 * const result = await myAgent.execute("Summarize today's news.");
 */
export class AnthropicModel implements ModelContract {
  public readonly name: string;
  public readonly provider: string;
  public readonly capabilities: ModelCapabilities;
  public readonly pricing?: ModelPricing;

  private readonly client: Anthropic;
  private readonly config: AnthropicModelConfig;
  private readonly thinkingMode: AnthropicThinkingMode;
  private readonly logger: Logger = log;

  public constructor(
    client: Anthropic,
    config: AnthropicModelConfig,
    provider: string = "anthropic",
  ) {
    this.client = client;
    this.config = config;
    this.name = config.name;
    this.provider = provider;
    this.pricing = config.pricing;
    // Adaptive vs budget thinking — also decides whether `temperature` is
    // accepted. Explicit config wins over name inference, like `vision`.
    this.thinkingMode = config.thinkingMode ?? inferThinkingMode(config.name);
    this.capabilities = {
      structuredOutput: config.structuredOutput ?? true,
      vision: config.vision ?? inferVisionCapability(config.name),
      // Every modern Claude model accepts Anthropic extended thinking
      // (adaptive or `budget_tokens`, per `thinkingMode`). Advertise the
      // reasoning channel so the agent forwards `reasoning` options;
      // explicit config override wins for proxied/legacy targets.
      reasoning: config.reasoning ?? true,
      // Anthropic prompt caching is caller-driven via `cache_control`
      // breakpoints. The adapter both places those breakpoints (tools
      // when `config.promptCaching`, system when
      // `options.cacheControl.breakpoints`) and reports the read/write
      // accounting (`cachedTokens` / `cacheWriteTokens`), so advertise
      // the capability unconditionally.
      promptCaching: true,
      // The Messages API accepts PDF/document content blocks
      // (`DocumentBlockParam`) on vision-capable Claude models.
      pdf: true,
      // Anthropic has no audio input content block, so `audio` stays
      // absent (treated as false) and the agent rejects audio
      // attachments upfront rather than dropping them at the wire layer.
    };
  }

  /**
   * Single-shot completion. Sends the full message list to the Messages
   * endpoint, waits for the terminal response, and reshapes it into a
   * vendor-neutral `ModelResponse`. Per-call `options` override the
   * instance's `ModelConfig` defaults for this call only.
   */
  public async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
    return this.send(this.buildRequest(messages, { ...options, stream: false }), {
      signal: options?.signal,
    });
  }

  /** Build a detached request snapshot without sending it to Anthropic. */
  public buildRequest(
    messages: Message[],
    options: ModelCallOptions & { stream: true },
  ): AnthropicStreamingRequest;
  public buildRequest(
    messages: Message[],
    options?: ModelCallOptions & { stream?: false },
  ): AnthropicNonStreamingRequest;
  public buildRequest(
    messages: Message[],
    options?: ModelCallOptions & { stream?: boolean },
  ): AnthropicRequest;
  public buildRequest(
    messages: Message[],
    options?: ModelCallOptions & { stream?: boolean },
  ): AnthropicRequest {
    const betas = [...(resolveAnthropicOptions(options).betas ?? [])];
    const body = structuredClone({
      ...this.buildBody(messages, options),
      stream: options?.stream ?? false,
    });

    return { endpoint: betas.length > 0 ? "beta.messages" : "messages", body, betas };
  }

  /** Send a built request without rebuilding its body or applying model defaults. */
  public send(
    request: AnthropicNonStreamingRequest,
    options?: AnthropicRequestOptions,
  ): Promise<ModelResponse>;
  public send(
    request: AnthropicStreamingRequest,
    options?: AnthropicRequestOptions,
  ): AsyncIterable<ModelStreamChunk>;
  public send(
    request: AnthropicRequest,
    options?: AnthropicRequestOptions,
  ): Promise<ModelResponse> | AsyncIterable<ModelStreamChunk>;
  public send(
    request: AnthropicRequest,
    options?: AnthropicRequestOptions,
  ): Promise<ModelResponse> | AsyncIterable<ModelStreamChunk> {
    this.logger.debug(LOG_MODULE, "request", "Starting call to messages.create", {
      model: request.body.model,
      messageCount: Array.isArray(request.body.messages) ? request.body.messages.length : 0,
      streaming: request.body.stream,
      toolCount: Array.isArray(request.body.tools) ? request.body.tools.length : 0,
    });

    return request.body.stream
      ? this.streamRequest(request, options)
      : this.completeRequest(request, options);
  }

  private async completeRequest(
    request: AnthropicRequest,
    options?: AnthropicRequestOptions,
  ): Promise<ModelResponse> {
    let response: Anthropic.Message;

    try {
      response = (await this.dispatch(request, options, "create")) as Anthropic.Message;
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const finishReason = mapStopReason(response.stop_reason);
    const usage = this.extractUsage(response.usage);
    const toolCalls = this.extractToolCalls(response.content);
    const blocks = toProviderBlocks(response.content);

    this.logger.debug(LOG_MODULE, "response", "call to messages.create succeeded", {
      finishReason,
      usage,
    });

    return {
      content: this.extractText(response.content),
      finishReason,
      usage,
      toolCalls,
      ...(blocks ? { blocks } : {}),
    };
  }

  /**
   * Count the input tokens a request would use, through Anthropic's
   * `messages.countTokens` endpoint (a network call; no tokens are
   * generated or billed as output). Takes the same messages and options
   * as `complete()` — system prompt, tools, thinking and
   * `providerOptions.anthropic.betas` are counted exactly as they would be
   * sent. For an offline estimate use `AnthropicSDK.count()`.
   *
   * @example
   * const tokens = await model.countTokens(messages, { tools });
   */
  public async countTokens(messages: Message[], options?: ModelCallOptions): Promise<number> {
    const request = this.buildRequest(messages, options);
    const body = request.body;
    const countBody: Record<string, unknown> = {};

    for (const key of COUNT_TOKENS_FIELDS) {
      if (body[key] !== undefined) {
        countBody[key] = body[key];
      }
    }

    try {
      const result = (await this.dispatch(
        { ...request, body: countBody },
        options,
        "countTokens",
      )) as {
        input_tokens: number;
      };

      return result.input_tokens;
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }
  }

  /**
   * Incremental streaming completion. Yields neutral `ModelStreamChunk`s
   * — `delta` for text tokens, `tool-call` once a `tool_use` block's
   * arguments have fully accumulated, and a terminal `done` carrying the
   * final finish reason + usage totals. Callers consume it with
   * `for await`.
   */
  public async *stream(
    messages: Message[],
    options?: ModelCallOptions,
  ): AsyncIterable<ModelStreamChunk> {
    yield* this.send(this.buildRequest(messages, { ...options, stream: true }), {
      signal: options?.signal,
    });
  }

  private async *streamRequest(
    request: AnthropicRequest,
    options?: AnthropicRequestOptions,
  ): AsyncIterable<ModelStreamChunk> {
    let stream: AsyncIterable<Anthropic.RawMessageStreamEvent>;

    try {
      stream = (await this.dispatch(
        request,
        options,
        "create",
      )) as AsyncIterable<Anthropic.RawMessageStreamEvent>;
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    let rawStopReason: string | null = null;
    const usage: Usage = { input: 0, output: 0, total: 0 };
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    const thinkingBlocks = new Map<number, AnthropicThinkingBlock>();
    // Every content block of the turn, by index, so the full ordered turn
    // can be returned as `blocks` (thinking, compaction, server tools…).
    const streamedBlocks = new Map<number, StreamedBlock>();

    try {
      for await (const event of stream) {
        this.trackStreamedBlock(streamedBlocks, event);

        if (event.type === "message_start") {
          usage.input = event.message.usage.input_tokens ?? 0;

          const thinkingTokens = event.message.usage.output_tokens_details?.thinking_tokens;

          if (thinkingTokens !== null && thinkingTokens !== undefined) {
            usage.reasoningTokens = thinkingTokens;
          }

          const cacheRead = event.message.usage.cache_read_input_tokens;

          if (cacheRead !== null && cacheRead !== undefined && cacheRead > 0) {
            usage.cachedTokens = cacheRead;
          }

          const cacheWrite = event.message.usage.cache_creation_input_tokens;

          if (cacheWrite !== null && cacheWrite !== undefined && cacheWrite > 0) {
            usage.cacheWriteTokens = cacheWrite;
          }

          continue;
        }

        if (event.type === "content_block_start") {
          const block = event.content_block;

          if (block.type === "tool_use") {
            toolBlocks.set(event.index, { id: block.id, name: block.name, json: "" });
          } else if (block.type === "thinking") {
            thinkingBlocks.set(event.index, { ...block });
          } else if (block.type === "redacted_thinking") {
            thinkingBlocks.set(event.index, { ...block });
          }

          continue;
        }

        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield { type: "delta", content: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            const accumulator = toolBlocks.get(event.index);

            if (accumulator) {
              accumulator.json += event.delta.partial_json;
            }
          } else if (event.delta.type === "thinking_delta") {
            const thinking = thinkingBlocks.get(event.index);

            if (thinking?.type === "thinking") {
              thinking.thinking += event.delta.thinking;
            }
          } else if (event.delta.type === "signature_delta") {
            const thinking = thinkingBlocks.get(event.index);

            if (thinking?.type === "thinking") {
              thinking.signature += event.delta.signature;
            }
          }

          continue;
        }

        if (event.type === "content_block_stop") {
          const accumulator = toolBlocks.get(event.index);

          if (accumulator) {
            yield {
              type: "tool-call",
              id: accumulator.id,
              name: accumulator.name,
              input: safeJsonParse<Record<string, unknown>>(accumulator.json, {}),
              ...this.buildThinkingMetadata(
                Array.from(thinkingBlocks.entries())
                  .sort(([left], [right]) => left - right)
                  .map(([, block]) => block),
              ),
            };

            toolBlocks.delete(event.index);
          }

          continue;
        }

        if (event.type === "message_delta") {
          rawStopReason = event.delta.stop_reason ?? rawStopReason;
          usage.output = event.usage.output_tokens ?? usage.output;

          const thinkingTokens = event.usage.output_tokens_details?.thinking_tokens;

          if (thinkingTokens !== null && thinkingTokens !== undefined) {
            usage.reasoningTokens = thinkingTokens;
          }

          // `message_delta.usage` carries the cumulative cache counts —
          // prefer them over the `message_start` snapshot when present
          // and non-zero so the terminal `done` reflects the final tally.
          const cacheRead = event.usage.cache_read_input_tokens;

          if (cacheRead !== null && cacheRead !== undefined && cacheRead > 0) {
            usage.cachedTokens = cacheRead;
          }

          const cacheWrite = event.usage.cache_creation_input_tokens;

          if (cacheWrite !== null && cacheWrite !== undefined && cacheWrite > 0) {
            usage.cacheWriteTokens = cacheWrite;
          }
        }
      }
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    usage.total = usage.input + usage.output;

    const finishReason = mapStopReason(rawStopReason);
    const blocks = toProviderBlocks(this.finishStreamedBlocks(streamedBlocks));

    this.logger.debug(LOG_MODULE, "response", "Streaming call to messages.create succeeded", {
      finishReason,
      usage,
    });

    yield { type: "done", finishReason, usage, ...(blocks ? { blocks } : {}) };
  }

  /**
   * Fold one stream event into the per-index block accumulator. Unknown
   * block and delta types (beta `compaction`, future additions) are kept
   * as their start payload plus whatever their delta carries, so they
   * round-trip without the adapter knowing their shape.
   */
  private trackStreamedBlock(
    blocks: Map<number, StreamedBlock>,
    event: Anthropic.RawMessageStreamEvent,
  ): void {
    if (event.type === "content_block_start") {
      const block = { ...(event.content_block as unknown as Record<string, unknown>) };

      blocks.set(event.index, {
        block,
        ...(STREAMED_INPUT_BLOCK_TYPES.has(String(block.type)) ? { json: "" } : {}),
      });

      return;
    }

    if (event.type !== "content_block_delta") {
      return;
    }

    const entry = blocks.get(event.index);

    if (!entry) {
      return;
    }

    const delta = event.delta as unknown as Record<string, unknown> & { type: string };
    const block = entry.block;

    if (delta.type === "text_delta") {
      block.text = String(block.text ?? "") + String(delta.text ?? "");
    } else if (delta.type === "thinking_delta") {
      block.thinking = String(block.thinking ?? "") + String(delta.thinking ?? "");
    } else if (delta.type === "signature_delta") {
      block.signature = String(block.signature ?? "") + String(delta.signature ?? "");
    } else if (delta.type === "input_json_delta") {
      entry.json = (entry.json ?? "") + String(delta.partial_json ?? "");
    } else if (delta.type === "citations_delta") {
      block.citations = [
        ...(Array.isArray(block.citations) ? block.citations : []),
        delta.citation,
      ];
    } else {
      // e.g. beta `compaction_delta` — carries the block's final fields.
      for (const [key, value] of Object.entries(delta)) {
        if (key !== "type") {
          block[key] = value;
        }
      }
    }
  }

  /** Close the accumulated stream blocks into an ordered content array. */
  private finishStreamedBlocks(blocks: Map<number, StreamedBlock>): Array<{ type: string }> {
    return Array.from(blocks.entries())
      .sort(([left], [right]) => left - right)
      .map(([, { block, json }]) => {
        if (json !== undefined) {
          block.input = safeJsonParse<Record<string, unknown>>(json, {});
        }

        return block as { type: string };
      });
  }

  /**
   * Send a request through the SDK. With `providerOptions.anthropic.betas`
   * the call goes to `client.beta.messages` (which takes the `betas` list
   * and the beta-only body fields); otherwise to `client.messages`. The
   * cancellation signal rides in the request options, as before.
   */
  private dispatch(
    request: {
      endpoint: AnthropicRequest["endpoint"];
      body: Record<string, unknown>;
      betas: string[];
    },
    options: AnthropicRequestOptions | undefined,
    method: "create" | "countTokens",
  ): Promise<unknown> {
    const requestOptions = options?.signal ? { signal: options.signal } : undefined;
    const api =
      request.endpoint === "beta.messages" ? this.client.beta.messages : this.client.messages;
    const call = api[method] as unknown as LooseCreate;

    return call.call(
      api,
      request.endpoint === "beta.messages"
        ? { ...request.body, betas: request.betas }
        : request.body,
      requestOptions,
    );
  }

  /**
   * The full request body: the adapter-built params, then
   * `thinking.display` when thinking is sent on an adaptive model, then
   * `providerOptions.anthropic.body` merged last (caller fields win). The
   * body may add fields the adapter does not build (`context_management`,
   * `fallbacks`, …) but may not replace the conversation or the model —
   * see {@link RESERVED_BODY_FIELDS}.
   */
  private buildBody(
    messages: Message[],
    options: ModelCallOptions | undefined,
  ): Record<string, unknown> {
    const anthropic = resolveAnthropicOptions(options);
    const body: Record<string, unknown> = { ...this.buildParams(messages, options) };

    // `display` belongs to adaptive thinking only; `between_tools` takes
    // no other field and 400s with one.
    if (
      anthropic.thinkingDisplay &&
      this.thinkingMode === "adaptive" &&
      (body.thinking as { type?: string } | undefined)?.type === "adaptive"
    ) {
      body.thinking = {
        ...(body.thinking as Record<string, unknown>),
        display: anthropic.thinkingDisplay,
      };
    }

    const reserved = Object.keys(anthropic.body ?? {}).filter((key) =>
      RESERVED_BODY_FIELDS.has(key),
    );

    if (reserved.length > 0) {
      throw new InvalidRequestError(
        `providerOptions.anthropic.body cannot set ${reserved.map((key) => `"${key}"`).join(", ")}: ` +
          "the adapter builds these from the call's messages, tools and model. " +
          "Use the agent/model options instead.",
        { context: { fields: reserved } },
      );
    }

    return { ...body, ...anthropic.body };
  }

  /**
   * Assemble the Anthropic request body shared by `complete()` and
   * `stream()` (each adds its own `stream` literal so the SDK's create
   * overload resolves to the right return type). Hoists the system
   * prompt out of `messages`, resolves `max_tokens` (required by
   * Anthropic) with the documented default, and conditionally attaches
   * temperature, tools, native structured output, extended thinking
   * (`reasoning`), and automatic or explicit prompt-cache control.
   * Temperature is dropped when thinking is enabled, since Anthropic
   * rejects the two together, and always for adaptive-mode models, which
   * reject any explicit temperature (see `acceptsTemperature`).
   */
  private buildParams(
    messages: Message[],
    options: ModelCallOptions | undefined,
  ): Omit<Anthropic.MessageCreateParamsNonStreaming, "stream"> {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
    const thinking = this.buildThinking(options?.reasoning);
    const temperature = options?.temperature ?? this.config.temperature;
    const configuredMaxTokens = options?.maxTokens ?? this.config.maxTokens;
    const thinkingBudget =
      thinking.thinking?.type === "enabled" ? thinking.thinking.budget_tokens : undefined;
    const maxTokens =
      configuredMaxTokens ??
      (thinking.reservedTokens !== undefined
        ? thinking.reservedTokens + DEFAULT_MAX_TOKENS
        : DEFAULT_MAX_TOKENS);
    // Extended thinking pins sampling to the default temperature —
    // Anthropic 400s when `thinking` is enabled alongside any explicit
    // `temperature`. Models released after Opus 4.6 (adaptive mode) reject
    // an explicit temperature outright (installed SDK
    // `MessageCreateParamsBase.temperature`, `messages.d.ts:2036-2040`).
    // Drop it in both cases rather than letting the request fail.
    const sendTemperature =
      temperature !== undefined && !thinking.thinking && acceptsTemperature(this.thinkingMode);

    if (
      thinkingBudget !== undefined &&
      configuredMaxTokens !== undefined &&
      configuredMaxTokens <= thinkingBudget
    ) {
      throw new Error(
        `Anthropic maxTokens (${configuredMaxTokens}) must be greater than thinking budget_tokens (${thinkingBudget})`,
      );
    }

    return {
      model: this.name,
      max_tokens: maxTokens,
      messages: anthropicMessages,
      ...this.buildAutomaticCacheControl(options?.cacheControl),
      ...this.buildSystem(system, options?.cacheControl),
      ...(sendTemperature ? { temperature } : {}),
      ...this.buildTools(options?.tools, options?.cacheControl),
      ...this.buildOutputConfig(options?.responseSchema, thinking.effort),
      ...(thinking.thinking ? { thinking: thinking.thinking } : {}),
    };
  }

  /**
   * Spread-friendly `system` fragment. Returns an empty object when no
   * system prompt was hoisted out of the messages.
   *
   * When a per-call `cacheControl.breakpoints` hint is present (≥ 1),
   * the system prompt is emitted as a single `TextBlockParam` carrying
   * `cache_control: ephemeral` — the system prompt is the longest stable
   * prefix on a turn, so one breakpoint there lets multi-turn agents
   * read it back at the ~0.1x cache-read rate. Without the hint the
   * system prompt stays a plain string (left uncached) so a one-shot
   * call never pays the ~1.25x cache-write surcharge.
   */
  private buildSystem(
    system: string | undefined,
    cacheControl: ModelCallOptions["cacheControl"],
  ): { system?: string | Anthropic.TextBlockParam[] } {
    if (!system) {
      return {};
    }

    const breakpoints = cacheControl?.breakpoints ?? 0;

    if (this.capabilities.promptCaching && breakpoints > 0) {
      return {
        system: [
          { type: "text", text: system, cache_control: this.cacheControl(cacheControl?.ttl) },
        ],
      };
    }

    return { system };
  }

  /**
   * Let Anthropic select the last cacheable block when caching is enabled
   * without a caller-selected breakpoint. An explicit breakpoint remains
   * authoritative, so the request-level form is deliberately omitted then.
   */
  private buildAutomaticCacheControl(cacheControl: ModelCallOptions["cacheControl"]): {
    cache_control?: Anthropic.CacheControlEphemeral;
  } {
    const breakpoints = cacheControl?.breakpoints ?? 0;

    return this.config.promptCaching && breakpoints <= 0
      ? { cache_control: this.cacheControl(cacheControl?.ttl) }
      : {};
  }

  /**
   * Build a typed cache-control marker. The per-call
   * `cacheControl.ttl` wins over the model's `promptCacheTtl`; with
   * neither, TTL is omitted for Anthropic's 5-minute default.
   */
  private cacheControl(callTtl?: "5m" | "1h"): Anthropic.CacheControlEphemeral {
    const ttl = callTtl ?? this.config.promptCacheTtl;

    return {
      type: "ephemeral",
      ...(ttl ? { ttl } : {}),
    };
  }

  /**
   * Translate the neutral `reasoning` option into Anthropic's thinking
   * settings, in the shape this model accepts (`thinkingMode`). Emitted
   * only when the model declares the `reasoning` capability AND a
   * reasoning option is supplied; otherwise returns an empty object.
   *
   * - Adaptive mode (Opus 4.7+, Sonnet 5+, Fable 5+, unknown ids):
   *   `thinking: { type: "adaptive" }` (installed SDK
   *   `ThinkingConfigAdaptive`, `messages.d.ts:1065`) plus
   *   `output_config.effort` from the neutral effort, defaulting to
   *   `"medium"`. `budget_tokens` is never sent — these models 400 on it
   *   (claude-api ref). `reasoning.maxTokens` only sizes the default
   *   `max_tokens` headroom.
   * - Budget mode (Haiku 4.5, Opus/Sonnet 4.6, older):
   *   `thinking: { type: "enabled", budget_tokens }`. An explicit
   *   `reasoning.maxTokens` wins; otherwise the effort maps to a tiered
   *   budget. `budget_tokens` must be ≥ 1024 (`ThinkingConfigEnabled`,
   *   `messages.d.ts:1084`), so the budget is floored at that minimum.
   *
   * The neutral `effort: "none"` ("run without reasoning") is mapped per
   * model:
   * - Claude Sonnet 5.5 (`acceptsBetweenTools`): `thinking: { type:
   *   "between_tools" }`, its only thinking-off form. It is sent alone —
   *   no `output_config.effort` (the model default, `high`, is within the
   *   `high`-or-below range it requires) and no `display`, both of which
   *   the API rejects alongside it.
   * - Opus 5.5 and Fable 5/5.1: no `thinking` field. These models have no
   *   thinking-off form (`disabled` and `budget_tokens` are a 400 at every
   *   effort), so thinking still runs at the model's default effort. Pass
   *   `effort: "low"` to spend less.
   * - Every other model: no `thinking` field, as before.
   */
  private buildThinking(reasoning: ModelCallOptions["reasoning"]): ThinkingRequest {
    if (!this.capabilities.reasoning || !reasoning) {
      return {};
    }

    // `effort: "none"` is an explicit "run without reasoning". Sonnet 5.5
    // turns thinking off only through `between_tools`; elsewhere we omit
    // the `thinking` block. (This also short-circuits the
    // `EFFORT_THINKING_BUDGET["none"]` → `undefined` → `NaN` budget path.)
    if (reasoning.effort === "none") {
      return acceptsBetweenTools(this.name) ? { thinking: { type: "between_tools" } } : {};
    }

    if (reasoning.maxTokens === undefined && reasoning.effort === undefined) {
      return {};
    }

    const effort = reasoning.effort ?? DEFAULT_THINKING_EFFORT;
    const budget = Math.max(
      MIN_THINKING_BUDGET,
      reasoning.maxTokens ?? EFFORT_THINKING_BUDGET[effort],
    );

    if (this.thinkingMode === "adaptive") {
      return {
        thinking: { type: "adaptive" },
        effort: EFFORT_TO_OUTPUT_EFFORT[effort],
        reservedTokens: budget,
      };
    }

    return {
      thinking: { type: "enabled", budget_tokens: budget },
      reservedTokens: budget,
    };
  }

  /**
   * Spread-friendly tools fragment. Returns an empty object when no
   * tools were supplied so the caller can unconditionally spread it.
   *
   * When `config.promptCaching` is on, marks the LAST tool with
   * `cache_control: ephemeral` — Anthropic caches the whole prefix up
   * to a breakpoint, and tools sit before `system` in that prefix, so
   * one breakpoint on the final tool caches every tool definition.
   * Reads bill at ~0.1x after the first write. The system prompt is
   * deliberately left uncached: it carries per-turn placeholders, so a
   * breakpoint there would pay the ~1.25x write surcharge every turn
   * with no reads.
   */
  private buildTools(
    tools: ModelCallOptions["tools"],
    cacheControl: ModelCallOptions["cacheControl"],
  ): { tools?: Anthropic.Tool[] } {
    const mapped = toAnthropicTools(tools);

    if (!mapped) {
      return {};
    }

    if (this.config.promptCaching && mapped.length > 0) {
      const last = mapped.length - 1;
      const lastTool = mapped[last];

      if (lastTool) {
        mapped[last] = { ...lastTool, cache_control: this.cacheControl(cacheControl?.ttl) };
      }
    }

    return { tools: mapped };
  }

  /**
   * Spread-friendly `output_config` fragment carrying both the native
   * structured-output `format` and the adaptive-thinking `effort`, merged
   * into one object (both live under `OutputConfig`, installed SDK
   * `messages.d.ts:796-806`). Returns an empty object when neither applies,
   * so budget-mode requests carry `output_config` only when a schema asks
   * for it.
   */
  private buildOutputConfig(
    responseSchema: Record<string, unknown> | undefined,
    effort: Anthropic.OutputConfig["effort"],
  ): { output_config?: Anthropic.OutputConfig } {
    const format = this.buildStructuredOutputFormat(responseSchema);

    if (!format && !effort) {
      return {};
    }

    return {
      output_config: {
        ...(format ? { format } : {}),
        ...(effort ? { effort } : {}),
      },
    };
  }

  /**
   * Translate the neutral `responseSchema` option into Anthropic's
   * native `output_config.format` (JSON-schema structured outputs).
   *
   * Only returned when the model declares the `structuredOutput`
   * capability AND the schema is a proper root-object JSON Schema —
   * Anthropic rejects non-object roots. When the capability is off
   * (config override) or the schema is non-object, returns `undefined`:
   * the agent has already injected a soft schema hint into the system
   * prompt as the fallback, and client-side `validate()` still enforces
   * shape.
   */
  private buildStructuredOutputFormat(
    responseSchema: Record<string, unknown> | undefined,
  ): Anthropic.JSONOutputFormat | undefined {
    if (!responseSchema || !this.capabilities.structuredOutput) {
      return undefined;
    }

    if (responseSchema.type !== "object" || typeof responseSchema.properties !== "object") {
      return undefined;
    }

    return { type: "json_schema", schema: responseSchema };
  }

  /**
   * Concatenate every `text` content block into the single neutral
   * `content` string. `tool_use` and other block types are ignored
   * here — tool calls are surfaced separately via `extractToolCalls`.
   */
  private extractText(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  /**
   * Reshape Anthropic's `tool_use` content blocks into the neutral
   * `ModelToolCallRequest[]`. Returns `undefined` when the model
   * requested no tools so callers can branch on presence.
   */
  private extractToolCalls(content: Anthropic.ContentBlock[]): ModelToolCallRequest[] | undefined {
    const toolUses = content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      return undefined;
    }

    const thinkingMetadata = this.buildThinkingMetadata(content);

    return toolUses.map((block) => ({
      id: block.id,
      name: block.name,
      input: (block.input ?? {}) as Record<string, unknown>,
      ...thinkingMetadata,
    }));
  }

  /**
   * Preserve Anthropic's opaque extended-thinking blocks beside a tool
   * request so the next assistant turn can replay their signatures exactly.
   */
  private buildThinkingMetadata(blocks: Iterable<Anthropic.ContentBlock>): {
    providerMetadata?: Record<string, unknown>;
  } {
    const thinkingBlocks = Array.from(blocks).filter(
      (block): block is AnthropicThinkingBlock =>
        block.type === "thinking" || block.type === "redacted_thinking",
    );

    if (thinkingBlocks.length === 0) {
      return {};
    }

    return { providerMetadata: { anthropic: { thinkingBlocks } } };
  }

  /**
   * Normalize Anthropic's `usage` block into the neutral `Usage` shape.
   * Anthropic reports `input_tokens` / `output_tokens` separately with
   * no pre-summed total, so `total` is computed. Cache-read tokens are
   * surfaced as `cachedTokens` and cache-write tokens as
   * `cacheWriteTokens`, each only when non-zero. Anthropic also reports
   * `output_tokens_details.thinking_tokens` as the reasoning subset of
   * its inclusive `output_tokens`; it is surfaced as `reasoningTokens`
   * when present, without changing the billing total.
   */
  private extractUsage(raw: Anthropic.Usage): Usage {
    const input = raw.input_tokens ?? 0;
    const output = raw.output_tokens ?? 0;
    const cacheRead = raw.cache_read_input_tokens;
    const cacheWrite = raw.cache_creation_input_tokens;
    const thinkingTokens = raw.output_tokens_details?.thinking_tokens;

    return {
      input,
      output,
      total: input + output,
      ...(cacheRead !== null && cacheRead !== undefined && cacheRead > 0
        ? { cachedTokens: cacheRead }
        : {}),
      ...(cacheWrite !== null && cacheWrite !== undefined && cacheWrite > 0
        ? { cacheWriteTokens: cacheWrite }
        : {}),
      ...(thinkingTokens !== null && thinkingTokens !== undefined
        ? { reasoningTokens: thinkingTokens }
        : {}),
    };
  }

  /**
   * Wrap a thrown provider error into the typed `AIError` hierarchy and
   * emit the standard error log line before it propagates. Shared by
   * every catch site so the log shape stays identical.
   */
  private logAndWrap(thrown: unknown) {
    const wrapped = wrapAnthropicError(thrown);

    this.logger.error(LOG_MODULE, "error", wrapped.message, {
      code: wrapped.code,
      context: wrapped.context,
    });

    return wrapped;
  }
}

/**
 * Request fields `providerOptions.anthropic.body` may not set: they carry
 * the conversation, the model and the tool surface the agent registered,
 * so an override would silently replace the agent's input (or let the
 * model call tools the agent never registered). `stream` is chosen per
 * call by `complete()` / `stream()`.
 */
const RESERVED_BODY_FIELDS: ReadonlySet<string> = new Set([
  "model",
  "messages",
  "system",
  "tools",
  "mcp_servers",
  "stream",
]);

/** Body fields `messages.countTokens` accepts, copied from the full request body. */
const COUNT_TOKENS_FIELDS = [
  "model",
  "messages",
  "system",
  "tools",
  "tool_choice",
  "thinking",
  "output_config",
  "cache_control",
  "context_management",
  "mcp_servers",
] as const;

/** Read `providerOptions.anthropic`, tolerating its absence or a wrong shape. */
function resolveAnthropicOptions(options: ModelCallOptions | undefined): AnthropicCallOptions {
  const raw = options?.providerOptions?.anthropic;

  return typeof raw === "object" && raw !== null ? (raw as AnthropicCallOptions) : {};
}
