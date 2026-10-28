import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";

/** Placeholder that replaces a cleared tool result. */
export const DEFAULT_CLEARED_TOOL_RESULT = "[tool result cleared to save context]";

/**
 * Clear old tool results from the history sent to the model. The most
 * recent `keep` results stay; older ones are replaced by a short
 * placeholder, so the model still sees which tool ran, with which
 * arguments, but not the (often large) output.
 */
export type ClearToolResultsConfig = {
  /**
   * Start clearing once the history is estimated at this many input
   * tokens. Omit to clear on every trip, whatever the size.
   */
  afterTokens?: number;
  /** How many of the most recent tool results stay intact. Default 3. */
  keep?: number;
  /** Tool names whose results are never cleared. */
  exclude?: string[];
  /** Text that replaces a cleared result. */
  placeholder?: string;
  /**
   * Exact/custom token counter used for `afterTokens`. Omit for the
   * offline character-based estimate.
   */
  countTokens?: (messages: Message[], options: ModelCallOptions) => Promise<number> | number;
};

/**
 * Provider-neutral context editing for an agent: trims the history
 * before each model call, without a summarising model call. Pair it with
 * `compaction` when the history can still outgrow the window after
 * clearing (editing runs first).
 *
 * When the model advertises `capabilities.nativeContextEditing` (the
 * Anthropic adapter does), the agent hands the rule to the provider
 * (`clear_tool_uses`) and skips the client-side edit, which also keeps
 * the provider's prompt cache valid. Set `native: false` to always edit
 * on the client.
 *
 * @example
 * agent({
 *   model,
 *   tools,
 *   contextEditing: { clearToolResults: { afterTokens: 60_000, keep: 4, exclude: ["plan"] } },
 * });
 */
export type AgentContextEditingConfig = {
  clearToolResults?: true | ClearToolResultsConfig;
  /** `false` forces client-side editing even on a provider with native support. Default `true`. */
  native?: boolean;
};

/** A client-side edit that was applied, recorded for logs. */
export type ContextEditRecord = {
  tripIndex: number;
  clearedResults: number;
  inputTokens: number;
};
