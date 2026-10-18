import type { ReportStatus, ReportType, Usage } from "@warlock.js/ai";

/**
 * A single node in a Panoptic trace tree, derived 1:1 from a core
 * `@warlock.js/ai` {@link BaseReport} node. Where `BaseReport` is the
 * framework's native execution report, a {@link TraceSpan} is its
 * observability-vendor projection: the same identity and timing
 * normalized to the span vocabulary shared by OpenTelemetry, Langfuse,
 * and similar backends.
 *
 * The mapping is intentionally lossless on the fields exporters care
 * about — identity (`spanId` / `parentSpanId` / `traceId`), timing
 * (`startedAt` / `endedAt` / `duration`), outcome (`status` / `error`),
 * and cost (`usage`) — so a collector can flatten a `BaseReport` tree
 * into spans without consulting any other source. Raw content — prompts,
 * responses, and tool payloads — is captured onto `input` / `output`
 * only when the collector opts in via `captureContent` (off by default).
 *
 * @example
 * const root: TraceSpan = {
 *   spanId: report.runId,
 *   traceId: report.rootRunId,
 *   name: report.name,
 *   type: report.type,
 *   status: report.status,
 *   startedAt: report.startedAt,
 *   endedAt: report.endedAt,
 *   duration: report.duration,
 *   usage: report.usage,
 *   children: [],
 * };
 */
export type TraceSpan = {
  /**
   * Stable id for this span. Mirrors `BaseReport.runId` — one span per
   * execution node.
   */
  spanId: string;
  /**
   * Id of the immediate parent span, mirroring `BaseReport.parentRunId`.
   * Absent on the root span of a trace.
   */
  parentSpanId?: string;
  /**
   * Id of the top-level trace this span belongs to. Mirrors
   * `BaseReport.rootRunId`; equals `spanId` on the root span. Exporters
   * map this onto the backend's trace id (OTel `traceId`, Langfuse
   * trace).
   */
  traceId: string;
  /**
   * Caller-supplied grouping id mirrored from `BaseReport.sessionId`.
   * Surfaces as a session/thread dimension in backends that model
   * conversations. Absent when the caller didn't supply one.
   */
  sessionId?: string;
  /** Executable identity — the tool/agent/workflow/supervisor name. */
  name: string;
  /**
   * Dev-curated version string mirrored from `BaseReport.version`.
   * Free-form; surfaced as a span attribute so dashboards can slice
   * runs of "agent X v2.1" from "v2.2". Absent when undeclared.
   */
  version?: string;
  /** Discriminator for the kind of executable that produced this span. */
  type: ReportType;
  /** Terminal status of this execution, mirrored from `BaseReport.status`. */
  status: ReportStatus;
  /** ISO-8601 wall-clock timestamp when execution began. */
  startedAt: string;
  /** ISO-8601 wall-clock timestamp when execution finished. */
  endedAt: string;
  /** Monotonic duration in milliseconds. */
  duration: number;
  /** Rolled-up usage for this node (own cost + sum of children). */
  usage: Usage;
  /**
   * Normalized error description when `status` is `"failed"` /
   * `"cancelled"`. Carried separately from status so exporters can set
   * a backend error event/attribute. Absent on successful spans.
   */
  error?: TraceSpanError;
  /**
   * Free-form attribute bag forwarded verbatim onto the backend span
   * (OTel attributes, Langfuse metadata). Collectors populate this with
   * primitive-specific metadata (trip / step / iteration counts, model
   * identity, the tool's originating trip index) that has no first-class
   * field here. Raw prompts / completions / tool payloads do NOT live
   * here — they go on {@link TraceSpan.input} / {@link TraceSpan.output}
   * under content capture. Absent when empty.
   */
  attributes?: Record<string, unknown>;
  /**
   * Captured input for this node — an agent's first-trip prompt or a
   * tool's call arguments — present ONLY when the collector ran with
   * content capture enabled (`captureContent`), off by default because
   * payloads are large and often sensitive. Typed `unknown`: agent
   * prompts are strings, tool args are the validated argument value.
   */
  input?: unknown;
  /**
   * Captured output for this node — an agent's final response text or a
   * tool's return value — present only under content capture (see
   * {@link TraceSpan.input}).
   */
  output?: unknown;
  /**
   * Child spans, mirroring `BaseReport.children` in invocation order.
   * Empty for leaf spans (pure tools). Exporters that emit a flat
   * stream may ignore this and rely on `parentSpanId` instead.
   */
  children: TraceSpan[];
};

/**
 * Normalized error attached to a failed / cancelled {@link TraceSpan}.
 * Kept structural (not an `Error` instance) so it survives JSON
 * serialization to a backend collector unchanged.
 */
export type TraceSpanError = {
  /** Stable error identifier (typed framework error name when available). */
  type: string;
  /** Human-readable message — secret-scrubbed before storage (S4). */
  message: string;
  /** Optional captured stack trace, secret-scrubbed when present (S4). */
  stack?: string;
  /**
   * Optional redacted view of the error's `cause` (S4) — a raw provider
   * SDK error can carry `Authorization` / `x-api-key` / `cookie` on its
   * headers, so the cause is deep-redacted (sensitive keys stripped)
   * before it is attached.
   */
  cause?: unknown;
};

/**
 * The root of a Panoptic trace — a top-level {@link TraceSpan} plus the
 * trace-wide rollups exporters need without re-walking the tree. One
 * `Trace` corresponds to one outermost `BaseReport` (a single
 * `.execute()` / `.invoke()` call).
 */
export type Trace = {
  /** HTTP request correlation supplied by an integration; independent of sessionId. */
  requestId?: string;
  /** Trace id — equals the root span's `traceId` / `rootRunId`. */
  traceId: string;
  /** Session grouping id, when the originating run carried one. */
  sessionId?: string;
  /** Root span of this trace. */
  root: TraceSpan;
  /** Wall-clock start of the trace (root span `startedAt`). */
  startedAt: string;
  /** Wall-clock end of the trace (root span `endedAt`). */
  endedAt: string;
  /** Total trace duration in milliseconds (root span `duration`). */
  duration: number;
  /** Trace-wide usage rollup (root span `usage`). */
  usage: Usage;
  /**
   * Wire-format version of the source `BaseReport` shape, mirrored from
   * `BaseReport.reportSchemaVersion`. Exporters branch on this to parse
   * older stored traces with their original-shape rules.
   */
  reportSchemaVersion?: number;
};
