import type { FinishReason } from "@warlock.js/ai";

const stopReasonMap: Record<string, FinishReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
};

/**
 * Map Bedrock Converse's `stopReason` to the normalized `FinishReason`
 * union.
 *
 * `end_turn` / `stop_sequence` are natural stops. `max_tokens` maps to
 * `length`. `tool_use` maps to `tool_calls`. Everything else —
 * `content_filtered`, `guardrail_intervened`, `malformed_tool_use`,
 * `malformed_model_output`, `model_context_window_exceeded`, `null`,
 * or any future value — falls through to `"error"`: none produced a
 * clean terminal answer, so the agent must not treat them as success.
 *
 * @example
 * mapStopReason("end_turn");              // "stop"
 * mapStopReason("tool_use");              // "tool_calls"
 * mapStopReason("guardrail_intervened");  // "error"
 * mapStopReason(undefined);               // "error"
 */
export function mapStopReason(raw: string | null | undefined): FinishReason {
  return stopReasonMap[raw ?? ""] ?? "error";
}
