import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import { AgentExecutionError } from "../errors";
import { extractJsonSchema } from "../utils/json-schema";
import { approximateJsonTokens, approximateTokenCount } from "../utils/token-count";
import { assertTokenTrigger, isTokenTriggerReached, resolveTokenTrigger } from "./token-trigger";
import {
  DEFAULT_CLEARED_TOOL_RESULT,
  type AgentContextEditingConfig,
  type ClearToolResultsConfig,
  type ContextEditRecord,
} from "./context-editing.type";

const DEFAULT_KEEP = 3;

export function validateContextEditing(config: AgentContextEditingConfig | undefined): void {
  if (config === undefined) return;

  const rule = resolveRule(config);

  if (rule?.afterTokens !== undefined) {
    assertTokenTrigger(rule.afterTokens, "contextEditing.clearToolResults.afterTokens");
  }

  const bad =
    !config ||
    typeof config !== "object" ||
    (rule !== undefined &&
      ((rule.keep !== undefined && (!Number.isSafeInteger(rule.keep) || rule.keep < 0)) ||
        (rule.exclude !== undefined && !Array.isArray(rule.exclude)) ||
        (rule.clearAtLeast !== undefined &&
          (!Number.isSafeInteger(rule.clearAtLeast) || rule.clearAtLeast < 1)) ||
        (rule.countTokens !== undefined && typeof rule.countTokens !== "function")));

  if (bad) {
    throw new AgentExecutionError(
      "contextEditing.clearToolResults requires afterTokens > 0, keep >= 0, an exclude array, clearAtLeast >= 1 and an optional countTokens callback.",
      { context: { authoring: true } },
    );
  }
}

/** The normalized clear-tool-results rule, or `undefined` when none is configured. */
export function resolveRule(
  config: AgentContextEditingConfig | undefined,
): ClearToolResultsConfig | undefined {
  const rule = config?.clearToolResults;

  if (!rule) return undefined;

  return rule === true ? {} : rule;
}

/**
 * The provider-neutral hint for `ModelCallOptions.contextEditing`, sent to
 * models that edit context natively.
 */
export function nativeContextEditingHint(
  config: AgentContextEditingConfig,
  contextWindow?: number,
): NonNullable<ModelCallOptions["contextEditing"]> | undefined {
  const rule = resolveRule(config);

  if (!rule) return undefined;

  const afterTokens =
    rule.afterTokens === undefined
      ? undefined
      : resolveTokenTrigger(rule.afterTokens, contextWindow);

  // An unresolvable window-relative trigger must not turn into "clear always".
  if (rule.afterTokens !== undefined && afterTokens === undefined) return undefined;

  return {
    clearToolResults: {
      ...(afterTokens !== undefined ? { afterTokens } : {}),
      keep: rule.keep ?? DEFAULT_KEEP,
      ...(rule.exclude?.length ? { exclude: [...rule.exclude] } : {}),
      ...(rule.clearAtLeast !== undefined ? { clearAtLeast: rule.clearAtLeast } : {}),
    },
  };
}

function estimate(messages: Message[], options: ModelCallOptions): number {
  return approximateJsonTokens({
    messages,
    tools: options.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.input ? extractJsonSchema(tool.input) : undefined,
    })),
  });
}

/**
 * Replace the content of old tool results in place. Returns a record when
 * something was cleared. Tool-call/result pairing is untouched: only the
 * `content` of a `tool` message changes, so every provider still sees a
 * result for each call.
 */
export async function clearOldToolResults(
  rule: ClearToolResultsConfig,
  messages: Message[],
  options: ModelCallOptions,
  tripIndex: number,
  contextWindow?: number,
): Promise<ContextEditRecord | undefined> {
  const keep = rule.keep ?? DEFAULT_KEEP;
  const placeholder = rule.placeholder ?? DEFAULT_CLEARED_TOOL_RESULT;
  const exclude = new Set(rule.exclude ?? []);

  const toolNames = new Map<string, string>();

  for (const message of messages) {
    for (const call of message.toolCalls ?? []) toolNames.set(call.id, call.name);
  }

  const resultIndexes: number[] = [];

  messages.forEach((message, index) => {
    if (message.role === "tool") resultIndexes.push(index);
  });

  const candidates = resultIndexes
    .slice(0, Math.max(0, resultIndexes.length - keep))
    .filter((index) => {
      const message = messages[index]!;
      const name = message.toolCallId ? toolNames.get(message.toolCallId) : undefined;

      return message.content !== placeholder && !(name && exclude.has(name));
    });

  if (candidates.length === 0) return undefined;

  // A window-relative trigger with no known window never fires.
  if (
    rule.afterTokens !== undefined &&
    resolveTokenTrigger(rule.afterTokens, contextWindow) === undefined
  )
    return undefined;

  const tokens = rule.countTokens
    ? await rule.countTokens(structuredClone(messages), options)
    : estimate(messages, options);

  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new Error("contextEditing countTokens must return a finite non-negative number.");
  }

  if (
    rule.afterTokens !== undefined &&
    !isTokenTriggerReached(rule.afterTokens, tokens, contextWindow, options.maxTokens)
  )
    return undefined;

  if (rule.clearAtLeast !== undefined) {
    const placeholderTokens = approximateTokenCount(placeholder);
    const freed = candidates.reduce((sum, index) => {
      const { content } = messages[index]!;
      const tokens =
        typeof content === "string"
          ? approximateTokenCount(content)
          : approximateJsonTokens(content);

      return sum + Math.max(0, tokens - placeholderTokens);
    }, 0);

    if (freed < rule.clearAtLeast) return undefined;
  }

  for (const index of candidates) {
    messages[index] = { ...messages[index]!, content: placeholder };
  }

  const tokensAfter = rule.countTokens
    ? await rule.countTokens(structuredClone(messages), options)
    : estimate(messages, options);

  return {
    tripIndex,
    clearedResults: candidates.length,
    inputTokens: tokens,
    tokensAfter: Number.isFinite(tokensAfter) && tokensAfter >= 0 ? tokensAfter : tokens,
  };
}
