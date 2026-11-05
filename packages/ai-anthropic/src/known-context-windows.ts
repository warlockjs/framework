import { matchesReleaseRoot } from "./thinking-mode";

/*
 * Context windows (input + output tokens) of Claude chat models, from
 * Anthropic's model overview. Releases from the 4.6 line on, and every
 * Claude 5 family, document a 1M window; earlier releases a 200K standard
 * window (the optional larger window of some of them is not assumed). Models
 * not listed here resolve to `undefined`, so a window-relative trigger stays
 * inert until the window is set with `anthropic.model({ name, contextWindow })`.
 * More specific roots come before the roots they extend.
 */
const RELEASE_CONTEXT_WINDOWS: ReadonlyArray<readonly [root: string, window: number]> = [
  ["claude-fable-5-1", 1_000_000],
  ["claude-fable-5", 1_000_000],
  ["claude-mythos-5-1", 1_000_000],
  ["claude-mythos-5", 1_000_000],
  ["claude-opus-5-5", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-opus-4-5", 200_000],
  ["claude-opus-4-1", 200_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-5-5", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-4-5", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-5-5", 1_000_000],
  ["claude-haiku-4-5", 200_000],
  ["claude-3-7-sonnet", 200_000],
  ["claude-3-5-sonnet", 200_000],
  ["claude-3-5-haiku", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-haiku", 200_000],
];

/**
 * The known context window of a Claude model, or `undefined` for an id that
 * is not in the table. Platform prefixes before `claude-` and dated or `@`
 * snapshot suffixes are accepted.
 *
 * @example
 * inferContextWindow("claude-haiku-4-5-20251001"); // → 200000
 * inferContextWindow("my-gateway/model");          // → undefined
 */
export function inferContextWindow(modelName: string): number | undefined {
  const lowered = modelName.toLowerCase();
  const start = lowered.indexOf("claude-");

  if (start === -1) {
    return undefined;
  }

  const normalized = lowered.slice(start);

  for (const [root, window] of RELEASE_CONTEXT_WINDOWS) {
    if (matchesReleaseRoot(normalized, root)) {
      return window;
    }
  }

  return undefined;
}
