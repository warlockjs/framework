import type { TraceSpan } from "../../contracts";
import { totalCostUsd } from "../utils";

/**
 * Render a single {@link TraceSpan} as one scannable console line:
 * `<status> <type> "<name>" — <duration>ms, <tokens> tok[, $<cost>]`.
 * `depth` controls leading indentation when printing a tree. Pure — no
 * side effects — so it is trivially testable and reused by both the
 * per-trace summary and the per-span streaming line.
 *
 * @example
 * formatSpanLine(span, 1);
 * // '  ok agent "router" — 1240ms, 470 tok, $0.0021'
 */
export function formatSpanLine(span: TraceSpan, depth = 0): string {
  const indent = "  ".repeat(depth);
  const marker = statusMarker(span.status);
  const cost = totalCostUsd(span.usage);
  const costSuffix = cost === undefined ? "" : `, $${cost.toFixed(4)}`;

  let line = `${indent}${marker} ${span.type} "${span.name}" — ${span.duration}ms, ${span.usage.total} tok${costSuffix}`;

  if (span.error) {
    line += ` [${span.error.type}: ${span.error.message}]`;
  }

  return line;
}

/**
 * Short ASCII marker for a span's terminal status. Plain ASCII (no
 * emoji/color codes) so output stays clean in log aggregators and CI.
 */
function statusMarker(status: TraceSpan["status"]): string {
  switch (status) {
    case "completed":
      return "ok";
    case "failed":
      return "ERR";
    case "cancelled":
      return "cancel";
    case "max-iterations":
      return "max-iter";
    case "awaiting-input":
      return "await";
    default:
      return status;
  }
}
