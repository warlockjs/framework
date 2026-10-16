import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import { AgentExecutionError } from "../errors";
import { extractJsonSchema } from "../utils/json-schema";
import { approximateTokenCount } from "../utils/token-count";
import type { AgentCompactionConfig, AgentCompactionRecord } from "./compaction.type";

export function validateCompaction(config: AgentCompactionConfig | undefined): void {
  if (config === undefined) return;
  if (
    !config ||
    !Number.isSafeInteger(config.afterTokens) ||
    config.afterTokens <= 0 ||
    (config.keep !== undefined && (!Number.isSafeInteger(config.keep) || config.keep < 1)) ||
    typeof config.summarize !== "function" ||
    (config.countTokens !== undefined && typeof config.countTokens !== "function")
  ) {
    throw new AgentExecutionError(
      "compaction requires positive integer afterTokens, keep >= 1, a summarize callback and an optional countTokens callback.",
      { context: { authoring: true } },
    );
  }
}

/** An offline estimate including text, multimodal metadata, tool schemas and output schema. */
function estimateInput(messages: Message[], options: ModelCallOptions): number {
  return approximateTokenCount(
    JSON.stringify({
      messages,
      tools: options.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.input ? extractJsonSchema(tool.input) : undefined,
      })),
      responseSchema: options.responseSchema,
    }),
  );
}

/** Pick a contiguous old range without splitting tool calls/results or removing the latest user input. */
function selectRange(
  messages: Message[],
  keep: number,
): { start: number; end: number } | undefined {
  let start = messages.findIndex((message) => message.role !== "system");
  if (start < 0) return undefined;
  let end = Math.max(start, messages.length - keep);
  while (end > start && messages[end]?.role === "tool") end--;
  let latestUser = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      latestUser = index;
      break;
    }
  }
  if (latestUser >= start && latestUser < end) {
    if (latestUser === start) start++;
    else end = latestUser;
  }
  const systemIndex = messages.findIndex(
    (message, index) => index >= start && index < end && message.role === "system",
  );
  if (systemIndex >= 0) end = systemIndex;
  if (end - start < 2 || messages[start]?.role === "tool") return undefined;

  const candidate = messages.slice(start, end);
  const calls = new Set(
    candidate.flatMap((message) => message.toolCalls?.map((call) => call.id) ?? []),
  );
  const results = new Set(
    candidate.filter((message) => message.role === "tool").map((message) => message.toolCallId),
  );
  if ([...calls].some((id) => !results.has(id)) || [...results].some((id) => !id || !calls.has(id)))
    return undefined;
  return { start, end };
}

function carriesReplay(message: Message): boolean {
  return Boolean(
    message.blocks?.length ||
    message.toolCalls?.some(
      (call) => call.providerMetadata && Object.keys(call.providerMetadata).length > 0,
    ),
  );
}

/** Build a replacement off to the side; caller applies it only after successful validation. */
export async function compactAgentMessages(
  config: AgentCompactionConfig,
  messages: Message[],
  options: ModelCallOptions,
  tripIndex: number,
): Promise<{ record?: AgentCompactionRecord; messages?: Message[] }> {
  const counting = config.countTokens ? "custom" : "estimate";
  const record: AgentCompactionRecord = { type: "skipped", tripIndex, counting };
  const count = async (history: Message[]): Promise<number> => {
    const tokens = config.countTokens
      ? await config.countTokens(structuredClone(history), options)
      : estimateInput(history, options);
    if (!Number.isFinite(tokens) || tokens < 0)
      throw new Error("compaction countTokens must return a finite non-negative number.");
    return tokens;
  };
  try {
    const before = await count(messages);
    record.inputTokens = before;
    if (options.signal?.aborted || before < config.afterTokens) return {};
    const range = selectRange(messages, config.keep ?? 8);
    if (!range) return { record: { ...record, reason: "no-safe-range" } };
    if (
      messages.some(
        (message, index) => (index < range.start || index >= range.end) && carriesReplay(message),
      )
    ) {
      return { record: { ...record, reason: "provider-replay" } };
    }
    const candidate = structuredClone(messages.slice(range.start, range.end));
    const result = await config.summarize(candidate, {
      tripIndex,
      inputTokens: before,
      counting,
      signal: options.signal,
    });
    if (options.signal?.aborted) return {};
    if (
      result.replacesFromIndex !== 0 ||
      result.replacesToIndex !== candidate.length - 1 ||
      result.summary.role !== "assistant" ||
      typeof result.summary.content !== "string" ||
      !result.summary.content.trim() ||
      result.summary.toolCalls?.length ||
      result.summary.blocks?.length
    )
      throw new Error(
        "compaction summarize must replace the entire supplied slice with a non-empty assistant text summary.",
      );
    const summary: Message = { role: "assistant", content: result.summary.content };
    const replacement = [...messages.slice(0, range.start), summary, ...messages.slice(range.end)];
    const after = await count(replacement);
    if (options.signal?.aborted) return {};
    if (after >= before) return { record: { ...record, reason: "not-smaller" } };
    return {
      messages: replacement,
      record: {
        ...record,
        type: "applied",
        compaction: { summary, replacesFromIndex: range.start, replacesToIndex: range.end - 1 },
      },
    };
  } catch (error) {
    return {
      record: {
        ...record,
        reason: "callback-error",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
