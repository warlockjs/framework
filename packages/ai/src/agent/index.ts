export { agent, type JudgeAgentConfig } from "./agent";
export type { AgentConfig } from "./agent-config.type";
export { JUDGE_DEFAULT_REPAIR_ATTEMPTS, type JudgeConfig } from "./judge-config.type";
export { createAgentStream } from "./agent-stream";
export type { StreamController } from "./agent-stream";
export { spawnSubAgent } from "./spawn-sub-agent";
export type { SpawnSubAgentSpec } from "./spawn-sub-agent";

export type {
  AgentCompactionConfig,
  AgentCompactionContext,
  AgentCompactionRecord,
} from "./compaction.type";
export { DEFAULT_CLEARED_TOOL_RESULT } from "./context-editing.type";
export type {
  AgentContextEditingConfig,
  ClearToolResultsConfig,
  ContextEditRecord,
} from "./context-editing.type";
export type { AgentStopContext, AgentStopWhen } from "./stop-turn.type";
export {
  DEFAULT_COMPACTION_INSTRUCTIONS,
  renderTranscript,
  summarizeCompaction,
  type CompactionSummarizer,
  type CompactionSummarizerOptions,
} from "./compaction-summarizer";

export {
  defaultActHint,
  defaultRefusalHint,
  matchesIntent,
  refusalReason,
  requiredToolsCalled,
} from "./tool-use-contract";
export type {
  ActWhenAskedConfig,
  ActWhenAskedHintContext,
  AgentBackstop,
  BackstopContext,
  BackstopOutcome,
  BackstopPhase,
  BackstopTurn,
  IntentMatcher,
  ToolRefusalConfig,
  ToolRefusalHintContext,
  ToolRefusalOption,
  ToolUseContractEvent,
} from "./tool-use-contract";
