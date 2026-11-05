/*
 * Input context windows of Gemini families documented at 1,048,576 tokens.
 * Other ids resolve to `undefined`; set them with
 * `google.model({ name, contextWindow })`.
 */
const WINDOW_1M_PREFIXES = ["gemini-2.5-", "gemini-2.0-flash", "gemini-1.5-flash"];

/**
 * The known context window of a Gemini model id, or `undefined` when it is
 * not in the table. A leading `models/` is accepted.
 *
 * @example
 * inferContextWindow("gemini-2.5-flash"); // → 1048576
 */
export function inferContextWindow(modelName: string): number | undefined {
  const id = modelName.toLowerCase().replace(/^models\//, "");

  return WINDOW_1M_PREFIXES.some((prefix) => id.startsWith(prefix)) ? 1_048_576 : undefined;
}
