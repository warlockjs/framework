import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions, ModelContract } from "../contracts/model.contract";
import type { ToolConfig } from "../contracts/tool.contract";
import { InvalidRequestError } from "../errors/invalid-request-error";
import { extractJsonSchema } from "./json-schema";

/**
 * Tuning knobs for {@link estimateInputTokens}. Every default is a
 * heuristic, not a tokenizer: the result is an estimate, never a count.
 */
export type EstimateInputTokensOptions = {
  /** Tools sent with the call; their name, description and JSON schema are counted. */
  tools?: ReadonlyArray<ToolConfig<unknown, unknown>>;
  /** Structured-output schema sent with the call, counted as JSON. */
  responseSchema?: Record<string, unknown>;
  /**
   * Characters per token. Default `4` — the usual figure for English
   * text on GPT / Claude tokenizers. Lower it (e.g. `3`) for code, JSON
   * or non-Latin scripts, which tokenize denser, so the estimate errs high.
   */
  charsPerToken?: number;
  /**
   * Tokens charged for each image / PDF / audio part, whose size cannot
   * be read from characters. Default `1_000`. Providers price media very
   * differently (by pixels, pages or seconds), so set this from your
   * provider's docs when attachments matter.
   */
  attachmentTokens?: number;
  /** Tokens added per message for role and framing overhead. Default `4`. */
  perMessageTokens?: number;
};

const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_ATTACHMENT_TOKENS = 1_000;
const DEFAULT_PER_MESSAGE_TOKENS = 4;

/**
 * **Estimate** — offline, no network — the input tokens a model call
 * would use: message text, tool-call arguments, tool definitions and the
 * response schema, at `charsPerToken` characters per token, plus a fixed
 * allowance per message and per attachment.
 *
 * Use it where no native count exists (see {@link countInputTokens},
 * which prefers `model.countTokens()` and falls back to this), or for a
 * cheap pre-check before a native count. It can be off by tens of
 * percent either way; pick `charsPerToken` conservatively when you use it
 * to enforce a cap. Replayed provider blocks (`Message.blocks`, e.g.
 * signed thinking) are not counted.
 *
 * @example
 * const tokens = estimateInputTokens(messages, { tools, charsPerToken: 3 });
 * if (tokens > 50_000) throw new Error("prompt too large for this tier");
 */
export function estimateInputTokens(
  messages: ReadonlyArray<Message>,
  options: EstimateInputTokensOptions = {},
): number {
  const charsPerToken = positiveOr(options.charsPerToken, DEFAULT_CHARS_PER_TOKEN);
  const attachmentTokens = nonNegativeOr(options.attachmentTokens, DEFAULT_ATTACHMENT_TOKENS);
  const perMessageTokens = nonNegativeOr(options.perMessageTokens, DEFAULT_PER_MESSAGE_TOKENS);

  let characters = 0;
  let fixedTokens = 0;

  for (const message of messages) {
    fixedTokens += perMessageTokens;

    if (typeof message.content === "string") {
      characters += message.content.length;
    } else {
      for (const part of message.content) {
        if (part.type === "text") {
          characters += part.text.length;
        } else {
          fixedTokens += attachmentTokens;
        }
      }
    }

    for (const call of message.toolCalls ?? []) {
      characters += call.name.length + safeJsonLength(call.input);
    }
  }

  for (const tool of options.tools ?? []) {
    characters += toolSchemaJson(tool).length;
  }

  if (options.responseSchema) {
    characters += safeJsonLength(options.responseSchema);
  }

  return Math.ceil(characters / charsPerToken) + fixedTokens;
}

/** The result of {@link countInputTokens}: the count and where it came from. */
export type InputTokenCount = {
  /** Input tokens for the call. */
  tokens: number;
  /**
   * `"native"` — the provider's own count endpoint (`model.countTokens`);
   * `"estimate"` — {@link estimateInputTokens}, because the model has no
   * count endpoint or explicitly cannot count this request shape.
   */
  source: "native" | "estimate";
};

/**
 * Count the input tokens of a call, natively when the model can
 * (`model.countTokens` — Anthropic, Google, Bedrock and OpenAI Responses
 * models; a network call that generates nothing) and by
 * {@link estimateInputTokens} otherwise. An adapter can explicitly decline a
 * request shape with `InvalidRequestError` and `reason: "count-unsupported"`.
 * Only that signal falls back; auth, transport and other errors propagate.
 * `source` says which.
 *
 * @example
 * const { tokens, source } = await countInputTokens(model, messages, { tools });
 * if (tokens > cap) throw new Error(`prompt is ${tokens} tokens (${source})`);
 */
export async function countInputTokens(
  model: Pick<ModelContract, "countTokens">,
  messages: Message[],
  options: ModelCallOptions & { estimate?: EstimateInputTokensOptions } = {},
): Promise<InputTokenCount> {
  const { estimate, ...callOptions } = options;

  if (model.countTokens) {
    try {
      return { tokens: await model.countTokens(messages, callOptions), source: "native" };
    } catch (error) {
      if (!(error instanceof InvalidRequestError) || error.reason !== "count-unsupported") {
        throw error;
      }
    }
  }

  return {
    tokens: estimateInputTokens(messages, {
      tools: callOptions.tools,
      responseSchema: callOptions.responseSchema,
      ...estimate,
    }),
    source: "estimate",
  };
}

/**
 * The JSON a tool contributes to a request, in the neutral shape every
 * adapter derives its own format from: name, description and input
 * schema. Shared by the estimate and `measureTools`.
 */
export function toolSchemaJson(
  tool: Pick<ToolConfig<unknown, unknown>, "name" | "description" | "input">,
): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: extractJsonSchema(tool.input) ?? { type: "object", properties: {} },
  });
}

function safeJsonLength(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }

  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}
