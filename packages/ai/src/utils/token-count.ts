/**
 * Approximate the number of tokens in a string.
 *
 * Uses the ~4-characters-per-token heuristic, which is accurate enough for
 * GPT-4 family models and most English text. Use this when a real tokenizer
 * (tiktoken, etc.) isn't available or would add native dependencies.
 *
 * @example
 * const tokens = approximateTokenCount("Hello, world!"); // 4
 */
export function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Tokens charged for each image, PDF or audio part, whatever its byte length. */
export const MEDIA_PART_TOKENS = 1_000;

/**
 * Approximate the tokens of a JSON-serializable value (messages, tool
 * definitions) that may contain media parts. Each `image`, `pdf` or `audio`
 * part counts as {@link MEDIA_PART_TOKENS} rather than by the length of its
 * base64 or URL, since providers price media by pixels, pages or seconds and
 * not by encoded size.
 */
export function approximateJsonTokens(value: unknown): number {
  let mediaParts = 0;

  const json = JSON.stringify(value, (_key, val: unknown) => {
    if (typeof val === "object" && val !== null) {
      const part = val as { type?: unknown; source?: unknown };

      if (
        (part.type === "image" || part.type === "pdf" || part.type === "audio") &&
        typeof part.source === "object" &&
        part.source !== null
      ) {
        mediaParts += 1;

        return { type: part.type };
      }
    }

    return val;
  });

  return approximateTokenCount(json ?? "") + mediaParts * MEDIA_PART_TOKENS;
}
