/*
 * Context windows of Grok chat models, from xAI's model documentation:
 * the Grok 4 fast and 4.1 fast releases document 2,000,000 tokens, Grok 4.3
 * and 4.20 1,000,000, Grok 4.5 to 4.7 500,000, Grok 4, Grok Build and
 * Grok Code Fast 256,000, Grok 3 and Grok 2 131,072, and Grok 2 Vision 32,768.
 * The longest matching prefix wins; ids that match nothing resolve to `undefined`, so a
 * window-relative trigger stays inert until the window is set with
 * `xai.model({ name, contextWindow })`.
 */
const KNOWN_WINDOWS: ReadonlyArray<readonly [prefix: string, window: number]> = [
  ["grok-4-fast", 2_000_000],
  ["grok-4-1-fast", 2_000_000],
  ["grok-4.1-fast", 2_000_000],
  ["grok-4", 256_000],
  ["grok-4.20", 1_000_000],
  ["grok-4.3", 1_000_000],
  ["grok-4.5", 500_000],
  ["grok-4.6", 500_000],
  ["grok-4.7", 500_000],
  ["grok-build", 256_000],
  ["grok-code-fast", 256_000],
  ["grok-3", 131_072],
  ["grok-2", 131_072],
  ["grok-2-vision", 32_768],
];

/**
 * The known context window (tokens, input plus output) of a Grok chat
 * model id, or `undefined` when it is not in the table.
 *
 * @example
 * inferContextWindow("grok-4-fast"); // → 2000000
 */
export function inferContextWindow(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  let best: readonly [string, number] | undefined;

  for (const entry of KNOWN_WINDOWS) {
    const prefix = entry[0];

    if (id.startsWith(prefix) && (!best || prefix.length > best[0].length)) {
      best = entry;
    }
  }

  return best?.[1];
}
