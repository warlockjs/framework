/*
 * Context windows of DeepSeek chat models. `deepseek-chat` and
 * `deepseek-reasoner` document 128K tokens. The `deepseek-v4-*` ids use the
 * same conservative 128K figure; a larger window is set per model.
 * The longest matching prefix wins; ids that match nothing resolve to `undefined`, so a
 * window-relative trigger stays inert until the window is set with
 * `deepseek.model({ name, contextWindow })`.
 */
const KNOWN_WINDOWS: ReadonlyArray<readonly [prefix: string, window: number]> = [
  ["deepseek-chat", 128_000],
  ["deepseek-reasoner", 128_000],
  ["deepseek-v4", 128_000],
];

/**
 * The known context window (tokens, input plus output) of a DeepSeek chat
 * model id, or `undefined` when it is not in the table.
 *
 * @example
 * inferContextWindow("deepseek-chat"); // → 128000
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
