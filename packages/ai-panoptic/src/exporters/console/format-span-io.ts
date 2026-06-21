import type { TraceSpan } from "../../contracts";

/** Default cap on how many characters of captured content a console line shows. */
const DEFAULT_IO_MAX_CHARS = 500;

/**
 * Render a span's captured content ({@link TraceSpan.input} /
 * {@link TraceSpan.output}) as extra indented console lines, one level
 * below the span's own line:
 *
 * ```text
 *   ok agent "market-research" — 1794ms, 224 tok, $0.0008
 *       in:  Research the market for Acme Coffee Roasters …
 *       out: Demand is steady; specialty buyers skew premium …
 * ```
 *
 * Returns `[]` when the span carries no content — capture disabled, or a
 * composite node with no own I/O. Each value is stringified (JSON for
 * non-strings), whitespace-collapsed to stay scannable, and truncated to
 * `maxChars` (default {@link DEFAULT_IO_MAX_CHARS}) with an ellipsis. Use
 * the file exporter for the full, untruncated payload.
 *
 * @example
 * formatSpanIO(toolSpan, 1);
 * // ['    in:  {"query":"specialty coffee demand"}', '    out: {"results":[…]}']
 */
export function formatSpanIO(span: TraceSpan, depth = 0, maxChars = DEFAULT_IO_MAX_CHARS): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth + 1);

  if (span.input !== undefined) {
    lines.push(`${indent}in:  ${preview(span.input, maxChars)}`);
  }

  if (span.output !== undefined) {
    lines.push(`${indent}out: ${preview(span.output, maxChars)}`);
  }

  return lines;
}

/**
 * One-line, length-capped preview of a captured value. Strings pass
 * through; everything else is JSON-stringified (falling back to
 * `String()` on a circular / unstringifiable value). Internal whitespace
 * is collapsed so the preview never breaks the tree layout.
 */
function preview(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : stringify(value);
  const collapsed = text.replace(/\s+/g, " ").trim();

  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
