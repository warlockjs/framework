import type { WorkspaceCommandPattern } from "../contracts";

/** The longest refusal reason passed on to the model, in characters. */
export const MAX_REFUSAL_REASON = 500;

/** Whether two command patterns are the same (strings by value, RegExps by source and flags). */
export function samePattern(a: WorkspaceCommandPattern, b: WorkspaceCommandPattern): boolean {
  if (typeof a === "string" || typeof b === "string") {
    return a === b;
  }

  return a.source === b.source && a.flags === b.flags;
}

/**
 * The tail of a refusal message for an owner's reason: `"."` without one,
 * otherwise `" — <reason>"` cut at {@link MAX_REFUSAL_REASON} characters with
 * a visible marker.
 */
export function refusalReason(reason: string | undefined): string {
  const text = typeof reason === "string" ? reason.trim() : "";

  if (text.length === 0) {
    return ".";
  }

  const shown =
    text.length > MAX_REFUSAL_REASON ? `${text.slice(0, MAX_REFUSAL_REASON)}… [truncated]` : text;

  return ` — ${shown}`;
}
