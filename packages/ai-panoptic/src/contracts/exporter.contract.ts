import type { Trace, TraceSpan } from "./trace.type";

/**
 * Contract every Panoptic exporter implements. An exporter is the sink
 * end of the observability pipeline: a `Collector` flattens core
 * `@warlock.js/ai` reports into {@link Trace} / {@link TraceSpan}
 * values and hands them to one or more exporters, which translate them
 * into a backend's wire format (OpenTelemetry spans, Langfuse
 * generations, a console table, …).
 *
 * **Optional-peer rule.** Concrete exporters that wrap a third-party
 * SDK (`@opentelemetry/*`, `langfuse`) MUST lazily import that SDK
 * inside the factory/`export` path — never at module top level — so
 * the SDK stays an OPTIONAL peer dependency and importing this package
 * never forces an unused vendor SDK to be installed.
 *
 * **Lifecycle.** A collector calls {@link ExporterContract.export} once
 * per completed trace (and, when the exporter advertises it, also calls
 * {@link ExporterContract.exportSpan} once for every span in the
 * finalized tree — a post-completion per-span hook, not a live stream).
 * `flush` / `shutdown` let buffered exporters drain before process
 * exit.
 *
 * All methods may be async; the collector awaits them. An exporter that
 * throws must not crash the originating run — the collector isolates
 * exporter failures the same way the core event hooks swallow consumer
 * errors.
 *
 * @example
 * const exporter: ExporterContract = {
 *   name: "console",
 *   async export(trace) {
 *     console.log(trace.traceId, trace.usage.total, "tokens");
 *   },
 * };
 */
export interface ExporterContract {
  /**
   * Stable identifier for this exporter (e.g. `"otel"`, `"langfuse"`,
   * `"console"`). Used in logs and to de-duplicate exporters registered
   * on a collector.
   */
  readonly name: string;

  /**
   * Emit one completed trace. Called once per outermost run after the
   * root report is finalized. The exporter translates `trace` into its
   * backend format and dispatches it.
   */
  export(trace: Trace): void | Promise<void>;

  /**
   * Optional per-span hook — invoked once for every span in the
   * finalized trace tree (root first, then each descendant in
   * invocation order), after `export`. A post-completion projection of
   * the same tree, not a live feed: it lets flat-stream backends emit
   * one record per node without re-walking `children` themselves.
   * Collectors only invoke this when present; exporters that consume the
   * whole tree in `export` may omit it.
   */
  exportSpan?(span: TraceSpan): void | Promise<void>;

  /**
   * Optional — flush any buffered traces/spans to the backend without
   * tearing the exporter down. Collectors call this on demand (e.g.
   * between batches) and during `shutdown`.
   */
  flush?(): void | Promise<void>;

  /**
   * Optional — flush and release resources (close HTTP clients, OTel
   * processors). Called once when the owning collector is disposed.
   * After `shutdown`, the exporter should not be reused.
   */
  shutdown?(): void | Promise<void>;
}
