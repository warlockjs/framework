import type { TraceSpan } from "../contracts/trace.type";

/** Depth-first search for the span with `spanId` inside a trace's span tree. */
export function findSpanById(root: TraceSpan, spanId: string): TraceSpan | undefined {
  if (root.spanId === spanId) {
    return root;
  }

  for (const child of root.children) {
    const found = findSpanById(child, spanId);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}
