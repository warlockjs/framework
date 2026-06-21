import {
  safeJsonParse,
  type Message,
  type ModelCallOptions,
  type ModelCapabilities,
  type ModelContract,
  type ModelPricing,
  type ModelResponse,
  type ModelStreamChunk,
  type ModelToolCallRequest,
  type Usage,
} from "@warlock.js/ai";
import { log, type Logger } from "@warlock.js/logger";
import {
  ConverseCommand,
  ConverseStreamCommand,
  type BedrockRuntimeClient,
  type ContentBlock,
  type ConverseRequest,
  type TokenUsage,
} from "@aws-sdk/client-bedrock-runtime";
import type { BedrockModelConfig } from "./config.type";
import {
  inferPdfCapability,
  inferPromptCachingCapability,
  inferReasoningCapability,
} from "./known-capabilities";
import { inferVisionCapability } from "./known-vision-models";
import { mapStopReason, toBedrockMessages, toBedrockToolConfig, wrapBedrockError } from "./utils";

const LOG_MODULE = "ai.bedrock";

/**
 * Conventional extended-thinking token budgets for the neutral
 * `reasoning.effort` levels, used when the caller asks for an effort
 * tier without naming an explicit `reasoning.maxTokens` budget. Mirrors
 * the low / medium / high spread other reasoning adapters expose so the
 * vendor-neutral option behaves consistently across providers.
 */
const EFFORT_THINKING_BUDGET: Record<string, number | undefined> = {
  low: 1024,
  medium: 4096,
  high: 16384,
};

/**
 * Bedrock-backed implementation of `ModelContract`.
 *
 * **Role.** The provider-facing bridge between the vendor-neutral
 * `@warlock.js/ai` agent runtime and AWS Bedrock's Converse /
 * ConverseStream API. Converse is the model-agnostic surface — one
 * wire mapping covers every Bedrock-hosted family (Anthropic Claude,
 * Amazon Nova, Meta Llama, Mistral, Cohere) instead of per-family
 * `InvokeModel` body shapes.
 *
 * **Responsibility.**
 * - Owns: a long-lived `BedrockRuntimeClient` + frozen `ModelConfig`
 *   (modelId, temperature, maxTokens) used as per-call defaults.
 * - Owns: translating vendor-neutral `Message[]` / `ToolConfig[]` into
 *   Converse shapes (system hoisting, `toolUse` / `toolResult` blocks,
 *   image bytes) on the way out, and Converse's content-block response
 *   (text, tool calls, stop reason, token usage) back into the neutral
 *   shapes on the way in.
 * - Does NOT own: dispatching tools, looping, history, retries — those
 *   are agent concerns. The model is a per-call protocol adapter.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across calls"): the AWS client is heavy to construct and reused for
 * the SDK's lifetime.
 *
 * @example
 * import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
 * const client = new BedrockRuntimeClient({ region: "us-east-1" });
 * const model = new BedrockModel(client, {
 *   name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
 * });
 *
 * const myAgent = agent({ model, tools: [searchTool] });
 * const result = await myAgent.execute("Summarize today's news.");
 */
export class BedrockModel implements ModelContract {
  public readonly name: string;
  public readonly provider: string;
  public readonly capabilities: ModelCapabilities;
  public readonly pricing?: ModelPricing;

  private readonly client: BedrockRuntimeClient;
  private readonly config: BedrockModelConfig;
  private readonly logger: Logger = log;

  public constructor(
    client: BedrockRuntimeClient,
    config: BedrockModelConfig,
    provider: string = "bedrock",
  ) {
    this.client = client;
    this.config = config;
    this.name = config.name;
    this.provider = provider;
    this.pricing = config.pricing;
    this.capabilities = {
      structuredOutput: config.structuredOutput ?? true,
      vision: config.vision ?? inferVisionCapability(config.name),
      reasoning: config.reasoning ?? inferReasoningCapability(config.name),
      promptCaching: config.promptCaching ?? inferPromptCachingCapability(config.name),
      pdf: config.pdf ?? inferPdfCapability(config.name),
      audio: config.audio ?? false,
    };
  }

  /**
   * Single-shot completion via the Converse API. Sends the full
   * message list, waits for the terminal response, and reshapes it
   * into a vendor-neutral `ModelResponse`. Per-call `options` override
   * the instance defaults for this call only.
   */
  public async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
    this.logger.debug(LOG_MODULE, "request", "Starting Converse call", {
      model: this.name,
      messageCount: messages.length,
      streaming: false,
      toolCount: options?.tools?.length ?? 0,
    });

    let response;

    try {
      response = await this.client.send(
        new ConverseCommand(this.buildRequest(messages, options)),
        options?.signal ? { abortSignal: options.signal } : undefined,
      );
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const blocks = response.output?.message?.content ?? [];
    const finishReason = mapStopReason(response.stopReason);
    const usage = this.extractUsage(response.usage);
    const toolCalls = this.extractToolCalls(blocks);

    this.logger.debug(LOG_MODULE, "response", "Converse call succeeded", { finishReason, usage });

    return {
      content: this.extractText(blocks),
      finishReason,
      usage,
      toolCalls,
    };
  }

  /**
   * Incremental streaming completion via ConverseStream. Yields neutral
   * `ModelStreamChunk`s — `delta` for text, `tool-call` once a
   * `toolUse` block's accumulated input JSON is complete, and a
   * terminal `done` with the final finish reason + usage totals.
   */
  public async *stream(
    messages: Message[],
    options?: ModelCallOptions,
  ): AsyncIterable<ModelStreamChunk> {
    this.logger.debug(LOG_MODULE, "request", "Starting ConverseStream call", {
      model: this.name,
      messageCount: messages.length,
      streaming: true,
      toolCount: options?.tools?.length ?? 0,
    });

    let response;

    try {
      response = await this.client.send(
        new ConverseStreamCommand(this.buildRequest(messages, options)),
        options?.signal ? { abortSignal: options.signal } : undefined,
      );
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    let rawStopReason: string | undefined;
    const usage: Usage = { input: 0, output: 0, total: 0 };
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

    try {
      for await (const event of response.stream ?? []) {
        if (event.contentBlockStart?.start?.toolUse) {
          const start = event.contentBlockStart.start.toolUse;

          toolBlocks.set(event.contentBlockStart.contentBlockIndex ?? 0, {
            id: start.toolUseId ?? "",
            name: start.name ?? "",
            json: "",
          });

          continue;
        }

        if (event.contentBlockDelta?.delta) {
          const delta = event.contentBlockDelta.delta;

          if (delta.text) {
            yield { type: "delta", content: delta.text };
          } else if (delta.toolUse) {
            const accumulator = toolBlocks.get(event.contentBlockDelta.contentBlockIndex ?? 0);

            if (accumulator) {
              accumulator.json += delta.toolUse.input ?? "";
            }
          }

          continue;
        }

        if (event.contentBlockStop) {
          const accumulator = toolBlocks.get(event.contentBlockStop.contentBlockIndex ?? 0);

          if (accumulator) {
            yield {
              type: "tool-call",
              id: accumulator.id,
              name: accumulator.name,
              input: safeJsonParse<Record<string, unknown>>(accumulator.json, {}),
            };

            toolBlocks.delete(event.contentBlockStop.contentBlockIndex ?? 0);
          }

          continue;
        }

        if (event.messageStop) {
          rawStopReason = event.messageStop.stopReason;
        }

        if (event.metadata?.usage) {
          const raw = event.metadata.usage;

          usage.input = raw.inputTokens ?? 0;
          usage.output = raw.outputTokens ?? 0;
          usage.total = raw.totalTokens ?? usage.input + usage.output;

          if (raw.cacheReadInputTokens && raw.cacheReadInputTokens > 0) {
            usage.cachedTokens = raw.cacheReadInputTokens;
          }

          if (raw.cacheWriteInputTokens && raw.cacheWriteInputTokens > 0) {
            usage.cacheWriteTokens = raw.cacheWriteInputTokens;
          }
        }
      }
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const finishReason = mapStopReason(rawStopReason);

    this.logger.debug(LOG_MODULE, "response", "ConverseStream call succeeded", {
      finishReason,
      usage,
    });

    yield { type: "done", finishReason, usage };
  }

  /**
   * Assemble the Converse request shared by `complete()` and
   * `stream()` (both command shapes take the same input). Hoists the
   * system prompt, maps inference params, and conditionally attaches
   * tools and native structured output.
   */
  private buildRequest(
    messages: Message[],
    options: ModelCallOptions | undefined,
  ): ConverseRequest {
    const { system, messages: bedrockMessages } = toBedrockMessages(messages);
    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    const temperature = options?.temperature ?? this.config.temperature;
    const cachedMessages = this.applyCacheBreakpoints(bedrockMessages, options?.cacheControl);

    return {
      modelId: this.name,
      messages: cachedMessages,
      ...(system ? { system } : {}),
      inferenceConfig: {
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      },
      ...this.buildToolConfig(options?.tools),
      ...this.buildOutputConfig(options?.responseSchema),
      ...this.buildReasoningConfig(options?.reasoning),
    };
  }

  /**
   * Append a Converse `cachePoint` block to the LAST message when the
   * caller supplies a `cacheControl` write breakpoint and the model is
   * `promptCaching`-capable. A cache point tells Bedrock to cache the
   * whole prefix up to that block, so subsequent calls reusing the same
   * prefix bill the cached portion at the discounted read rate
   * (surfaced as `Usage.cachedTokens`). No-ops gracefully when caching
   * is unsupported, no breakpoint was requested, or there are no
   * messages to mark — Bedrock then prices the call normally.
   *
   * Bedrock only honors `CachePointType.DEFAULT`; the neutral
   * `breakpoints` count is a presence hint (one trailing breakpoint is
   * the only placement Converse supports without manual block surgery),
   * so any positive value marks the trailing message.
   */
  private applyCacheBreakpoints(
    messages: ConverseRequest["messages"],
    cacheControl: ModelCallOptions["cacheControl"],
  ): ConverseRequest["messages"] {
    const breakpoints = cacheControl?.breakpoints ?? 0;

    if (!this.capabilities.promptCaching || breakpoints <= 0 || !messages || messages.length === 0) {
      return messages;
    }

    const last = messages.length - 1;
    const lastMessage = messages[last];

    return [
      ...messages.slice(0, last),
      {
        ...lastMessage,
        content: [...(lastMessage.content ?? []), { cachePoint: { type: "default" } }],
      },
    ];
  }

  /**
   * Translate the neutral `reasoning` option into Claude-on-Bedrock's
   * extended-thinking control, carried in Converse's escape hatch
   * `additionalModelRequestFields.thinking`. Emitted only when the model
   * is `reasoning`-capable and a budget can be resolved — `maxTokens`
   * (explicit thinking budget) wins, otherwise `effort` maps to a
   * conventional token budget so callers can opt in without picking a
   * number. Returns an empty object (no-op) for non-reasoning models or
   * when no reasoning option was supplied, so unsupported params never
   * reach the wire.
   */
  private buildReasoningConfig(
    reasoning: ModelCallOptions["reasoning"],
  ): Pick<ConverseRequest, "additionalModelRequestFields"> {
    if (!this.capabilities.reasoning || !reasoning) {
      return {};
    }

    const budgetTokens = reasoning.maxTokens ?? EFFORT_THINKING_BUDGET[reasoning.effort ?? ""];

    if (budgetTokens === undefined) {
      return {};
    }

    return {
      additionalModelRequestFields: {
        thinking: { type: "enabled", budget_tokens: budgetTokens },
      },
    };
  }

  /**
   * Spread-friendly tool fragment. Returns an empty object when no
   * tools were supplied (Bedrock rejects an empty `tools` array).
   */
  private buildToolConfig(tools: ModelCallOptions["tools"]): Pick<ConverseRequest, "toolConfig"> {
    const toolConfig = toBedrockToolConfig(tools);

    return toolConfig ? { toolConfig } : {};
  }

  /**
   * Translate the neutral `responseSchema` into Converse's native
   * `outputConfig.textFormat` (JSON-schema structured output). Bedrock
   * requires the schema as a stringified JSON document and only
   * accepts an object root. Emitted only when the model is
   * `structuredOutput`-capable and the schema is an object — otherwise
   * the agent's soft system-prompt hint + client-side `validate()`
   * carry shape (same degradation philosophy as the OpenAI adapter).
   */
  private buildOutputConfig(
    responseSchema: Record<string, unknown> | undefined,
  ): Pick<ConverseRequest, "outputConfig"> {
    if (!responseSchema || !this.capabilities.structuredOutput) {
      return {};
    }

    if (responseSchema.type !== "object" || typeof responseSchema.properties !== "object") {
      return {};
    }

    return {
      outputConfig: {
        textFormat: {
          type: "json_schema",
          structure: {
            jsonSchema: { name: "response", schema: JSON.stringify(responseSchema) },
          },
        },
      },
    };
  }

  /**
   * Concatenate every `text` content block into the single neutral
   * `content` string. `toolUse` and other block types are surfaced
   * separately via `extractToolCalls`.
   */
  private extractText(blocks: ContentBlock[]): string {
    return blocks
      .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
      .join("");
  }

  /**
   * Reshape Converse `toolUse` content blocks into the neutral
   * `ModelToolCallRequest[]`. Returns `undefined` when no tools were
   * requested so callers can branch on presence.
   */
  private extractToolCalls(blocks: ContentBlock[]): ModelToolCallRequest[] | undefined {
    const toolCalls: ModelToolCallRequest[] = [];

    for (const block of blocks) {
      if ("toolUse" in block && block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId ?? "",
          name: block.toolUse.name ?? "",
          input: (block.toolUse.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return toolCalls.length > 0 ? toolCalls : undefined;
  }

  /**
   * Normalize Converse's `TokenUsage` into the neutral `Usage` shape.
   * Bedrock supplies a pre-summed `totalTokens`; cache-read and
   * cache-write tokens are surfaced as `cachedTokens` /
   * `cacheWriteTokens` only when non-zero so callers can price the
   * discounted read rate and the one-time write cost separately.
   * Bedrock's Converse `TokenUsage` carries no reasoning-token channel,
   * so `Usage.reasoningTokens` is intentionally left unset here.
   */
  private extractUsage(raw: TokenUsage | undefined): Usage {
    if (!raw) {
      return { input: 0, output: 0, total: 0 };
    }

    const input = raw.inputTokens ?? 0;
    const output = raw.outputTokens ?? 0;
    const cached = raw.cacheReadInputTokens;
    const cacheWrite = raw.cacheWriteInputTokens;

    return {
      input,
      output,
      total: raw.totalTokens ?? input + output,
      ...(cached && cached > 0 ? { cachedTokens: cached } : {}),
      ...(cacheWrite && cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    };
  }

  /**
   * Wrap a thrown provider error into the typed `AIError` hierarchy
   * and emit the standard error log line before it propagates. Shared
   * by every catch site so the log shape stays identical.
   */
  private logAndWrap(thrown: unknown) {
    const wrapped = wrapBedrockError(thrown);

    this.logger.error(LOG_MODULE, "error", wrapped.message, {
      code: wrapped.code,
      context: wrapped.context,
    });

    return wrapped;
  }
}
