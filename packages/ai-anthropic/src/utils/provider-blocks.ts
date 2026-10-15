import type { ModelToolCallRequest, ProviderContentBlock } from "@warlock.js/ai";
import type Anthropic from "@anthropic-ai/sdk";

/** The `ProviderContentBlock.provider` value this adapter writes and replays. */
export const ANTHROPIC_BLOCK_FORMAT = "anthropic";

/** Block types the neutral `content` + `toolCalls` fields already carry losslessly. */
const NEUTRAL_BLOCK_TYPES = new Set(["text", "tool_use"]);

/** Block types that carry a model-requested call whose id must match `toolCalls`. */
const TOOL_USE_BLOCK_TYPES = new Set(["tool_use"]);

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
 * another provider's format, or when the blocks' `tool_use` ids differ
 * from the message's `toolCalls` (the turn was edited after the response,
 * e.g. by a middleware or a recovered stream call, so a verbatim replay
 * would no longer match the tool results that follow).
 */
export function fromProviderBlocks(
  blocks: ProviderContentBlock[] | undefined,
  toolCalls: ModelToolCallRequest[] | undefined,
): Anthropic.ContentBlockParam[] | undefined {
  if (!blocks || blocks.length === 0) {
    return undefined;
  }

  if (!blocks.every((block) => block.provider === ANTHROPIC_BLOCK_FORMAT)) {
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
