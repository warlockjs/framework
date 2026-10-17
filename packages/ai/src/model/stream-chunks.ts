import type { ModelCallOptions } from "../contracts/model.contract";

/** The optional stream chunk kinds a call asked for, resolved to booleans. */
export type ResolvedStreamChunks = {
  reasoning: boolean;
  toolArgs: boolean;
  usage: boolean;
};

/**
 * Resolve `ModelCallOptions.streamChunks` into one flag per optional chunk
 * kind. Absent or `false` turns everything off (the default, so existing
 * `model.stream()` consumers see no new chunk types); `true` turns
 * everything on; an object turns on only the kinds set to `true`.
 *
 * Adapters call it once at the start of `stream()` and yield `reasoning`,
 * `tool-args` and `usage` chunks only when the matching flag is on.
 *
 * @example
 * const want = resolveStreamChunks(options);
 * if (want.reasoning && delta.thinking) yield { type: "reasoning", delta: delta.thinking };
 */
export function resolveStreamChunks(options: ModelCallOptions | undefined): ResolvedStreamChunks {
  const raw = options?.streamChunks;

  if (raw === true) {
    return { reasoning: true, toolArgs: true, usage: true };
  }

  if (!raw || typeof raw !== "object") {
    return { reasoning: false, toolArgs: false, usage: false };
  }

  return {
    reasoning: raw.reasoning === true,
    toolArgs: raw.toolArgs === true,
    usage: raw.usage === true,
  };
}
