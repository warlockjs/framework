import {
  attachCost,
  InvalidRequestError,
  resolveStreamChunks,
  selectProviderTools,
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
import type {
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  GroundingMetadata,
  Part,
  Tool,
} from "@google/genai";
import { isSearchDefinition, searchBudgetOf } from "./search-budget";
import { applyGrounding, groundingMetadata } from "./utils/grounding";
import { mergeProviderBody } from "./provider-options";
import type { GoogleModelConfig } from "./config.type";
import { inferVisionCapability } from "./known-vision-models";
import {
  applyGoogleUsage,
  mapFinishReason,
  toGoogleContents,
  toGoogleTools,
  wrapGoogleError,
} from "./utils";

const LOG_MODULE = "ai.google";

/** `provider` value of `ai.providerTool()` entries this adapter sends verbatim. */
const GOOGLE_WIRE_FORMAT = "google";

/**
 * Bucketed `thinkingBudget` (token caps) for the neutral
 * `reasoning.effort` levels when the caller gives no explicit
 * `reasoning.maxTokens`. Gemini 2.5 accepts a positive budget as a cap
 * on the thinking phase; these mirror the spread the OpenAI
 * `reasoning_effort` low/medium/high tiers imply. The installed
 * `@google/genai` `ThinkingConfig` declaration documents that allowed
 * ranges are model-dependent, so retain the existing conservative 24,576
 * cap for the new tiers rather than sending a budget unsupported by Flash.
 */
const EFFORT_THINKING_BUDGET: Record<Exclude<ReasoningEffort, "none">, number> = {
  minimal: 1024,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 24576,
  max: 24576,
};

/**
 * Google Gemini-backed implementation of `ModelContract`.
 *
 * **Role.** The provider-facing bridge between the vendor-neutral
 * `@warlock.js/ai` agent runtime and the `@google/genai` SDK
 * (`models.generateContent` / `generateContentStream`).
 *
 * **Responsibility.**
 * - Owns: a long-lived `GoogleGenAI` client + frozen `ModelConfig`
 *   (name, temperature, maxTokens) used as per-call defaults.
 * - Owns: translating vendor-neutral `Message[]` / `ToolConfig[]` into
 *   Gemini shapes (systemInstruction hoisting, `model` role,
 *   `functionCall` / `functionResponse` parts, inline image bytes) on
 *   the way out, and Gemini's candidate/parts response (text, function
 *   calls, finish reason, token usage) back into neutral shapes on the
 *   way in.
 * - Does NOT own: dispatching tools, looping, history, retries — those
 *   are agent concerns. The model is a per-call protocol adapter.
 *
 * Modeled as a class (see §4.2 of code-style.md — "long-lived state
 * across calls"): the `GoogleGenAI` client is reused for the SDK's
 * lifetime.
 *
 * @example
 * import { GoogleGenAI } from "@google/genai";
 * const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
 * const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });
 *
 * const myAgent = agent({ model, tools: [searchTool] });
 * const result = await myAgent.execute("Summarize today's news.");
 */
export class GoogleModel implements ModelContract {
  public readonly name: string;
  public readonly provider: string;
  public readonly capabilities: ModelCapabilities;
  public readonly pricing?: ModelPricing;

  private readonly ai: GoogleGenAI;
  private readonly config: GoogleModelConfig;
  private readonly logger: Logger = log;

  public constructor(ai: GoogleGenAI, config: GoogleModelConfig, provider: string = "google") {
    this.ai = ai;
    this.config = config;
    this.name = config.name;
    this.provider = provider;
    this.pricing = config.pricing;
    const multimodal = config.vision ?? inferVisionCapability(config.name);

    this.capabilities = {
      structuredOutput: config.structuredOutput ?? true,
      vision: multimodal,
      // Every Gemini 2.5 model thinks; older families harmlessly ignore
      // an empty thinking budget. Defaulting `true` lets the agent
      // forward reasoning options; an explicit `false` opts a model out.
      reasoning: config.reasoning ?? true,
      // Gemini reports cache-read hits (`cachedContentTokenCount`) on
      // every call via implicit caching, and accepts explicit context
      // caching. Read-side accounting is always honored.
      promptCaching: true,
      // The multimodal Gemini families that accept images also accept
      // audio and PDF/document parts. Mirror the vision inference unless
      // explicitly overridden.
      audio: config.audio ?? multimodal,
      pdf: config.pdf ?? multimodal,
    };
  }

  /**
   * Single-shot completion. Sends the full message list to
   * `generateContent`, waits for the terminal response, and reshapes
   * it into a vendor-neutral `ModelResponse`. Per-call `options`
   * override the instance defaults for this call only.
   */
  public async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
    this.logger.debug(LOG_MODULE, "request", "Starting generateContent call", {
      model: this.name,
      messageCount: messages.length,
      streaming: false,
      toolCount: options?.tools?.length ?? 0,
    });

    const { systemInstruction, contents } = toGoogleContents(messages);

    let response: GenerateContentResponse;

    try {
      response = await this.ai.models.generateContent({
        model: this.name,
        contents,
        config: this.buildConfig(systemInstruction, options),
      });
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const toolCalls = this.extractToolCalls(response);
    const finishReason = toolCalls
      ? "tool_calls"
      : mapFinishReason(response.candidates?.[0]?.finishReason);
    const usage = this.extractUsage(response);
    const grounding = new Map<number, GroundingMetadata>();
    applyGrounding(usage, grounding, response);
    searchBudgetOf(options)?.record(usage.serverToolUse?.webSearchRequests ?? 0);
    const providerMetadata = groundingMetadata(grounding);
    attachCost(usage, this.pricing);

    this.logger.debug(LOG_MODULE, "response", "generateContent call succeeded", {
      finishReason,
      usage,
    });

    return {
      ...(providerMetadata ? { providerMetadata } : {}),
      content: response.text ?? "",
      finishReason,
      usage,
      toolCalls,
    };
  }

  /** Count native input tokens with the same converted content, system and tools. */
  public async countTokens(messages: Message[], options?: ModelCallOptions): Promise<number> {
    const { systemInstruction, contents } = toGoogleContents(messages);
    const config = this.buildConfig(systemInstruction, options);
    if (config.cachedContent !== undefined) {
      throw new InvalidRequestError(
        "The Google SDK countTokens endpoint cannot count a cachedContent reference.",
        { reason: "count-unsupported" },
      );
    }
    try {
      const response = this.ai.vertexai
        ? await this.ai.models.countTokens({
            model: this.name,
            contents,
            config: {
              ...(config.systemInstruction !== undefined
                ? { systemInstruction: config.systemInstruction }
                : {}),
              ...(config.tools !== undefined ? { tools: config.tools as Tool[] } : {}),
              ...(config.abortSignal ? { abortSignal: config.abortSignal } : {}),
              ...(config.httpOptions ? { httpOptions: config.httpOptions } : {}),
            },
          })
        : await this.countDeveloperTokens(contents, config);
      if (response.totalTokens === undefined)
        throw new InvalidRequestError("Google countTokens returned no totalTokens.");
      return response.totalTokens;
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }
  }

  /**
   * REST counts the full generation request, unlike the typed Developer API
   * converter in @google/genai 2.19.0. See https://ai.google.dev/api/tokens.
   * extraBody keeps the SDK's auth, fetch, base URL, retries and cancellation.
   */
  private countDeveloperTokens(
    contents: ReturnType<typeof toGoogleContents>["contents"],
    config: GenerateContentConfig,
  ) {
    config.abortSignal?.throwIfAborted();

    const {
      systemInstruction,
      serviceTier,
      tools,
      toolConfig,
      safetySettings,
      cachedContent,
      abortSignal,
      httpOptions,
      ...generationConfig
    } = config;
    // Automatic function calling is SDK-only, never a REST generation field.
    delete generationConfig.automaticFunctionCalling;
    const model = this.name.startsWith("models/") ? this.name : `models/${this.name}`;

    return this.ai.models.countTokens({
      model: this.name,
      contents,
      config: {
        abortSignal,
        httpOptions: {
          ...httpOptions,
          extraBody: {
            ...httpOptions?.extraBody,
            // The SDK merges extraBody before JSON serialization. undefined
            // removes its contents field: REST accepts only one input form.
            contents: undefined,
            generateContentRequest: {
              model,
              contents,
              ...(serviceTier !== undefined ? { serviceTier } : {}),
              ...(systemInstruction !== undefined
                ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
                : {}),
              ...(tools !== undefined ? { tools } : {}),
              ...(toolConfig !== undefined ? { toolConfig } : {}),
              ...(safetySettings !== undefined ? { safetySettings } : {}),
              ...(cachedContent !== undefined ? { cachedContent } : {}),
              ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
            },
          },
        },
      },
    });
  }

  /**
   * Incremental streaming completion via `generateContentStream`.
   * Yields neutral `ModelStreamChunk`s — `delta` for text, `tool-call`
   * per function call (Gemini emits a fully-formed call, not partial
   * JSON), and a terminal `done` with the final finish reason + usage.
   *
   * With `options.streamChunks` it also yields `reasoning` for thought
   * parts (only sent when `thinkingConfig.includeThoughts` is on — set it
   * through `providerOptions.google.body`) and `usage` whenever a chunk
   * carries `usageMetadata`. No `tool-args`: calls arrive whole.
   */
  public async *stream(
    messages: Message[],
    options?: ModelCallOptions,
  ): AsyncIterable<ModelStreamChunk> {
    this.logger.debug(LOG_MODULE, "request", "Starting generateContentStream call", {
      model: this.name,
      messageCount: messages.length,
      streaming: true,
      toolCount: options?.tools?.length ?? 0,
    });

    const { systemInstruction, contents } = toGoogleContents(messages);

    let iterable: AsyncGenerator<GenerateContentResponse>;

    try {
      iterable = await this.ai.models.generateContentStream({
        model: this.name,
        contents,
        config: this.buildConfig(systemInstruction, options),
      });
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    let rawFinishReason: string | undefined;
    let sawToolCall = false;
    const usage: Usage = { input: 0, output: 0, total: 0 };
    const want = resolveStreamChunks(options);
    const grounding = new Map<number, GroundingMetadata>();

    try {
      for await (const chunk of iterable) {
        applyGrounding(usage, grounding, chunk);
        // Thought parts (`thought: true`, sent when `thinkingConfig.includeThoughts`
        // is on) carry the thought summary in `text`; the SDK's `chunk.text`
        // getter already leaves them out of the answer.
        if (want.reasoning) {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thought === true && typeof part.text === "string" && part.text !== "") {
              yield { type: "reasoning", delta: part.text };
            }
          }
        }

        const text = chunk.text;

        if (text) {
          yield { type: "delta", content: text };
        }

        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          const toolCall = this.partToToolCall(part);

          if (!toolCall) {
            continue;
          }

          sawToolCall = true;

          yield {
            type: "tool-call",
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
            ...(toolCall.providerMetadata ? { providerMetadata: toolCall.providerMetadata } : {}),
          };
        }

        const candidateFinish = chunk.candidates?.[0]?.finishReason;

        if (candidateFinish) {
          rawFinishReason = candidateFinish;
        }

        if (chunk.usageMetadata) {
          applyGoogleUsage(usage, chunk.usageMetadata);

          if (want.usage) {
            yield { type: "usage", usage: { ...usage } };
          }
        }
      }
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const finishReason = sawToolCall ? "tool_calls" : mapFinishReason(rawFinishReason);

    attachCost(usage, this.pricing);

    this.logger.debug(LOG_MODULE, "response", "generateContentStream call succeeded", {
      finishReason,
      usage,
    });

    searchBudgetOf(options)?.record(usage.serverToolUse?.webSearchRequests ?? 0);
    const providerMetadata = groundingMetadata(grounding);
    yield { type: "done", finishReason, usage, ...(providerMetadata ? { providerMetadata } : {}) };
  }

  /**
   * Assemble the `GenerateContentConfig` shared by `complete()` and
   * `stream()`: inference params, hoisted system instruction,
   * cancellation signal, and conditional tools + native structured
   * output.
   */
  private buildConfig(
    systemInstruction: string | undefined,
    options: ModelCallOptions | undefined,
  ): GenerateContentConfig {
    const temperature = options?.temperature ?? this.config.temperature;
    const maxOutputTokens = options?.maxTokens ?? this.config.maxTokens;

    return mergeProviderBody<GenerateContentConfig>(
      {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
        ...(options?.signal ? { abortSignal: options.signal } : {}),
        ...this.buildTools(options),
        ...this.buildStructuredOutput(options?.responseSchema),
        ...this.buildThinking(options?.reasoning),
      },
      options,
    );
  }

  /**
   * Translate the neutral `reasoning` option into Gemini's
   * `thinkingConfig`. `reasoning.maxTokens` maps directly to
   * `thinkingBudget` (token cap on the thinking phase); when only
   * `reasoning.effort` is given it is bucketed into a budget. Emitted
   * only when the model is `reasoning`-capable — a `false` capability
   * (config override) drops it so a non-thinking model never receives
   * an unsupported `thinkingConfig`.
   *
   * Gemini's `thinkingBudget` semantics: `0` disables thinking, `-1`
   * lets the model decide automatically. A positive value caps the
   * thinking tokens. The neutral `effort: "none"` ("run without
   * reasoning") maps to `thinkingBudget: 0`.
   */
  private buildThinking(
    reasoning: ModelCallOptions["reasoning"],
  ): Pick<GenerateContentConfig, "thinkingConfig"> {
    if (!reasoning || !this.capabilities.reasoning) {
      return {};
    }

    // `effort: "none"` = explicit "run without reasoning". Gemini disables
    // thinking with `thinkingBudget: 0` (its native off switch), so emit
    // that rather than omitting the config — an omitted config lets a
    // thinking model reason at its default budget.
    if (reasoning.effort === "none") {
      return { thinkingConfig: { thinkingBudget: 0 } };
    }

    const thinkingBudget =
      reasoning.maxTokens ??
      (reasoning.effort ? EFFORT_THINKING_BUDGET[reasoning.effort] : undefined);

    if (thinkingBudget === undefined) {
      return {};
    }

    return { thinkingConfig: { thinkingBudget } };
  }

  /**
   * Spread-friendly tools fragment. Empty object when no tools were
   * supplied so the caller can unconditionally spread it. Function tools
   * come first; `ai.providerTool({ provider: "google" })` definitions
   * (`{ googleSearch: {} }`, `{ codeExecution: {} }`, `{ urlContext: {} }`,
   * …) follow verbatim as their own `Tool` entries. Other providers'
   * definitions are skipped with a warning.
   */
  private buildTools(options: ModelCallOptions | undefined): Pick<GenerateContentConfig, "tools"> {
    const { tools, definitions } = selectProviderTools(options, {
      accepts: [GOOGLE_WIRE_FORMAT, this.provider],
      module: LOG_MODULE,
      model: this.name,
      logger: this.logger,
    });
    const budget = searchBudgetOf(options);
    // The Gemini API cannot bound searches inside one call, so a spent budget
    // is enforced here by not offering Google Search again.
    const offered =
      budget && budget.remaining <= 0
        ? definitions.filter((definition) => !isSearchDefinition(definition))
        : definitions;

    if (offered.length < definitions.length) {
      this.logger.warn(
        LOG_MODULE,
        "search-budget",
        "Google Search budget is spent; calling without the search tool",
        { model: this.name, max: budget?.max, used: budget?.used },
      );
    }

    const mapped: Tool[] = [...(toGoogleTools(tools) ?? []), ...(offered as unknown as Tool[])];

    return mapped.length > 0 ? { tools: mapped } : {};
  }

  /**
   * Translate the neutral `responseSchema` into Gemini's native JSON
   * structured output (`responseMimeType: "application/json"` +
   * `responseJsonSchema`, which takes a raw JSON Schema directly).
   * Emitted only when the model is `structuredOutput`-capable and the
   * schema is an object root — otherwise the agent's soft prompt hint
   * + client-side `validate()` carry shape.
   */
  private buildStructuredOutput(
    responseSchema: Record<string, unknown> | undefined,
  ): Pick<GenerateContentConfig, "responseMimeType" | "responseJsonSchema"> {
    if (!responseSchema || !this.capabilities.structuredOutput) {
      return {};
    }

    if (responseSchema.type !== "object" || typeof responseSchema.properties !== "object") {
      return {};
    }

    return {
      responseMimeType: "application/json",
      responseJsonSchema: responseSchema,
    };
  }

  /**
   * Reshape Gemini's function-call content parts into the neutral
   * `ModelToolCallRequest[]`. Returns `undefined` when the model
   * requested no functions so callers can branch on presence.
   *
   * Reads `candidates[0].content.parts` directly rather than the
   * `response.functionCalls` getter: the getter discards the
   * part-level `thoughtSignature`, and Gemini "thinking" models 400
   * the follow-up turn if that signature is not echoed back. See
   * `partToToolCall`.
   */
  private extractToolCalls(response: GenerateContentResponse): ModelToolCallRequest[] | undefined {
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const toolCalls = parts
      .map((part) => this.partToToolCall(part))
      .filter((call): call is ModelToolCallRequest => call !== undefined);

    return toolCalls.length > 0 ? toolCalls : undefined;
  }

  /**
   * Map a single Gemini `Part` to a neutral `ModelToolCallRequest`,
   * or `undefined` when the part is not a function call. The part's
   * `thoughtSignature` (opaque, set by thinking models) is carried on
   * `providerMetadata` so `toGoogleContents` can replay it on the
   * assistant turn — Gemini rejects the next request without it.
   */
  private partToToolCall(part: Part): ModelToolCallRequest | undefined {
    if (!part.functionCall) {
      return undefined;
    }

    const call = part.functionCall;

    return {
      // The Gemini Developer API does not assign function-call ids
      // (only Vertex parallel-calling does). Fall back to the function
      // name so the neutral `toolCallId` is non-empty and the echoed
      // `functionResponse.name` resolves — Gemini matches a result to
      // its call by name. See decisions §49.
      id: call.id ?? call.name ?? "",
      name: call.name ?? "",
      input: (call.args ?? {}) as Record<string, unknown>,
      ...(part.thoughtSignature
        ? { providerMetadata: { thoughtSignature: part.thoughtSignature } }
        : {}),
    };
  }

  /**
   * Normalize Gemini's `usageMetadata` into the neutral `Usage` shape
   * via the shared {@link applyGoogleUsage} mapper (the same one the
   * streaming loop and the Gemini image model use). Absent usage
   * collapses to zeros.
   */
  private extractUsage(response: GenerateContentResponse): Usage {
    const usage: Usage = { input: 0, output: 0, total: 0 };

    if (response.usageMetadata) {
      applyGoogleUsage(usage, response.usageMetadata);
    }

    return usage;
  }

  /**
   * Wrap a thrown provider error into the typed `AIError` hierarchy
   * and emit the standard error log line before it propagates.
   */
  private logAndWrap(thrown: unknown) {
    const wrapped = wrapGoogleError(thrown);

    this.logger.error(LOG_MODULE, "error", wrapped.message, {
      code: wrapped.code,
      context: wrapped.context,
    });

    return wrapped;
  }
}
