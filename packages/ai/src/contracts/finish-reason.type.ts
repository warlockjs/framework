/**
 * Reasons the LLM stopped generating. Shared across model responses,
 * streaming chunks, and LLM trip records.
 *
 * - `stop` — natural end of the turn (or a stop sequence).
 * - `tool_calls` — the model requested tools; dispatch them and continue.
 * - `length` — the output hit `maxTokens`.
 * - `context_exceeded` — the conversation filled the model's context
 *   window (Anthropic `model_context_window_exceeded`). Retrying with a
 *   bigger `maxTokens` does not help; compact or trim the history.
 * - `pause_turn` — the provider paused a long-running turn (Anthropic
 *   server tools). Send the assistant turn back unchanged to resume; the
 *   agent does this automatically within `maxTrips`.
 * - `tool_stop` — set on an agent trip by the agent itself, never by a
 *   provider: the tools that trip ran ended the run (`stopAfterTools`,
 *   `stopWhen` or a tool's `endsTurn`), so no further model call was made.
 *   The trip's `output` is whatever text the model wrote beside the calls.
 * - `refusal` — the provider's safety layer declined the request. Fall
 *   back to another model or surface the refusal; do not retry as-is.
 * - `error` — anything else, including unknown provider values.
 *
 * @example
 * const reason: FinishReason = "stop";
 *
 * @example
 * if (response.finishReason === "tool_calls") {
 *   // Execute requested tools and continue the trip loop
 * }
 */
export type FinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "context_exceeded"
  | "pause_turn"
  | "tool_stop"
  | "refusal"
  | "error";
