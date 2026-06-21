import type { BaseReport } from "@warlock.js/ai";
import type { Trace } from "../contracts/trace.type";
import type { ContentCaptureOptions } from "./content-capture.type";
import { normalizeError } from "./normalize-error";
import { reportToSpan } from "./report-to-span";

/**
 * Project an outermost {@link BaseReport} (one whole `.execute()` /
 * `.invoke()` run) into a {@link Trace} — the root {@link
 * import("../contracts/trace.type").TraceSpan} plus the trace-wide
 * rollups exporters need without re-walking the tree.
 *
 * The trace-level identity and rollups all read off the root span the
 * projection already built (`traceId`, `usage`, timing), so the trace
 * envelope never disagrees with its own root. `reportSchemaVersion` is
 * mirrored from the root report when present (it is stamped only on
 * root nodes upstream) so exporters can branch on the source shape.
 *
 * Pure — the same input always yields the same trace. The collector
 * exposes this as `toTrace` so callers can inspect the normalized shape
 * without dispatching to exporters.
 *
 * The optional `rootError` threads the failing run's envelope error
 * (`BaseResult.error`) onto the root span. The error lives on the result
 * envelope, never on the `BaseReport` tree, so without this a failed root
 * would export `status` with no error type/message. Applied only when the
 * root span carries none of its own; the subtree projection stays pure
 * (each child surfaces its own report-level error, if any).
 *
 * @example
 * const trace = reportToTrace(result.report, result.error);
 * console.log(trace.traceId, trace.usage.total, trace.duration);
 */
export function reportToTrace(
  report: BaseReport,
  rootError?: unknown,
  options?: ContentCaptureOptions,
): Trace {
  const root = reportToSpan(report, options);

  if (root.error === undefined) {
    const error = normalizeError(rootError);

    if (error !== undefined) {
      root.error = error;
    }
  }

  const trace: Trace = {
    traceId: root.traceId,
    root,
    startedAt: root.startedAt,
    endedAt: root.endedAt,
    duration: root.duration,
    usage: root.usage,
  };

  if (root.sessionId !== undefined) {
    trace.sessionId = root.sessionId;
  }

  if (report.reportSchemaVersion !== undefined) {
    trace.reportSchemaVersion = report.reportSchemaVersion;
  }

  return trace;
}
