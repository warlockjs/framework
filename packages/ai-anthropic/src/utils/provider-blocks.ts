import type { ModelToolCallRequest, ProviderContentBlock } from "@warlock.js/ai";
import type Anthropic from "@anthropic-ai/sdk";

/** The `ProviderContentBlock.provider` value this adapter writes and replays. */
export const ANTHROPIC_BLOCK_FORMAT = "anthropic";

/** Block types the neutral `content` + `toolCalls` fields already carry losslessly. */
const NEUTRAL_BLOCK_TYPES = new Set(["text", "tool_use"]);

/** Block types that carry a model-requested call whose id must match `toolCalls`. */
const TOOL_USE_BLOCK_TYPES = new Set(["tool_use"]);

/**
 * Assistant-turn block types that may be sent back verbatim. Server-tool
 * results all end in `_tool_result` (`web_search_tool_result`,
 * `code_execution_tool_result`, …) and are matched by suffix; anything
 * else (an unknown or user-side type such as `image`, `document` or a
 * client `tool_result`) is not replayed.
 */
const REPLAYABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "text",
  "thinking",
  "redacted_thinking",
  "tool_use",
  "server_tool_use",
  "mcp_tool_use",
  "mcp_tool_result",
  "container_upload",
  "compaction",
]);

const SERVER_TOOL_RESULT_TYPE = /^[a-z][a-z0-9_]*_tool_result$/;

/**
 * Wrap an assistant turn's content blocks as `ProviderContentBlock`s, or
 * return `undefined` when the neutral fields already carry the whole turn
 * (only plain text and `tool_use` blocks). Any other block — thinking,
 * redacted thinking, compaction, server-tool use/results, cited text —
 * makes the full ordered list worth keeping so the next request can
 * replay the turn verbatim.
 *
 * @example
 * toProviderBlocks([{ type: "text", text: "hi", citations: null }]); // undefined
 * toProviderBlocks([{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "hi" }]);
 * // [{ provider: "anthropic", type: "thinking", data: {...} }, { provider: "anthropic", type: "text", data: {...} }]
 */
export function toProviderBlocks(
  content: ReadonlyArray<{ type: string }>,
): ProviderContentBlock[] | undefined {
  if (!content.some(needsVerbatimReplay)) {
    return undefined;
  }

  return content.map((block) => ({
    provider: ANTHROPIC_BLOCK_FORMAT,
    type: block.type,
    data: { ...(block as Record<string, unknown>) },
  }));
}

/**
 * Rebuild an assistant turn's Anthropic content from stored blocks.
 * Returns `undefined` — so the caller falls back to `content` +
 * `toolCalls` — when there are no blocks, when any block belongs to
 * another provider's format, when a block is not a well-formed
 * assistant-turn block (its `data.type` must equal its `type`, and the
 * type must be one Anthropic returns on an assistant turn), or when the
 * blocks' `tool_use` ids differ from the message's `toolCalls` (the turn
 * was edited after the response, e.g. by a middleware or a recovered
 * stream call, so a verbatim replay would no longer match the tool
 * results that follow). The checks matter when a transcript comes from
 * outside the process (a client, a store): the block data is sent as is.
 */
export function fromProviderBlocks(
  blocks: ProviderContentBlock[] | undefined,
  toolCalls: ModelToolCallRequest[] | undefined,
): Anthropic.ContentBlockParam[] | undefined {
  if (!blocks || blocks.length === 0) {
    return undefined;
  }

  if (!blocks.every((block) => block.provider === ANTHROPIC_BLOCK_FORMAT && isReplayable(block))) {
    return undefined;
  }

  const blockToolIds = blocks
    .filter((block) => TOOL_USE_BLOCK_TYPES.has(block.type))
    .map((block) => block.data.id);
  const requestedIds = (toolCalls ?? []).map((toolCall) => toolCall.id);

  if (
    blockToolIds.length !== requestedIds.length ||
    blockToolIds.some((id, index) => id !== requestedIds[index])
  ) {
    return undefined;
  }

  return blocks.map((block) => ({ ...block.data }) as unknown as Anthropic.ContentBlockParam);
}

function needsVerbatimReplay(block: { type: string }): boolean {
  if (!NEUTRAL_BLOCK_TYPES.has(block.type)) {
    return true;
  }

  const citations = (block as { citations?: unknown }).citations;

  return Array.isArray(citations) && citations.length > 0;
}

function isReplayable(block: ProviderContentBlock): boolean {
  const data = block.data as unknown;

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }

  if ((data as { type?: unknown }).type !== block.type) {
    return false;
  }

  return REPLAYABLE_BLOCK_TYPES.has(block.type) || SERVER_TOOL_RESULT_TYPE.test(block.type);
}
