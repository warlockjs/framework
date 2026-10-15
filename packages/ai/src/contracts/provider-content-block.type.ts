/**
 * One raw content block exactly as a provider returned it, kept so the
 * next request can replay the assistant turn verbatim.
 *
 * The neutral `content` string and `toolCalls` list cannot carry every
 * block a provider emits: Anthropic thinking, redacted-thinking and
 * compaction blocks have no neutral equivalent, and several features
 * (preserved thinking, server-side compaction) only work when the
 * assistant turn is sent back unchanged. Adapters attach the full,
 * ordered block list as `ModelResponse.blocks`; the agent copies it onto
 * the assistant `Message.blocks`; the same adapter replays it on the next
 * call instead of rebuilding the turn from `content` + `toolCalls`.
 *
 * `provider` names the wire format the block belongs to (not the
 * `ModelContract.provider` label, which may name a gateway). An adapter
 * only replays blocks in its own format and falls back to `content` +
 * `toolCalls` otherwise, so switching models mid-conversation stays safe.
 *
 * @example
 * const block: ProviderContentBlock = {
 *   provider: "anthropic",
 *   type: "thinking",
 *   data: { type: "thinking", thinking: "", signature: "EqQBCg..." },
 * };
 */
export type ProviderContentBlock = {
  /** Wire format the block belongs to, e.g. `"anthropic"`. */
  provider: string;
  /** The provider's block type, e.g. `"thinking"`, `"redacted_thinking"`, `"compaction"`, `"text"`, `"tool_use"`. */
  type: string;
  /** The block as the provider returned it; replayed verbatim. */
  data: Record<string, unknown>;
};
