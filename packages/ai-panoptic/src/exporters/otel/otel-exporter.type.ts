import type { Tracer } from "@opentelemetry/api";

/**
 * Options for {@link otelExporter}.
 *
 * The exporter never owns a `TracerProvider` — wiring the SDK
 * (`@opentelemetry/sdk-trace-base`, exporters, processors) is the host
 * app's job. Pass either a ready {@link Tracer} or a name and let the
 * exporter fetch one from the globally registered provider via
 * `trace.getTracer(name)`.
 */
export type OtelExporterOptions = {
  /**
   * A `Tracer` to emit spans on. When omitted, the exporter lazily calls
   * `trace.getTracer(tracerName, tracerVersion)` against the globally
   * registered provider, so it works with whatever SDK the app set up.
   */
  tracer?: Tracer;
  /**
   * Instrumentation-scope name passed to `trace.getTracer` when `tracer`
   * is not supplied. Defaults to `"@warlock.js/ai-panoptic"`.
   */
  tracerName?: string;
  /**
   * Instrumentation-scope version passed alongside `tracerName`.
   * Optional.
   */
  tracerVersion?: string;
  /**
   * Value of the `gen_ai.system` attribute set on every span when the
   * span itself didn't carry one (e.g. `"openai"`, `"anthropic"`).
   * Optional — omitted when neither this nor the span supplies it.
   */
  system?: string;
};
