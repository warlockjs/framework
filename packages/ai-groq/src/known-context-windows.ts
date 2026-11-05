/*
 * Context windows of the chat models Groq hosts, from its model catalog:
 * the Llama, gpt-oss, Qwen3 and DeepSeek-R1 distill ids document 131,072
 * tokens, Kimi K2 262,144.
 * The longest matching fragment wins; ids that match nothing resolve to `undefined`, so a
 * window-relative trigger stays inert until the window is set with
 * `groq.model({ name, contextWindow })`.
 */
const KNOWN_WINDOWS: ReadonlyArray<readonly [fragment: string, window: number]> = [
  ["llama-3", 131_072],
  ["llama-4", 131_072],
  ["gpt-oss", 131_072],
  ["qwen3", 131_072],
  ["deepseek-r1-distill", 131_072],
  ["kimi-k2", 262_144],
];

/**
 * The known context window (tokens, input plus output) of a Groq-hosted chat
 * model id, or `undefined` when it is not in the table.
 *
 * @example
 * inferContextWindow("llama-3"); // → 131072
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
