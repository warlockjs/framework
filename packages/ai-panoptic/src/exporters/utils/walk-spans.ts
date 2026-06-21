import type { TraceSpan } from "../../contracts";

/**
 * Depth-first pre-order traversal of a {@link TraceSpan} tree, yielding
 * the root first and then each descendant in `children` (invocation)
 * order. Exporters that emit a flat span stream — OpenTelemetry, the
 * console table — walk the tree once with this instead of re-writing the
 * recursion in every exporter.
 *
 * @example
 * for (const span of walkSpans(trace.root)) {
 *   emit(span);
 * }
 */
export function* walkSpans(root: TraceSpan): Generator<TraceSpan> {
  yield root;

  for (const child of root.children) {
    yield* walkSpans(child);
  }
}
