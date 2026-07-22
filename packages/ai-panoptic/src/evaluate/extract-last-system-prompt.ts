import type { TraceSpan } from "../contracts/trace.type";

/**
 * Pull the LAST `{role: "system"}` message off a span's captured `input`.
 *
 * Only present under `captureContent` (off by default), and only shaped
 * this way for non-tool spans — either the `[system, user]` first-trip pair
 * or, under `fullHistory`, the full `CapturedMessage[]` conversation (see
 * `collector/report-to-span.ts`). "Last" (not "only") matters for
 * `fullHistory`: a long-running agent can carry more than one system-role
 * turn, and the most recent one is the one actually in effect. Returns
 * `undefined` for a tool span, an agent with no system prompt, or when
 * content capture is off — the caller treats that as "nothing to evaluate."
 */
export function extractLastSystemPrompt(span: TraceSpan): string | undefined {
  if (!Array.isArray(span.input)) {
    return undefined;
  }

  for (let index = span.input.length - 1; index >= 0; index -= 1) {
    const entry = span.input[index] as { role?: unknown; content?: unknown };

    if (entry && typeof entry === "object" && entry.role === "system") {
      return typeof entry.content === "string" ? entry.content : undefined;
    }
  }

  return undefined;
}
