/*
 * Context windows of Mistral chat models. The Large, Medium, Small,
 * Ministral, Pixtral and Magistral families use the 128K figure documented
 * for their long-standing releases (newer generations document more; set it
 * per model). Codestral documents 256K.
 * The longest matching fragment wins; ids that match nothing resolve to `undefined`, so a
 * window-relative trigger stays inert until the window is set with
 * `mistral.model({ name, contextWindow })`.
 */
const KNOWN_WINDOWS: ReadonlyArray<readonly [fragment: string, window: number]> = [
  ["mistral-large", 128_000],
  ["mistral-medium", 128_000],
  ["mistral-small", 128_000],
  ["ministral", 128_000],
  ["pixtral", 128_000],
  ["magistral", 128_000],
  ["open-mistral", 128_000],
  ["codestral", 256_000],
];

/**
 * The known context window (tokens, input plus output) of a Mistral chat
 * model id, or `undefined` when it is not in the table.
 *
 * @example
 * inferContextWindow("mistral-large"); // → 128000
 */
export function inferContextWindow(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  let best: readonly [string, number] | undefined;

  for (const entry of KNOWN_WINDOWS) {
    const fragment = entry[0];

    if (id.includes(fragment) && (!best || fragment.length > best[0].length)) {
      best = entry;
    }
  }

  return best?.[1];
}
