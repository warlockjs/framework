import type { RedactConfig } from "@warlock.js/logger";
import type { ToolUseContractEvent } from "../agent/tool-use-contract";
import type { FinishReason } from "../contracts/finish-reason.type";
import type { ReportStatus } from "../contracts/result/base-report.type";
import type { Usage } from "../contracts/result/usage.type";

/** Where the trace of a run stands. */
export type AgentTraceStatus = "running" | "completed" | "failed" | "cancelled" | "incomplete";

/** A tool offered to the model on one turn. */
export type AgentTraceToolOffer = {
  name: string;
  /** Hash of the name, description and JSON Schema as sent. Equal hashes mean identical definitions. */
  schemaHash: string;
  /** Estimated input tokens this definition adds to the turn. */
  tokens: number;
};

/** The full definition behind a {@link AgentTraceToolOffer.schemaHash}; kept once per trace. */
export type AgentTraceToolSchema = {
  name: string;
  description: string;
  /** The JSON Schema as sent, serialized. Absent when text is not kept. */
  schema?: string;
};

/** One tool call of a turn. */
export type AgentTraceToolCall = {
  callId?: string;
  name: string;
  status: ReportStatus;
  durationMs: number;
  /** The arguments the model sent (redacted, long strings cut). */
  input: unknown;
  /** The tool's result (redacted, long strings cut). */
  output?: unknown;
  error?: { type: string; message: string };
  /** Why the tool refused the call, when it did. */
  refusal?: string;
};

/** One model call and the tools it triggered. */
export type AgentTraceTurn = {
  index: number;
  startedAt: string;
  durationMs: number;
  /** What started the turn: the user input, `[tool results]` or `[continue]`. */
  input: string;
  finishReason?: FinishReason;
  /** Hash of the system messages sent on this turn. */
  systemPromptHash?: string;
  /** Hash of the tools offered on this turn (names and schema hashes). */
  toolsHash: string;
  toolsOffered: AgentTraceToolOffer[];
  /** The model's text on this turn; absent when text is not kept. */
  text?: string;
  toolCalls: AgentTraceToolCall[];
  usage: Usage;
  /** USD cost of this turn when the model has pricing. */
  cost?: number;
  error?: { type: string; message: string };
  /** What the tool-use contract (act-when-asked, refusal retry, backstops) did on this turn. */
  contract: ToolUseContractEvent[];
};

/**
 * Everything one agent run did, turn by turn: the system prompt, the tools
 * offered, tool calls, results and refusals, retries and re-prompts, token
 * usage and cost. Recorded in development by default; see
 * {@link AgentTraceOptions}.
 */
export type AgentTrace = {
  schemaVersion: 1;
  runId: string;
  /** The agent's name. */
  agent: string;
  version?: string;
  model: { name: string; provider: string };
  sessionId?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: AgentTraceStatus;
  /** The user input of the run (redacted, long strings cut). */
  input: string;
  systemPrompt?: { hash: string; text?: string };
  /** Tool definitions by schema hash. */
  toolSchemas: Record<string, AgentTraceToolSchema>;
  turns: AgentTraceTurn[];
  usage: Usage;
  /** USD cost of the run when the model has pricing. */
  cost?: number;
  error?: { type: string; message: string };
};

/** What {@link AgentTraceStore.subscribe} listeners receive. */
export type AgentTraceEvent = {
  runId: string;
  status: AgentTraceStatus;
};

/**
 * `AgentConfig.trace`. `true` records with the defaults, `false` records
 * nothing; leave it out for the default: record in development, nothing
 * under test or in production.
 */
export type AgentTraceOptions = {
  /** Record this agent's runs. Default: development only. */
  enabled?: boolean;
  /**
   * Keep text: the system prompt, tool schemas and model replies (diffable
   * across runs). Off, only hashes, names, sizes and tool arguments remain.
   * Default: development only.
   */
  text?: boolean;
  /**
   * Redaction applied to the whole trace before it is stored. The logger's
   * default secret keys (`password`, `token`, `authorization`, ...) and any
   * credential registered with `registerLogSecret` are always censored.
   */
  redact?: RedactConfig;
  /** Longest string kept in tool arguments, results and replies. Default `8000`. */
  maxStringLength?: number;
  /** Where to record. Default: the shared `agentTraces` store. */
  store?: AgentTraceStore;
};

/** A bounded, in-memory store of agent traces. */
export type AgentTraceStore = {
  /** Add or replace the trace for its run id. */
  publish(trace: AgentTrace): void;
  /** One trace by run id. */
  get(runId: string): AgentTrace | undefined;
  /** Stored traces, newest first. */
  list(filter?: { agent?: string; status?: AgentTraceStatus; limit?: number }): AgentTrace[];
  /** Notified after every publish; returns the unsubscribe function. */
  subscribe(listener: (event: AgentTraceEvent) => void): () => void;
  /** Drop every stored trace. */
  clear(): void;
  /** Runs kept before the oldest is dropped. */
  readonly capacity: number;
};
