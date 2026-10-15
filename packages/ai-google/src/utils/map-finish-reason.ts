import type { FinishReason } from "@warlock.js/ai";

const finishReasonMap: Record<string, FinishReason> = {
  STOP: "stop",
  MAX_TOKENS: "length",
};

/**
 * Map Gemini's `FinishReason` enum value to the normalized
 * `FinishReason` union.
 *
 * `STOP` is the natural terminal. `MAX_TOKENS` maps to `length`.
 * Everything else — `SAFETY`, `RECITATION`, `BLOCKLIST`,
 * `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`,
 * `UNEXPECTED_TOOL_CALL`, `LANGUAGE`, `OTHER`,
 * `FINISH_REASON_UNSPECIFIED`, `null`, or any future value — falls
 * through to `"error"`.
 *
 * Note: Gemini reports `STOP` even when the turn ended in a function
 * call (it has no `tool_use` reason). `GoogleModel` overrides the
 * mapped reason to `"tool_calls"` when the response carries function
 * calls — this map intentionally stays purely about the raw signal.
 *
 * @example
 * mapFinishReason("STOP");        // "stop"
 * mapFinishReason("MAX_TOKENS");  // "length"
 * mapFinishReason("SAFETY");      // "error"
 * mapFinishReason(undefined);     // "error"
 */
export function mapFinishReason(raw: string | null | undefined): FinishReason {
  return finishReasonMap[raw ?? ""] ?? "error";
}
