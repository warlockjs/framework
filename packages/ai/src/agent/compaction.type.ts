import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import type { SummarizeCallback } from "../contracts/orchestrator/orchestrator-config.type";
import type { CompactionResult } from "../contracts/result/orchestrator-result.type";
import type { TokenTrigger } from "./token-trigger";

export type AgentCompactionContext = {
  tripIndex: number;
  inputTokens: number;
  counting: "estimate" | "custom";
  signal?: AbortSignal;
};

/** Optional automatic compaction of settled history before each model trip. */
export type AgentCompactionConfig = {
  /**
   * Input size that triggers compaction: an absolute token count, or
   * `{ share, reserve?, max? }` relative to the model's
   * `capabilities.contextWindow`. A window-relative trigger on a model
   * with an unknown window never fires; one `unknown-window` skip is recorded.
   */
  afterTokens: TokenTrigger;
  /** Minimum recent message count to preserve, expanded to keep complete tool groups. Default 8. */
  keep?: number;
  /**
   * Receives a detached, safe old slice. Return an assistant text summary replacing
   * the entire slice (indices 0 through history.length - 1). A first-turn summary
   * is framed as user context before generation, and so is any summary
   * followed by kept turns that carry signed reasoning (thinking blocks).
   * The callback owns its model calls, billing and usage; no hidden
   * summarizer is invoked by the agent. `ai.compaction.summarize({ model })`
   * builds a ready-made callback.
   */
  summarize: (history: Message[], context: AgentCompactionContext) => ReturnType<SummarizeCallback>;
  /**
   * Optional exact/custom counter. Receives the current messages and the same
   * options generation uses. Omit for an offline character-based estimate.
   */
  countTokens?: (messages: Message[], options: ModelCallOptions) => Promise<number> | number;
};

/** A compaction decision or counter failure, recorded on reports and durable snapshots. */
export type AgentCompactionRecord = Omit<AgentCompactionContext, "signal" | "inputTokens"> & {
  /** Absent when the counter failed before producing a value. */
  inputTokens?: number;
  type: "applied" | "skipped";
  /** Original live-conversation indices of the replaced range. */
  compaction?: CompactionResult;
  /** Estimated input tokens of the summariser request, when the callback reports it. */
  summarizerInputTokens?: number;
  /** Model calls the summariser needed, when the callback reports it. */
  attempts?: number;
  reason?: "no-safe-range" | "not-smaller" | "callback-error" | "unknown-window";
  error?: string;
};
