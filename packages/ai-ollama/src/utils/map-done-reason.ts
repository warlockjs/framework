import type { FinishReason } from "@warlock.js/ai";

const doneReasonMap: Record<string, FinishReason> = {
  stop: "stop",
  length: "length",
};

/**
 * Map Ollama's `done_reason` to the normalized `FinishReason` union.
 *
 * `stop` is the natural terminal; `length` means the `num_predict`
 * cap was hit. Anything else — `load` (model load only, no
 * generation), an empty string, or any future value — falls through
 * to `"error"`.
 *
 * Note: Ollama has no tool-use done reason — it sets `done_reason:
 * "stop"` and populates `message.tool_calls`. `OllamaModel` derives
 * `"tool_calls"` from tool-call presence; this map stays purely about
 * the raw signal.
 *
 * @example
 * mapDoneReason("stop");    // "stop"
 * mapDoneReason("length");  // "length"
 * mapDoneReason("load");    // "error"
 * mapDoneReason(undefined); // "error"
 */
export function mapDoneReason(raw: string | null | undefined): FinishReason {
  return doneReasonMap[raw ?? ""] ?? "error";
}
