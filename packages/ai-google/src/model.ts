import {
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
  Part,
} from "@google/genai";
import type { GoogleModelConfig } from "./config.type";
import { inferVisionCapability } from "./known-vision-models";
import { mapFinishReason, toGoogleContents, toGoogleTools, wrapGoogleError } from "./utils";

const LOG_MODULE = "ai.google";

/**
 * Bucketed `thinkingBudget` (token caps) for the neutral
 * `reasoning.effort` levels when the caller gives no explicit
 * `reasoning.maxTokens`. Gemini 2.5 accepts a positive budget as a cap
 * on the thinking phase; these mirror the spread the OpenAI
 * `reasoning_effort` low/medium/high tiers imply.
 */
const EFFORT_THINKING_BUDGET: Record<ReasoningEffort, number> = {
  low: 1024,
  medium: 8192,
  high: 24576,
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

    this.logger.debug(LOG_MODULE, "response", "generateContent call succeeded", {
      finishReason,
      usage,
    });

    return {
      content: response.text ?? "",
      finishReason,
      usage,
      toolCalls,
    };
  }

  /**
   * Incremental streaming completion via `generateContentStream`.
   * Yields neutral `ModelStreamChunk`s — `delta` for text, `tool-call`
   * per function call (Gemini emits a fully-formed call, not partial
   * JSON), and a terminal `done` with the final finish reason + usage.
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

    try {
      for await (const chunk of iterable) {
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
            ...(toolCall.providerMetadata
              ? { providerMetadata: toolCall.providerMetadata }
              : {}),
          };
        }

        const candidateFinish = chunk.candidates?.[0]?.finishReason;

        if (candidateFinish) {
          rawFinishReason = candidateFinish;
        }

        if (chunk.usageMetadata) {
          this.applyUsage(usage, chunk.usageMetadata);
        }
      }
    } catch (thrown) {
      throw this.logAndWrap(thrown);
    }

    const finishReason = sawToolCall ? "tool_calls" : mapFinishReason(rawFinishReason);

    this.logger.debug(LOG_MODULE, "response", "generateContentStream call succeeded", {
      finishReason,
      usage,
    });

    yield { type: "done", finishReason, usage };
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

    return {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(options?.signal ? { abortSignal: options.signal } : {}),
      ...this.buildTools(options?.tools),
      ...this.buildStructuredOutput(options?.responseSchema),
      ...this.buildThinking(options?.reasoning),
    };
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
   * thinking tokens.
   */
  private buildThinking(
    reasoning: ModelCallOptions["reasoning"],
  ): Pick<GenerateContentConfig, "thinkingConfig"> {
    if (!reasoning || !this.capabilities.reasoning) {
      return {};
    }

    const thinkingBudget =
      reasoning.maxTokens ?? (reasoning.effort ? EFFORT_THINKING_BUDGET[reasoning.effort] : undefined);

    if (thinkingBudget === undefined) {
      return {};
    }

    return { thinkingConfig: { thinkingBudget } };
  }

  /**
   * Spread-friendly tools fragment. Empty object when no tools were
   * supplied so the caller can unconditionally spread it.
   */
  private buildTools(tools: ModelCallOptions["tools"]): Pick<GenerateContentConfig, "tools"> {
    const mapped = toGoogleTools(tools);

    return mapped ? { tools: mapped } : {};
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
  private extractToolCalls(
    response: GenerateContentResponse,
  ): ModelToolCallRequest[] | undefined {
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
   * Normalize Gemini's `usageMetadata` into the neutral `Usage` shape.
   * Cache-read tokens are surfaced as `cachedTokens` only when
   * non-zero. Absent usage collapses to zeros.
   */
  private extractUsage(response: GenerateContentResponse): Usage {
    const usage: Usage = { input: 0, output: 0, total: 0 };

    if (response.usageMetadata) {
      this.applyUsage(usage, response.usageMetadata);
    }

    return usage;
  }

  /**
   * Fold a Gemini `usageMetadata` block into the running neutral
   * `Usage` accumulator. Shared by `complete()` and the streaming
   * loop (where the final chunk carries cumulative totals).
   *
   * Cache-read hits (`cachedContentTokenCount`, implicit or explicit
   * context caching) surface as `cachedTokens`; the thinking-phase
   * tokens of a reasoning model (`thoughtsTokenCount`) surface as
   * `reasoningTokens`. Both are emitted only when reported `> 0` so an
   * absent channel leaves the field undefined.
   */
  private applyUsage(
    usage: Usage,
    raw: NonNullable<GenerateContentResponse["usageMetadata"]>,
  ): void {
    usage.input = raw.promptTokenCount ?? usage.input;
    usage.output = raw.candidatesTokenCount ?? usage.output;
    usage.total = raw.totalTokenCount ?? usage.input + usage.output;

    const cached = raw.cachedContentTokenCount;

    if (cached && cached > 0) {
      usage.cachedTokens = cached;
    }

    const reasoning = raw.thoughtsTokenCount;

    if (reasoning && reasoning > 0) {
      usage.reasoningTokens = reasoning;
    }
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
