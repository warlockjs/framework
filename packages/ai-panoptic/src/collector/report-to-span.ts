import type { BaseReport } from "@warlock.js/ai";
import type { TraceSpan } from "../contracts/trace.type";
import { extractSpanAttributes } from "./extract-span-attributes";
import { normalizeError } from "./normalize-error";

/**
 * Project one {@link BaseReport} node — and its entire subtree — into a
 * {@link TraceSpan}. Pure and recursive: identity, timing, status, and
 * the rolled-up `usage` map across 1:1 from the report; lineage maps
 * `runId → spanId`, `parentRunId → parentSpanId`, `rootRunId → traceId`;
 * children recurse in invocation order so the span tree mirrors the
 * report tree exactly.
 *
 * The error is normalized to the JSON-safe {@link
 * import("../contracts/trace.type").TraceSpanError} shape only when the
 * node carried one (failed / cancelled). Primitive-specific detail that
 * has no first-class span field (trip / step / iteration counts, model
 * identity, tool trip index) is routed into the optional `attributes`
 * bag via {@link extractSpanAttributes}.
 *
 * No external lookup is needed — a `BaseReport` already carries
 * everything a span requires, so a collector can flatten a tree without
 * consulting any other source.
 *
 * @example
 * const root = reportToSpan(result.report);
 * console.log(root.spanId, root.traceId, root.children.length);
 */
export function reportToSpan(report: BaseReport): TraceSpan {
  const span: TraceSpan = {
    spanId: report.runId,
    traceId: report.rootRunId,
    name: report.name,
    type: report.type,
    status: report.status,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    duration: report.duration,
    usage: report.usage,
    children: report.children.map(reportToSpan),
  };

  if (report.parentRunId !== undefined) {
    span.parentSpanId = report.parentRunId;
  }

  if (report.sessionId !== undefined) {
    span.sessionId = report.sessionId;
  }

  if (report.version !== undefined) {
    span.version = report.version;
  }

  const error = normalizeError((report as { error?: unknown }).error);
  if (error !== undefined) {
    span.error = error;
  }

  const attributes = extractSpanAttributes(report);
  if (attributes !== undefined) {
    span.attributes = attributes;
  }

  return span;
}
