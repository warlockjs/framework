import type { AIError } from "../../errors/ai-error";
import type { AgentResult } from "../result/agent-result.type";
import type { LLMTrip } from "../result/llm-trip.type";
import type { ToolCall } from "../result/tool-call.type";
import type { Usage } from "../result/usage.type";

/**
 * Lightweight tool metadata surfaced on tool-lifecycle events. A
 * deliberately thin slice of `ToolConfig` — name and description
 * for identity, plus the resolved present-progressive `action`
 * string for streaming UX. Wrapped tools may carry heavy state
 * (validated schemas, captured closures, large `meta` blocks); we
 * keep events serializable and cheap by omitting all of that.
 */
export type ToolEventMeta = {
  /** Tool name as exposed to the LLM. */
  name: string;
  /** Tool description (the same string the LLM sees). */
  description: string;
  /**
   * Resolved status string for UI display. The framework resolves
   * `ToolConfig.action` (string or `(input) => string`) into a
   * plain string at emit time so consumers don't have to.
   * `undefined` when the tool didn't declare an `action`.
   */
  action?: string;
};

/** Agent is about to begin execution */
export type AgentStartingPayload = { input: string };

/** A new LLM trip is beginning */
export type AgentTripStartedPayload = { tripIndex: number; input: string };

/** Token delta received during streaming */
export type AgentStreamingPayload = { delta: string; tripIndex: number };

/**
 * Reasoning / thinking text received during streaming (`agent.stream()`
 * only, and only when the provider streams it — see the
 * `ModelStreamChunk` `reasoning` variant). Never part of the answer.
 */
export type AgentReasoningPayload = { delta: string; tripIndex: number };

/**
 * A piece of a tool call's argument JSON while the model writes it
 * (`agent.stream()` only, providers that stream arguments). The parsed
 * input arrives later on `agent.tool.calling` for the same `callId`.
 */
export type AgentToolStreamingPayload = {
  /** Tool call id; matches `ToolCall` / the later dispatch of this call. */
  callId: string;
  /** Tool name the model is calling. */
  name: string;
  /** Next piece of the raw argument JSON. */
  delta: string;
  tripIndex: number;
};

/**
 * Token counts so far for the current trip, reported mid-stream
 * (`agent.stream()` only, providers that report usage before the end).
 * A running total for this trip — the final count is on
 * `agent.trip.completed`.
 */
export type AgentTripUsagePayload = { usage: Usage; tripIndex: number };

/** LLM has requested a tool call */
export type AgentToolCallingPayload = {
  tool: ToolEventMeta;
  input: unknown;
  tripIndex: number;
};

/** Tool call completed successfully */
export type AgentToolCalledPayload = ToolCall & { tool: ToolEventMeta };

/** Tool call failed with an error */
export type AgentToolCallingFailedPayload = {
  tool: ToolEventMeta;
  input: unknown;
  error: AIError;
  tripIndex: number;
};

/** An LLM trip completed */
export type AgentTripCompletedPayload = { trip: LLMTrip };

/** Agent execution completed successfully */
export type AgentCompletedPayload<TOutput = unknown> = {
  result: AgentResult<TOutput>;
};

/** Agent execution failed */
export type AgentErrorPayload = { error: AIError };
