import type { ProviderContentBlock } from "../provider-content-block.type";
import type { BaseResult } from "./base-result.type";
import type { AgentReport } from "./execution-report.type";

/**
 * Result returned by `agent.execute()` and resolved by `stream.result`.
 *
 * **Canonical destructuring:** `const { data, text, report, usage, error }`.
 *
 * `report.trips` / `report.children` / `report.duration` hold
 * everything the old top-level fields did — tool dispatches live as
 * child nodes on `report.children` (filter `type === "tool"`), and
 * moving these under `report` leaves the root clean for the four
 * things callers reach for constantly (`data`, `text`, `usage`,
 * `error`).
 *
 * @example
 * const { data, error, report, usage } = await agent.execute(input);
 *
 * if (error) {
 *   logger.error(error.code, { duration: report.duration });
 *   return;
 * }
 *
 * return { answer: data, cost: usage.total, latency: report.duration };
 */
export type AgentResult<TOutput = unknown> = BaseResult & {
  /** Discriminant for narrowing `SessionSendResult.executionResult`. */
  type: "agent";
  /** Typed structured output when the caller passed an `output` schema. */
  data?: TOutput;
  /** Raw text from the final LLM trip. */
  text?: string;
  /**
   * The final trip's raw provider blocks (thinking, compaction, …), set
   * only when the run was a single trip and the adapter returned them —
   * then `{ role: "assistant", content: text, blocks }` is the whole
   * turn. A multi-trip run's final thinking is signed against the
   * intermediate tool-call turns, which `text` does not include: to keep
   * blocks across runs, run with `captureMessages: true` and store
   * `report.messages` (without its system turn) plus the last trip's
   * `output` and `blocks`.
   */
  blocks?: ProviderContentBlock[];
  /** Trips, tool calls, status, and timing for this execution. */
  report: AgentReport;
};
