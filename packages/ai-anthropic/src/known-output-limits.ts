import { matchesReleaseRoot } from "./thinking-mode";

/*
 * Documented maximum output tokens (`max_tokens`) on the synchronous
 * Messages API. Source: Anthropic's model pages and models overview,
 * platform.claude.com/docs/en/about-claude/models/overview and
 * …/models/{opus-4-5,sonnet-4-5,haiku-4-5}/overview, checked 2026-10-17.
 *
 * | Model ids                                                    | Max output |
 * |--------------------------------------------------------------|------------|
 * | Claude 5 family: fable-5 / 5.1, mythos-5 / 5.1, opus-5 / 5.5, | 128K       |
 * | sonnet-5 / 5.5, haiku-5-5                                    |            |
 * | claude-opus-4-8, claude-opus-4-7, claude-opus-4-6,           | 128K       |
 * | claude-sonnet-4-6                                            |            |
 * | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5         | 64K        |
 *
 * Older models (Claude 3.x, Opus 4 / 4.1, Sonnet 4) are retired and have no
 * entry; like any id not listed they fall back to the adapter default.
 */

/** Family prefixes whose every release has a 128K output limit. */
const FAMILY_128K_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-5",
];

/** Individual releases, matched as a release root (dated / `@` variants included). */
const RELEASE_OUTPUT_LIMITS: ReadonlyArray<readonly [root: string, limit: number]> = [
  ["claude-opus-4-8", 128_000],
  ["claude-opus-4-7", 128_000],
  ["claude-opus-4-6", 128_000],
  ["claude-sonnet-4-6", 128_000],
  ["claude-opus-4-5", 64_000],
  ["claude-sonnet-4-5", 64_000],
  ["claude-haiku-4-5", 64_000],
];

/**
 * The documented maximum output tokens of a Claude model, or `undefined`
 * when the id is not a known Claude model. Platform prefixes before
 * `claude-` (`anthropic.`, `us.anthropic.`) and dated or `@` snapshot
 * suffixes are accepted, so the Bedrock / Google Cloud ids of a known
 * model resolve too. Override per model with
 * `anthropic.model({ name, maxOutputTokens })`.
 *
 * @example
 * inferMaxOutputTokens("claude-opus-5-5");           // → 128000
 * inferMaxOutputTokens("claude-haiku-4-5-20251001"); // → 64000
 * inferMaxOutputTokens("my-gateway/model");          // → undefined
 */
export function inferMaxOutputTokens(modelName: string): number | undefined {
  const lowered = modelName.toLowerCase();
  const start = lowered.indexOf("claude-");

  if (start === -1) {
    return undefined;
  }

  const normalized = lowered.slice(start);

  if (FAMILY_128K_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return 128_000;
  }

  for (const [root, limit] of RELEASE_OUTPUT_LIMITS) {
    if (matchesReleaseRoot(normalized, root)) {
      return limit;
    }
  }

  return undefined;
}
