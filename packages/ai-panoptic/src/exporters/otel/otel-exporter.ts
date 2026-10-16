import type { ExporterContract, Trace, TraceSpan } from "../../contracts";
import { toGenAiAttributes, GEN_AI_ATTRIBUTES } from "../utils";
import type {
  OtelApiModule,
  OtelContext,
  OtelSpan,
  OtelSpanStatusCode,
  OtelTracer,
} from "./otel-api.shim.type";
import type { OtelExporterOptions } from "./otel-exporter.type";

const EXPORTER_NAME = "otel";
const DEFAULT_TRACER_NAME = "@warlock.js/ai-panoptic";

// ============================================================
// Lazily-loaded @opentelemetry/api (OPTIONAL peer)
// ============================================================

let OtelApi: OtelApiModule;
let isModuleExists: boolean | null = null;
let loadingPromise: Promise<void> | undefined;

const OTEL_INSTALL_INSTRUCTIONS = `
The Panoptic OpenTelemetry exporter requires the @opentelemetry/api package.
Install it with:

  npm install @opentelemetry/api

Or with your preferred package manager:

  pnpm add @opentelemetry/api
  yarn add @opentelemetry/api
`.trim();

/**
 * Settle the lazy import of `@opentelemetry/api` once, concurrency-safe.
 * A bare `catch` flips the flag to `false`; the curated install string
 * surfaces at use time so a missing SDK never throws a raw module
 * resolution error.
 */
function loadOtel(): Promise<void> {
  if (isModuleExists !== null) {
    return Promise.resolve();
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      // Indirect specifier so TS does not statically resolve the
      // optional `@opentelemetry/api` peer at compile time (it is
      // intentionally not installed). The result is structurally the
      // `OtelApiModule` shim — the exporter only touches that surface.
      const moduleName = "@opentelemetry/api";
      OtelApi = (await import(moduleName)) as OtelApiModule;
      isModuleExists = true;
    } catch {
      isModuleExists = false;
    }
  })();

  return loadingPromise;
}

/**
 * {@link ExporterContract} that maps Panoptic traces onto OpenTelemetry
 * spans following the GenAI semantic conventions (`gen_ai.*`
 * attributes). Lazily imports `@opentelemetry/api` so it stays an
 * OPTIONAL peer — importing this module never forces the SDK to be
 * installed, and a missing SDK surfaces as a curated "install this"
 * error on first `export`, not a boot-time stack trace.
 *
 * The exporter emits onto a `Tracer` you supply (or fetches one from the
 * globally registered provider). It never configures the SDK — wiring a
 * `TracerProvider`, processors, and span exporters is the host app's
 * job, exactly as with any other OTel instrumentation.
 *
 * Each {@link TraceSpan} becomes one OTel span with the source span's
 * start/end times and parent relationship reconstructed, so the emitted
 * tree matches the original execution tree.
 *
 * @example
 * // app already set up @opentelemetry/sdk-trace-base + a provider
 * collector.use(otelExporter({ tracerName: "my-app", system: "openai" }));
 */
export function otelExporter(options: OtelExporterOptions = {}): ExporterContract {
  loadOtel();

  return {
    name: EXPORTER_NAME,
    async export(trace: Trace): Promise<void> {
      await loadOtel();

      if (!isModuleExists) {
        throw new Error(OTEL_INSTALL_INSTRUCTIONS);
      }

      const tracer = resolveTracer(options);
      emitSpan(tracer, trace.root, undefined, options);
    },
  };
}

/**
 * Resolve the `Tracer` spans are emitted on — the caller-supplied one,
 * or one fetched from the globally registered provider by name.
 */
function resolveTracer(options: OtelExporterOptions): OtelTracer {
  if (options.tracer) {
    return options.tracer;
  }

  return OtelApi.trace.getTracer(options.tracerName ?? DEFAULT_TRACER_NAME, options.tracerVersion);
}

/**
 * Recreate one {@link TraceSpan} (and its subtree) as OTel spans. The
 * span is started with the source `startedAt`, parented under
 * `parentContext` so the tree is preserved, annotated with GenAI
 * attributes, given the mapped status, and ended at `endedAt`. Children
 * recurse under this span's context.
 */
function emitSpan(
  tracer: OtelTracer,
  span: TraceSpan,
  parentContext: OtelContext | undefined,
  options: OtelExporterOptions,
): void {
  const startTime = toEpochMillis(span.startedAt);
  const baseContext = parentContext ?? OtelApi.context.active();

  const otelSpan = tracer.startSpan(span.name, { startTime }, baseContext);

  applyAttributes(otelSpan, span, options);
  applyStatus(otelSpan, span);

  const childContext = OtelApi.trace.setSpan(baseContext, otelSpan);

  for (const child of span.children) {
    emitSpan(tracer, child, childContext, options);
  }

  otelSpan.end(toEpochMillis(span.endedAt));
}

/**
 * Set the GenAI + Warlock attributes on the OTel span, defaulting
 * `gen_ai.system` from the exporter options when the span carried none.
 */
function applyAttributes(otelSpan: OtelSpan, span: TraceSpan, options: OtelExporterOptions): void {
  const attributes = toGenAiAttributes(span);

  if (options.system !== undefined && attributes[GEN_AI_ATTRIBUTES.system] === undefined) {
    attributes[GEN_AI_ATTRIBUTES.system] = options.system;
  }

  // Captured content (only present under `captureContent`) maps onto the
  // GenAI prompt/completion attributes, stringified since OTel attribute
  // values must be primitives.
  if (span.input !== undefined) {
    attributes[GEN_AI_ATTRIBUTES.prompt] = stringifyContent(span.input);
  }

  if (span.output !== undefined) {
    attributes[GEN_AI_ATTRIBUTES.completion] = stringifyContent(span.output);
  }

  otelSpan.setAttributes(attributes);
}

/**
 * Coerce a captured content value to a string OTel attribute. Strings
 * pass through; structured values are JSON-encoded (falling back to
 * `String()` if they can't be serialized).
 */
function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Map the Panoptic span status onto the OTel span status, recording the
 * normalized error as an exception event + ERROR status when present.
 */
function applyStatus(otelSpan: OtelSpan, span: TraceSpan): void {
  const codes: OtelSpanStatusCode = OtelApi.SpanStatusCode;

  if (span.error) {
    otelSpan.recordException({
      name: span.error.type,
      message: span.error.message,
      stack: span.error.stack,
    });
  }

  if (span.status === "failed" || span.status === "cancelled") {
    otelSpan.setStatus({
      code: codes.ERROR,
      message: span.error?.message,
    });
    return;
  }

  // A capped / paused run is neither a failure nor a clean success.
  // Mapping it to OK would let a hit iteration cap read as a healthy
  // run; leave the OTel status UNSET with a descriptive message so the
  // outcome is visible without being miscounted as an error.
  if (span.status === "max-iterations" || span.status === "awaiting-input") {
    otelSpan.setStatus({
      code: codes.UNSET,
      message:
        span.status === "max-iterations"
          ? "Run hit the iteration cap without an explicit end"
          : "Run is awaiting the next input turn",
    });
    return;
  }

  otelSpan.setStatus({ code: codes.OK });
}

/**
 * Convert an ISO-8601 timestamp to epoch milliseconds — the `TimeInput`
 * form OTel's `startSpan` / `Span.end` accept directly.
 */
function toEpochMillis(isoTimestamp: string): number {
  return new Date(isoTimestamp).getTime();
}
