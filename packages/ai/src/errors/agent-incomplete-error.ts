import { AgentExecutionError } from "./agent-execution-error";
import type { AIErrorOptions } from "./ai-error";
import type { ErrorCategory } from "./error-category.type";

/**
 * Why an agent run stopped before the model finished its answer.
 *
 * - `"output_limit"` — the final trip hit the response's output token cap
 *   (`finishReason: "length"`, Anthropic `max_tokens`).
 * - `"context_window"` — the conversation filled the model's context
 *   window (`finishReason: "context_exceeded"`).
 */
export type AgentIncompleteReason = "output_limit" | "context_window";

/** Payload for {@link AgentIncompleteError}. */
export type AgentIncompleteErrorOptions = AIErrorOptions & {
  reason: AgentIncompleteReason;
  /** Index of the trip whose response was cut off. */
  tripIndex: number;
  /** Continuation turns the run already sent before giving up. Default `0`. */
  continuations?: number;
};

/**
 * The model's final response was cut off — by the output token cap or by
 * the context window — so the run has no complete answer. Surfaced on
 * `result.error` (never thrown) with `report.status: "incomplete"`;
 * `result.text` still carries whatever partial text arrived.
 *
 * A tool call the model was still writing when the output was cut off is
 * never executed; it is listed on the trip's `truncatedToolCalls`.
 *
 * Opt into automatic recovery from the output cap with
 * `continueOnOutputLimit` (agent config or per call): the agent sends a
 * continue turn and joins the text. A full context window is never
 * continued — compact or trim the history instead.
 *
 * @example
 * const result = await agent.execute(input);
 *
 * if (result.error instanceof AgentIncompleteError) {
 *   logger.warn("answer cut off", {
 *     reason: result.error.reason,
 *     trip: result.error.tripIndex,
 *   });
 * }
 */
export class AgentIncompleteError extends AgentExecutionError {
  public static readonly defaultCategory: ErrorCategory = "incomplete";

  public readonly reason: AgentIncompleteReason;
  public readonly tripIndex: number;
  public readonly continuations: number;

  public constructor(message: string, options: AgentIncompleteErrorOptions) {
    super(message, options, "AGENT_INCOMPLETE");
    this.name = "AgentIncompleteError";
    this.reason = options.reason;
    this.tripIndex = options.tripIndex;
    this.continuations = options.continuations ?? 0;
  }
}
