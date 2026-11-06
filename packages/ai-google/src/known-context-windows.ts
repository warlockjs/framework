/*
 * Input context windows of Gemini families documented at 1,048,576 tokens (and 2,097,152 for 1.5 Pro);
 * Gemini 4 documents "1M tokens" and uses the same figure.
 * Other ids resolve to `undefined`; set them with
 * `google.model({ name, contextWindow })`.
 */
const WINDOW_1M_PREFIXES = [
  "gemini-4",
  "gemini-3",
  "gemini-2.5-",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

/** Gemini 1.5 Pro documents a 2,097,152-token input window. */
const WINDOW_2M_PREFIXES = ["gemini-1.5-pro"];

/**
 * The known context window of a Gemini model id, or `undefined` when it is
 * not in the table. A leading `models/` is accepted.
 *
 * @example
 * inferContextWindow("gemini-2.5-flash"); // → 1048576
 */
export function inferContextWindow(modelName: string): number | undefined {
  const id = modelName.toLowerCase().replace(/^models\//, "");

  if (WINDOW_2M_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return 2_097_152;
  }

  return WINDOW_1M_PREFIXES.some((prefix) => id.startsWith(prefix)) ? 1_048_576 : undefined;
}
