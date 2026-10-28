import {
  InvalidRequestError,
  ProviderError,
  resolveStreamChunks,
  safeJsonParse,
  selectProviderTools,
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
import { assertHostedSearchSupported, requestsHostedSearch } from "./native-search";
import { OpenAIResponsesModel } from "./responses-model";
import type OpenAI from "openai";
import { compatibleSearchParams, mergeProviderBody } from "./provider-options";
import type { OpenAIModelConfig } from "./config.type";
import { inferReasoningCapability } from "./known-reasoning-models";
import { inferVisionCapability } from "./known-vision-models";
import {
  buildPromptCacheParams,
  buildUsage,
  inferStructuredOutput,
  mapFinishReason,
  planStructuredOutput,
  toOpenAIMessages,
  toOpenAIReasoningEffort,
  toOpenAITools,
  wrapOpenAIError,
} from "./utils";

const LOG_MODULE = "ai.openai";

/**
 * OpenAI-backed implementation of `ModelContract`.
 *
 * **Role.** The provider-facing bridge between the vendor-neutral
 * `@warlock.js/ai` agent runtime and the official `openai` SDK. Agents,
 * workflows, and supervisors never talk to OpenAI directly — they hold a
 * `ModelContract`, and this class is what makes that contract concrete for
 * any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, OpenRouter, local
 * gateways that speak the Chat Completions protocol).
 *
 * **Responsibility.**
 * - Owns: a long-lived `OpenAI` client + frozen `ModelConfig` (name,
 *   temperature, maxTokens) used as defaults for every call.
 * - Owns: translating vendor-neutral `Message[]` and
 *   `ToolContract[]` into OpenAI wire shapes on the way out, and
 *   translating OpenAI's response (content, finish reason, tool calls,
 *   usage) back into the neutral shapes on the way in.
 * - Does NOT own: dispatching tools, deciding whether to loop, tracking
 *   conversation history, or retrying on failure — those are agent
 *   concerns. The model is a stateless (per-call) protocol adapter.
 *
 * Because it holds a live client and shared defaults, it is modeled as a
 * class (see §4.2 of code-style.md — "long-lived state across calls").
 *
 * @example
 * import OpenAI from "openai";
 * const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
 * const model = new OpenAIModel(client, { name: "gpt-4o", temperature: 0.3 });
 *
 * const myAgent = agent({
 *   model,
 *   systemPrompt: "You are a helpful assistant.",
 *   tools: [searchTool],
 * });
 *
 * const result = await myAgent.execute("Summarize today's news.");
 */
export class OpenAIModel implements ModelContract {
  public readonly name: string;
  public readonly provider: string;
  public readonly capabilities: ModelCapabilities;
  public readonly pricing?: ModelPricing;

  private readonly client: OpenAI;
  private readonly config: OpenAIModelConfig;
  private readonly logger: Logger = log;
  private searchModel?: OpenAIResponsesModel;

  public constructor(client: OpenAI, config: OpenAIModelConfig, provider: string = "openai") {
    // `api: "responses"` belongs to `OpenAIResponsesModel`, which only the
    // `OpenAISDK.model()` factory constructs. This class speaks Chat
    // Completions only; accepting the flag here would silently ignore it.
    if (config.api === "responses") {
      throw new InvalidRequestError(
        'OpenAIModel speaks Chat Completions only and cannot serve api: "responses". Use OpenAISDK.model({ api: "responses" }) on the direct OpenAI provider.',
        { context: { provider, model: config.name, api: config.api } },
      );
    }

    this.client = client;
    this.config = config;
    this.name = config.name;
    this.provider = provider;
    this.pricing = config.pricing;
    this.capabilities = {
      structuredOutput: config.structuredOutput ?? inferStructuredOutput(config.responseFormat),
      vision: config.vision ?? inferVisionCapability(config.name),
      // o-series + gpt-5 / gpt-6 models surface a reasoning channel and accept
      // the `reasoning_effort` param. Explicit config wins over the
      // name-prefix inference.
      reasoning: config.reasoning ?? inferReasoningCapability(config.name),
      // Direct OpenAI requests support automatic cache hits and explicit
      // content-part breakpoints. Wrapper endpoints have distinct provider
      // labels and may reject these OpenAI-only request fields.
      promptCaching: this.provider === "openai",
      // PDF + audio INPUT are off by default — OpenAI accepts `file`
      // (PDF) and `input_audio` parts only on specific models, so the
      // flags are conservative/honest and opt-in via config rather than
      // name-inferred. When set, the agent admits the attachments and
      // `toOpenAIMessages` maps them to the real wire parts.
      pdf: config.pdf ?? false,
      audio: config.audio ?? false,
    };
  }

  /**
   * Single-shot completion. Sends the full message list to the Chat
   * Completions endpoint, waits for the terminal response, and reshapes it
   * into a vendor-neutral `ModelResponse`. Per-call `options` override the
   * instance's `ModelConfig` defaults for this call only.
   */
  public async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
    const searchRoute = this.hostedSearchRoute(options);

    if (searchRoute) {
      return searchRoute.complete(messages, options);
    }

    // Per-call request/response logs are hot-path in production agents
    // — keep them at `debug` so `info` stays reserved for lifecycle
    // events (agent starting/completed, etc.). Operators who need to
    // audit every LLM call can raise log-level at runtime.
    this.logger.debug(LOG_MODULE, "request", "Starting call to chat.completions", {
      model: this.name,
      messageCount: messages.length,
      streaming: false,
      toolCount: options?.tools?.length ?? 0,
    });

    let response: OpenAI.Chat.Completions.ChatCompletion;

    try {
      response = await this.client.chat.completions.create(
        mergeProviderBody<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming>(
          {
            model: this.name,
            ...compatibleSearchParams(this.provider, options),
            messages: toOpenAIMessages(messages, this.promptCacheBreakpoints(options)),
            ...this.buildSamplingParams(options),
            ...buildPromptCacheParams(this.provider, this.config),
            ...this.buildTools(options),
            ...this.buildResponseFormat(options?.responseSchema),
            ...this.buildReasoningParams(options?.reasoning, Boolean(options?.tools?.length)),
          },
          options,
        ),
        options?.signal ? { signal: options.signal } : undefined,
      );
    } catch (thrown) {
      const wrapped = wrapOpenAIError(thrown);

      this.logger.error(LOG_MODULE, "error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    const [choice] = response.choices;

    if (choice === undefined) {
      // A 200 carrying an empty `choices` array. Every line below reads off
      // `choice`, so without this the caller got a bare `TypeError: Cannot
      // read properties of undefined` — no provider, no model, no hint that
      // the response itself was the problem rather than our handling of it.
      //
      // `ProviderError` because that is what this is: the provider answered
      // successfully and returned nothing usable. Callers already branch on
      // `instanceof ProviderError` for any provider-side failure.
      throw new ProviderError("OpenAI returned a response with no choices.", {
        context: { provider: "openai", model: this.name, choices: response.choices.length },
      });
    }

    const finishReason = mapFinishReason(choice.finish_reason);
    const usage = this.extractUsage(response.usage);

    this.logger.debug(LOG_MODULE, "response", "call to chat.completions succeeded", {
      finishReason,
      usage,
    });

    return {
      content: choice.message.content ?? "",
      finishReason,
      usage,
      toolCalls: this.extractToolCalls(choice.message.tool_calls),
    };
  }

  /**
   * Incremental streaming completion. Yields neutral `ModelStreamChunk`s —
   * `delta` for text tokens, `tool-call` when the model requests a tool,
   * and a terminal `done` carrying the final finish reason + usage totals.
   * Callers consume it with `for await`.
   *
   * With `options.streamChunks` it also yields `tool-args` for each
   * `tool_calls[].function.arguments` fragment and `reasoning` for a
   * vendor's `reasoning_content` / `reasoning` delta field. Usage arrives
   * only on the final chunk here, so no `usage` chunk is emitted.
   */
  public async *stream(
    messages: Message[],
    options?: ModelCallOptions,
  ): AsyncIterable<ModelStreamChunk> {
    const searchRoute = this.hostedSearchRoute(options);

    if (searchRoute) {
      yield* searchRoute.stream(messages, options);
      return;
    }

    this.logger.debug(LOG_MODULE, "request", "Starting streaming call to chat.completions", {
      model: this.name,
      messageCount: messages.length,
      streaming: true,
      toolCount: options?.tools?.length ?? 0,
    });

    let stream: Awaited<ReturnType<typeof this.client.chat.completions.create>>;

    try {
      stream = await this.client.chat.completions.create(
        mergeProviderBody<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming>(
          {
            model: this.name,
            ...compatibleSearchParams(this.provider, options),
            messages: toOpenAIMessages(messages, this.promptCacheBreakpoints(options)),
            ...this.buildSamplingParams(options),
            ...buildPromptCacheParams(this.provider, this.config),
            ...this.buildTools(options),
            stream: true,
            stream_options: { include_usage: true },
            ...this.buildResponseFormat(options?.responseSchema),
            ...this.buildReasoningParams(options?.reasoning, Boolean(options?.tools?.length)),
          },
          options,
        ),
        options?.signal ? { signal: options.signal } : undefined,
      );
    } catch (thrown) {
      const wrapped = wrapOpenAIError(thrown);

      this.logger.error(LOG_MODULE, "error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    let rawFinishReason: string = "stop";
    let usage: Usage = { input: 0, output: 0, total: 0 };
    const want = resolveStreamChunks(options);
    const toolCallAccum = new Map<
      number,
      { id: string; name: string; arguments: string; streamed: number }
    >();

    try {
      for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        const delta = chunk.choices[0]?.delta;
        const finish = chunk.choices[0]?.finish_reason;

        if (want.reasoning && delta) {
          const reasoning = readReasoningDelta(delta);

          if (reasoning) {
            yield { type: "reasoning", delta: reasoning };
          }
        }

        if (delta?.content) {
          yield { type: "delta", content: delta.content };
        }

        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const idx = toolCall.index ?? 0;
            if (!toolCallAccum.has(idx)) {
              toolCallAccum.set(idx, { id: "", name: "", arguments: "", streamed: 0 });
            }
            const acc = toolCallAccum.get(idx)!;
            if (toolCall.id) acc.id = toolCall.id;
            if (toolCall.function?.name) acc.name = toolCall.function.name;
            if (toolCall.function?.arguments) acc.arguments += toolCall.function.arguments;

            // The first fragment of a call carries its id and name; later
            // ones only `index` + argument text. Anything that arrived
            // before the name is flushed once the call is identified.
            if (want.toolArgs && acc.name && acc.arguments.length > acc.streamed) {
              yield {
                type: "tool-args",
                callId: acc.id,
                name: acc.name,
                delta: acc.arguments.slice(acc.streamed),
              };
              acc.streamed = acc.arguments.length;
            }
          }
        }

        if (finish) {
          rawFinishReason = finish;
        }

        if (chunk.usage) {
          usage = this.extractUsage(chunk.usage);
        }
      }

      for (const acc of toolCallAccum.values()) {
        // Skip accumulators that never received a function name — those
        // are partial fragments the model started but never identified
        // (e.g. arguments-only deltas with no originating `id`/`name`).
        // Yielding them produces nameless tool-calls the agent runtime
        // can't dispatch and would mis-attribute as a registered tool.
        if (!acc.name) continue;

        yield {
          type: "tool-call",
          id: acc.id,
          name: acc.name,
          input: safeJsonParse<Record<string, unknown>>(acc.arguments, {}),
        };
      }
    } catch (thrown) {
      const wrapped = wrapOpenAIError(thrown);

      this.logger.error(LOG_MODULE, "error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    const finishReason = mapFinishReason(rawFinishReason);

    this.logger.debug(LOG_MODULE, "response", "Streaming call to chat.completions succeeded", {
      finishReason,
      usage,
    });

    yield {
      type: "done",
      finishReason,
      usage,
    };
  }

  /**
   * OpenAI's hosted `web_search` tool exists only on the Responses API, and
   * Chat Completions answers it with a 400. When a call on the direct
   * `"openai"` provider carries it, the call is served by the Responses
   * adapter instead (same client, same pricing, same model name), unless the
   * model was pinned to `api: "chat"` or cannot search at all: both throw a
   * clear error before any request, never a silent fallback to something
   * else. Every other call stays on Chat Completions.
   */
  private hostedSearchRoute(
    options: ModelCallOptions | undefined,
  ): OpenAIResponsesModel | undefined {
    if (this.provider !== "openai" || !requestsHostedSearch(options, this.provider)) {
      return undefined;
    }

    if (this.config.api === "chat") {
      throw new InvalidRequestError(
        `OpenAI's hosted web_search tool needs the Responses API, but "${this.name}" is pinned to api: "chat". Remove api: "chat" (the call is then routed to the Responses API) or use api: "responses".`,
        { context: { provider: this.provider, model: this.name, api: "chat", tool: "web_search" } },
      );
    }

    assertHostedSearchSupported(this.name, options);
    this.searchModel ??= new OpenAIResponsesModel(this.client, this.config, this.provider);

    return this.searchModel;
  }

  /**
   * Spread-friendly `tools` fragment: the function tools, then the
   * provider-defined entries whose `provider` equals this model's
   * provider label (`"openai"`, or the vendor label an OpenAI-compatible
   * wrapper sets, e.g. `"groq"`), sent verbatim. Chat Completions only
   * accepts `function` and `custom` tool types from OpenAI itself; its
   * hosted tools (`web_search`, `file_search`, …) need `api: "responses"`
   * and OpenAI rejects them here with a 400.
   */
  private buildTools(options: ModelCallOptions | undefined): {
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  } {
    const { tools, definitions } = selectProviderTools(options, {
      accepts: [this.provider],
      module: LOG_MODULE,
      model: this.name,
      logger: this.logger,
    });
    // https://platform.kimi.ai/docs/guide/use-web-search — retires 2026-10-20.
    if (
      (this.provider === "moonshot" || this.provider === "kimi") &&
      definitions.some((definition) => {
        const fn = definition.function;
        return (
          definition.type === "builtin_function" &&
          typeof fn === "object" &&
          fn !== null &&
          "name" in fn &&
          fn.name === "$web_search"
        );
      })
    ) {
      throw new InvalidRequestError(
        "Kimi's builtin $web_search retires on 20 October 2026. Use kimiSearchTool() / kimiFetchTool() from @warlock.js/ai-openai.",
      );
    }
    // Native search is a Responses-only xAI feature. Fail before transport.
    // https://docs.x.ai/developers/tools/web-search
    if (
      this.provider === "xai" &&
      definitions.some(
        (definition) => definition.type === "web_search" || definition.type === "x_search",
      )
    ) {
      throw new InvalidRequestError(
        "xAI native web_search / x_search requires POST /v1/responses. Build the model with XaiSDK from @warlock.js/ai-xai, which routes those calls to the Responses API.",
      );
    }
    const mapped = [
      ...(toOpenAITools(tools) ?? []),
      ...(definitions as unknown as OpenAI.Chat.Completions.ChatCompletionTool[]),
    ];

    return mapped.length > 0 ? { tools: mapped } : {};
  }

  /** Map the neutral cache hint only for the direct OpenAI provider. */
  private promptCacheBreakpoints(options: ModelCallOptions | undefined): number {
    return this.provider === "openai" ? (options?.cacheControl?.breakpoints ?? 0) : 0;
  }

  /**
   * Translate the neutral `responseSchema` option into OpenAI's
   * `response_format` parameter. The mode decision (override handling,
   * strict-compatibility downgrade to `json_object`) lives in
   * `planStructuredOutput`, shared with the Responses adapter.
   *
   * Returns an empty spread when no schema was supplied, so the caller
   * can unconditionally `...buildResponseFormat(...)` into the request.
   */
  private buildResponseFormat(responseSchema: Record<string, unknown> | undefined): {
    response_format?: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
  } {
    const plan = planStructuredOutput(responseSchema, this.config.responseFormat);

    if (plan.mode === "json_schema") {
      return {
        response_format: {
          type: "json_schema",
          json_schema: { name: "response", schema: plan.schema, strict: true },
        },
      };
    }

    if (plan.mode === "json_object") {
      return { response_format: { type: "json_object" } };
    }

    return {};
  }

  /**
   * Normalize OpenAI's `usage` block (which may be absent on some responses
   * or partials) into the neutral `Usage` shape. Missing usage collapses to
   * zeros rather than propagating `undefined`, so downstream aggregation
   * math stays safe.
   *
   * `cachedTokens` mirrors `prompt_tokens_details.cached_tokens` (the
   * subset of the prompt served from OpenAI's automatic prompt cache);
   * `reasoningTokens` mirrors `completion_tokens_details.reasoning_tokens`
   * (the hidden reasoning channel on o-series / gpt-5 models, already
   * counted within `output`). Both are emitted only when the provider
   * reports a positive value, so non-reasoning / uncached calls keep the
   * lean `{ input, output, total }` shape. `cacheWriteTokens` mirrors
   * `prompt_tokens_details.cache_write_tokens` (billed writes on the
   * models that charge for them). `cost` is attached when priced.
   */
  private extractUsage(raw: OpenAI.Completions.CompletionUsage | undefined): Usage {
    if (!raw) {
      return { input: 0, output: 0, total: 0 };
    }

    return buildUsage(
      {
        input: raw.prompt_tokens ?? 0,
        output: raw.completion_tokens ?? 0,
        total: raw.total_tokens ?? 0,
        cachedTokens: raw.prompt_tokens_details?.cached_tokens,
        cacheWriteTokens: raw.prompt_tokens_details?.cache_write_tokens,
        reasoningTokens: raw.completion_tokens_details?.reasoning_tokens,
      },
      this.pricing,
    );
  }

  /**
   * Translate the neutral `ModelCallOptions.reasoning` hint into OpenAI's
   * `reasoning_effort` request param. Only `effort` maps — OpenAI's Chat
   * Completions API exposes a discrete effort knob, not a token budget,
   * so `reasoning.maxTokens` (the Anthropic extended-thinking cap) has no
   * wire equivalent here and is silently ignored.
   *
   * The neutral `ReasoningEffort` (`"low" | "medium" | "high" | "none"`)
   * is a subset of OpenAI's accepted values, so it forwards verbatim —
   * `"none"` included. `"none"` is load-bearing: gpt-5 / o-series models
   * **reject function tools** on Chat Completions while reasoning is
   * active, and the endpoint accepts tools only when `reasoning_effort`
   * is `"none"` (the alternative is the Responses API). This is why the
   * param is EMITTED for `"none"` rather than omitted — omitting it
   * leaves the model reasoning server-side by default, so tools would
   * still be rejected.
   *
   * No-ops when the model is not reasoning-capable
   * (`capabilities.reasoning` is false — e.g. `gpt-4o`, which 400s on any
   * `reasoning_effort`).
   *
   * When the caller gave no explicit `effort`: defaults to `"none"` IF
   * `hasTools` is true, else omits the param (provider default — the
   * pre-existing behavior for a tool-less call). The default exists
   * because, on a reasoning-capable model, there is no working alternative
   * to `"none"` when tools are attached — omitting `reasoning_effort`
   * leaves reasoning on server-side, which Chat Completions rejects tools
   * for (empty replies on some model generations, a hard 400 — "Function
   * tools with reasoning_effort are not supported ... in
   * /v1/chat/completions" — on newer ones). An explicit `effort` from the
   * caller always wins over this default, in either direction.
   *
   * Returns an empty spread when nothing applies, so the caller can
   * unconditionally `...buildReasoningParams(...)` into the request.
   */
  /**
   * Output-length and sampling params, in current Chat Completions shapes only.
   *
   * - `max_completion_tokens`, never the legacy `max_tokens`: current
   *   models (the gpt-5 family and later) answer `400 unsupported_parameter`
   *   to `max_tokens`, and `max_completion_tokens` is accepted everywhere.
   * - No `temperature` for a reasoning-capable model: those accept only the
   *   default value and reject any other with a 400.
   */
  private buildSamplingParams(options: ModelCallOptions | undefined): {
    max_completion_tokens?: number;
    temperature?: number;
  } {
    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    const temperature = options?.temperature ?? this.config.temperature;

    return {
      max_completion_tokens: maxTokens,
      ...(!this.capabilities.reasoning && { temperature }),
    };
  }

  private buildReasoningParams(
    reasoning: ModelCallOptions["reasoning"],
    hasTools: boolean,
  ): {
    reasoning_effort?: OpenAI.Chat.Completions.ChatCompletionCreateParams["reasoning_effort"];
  } {
    if (!this.capabilities.reasoning) {
      return {};
    }

    if (!reasoning?.effort) {
      return hasTools ? { reasoning_effort: "none" } : {};
    }

    return { reasoning_effort: toOpenAIReasoningEffort(reasoning.effort) };
  }

  /**
   * Reshape OpenAI's `tool_calls` array into the neutral
   * `ModelToolCallRequest[]`. The raw `arguments` field is a JSON string
   * per OpenAI's protocol — we parse it defensively via `safeJsonParse` so
   * malformed or empty arguments yield an empty object instead of crashing
   * the trip. Returns `undefined` when no tools were requested so callers
   * can branch on presence.
   */
  private extractToolCalls(
    rawToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
  ): ModelToolCallRequest[] | undefined {
    if (!rawToolCalls || rawToolCalls.length === 0) {
      return undefined;
    }

    return rawToolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: (toolCall as any).function.name,
      input: safeJsonParse<Record<string, unknown>>((toolCall as any).function.arguments, {}),
    }));
  }
}

/**
 * Reasoning text an OpenAI-compatible vendor puts on a Chat Completions
 * stream delta. OpenAI itself streams none on this API. DeepSeek documents
 * `delta.reasoning_content` (API reference, chat completion chunk); Groq
 * documents the parsed reasoning under a `reasoning` field. Neither is in
 * the OpenAI SDK's delta type, so the delta is read as a plain record.
 */
function readReasoningDelta(delta: object): string | undefined {
  const record = delta as Record<string, unknown>;

  for (const key of ["reasoning_content", "reasoning"]) {
    const value = record[key];

    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return undefined;
}
