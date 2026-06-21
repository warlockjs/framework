import type { Trace, TraceSpan } from "../../contracts";

/**
 * Build a {@link TraceSpan} with sensible defaults for tests, overriding
 * only the fields a given case cares about. Keeps each spec focused on
 * the behavior under test instead of restating the full span shape.
 *
 * NOTE: test-only helper. Not part of the package's public surface.
 */
export function makeSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    spanId: "span-1",
    traceId: "trace-1",
    name: "root",
    type: "agent",
    status: "completed",
    startedAt: "2026-06-18T10:00:00.000Z",
    endedAt: "2026-06-18T10:00:01.000Z",
    duration: 1000,
    usage: { input: 100, output: 200, total: 300 },
    children: [],
    ...overrides,
  };
}

/**
 * Build a {@link Trace} wrapping a root span, defaulting the trace-level
 * rollups from that span.
 */
export function makeTrace(root: TraceSpan, overrides: Partial<Trace> = {}): Trace {
  return {
    traceId: root.traceId,
    sessionId: root.sessionId,
    root,
    startedAt: root.startedAt,
    endedAt: root.endedAt,
    duration: root.duration,
    usage: root.usage,
    ...overrides,
  };
}
