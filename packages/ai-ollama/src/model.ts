import {
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
import type {
  AbortableAsyncIterator,
  ChatRequest,
  ChatResponse,
  Ollama,
  Options,
} from "ollama";
import type { OllamaModelConfig } from "./config.type";
import { inferReasoningCapability } from "./known-reasoning-models";
import { inferVisionCapability } from "./known-vision-models";
import { mapDoneReason, toOllamaMessages, toOllamaTools, wrapOllamaError } from "./utils";

const LOG_MODULE = "ai.ollama";

/**
 * Ollama-backed implementation of `ModelContract`.
 *
 * **Role.** The provider-facing bridge between the vendor-neutral
 * `@warlock.js/ai` agent runtime and a local (or self-hosted) Ollama
 * server via the official `ollama` client.
 *
 * **Responsibility.**
 * - Owns: a long-lived `Ollama` client + frozen `ModelConfig` (model
 *   tag, temperature, maxTokens) used as per-call defaults.
 * - Owns: translating vendor-neutral `Message[]` / `ToolConfig[]` into
 *   Ollama's chat shapes (system stays a real role, `tool_calls` /
 *   `tool_name`, base64 `images`) and Ollama's response (content, tool
 *   calls, done reason, eval-count usage) back into neutral shapes.
 * - Does NOT own: tool dispatch, looping, history, retries — agent
 *   concerns. The model is a per-call protocol adapter.
 *
 * **Tool-call ids.** Ollama has no tool-call id concept — a `tool_call`
 * is `{ function: { name, arguments } }`. The adapter synthesizes the
 * neutral `id` from the tool name so the agent's tool-result round-trip
 * (which keys on `toolCallId`) maps back to Ollama's name-based
 * matching. Parallel calls to the *same* tool in one turn therefore
 * share an id — a documented v1 limitation inherent to Ollama's wire
 * format, not this adapter.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across calls").
 *
 * @example
 * import { Ollama } from "ollama";
 * const client = new Ollama({ host: "http://127.0.0.1:11434" });
 * const model = new OllamaModel(client, { name: "llama3.1" });
 *
 * const myAgent = agent({ model, tools: [searchTool] });
 * const result = await myAgent.execute("Summarize today's news.");
 */
export class OllamaModel implements ModelContract {
  public readonly name: string;
  public readonly provider: string;
  public readonly capabilities: ModelCapabilities;
  public readonly pricing?: ModelPricing;

  private readonly client: Ollama;
  private readonly config: OllamaModelConfig;
  private readonly logger: Logger = log;

  public constructor(client: Ollama, config: OllamaModelConfig, provider: string = "ollama") {
    this.client = client;
    this.config = config;
    this.name = config.name;
    this.provider = provider;
    this.pricing = config.pricing;
    this.capabilities = {
      structuredOutput: config.structuredOutput ?? true,
      vision: config.vision ?? inferVisionCapability(config.name),
      // Thinking-capable families (deepseek-r1, qwq, qwen3, …) honor the
      // `think` request flag; plain instruct models do not. Explicit
      // config wins over the family-substring inference.
      reasoning: config.reasoning ?? inferReasoningCapability(config.name),
      // Ollama has no provider-side prompt cache and the chat API takes
      // no audio / PDF content parts — report these truthfully as false
      // so the agent rejects unsupported attachments / cache hints
      // upfront instead of silently dropping them at the wire.
      promptCaching: false,
      audio: false,
      pdf: false,
    };
  }

  /**
   * Single-shot completion. Sends the full message list to
   * `client.chat`, waits for the terminal response, and reshapes it
   * into a vendor-neutral `ModelResponse`. Per-call `options` override
   * the instance defaults for this call only.
   */
  public async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
    this.logger.debug(LOG_MODULE, "request", "Starting chat call", {
      model: this.name,
      messageCount: messages.length,
      streaming: false,
      toolCount: options?.tools?.length ?? 0,
    });

    let response: ChatResponse;

    try {
      response = await this.client.chat({ ...this.buildRequest(messages, options), stream: false });
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const toolCalls = this.extractToolCalls(response.message);
    const finishReason = toolCalls ? "tool_calls" : mapDoneReason(response.done_reason);
    const usage = this.extractUsage(response);

    this.logger.debug(LOG_MODULE, "response", "chat call succeeded", { finishReason, usage });

    return {
      content: response.message?.content ?? "",
      finishReason,
      usage,
      toolCalls,
    };
  }

  /**
   * Incremental streaming completion. Yields neutral
   * `ModelStreamChunk`s — `delta` for content, `tool-call` per
   * function call (Ollama streams a fully-formed call, not partial
   * JSON), and a terminal `done` with the final finish reason + usage.
   * Honors `options.signal` by aborting the underlying stream.
   */
  public async *stream(
    messages: Message[],
    options?: ModelCallOptions,
  ): AsyncIterable<ModelStreamChunk> {
    this.logger.debug(LOG_MODULE, "request", "Starting streaming chat call", {
      model: this.name,
      messageCount: messages.length,
      streaming: true,
      toolCount: options?.tools?.length ?? 0,
    });

    let stream: AbortableAsyncIterator<ChatResponse>;

    try {
      stream = await this.client.chat({ ...this.buildRequest(messages, options), stream: true });
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    if (options?.signal) {
      if (options.signal.aborted) {
        stream.abort();
      } else {
        options.signal.addEventListener("abort", () => stream.abort(), { once: true });
      }
    }

    let rawDoneReason: string | undefined;
    let sawToolCall = false;
    const usage: Usage = { input: 0, output: 0, total: 0 };

    try {
      for await (const chunk of stream) {
        const content = chunk.message?.content;

        if (content) {
          yield { type: "delta", content };
        }

        for (const call of chunk.message?.tool_calls ?? []) {
          sawToolCall = true;

          yield {
            type: "tool-call",
            id: call.function.name,
            name: call.function.name,
            input: (call.function.arguments ?? {}) as Record<string, unknown>,
          };
        }

        if (chunk.done_reason) {
          rawDoneReason = chunk.done_reason;
        }

        if (chunk.done) {
          usage.input = chunk.prompt_eval_count ?? usage.input;
          usage.output = chunk.eval_count ?? usage.output;
          usage.total = usage.input + usage.output;
        }
      }
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const finishReason = sawToolCall ? "tool_calls" : mapDoneReason(rawDoneReason);

    this.logger.debug(LOG_MODULE, "response", "streaming chat call succeeded", {
      finishReason,
      usage,
    });

    yield { type: "done", finishReason, usage };
  }

  /**
   * Assemble the Ollama chat request shared by `complete()` and
   * `stream()` (each adds its own `stream` literal so the client's
   * overload resolves). Maps inference params into Ollama `options`
   * and conditionally attaches tools + native structured output.
   */
  private buildRequest(
    messages: Message[],
    options: ModelCallOptions | undefined,
  ): Omit<ChatRequest, "stream"> {
    const temperature = options?.temperature ?? this.config.temperature;
    const maxTokens = options?.maxTokens ?? this.config.maxTokens;

    const ollamaOptions: Partial<Options> = {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { num_predict: maxTokens } : {}),
    };

    return {
      model: this.name,
      messages: toOllamaMessages(messages),
      ...(Object.keys(ollamaOptions).length > 0 ? { options: ollamaOptions } : {}),
      ...this.buildTools(options?.tools),
      ...this.buildFormat(options?.responseSchema),
      ...this.buildThink(options?.reasoning),
    };
  }

  /**
   * Translate the neutral `reasoning` hint into Ollama's `think`
   * request flag. Ollama's `think` accepts `boolean | 'low' | 'medium'
   * | 'high'`, so the neutral `ReasoningEffort` literals pass straight
   * through; an effort-less `reasoning` (only `maxTokens`, or an empty
   * object) becomes `think: true` to switch the channel on.
   *
   * No-ops unless the model is reasoning-capable, so the `think` flag is
   * never sent to a plain instruct model that cannot honor it.
   *
   * `reasoning.maxTokens` (the thinking-budget hint) has no Ollama
   * equivalent — the daemon does not accept a thinking-token cap — so it
   * is honored only as the on/off signal above and otherwise ignored.
   * `ModelCallOptions.cacheControl` is likewise a no-op: Ollama has no
   * provider prompt cache, so there is no cache breakpoint to place.
   */
  private buildThink(
    reasoning: ModelCallOptions["reasoning"],
  ): Pick<ChatRequest, "think"> {
    if (!reasoning || !this.capabilities.reasoning) {
      return {};
    }

    return { think: reasoning.effort ?? true };
  }

  /**
   * Spread-friendly tools fragment. Empty object when no tools were
   * supplied so the caller can unconditionally spread it.
   */
  private buildTools(tools: ModelCallOptions["tools"]): Pick<ChatRequest, "tools"> {
    const mapped = toOllamaTools(tools);

    return mapped ? { tools: mapped } : {};
  }

  /**
   * Translate the neutral `responseSchema` into Ollama's native
   * structured output (`format` accepts a JSON Schema object).
   * Emitted only when the model is `structuredOutput`-capable and the
   * schema is an object root — otherwise the agent's soft prompt hint
   * + client-side `validate()` carry shape.
   */
  private buildFormat(
    responseSchema: Record<string, unknown> | undefined,
  ): Pick<ChatRequest, "format"> {
    if (!responseSchema || !this.capabilities.structuredOutput) {
      return {};
    }

    if (responseSchema.type !== "object" || typeof responseSchema.properties !== "object") {
      return {};
    }

    return { format: responseSchema };
  }

  /**
   * Reshape Ollama's `message.tool_calls` into the neutral
   * `ModelToolCallRequest[]`. Ollama has no tool-call id, so the
   * neutral `id` is synthesized from the tool name (see the class
   * doc). Returns `undefined` when no tools were requested.
   */
  private extractToolCalls(
    message: ChatResponse["message"] | undefined,
  ): ModelToolCallRequest[] | undefined {
    const calls = message?.tool_calls;

    if (!calls || calls.length === 0) {
      return undefined;
    }

    return calls.map((call) => ({
      id: call.function.name,
      name: call.function.name,
      input: (call.function.arguments ?? {}) as Record<string, unknown>,
    }));
  }

  /**
   * Normalize Ollama's eval counts into the neutral `Usage` shape.
   *
   * Cost-truth: Ollama reports only `prompt_eval_count` (input) and
   * `eval_count` (output). It has **no** provider prompt cache, so
   * `Usage.cachedTokens` / `Usage.cacheWriteTokens` stay undefined
   * (honest absence, not a false zero). Reasoning models emit their
   * thinking as the `message.thinking` *string* but the wire format
   * carries **no separate reasoning-token count** — the thinking tokens
   * are already folded into `eval_count`. We therefore do not fabricate
   * a `Usage.reasoningTokens` from the text length; it is left undefined
   * unless/until the daemon exposes a real count. `total` is input +
   * output.
   */
  private extractUsage(response: ChatResponse): Usage {
    const input = response.prompt_eval_count ?? 0;
    const output = response.eval_count ?? 0;

    return { input, output, total: input + output };
  }

  /**
   * Wrap a thrown provider error into the typed `AIError` hierarchy
   * and emit the standard error log line before it propagates.
   */
  private logAndWrap(thrown: unknown) {
    const wrapped = wrapOllamaError(thrown);

    this.logger.error(LOG_MODULE, "error", wrapped.message, {
      code: wrapped.code,
      context: wrapped.context,
    });

    return wrapped;
  }
}
