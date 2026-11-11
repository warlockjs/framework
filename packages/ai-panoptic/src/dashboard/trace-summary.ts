import type { Trace, TraceSpan, TraceSpanError } from "../contracts/trace.type";
import { traceCost } from "./trace-filter";

/**
 * The root span of a {@link TraceSummary}: identity, timing, status,
 * usage and attributes, without captured content (`input` / `output`),
 * children or the error's stack and cause.
 */
export type TraceSpanSummary = Omit<TraceSpan, "input" | "output" | "children" | "error"> & {
  error?: Pick<TraceSpanError, "type" | "message">;
};

/**
 * One entry of the dashboard's `GET api/traces` list: everything the trace
 * list renders, without the span tree or captured content. The full trace
 * stays on `GET api/traces/:id` (or the list with `?full=1`).
 */
export type TraceSummary = Omit<Trace, "root"> & {
  root: TraceSpanSummary;
  /** Number of spans in the trace tree, the root included. */
  spanCount: number;
  /** Total USD cost of the trace (its priced root usage, else the rollup of its subtree). */
  totalCost: number;
};

function countSpans(span: TraceSpan): number {
  let count = 1;

  for (const child of span.children) {
    count += countSpans(child);
  }

  return count;
}

/** Project a stored trace onto the list summary served by `GET api/traces`. */
export function toTraceSummary(trace: Trace): TraceSummary {
  const { input: _input, output: _output, children: _children, error, ...root } = trace.root;
  const summaryRoot: TraceSpanSummary = root;

  if (error !== undefined) {
    summaryRoot.error = { type: error.type, message: error.message };
  }

  return {
    ...trace,
    root: summaryRoot,
    spanCount: countSpans(trace.root),
    totalCost: traceCost(trace),
  };
}
