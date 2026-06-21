import type { BaseReport } from "@warlock.js/ai";
import type { TraceSpan } from "../contracts/trace.type";
import type { ContentCaptureOptions, ContentRedactor } from "./content-capture.type";
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
 * When {@link ContentCaptureOptions.captureContent} is set, the raw
 * prompt/response (agents) and args/result (tools) are additionally
 * copied onto `span.input` / `span.output` — off by default because
 * payloads are large and often sensitive. A {@link ContentRedactor} can
 * mask each value first.
 *
 * No external lookup is needed — a `BaseReport` already carries
 * everything a span requires, so a collector can flatten a tree without
 * consulting any other source.
 *
 * @example
 * const root = reportToSpan(result.report);
 * console.log(root.spanId, root.traceId, root.children.length);
 */
export function reportToSpan(report: BaseReport, options?: ContentCaptureOptions): TraceSpan {
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
    children: report.children.map((child) => reportToSpan(child, options)),
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

  if (options?.captureContent) {
    captureContent(span, report, options.redactContent);
  }

  return span;
}

/** Per-primitive content fields read off a widened report node. */
type ContentReport = {
  input?: unknown;
  output?: unknown;
  trips?: Array<{ input?: unknown; output?: unknown }>;
};

/**
 * Copy the node's raw content onto `span.input` / `span.output`.
 *
 * - Tools carry the call arguments + return value directly on the report
 *   (`ToolCall.input` / `ToolCall.output`).
 * - Agents carry a `trips[]` history; the first trip's `input` is the
 *   real user prompt, and the last NON-EMPTY trip `output` is the final
 *   response text. (A failed / max-trips run can end on a trip whose
 *   `output` is `""` or tool-call-only, so we scan back for the last one
 *   that carried text rather than surfacing an empty string. Intermediate
 *   trips also store a `"[tool results]"` placeholder upstream.)
 *
 * Each value is passed through the optional {@link ContentRedactor};
 * a redactor returning `undefined` drops the field.
 */
function captureContent(span: TraceSpan, report: BaseReport, redact?: ContentRedactor): void {
  const node = report as BaseReport & ContentReport;

  let input: unknown;
  let output: unknown;

  if (report.type === "tool") {
    input = node.input;
    output = node.output;
  } else if (Array.isArray(node.trips) && node.trips.length > 0) {
    input = node.trips[0]?.input;
    output = lastNonEmptyOutput(node.trips);
  }

  if (input !== undefined) {
    const value = redact ? redact(input, { name: span.name, type: span.type, field: "input" }) : input;
    if (value !== undefined) {
      span.input = value;
    }
  }

  if (output !== undefined) {
    const value = redact ? redact(output, { name: span.name, type: span.type, field: "output" }) : output;
    if (value !== undefined) {
      span.output = value;
    }
  }
}

/**
 * The last trip output that actually carries text — the agent's final
 * response on the happy path. A failed or max-trips run can end on a trip
 * whose `output` is `""` or tool-call-only, so we scan backwards for the
 * last trip that produced text rather than blindly taking the final trip
 * (which would surface an empty string). Returns `undefined` when no trip
 * produced any output.
 */
function lastNonEmptyOutput(trips: Array<{ output?: unknown }>): unknown {
  for (let i = trips.length - 1; i >= 0; i -= 1) {
    const out = trips[i]?.output;
    const hasText = typeof out === "string" ? out.length > 0 : out !== undefined;

    if (hasText) {
      return out;
    }
  }

  return undefined;
}
