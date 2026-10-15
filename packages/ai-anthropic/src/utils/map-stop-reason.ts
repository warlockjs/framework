import type { FinishReason } from "@warlock.js/ai";

const stopReasonMap: Record<string, FinishReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  // Beta compaction (`compact-2026-09-04`): the turn ends with a signed
  // `compaction` block and nothing is sampled after it. A clean stop —
  // the block itself is on `ModelResponse.blocks`.
  compaction: "stop",
  max_tokens: "length",
  model_context_window_exceeded: "context_exceeded",
  pause_turn: "pause_turn",
  refusal: "refusal",
  tool_use: "tool_calls",
};

/**
 * Map Anthropic's `stop_reason` to the normalized `FinishReason` union.
 *
 * `end_turn` / `stop_sequence` (and beta `compaction`) are natural stops,
 * `max_tokens` maps to `length`, `tool_use` to `tool_calls`.
 * `model_context_window_exceeded`, `pause_turn` and `refusal` keep their
 * own reasons (`context_exceeded`, `pause_turn`, `refusal`) because each
 * needs a different reaction: compact the history, send the turn back to
 * resume, or fall back to another model. `null` and any value a future
 * API version adds fall through to `"error"`.
 *
 * @example
 * mapStopReason("end_turn");   // "stop"
 * mapStopReason("tool_use");   // "tool_calls"
 * mapStopReason("refusal");    // "refusal"
 * mapStopReason("pause_turn"); // "pause_turn"
 * mapStopReason(null);         // "error"
 */
export function mapStopReason(raw: string | null | undefined): FinishReason {
  return stopReasonMap[raw ?? ""] ?? "error";
}
