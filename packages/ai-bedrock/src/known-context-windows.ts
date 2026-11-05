/*
 * Context windows (input + output tokens) of the chat models Bedrock Converse
 * serves, matched as a lowercase substring so provider prefixes
 * (`anthropic.`), cross-region profile prefixes (`us.`, `eu.`, `global.`) and
 * date or `-v1:0` suffixes are all covered. The first matching entry wins, so
 * a specific id comes before the family it extends. Ids that match nothing
 * resolve to `undefined`, so a window-relative trigger stays inert until the
 * window is set with `bedrock.model({ name, contextWindow })`.
 *
 * Claude values are the standard windows of Anthropic's model overview (the
 * optional larger window of some earlier releases is not assumed).
 */
const KNOWN_WINDOWS: ReadonlyArray<readonly [fragment: string, window: number]> = [
  ["claude-fable-5", 1_000_000],
  ["claude-mythos-5", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-5", 1_000_000],
  ["claude-haiku-4", 200_000],
  ["claude-3", 200_000],
  ["nova-premier", 1_000_000],
  ["nova-2-lite", 1_000_000],
  ["nova-pro", 300_000],
  ["nova-lite", 300_000],
  ["nova-micro", 128_000],
  ["llama4-scout", 3_500_000],
  ["llama4-maverick", 1_000_000],
  ["llama3-3", 128_000],
  ["llama3-2", 128_000],
  ["llama3-1", 128_000],
  ["mistral-large-2402", 32_000],
  ["mistral-large", 128_000],
  ["pixtral-large", 128_000],
  ["mixtral-8x7b", 32_000],
  ["mistral-7b", 32_000],
  ["command-r", 128_000],
  ["jamba-1-5", 256_000],
  ["deepseek.r1", 128_000],
];

/**
 * The known context window (tokens, input plus output) of a Bedrock chat
 * model id, or `undefined` when it is not in the table.
 *
 * @example
 * inferContextWindow("us.amazon.nova-pro-v1:0");                    // → 300000
 * inferContextWindow("anthropic.claude-sonnet-4-5-20250929-v1:0");  // → 200000
 */
export function inferContextWindow(modelId: string): number | undefined {
  const id = modelId.toLowerCase();

  return KNOWN_WINDOWS.find(([fragment]) => id.includes(fragment))?.[1];
}
