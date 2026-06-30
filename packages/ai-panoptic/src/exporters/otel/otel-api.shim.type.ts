/**
 * Minimal structural shims for the slice of the `@opentelemetry/api`
 * surface the Panoptic OTel exporter touches.
 *
 * `@opentelemetry/api` is an OPTIONAL peer (declared
 * `peerDependenciesMeta.optional` in this package's manifest), so it is
 * intentionally NOT installed in this workspace. Importing its types
 * directly (`import type { Tracer } from "@opentelemetry/api"`) would
 * make the package fail to type-check whenever the peer is absent —
 * defeating the "optional" contract. These local shims keep the
 * exporter fully typed without forcing the SDK to be present; when a
 * host app DOES install the real package, the structural shapes line up
 * with the genuine API (the exporter only ever calls the methods modeled
 * here), and the runtime still binds to the real module via the lazy
 * `await import("@opentelemetry/api")`.
 *
 * Keep these intentionally narrow — model only what the exporter uses,
 * not the whole OTel API.
 */

/** Subset of OTel `TimeInput` the exporter passes (epoch millis). */
export type OtelTimeInput = number;

/** Opaque OTel `Context` — the exporter only threads it through. */
export type OtelContext = object;

/**
 * Exception shape accepted by `Span.recordException`. Mirrors the
 * `Exception` object form OTel accepts (name/message/stack).
 */
export type OtelException = {
  name?: string;
  message?: string;
  stack?: string;
};

/** Status object passed to `Span.setStatus`. */
export type OtelSpanStatus = {
  code: number;
  message?: string;
};

/**
 * Subset of OTel `Span` the exporter drives — set attributes/status,
 * record exceptions, and end with a timestamp.
 */
export type OtelSpan = {
  setAttributes(attributes: Record<string, unknown>): void;
  setStatus(status: OtelSpanStatus): void;
  recordException(exception: OtelException): void;
  end(endTime?: OtelTimeInput): void;
};

/**
 * Subset of OTel `Tracer` the exporter calls. `startSpan` is invoked
 * with a name, a `{ startTime }` options object, and a parent context.
 */
export type OtelTracer = {
  startSpan(
    name: string,
    options: { startTime?: OtelTimeInput },
    context?: OtelContext,
  ): OtelSpan;
};

/**
 * The `SpanStatusCode` enum members the exporter references. Models the
 * three canonical OTel status codes (UNSET / OK / ERROR).
 */
export type OtelSpanStatusCode = {
  UNSET: number;
  OK: number;
  ERROR: number;
};

/**
 * The shape of the lazily-imported `@opentelemetry/api` module the
 * exporter relies on — the `trace` / `context` namespaces plus the
 * `SpanStatusCode` enum.
 */
export type OtelApiModule = {
  SpanStatusCode: OtelSpanStatusCode;
  trace: {
    getTracer(name: string, version?: string): OtelTracer;
    setSpan(context: OtelContext, span: OtelSpan): OtelContext;
  };
  context: {
    active(): OtelContext;
  };
};
