/*
 * Context windows of OpenAI models with a documented, stable size. Longest
 * prefix wins; ids that match nothing resolve to `undefined`, so a
 * window-relative trigger stays inert until the window is set with
 * `openai.model({ name, contextWindow })`.
 */
const PREFIX_WINDOWS: ReadonlyArray<readonly [prefix: string, window: number]> = [
  ["gpt-5-", 400_000],
  // The gpt-5.x and gpt-6 releases use the 400K figure every gpt-5 model
  // documents; a larger window on a later release is set with `contextWindow`.
  ["gpt-5.", 400_000],
  ["gpt-6", 400_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-3.5-turbo", 16_385],
  ["chatgpt-4o", 128_000],
  ["o3-mini", 200_000],
  ["o3-pro", 200_000],
  ["o1-pro", 200_000],
  ["gpt-4.1", 1_047_576],
  ["gpt-5-chat", 128_000],
  ["gpt-4o", 128_000],
  ["o4-mini", 200_000],
  ["o3", 200_000],
  ["o1", 200_000],
  ["o1-mini", 128_000],
  ["o1-preview", 128_000],
];

/**
 * The known context window of a direct-OpenAI model id, or `undefined`.
 *
 * @example
 * inferContextWindow("gpt-4.1-mini"); // → 1047576
 */
export function inferContextWindow(modelName: string): number | undefined {
  const id = modelName.toLowerCase();
  if (id === "gpt-5") return 400_000;
  if (id === "gpt-4") return 8_192;

  let best: readonly [string, number] | undefined;

  for (const entry of PREFIX_WINDOWS) {
    if (id.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) {
      best = entry;
    }
  }

  return best?.[1];
}
